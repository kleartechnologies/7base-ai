import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { requireBusinessOwner, requireUid, resolvePlanForUser } from '../lib/auth'
import { internal, invalidArgument, notConfigured } from '../lib/errors'
import { COLLECTIONS, db } from '../lib/firebase'
import { isPathWithinBusiness } from '../lib/storagePaths'
import { withOperationLock } from '../lib/operationLock'
import type {
  AnalyseBusinessDnaRequest,
  AnalyseBusinessDnaResponse,
  DiscoveryStage,
  DnaSourceStatus,
  DnaSourceSummary,
  DnaSourceType,
  StoredBusiness,
} from '../lib/business.types'
import { OPENAI_API_KEY } from '../ai/openai.client'
import {
  AiNotConfiguredError,
  runStructuredTask,
  type TurnAttachmentPart,
} from '../ai/orchestrator'
import { BUSINESS_DNA_PROMPT, buildDnaInput } from '../ai/prompts/businessDna'
import { assertRequestBudgetRemains } from '../usage/guardrail'
import type { StoredAsset } from '../creative/assets'
import { classify, recordFailure, REANALYSIS_COOLDOWN_MS } from './discoveryFailure'
import { CRAWL_LIMITS, crawlSite } from './website/crawl'
import type { BrandVisual } from './website/brandVisual'
import { normalizeSite } from './website/normalize'
import { InvalidUrlError } from './website/url'
import { BlockedHostError, UnresolvableHostError } from './website/guard'
import {
  detectDiscoverySource,
  UnsupportedSocialUrlError,
  type DiscoverySource,
  type DiscoverySourceKind,
} from './discovery/source'
import { fetchSocialProfile, NotPublicError } from './discovery/fetchSocial'
import { mergeWebsiteAnalysis } from './brain/merge'
import { assertAnalysisUseful, InsufficientContentError } from './brain/validate'
import {
  assetEvidence,
  EvidenceIds,
  evidenceChars,
  selectVisualCandidates,
  socialEvidence,
  websiteEvidence,
  type AssetForEvidence,
  type SourceEvidence,
  type VisualCandidate,
} from './dna/evidence'
import { resolveVisualEvidence } from './dna/visuals'
import { BUSINESS_DNA_SCHEMA, BUSINESS_DNA_SCHEMA_NAME } from './dna/schema'
import { validateBusinessDna } from './dna/validate'
import {
  analysedSources,
  buildBusinessDna,
  primarySource,
  stampAdditionalSources,
  toBrandVisual,
} from './dna/merge'

/**
 * Business DNA Intelligence (Phase 7E).
 *
 * One callable reads EVERY source the business has — its website, its public
 * Facebook Page, its Instagram profile, the Assets the owner uploaded — and
 * asks the model ONCE for a structured understanding of the business and
 * its brand. A website is one source among several, not the required one.
 *
 * What is deliberately the same as `businessRunWebsiteAnalysis`:
 *  - every link goes through `detectDiscoverySource` (URL normalisation and
 *    the SSRF guard), and the fetchers are the existing ones;
 *  - the model call goes through the orchestrator (plan, quota, model);
 *  - the result folds into the Business Brain through `mergeWebsiteAnalysis`,
 *    so owner-confirmed values keep winning;
 *  - progress and failure are written to `discovery` the way the onboarding
 *    screen already reads them.
 *
 * What is different:
 *  - sources are resolved server-side from the business document, with at
 *    most three request links allowed to add or replace one per kind;
 *  - each source succeeds or fails on its own (partial success);
 *  - a bounded set of images the server fetched itself is attached;
 *  - the detected DNA is stored as a report under `discovery.dna`. Nothing
 *    is written to the owner's Brand Kit — "Use these" does that, in the
 *    client, with the owner's finger on the button;
 *  - the onboarding step is never touched: this runs for businesses that
 *    already exist.
 */

const MAX_LINKS = 3
const MAX_LINK_CHARS = 2_048
/** Assets considered per run: metadata for all of these, bytes for a few. */
const MAX_ASSETS = 24

export const businessAnalyseDna = onCall(
  {
    region: 'asia-southeast1',
    secrets: [OPENAI_API_KEY],
    timeoutSeconds: 300,
    memory: '1GiB',
    maxInstances: 5,
    cors: true,
  },
  async (
    request: CallableRequest<AnalyseBusinessDnaRequest>,
  ): Promise<AnalyseBusinessDnaResponse> => {
    const uid = requireUid(request)
    // Explicit allowlist: businessId and up to three links. Nothing else in
    // the payload is read — no colours, fonts, logo URLs, DNA or evidence
    // can be supplied by a client.
    const { businessId, links } = parseRequest(request.data)

    const stored = (await requireBusinessOwner(businessId, uid)) as StoredBusiness | null
    if (!stored) throw invalidArgument('That business no longer exists.')

    const pages = resolvePageSources(stored, links)
    const assets = await listDnaAssets(businessId, uid)
    if (pages.size === 0 && assets.length === 0) {
      throw new HttpsError(
        'failed-precondition',
        'Add a website, Facebook Page, Instagram profile or a few assets first, then EVA can analyse your business.',
      )
    }

    const lastAttemptAt = Math.max(
      stored.discovery?.lastAttemptAt ?? 0,
      stored.discovery?.completedAt ?? 0,
    )
    if (Date.now() - lastAttemptAt < REANALYSIS_COOLDOWN_MS) {
      throw new HttpsError('resource-exhausted', 'Please wait before starting another analysis.')
    }

    const plan = await resolvePlanForUser(uid)
    await assertRequestBudgetRemains({ uid, plan, task: 'business.analyse_dna' })

    return withOperationLock(
      {
        key: `dna:${uid}:${businessId}`,
        ownerId: uid,
        operation: 'business.analyse_dna',
        busyMessage: 'EVA is already analysing this business. Please wait for it to finish.',
      },
      () => runDnaAnalysis({ uid, plan, businessId, stored, pages, assets }),
    )
  },
)

/* --- the run ----------------------------------------------------------- */

interface RunParams {
  uid: string
  plan: Awaited<ReturnType<typeof resolvePlanForUser>>
  businessId: string
  stored: StoredBusiness
  pages: Map<DiscoverySourceKind, DiscoverySource>
  assets: AssetForEvidence[]
}

async function runDnaAnalysis(params: RunParams): Promise<AnalyseBusinessDnaResponse> {
  const { uid, plan, businessId, stored, pages, assets } = params
  const ref = db.collection(COLLECTIONS.businesses).doc(businessId)

  const attemptAt = Date.now()
  await ref.update({
    discovery: {
      ...(stored.discovery ?? {}),
      status: 'running',
      stage: 'fetching' satisfies DiscoveryStage,
      lastRunAt: attemptAt,
      lastAttemptAt: attemptAt,
      sourceRef: stored.discovery?.sourceRef ?? pages.get('website')?.url ?? null,
      error: null,
      errorCode: null,
      dna: stored.discovery?.dna ?? null,
    },
    updatedAt: attemptAt,
  })
  const setStage = (stage: DiscoveryStage) =>
    ref.update({ 'discovery.stage': stage, updatedAt: Date.now() }).catch((error: unknown) => {
      logger.warn('Could not write discovery stage', { businessId, stage, error })
    })

  const startedAt = Date.now()
  let fetchMs = 0
  let modelMs = 0
  const counts: Record<DnaSourceType, DnaSourceStatus | 'absent'> = {
    website: 'absent',
    facebook: 'absent',
    instagram: 'absent',
    asset: 'absent',
  }

  try {
    const ids = new EvidenceIds()
    const evidence: SourceEvidence[] = []
    const candidates: VisualCandidate[] = []
    const sources: DnaSourceSummary[] = []
    const failures: unknown[] = []
    let websiteVisual: BrandVisual | null = null
    let pagesAnalysed = 0

    // Each source on its own. A page EVA cannot read is recorded as such and
    // the run continues with whatever else there is.
    for (const kind of ['website', 'facebook', 'instagram'] as const) {
      const source = pages.get(kind)
      if (!source) continue
      try {
        if (kind === 'website') {
          const crawl = await crawlSite(source.url, {
            onProgress: (stage) => void setStage(stage),
          })
          websiteVisual = crawl.brandVisual
          const site = normalizeSite(crawl)
          const thin = crawl.totalTextLength < CRAWL_LIMITS.minTotalTextLength
          const set = websiteEvidence(
            { site, visual: crawl.brandVisual, canonicalUrl: site.startUrl },
            ids,
          )
          evidence.push(...set.evidence)
          candidates.push(...set.visuals)
          pagesAnalysed += site.pageUrls.length
          sources.push(summary('website', site.startUrl, thin ? 'limited' : 'analyzed', site.pageUrls.length))
        } else {
          const profile = await fetchSocialProfile(source)
          const set = socialEvidence({ kind, profile, canonicalUrl: source.url }, ids)
          evidence.push(...set.evidence)
          candidates.push(...set.visuals)
          pagesAnalysed += 1
          sources.push(summary(kind, source.url, 'analyzed', 1))
        }
      } catch (error) {
        failures.push(error)
        sources.push(summary(kind, source.url, statusForFailure(error), 0))
      }
    }
    fetchMs = Date.now() - startedAt

    if (assets.length > 0) {
      const set = assetEvidence(assets, ids)
      evidence.push(...set.evidence)
      candidates.push(...set.visuals)
      sources.push(summary('asset', null, 'analyzed', assets.length))
    }
    for (const source of sources) counts[source.type] = source.status

    const readable = sources.some((source) => source.status === 'analyzed' || source.status === 'limited')
    if (!readable) {
      // Nothing could be read at all: report the first cause the way the
      // website analysis would, so the owner gets a sentence they can act on.
      throw failures[0] ?? new InsufficientContentError()
    }

    await setStage('reading_pages')
    const visuals = await resolveVisualEvidence(
      { candidates: selectVisualCandidates(candidates), businessId, ownerId: uid },
    )

    await setStage('understanding')

    const parts: TurnAttachmentPart[] = visuals.map((visual) => ({
      type: 'input_image',
      imageUrl: visual.dataUrl,
    }))
    const { data, meta } = await runStructuredTask<unknown>({
      task: 'business.analyse_dna',
      uid,
      plan,
      systemPrompt: BUSINESS_DNA_PROMPT,
      input: buildDnaInput({ sources, evidence, visuals }),
      parts,
      schema: {
        name: BUSINESS_DNA_SCHEMA_NAME,
        schema: BUSINESS_DNA_SCHEMA as unknown as Record<string, unknown>,
      },
    })
    modelMs = meta.latencyMs ?? 0

    const analysis = validateBusinessDna(data, {
      imageIds: visuals.map((visual) => visual.id),
      fontNames: evidence.filter((item) => item.kind === 'font').map((item) => item.value),
    })
    assertAnalysisUseful(analysis)

    await setStage('building_brain')

    const now = Date.now()
    const mergeInput = { analysis, sources, evidence, visuals, websiteVisual, now }
    const stamps = analysedSources(sources)
    const primary = primarySource(sources)
    if (!primary) throw new InsufficientContentError()

    const patch = stampAdditionalSources(
      mergeWebsiteAnalysis(stored, analysis, {
        websiteUrl: primary.reference,
        pagesAnalysed,
        now,
        source: primary.kind,
        brandVisual: toBrandVisual(mergeInput),
      }),
      stored,
      stamps.slice(1),
      now,
    )
    const dna = buildBusinessDna(mergeInput)

    await setStage('saving')

    await ref.update({
      ...patch,
      discovery: {
        status: 'complete',
        stage: null,
        lastRunAt: stored.discovery?.lastRunAt ?? now,
        lastAttemptAt: attemptAt,
        completedAt: now,
        sourceRef: primary.kind === 'document' ? stored.discovery?.sourceRef ?? null : primary.reference,
        pagesAnalysed,
        error: null,
        errorCode: null,
        summary: analysis.summary || stored.discovery?.summary || null,
        unknowns: analysis.unknowns,
        dna,
      },
      updatedAt: now,
    })

    // Counts and timings only: no URLs beyond the business id, no corpus, no
    // image bytes, no model output.
    const totalMs = Date.now() - startedAt
    logger.info('Business DNA analysis complete', {
      businessId,
      sources: counts,
      pages: pagesAnalysed,
      assets: assets.length,
      images: visuals.length,
      evidenceChars: evidenceChars(evidence),
      colors: dna.brand.colors.length,
      logo: dna.brand.logoCandidate?.kind ?? null,
      font: dna.brand.typography ? 'named' : null,
      model: meta.model,
      latencyMs: meta.latencyMs,
      fetchMs,
      modelMs,
      totalMs,
    })

    return { businessId, sources }
  } catch (error) {
    if (error instanceof HttpsError) {
      await recordFailure(ref, { code: 'ai_unavailable', message: error.message }).catch(
        () => undefined,
      )
      throw error
    }

    const failure = classify(error)
    await recordFailure(ref, failure).catch(() => undefined)

    if (error instanceof AiNotConfiguredError) throw notConfigured()

    logger.warn('Business DNA analysis failed', {
      businessId,
      code: failure.code,
      sources: counts,
      fetchMs,
      modelMs,
      totalMs: Date.now() - startedAt,
      cause: error instanceof Error ? error.message : String(error),
    })

    if (failure.code === 'internal') throw internal('businessAnalyseDna', error)
    throw new HttpsError('failed-precondition', failure.message)
  }
}

/* --- request + sources -------------------------------------------------- */

function parseRequest(data: unknown): { businessId: string; links: string[] } {
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
  const businessId = record['businessId']
  if (!businessId || typeof businessId !== 'string') {
    throw invalidArgument('A businessId is required.')
  }
  const raw = record['links']
  if (raw !== undefined && !Array.isArray(raw)) {
    throw invalidArgument('links must be a list of page addresses.')
  }
  const links = ((raw as unknown[] | undefined) ?? []).map((link) => {
    if (typeof link !== 'string' || link.length > MAX_LINK_CHARS) {
      throw invalidArgument('That does not look like a valid website or social page link.')
    }
    return link.trim()
  })
  if (links.length > MAX_LINKS) {
    throw invalidArgument(`Add at most ${MAX_LINKS} links at a time.`)
  }
  return { businessId, links: links.filter(Boolean) }
}

/**
 * One page per kind. The stored business supplies its own — the website on
 * file, the social profiles it lists, the pages discovery already read —
 * and a request link adds or replaces the entry for its kind. Every URL,
 * stored or requested, passes through `detectDiscoverySource` here: a value
 * that no longer normalises is dropped rather than fetched.
 */
function resolvePageSources(
  stored: StoredBusiness,
  links: string[],
): Map<DiscoverySourceKind, DiscoverySource> {
  const pages = new Map<DiscoverySourceKind, DiscoverySource>()

  const consider = (raw: string | null | undefined) => {
    if (!raw) return
    try {
      const source = detectDiscoverySource(raw)
      if (!pages.has(source.kind)) pages.set(source.kind, source)
    } catch {
      // A stored value that fails today's checks is not fetched. Quietly.
    }
  }

  consider(stored.contact?.website)
  for (const profile of stored.contact?.socialProfiles ?? []) consider(profile.url)
  for (const source of stored.sources ?? []) {
    if (source.kind === 'facebook' || source.kind === 'instagram' || source.kind === 'website') {
      consider(source.reference)
    }
  }
  consider(stored.discovery?.sourceRef)

  for (const link of links) {
    let source: DiscoverySource
    try {
      source = detectDiscoverySource(link)
    } catch (error) {
      if (error instanceof UnsupportedSocialUrlError) throw invalidArgument(error.userMessage)
      if (error instanceof InvalidUrlError) {
        throw invalidArgument('That does not look like a valid website or social page link.')
      }
      throw internal('businessAnalyseDna:url', error)
    }
    pages.set(source.kind, source)
  }

  return pages
}

/**
 * Assets the owner cleared for AI use: active, allowAiUse, inside their own
 * business's storage prefix. Images AND documents — a menu PDF is evidence
 * of what the business sells even though it is never a poster.
 */
async function listDnaAssets(businessId: string, ownerId: string): Promise<AssetForEvidence[]> {
  const snapshot = await db
    .collection(COLLECTIONS.assets)
    .where('businessId', '==', businessId)
    .where('ownerId', '==', ownerId)
    .get()

  return snapshot.docs
    .map((doc) => ({ id: doc.id, asset: doc.data() as StoredAsset }))
    .filter(
      ({ asset }) =>
        asset.status === 'active' &&
        asset.allowAiUse === true &&
        isPathWithinBusiness(asset.storagePath, asset.businessId),
    )
    .sort((a, b) => a.asset.createdAt - b.asset.createdAt || a.id.localeCompare(b.id))
    .slice(0, MAX_ASSETS)
}

function summary(
  type: DnaSourceType,
  reference: string | null,
  status: DnaSourceStatus,
  count: number,
): DnaSourceSummary {
  return { type, reference, status, count }
}

/**
 * Inaccessible means "EVA could not see it" — a login wall, a blocked host
 * — and says nothing about the business. Everything else is a failure of
 * this attempt. Neither is "the business has no such page".
 */
function statusForFailure(error: unknown): DnaSourceStatus {
  if (
    error instanceof NotPublicError ||
    error instanceof BlockedHostError ||
    error instanceof UnresolvableHostError ||
    error instanceof InvalidUrlError
  ) {
    return 'inaccessible'
  }
  if (error instanceof InsufficientContentError) return 'limited'
  return 'failed'
}
