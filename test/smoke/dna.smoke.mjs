/**
 * Phase 7E module smoke — Business DNA against real sources and the real model.
 *
 * Runs the exact compiled modules the deployed callable runs, minus the
 * callable shell (auth, ownership, operation lock, Firestore writes), to
 * answer what unit tests cannot: does a public website (and, when reachable,
 * a public Facebook Page) actually reduce to evidence, produce ONE structured
 * synthesis under the `business.analyse_dna` task, validate strictly, and
 * merge into a brain patch + DNA report without touching any Brand Kit?
 *
 * Prerequisites:
 *   cd functions && npm run build
 *   export OPENAI_API_KEY=sk-...
 *   run inside: firebase emulators:exec --only firestore --project demo-marka
 *   (the 6B guardrail reserves usage in Firestore)
 *
 *   SMOKE_SITE=https://example.com  SMOKE_FB=https://www.facebook.com/... \
 *   node test/smoke/dna.smoke.mjs
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set.')
  process.exit(2)
}

const { runStructuredTask } = require('../../functions/lib/ai/orchestrator.js')
const { BUSINESS_DNA_PROMPT, buildDnaInput } = require('../../functions/lib/ai/prompts/businessDna.js')
const { BUSINESS_DNA_SCHEMA, BUSINESS_DNA_SCHEMA_NAME } = require('../../functions/lib/business/dna/schema.js')
const { validateBusinessDna } = require('../../functions/lib/business/dna/validate.js')
const {
  EvidenceIds, websiteEvidence, socialEvidence, selectVisualCandidates, evidenceChars,
} = require('../../functions/lib/business/dna/evidence.js')
const { resolveVisualEvidence } = require('../../functions/lib/business/dna/visuals.js')
const {
  analysedSources, primarySource, stampAdditionalSources, toBrandVisual, buildBusinessDna,
} = require('../../functions/lib/business/dna/merge.js')
const { mergeWebsiteAnalysis, fillEmptyBrandVisuals } = require('../../functions/lib/business/brain/merge.js')
const { assertAnalysisUseful } = require('../../functions/lib/business/brain/validate.js')
const { crawlSite } = require('../../functions/lib/business/website/crawl.js')
const { normalizeSite } = require('../../functions/lib/business/website/normalize.js')
const { detectDiscoverySource } = require('../../functions/lib/business/discovery/source.js')
const { fetchSocialProfile } = require('../../functions/lib/business/discovery/fetchSocial.js')

const SITE = process.env.SMOKE_SITE ?? null
const FB = process.env.SMOKE_FB ?? null
const IG = process.env.SMOKE_IG ?? null

let pass = 0, fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass += 1; console.log(`  ok    ${name}`) } else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

const stored = {
  ownerId: 'smoke', name: 'Untitled business', industry: 'other',
  identity: { legalName: null, tagline: null, description: null, category: null, subIndustry: null, businessType: null, foundedYear: null },
  contact: { email: null, phone: null, whatsapp: null, website: null, socialProfiles: [] },
  location: { addressLine1: null, addressLine2: null, city: null, state: null, postcode: null, countryCode: 'MY', openingHours: null, serviceArea: null },
  products: [], audience: null, brand: null, marketing: null, operations: null, provenance: {}, sources: [],
  discovery: { status: 'not_started', stage: null, lastRunAt: null, completedAt: null, sourceRef: null, pagesAnalysed: 0, error: null, errorCode: null, summary: null, unknowns: [] },
  brandKit: { logoAssetId: null, colors: { primary: '#123456', secondary: null, accent: null }, typography: { heading: null, body: null }, styleTraits: [], styleNotes: null, notes: null, updatedAt: 1 },
  brainVersion: 2, createdAt: 1, updatedAt: 1,
}

console.log('\n-- 1. sources → evidence --')
const ids = new EvidenceIds()
const evidence = [], candidates = [], sources = []
let websiteVisual = null, pagesAnalysed = 0
const t0 = Date.now()

if (SITE) {
  try {
    const source = detectDiscoverySource(SITE)
    const crawl = await crawlSite(source.url)
    websiteVisual = crawl.brandVisual
    const site = normalizeSite(crawl)
    const set = websiteEvidence({ site, visual: crawl.brandVisual, canonicalUrl: site.startUrl }, ids)
    evidence.push(...set.evidence); candidates.push(...set.visuals)
    pagesAnalysed += site.pageUrls.length
    sources.push({ type: 'website', reference: site.startUrl, status: 'analyzed', count: site.pageUrls.length })
    check('website crawled through the hardened pipeline', true)
    console.log(`        pages=${site.pageUrls.length} corpus=${site.corpus.length} colors=${crawl.brandVisual?.colors.length ?? 0} logo=${Boolean(crawl.brandVisual?.logoUrl)} font=${crawl.brandVisual?.fontName ?? null} images=${set.visuals.length}`)
  } catch (error) {
    sources.push({ type: 'website', reference: SITE, status: 'failed', count: 0 })
    check('website crawled', false, error?.constructor?.name)
  }
}
for (const [kind, url] of [['facebook', FB], ['instagram', IG]]) {
  if (!url) continue
  try {
    const source = detectDiscoverySource(url)
    const profile = await fetchSocialProfile(source)
    const set = socialEvidence({ kind, profile, canonicalUrl: source.url }, ids)
    evidence.push(...set.evidence); candidates.push(...set.visuals)
    pagesAnalysed += 1
    sources.push({ type: kind, reference: source.url, status: 'analyzed', count: 1 })
    check(`${kind} profile read`, true)
    console.log(`        corpus=${profile.corpus.length} images=${profile.page?.images.length ?? 0}`)
  } catch (error) {
    const name = error?.constructor?.name ?? 'Error'
    const status = name === 'NotPublicError' ? 'inaccessible' : name === 'InsufficientContentError' ? 'limited' : 'failed'
    sources.push({ type: kind, reference: url, status, count: 0 })
    check(`${kind} recorded as ${status} (partial success, not a failure)`, true, name)
  }
}
const fetchMs = Date.now() - t0
check('at least one source readable', sources.some((s) => s.status === 'analyzed' || s.status === 'limited'))
check('every evidence item is labelled data (id, source, kind, confidence, provenance)',
  evidence.every((e) => e.id && e.sourceType && e.kind && e.confidence && e.provenance))

console.log('\n-- 2. bounded visual set, fetched by the server only --')
const selected = selectVisualCandidates(candidates)
const visuals = await resolveVisualEvidence({ candidates: selected, businessId: 'smokeBiz', ownerId: 'smoke' })
check(`selected ${selected.length} candidates, resolved ${visuals.length} (≤ 6)`, visuals.length <= 6)
check('resolved images are numbered img1… and carry data URLs', visuals.every((v, i) => v.id === `img${i + 1}` && v.dataUrl.startsWith('data:image/')))

console.log('\n-- 3. ONE synthesis through the orchestrator --')
const input = buildDnaInput({ sources, evidence, visuals })
// The builder's own lines (source status, fact lines, image index) must never carry an image URL.
// Verbatim source corpus follows the first CONTENT heading; it is data and may naturally mention
// its own images (JSON-LD, og:image), exactly as Phase 6D website analysis already received it.
const firstCorpus = input.search(/\n--- [A-Z ]+ CONTENT/)
const builderText = firstCorpus === -1 ? input : input.slice(0, firstCorpus)
check('builder lines never carry an image URL', !visuals.some((v) => builderText.includes(v.ref)))
check('image index refers to images by id only', /IMAGES ATTACHED[\s\S]*- img1 \(image 1\)/.test(builderText) && !/^- img\d+ .*https?:\/\//m.test(builderText))
check(`evidence chars ${evidenceChars(evidence)} within the task request cap`, evidenceChars(evidence) <= 200_000)
const t1 = Date.now()
const { data, meta } = await runStructuredTask({
  task: 'business.analyse_dna', uid: 'smoke', plan: 'basic',
  systemPrompt: BUSINESS_DNA_PROMPT, input,
  parts: visuals.map((v) => ({ type: 'input_image', imageUrl: v.dataUrl })),
  schema: { name: BUSINESS_DNA_SCHEMA_NAME, schema: BUSINESS_DNA_SCHEMA },
})
console.log(`        model=${meta.model} latency=${Date.now() - t1}ms in=${meta.usage?.inputTokens ?? '?'} out=${meta.usage?.outputTokens ?? '?'}`)
check('structured output returned', typeof data === 'object' && data !== null)

console.log('\n-- 4. strict validation --')
const analysis = validateBusinessDna(data, {
  imageIds: visuals.map((v) => v.id),
  fontNames: evidence.filter((e) => e.kind === 'font').map((e) => e.value),
})
let useful = true
try { assertAnalysisUseful(analysis) } catch { useful = false }
check('analysis useful (name/category/summary established)', useful)
const b = analysis.brandDna
check('logoImageId is null or an attached id', b.logoImageId === null || visuals.some((v) => v.id === b.logoImageId))
check('colours are normalised #rrggbb', b.colors.every((c) => /^#[0-9a-f]{6}$/.test(c.hex)))
check('detectedFont is null or a font the evidence named', b.detectedFont === null || evidence.some((e) => e.kind === 'font' && e.value.toLowerCase() === b.detectedFont.toLowerCase()))
console.log(`        name=${JSON.stringify(analysis.identity.businessName)} category=${JSON.stringify(analysis.identity.category)} colors=${b.colors.map((c) => c.hex).join(',')} logo=${b.logoImageId} font=${b.detectedFont}→${b.supportedFont} traits=${b.styleTraits.join('/')} → ${b.suggestedTraits.join('/')} conf=${b.confidence}`)
console.log(`        visualStyle=${JSON.stringify(b.visualStyle)} unknowns=${analysis.unknowns.length}`)

console.log('\n-- 5. merge: brain patch + DNA report, Brand Kit untouched --')
const now = Date.now()
const mergeInput = { analysis, sources, evidence, visuals, websiteVisual, now }
const primary = primarySource(sources)
check('primary source resolved', primary !== null)
const patch = stampAdditionalSources(
  mergeWebsiteAnalysis(stored, analysis, { websiteUrl: primary.reference, pagesAnalysed, now, source: primary.kind, brandVisual: toBrandVisual(mergeInput) }),
  stored, analysedSources(sources).slice(1), now,
)
const dna = buildBusinessDna(mergeInput)
check('patch never contains brandKit', !('brandKit' in patch))
check('brain brand claim carries visuals (7D.2 fill)', Boolean(fillEmptyBrandVisuals(patch.brand ?? null, toBrandVisual(mergeInput))?.value))
check('one ConnectedSource per analysed source', (patch.sources ?? []).length === analysedSources(sources).length)
check('DNA report has version 1, sources, business, brand, unknowns', dna.version === 1 && Array.isArray(dna.sources) && dna.business && dna.brand && Array.isArray(dna.unknowns))
check('DNA logo candidate is null, an asset ref, or a URL a source exposed',
  dna.brand.logoCandidate === null || dna.brand.logoCandidate.kind === 'asset' || candidates.some((c) => c.ref === dna.brand.logoCandidate.url) || websiteVisual?.logoUrl === dna.brand.logoCandidate.url)
console.log(`        sources=${dna.sources.map((s) => `${s.type}:${s.status}`).join(' ')} logo=${dna.brand.logoCandidate?.kind ?? null} colors=${dna.brand.colors.length} typography=${dna.brand.typography ? `${dna.brand.typography.detectedFont}→${dna.brand.typography.supportedMatch}` : null}`)
console.log(`        business: ${dna.business.businessName} | ${dna.business.category} | ${dna.business.location} | products=${dna.business.productsServices.length} bestSellers=${dna.business.bestSellers.length}`)
console.log(`        fetch=${fetchMs}ms model=${Date.now() - t1}ms`)

console.log(`\n===== DNA SMOKE: ${pass} passed, ${fail} failed =====`)
process.exit(fail === 0 ? 0 : 1)
