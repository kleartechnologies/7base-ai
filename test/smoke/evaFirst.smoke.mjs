/**
 * Phase 7K live flow smoke — the EVA-first conversations, end to end.
 *
 * Runs the compiled modules the deployed `chatAssistantReply` uses, in the
 * order the callable uses them, against a real (emulated) Firestore holding
 * real business, campaign and asset documents. It answers what the unit
 * suites cannot: given the owner's actual records, does an owner's own
 * sentence reach one confirmable proposal — and does EVA stay quiet when
 * she already knows the answer?
 *
 * Deliberately no model call. Everything 7J decides — intent, campaign
 * reuse, the choice between several, asset selection, the proposal wording —
 * is deterministic by design (§21: no new classifier), so this whole file
 * runs when the OpenAI balance is empty, which is exactly when it is most
 * useful. The copy and image calls that *do* need the model are covered by
 * `action.smoke.mjs`.
 *
 * Prerequisites:
 *   npm run functions:build
 *
 * Run (Java >= 21 on PATH for the emulators):
 *   FIREBASE_CONFIG='{"projectId":"demo-marka","storageBucket":"demo-marka.appspot.com"}' \
 *   npx firebase emulators:exec --only firestore,storage --project demo-marka \
 *     "node test/smoke/evaFirst.smoke.mjs"
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Run inside: firebase emulators:exec --only firestore,storage --project demo-marka')
  process.exit(2)
}

const lib = '../../functions/lib/'
const { db, COLLECTIONS } = require(`${lib}lib/firebase.js`)
const { decideChatAction, parseCreativeRequest, readAffirmation, readChoice } = require(
  `${lib}chat/actions/decide.js`,
)
const { proposeFromRecommendation, runChatAction } = require(`${lib}chat/actions/execute.js`)
const { detectCreativeEdit, mentionsCreative, mentionsCampaignConcept, detectIntent } = require(
  `${lib}marketing/intent.js`,
)
const { selectCreativeAsset, selectLogoAsset } = require(`${lib}creative/assets.js`)
const { readBrandKit } = require(`${lib}creative/brand.js`)

const UID = 'k7Owner'
const OTHER = 'k7Stranger'
const BIZ = 'k7Biz'
const now = Date.now()

let pass = 0
let fail = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1
    console.log(`  ✓ ${name}`)
  } else {
    fail += 1
    failures.push(name)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function section(title) {
  console.log(`\n${title}`)
}

/* --- fixtures: a warung with a real Business Brain --------------------- */

const business = {
  ownerId: UID,
  name: 'Warung Pak Din',
  industry: 'restaurant',
  identity: {
    description: 'Home-style Malay food, cooked fresh daily, in a shoplot near the office towers.',
    tagline: 'Masakan rumah, setiap hari',
  },
  contact: { website: null, whatsapp: '+60123456789', phone: null, email: null },
  location: { city: 'Shah Alam', state: 'Selangor', area: 'Seksyen 13' },
  products: [
    { name: 'Nasi lemak ayam berempah', description: 'Signature nasi lemak', priceMinor: 1200, imageUrl: null, isSignature: true },
    { name: 'Set lunch weekday', description: 'Rice, one dish, drink', priceMinor: 1500, imageUrl: null, isSignature: false },
  ],
  audience: { value: { description: 'Office workers nearby', segments: [] }, confidence: 'high' },
  brand: { value: { voice: 'Warm, plain-spoken', personality: [], colours: [], visualStyle: null }, confidence: 'medium' },
  marketing: { value: { promotions: ['Weekday set lunch RM15'], callsToAction: ['Order on WhatsApp'] }, confidence: 'medium' },
  operations: null,
  brandKit: {
    logoAssetId: 'k7Logo',
    colors: { primary: '#c2410c', secondary: '#0f172a', accent: '#fdba74' },
    typography: { heading: null, body: null },
    styleTraits: ['warm', 'honest'],
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

function campaign(overrides) {
  return {
    name: 'Weekday lunch',
    objective: 'Fill the weekday lunch hour',
    targetAudience: { description: 'Office workers nearby', basis: 'known' },
    offer: { description: 'Set lunch RM15', basis: 'existing' },
    positioning: 'The honest lunch two minutes away',
    keyMessage: 'Lunch without the wait',
    callToAction: 'Order on WhatsApp',
    channels: ['instagram', 'whatsapp'],
    durationDays: 14,
    startDate: null,
    endDate: null,
    notes: null,
    assumptions: [],
    unknowns: [],
    ownerId: UID,
    businessId: BIZ,
    conversationId: null,
    sourceRecommendationId: null,
    status: 'ready',
    userEdited: [],
    meta: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function asset(overrides) {
  return {
    ownerId: UID,
    businessId: BIZ,
    type: 'photo',
    name: 'Nasi lemak plate',
    fileName: 'nasi.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 400_000,
    storagePath: `businesses/${BIZ}/assets/nasi.jpg`,
    productId: null,
    description: null,
    tags: [],
    source: 'upload',
    status: 'active',
    allowAiUse: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const recommendation = {
  ownerId: UID,
  businessId: BIZ,
  conversationId: 'k7Conv',
  title: 'Promote the weekday set lunch to nearby offices',
  nextAction: 'build_campaign',
  createdAt: now,
}

async function reset(campaigns) {
  for (const collection of [COLLECTIONS.campaigns, COLLECTIONS.assets]) {
    const existing = await db.collection(collection).where('ownerId', 'in', [UID, OTHER]).get()
    await Promise.all(existing.docs.map((doc) => doc.ref.delete()))
  }
  for (const [id, doc] of Object.entries(campaigns ?? {})) {
    await db.collection(COLLECTIONS.campaigns).doc(id).set(doc)
  }
}

const ctx = (over = {}) => ({
  uid: UID,
  plan: 'basic',
  conversationId: 'k7Conv',
  businessId: BIZ,
  business,
  language: 'en',
  text: '',
  startedAt: Date.now(),
  now: () => Date.now(),
  onProgress: () => {},
  ...over,
})

/* --- Part 2: the owner's own sentences --------------------------------- */

async function part2() {
  section('PART 2 — real EVA-first conversations')

  // A. A goal, not a poster order: it must not be mistaken for one, and the
  //    recommendation it produces must carry a single build-it-all proposal.
  for (const [label, text, language] of [
    ['A/EN', 'I want to promote our weekday lunch.', 'en'],
    ['A/BM', 'Saya nak promosikan lunch weekday kami.', 'ms'],
  ]) {
    const decision = decideChatAction({ text, previousAssistant: null })
    check(`${label} a goal is not read as a poster order`, decision.type === 'none', decision.type)
    check(`${label} the goal is read as marketing intent`, detectIntent(text) !== 'other', detectIntent(text))

    await reset()
    const fresh = await proposeFromRecommendation(
      { recommendationId: 'k7Rec', title: recommendation.title, nextAction: 'build_campaign', brief: text },
      ctx({ text, language }),
    )
    check(`${label} one proposal covers campaign and posters`, fresh?.proposal.action.kind === 'campaign.build', fresh?.proposal.action.kind)
    check(`${label} the proposal leads with a plain sentence`, typeof fresh?.lead.text === 'string' && fresh.lead.text.length > 0)
    check(
      `${label} the lead says nothing about pipelines or execution`,
      !/execute|pipeline|orchestrat|workflow|classif|campaignBuild/i.test(`${fresh?.lead.text} ${fresh?.proposal.summary ?? ''}`),
      fresh?.lead.text,
    )
    check(
      `${label} the set is three posters, decided without asking`,
      fresh?.proposal.action.then?.size === 3,
      String(fresh?.proposal.action.then?.size),
    )

    // The same goal, once a campaign already exists in this thread: reuse.
    await reset({ k7Camp: campaign({ conversationId: 'k7Conv' }) })
    const reused = await proposeFromRecommendation(
      { recommendationId: 'k7Rec', title: recommendation.title, nextAction: 'build_campaign', brief: text },
      ctx({ text, language }),
    )
    check(
      `${label} an open campaign in the thread is reused, not duplicated`,
      reused?.proposal.action.kind === 'creative.generate' && reused.proposal.action.campaignId === 'k7Camp',
      reused?.proposal.action.kind,
    )
  }

  // B. A creative request that names the platform and the subject.
  //    "an Instagram poster" says one; "poster Instagram" says nothing about
  //    how many, and a silent count of one would be EVA deciding for them.
  for (const [label, text, wanted] of [
    ['B/EN', 'I want to make an Instagram poster for our new offer.', 1],
    ['B/BM', 'Saya nak buat poster Instagram untuk promo baru kami.', null],
  ]) {
    const decision = decideChatAction({ text, previousAssistant: null })
    check(`${label} read as a creative request`, decision.type === 'creative_request', decision.type)
    check(
      `${label} the count is taken from the owner, or left open`,
      decision.countStated === (wanted !== null),
      `countStated=${decision.countStated}`,
    )
    if (wanted) check(`${label} one poster asked for, one poster planned`, decision.spec.size === wanted, String(decision.spec.size))
    check(`${label} the owner's words are kept as the brief`, Boolean(decision.spec?.brief))
  }

  // C. A follow-up that must not restart anything.
  for (const [label, text] of [
    ['C/EN', 'Create another poster like this.'],
    ['C/BM', 'Buat satu lagi poster macam ni.'],
  ]) {
    const decision = decideChatAction({ text, previousAssistant: null })
    check(`${label} read as a creative request, not a new campaign`, decision.type === 'creative_request', decision.type)
    await reset({ k7Camp: campaign({ conversationId: 'k7Conv' }) })
    const outcome = await runChatAction(decision, ctx({ text }), stubDeps())
    check(
      `${label} it lands on the campaign already in the thread`,
      outcome.log.campaignId === 'k7Camp' || /Weekday lunch/.test(outcome.plainText),
      JSON.stringify(outcome.log),
    )
  }

  // D. An edit is an edit: it must not become a campaign or a new set.
  for (const [label, text] of [
    ['D/EN', 'Change the headline to something more urgent.'],
    ['D/BM', 'Tukar headline supaya lebih urgent.'],
  ]) {
    check(`${label} read as a creative edit`, detectCreativeEdit(text), 'not detected')
    check(`${label} it names the creative, so it edits the poster not the campaign`, mentionsCreative(text))
    check(
      `${label} it is not routed to the campaign editor`,
      !(mentionsCampaignConcept(text) && !mentionsCreative(text)),
    )
    check(
      `${label} it does not order a new set`,
      decideChatAction({ text, previousAssistant: null }).type === 'none',
    )
  }

  // E. The go-ahead, in both languages, on a real pending proposal.
  await reset({ k7Camp: campaign({ conversationId: 'k7Conv' }) })
  for (const [label, text] of [
    ['E/EN', 'Yes, do it.'],
    ['E/BM', 'Ya, buat.'],
    ['E/Manglish', 'ok boleh la'],
  ]) {
    check(`${label} reads as a go-ahead`, readAffirmation(text) === 'yes', readAffirmation(text))
  }
  for (const [label, text] of [
    ['E/EN hesitation', 'Yes but not the third one'],
    ['E/BM hesitation', 'Boleh tapi tunggu dulu'],
  ]) {
    check(`${label} is not a go-ahead`, readAffirmation(text) !== 'yes', readAffirmation(text))
  }
}

/* --- Part 3: only ask when the answer changes the result ---------------- */

async function part3() {
  section('PART 3 — ambiguity')

  // 1. Several live campaigns and a message that names none.
  await reset({
    k7A: campaign({ name: 'Weekday lunch' }),
    k7B: campaign({ name: 'Raya open house', keyMessage: 'Open house every weekend' }),
  })
  const many = await runChatAction(
    decideChatAction({ text: 'Make 3 posters', previousAssistant: null }),
    ctx({ text: 'Make 3 posters' }),
    stubDeps(),
  )
  const chooseBlock = many.blocks.find((b) => b.type === 'action_proposal')
  check('several campaigns produce one choice, not a guess', chooseBlock?.action.kind === 'campaign.choose', chooseBlock?.action.kind)
  check('both campaign names are offered', chooseBlock?.action.choices?.length === 2)
  check(
    'the question is asked once, in prose',
    (many.plainText.match(/\?/g) ?? []).length === 1,
    many.plainText,
  )
  check(
    'the prose does not also list the names the buttons carry',
    !/Weekday lunch/.test(many.plainText) && !/Raya open house/.test(many.plainText),
    many.plainText,
  )

  // The owner answers by name; the id is never taken from the client.
  const picked = decideChatAction({
    text: 'Use Raya open house',
    previousAssistant: { role: 'assistant', blocks: [chooseBlock] },
  })
  check('answering by name resolves to that campaign', picked.type === 'choose' && picked.action.campaignName === 'Raya open house', picked.type)
  check(
    'the resolved id came from the server-built choice list',
    picked.action?.campaignId === 'k7B',
    picked.action?.campaignId,
  )
  const vague = decideChatAction({
    text: 'yes',
    previousAssistant: { role: 'assistant', blocks: [chooseBlock] },
  })
  check('a bare yes to a choice asks again rather than picking one', vague.type === 'reask_choice', vague.type)

  // 2/3. One live campaign: silent reuse, no question at all.
  await reset({ k7A: campaign({ name: 'Weekday lunch' }) })
  const one = await runChatAction(
    decideChatAction({ text: 'Make 3 posters', previousAssistant: null }),
    ctx({ text: 'Make 3 posters' }),
    stubDeps(),
  )
  check('a single campaign is reused silently', one.log.action === 'creative.generate', JSON.stringify(one.log))
  check('nothing is asked', !one.plainText.includes('?'), one.plainText)

  // 4. Assets: the strongest is chosen in code, never put to the owner.
  const assets = [
    { id: 'k7Logo', asset: asset({ type: 'logo', name: 'Warung logo' }) },
    { id: 'k7Nasi', asset: asset({ name: 'Nasi lemak ayam berempah plate', tags: ['nasi lemak'] }) },
    { id: 'k7Lunch', asset: asset({ name: 'Set lunch weekday tray', tags: ['set lunch'] }) },
    { id: 'k7Menu', asset: asset({ type: 'menu', name: 'Menu board', contentType: 'application/pdf' }) },
  ]
  const chosen = selectCreativeAsset(assets, campaign(), business.products, {})
  check('the relevant photo is chosen without asking', chosen?.id === 'k7Nasi', chosen?.id)
  check('a PDF menu is never chosen as a poster picture', chosen?.asset.contentType !== 'application/pdf')
  const logo = selectLogoAsset(assets, readBrandKit(business)?.logoAssetId ?? null)
  check('the Brand Identity logo outranks the heuristic', logo?.id === 'k7Logo', logo?.id)
  const second = selectCreativeAsset(assets, campaign(), business.products, { avoidAssetIds: ['k7Nasi'] })
  check('a sibling poster is steered off the asset already used', second?.id === 'k7Lunch', second?.id)
  const onlyOne = selectCreativeAsset(
    [assets[0], assets[1], assets[3]],
    campaign(),
    business.products,
    { avoidAssetIds: ['k7Nasi'] },
  )
  check(
    'with nothing else usable it reuses the good photo rather than a logo',
    onlyOne?.id === 'k7Nasi',
    onlyOne?.id,
  )

  // 5. No Brand Identity: generation still proceeds; nothing is blocked.
  const plain = { ...business, brandKit: null, brand: null }
  check('a business with no Brand Identity still has no blocking gate', readBrandKit(plain) === null)
  await reset({ k7A: campaign({ name: 'Weekday lunch' }) })
  const unbranded = await runChatAction(
    decideChatAction({ text: 'Make 3 posters', previousAssistant: null }),
    ctx({ text: 'Make 3 posters', business: plain }),
    stubDeps(),
  )
  check('posters are still produced without a Brand Identity', unbranded.log.action === 'creative.generate', JSON.stringify(unbranded.log))
  const note = unbranded.plainText.toLowerCase().indexOf('brand identity')
  const result = unbranded.plainText.toLowerCase().indexOf('i created')
  check('the neutral-style note comes after the posters, not instead of them', result > -1 && note > result, unbranded.plainText.slice(0, 120))
  check(
    'and it is an aside, not an instruction to go and set one up first',
    /any time|bila-bila/i.test(unbranded.plainText),
    unbranded.plainText.slice(0, 200),
  )
}

/* --- Part 10: the boundary did not move -------------------------------- */

async function part10() {
  section('PART 10 — authority')

  await reset({
    k7A: campaign({ name: 'Weekday lunch' }),
    k7Foreign: campaign({ name: 'Not yours', ownerId: OTHER, businessId: 'otherBiz', conversationId: 'otherConv' }),
  })

  // A campaign id the client made up, presented as a confirmed proposal.
  const forged = {
    type: 'confirm',
    action: { kind: 'creative.generate', campaignId: 'k7Foreign', campaignName: 'Not yours', spec: { format: 'square_post', brief: null, positions: [0], size: 1 } },
  }
  let generated = 0
  const outcome = await runChatAction(forged, ctx({ text: 'yes' }), stubDeps(() => { generated += 1 }))
  check('a campaign owned by someone else is refused', generated === 0, `generateCreative ran ${generated}x`)
  check('and the refusal says nothing about who owns it', !/owner|uid|permission denied/i.test(outcome.plainText), outcome.plainText)

  const invented = { ...forged, action: { ...forged.action, campaignId: 'doesNotExist' } }
  const missing = await runChatAction(invented, ctx({ text: 'yes' }), stubDeps())
  check('a missing campaign answers the same way as a foreign one', missing.plainText === outcome.plainText, missing.plainText)

  // Asset scope: the query is by owner and business, so a stranger's asset
  // cannot be reached even by naming it.
  await db.collection(COLLECTIONS.assets).doc('k7Theirs').set(asset({ ownerId: OTHER, businessId: 'otherBiz' }))
  const { listEligibleAssets } = require(`${lib}creative/assets.js`)
  const visible = await listEligibleAssets(BIZ, UID)
  check('asset listing cannot cross into another business', visible.every((a) => a.asset.ownerId === UID), String(visible.length))

  // Nothing in the reply text may claim a capability this product lacks.
  const texts = [outcome.plainText, missing.plainText]
  check(
    'no reply implies publishing, scheduling or ad spend',
    texts.every((t) => !/publish|schedul|jadual|ad spend|boost|roas/i.test(t)),
  )
}

/**
 * Real Firestore, real campaign resolution, real asset selection — only the
 * two calls that cost money are stubbed, because this file is about what
 * EVA decides, not about what the model writes.
 */
function stubDeps(onGenerate) {
  const { defaultActionDeps } = require(`${lib}chat/actions/execute.js`)
  return {
    ...defaultActionDeps,
    withLock: (_lock, fn) => fn(),
    async generateCreative(params) {
      onGenerate?.(params)
      return {
        creativeId: `stub${params.setPosition ?? 0}`,
        creative: { name: 'Stub poster', content: { headline: 'Stub' }, image: null },
        imageFailed: false,
        copyFellBack: false,
      }
    },
  }
}

async function main() {
  await db.collection(COLLECTIONS.businesses).doc(BIZ).set(business)
  await db.collection(COLLECTIONS.recommendations).doc('k7Rec').set(recommendation)
  console.log('Phase 7K — EVA-first flow smoke (no model calls)')

  await part2()
  await part3()
  await part10()

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) console.log(`failed: ${failures.join(' | ')}`)
  process.exit(fail ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
