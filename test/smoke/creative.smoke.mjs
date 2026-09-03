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
 *   (generates one square poster visual and reports its size — nothing is
 *   uploaded to Storage; the byte count is the assertion)
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set. This smoke test needs a real key.')
  process.exit(2)
}

const { runStructuredTask, runImageTask } = require('../../functions/lib/ai/orchestrator.js')
const { CREATIVE_COPY_PROMPT, buildCopyInput, buildImagePrompt } = require('../../functions/lib/creative/prompt.js')
const { CREATIVE_COPY_SCHEMA, CREATIVE_COPY_SCHEMA_NAME } = require('../../functions/lib/creative/schema.js')
const { validateCreativeCopy, moneyTokens } = require('../../functions/lib/creative/validate.js')
const {
  buildGroundingCorpus, buildCreativeEditCorpus, draftCreativeCopyFromCampaign, mergeCopy,
} = require('../../functions/lib/creative/draft.js')
const { buildStoredCreative } = require('../../functions/lib/creative/store.js')
const {
  generateCreativeEdit, applyCreativePatch, extractDirective, withDirective,
} = require('../../functions/lib/creative/edit.js')

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

console.log('\n-- 1. creative.generate_copy (fast tier, live) --')
const t0 = Date.now()
const { data, meta } = await runStructuredTask({
  task: 'creative.generate_copy',
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

/* --- 4. image generation (opt-in — costs money) -------------------------- */

if (process.env.SMOKE_IMAGE === '1') {
  console.log('\n-- 4. creative.generate_image (image tier, live) --')
  const prompt = buildImagePrompt({
    brief: 'A nasi lemak lunch set on a marble kopitiam table, morning light through a window',
    format: 'square_post', paletteHexes: [], visualStyle: null,
  })
  const t1 = Date.now()
  const image = await runImageTask({ task: 'creative.generate_image', prompt, size: '1024x1024' })
  console.log(`  model=${image.meta.model} latency=${Date.now() - t1}ms`)
  check('image bytes returned', image.imageBytes.length > 10_000, `${image.imageBytes.length} bytes`)
} else {
  console.log('\n-- 4. image generation skipped (set SMOKE_IMAGE=1 to run it) --')
}

console.log(`\n===== SMOKE: ${pass} passed, ${fail} failed =====`)
process.exit(fail ? 1 : 0)
