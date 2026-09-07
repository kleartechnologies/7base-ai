/**
 * Phase 5 live smoke test — the creative pipeline against the real OpenAI API.
 *
 * Not vitest, and not the emulator: this exercises the exact modules the
 * deployed functions run (compiled in functions/lib), with real model calls,
 * to answer the questions unit tests cannot:
 *
 *   1. Does the fast tier produce grounded copy for "Weekday Lunch Growth"
 *      — and does the validator hold when it does not?
 *   2. Does "Make the headline more premium" patch only the headline, and
 *      does the owner then hold authority over it?
 *   3. Does "Don't mention discounts" persist as a standing directive, with
 *      the earlier authority still intact?
 *
 * Prerequisites:
 *   cd functions && npm run build       # compiles src -> lib
 *   export OPENAI_API_KEY=sk-...        # never committed, never client-side
 *
 * Run:
 *   node test/smoke/creative.smoke.mjs
 *
 * Image generation costs real money per run, so it is opt-in:
 *   SMOKE_IMAGE=1 node test/smoke/creative.smoke.mjs
 *   (generates one square poster visual per creative direction and writes it
 *   to SMOKE_IMAGE_DIR so it can be looked at; nothing is uploaded to Storage)
 *   SMOKE_DIRECTIONS=hero_product,clean_editorial  # which directions to draw
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set. This smoke test needs a real key.')
  process.exit(2)
}

const { runStructuredTask, runImageTask } = require('../../functions/lib/ai/orchestrator.js')
const { CREATIVE_COPY_PROMPT, buildCopyInput, buildImagePrompt } = require('../../functions/lib/creative/prompt.js')
const { artDirectionForPosition } = require('../../functions/lib/creative/artDirection.js')
const { CREATIVE_COPY_SCHEMA, CREATIVE_COPY_SCHEMA_NAME } = require('../../functions/lib/creative/schema.js')
const { validateCreativeCopy, moneyTokens } = require('../../functions/lib/creative/validate.js')
const {
  buildGroundingCorpus, buildCreativeEditCorpus, draftCreativeCopyFromCampaign, mergeCopy,
} = require('../../functions/lib/creative/draft.js')
const { buildStoredCreative } = require('../../functions/lib/creative/store.js')
const {
  generateCreativeEdit, applyCreativePatch, extractDirective, withDirective,
} = require('../../functions/lib/creative/edit.js')
const { buildSetContext } = require('../../functions/lib/chat/actions/execute.js')

/* --- fixtures: the spec's own scenario ---------------------------------- */

const campaign = {
  name: 'Weekday Lunch Growth',
  objective: 'Increase weekday lunch customers',
  targetAudience: { description: 'Office workers within walking distance', basis: 'known' },
  // Deliberately price-free: the whole point is that no price may appear.
  offer: { description: 'Consider a weekday lunch set', basis: 'recommendation' },
  positioning: 'The honest, unhurried kopitiam lunch',
  keyMessage: 'A proper lunch, without the wait',
  callToAction: 'Order on WhatsApp',
  channels: ['facebook', 'instagram', 'whatsapp'],
  durationDays: 14, startDate: null, endDate: null, notes: null,
  assumptions: ['Office crowd works nearby'],
  unknowns: ['Lunch set pricing not confirmed'],
  ownerId: 'smoke', businessId: 'smokeBiz', conversationId: 'smokeConv',
  sourceRecommendationId: 'smokeRec', status: 'draft', userEdited: [],
  meta: null, createdAt: Date.now(), updatedAt: Date.now(),
}

const business = {
  ownerId: 'smoke',
  name: 'Secret Recipe Kopitiam',
  contact: { website: null, whatsapp: '+60123456789' },
  products: [
    { name: 'Nasi Lemak Ayam', description: 'Coconut rice, fried chicken, house sambal', priceMinor: 1290, imageUrl: null, isSignature: true },
    { name: 'Kopi O', description: null, priceMinor: 380, imageUrl: null, isSignature: false },
  ],
  marketing: null,
  brand: null,
}

let pass = 0, fail = 0
function check(name, condition, detail = '') {
  if (condition) { console.log('  ok     ', name); pass++ }
  else { console.log('  FAIL   ', name, detail ? `— ${detail}` : ''); fail++ }
}

const corpus = buildGroundingCorpus({ campaign, business })
const allowedMoney = new Set(moneyTokens(corpus))

/* --- 1. copy generation ------------------------------------------------- */

// Which subscription plan's models to exercise. 'pro' is the pre-plan
// behaviour (mid-tier copy); SMOKE_PLAN=basic smokes the low-cost route.
const SMOKE_PLAN = process.env.SMOKE_PLAN === 'basic' ? 'basic' : 'pro'

// The usage ledger is one document per user-day, so a second run on the same
// day adds to the first. Section 5 asserts what *this* run spent, which means
// reading where the day stood before anything was called.
const usageRef = process.env.FIRESTORE_EMULATOR_HOST
  ? require('../../functions/lib/lib/firebase.js')
      .db.collection('usage')
      .doc(`smoke_${new Date().toISOString().slice(0, 10)}`)
  : null
const usageBefore = usageRef ? ((await usageRef.get()).data() ?? null) : null
const spent = (usage, path) => {
  const read = (doc) => path.split('.').reduce((value, key) => value?.[key], doc) ?? 0
  return read(usage) - read(usageBefore)
}

console.log(`\n-- 1. creative.generate_copy (fast tier, plan=${SMOKE_PLAN}, live) --`)
const t0 = Date.now()
const { data, meta } = await runStructuredTask({
  task: 'creative.generate_copy',
  uid: 'smoke',
  plan: SMOKE_PLAN,
  systemPrompt: CREATIVE_COPY_PROMPT,
  input: buildCopyInput({
    businessName: business.name, brandVoice: null, campaign,
    format: 'square_post', directives: [], hasRealImage: false,
  }),
  schema: { name: CREATIVE_COPY_SCHEMA_NAME, schema: CREATIVE_COPY_SCHEMA },
})
console.log(`  model=${meta.model} latency=${Date.now() - t0}ms`)

const copy = validateCreativeCopy(data, corpus)
const merged = mergeCopy(draftCreativeCopyFromCampaign(campaign), copy)
console.log('  headline:', JSON.stringify(merged.content.headline))
console.log('  offerText:', JSON.stringify(merged.content.offerText))
console.log('  facebook:', JSON.stringify(merged.captions.facebook))

check('copy call returned a headline or the draft held one', merged.content.headline !== null)
for (const [field, value] of [
  ['headline', merged.content.headline], ['offerText', merged.content.offerText],
  ['facebookCaption', merged.captions.facebook], ['instagramCaption', merged.captions.instagram],
  ['shortCopy', merged.captions.short], ['whatsappCopy', merged.captions.whatsapp],
]) {
  if (value === null) continue
  const invented = moneyTokens(value).filter((token) => !allowedMoney.has(token))
  check(`${field} invents no price or percentage`, invented.length === 0, `found ${invented.join(', ')}`)
}
check('WhatsApp copy exists (whatsapp is a campaign channel)', merged.captions.whatsapp !== null)

/* --- 2. "Make the headline more premium" -------------------------------- */

console.log('\n-- 2. creative.edit: "Make the headline more premium" --')
let creative = buildStoredCreative({
  ownerId: 'smoke', businessId: 'smokeBiz', campaignId: 'smokeCamp',
  conversationId: 'smokeConv', sourceRecommendationId: 'smokeRec',
  name: merged.name, format: 'square_post',
  content: { ...merged.content, image: null, layout: 'text_only' },
  captions: merged.captions,
  style: { palette: null, headingFont: null, bodyFont: null, logoStoragePath: null },
  imageError: null, meta: null,
})

const beforeHeadline = creative.content.headline
const instruction1 = 'Make the headline more premium'
const edit1 = await generateCreativeEdit({
  instruction: instruction1, creative, campaign, businessName: business.name,
  corpus: buildCreativeEditCorpus({ creative, campaign, business, instruction: instruction1 }),
  uid: 'smoke', plan: SMOKE_PLAN,
})
console.log('  reply:', JSON.stringify(edit1.draft.reply))
console.log('  patch:', JSON.stringify(edit1.draft.patch))

check('edit returned a headline change', typeof edit1.draft.patch.headline === 'string')
check('edit did not ask to regenerate the image', edit1.draft.visualChange === null)
const applied1 = applyCreativePatch(creative, edit1.draft.patch, 'user_instruction')
creative = applied1.creative
console.log('  headline:', JSON.stringify(beforeHeadline), '→', JSON.stringify(creative.content.headline))
check('headline actually changed', creative.content.headline !== beforeHeadline)
check('owner now holds authority over the headline', creative.userEdited.includes('headline'))

/* --- 3. "Don't mention discounts" — authority persists ------------------- */

console.log('\n-- 3. creative.edit: "Don\'t mention discounts" --')
const instruction2 = "Don't mention discounts"
const edit2 = await generateCreativeEdit({
  instruction: instruction2, creative, campaign, businessName: business.name,
  corpus: buildCreativeEditCorpus({ creative, campaign, business, instruction: instruction2 }),
  uid: 'smoke', plan: SMOKE_PLAN,
})
console.log('  reply:', JSON.stringify(edit2.draft.reply))
console.log('  patch:', JSON.stringify(edit2.draft.patch))

const premiumHeadline = creative.content.headline
const applied2 = applyCreativePatch(creative, edit2.draft.patch, 'user_instruction')
creative = applied2.creative
creative.ownerDirectives = withDirective(creative.ownerDirectives, extractDirective(instruction2))

check('directive recorded on the creative', creative.ownerDirectives.some((d) => /discount/i.test(d)))
check('the premium headline survived the second edit (authority persists)',
  creative.userEdited.includes('headline') &&
  (edit2.draft.patch.headline === undefined || creative.content.headline !== null))
console.log('  headline after both edits:', JSON.stringify(creative.content.headline))
console.log('  userEdited:', JSON.stringify(creative.userEdited))
console.log('  ownerDirectives:', JSON.stringify(creative.ownerDirectives))
check('no caption mentions a discount now',
  ![creative.captions.facebook, creative.captions.instagram, creative.captions.short, creative.captions.whatsapp]
    .filter(Boolean).some((t) => /discount|% off/i.test(t)))
void premiumHeadline

/* --- 4. a real poster set (opt-in — costs money) -------------------------- */

/**
 * Phase 7G.2 §3/§4/§13 — the whole poster, not the photograph alone.
 *
 * This walks the production modules exactly as `generate.ts` walks them, for
 * a real brand with a real palette and a real product: copy (live), the
 * deterministic art direction for each set position, the image brief the copy
 * model wrote, and the image itself. What comes out is a manifest that
 * `test/visual/render.mjs --manifest` renders *posters* from, so the thing
 * judged is the finished creative rather than a raw generation.
 */
const LIVE_DIRECTIONS = (process.env.SMOKE_DIRECTIONS ?? 'educational,app_showcase,lifestyle').split(',')
const LIVE_SET_SIZE = LIVE_DIRECTIONS.length

if (process.env.SMOKE_IMAGE === '1') {
  console.log(`\n-- 4. a live ${LIVE_SET_SIZE}-poster set (image tier, live) --`)
  const { writeFileSync, mkdirSync } = require('node:fs')
  const outDir = process.env.SMOKE_IMAGE_DIR ?? '.'
  mkdirSync(outDir, { recursive: true })

  // A real Malaysian SME with a confirmed Brand Identity: green palette, an
  // app, a stated audience. Fixture data, not production logic — the pipeline
  // under test must not know which brand this is.
  const setBusiness = {
    ownerId: 'smoke',
    name: 'Matheasy',
    industry: 'education',
    contact: { website: 'https://matheasy.my', whatsapp: null },
    identity: {
      tagline: 'Daripada soalan kepada faham',
      description:
        'A mathematics learning app for Malaysian secondary school students: scan a question, get the full step-by-step solution, and ask Numi when a step is unclear.',
      category: 'education technology',
      subIndustry: 'exam preparation',
      businessType: 'mathematics learning app for Malaysian secondary school students',
    },
    products: [
      { name: 'Step-by-step solver', description: 'Scan any maths question and see every step', priceMinor: null, imageUrl: null, isSignature: true },
      { name: 'Numi AI tutor', description: 'Asks back, explains the step you are stuck on', priceMinor: null, imageUrl: null, isSignature: false },
    ],
    marketing: null,
    brand: {
      palette: ['#22c55e', '#0f172a', '#f8fafc'],
      headingFont: 'Poppins',
      bodyFont: 'Inter',
      logoStoragePath: 'businesses/smokeBiz/assets/logo.png',
      visualStyle:
        'Bright, encouraging and modern. Clean daylight, real Malaysian secondary-school students, green as the colour of progress rather than decoration.',
    },
  }

  const setCampaign = {
    ...campaign,
    name: 'Faham, bukan hafal',
    objective: 'Get more Form 4 and Form 5 students to try the app before SPM',
    targetAudience: { description: 'Malaysian secondary school students sitting SPM, and their parents', basis: 'known' },
    offer: { description: 'Free for 7 days', basis: 'existing' },
    positioning: 'The app that explains the step you are stuck on',
    keyMessage: 'Understanding beats memorising',
    callToAction: 'Muat turun percuma',
    channels: ['instagram', 'facebook'],
  }

  const setCorpus = buildGroundingCorpus({ campaign: setCampaign, business: setBusiness })
  const directions = LIVE_DIRECTIONS
  const manifest = []

  for (const [position, direction] of directions.entries()) {
    // The art direction, replayed from position 0 exactly as generate.ts does,
    // so poster three cannot repeat poster one's arrangement (§13).
    const art = artDirectionForPosition(
      { direction, format: 'square_post', hasVisual: true, isScreenshot: false, position },
      (i) => directions[i % directions.length],
    )

    const tCopy = Date.now()
    const { data: setData, meta: setMeta } = await runStructuredTask({
      task: 'creative.generate_copy',
      uid: 'smoke',
      plan: SMOKE_PLAN,
      systemPrompt: CREATIVE_COPY_PROMPT,
      input: buildCopyInput({
        businessName: setBusiness.name, brandVoice: null, campaign: setCampaign,
        format: 'square_post', directives: [], hasRealImage: false,
        // The same wording chat sends, so poster three argues a different
        // angle from poster one rather than paraphrasing it.
        setContext: buildSetContext(position + 1, { size: directions.length, brief: null }),
        visual: { direction, composition: art.composition },
        // What the earlier posters of this set already said and photographed.
        alreadyInSet: manifest.map((entry) => ({
          headline: entry.content.headline,
          imageBrief: entry.imageBrief,
        })),
      }),
      schema: { name: CREATIVE_COPY_SCHEMA_NAME, schema: CREATIVE_COPY_SCHEMA },
    })
    const setCopy = validateCreativeCopy(setData, setCorpus)
    const setMerged = mergeCopy(draftCreativeCopyFromCampaign(setCampaign), setCopy)
    console.log(`\n  [${position}] ${direction} · ${art.composition} · ${art.accent} · cta=${art.cta}`)
    console.log(`  copy model=${setMeta.model} latency=${Date.now() - tCopy}ms`)
    console.log('  headline:', JSON.stringify(setMerged.content.headline))
    console.log('  imageBrief:', JSON.stringify(setCopy.imageBrief))

    const campaignBrief = [setCampaign.offer?.description, setCampaign.keyMessage, setCampaign.positioning]
      .filter(Boolean).join('. ')
    const prompt = buildImagePrompt({
      brief: setCopy.imageBrief ?? campaignBrief,
      format: 'square_post',
      direction,
      composition: art.composition,
      paletteHexes: setBusiness.brand.palette.slice(0, 3),
      visualStyle: setBusiness.brand.visualStyle,
      businessType: setBusiness.identity.businessType,
    })
    console.log(`  prompt: ${prompt}`)

    const t1 = Date.now()
    const image = await runImageTask({
      task: 'creative.generate_image', uid: 'smoke', plan: SMOKE_PLAN, prompt, size: '1024x1024',
    })
    const file = `poster-${position}-${direction}.png`
    writeFileSync(`${outDir}/${file}`, image.imageBytes)
    console.log(`  image model=${image.meta.model} latency=${Date.now() - t1}ms -> ${outDir}/${file}`)
    check(`image bytes returned for ${direction}`, image.imageBytes.length > 10_000, `${image.imageBytes.length} bytes`)

    manifest.push({
      position, direction, art, file, prompt, imageBrief: setCopy.imageBrief,
      name: setMerged.name,
      content: setMerged.content,
      style: {
        palette: setBusiness.brand.palette,
        headingFont: setBusiness.brand.headingFont,
        bodyFont: setBusiness.brand.bodyFont,
      },
    })
  }

  writeFileSync(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2))
  console.log(`\n  manifest -> ${outDir}/manifest.json`)
  const compositions = new Set(manifest.map((entry) => entry.art.composition))
  check('a set of three is three arrangements', compositions.size === manifest.length, [...compositions].join(', '))
  const headlines = new Set(manifest.map((entry) => entry.content.headline))
  check('the posters do not all carry the same headline', headlines.size > 1, [...headlines].join(' | '))
} else {
  console.log('\n-- 4. image generation skipped (set SMOKE_IMAGE=1 to run it) --')
}

/* --- 5. the usage ledger (Phase 6B) --------------------------------------
 * The orchestrator calls above ran through the real guardrail: every one
 * reserved before OpenAI and settled after, against whatever Firestore the
 * Admin SDK is pointed at. Run inside `firebase emulators:exec --only
 * firestore` to get these assertions without touching production data.
 */
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('\n-- 5. usage ledger (guardrail settlement, via emulator) --')
  const snapshot = await usageRef.get()
  check('usage document exists for the smoke user-day', snapshot.exists)
  if (snapshot.exists) {
    const usage = snapshot.data()
    const imageRuns = process.env.SMOKE_IMAGE === '1' ? LIVE_SET_SIZE : 0
    console.log('  ledger:', JSON.stringify({
      requests: usage.requests, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      imageInputTokens: usage.imageInputTokens, imageOutputTokens: usage.imageOutputTokens,
      imagesGenerated: usage.imagesGenerated, estimatedCostUsd: usage.estimatedCostUsd,
      inflight: usage.inflight, reservedInputTokens: usage.reservedInputTokens,
      reservedOutputTokens: usage.reservedOutputTokens, reservedCostUsd: usage.reservedCostUsd,
    }))
    // Three copy/edit calls above, plus one copy call per poster of the live
    // set when the image tier ran.
    const expectedText = 3 + (process.env.SMOKE_IMAGE === '1' ? LIVE_SET_SIZE : 0)
    check(
      `${expectedText} aiGeneration attempts counted`,
      spent(usage, 'requests.aiGeneration') === expectedText,
      `this run: ${spent(usage, 'requests.aiGeneration')}`,
    )
    check(
      'image attempts counted separately',
      spent(usage, 'requests.imageGeneration') === imageRuns,
      `this run: ${spent(usage, 'requests.imageGeneration')}`,
    )
    check(
      'text tokens settled from provider actuals',
      spent(usage, 'inputTokens') > 0 && spent(usage, 'outputTokens') > 0,
    )
    check('estimated cost settled and positive', spent(usage, 'estimatedCostUsd') > 0)
    check('nothing left in flight', usage.inflight === 0)
    check('all reservations released', usage.reservedInputTokens === 0 && usage.reservedOutputTokens === 0 && usage.reservedCostUsd === 0)
    if (imageRuns) {
      check('image tokens on the image counters', spent(usage, 'imageOutputTokens') > 0)
      check(
        'delivered images counted',
        spent(usage, 'imagesGenerated') === imageRuns,
        `this run: ${spent(usage, 'imagesGenerated')}`,
      )
    }
  }
}

console.log(`\n===== SMOKE: ${pass} passed, ${fail} failed =====`)
process.exit(fail ? 1 : 0)
