/**
 * Phase 7F live smoke test — "okay go design" against the real model.
 *
 * Runs the exact compiled modules the deployed chatAssistantReply uses, in
 * the same order the callable does, with a real OpenAI key and an emulated
 * Firestore + Storage: the decision layer, the executor, the shared creative
 * pipeline and the presentation. It answers the one question the unit
 * suites (which fake the pipeline) cannot: does the go-ahead actually
 * produce the requested posters, persisted and owned?
 *
 * The scenario is the production bug, reproduced: the owner asked for three
 * posters, EVA replied with her plan (the real reply text, Markdown and
 * all), the owner said "okay go design".
 *
 * Prerequisites:
 *   npm run functions:build
 *   export OPENAI_API_KEY="$(npx firebase functions:secrets:access OPENAI_API_KEY --project marka-76fbf | tail -1)"
 *
 * Run (Java ≥ 21 on PATH for the emulators):
 *   FIREBASE_CONFIG='{"projectId":"demo-marka","storageBucket":"demo-marka.appspot.com"}' \
 *   npx firebase emulators:exec --only firestore,storage --project demo-marka \
 *     "node test/smoke/action.smoke.mjs"
 *
 * By default one uploaded photo is seeded, so the posters use it and no
 * image model is called. SMOKE_IMAGE=1 seeds no photo and lets the pipeline
 * generate three visuals (real cost).
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set. This smoke test needs a real key.')
  process.exit(2)
}
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  console.error('Run inside: firebase emulators:exec --only firestore,storage --project demo-marka')
  process.exit(2)
}

const lib = '../../functions/lib/'
const { db, COLLECTIONS, storageBucket } = require(`${lib}lib/firebase.js`)
const { decideChatAction, detectAssistantOffer, extractOfferBrief, pendingProposal } = require(
  `${lib}chat/actions/decide.js`,
)
const { proposeFromOffer, runChatAction } = require(`${lib}chat/actions/execute.js`)

const UID = 'smokeOwner'
const OTHER_UID = 'someoneElse'
const BIZ = 'smokeBiz'
const CONV = 'smokeConv'
const CAMP = 'smokeCamp'
const now = Date.now()

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1
    console.log(`  ✓ ${name}`)
  } else {
    fail += 1
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/* --- fixtures: Matheasy, as in the production thread ------------------- */

const business = {
  ownerId: UID,
  name: 'Matheasy',
  industry: 'education',
  identity: { description: 'A maths learning app for Malaysian primary students, with Numi, an AI tutor.', tagline: null },
  contact: { website: 'https://getmatheasy.com', whatsapp: null, phone: null, email: null },
  location: { city: 'Kuala Lumpur', state: null, area: null },
  products: [
    { name: 'Matheasy app', description: 'Step-by-step maths practice with instant feedback', priceMinor: null, imageUrl: null, isSignature: true },
    { name: 'Numi AI Tutor', description: 'An AI tutor that explains each step', priceMinor: null, imageUrl: null, isSignature: false },
  ],
  audience: { value: { description: 'Parents of primary-school children in Malaysia', segments: [] }, confidence: 'high' },
  brand: { value: { voice: 'Warm, encouraging, clear', personality: [], colours: [], visualStyle: null }, confidence: 'medium' },
  marketing: null,
  operations: null,
  brandKit: {
    logoAssetId: null,
    colors: { primary: '#22c55e', secondary: null, accent: null },
    typography: { heading: null, body: null },
    styleTraits: ['modern', 'friendly'],
    styleNotes: null,
    notes: null,
    updatedAt: now,
  },
  provenance: {},
  sources: [],
  discovery: { status: 'complete', source: null, lastRunAt: now, error: null },
  brainVersion: 1,
  createdAt: now,
  updatedAt: now,
}

const campaign = {
  name: 'Matheasy App Launch',
  objective: 'Get more parents to try the Matheasy app',
  targetAudience: { description: 'Parents of primary-school children in Malaysia', basis: 'known' },
  offer: { description: 'Try the app free', basis: 'recommendation' },
  positioning: 'Maths practice that explains every step',
  keyMessage: 'Your child learns maths step by step, with Numi the AI tutor',
  callToAction: 'Download the app',
  channels: ['facebook', 'instagram'],
  durationDays: 14,
  startDate: null,
  endDate: null,
  notes: null,
  assumptions: [],
  unknowns: [],
  ownerId: UID,
  businessId: BIZ,
  conversationId: CONV,
  sourceRecommendationId: 'smokeRec',
  status: 'ready',
  userEdited: [],
  meta: null,
  createdAt: now,
  updatedAt: now,
}

// A 1x1 PNG: enough for a Storage copy, which is all the photo path needs.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

async function seed() {
  await db.collection(COLLECTIONS.businesses).doc(BIZ).set(business)
  await db.collection(COLLECTIONS.campaigns).doc(CAMP).set(campaign)
  // A campaign that belongs to someone else, to prove it is unreachable.
  await db.collection(COLLECTIONS.campaigns).doc('foreignCamp').set({
    ...campaign,
    name: 'Not Yours',
    ownerId: OTHER_UID,
    businessId: 'otherBiz',
    conversationId: 'otherConv',
  })
  if (!process.env.SMOKE_IMAGE) {
    const storagePath = `businesses/${BIZ}/assets/screenshot.png`
    await storageBucket().file(storagePath).save(PNG, { contentType: 'image/png' })
    await db.collection(COLLECTIONS.assets).doc('smokeShot').set({
      ownerId: UID,
      businessId: BIZ,
      type: 'photo',
      name: 'App screenshot',
      fileName: 'screenshot.png',
      contentType: 'image/png',
      sizeBytes: PNG.length,
      storagePath,
      productId: null,
      description: 'Matheasy app screenshot',
      tags: ['app'],
      source: 'upload',
      status: 'active',
      allowAiUse: true,
      createdAt: now,
      updatedAt: now,
    })
  }
}

/* --- the flow, exactly as the callable runs it -------------------------- */

const EVA_REPLY = [
  "I'll design the 3 posters using your uploaded app screenshots and Matheasy's green **#22c55e** branding:",
  '',
  '1. **English — Introduction**',
  '2. **Bahasa Melayu — Step-by-step learning**',
  '3. **English — Numi AI Tutor**',
  '',
  'All at 1080x1080. Want me to create the 3 posters?',
].join('\n')

async function main() {
  await seed()
  console.log('Phase 7F action smoke — "okay go design"\n')

  // 1. EVA's conversational reply carries an offer → proposal on her turn.
  const offer = detectAssistantOffer(EVA_REPLY)
  check('EVA’s plan is read as an offer for 3 posters', offer?.count === 3, JSON.stringify(offer))
  const ctxBase = { uid: UID, conversationId: CONV, businessId: BIZ, business, language: 'en', text: 'Create 3 posters for the app' }
  const proposal = await proposeFromOffer({ ...offer, brief: extractOfferBrief(EVA_REPLY) }, ctxBase)
  check(
    'the proposal resolves to the thread’s own campaign',
    proposal?.action.kind === 'creative.generate' && proposal.action.campaignId === CAMP,
    JSON.stringify(proposal?.action),
  )
  check('the proposal keeps the owner’s plan as the brief', /Bahasa Melayu/.test(proposal?.action.spec.brief ?? ''))

  const previousAssistant = {
    role: 'assistant',
    blocks: [{ id: 'b0', type: 'text', text: EVA_REPLY }, { ...proposal, id: 'b1' }],
  }
  check('the proposal is pending on EVA’s turn', pendingProposal(previousAssistant) !== null)

  // 2. Chat that must stay chat.
  for (const text of ['What should I post this weekend?', 'Do you think green works for my brand?', 'Tell me about my target customers.']) {
    check(`"${text}" is not an action`, decideChatAction({ text, previousAssistant }).type === 'none')
  }

  // 3. The go-ahead.
  const decision = decideChatAction({ text: 'okay go design', previousAssistant })
  check('"okay go design" confirms the proposal', decision.type === 'confirm', decision.type)
  if (decision.type !== 'confirm') return finish()

  const frames = []
  const started = Date.now()
  const outcome = await runChatAction(decision, {
    ...ctxBase,
    plan: 'basic',
    text: 'okay go design',
    startedAt: started,
    now: Date.now,
    onProgress: (steps) => frames.push(steps),
  })
  const seconds = Math.round((Date.now() - started) / 1000)
  console.log(`\n  (executor finished in ${seconds}s, ${frames.length} progress frames)\n`)

  // 4. Progress is real and SME-readable.
  const first = frames[0] ?? []
  check('progress starts with campaign / brand / assets / concepts done', ['campaign', 'brand', 'assets', 'concepts'].every((key) => first.find((s) => s.key === key)?.state === 'done'))
  check('poster steps go active one at a time', frames.some((f) => f.filter((s) => s.key === 'poster' && s.state === 'active').length === 1))
  const last = frames.at(-1) ?? []
  check('the last frame shows every poster settled', last.filter((s) => s.key === 'poster').every((s) => s.state === 'done' || s.state === 'failed'))

  // 5. The result.
  const set = outcome.blocks.find((b) => b.type === 'creative_set')
  const retry = outcome.blocks.find((b) => b.type === 'action_proposal')
  console.log(`  EVA: ${outcome.plainText.split('\n')[0]}`)
  check('a creative_set block is in the reply', Boolean(set))
  check('all 3 posters were created', set?.items.length === 3 && set.requested === 3, `${set?.items.length} of ${set?.requested}`)
  check('positions are 1, 2, 3 in order', JSON.stringify(set?.items.map((i) => i.position)) === '[1,2,3]')
  check('the reply says it plainly', /Done — I created 3 posters/.test(outcome.plainText), outcome.plainText.split('\n')[0])
  check('no retry offer when nothing failed', !retry)
  check('no Markdown asterisks in the sentence', !outcome.plainText.includes('**'))
  check('no model, token or quota talk in the reply', !/gpt|token|quota|model/i.test(outcome.plainText))

  // 6. Persisted, owned, on the right campaign.
  for (const item of set?.items ?? []) {
    const doc = await db.collection(COLLECTIONS.creatives).doc(item.creativeId).get()
    const data = doc.data()
    check(
      `creative ${item.position} is stored for the owner on the campaign`,
      doc.exists && data.ownerId === UID && data.campaignId === CAMP && data.businessId === BIZ,
    )
    check(`creative ${item.position} has a headline`, typeof item.headline === 'string' && item.headline.length > 0, item.headline)
    if (item.image) {
      const [exists] = await storageBucket().file(item.image.storagePath).exists()
      check(`creative ${item.position} image exists in Storage (${item.image.source})`, exists)
    } else {
      check(`creative ${item.position} has an image`, false, 'image is null')
    }
  }
  const names = set?.items.map((i) => i.name) ?? []
  check('the three posters are distinct', new Set(names).size === names.length, names.join(' | '))
  console.log(`  posters: ${names.join(' | ')}`)
  console.log(`  headlines: ${(set?.items ?? []).map((i) => i.headline).join(' | ')}`)

  // 7. Someone else's campaign is unreachable even by id.
  const foreign = await runChatAction(
    { type: 'confirm', action: { kind: 'creative.generate', campaignId: 'foreignCamp', campaignName: 'Not Yours', spec: { format: 'square_post', brief: null, positions: [1], size: 1 } } },
    { ...ctxBase, plan: 'basic', startedAt: Date.now(), now: Date.now, onProgress: () => {} },
  )
  check('a foreign campaign id is refused without generating', foreign.log.blocked === 'campaign_unavailable' && !foreign.blocks.some((b) => b.type === 'creative_set'))

  // 8. Repeat of the same go-ahead: the proposal is gone, so it is chat.
  const after = { role: 'assistant', blocks: outcome.blocks }
  check('a second "okay go design" after the result is not an action', decideChatAction({ text: 'okay go design', previousAssistant: after }).type === 'none')

  finish()
}

function finish() {
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('smoke crashed:', error)
  process.exit(1)
})
