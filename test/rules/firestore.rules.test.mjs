/**
 * Firestore security rules, exercised against the real rules engine.
 *
 * Not vitest: the rest of the suite is deliberately free of Firebase so it
 * runs in milliseconds with nothing installed. These need a live Firestore
 * emulator, so they are a separate command:
 *
 *     firebase emulators:start --only firestore
 *     npm run test:rules
 *
 * Every assertion below goes through the deployed `firestore.rules` — none of
 * it is a re-implementation of the rules in JavaScript, which would only test
 * that two copies of a mistake agree.
 */
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing'
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, addDoc, increment,
} from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const RULES = resolve(dirname(fileURLToPath(import.meta.url)), '../../firestore.rules')
const HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'
const [host, port] = HOST.split(':')

const env = await initializeTestEnvironment({
  projectId: 'demo-marka',
  firestore: {
    host, port: Number(port),
    rules: readFileSync(RULES, 'utf8'),
  },
})

const alice = env.authenticatedContext('alice').firestore()
const bob = env.authenticatedContext('bob').firestore()
const anon = env.unauthenticatedContext().firestore()

let pass = 0, fail = 0
async function ok(name, fn) {
  try { await assertSucceeds(fn()); console.log('  allow  ', name); pass++ }
  catch (e) { console.log('  FAIL(allow)', name, '-', e.message.split('\n')[0]); fail++ }
}
async function no(name, fn) {
  try { await assertFails(fn()); console.log('  deny   ', name); pass++ }
  catch (e) { console.log('  FAIL(deny)', name, '-', e.message.split('\n')[0]); fail++ }
}

const biz = (ownerId, over = {}) => ({
  ownerId, name: 'Warung', industry: 'food_and_beverage', products: [],
  provenance: {}, sources: [],
  discovery: { status: 'not_started', stage: null, lastRunAt: null, completedAt: null,
    sourceRef: null, pagesAnalysed: 0, error: null, errorCode: null, summary: null, unknowns: [] },
  createdAt: 1000, updatedAt: 1000, ...over,
})

// Seed with rules disabled, so the fixtures themselves are not under test.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'businesses/aliceBiz'), biz('alice'))
  await setDoc(doc(db, 'businesses/bobBiz'), biz('bob'))
  await setDoc(doc(db, 'users/alice'), { id: 'alice', createdAt: 1000 })
  await setDoc(doc(db, 'users/bob'), { id: 'bob', createdAt: 1000 })
  await setDoc(doc(db, 'conversations/aliceConv'), { ownerId: 'alice', businessId: 'aliceBiz', createdAt: 1000 })
  await setDoc(doc(db, 'conversations/bobConv'), { ownerId: 'bob', businessId: 'bobBiz', createdAt: 1000 })
  await setDoc(doc(db, 'conversations/aliceConv/messages/m1'), { ownerId: 'alice', role: 'user', createdAt: 1000 })
  for (const c of ['campaigns', 'creatives', 'calendarItems', 'results']) {
    await setDoc(doc(db, c, 'aliceDoc'), { ownerId: 'alice', createdAt: 1000 })
  }
  await setDoc(doc(db, 'recommendations/aliceRec'), { ownerId: 'alice', businessId: 'aliceBiz', conversationId: 'aliceConv', confidence: 'medium', createdAt: 1000 })
  await setDoc(doc(db, 'campaigns/aliceCampaign'), {
    ownerId: 'alice', businessId: 'aliceBiz', conversationId: 'aliceConv',
    sourceRecommendationId: 'aliceRec', name: 'Weekday Lunch Rush', status: 'draft',
    userEdited: [], createdAt: 1000, updatedAt: 1000,
  })
  await setDoc(doc(db, 'creatives/aliceCreative'), {
    ownerId: 'alice', businessId: 'aliceBiz', campaignId: 'aliceCampaign',
    conversationId: 'aliceConv', sourceRecommendationId: 'aliceRec',
    name: 'Weekday Lunch Poster', format: 'square_post', status: 'ready',
    content: {
      headline: 'Lunch without the wait', subheadline: null, body: null,
      callToAction: 'Order on WhatsApp', offerText: null,
      image: { storagePath: 'businesses/aliceBiz/creatives/x.png', prompt: 'a photo', altText: null, source: 'generated' },
      layout: 'image_full_bleed',
    },
    captions: { facebook: 'fb', instagram: 'ig', short: 's', whatsapp: null },
    style: { palette: null, headingFont: null, bodyFont: null, logoStoragePath: null },
    render: null, userEdited: [], ownerDirectives: [], imageError: null, meta: null,
    createdAt: 1000, updatedAt: 1000,
  })
})

console.log('\n-- OWNERSHIP & IMMUTABILITY --')
await ok('alice reads her business', () => getDoc(doc(alice, 'businesses/aliceBiz')))
await ok('alice updates her business name', () => updateDoc(doc(alice, 'businesses/aliceBiz'), { name: 'New', updatedAt: 2000 }))
await no('rewrite ownerId', () => updateDoc(doc(alice, 'businesses/aliceBiz'), { ownerId: 'bob' }))
await no('rewrite createdAt', () => updateDoc(doc(alice, 'businesses/aliceBiz'), { createdAt: 9999 }))
await no('client writes discovery', () => updateDoc(doc(alice, 'businesses/aliceBiz'), { discovery: { status: 'complete', pagesAnalysed: 6 } }))
await no('client writes sources', () => updateDoc(doc(alice, 'businesses/aliceBiz'), { sources: [{ id: 'website' }] }))
await ok('alice creates a pristine business', () => setDoc(doc(alice, 'businesses/newBiz'), biz('alice')))
await no('create claiming a completed discovery', () => setDoc(doc(alice, 'businesses/fakeBiz'), biz('alice', { discovery: { status: 'complete', sourceRef: 'x', completedAt: 1, pagesAnalysed: 6 } })))
await no('create claiming sources', () => setDoc(doc(alice, 'businesses/fakeBiz2'), biz('alice', { sources: [{ id: 'website' }] })))
await no('create owned by someone else', () => setDoc(doc(alice, 'businesses/fakeBiz3'), biz('bob')))
await ok('alice writes a brain section', () => updateDoc(doc(alice, 'businesses/aliceBiz'), { audience: { value: {}, source: 'user', confidence: 1, confirmed: true, discoveredAt: 1 }, updatedAt: 3000 }))
await ok('alice deletes her business', () => deleteDoc(doc(alice, 'businesses/newBiz')))

console.log('\n-- OWNER ACCEPTANCE ("LOOKS GOOD") --')
const acceptedStamp = { source: 'website', sourceRef: 'https://x.my', confidence: 0.9, confirmed: true, discoveredAt: 1, confirmedAt: 2 }
await ok('alice confirms discovered provenance without changing its source', () =>
  updateDoc(doc(alice, 'businesses/aliceBiz'), { provenance: { name: acceptedStamp }, updatedAt: 4000 }))
await ok('alice confirms a discovered section', () =>
  updateDoc(doc(alice, 'businesses/aliceBiz'), { brand: { value: { voice: 'Warm' }, ...acceptedStamp }, updatedAt: 4100 }))
await ok('alice confirms a discovered product', () =>
  updateDoc(doc(alice, 'businesses/aliceBiz'), { products: [{ id: 'p1', name: 'Kopi O', ...acceptedStamp }], updatedAt: 4200 }))
await no('acceptance cannot smuggle in a discovery result', () =>
  updateDoc(doc(alice, 'businesses/aliceBiz'), { provenance: { name: acceptedStamp }, discovery: { status: 'complete', pagesAnalysed: 9 } }))
await no('acceptance cannot smuggle in a connected source', () =>
  updateDoc(doc(alice, 'businesses/aliceBiz'), { provenance: { name: acceptedStamp }, sources: [{ id: 'website' }] }))
await no('bob cannot accept alice\'s brain', () =>
  updateDoc(doc(bob, 'businesses/aliceBiz'), { provenance: { name: acceptedStamp } }))

console.log('\n-- CROSS-USER ISOLATION --')
await no('bob reads alice business', () => getDoc(doc(bob, 'businesses/aliceBiz')))
await no('bob updates alice business', () => updateDoc(doc(bob, 'businesses/aliceBiz'), { name: 'X' }))
await no('bob deletes alice business', () => deleteDoc(doc(bob, 'businesses/aliceBiz')))
await no('unscoped business list', () => getDocs(collection(bob, 'businesses')))
await no('bob queries by alice ownerId', () => getDocs(query(collection(bob, 'businesses'), where('ownerId', '==', 'alice'))))
await ok('bob queries by his own ownerId', () => getDocs(query(collection(bob, 'businesses'), where('ownerId', '==', 'bob'))))
await no('bob reads alice profile', () => getDoc(doc(bob, 'users/alice')))
await no('bob writes alice profile', () => updateDoc(doc(bob, 'users/alice'), { displayName: 'X' }))
await no('anon reads a business', () => getDoc(doc(anon, 'businesses/aliceBiz')))
await no('anon creates a business', () => setDoc(doc(anon, 'businesses/anonBiz'), biz('alice')))
await no('anon reads a profile', () => getDoc(doc(anon, 'users/alice')))

console.log('\n-- CONVERSATIONS & MESSAGES --')
await ok('alice reads her conversation', () => getDoc(doc(alice, 'conversations/aliceConv')))
await ok('alice creates a conversation', () => addDoc(collection(alice, 'conversations'), { ownerId: 'alice', businessId: 'aliceBiz', createdAt: 1 }))
await no('alice creates a conversation owned by bob', () => addDoc(collection(alice, 'conversations'), { ownerId: 'bob', createdAt: 1 }))
await ok('alice reads her messages', () => getDocs(collection(alice, 'conversations/aliceConv/messages')))
await ok('alice posts her own user message', () => addDoc(collection(alice, 'conversations/aliceConv/messages'), { ownerId: 'alice', role: 'user', createdAt: 1 }))
await no('alice forges an assistant message', () => addDoc(collection(alice, 'conversations/aliceConv/messages'), { ownerId: 'alice', role: 'assistant', createdAt: 1 }))
await no('alice forges a system message', () => addDoc(collection(alice, 'conversations/aliceConv/messages'), { ownerId: 'alice', role: 'system', createdAt: 1 }))
await no('alice edits a stored message', () => updateDoc(doc(alice, 'conversations/aliceConv/messages/m1'), { plainText: 'edited' }))
// The one messageCount strategy: every message write bumps the thread's
// counter atomically. The client does this for its own user turns, so the
// rules must allow it — for the owner, and only the owner.
await ok('alice bumps her conversation counter atomically', () => updateDoc(doc(alice, 'conversations/aliceConv'), { lastMessagePreview: 'hi', messageCount: increment(1), updatedAt: 2000 }))
await no('bob bumps alice conversation counter', () => updateDoc(doc(bob, 'conversations/aliceConv'), { messageCount: increment(1) }))
await no('bob reads alice messages', () => getDocs(collection(bob, 'conversations/aliceConv/messages')))
await no('bob writes into alice conversation', () => addDoc(collection(bob, 'conversations/aliceConv/messages'), { ownerId: 'bob', role: 'user', createdAt: 1 }))
await no('bob reads alice conversation', () => getDoc(doc(bob, 'conversations/aliceConv')))

console.log('\n-- USERS, OTHER COLLECTIONS, CATCH-ALL --')
await ok('alice reads her profile', () => getDoc(doc(alice, 'users/alice')))
await ok('alice updates her profile', () => updateDoc(doc(alice, 'users/alice'), { displayName: 'Alice' }))
await no('alice deletes her profile', () => deleteDoc(doc(alice, 'users/alice')))
for (const c of ['campaigns', 'creatives', 'calendarItems', 'results']) {
  await ok(`alice reads her ${c}`, () => getDoc(doc(alice, c, 'aliceDoc')))
  await no(`bob reads alice ${c}`, () => getDoc(doc(bob, c, 'aliceDoc')))
}
await no('write to an unmatched collection', () => setDoc(doc(alice, 'secrets/x'), { ownerId: 'alice' }))
await no('read an unmatched collection', () => getDoc(doc(alice, 'secrets/x')))

console.log('\n-- RECOMMENDATIONS (server-written intelligence) --')
await ok('alice reads her recommendation', () => getDoc(doc(alice, 'recommendations/aliceRec')))
await ok('alice lists her recommendations', () => getDocs(query(collection(alice, 'recommendations'), where('ownerId', '==', 'alice'))))
await no('bob reads alice recommendation', () => getDoc(doc(bob, 'recommendations/aliceRec')))
await no('anon reads a recommendation', () => getDoc(doc(anon, 'recommendations/aliceRec')))
await no('alice forges a recommendation', () => setDoc(doc(alice, 'recommendations/forged'), { ownerId: 'alice', createdAt: 1 }))
await no('alice edits a recommendation', () => updateDoc(doc(alice, 'recommendations/aliceRec'), { confidence: 'high' }))
await no('bob deletes alice recommendation', () => deleteDoc(doc(bob, 'recommendations/aliceRec')))
await ok('alice deletes her recommendation', () => deleteDoc(doc(alice, 'recommendations/aliceRec')))

console.log('\n-- CAMPAIGNS (server builds, owner edits) --')
await ok('alice reads her campaign', () => getDoc(doc(alice, 'campaigns/aliceCampaign')))
await ok('alice lists her campaigns', () => getDocs(query(collection(alice, 'campaigns'), where('ownerId', '==', 'alice'))))
await ok('alice edits campaign strategy fields', () => updateDoc(doc(alice, 'campaigns/aliceCampaign'), { name: 'Lunch Rush', keyMessage: 'Set lunch, ready in 10 minutes', userEdited: ['name', 'keyMessage'], updatedAt: 2000 }))
await no('alice rewrites campaign provenance', () => updateDoc(doc(alice, 'campaigns/aliceCampaign'), { sourceRecommendationId: 'otherRec' }))
await no('alice detaches campaign provenance', () => updateDoc(doc(alice, 'campaigns/aliceCampaign'), { sourceRecommendationId: null }))
await no('alice moves campaign to another business', () => updateDoc(doc(alice, 'campaigns/aliceCampaign'), { businessId: 'bobBiz' }))
await no('alice moves campaign to another conversation', () => updateDoc(doc(alice, 'campaigns/aliceCampaign'), { conversationId: 'bobConv' }))
await no('alice rewrites campaign ownerId', () => updateDoc(doc(alice, 'campaigns/aliceCampaign'), { ownerId: 'bob' }))
await no('alice rewrites campaign createdAt', () => updateDoc(doc(alice, 'campaigns/aliceCampaign'), { createdAt: 9999 }))
await ok('alice creates a pristine campaign of her own', () => setDoc(doc(alice, 'campaigns/manualCampaign'), { ownerId: 'alice', businessId: 'aliceBiz', conversationId: null, sourceRecommendationId: null, name: 'Manual', status: 'draft', userEdited: [], createdAt: 1, updatedAt: 1 }))
await no('alice forges built-by-MARKA provenance on create', () => setDoc(doc(alice, 'campaigns/forgedCampaign'), { ownerId: 'alice', sourceRecommendationId: 'aliceRec', name: 'Forged', createdAt: 1 }))
await no('bob reads alice campaign', () => getDoc(doc(bob, 'campaigns/aliceCampaign')))
await no('bob lists alice campaigns', () => getDocs(query(collection(bob, 'campaigns'), where('ownerId', '==', 'alice'))))
await no('bob edits alice campaign', () => updateDoc(doc(bob, 'campaigns/aliceCampaign'), { name: 'X' }))
await no('bob deletes alice campaign', () => deleteDoc(doc(bob, 'campaigns/aliceCampaign')))
await no('anon reads a campaign', () => getDoc(doc(anon, 'campaigns/aliceCampaign')))
await ok('alice deletes her manual campaign', () => deleteDoc(doc(alice, 'campaigns/manualCampaign')))

console.log('\n-- CREATIVES (server creates, owner edits copy) --')
await ok('alice reads her creative', () => getDoc(doc(alice, 'creatives/aliceCreative')))
await ok('alice lists her creatives', () => getDocs(query(collection(alice, 'creatives'), where('ownerId', '==', 'alice'))))
await no('client creates a creative — even the owner, even pristine', () => setDoc(doc(alice, 'creatives/forgedCreative'), { ownerId: 'alice', businessId: 'aliceBiz', campaignId: null, conversationId: null, sourceRecommendationId: null, name: 'Forged', createdAt: 1, updatedAt: 1 }))
await no('client creates a creative with forged provenance', () => setDoc(doc(alice, 'creatives/forgedCreative2'), { ownerId: 'alice', businessId: 'aliceBiz', campaignId: 'aliceCampaign', sourceRecommendationId: 'aliceRec', name: 'Forged', createdAt: 1, updatedAt: 1 }))
await ok('alice edits creative copy fields', () => updateDoc(doc(alice, 'creatives/aliceCreative'), { 'content.headline': 'An honest lunch, done properly', 'captions.facebook': 'New caption', userEdited: ['headline', 'facebookCaption'], updatedAt: 2000 }))
await no('alice repoints the creative at another campaign', () => updateDoc(doc(alice, 'creatives/aliceCreative'), { campaignId: 'otherCampaign' }))
await no('alice detaches creative provenance', () => updateDoc(doc(alice, 'creatives/aliceCreative'), { sourceRecommendationId: null }))
await no('alice moves creative to another business', () => updateDoc(doc(alice, 'creatives/aliceCreative'), { businessId: 'bobBiz' }))
await no('alice moves creative to another conversation', () => updateDoc(doc(alice, 'creatives/aliceCreative'), { conversationId: 'bobConv' }))
await no('alice rewrites the creative image path', () => updateDoc(doc(alice, 'creatives/aliceCreative'), { 'content.image.storagePath': 'businesses/bobBiz/creatives/stolen.png' }))
await no('alice swaps the whole image reference', () => updateDoc(doc(alice, 'creatives/aliceCreative'), { 'content.image': { storagePath: 'elsewhere.png', prompt: null, altText: null, source: 'upload' } }))
await no('alice rewrites creative ownerId', () => updateDoc(doc(alice, 'creatives/aliceCreative'), { ownerId: 'bob' }))
await no('alice rewrites creative createdAt', () => updateDoc(doc(alice, 'creatives/aliceCreative'), { createdAt: 9999 }))
await no('bob reads alice creative', () => getDoc(doc(bob, 'creatives/aliceCreative')))
await no('bob lists alice creatives', () => getDocs(query(collection(bob, 'creatives'), where('ownerId', '==', 'alice'))))
await no('bob edits alice creative', () => updateDoc(doc(bob, 'creatives/aliceCreative'), { 'content.headline': 'X' }))
await no('bob deletes alice creative', () => deleteDoc(doc(bob, 'creatives/aliceCreative')))
await no('anon reads a creative', () => getDoc(doc(anon, 'creatives/aliceCreative')))
await no('anon creates a creative', () => setDoc(doc(anon, 'creatives/anonCreative'), { ownerId: 'alice', createdAt: 1 }))
await ok('alice deletes her creative', () => deleteDoc(doc(alice, 'creatives/aliceCreative')))

console.log(`\n===== RULES: ${pass} passed, ${fail} failed =====`)
await env.cleanup()
process.exit(fail ? 1 : 0)
