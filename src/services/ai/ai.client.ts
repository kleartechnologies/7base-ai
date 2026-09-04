import { httpsCallable, type HttpsCallableResult } from 'firebase/functions'
import { FirebaseError } from 'firebase/app'
import { getFirebaseFunctions } from '@/lib/firebase/app'
import type {
  AiError,
  AiErrorCode,
  AiResult,
  AssistantReplyRequest,
  AssistantReplyResponse,
  BuildCampaignRequest,
  BuildCampaignResponse,
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

const FALLBACK_MESSAGES: Record<AiErrorCode, string> = {
  unauthenticated: 'Your session expired. Please sign in again.',
  permission_denied: 'You do not have access to this conversation.',
  not_configured: 'MARKA’s AI backend is not configured yet.',
  rate_limited: 'MARKA is handling a lot of requests right now. Please try again shortly.',
  timeout: 'MARKA took too long to respond. Please try again.',
  unavailable: 'MARKA could not be reached. Please check your connection and try again.',
  invalid_request: 'That request could not be understood.',
  unknown: 'MARKA ran into a problem. Please try again.',
}

function toAiError(error: unknown): AiError {
  if (error instanceof FirebaseError) {
    const code = ERROR_CODE_MAP[error.code] ?? 'unknown'
    // Prefer the backend's own message when it wrote one for the user.
    const message = error.message && !error.message.startsWith('INTERNAL')
      ? error.message
      : FALLBACK_MESSAGES[code]
    return { code, message }
  }
  return { code: 'unknown', message: FALLBACK_MESSAGES.unknown }
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
