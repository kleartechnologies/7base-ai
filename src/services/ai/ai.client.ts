import { httpsCallable, type HttpsCallableResult } from 'firebase/functions'
import { FirebaseError } from 'firebase/app'
import { t } from '@/i18n/store'
import type { MessageKey } from '@/i18n/translate'
import { getFirebaseFunctions } from '@/lib/firebase/app'
import type {
  AiError,
  AiErrorCode,
  AiResult,
  AssistantReplyRequest,
  AssistantReplyResponse,
  AssistantReplyStreamChunk,
  BuildCampaignRequest,
  BuildCampaignResponse,
  DownloadCreativeImageRequest,
  DownloadCreativeImageResponse,
  GenerateCreativeRequest,
  GenerateCreativeResponse,
  RetryCreativeImageRequest,
  RetryCreativeImageResponse,
  SaveAttachmentToAssetsRequest,
  SaveAttachmentToAssetsResponse,
  RunWebsiteAnalysisRequest,
  RunWebsiteAnalysisResponse,
  StartWebsiteAnalysisRequest,
  StartWebsiteAnalysisResponse,
} from './ai.types'

/**
 * The frontend's only door to MARKA's intelligence.
 *
 * There is no OpenAI SDK in this bundle and no API key in this codebase.
 * Every AI request is an authenticated call to a Cloud Function, which holds
 * the key, owns the prompts and writes the result to Firestore.
 *
 * Adding a capability means adding a function here, not an API call in a
 * component.
 */

/** Callable function names, mirrored in `functions/src/index.ts`. */
const CALLABLES = {
  assistantReply: 'chatAssistantReply',
  buildCampaign: 'campaignBuildFromRecommendation',
  generateCreative: 'creativeGenerateFromCampaign',
  retryCreativeImage: 'creativeRetryImage',
  downloadCreativeImage: 'creativeDownloadImage',
  startWebsiteAnalysis: 'businessStartWebsiteAnalysis',
  runWebsiteAnalysis: 'businessRunWebsiteAnalysis',
  saveAttachmentToAssets: 'chatSaveAttachmentToAssets',
} as const

/** Cloud Functions error codes → the app's smaller, actionable set. */
const ERROR_CODE_MAP: Record<string, AiErrorCode> = {
  'functions/unauthenticated': 'unauthenticated',
  'functions/permission-denied': 'permission_denied',
  'functions/failed-precondition': 'not_configured',
  'functions/resource-exhausted': 'rate_limited',
  'functions/deadline-exceeded': 'timeout',
  'functions/unavailable': 'unavailable',
  'functions/invalid-argument': 'invalid_request',
  'functions/not-found': 'unavailable',
  'functions/internal': 'unknown',
}

/**
 * Dictionary keys, resolved through the i18n store at the moment the error is
 * built, so fallback sentences come out in the active UI language. Messages
 * the backend authored itself still pass through untranslated — changing the
 * callable error protocol is beyond the client's remit.
 */
const FALLBACK_MESSAGE_KEYS: Record<AiErrorCode, MessageKey> = {
  unauthenticated: 'aiError.unauthenticated',
  permission_denied: 'aiError.permissionDenied',
  not_configured: 'aiError.notConfigured',
  rate_limited: 'aiError.rateLimited',
  timeout: 'aiError.timeout',
  unavailable: 'aiError.unavailable',
  invalid_request: 'aiError.invalidRequest',
  unknown: 'aiError.unknown',
}

function toAiError(error: unknown): AiError {
  if (error instanceof FirebaseError) {
    const code = ERROR_CODE_MAP[error.code] ?? 'unknown'
    // Prefer the backend's own message when it wrote one for the user.
    const message = error.message && !error.message.startsWith('INTERNAL')
      ? error.message
      : t(FALLBACK_MESSAGE_KEYS[code])
    return { code, message }
  }
  return { code: 'unknown', message: t(FALLBACK_MESSAGE_KEYS.unknown) }
}

/** Callable default is 70s; website analysis legitimately runs longer. */
const ANALYSIS_TIMEOUT_MS = 300_000

async function call<TRequest, TResponse>(
  name: string,
  payload: TRequest,
  timeoutMs?: number,
): Promise<AiResult<TResponse>> {
  try {
    const callable = httpsCallable<TRequest, TResponse>(
      getFirebaseFunctions(),
      name,
      timeoutMs ? { timeout: timeoutMs } : undefined,
    )
    const result: HttpsCallableResult<TResponse> = await callable(payload)
    return { ok: true, data: result.data }
  } catch (error) {
    return { ok: false, error: toAiError(error) }
  }
}

/**
 * Asks the backend to generate MARKA's reply to a stored user message.
 *
 * Resolves once the request is accepted. The assistant message itself arrives
 * through the Firestore subscription in the chat view.
 */
export function requestAssistantReply(
  request: AssistantReplyRequest,
): Promise<AiResult<AssistantReplyResponse>> {
  return call<AssistantReplyRequest, AssistantReplyResponse>(CALLABLES.assistantReply, request)
}

/**
 * The reply generation itself can outlast the 70s callable default: the
 * slowest chat path is a conversational visual edit (fast-tier copy call
 * plus an image call, up to 420s of model time at worst case), and the
 * function allows 540s in total, so the client-side deadline matches the
 * function's rather than abandoning a reply that is still being billed.
 */
const ASSISTANT_REPLY_TIMEOUT_MS = 540_000

/**
 * Like {@link requestAssistantReply}, but delivered live: text deltas arrive
 * through `onDelta` while EVA is composing, and the promise resolves with the
 * final response once the reply is complete and stored.
 *
 * Streaming is delivery only. The backend decides the model, enforces plan
 * and usage limits, and writes the assistant message exactly as on the
 * non-streamed path — a reply whose kind doesn't stream (a recommendation, a
 * campaign or creative edit) simply yields no chunks before resolving.
 *
 * If the stream breaks mid-reply, the caller gets `{ ok: false }`; any text
 * already forwarded through `onDelta` must be treated as interrupted, not as
 * EVA's finished answer.
 */
export async function streamAssistantReply(
  request: AssistantReplyRequest,
  onDelta: (text: string) => void,
): Promise<AiResult<AssistantReplyResponse>> {
  try {
    const callable = httpsCallable<
      AssistantReplyRequest,
      AssistantReplyResponse,
      AssistantReplyStreamChunk
    >(getFirebaseFunctions(), CALLABLES.assistantReply, { timeout: ASSISTANT_REPLY_TIMEOUT_MS })
    const { stream, data } = await callable.stream(request)
    try {
      for await (const chunk of stream) {
        if (chunk?.type === 'delta' && typeof chunk.text === 'string') {
          onDelta(chunk.text)
        }
      }
    } catch {
      // A broken stream surfaces its real error (with a proper code) through
      // the `data` promise below; iteration failures carry no extra signal.
    }
    return { ok: true, data: await data }
  } catch (error) {
    return { ok: false, error: toAiError(error) }
  }
}

/** Build may wait out fast-tier retries; give it more than the 70s default. */
const BUILD_CAMPAIGN_TIMEOUT_MS = 240_000

/**
 * Asks the backend to turn a recommendation the user owns into a campaign
 * draft. Resolves with the new campaign id; the confirmation message and its
 * campaign card arrive through the conversation's Firestore subscription.
 */
export function buildCampaignFromRecommendation(
  request: BuildCampaignRequest,
): Promise<AiResult<BuildCampaignResponse>> {
  return call<BuildCampaignRequest, BuildCampaignResponse>(
    CALLABLES.buildCampaign,
    request,
    BUILD_CAMPAIGN_TIMEOUT_MS,
  )
}

/** Copy plus an image-tier call; well past the 70s callable default. */
const GENERATE_CREATIVE_TIMEOUT_MS = 540_000

/** Image regeneration only. */
const RETRY_CREATIVE_IMAGE_TIMEOUT_MS = 300_000

/**
 * Asks the backend to turn a campaign the user owns into marketing materials
 * — a poster plus captions. Resolves with the new creative id; the preview
 * message arrives through the conversation's Firestore subscription.
 */
export function generateCreativeMaterials(
  request: GenerateCreativeRequest,
): Promise<AiResult<GenerateCreativeResponse>> {
  return call<GenerateCreativeRequest, GenerateCreativeResponse>(
    CALLABLES.generateCreative,
    request,
    GENERATE_CREATIVE_TIMEOUT_MS,
  )
}

/**
 * Retries only the poster image of an existing creative. The copy and the
 * owner's edits are untouched by design.
 */
export function retryCreativeImage(
  request: RetryCreativeImageRequest,
): Promise<AiResult<RetryCreativeImageResponse>> {
  return call<RetryCreativeImageRequest, RetryCreativeImageResponse>(
    CALLABLES.retryCreativeImage,
    request,
    RETRY_CREATIVE_IMAGE_TIMEOUT_MS,
  )
}

/**
 * Fetches the poster image (and logo) bytes of a creative the user owns.
 * The fallback path for "Download Poster": used only when the browser cannot
 * read the image from Storage cross-origin. Not an AI call — no model, no
 * usage cost — but it goes through the same authenticated door as the rest.
 */
export function downloadCreativeImage(
  request: DownloadCreativeImageRequest,
): Promise<AiResult<DownloadCreativeImageResponse>> {
  return call<DownloadCreativeImageRequest, DownloadCreativeImageResponse>(
    CALLABLES.downloadCreativeImage,
    request,
  )
}

/**
 * Asks the backend to promote one chat attachment to a permanent Asset. The
 * copy and the Asset document are created server-side; the attachment and
 * its message are left untouched.
 */
export function saveChatAttachmentToAssets(
  request: SaveAttachmentToAssetsRequest,
): Promise<AiResult<SaveAttachmentToAssetsResponse>> {
  return call<SaveAttachmentToAssetsRequest, SaveAttachmentToAssetsResponse>(
    CALLABLES.saveAttachmentToAssets,
    request,
  )
}

/**
 * Claims (or reuses) a business for a website URL and marks it as analysing.
 *
 * Fast by design: it exists so the UI has a business id to subscribe to
 * before the slow analysis starts. The URL is validated again on the backend —
 * the client-side check is only there to give a faster, kinder error.
 */
export function startWebsiteAnalysis(
  request: StartWebsiteAnalysisRequest,
): Promise<AiResult<StartWebsiteAnalysisResponse>> {
  return call<StartWebsiteAnalysisRequest, StartWebsiteAnalysisResponse>(
    CALLABLES.startWebsiteAnalysis,
    request,
  )
}

/**
 * Runs the crawl and analysis for a business that is already marked as
 * analysing.
 *
 * Only the business id is sent. The backend reads the URL it recorded itself,
 * so a tampered client cannot redirect the fetch to a different site after the
 * URL has been validated.
 */
export function runWebsiteAnalysis(
  request: RunWebsiteAnalysisRequest,
): Promise<AiResult<RunWebsiteAnalysisResponse>> {
  return call<RunWebsiteAnalysisRequest, RunWebsiteAnalysisResponse>(
    CALLABLES.runWebsiteAnalysis,
    request,
    ANALYSIS_TIMEOUT_MS,
  )
}
