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

const asset = (ownerId, businessId, over = {}) => ({
  ownerId, businessId, type: 'photo', name: 'Mandhi platter',
  fileName: 'mandhi.jpg', contentType: 'image/jpeg', sizeBytes: 123456,
  storagePath: `businesses/${businessId}/assets/1000_mandhi.jpg`,
  productId: null, description: null, tags: [], source: 'upload',
  status: 'active', allowAiUse: true, createdAt: 1000, updatedAt: 1000, ...over,
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
  await setDoc(doc(db, 'assets/aliceAsset'), asset('alice', 'aliceBiz'))
  await setDoc(doc(db, 'subscriptions/alice'), { ownerId: 'alice', planId: 'pro', status: 'active', updatedAt: 1000 })
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
      image: { storagePath: 'businesses/aliceBiz/creatives/x.png', prompt: null, altText: null, source: 'upload', assetId: 'aliceAsset' },
      layout: 'image_full_bleed',
    },
    captions: { facebook: 'fb', instagram: 'ig', short: 's', whatsapp: null },
    style: { palette: null, headingFont: null, bodyFont: null, logoStoragePath: 'businesses/aliceBiz/creatives/logo.png', logoAssetId: 'aliceLogoAsset' },
    assetIds: ['aliceAsset', 'aliceLogoAsset'],
    render: null, userEdited: [], ownerDirectives: [], imageError: null, meta: null,
    createdAt: 1000, updatedAt: 1000,
  })
  // A creative from before the Assets integration: no assetIds, no logo fields.
  await setDoc(doc(db, 'creatives/aliceLegacyCreative'), {
    ownerId: 'alice', businessId: 'aliceBiz', campaignId: 'aliceCampaign',
    conversationId: 'aliceConv', sourceRecommendationId: 'aliceRec',
    name: 'Legacy Poster', format: 'square_post', status: 'ready',
    content: {
      headline: 'Old but gold', subheadline: null, body: null,
      callToAction: null, offerText: null,
      image: { storagePath: 'businesses/aliceBiz/creatives/old.png', prompt: 'a photo', altText: null, source: 'generated' },
      layout: 'image_full_bleed',
    },
    captions: { facebook: null, instagram: null, short: null, whatsapp: null },
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
await ok('alice creates a pre-onboarding conversation with no business', () => addDoc(collection(alice, 'conversations'), { ownerId: 'alice', businessId: null, createdAt: 1 }))
await no('alice creates a conversation claiming bob business', () => addDoc(collection(alice, 'conversations'), { ownerId: 'alice', businessId: 'bobBiz', createdAt: 1 }))
await no('alice creates a conversation claiming a nonexistent business', () => addDoc(collection(alice, 'conversations'), { ownerId: 'alice', businessId: 'ghostBiz', createdAt: 1 }))
await no('alice creates a conversation owned by bob', () => addDoc(collection(alice, 'conversations'), { ownerId: 'bob', createdAt: 1 }))
await no('alice repoints her conversation at another business', () => updateDoc(doc(alice, 'conversations/aliceConv'), { businessId: 'bobBiz' }))
await no('alice detaches her conversation from its business', () => updateDoc(doc(alice, 'conversations/aliceConv'), { businessId: null }))
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

console.log('\n-- SUBSCRIPTIONS (server-written plan; clients can never self-upgrade) --')
await ok('alice reads her subscription', () => getDoc(doc(alice, 'subscriptions/alice')))
await no('alice upgrades herself to pro', () => setDoc(doc(alice, 'subscriptions/alice'), { ownerId: 'alice', planId: 'pro', status: 'active', updatedAt: 1 }))
await no('alice edits her plan field', () => updateDoc(doc(alice, 'subscriptions/alice'), { planId: 'pro' }))
await no('alice reactivates a subscription', () => updateDoc(doc(alice, 'subscriptions/alice'), { status: 'active' }))
await no('alice deletes her subscription', () => deleteDoc(doc(alice, 'subscriptions/alice')))
await no('bob creates his own subscription', () => setDoc(doc(bob, 'subscriptions/bob'), { ownerId: 'bob', planId: 'pro', status: 'active', updatedAt: 1 }))
await no('bob reads alice subscription', () => getDoc(doc(bob, 'subscriptions/alice')))
await no('bob lists subscriptions', () => getDocs(query(collection(bob, 'subscriptions'), where('ownerId', '==', 'bob'))))
await no('anon reads a subscription', () => getDoc(doc(anon, 'subscriptions/alice')))
await no('anon creates a subscription', () => setDoc(doc(anon, 'subscriptions/mallory'), { ownerId: 'mallory', planId: 'pro', status: 'active', updatedAt: 1 }))

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
// Campaign creation is server-only: no client code path creates one, so even
// a pristine, honestly-owned document is refused.
await no('alice creates a pristine campaign of her own', () => setDoc(doc(alice, 'campaigns/manualCampaign'), { ownerId: 'alice', businessId: 'aliceBiz', conversationId: null, sourceRecommendationId: null, name: 'Manual', status: 'draft', userEdited: [], createdAt: 1, updatedAt: 1 }))
await no('alice forges built-by-MARKA provenance on create', () => setDoc(doc(alice, 'campaigns/forgedCampaign'), { ownerId: 'alice', sourceRecommendationId: 'aliceRec', name: 'Forged', createdAt: 1 }))
await no('bob reads alice campaign', () => getDoc(doc(bob, 'campaigns/aliceCampaign')))
await no('bob lists alice campaigns', () => getDocs(query(collection(bob, 'campaigns'), where('ownerId', '==', 'alice'))))
await no('bob edits alice campaign', () => updateDoc(doc(bob, 'campaigns/aliceCampaign'), { name: 'X' }))
await no('bob deletes alice campaign', () => deleteDoc(doc(bob, 'campaigns/aliceCampaign')))
await no('anon reads a campaign', () => getDoc(doc(anon, 'campaigns/aliceCampaign')))
await ok('alice deletes her own campaign', () => deleteDoc(doc(alice, 'campaigns/aliceDoc')))

console.log('\n-- CALENDAR ITEMS (feature does not exist; writes closed) --')
await no('alice creates a calendar item', () => setDoc(doc(alice, 'calendarItems/newItem'), { ownerId: 'alice', title: 'Post', createdAt: 1 }))
await no('alice edits her stored calendar item', () => updateDoc(doc(alice, 'calendarItems/aliceDoc'), { title: 'Changed' }))
await no('alice deletes her stored calendar item', () => deleteDoc(doc(alice, 'calendarItems/aliceDoc')))
await no('anon creates a calendar item', () => setDoc(doc(anon, 'calendarItems/anonItem'), { ownerId: 'alice', createdAt: 1 }))

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
await no('alice repoints content.image.assetId at another asset', () => updateDoc(doc(alice, 'creatives/aliceCreative'), { 'content.image.assetId': 'bobAsset' }))
await no('alice empties the asset provenance list', () => updateDoc(doc(alice, 'creatives/aliceCreative'), { assetIds: [] }))
await no('alice injects another business asset into provenance', () => updateDoc(doc(alice, 'creatives/aliceCreative'), { assetIds: ['aliceAsset', 'aliceLogoAsset', 'bobAsset'] }))
await no('alice changes the logo asset provenance', () => updateDoc(doc(alice, 'creatives/aliceCreative'), { 'style.logoAssetId': 'bobAsset' }))
await no('alice detaches the logo snapshot', () => updateDoc(doc(alice, 'creatives/aliceCreative'), { 'style.logoStoragePath': null, 'style.logoAssetId': null }))
await ok('alice edits style palette while the logo snapshot stands', () => updateDoc(doc(alice, 'creatives/aliceCreative'), { 'style.palette': ['#C2410C'], updatedAt: 2100 }))
await ok('legacy creative without asset fields still accepts copy edits', () => updateDoc(doc(alice, 'creatives/aliceLegacyCreative'), { 'content.headline': 'Still editable', updatedAt: 2200 }))
await no('client backfills assetIds on a legacy creative', () => updateDoc(doc(alice, 'creatives/aliceLegacyCreative'), { assetIds: ['aliceAsset'] }))
await no('client backfills a logo snapshot on a legacy creative', () => updateDoc(doc(alice, 'creatives/aliceLegacyCreative'), { 'style.logoAssetId': 'aliceLogoAsset', 'style.logoStoragePath': 'businesses/aliceBiz/creatives/logo.png' }))
await no('alice rewrites creative ownerId', () => updateDoc(doc(alice, 'creatives/aliceCreative'), { ownerId: 'bob' }))
await no('alice rewrites creative createdAt', () => updateDoc(doc(alice, 'creatives/aliceCreative'), { createdAt: 9999 }))
await no('bob reads alice creative', () => getDoc(doc(bob, 'creatives/aliceCreative')))
await no('bob lists alice creatives', () => getDocs(query(collection(bob, 'creatives'), where('ownerId', '==', 'alice'))))
await no('bob edits alice creative', () => updateDoc(doc(bob, 'creatives/aliceCreative'), { 'content.headline': 'X' }))
await no('bob deletes alice creative', () => deleteDoc(doc(bob, 'creatives/aliceCreative')))
await no('anon reads a creative', () => getDoc(doc(anon, 'creatives/aliceCreative')))
await no('anon creates a creative', () => setDoc(doc(anon, 'creatives/anonCreative'), { ownerId: 'alice', createdAt: 1 }))
await ok('alice deletes her creative', () => deleteDoc(doc(alice, 'creatives/aliceCreative')))

console.log('\n-- ASSETS (owner uploads; file identity frozen) --')
await ok('alice reads her asset', () => getDoc(doc(alice, 'assets/aliceAsset')))
await ok('alice lists her assets', () => getDocs(query(collection(alice, 'assets'), where('ownerId', '==', 'alice'))))
await ok('alice creates an asset in her business assets folder', () => setDoc(doc(alice, 'assets/newAsset'), asset('alice', 'aliceBiz')))
await no('create pointing outside the assets folder', () => setDoc(doc(alice, 'assets/badPath1'), asset('alice', 'aliceBiz', { storagePath: 'businesses/aliceBiz/creatives/stolen.png' })))
await no('create pointing at another business\'s assets folder', () => setDoc(doc(alice, 'assets/badPath2'), asset('alice', 'aliceBiz', { storagePath: 'businesses/bobBiz/assets/theirs.jpg' })))
await no('create with a path outside businesses entirely', () => setDoc(doc(alice, 'assets/badPath3'), asset('alice', 'aliceBiz', { storagePath: 'other/place.jpg' })))
await no('create owned by someone else', () => setDoc(doc(alice, 'assets/forgedAsset'), asset('bob', 'bobBiz')))
// The Phase 6A regression: a *consistent* forged claim on someone else's
// business. bob authenticates as himself, owns a real business of his own,
// and writes an asset document whose ownerId is honestly his — but whose
// businessId is alice's, with a storagePath that matches that businessId
// exactly. Before the ownership lookup this passed every shape check and
// created a pointer into alice's files that bob could then feed to EVA.
await no('bob forges an asset claiming alice\'s business with a path-consistent storagePath', () => setDoc(doc(bob, 'assets/exfil1'), asset('bob', 'aliceBiz')))
await no('bob forges the same claim with a mismatched storagePath', () => setDoc(doc(bob, 'assets/exfil2'), asset('bob', 'aliceBiz', { storagePath: 'businesses/bobBiz/assets/1000_mandhi.jpg' })))
await no('create claiming a business that does not exist', () => setDoc(doc(alice, 'assets/ghostBiz'), asset('alice', 'ghostBiz')))
await no('anon creates an asset', () => setDoc(doc(anon, 'assets/anonAsset'), asset('alice', 'aliceBiz')))
await ok('bob creates an asset in his own business', () => setDoc(doc(bob, 'assets/bobOwnAsset'), asset('bob', 'bobBiz')))
await ok('alice edits asset metadata', () => updateDoc(doc(alice, 'assets/aliceAsset'), { name: 'Chicken mandhi', description: 'Our signature dish', tags: ['mandhi', 'chicken'], type: 'product', productId: 'p1', allowAiUse: false, updatedAt: 2000 }))
await ok('alice archives her asset', () => updateDoc(doc(alice, 'assets/aliceAsset'), { status: 'archived', updatedAt: 2100 }))
await ok('alice restores her asset', () => updateDoc(doc(alice, 'assets/aliceAsset'), { status: 'active', updatedAt: 2200 }))
await no('alice rewrites asset ownerId', () => updateDoc(doc(alice, 'assets/aliceAsset'), { ownerId: 'bob' }))
await no('alice rewrites asset createdAt', () => updateDoc(doc(alice, 'assets/aliceAsset'), { createdAt: 9999 }))
await no('alice repoints the asset storagePath', () => updateDoc(doc(alice, 'assets/aliceAsset'), { storagePath: 'businesses/aliceBiz/assets/other.jpg' }))
await no('alice moves the asset to another business', () => updateDoc(doc(alice, 'assets/aliceAsset'), { businessId: 'bobBiz' }))
await no('alice rewrites the asset fileName', () => updateDoc(doc(alice, 'assets/aliceAsset'), { fileName: 'other.jpg' }))
await no('alice rewrites the asset contentType', () => updateDoc(doc(alice, 'assets/aliceAsset'), { contentType: 'application/pdf' }))
await no('alice rewrites the asset sizeBytes', () => updateDoc(doc(alice, 'assets/aliceAsset'), { sizeBytes: 1 }))
await no('alice rewrites the asset source', () => updateDoc(doc(alice, 'assets/aliceAsset'), { source: 'website' }))
await no('bob reads alice asset', () => getDoc(doc(bob, 'assets/aliceAsset')))
await no('bob lists alice assets', () => getDocs(query(collection(bob, 'assets'), where('ownerId', '==', 'alice'))))
await no('bob edits alice asset', () => updateDoc(doc(bob, 'assets/aliceAsset'), { name: 'X' }))
await no('bob deletes alice asset', () => deleteDoc(doc(bob, 'assets/aliceAsset')))
await no('anon reads an asset', () => getDoc(doc(anon, 'assets/aliceAsset')))
await ok('alice deletes her asset', () => deleteDoc(doc(alice, 'assets/newAsset')))

console.log('\n-- CHAT ATTACHMENTS (conversation-scoped; identity frozen) --')
// Fresh fixtures: a seeded attachment for the freeze tests, and Assets with
// known flags (aliceAsset was flipped to allowAiUse:false above, which the
// negative test below relies on).
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'assets/chatRefAsset'), asset('alice', 'aliceBiz', { storagePath: 'businesses/aliceBiz/assets/2000_ref.png', contentType: 'image/png', fileName: 'ref.png' }))
  await setDoc(doc(db, 'assets/bobChatAsset'), asset('bob', 'bobBiz'))
  await setDoc(doc(db, 'assets/archivedAsset'), asset('alice', 'aliceBiz', { status: 'archived', storagePath: 'businesses/aliceBiz/assets/3000_old.png', contentType: 'image/png', fileName: 'old.png' }))
  await setDoc(doc(db, 'conversations/aliceConv/attachments/attSeed'), {
    ownerId: 'alice', businessId: 'aliceBiz', conversationId: 'aliceConv', messageId: 'm1',
    fileName: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 2048,
    storagePath: 'businesses/aliceBiz/conversations/aliceConv/attachments/attSeed_photo.jpg',
    source: 'upload', status: 'active', assetId: null, createdAt: 1000,
  })
})

const chatAtt = (over = {}) => ({
  ownerId: 'alice', businessId: 'aliceBiz', conversationId: 'aliceConv', messageId: 'm1',
  fileName: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 2048,
  storagePath: 'businesses/aliceBiz/conversations/aliceConv/attachments/a1_photo.jpg',
  source: 'upload', status: 'active', assetId: null, createdAt: 1000, ...over,
})

await ok('alice reads her attachments', () => getDocs(collection(alice, 'conversations/aliceConv/attachments')))
await ok('alice creates a valid upload attachment', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/a1'), chatAtt()))
await ok('upload at exactly 10 MiB is accepted', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/a2'), chatAtt({ sizeBytes: 10485760, storagePath: 'businesses/aliceBiz/conversations/aliceConv/attachments/a2_photo.jpg' })))
await no('upload one byte over 10 MiB', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/big'), chatAtt({ sizeBytes: 10485761 })))
await no('upload with zero bytes', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/empty'), chatAtt({ sizeBytes: 0 })))
await no('upload with an SVG content type', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/svg'), chatAtt({ contentType: 'image/svg+xml' })))
await no('upload with an unsupported content type', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/gif'), chatAtt({ contentType: 'image/gif' })))
await no('create claiming another conversation in its body', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/wrongConv'), chatAtt({ conversationId: 'bobConv' })))
await no('create already soft-deleted', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/dead'), chatAtt({ status: 'deleted' })))
await no('create owned by someone else', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/forged'), chatAtt({ ownerId: 'bob' })))
await no('upload path forged into the Assets namespace', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/stolen1'), chatAtt({ storagePath: 'businesses/aliceBiz/assets/1000_mandhi.jpg' })))
await no('upload path forged into another conversation', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/stolen2'), chatAtt({ storagePath: 'businesses/aliceBiz/conversations/bobConv/attachments/x.jpg' })))
await no('upload claiming a business alice does not own', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/stolen3'), chatAtt({ businessId: 'bobBiz', storagePath: 'businesses/bobBiz/conversations/aliceConv/attachments/x.jpg' })))
await no('upload carrying an assetId', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/mixed'), chatAtt({ assetId: 'chatRefAsset' })))
await ok('asset reference to her own eligible Asset', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/ref1'), chatAtt({ source: 'asset', assetId: 'chatRefAsset', contentType: 'image/png', fileName: 'ref.png', storagePath: 'businesses/aliceBiz/assets/2000_ref.png' })))
await no('asset reference with a storagePath that is not that Asset\'s', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/refBadPath'), chatAtt({ source: 'asset', assetId: 'chatRefAsset', storagePath: 'businesses/aliceBiz/assets/other.png' })))
await no('asset reference to an Asset with EVA use turned off', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/refNoAi'), chatAtt({ source: 'asset', assetId: 'aliceAsset', storagePath: 'businesses/aliceBiz/assets/1000_mandhi.jpg' })))
await no('asset reference to bob\'s Asset', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/refTheirs'), chatAtt({ source: 'asset', assetId: 'bobChatAsset', storagePath: 'businesses/bobBiz/assets/1000_mandhi.jpg' })))
await no('asset reference to an archived Asset', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/refArchived'), chatAtt({ source: 'asset', assetId: 'archivedAsset', contentType: 'image/png', fileName: 'old.png', storagePath: 'businesses/aliceBiz/assets/3000_old.png' })))
await no('asset reference without an assetId', () => setDoc(doc(alice, 'conversations/aliceConv/attachments/refNull'), chatAtt({ source: 'asset' })))
await ok('alice soft-deletes her attachment', () => updateDoc(doc(alice, 'conversations/aliceConv/attachments/attSeed'), { status: 'deleted' }))
await no('alice repoints the attachment storagePath', () => updateDoc(doc(alice, 'conversations/aliceConv/attachments/attSeed'), { storagePath: 'businesses/aliceBiz/assets/1000_mandhi.jpg' }))
await no('alice rewrites the attachment fileName', () => updateDoc(doc(alice, 'conversations/aliceConv/attachments/attSeed'), { fileName: 'other.jpg' }))
await no('alice rewrites the attachment contentType', () => updateDoc(doc(alice, 'conversations/aliceConv/attachments/attSeed'), { contentType: 'application/pdf' }))
await no('alice rewrites the attachment sizeBytes', () => updateDoc(doc(alice, 'conversations/aliceConv/attachments/attSeed'), { sizeBytes: 1 }))
await no('alice rewrites the attachment messageId', () => updateDoc(doc(alice, 'conversations/aliceConv/attachments/attSeed'), { messageId: 'm2' }))
await no('alice rewrites the attachment source', () => updateDoc(doc(alice, 'conversations/aliceConv/attachments/attSeed'), { source: 'asset' }))
await no('alice self-serves an assetId on the document', () => updateDoc(doc(alice, 'conversations/aliceConv/attachments/attSeed'), { assetId: 'chatRefAsset' }))
await no('alice rewrites the attachment ownerId', () => updateDoc(doc(alice, 'conversations/aliceConv/attachments/attSeed'), { ownerId: 'bob' }))
await no('alice moves the attachment to another business', () => updateDoc(doc(alice, 'conversations/aliceConv/attachments/attSeed'), { businessId: 'bobBiz' }))
await no('alice rewrites the attachment createdAt', () => updateDoc(doc(alice, 'conversations/aliceConv/attachments/attSeed'), { createdAt: 9999 }))
await no('bob reads alice attachments', () => getDocs(collection(bob, 'conversations/aliceConv/attachments')))
await no('bob reads one alice attachment', () => getDoc(doc(bob, 'conversations/aliceConv/attachments/attSeed')))
await no('bob creates an attachment in alice conversation', () => setDoc(doc(bob, 'conversations/aliceConv/attachments/intruder'), chatAtt({ ownerId: 'bob' })))
await no('bob updates alice attachment', () => updateDoc(doc(bob, 'conversations/aliceConv/attachments/attSeed'), { status: 'deleted' }))
await no('bob deletes alice attachment', () => deleteDoc(doc(bob, 'conversations/aliceConv/attachments/attSeed')))
await no('anon reads an attachment', () => getDoc(doc(anon, 'conversations/aliceConv/attachments/attSeed')))
await ok('alice deletes her attachment document', () => deleteDoc(doc(alice, 'conversations/aliceConv/attachments/a1')))

console.log('\n-- RESULTS (backend ingestion only; clients can never fabricate metrics) --')
// The seeded results/aliceDoc above was written with rules disabled — the
// Admin SDK path backend ingestion will use. Clients may read and delete
// their own, and never create or edit.
await ok('alice reads her result', () => getDoc(doc(alice, 'results/aliceDoc')))
await no('alice creates a result for herself', () => setDoc(doc(alice, 'results/forgedResult'), { ownerId: 'alice', impressions: 999999, createdAt: 1 }))
await no('alice edits her stored result', () => updateDoc(doc(alice, 'results/aliceDoc'), { impressions: 999999 }))
await no('bob creates a result claiming alice', () => setDoc(doc(bob, 'results/forgedResult2'), { ownerId: 'alice', createdAt: 1 }))
await no('bob creates a result for himself', () => setDoc(doc(bob, 'results/bobResult'), { ownerId: 'bob', createdAt: 1 }))
await no('anon creates a result', () => setDoc(doc(anon, 'results/anonResult'), { ownerId: 'alice', createdAt: 1 }))
await no('bob deletes alice result', () => deleteDoc(doc(bob, 'results/aliceDoc')))
// Results are the append-only record future recommendations are judged
// against; deletion is closed to clients along with the other writes.
await no('alice deletes her result', () => deleteDoc(doc(alice, 'results/aliceDoc')))

console.log('\n-- USAGE (Phase 6B guardrail ledger; server-only in BOTH directions) --')
// Seeded the way the Admin SDK writes it. Clients never read usage — showing
// remaining quota would hand abusers a precise probe of the limits — and a
// client write would mint quota, so both directions are a flat deny.
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'usage/alice_2026-09-04'), {
    ownerId: 'alice', period: '2026-09-04', plan: 'basic',
    requests: { chat: 3, websiteAnalysis: 0, aiGeneration: 1, imageGeneration: 0 },
    inputTokens: 1200, outputTokens: 300, cachedInputTokens: 0,
    imageInputTokens: 0, imageOutputTokens: 0, imagesGenerated: 0,
    reservedInputTokens: 0, reservedOutputTokens: 0, reservedCostUsd: 0,
    estimatedCostUsd: 0.0006, inflight: 0, lastReserveAt: 1000,
    createdAt: 1000, updatedAt: 1000,
  })
})
await no('alice reads her own usage document', () => getDoc(doc(alice, 'usage/alice_2026-09-04')))
await no('alice zeroes her own usage counters', () => updateDoc(doc(alice, 'usage/alice_2026-09-04'), { requests: { chat: 0, websiteAnalysis: 0, aiGeneration: 0, imageGeneration: 0 } }))
await no('alice pre-creates tomorrow\'s usage document', () => setDoc(doc(alice, 'usage/alice_2026-09-05'), { ownerId: 'alice', period: '2026-09-05', requests: { chat: 0 }, createdAt: 1 }))
await no('alice deletes her usage document', () => deleteDoc(doc(alice, 'usage/alice_2026-09-04')))
await no('alice lists usage even scoped to herself', () => getDocs(query(collection(alice, 'usage'), where('ownerId', '==', 'alice'))))
await no('bob reads alice usage', () => getDoc(doc(bob, 'usage/alice_2026-09-04')))
await no('anon reads a usage document', () => getDoc(doc(anon, 'usage/alice_2026-09-04')))

console.log(`\n===== RULES: ${pass} passed, ${fail} failed =====`)
await env.cleanup()
process.exit(fail ? 1 : 0)
