import { onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { requireBusinessOwner, requireUid, resolvePlanForUser } from '../lib/auth'
import { internal, invalidArgument, notConfigured } from '../lib/errors'
import { classify, recordFailure, REANALYSIS_COOLDOWN_MS } from './discoveryFailure'
import { COLLECTIONS, db } from '../lib/firebase'
import type {
  DiscoveryStage,
  RunWebsiteAnalysisRequest,
  RunWebsiteAnalysisResponse,
  StartWebsiteAnalysisRequest,
  StartWebsiteAnalysisResponse,
  StoredBusiness,
} from '../lib/business.types'
import { OPENAI_API_KEY } from '../ai/openai.client'
import { AiNotConfiguredError, runStructuredTask } from '../ai/orchestrator'
import {
  BUSINESS_ANALYSIS_PROMPT,
  buildSocialAnalysisInput,
  buildWebsiteAnalysisInput,
} from '../ai/prompts/business'
import { assertRequestBudgetRemains } from '../usage/guardrail'
import { HttpsError } from 'firebase-functions/v2/https'
import { CRAWL_LIMITS, crawlSite, SiteUnreachableError } from './website/crawl'
import type { BrandVisual } from './website/brandVisual'
import { normalizeSite } from './website/normalize'
import { InvalidUrlError } from './website/url'
import {
  detectDiscoverySource,
  UnsupportedSocialUrlError,
  type DiscoverySource,
} from './discovery/source'
import { fetchSocialProfile } from './discovery/fetchSocial'
import { emptyBrain } from './brain/empty'
import { linkBusinessToUser } from './onboardingState'
import { mergeWebsiteAnalysis } from './brain/merge'
import { WEBSITE_ANALYSIS_SCHEMA, WEBSITE_ANALYSIS_SCHEMA_NAME } from './brain/schema'
import {
  assertAnalysisUseful,
  InsufficientContentError,
  validateWebsiteAnalysis,
  type WebsiteAnalysis,
} from './brain/validate'

/**
 * Business discovery, split across two callables.
 *
 * The owner gives ONE link — a website, a public Facebook Page, or an
 * Instagram profile. What kind of link it is gets decided deterministically
 * (see `discovery/source.ts`); the fetch-and-understand flow is then the same
 * shape either way, and everything downstream — quota, cooldown, provenance,
 * fallback to the manual flow — is shared.
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

    let source: DiscoverySource
    try {
      source = detectDiscoverySource(String(websiteUrl ?? ''))
    } catch (error) {
      if (error instanceof UnsupportedSocialUrlError) {
        throw invalidArgument(error.userMessage)
      }
      if (error instanceof InvalidUrlError) {
        throw invalidArgument('That does not look like a valid website or social page link.')
      }
      throw internal('businessStartWebsiteAnalysis:url', error)
    }
    const normalizedUrl = source.url

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
      // A website matches by host — any page of the same site is the same
      // business. A social page matches only its exact canonical URL: every
      // Facebook Page shares facebook.com, so host matching would fold every
      // business on the platform into one.
      const match = owned.docs.find((doc) => {
        const data = doc.data() as StoredBusiness
        return source.kind === 'website'
          ? sameSiteUrl(data.contact?.website, normalizedUrl)
          : data.discovery?.sourceRef === normalizedUrl
      })
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
      // Preserved, not reset: the cooldown in the run callable keys on this,
      // and a start→run loop must not be able to launder it away.
      lastAttemptAt: existing?.discovery?.lastAttemptAt ?? null,
      completedAt: existing?.discovery?.completedAt ?? null,
      sourceRef: normalizedUrl,
      pagesAnalysed: existing?.discovery?.pagesAnalysed ?? 0,
      error: null,
      errorCode: null,
      summary: existing?.discovery?.summary ?? null,
      unknowns: existing?.discovery?.unknowns ?? [],
    }

    if (targetId) {
      const update: Record<string, unknown> = { discovery: runningDiscovery, updatedAt: now }
      // A Facebook Page or Instagram profile is never the business's website.
      if (source.kind === 'website') update['contact.website'] = normalizedUrl
      await businesses.doc(targetId).update(update)
    } else {
      const brain = emptyBrain(uid, fallbackNameFor(source), now)
      if (source.kind === 'website') brain.contact.website = normalizedUrl
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
    // this request's payload. It is re-validated here all the same: the fetch
    // must never run on anything that has not just passed the URL checks.
    const websiteUrl = stored.discovery?.sourceRef ?? stored.contact?.website
    if (!websiteUrl) {
      throw invalidArgument('This business has no website to analyse.')
    }
    let source: DiscoverySource
    try {
      source = detectDiscoverySource(websiteUrl)
    } catch {
      throw invalidArgument('This business has no valid page to analyse.')
    }

    // Attempt-based cooldown (Phase 6B). The old check keyed on
    // `status === 'complete'`, so a FAILED analysis could be retried in a
    // tight loop, each retry paying for a crawl and a reasoning call. Any
    // attempt — success, failure or timeout — now starts the clock, because
    // `lastAttemptAt` is written below before the crawl begins.
    const lastAttemptAt = Math.max(
      stored.discovery?.lastAttemptAt ?? 0,
      stored.discovery?.completedAt ?? 0,
    )
    if (Date.now() - lastAttemptAt < REANALYSIS_COOLDOWN_MS) {
      throw new HttpsError(
        'resource-exhausted',
        'Please wait before starting another website analysis.',
      )
    }

    // Server-resolved plan; the request payload has no say in model choice.
    const plan = await resolvePlanForUser(uid)

    // The crawl is the expensive pre-model work, so today's analysis budget
    // is checked before it runs. Advisory only — the atomic reservation
    // inside the orchestrator remains the authority.
    await assertRequestBudgetRemains({ uid, plan, task: 'business.analyse_website' })

    const ref = db.collection(COLLECTIONS.businesses).doc(businessId)

    // The attempt starts NOW, before the crawl — a failed or timed-out run
    // must still hold the next attempt to the cooldown.
    const attemptAt = Date.now()
    await ref.update({ 'discovery.lastAttemptAt': attemptAt, updatedAt: attemptAt })
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
      // Both branches end at the same place: the URL that was actually read,
      // how many pages that was, and the model's input. Everything after —
      // model call, validation, merge, quotas — is one path.
      let analysedUrl: string
      let pagesAnalysed: number
      let corpusChars: number
      let modelInput: string
      // Deterministic visuals from the homepage HTML the crawler already
      // fetched. A social page offers none — its icons are the platform's.
      let brandVisual: BrandVisual | null = null

      if (source.kind === 'website') {
        const crawl = await crawlSite(websiteUrl, {
          onProgress: (stage) => void setStage(stage),
        })
        crawlMs = Date.now() - startedAt

        if (crawl.totalTextLength < CRAWL_LIMITS.minTotalTextLength) {
          throw new InsufficientContentError()
        }

        brandVisual = crawl.brandVisual

        const site = normalizeSite(crawl)
        analysedUrl = site.startUrl
        pagesAnalysed = site.pageUrls.length
        corpusChars = site.charCount
        modelInput = buildWebsiteAnalysisInput({
          websiteUrl: site.startUrl,
          pageCount: site.pageUrls.length,
          corpus: site.corpus,
          signals: site.signals,
        })
      } else {
        // One public page, fetched through the same SSRF-guarded fetcher the
        // crawler uses — DNS re-checked, every redirect hop re-validated. No
        // login, no session, no API: only what an anonymous visitor sees.
        // The platforms answer anonymous readers inconsistently, so a
        // recoverable miss gets one bounded retry (see discovery/fetchSocial).
        const social = await fetchSocialProfile(source)
        crawlMs = Date.now() - startedAt

        analysedUrl = source.url
        pagesAnalysed = 1
        corpusChars = social.corpus.length
        modelInput = buildSocialAnalysisInput({
          kind: source.kind,
          profileUrl: source.url,
          corpus: social.corpus,
          signals: social.signals,
        })
      }

      await setStage('understanding')

      const { data, meta } = await runStructuredTask<unknown>({
        task: 'business.analyse_website',
        uid,
        plan,
        systemPrompt: BUSINESS_ANALYSIS_PROMPT,
        input: modelInput,
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
        websiteUrl: analysedUrl,
        pagesAnalysed,
        now,
        source: source.kind,
        brandVisual,
      })

      await setStage('saving')

      await ref.update({
        ...patch,
        discovery: {
          status: 'complete',
          stage: null,
          lastRunAt: stored.discovery?.lastRunAt ?? now,
          lastAttemptAt: attemptAt,
          completedAt: now,
          sourceRef: analysedUrl,
          pagesAnalysed,
          error: null,
          errorCode: null,
          summary: analysis.summary || null,
          unknowns: analysis.unknowns,
          // The Business DNA report (Phase 7E) belongs to its own run; a
          // website re-analysis neither refreshes nor erases it.
          dna: stored.discovery?.dna ?? null,
        },
        updatedAt: now,
      })

      await linkBusinessToUser(uid, businessId, 'reviewing_discovery')

      const totalMs = Date.now() - startedAt
      logger.info('Website analysis complete', {
        businessId,
        sourceKind: source.kind,
        pages: pagesAnalysed,
        products: analysis.products.length,
        corpusChars,
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
        pagesAnalysed,
        productsFound: analysis.products.length,
      }
    } catch (error) {
      // A usage-guardrail block (thrown inside runStructuredTask) already
      // carries the sentence the owner should read. The attempt is recorded
      // as failed — the crawl ran, the cooldown holds — and the error passes
      // through unwrapped.
      if (error instanceof HttpsError) {
        await recordFailure(ref, { code: 'ai_unavailable', message: error.message }).catch(
          () => undefined,
        )
        throw error
      }

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
function fallbackNameFor(source: DiscoverySource): string {
  try {
    const url = new URL(source.url)

    if (source.kind === 'website') {
      const host = url.hostname.replace(/^www\./, '')
      const label = host.split('.')[0] ?? host
      return titleCase(label) || host
    }

    // For a social page the hostname would say "Facebook"; the page name or
    // handle in the path is the business. Numeric ids name nothing.
    const handle = url.pathname
      .split('/')
      .filter((segment) => segment && segment !== 'pages' && !/^\d+$/.test(segment))
      .pop()
    if (!handle || handle === 'profile.php') return 'My business'
    return titleCase(handle) || 'My business'
  } catch {
    return 'My business'
  }
}

function titleCase(label: string): string {
  return label
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
