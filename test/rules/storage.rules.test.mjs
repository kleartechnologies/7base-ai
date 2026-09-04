/**
 * Storage security rules, exercised against the real rules engine.
 *
 * Storage access is granted by a `firestore.get` on the business document, so
 * this suite needs BOTH emulators:
 *
 *     firebase emulators:exec --only firestore,storage --project demo-marka \
 *       "node test/rules/storage.rules.test.mjs"
 *
 * (or `npm run test:rules:storage`). Like the Firestore suite, nothing here
 * re-implements a rule in JavaScript — every assertion goes through the
 * deployed `storage.rules`.
 */
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'
const STORAGE_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199'
const [fsHost, fsPort] = FIRESTORE_HOST.split(':')
const [stHost, stPort] = STORAGE_HOST.split(':')

const env = await initializeTestEnvironment({
  projectId: 'demo-marka',
  firestore: {
    host: fsHost, port: Number(fsPort),
    rules: readFileSync(resolve(root, 'firestore.rules'), 'utf8'),
  },
  storage: {
    host: stHost, port: Number(stPort),
    rules: readFileSync(resolve(root, 'storage.rules'), 'utf8'),
  },
})

// Ownership comes from Firestore: storage.rules does a firestore.get on the
// business document. Seed those documents with rules disabled.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'businesses/aliceBiz'), { ownerId: 'alice', name: 'Warung', createdAt: 1 })
  await setDoc(doc(db, 'businesses/bobBiz'), { ownerId: 'bob', name: 'Kedai', createdAt: 1 })
})

const alice = env.authenticatedContext('alice').storage()
const bob = env.authenticatedContext('bob').storage()
const anon = env.unauthenticatedContext().storage()

let pass = 0, fail = 0
async function ok(name, fn) {
  try { await assertSucceeds(fn()); console.log('  allow  ', name); pass++ }
  catch (e) { console.log('  FAIL(allow)', name, '-', e.message.split('\n')[0]); fail++ }
}
async function no(name, fn) {
  try { await assertFails(fn()); console.log('  deny   ', name); pass++ }
  catch (e) { console.log('  FAIL(deny)', name, '-', e.message.split('\n')[0]); fail++ }
}

const jpeg = { contentType: 'image/jpeg' }
const bytes = (n = 4) => new Uint8Array(n).fill(7)
const upload = (storage, path, meta, size = 4) =>
  uploadBytes(ref(storage, path), bytes(size), meta)

console.log('\n-- OWNERSHIP: the business document decides everything --')
await ok('alice uploads into her own assets folder', () =>
  upload(alice, 'businesses/aliceBiz/assets/1_mandhi.jpg', jpeg))
await ok('alice reads her own file back', () =>
  getBytes(ref(alice, 'businesses/aliceBiz/assets/1_mandhi.jpg')))
await no('bob reads alice file', () =>
  getBytes(ref(bob, 'businesses/aliceBiz/assets/1_mandhi.jpg')))
await no('bob uploads into alice business (forged businessId in path)', () =>
  upload(bob, 'businesses/aliceBiz/assets/forged.jpg', jpeg))
await no('bob deletes alice file', () =>
  deleteObject(ref(bob, 'businesses/aliceBiz/assets/1_mandhi.jpg')))
await no('alice uploads into bob business', () =>
  upload(alice, 'businesses/bobBiz/assets/sneak.jpg', jpeg))
await no('upload into a nonexistent business', () =>
  upload(alice, 'businesses/ghostBiz/assets/ghost.jpg', jpeg))
await no('anon reads a file', () =>
  getBytes(ref(anon, 'businesses/aliceBiz/assets/1_mandhi.jpg')))
await no('anon uploads a file', () =>
  upload(anon, 'businesses/aliceBiz/assets/anon.jpg', jpeg))

console.log('\n-- PATHS the product actually writes --')
await ok('brand file (logo)', () =>
  upload(alice, 'businesses/aliceBiz/brand/1_logo.png', { contentType: 'image/png' }))
await ok('general upload', () =>
  upload(alice, 'businesses/aliceBiz/uploads/1_photo.webp', { contentType: 'image/webp' }))
await ok('chat attachment under a conversation', () =>
  upload(alice, 'businesses/aliceBiz/conversations/conv1/attachments/1_menu.pdf', { contentType: 'application/pdf' }))
await no('file outside any business prefix', () =>
  upload(alice, 'loose/1_file.jpg', jpeg))
await no('read outside any business prefix', () =>
  getBytes(ref(alice, 'loose/1_file.jpg')))

console.log('\n-- CONTENT TYPES: exactly four, nothing executable --')
await ok('image/jpeg allowed', () =>
  upload(alice, 'businesses/aliceBiz/assets/t.jpg', jpeg))
await ok('image/png allowed', () =>
  upload(alice, 'businesses/aliceBiz/assets/t.png', { contentType: 'image/png' }))
await ok('image/webp allowed', () =>
  upload(alice, 'businesses/aliceBiz/assets/t.webp', { contentType: 'image/webp' }))
await ok('application/pdf allowed', () =>
  upload(alice, 'businesses/aliceBiz/assets/t.pdf', { contentType: 'application/pdf' }))
await no('image/svg+xml refused (script container)', () =>
  upload(alice, 'businesses/aliceBiz/assets/t.svg', { contentType: 'image/svg+xml' }))
await no('image/gif refused (nothing uploads it)', () =>
  upload(alice, 'businesses/aliceBiz/assets/t.gif', { contentType: 'image/gif' }))
await no('text/html refused', () =>
  upload(alice, 'businesses/aliceBiz/assets/t.html', { contentType: 'text/html' }))
await no('application/javascript refused', () =>
  upload(alice, 'businesses/aliceBiz/assets/t.js', { contentType: 'application/javascript' }))

console.log('\n-- SIZE: strictly under 20 MiB --')
await ok('file just under the ceiling', () =>
  upload(alice, 'businesses/aliceBiz/assets/big.jpg', jpeg, 20 * 1024 * 1024 - 1))
await no('file exactly at 20 MiB', () =>
  upload(alice, 'businesses/aliceBiz/assets/toobig.jpg', jpeg, 20 * 1024 * 1024))

console.log('\n-- OWNER DELETE --')
await ok('alice deletes her own file', () =>
  deleteObject(ref(alice, 'businesses/aliceBiz/assets/t.jpg')))

console.log(`\nstorage rules: ${pass} passed, ${fail} failed`)
await env.cleanup()
process.exit(fail ? 1 : 0)
