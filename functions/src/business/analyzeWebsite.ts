import { onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { requireBusinessOwner, requireUid, resolvePlanForUser } from '../lib/auth'
import { internal, invalidArgument, notConfigured } from '../lib/errors'
import { COLLECTIONS, db } from '../lib/firebase'
import type {
  DiscoveryErrorCode,
  DiscoveryStage,
  RunWebsiteAnalysisRequest,
  RunWebsiteAnalysisResponse,
  StartWebsiteAnalysisRequest,
  StartWebsiteAnalysisResponse,
  StoredBusiness,
} from '../lib/business.types'
import { OPENAI_API_KEY } from '../ai/openai.client'
import { AiServiceError } from '../ai/errors'
import {
  AiNotConfiguredError,
  AiResponseError,
  runStructuredTask,
} from '../ai/orchestrator'
import { BUSINESS_ANALYSIS_PROMPT, buildWebsiteAnalysisInput } from '../ai/prompts/business'
import { HttpsError } from 'firebase-functions/v2/https'
import { CRAWL_LIMITS, crawlSite, SiteUnreachableError } from './website/crawl'
import { normalizeSite } from './website/normalize'
import { InvalidUrlError, normalizeWebsiteUrl } from './website/url'
import { BlockedHostError, UnresolvableHostError } from './website/guard'
import { emptyBrain } from './brain/empty'
import { linkBusinessToUser } from './onboardingState'
import { mergeWebsiteAnalysis } from './brain/merge'
import { WEBSITE_ANALYSIS_SCHEMA, WEBSITE_ANALYSIS_SCHEMA_NAME } from './brain/schema'
import {
  AnalysisValidationError,
  assertAnalysisUseful,
  InsufficientContentError,
  validateWebsiteAnalysis,
  type WebsiteAnalysis,
} from './brain/validate'

/**
 * Website analysis, split across two callables.
 *
 * `businessStartWebsiteAnalysis` is fast: it validates the URL, finds or
 * creates the business, marks it as running, and returns the id. The client
 * then subscribes to that document.
 *
 * `businessRunWebsiteAnalysis` does the slow work and writes each stage to the
 * document as it *actually* reaches it. That is why the onboarding screen can
 * say "Finding your products…" honestly instead of animating a fake sequence
 * against a single opaque request.
 *
 * The client never supplies the URL to the second call — it is read back from
 * the document, which the first call validated. A tampered client therefore
 * cannot smuggle a different target into the fetch.
 */

/** One user does not need dozens of businesses; this bounds abuse of the crawler. */
const MAX_BUSINESSES_PER_USER = 5

/** Minimum gap between analyses of the same business. */
const REANALYSIS_COOLDOWN_MS = 15_000

export const businessStartWebsiteAnalysis = onCall(
  {
    region: 'asia-southeast1',
    timeoutSeconds: 30,
    memory: '256MiB',
    maxInstances: 10,
    cors: true,
  },
  async (
    request: CallableRequest<StartWebsiteAnalysisRequest>,
  ): Promise<StartWebsiteAnalysisResponse> => {
    const uid = requireUid(request)
    const { websiteUrl, businessId } = request.data ?? {}

    let normalizedUrl: string
    try {
      normalizedUrl = normalizeWebsiteUrl(String(websiteUrl ?? ''))
    } catch (error) {
      if (error instanceof InvalidUrlError) {
        throw invalidArgument('That does not look like a valid website address.')
      }
      throw internal('businessStartWebsiteAnalysis:url', error)
    }

    const businesses = db.collection(COLLECTIONS.businesses)
    const now = Date.now()

    // Idempotency: re-analysing a URL updates the business that already holds
    // it rather than creating a second copy of the same restaurant.
    let targetId = typeof businessId === 'string' && businessId ? businessId : null
    let existing: StoredBusiness | null = null

    if (targetId) {
      existing = (await requireBusinessOwner(targetId, uid)) as StoredBusiness | null
      if (!existing) throw invalidArgument('That business no longer exists.')
    } else {
      const owned = await businesses.where('ownerId', '==', uid).limit(20).get()
      const match = owned.docs.find(
        (doc) => sameSiteUrl((doc.data() as StoredBusiness).contact?.website, normalizedUrl),
      )
      if (match) {
        targetId = match.id
        existing = match.data() as StoredBusiness
      } else if (owned.size >= MAX_BUSINESSES_PER_USER) {
        throw invalidArgument(
          'You have reached the maximum number of businesses for this account.',
        )
      }
    }

    const reanalysis = existing?.discovery?.status === 'complete'

    const runningDiscovery = {
      status: 'running' as const,
      stage: 'fetching' as DiscoveryStage,
      lastRunAt: now,
      completedAt: existing?.discovery?.completedAt ?? null,
      sourceRef: normalizedUrl,
      pagesAnalysed: existing?.discovery?.pagesAnalysed ?? 0,
      error: null,
      errorCode: null,
      summary: existing?.discovery?.summary ?? null,
      unknowns: existing?.discovery?.unknowns ?? [],
    }

    if (targetId) {
      await businesses.doc(targetId).update({
        discovery: runningDiscovery,
        'contact.website': normalizedUrl,
        updatedAt: now,
      })
    } else {
      const brain = emptyBrain(uid, fallbackNameFor(normalizedUrl), now)
      brain.contact.website = normalizedUrl
      brain.discovery = runningDiscovery
      const created = await businesses.add(brain)
      targetId = created.id
    }

    // Deliberately NOT linked into `users/{uid}` yet. The link is written by
    // `businessRunWebsiteAnalysis` only once the analysis succeeds — linking
    // here left a provisional business orphaned in the profile's
    // `businessIds` (and selected as `activeBusinessId`) whenever the
    // analysis failed or was abandoned. Ownership checks and the client's
    // live subscription go by `ownerId` on the document itself, so nothing
    // between start and completion needs the profile index.

    return { businessId: targetId, websiteUrl: normalizedUrl, reanalysis }
  },
)

export const businessRunWebsiteAnalysis = onCall(
  {
    region: 'asia-southeast1',
    secrets: [OPENAI_API_KEY],
    // A six-page crawl plus a reasoning-tier model call. Bounded, but not fast.
    timeoutSeconds: 300,
    memory: '1GiB',
    // Crawling is the most expensive thing MARKA does; keep the ceiling low.
    maxInstances: 5,
    cors: true,
  },
  async (
    request: CallableRequest<RunWebsiteAnalysisRequest>,
  ): Promise<RunWebsiteAnalysisResponse> => {
    const uid = requireUid(request)
    const businessId = request.data?.businessId

    if (!businessId || typeof businessId !== 'string') {
      throw invalidArgument('A businessId is required.')
    }

    const stored = (await requireBusinessOwner(businessId, uid)) as StoredBusiness | null
    if (!stored) throw invalidArgument('That business no longer exists.')

    // The URL comes from the document the previous call validated, never from
    // this request's payload.
    const websiteUrl = stored.discovery?.sourceRef ?? stored.contact?.website
    if (!websiteUrl) {
      throw invalidArgument('This business has no website to analyse.')
    }

    const completedAt = stored.discovery?.completedAt ?? 0
    if (stored.discovery?.status === 'complete' && Date.now() - completedAt < REANALYSIS_COOLDOWN_MS) {
      throw new HttpsError('resource-exhausted', 'MARKA just analysed this website. Please wait a moment.')
    }

    const ref = db.collection(COLLECTIONS.businesses).doc(businessId)
    const setStage = (stage: DiscoveryStage) =>
      ref.update({ 'discovery.stage': stage, updatedAt: Date.now() }).catch((error: unknown) => {
        // Progress reporting must never be able to fail the analysis itself.
        logger.warn('Could not write discovery stage', { businessId, stage, error })
      })

    /**
     * Stage timings, so a slow analysis can be explained rather than guessed
     * at. Crawling a site and reasoning about it fail slowly in very different
     * ways, and the totals alone cannot tell them apart. Durations only — no
     * URLs beyond the one already logged, no page content.
     */
    const startedAt = Date.now()
    let crawlMs = 0
    let modelMs = 0

    try {
      const crawl = await crawlSite(websiteUrl, {
        onProgress: (stage) => void setStage(stage),
      })
      crawlMs = Date.now() - startedAt

      if (crawl.totalTextLength < CRAWL_LIMITS.minTotalTextLength) {
        throw new InsufficientContentError()
      }

      await setStage('understanding')
      const site = normalizeSite(crawl)

      const { data, meta } = await runStructuredTask<unknown>({
        task: 'business.analyse_website',
        // Server-resolved plan; the request payload has no say in model choice.
        plan: await resolvePlanForUser(uid),
        systemPrompt: BUSINESS_ANALYSIS_PROMPT,
        input: buildWebsiteAnalysisInput({
          websiteUrl: site.startUrl,
          pageCount: site.pageUrls.length,
          corpus: site.corpus,
          signals: site.signals,
        }),
        schema: {
          name: WEBSITE_ANALYSIS_SCHEMA_NAME,
          schema: WEBSITE_ANALYSIS_SCHEMA as unknown as Record<string, unknown>,
        },
      })
      modelMs = meta.latencyMs ?? 0

      const analysis: WebsiteAnalysis = validateWebsiteAnalysis(data)
      assertAnalysisUseful(analysis)

      await setStage('building_brain')

      const now = Date.now()
      const patch = mergeWebsiteAnalysis(stored, analysis, {
        websiteUrl: site.startUrl,
        pagesAnalysed: site.pageUrls.length,
        now,
      })

      await setStage('saving')

      await ref.update({
        ...patch,
        discovery: {
          status: 'complete',
          stage: null,
          lastRunAt: stored.discovery?.lastRunAt ?? now,
          completedAt: now,
          sourceRef: site.startUrl,
          pagesAnalysed: site.pageUrls.length,
          error: null,
          errorCode: null,
          summary: analysis.summary || null,
          unknowns: analysis.unknowns,
        },
        updatedAt: now,
      })

      await linkBusinessToUser(uid, businessId, 'reviewing_discovery')

      const totalMs = Date.now() - startedAt
      logger.info('Website analysis complete', {
        businessId,
        pages: site.pageUrls.length,
        products: analysis.products.length,
        corpusChars: site.charCount,
        model: meta.model,
        latencyMs: meta.latencyMs,
        // Where the owner's wait actually went. `ai.request.complete` carries
        // the token counts that explain the model's share of it.
        crawlMs,
        modelMs,
        totalMs,
        overheadMs: Math.max(totalMs - crawlMs - modelMs, 0),
      })

      return {
        businessId,
        pagesAnalysed: site.pageUrls.length,
        productsFound: analysis.products.length,
      }
    } catch (error) {
      const failure = classify(error)
      await recordFailure(ref, failure).catch(() => undefined)

      if (error instanceof AiNotConfiguredError) throw notConfigured()

      logger.warn('Website analysis failed', {
        businessId,
        code: failure.code,
        crawlMs,
        modelMs,
        totalMs: Date.now() - startedAt,
        // The precise transport reason stays here and only here. It is what
        // makes "MARKA can't read my site" answerable without guesswork.
        reason: error instanceof SiteUnreachableError ? error.reason : null,
        cause: error instanceof Error ? error.message : String(error),
      })

      if (failure.code === 'internal') {
        throw internal('businessRunWebsiteAnalysis', error)
      }
      throw new HttpsError('failed-precondition', failure.message)
    }
  },
)

/* --- helpers ----------------------------------------------------------- */

interface AnalysisFailure {
  code: DiscoveryErrorCode
  message: string
}

/**
 * Maps an internal cause to something a restaurant owner can act on.
 *
 * Nothing from the provider, the stack or the network layer reaches the
 * client — only these five messages.
 */
function classify(error: unknown): AnalysisFailure {
  if (error instanceof InvalidUrlError) {
    return { code: 'invalid_url', message: 'That does not look like a valid website address.' }
  }
  if (error instanceof BlockedHostError) {
    return { code: 'invalid_url', message: 'That address is not a public website.' }
  }
  if (error instanceof UnresolvableHostError) {
    return {
      code: 'unreachable',
      message: 'I could not access this website. Check the address and try again.',
    }
  }
  if (error instanceof SiteUnreachableError) {
    return { code: 'unreachable', message: unreachableMessage(error.reason) }
  }
  if (error instanceof InsufficientContentError) {
    return {
      code: 'insufficient_content',
      message: 'I could not find enough information to confidently understand this business.',
    }
  }
  // A provider failure has already been classified and stripped of anything
  // internal; `userMessage` is the whole of what may be shown.
  if (error instanceof AiServiceError) {
    if (error.kind === 'billing') {
      return { code: 'ai_unavailable', message: error.userMessage }
    }
    if (error.kind === 'rate_limit') {
      return { code: 'ai_busy', message: error.userMessage }
    }
    return { code: 'ai_failed', message: error.userMessage }
  }
  if (error instanceof AiResponseError || error instanceof AnalysisValidationError) {
    return {
      code: 'ai_failed',
      message: 'MARKA could not finish analysing the business right now. Please try again.',
    }
  }
  if (error instanceof AiNotConfiguredError) {
    return { code: 'ai_failed', message: 'MARKA’s AI backend is not configured yet.' }
  }
  return { code: 'internal', message: 'MARKA ran into a problem. Please try again.' }
}

/**
 * Owner-facing wording for a site that could not be read.
 *
 * The crawler distinguishes far more cases than this (see `PageFetchFailure`),
 * and deliberately so — but an owner needs an action, not a diagnosis. Only
 * the reasons they can actually do something about get their own sentence; the
 * rest share one honest, generic message. No status code, host, library name
 * or error string is ever passed through.
 */
function unreachableMessage(reason: string): string {
  switch (reason) {
    case 'tls':
      return "This website's security certificate could not be verified, so I stopped rather than read it. Your web host can renew or reinstall it."
    case 'blocked':
      return 'This website refused to let MARKA read it. Your web host or security plugin may be blocking automated visitors.'
    case 'timeout':
      return 'This website took too long to respond. Try again in a moment.'
    case 'not_html':
      return 'That address did not return a web page I could read.'
    case 'too_large':
      return 'This website’s home page is too large for me to read.'
    default:
      return 'I could not access this website. Check the address and try again.'
  }
}

async function recordFailure(
  ref: FirebaseFirestore.DocumentReference,
  failure: AnalysisFailure,
): Promise<void> {
  await ref.update({
    'discovery.status': 'failed',
    'discovery.stage': null,
    'discovery.error': failure.message,
    'discovery.errorCode': failure.code,
    updatedAt: Date.now(),
  })
}

/** Two URLs point at the same site when their hosts match. */
function sameSiteUrl(stored: string | null | undefined, candidate: string): boolean {
  if (!stored) return false
  try {
    const a = new URL(stored).hostname.toLowerCase().replace(/^www\./, '')
    const b = new URL(candidate).hostname.toLowerCase().replace(/^www\./, '')
    return a === b
  } catch {
    return false
  }
}

/** A readable placeholder until the analysis supplies the real name. */
function fallbackNameFor(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    const label = host.split('.')[0] ?? host
    return label
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || host
  } catch {
    return 'My business'
  }
}
