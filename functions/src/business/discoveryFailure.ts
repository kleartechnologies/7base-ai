import type { DiscoveryErrorCode } from '../lib/business.types'
import { AiServiceError } from '../ai/errors'
import { AiNotConfiguredError, AiResponseError } from '../ai/orchestrator'
import { SiteUnreachableError } from './website/crawl'
import { InvalidUrlError } from './website/url'
import { BlockedHostError, UnresolvableHostError } from './website/guard'
import { NotPublicError, SocialThrottledError } from './discovery/fetchSocial'
import { AnalysisValidationError, InsufficientContentError } from './brain/validate'

/**
 * Failure handling shared by every discovery callable — the website/social
 * analysis (Phase 6D) and Business DNA (Phase 7E). Moved out of
 * `analyzeWebsite.ts` unchanged so both classify the same cause the same way
 * and the owner reads the same sentence whichever button they pressed.
 */

/** Minimum gap between analyses of the same business. */
export const REANALYSIS_COOLDOWN_MS = 15_000

export interface AnalysisFailure {
  code: DiscoveryErrorCode
  message: string
}

/**
 * Maps an internal cause to something a restaurant owner can act on.
 *
 * Nothing from the provider, the stack or the network layer reaches the
 * client — only these five messages.
 */
export function classify(error: unknown): AnalysisFailure {
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
  if (error instanceof NotPublicError) {
    return {
      code: 'not_public',
      message:
        "I couldn't get enough public information from this page — it may be private, or only visible when logged in. No worries, you can tell EVA about your business instead.",
    }
  }
  // Rate-limited on every attempt. Temporary by definition — `unreachable`
  // keeps the retry button, and the wording says when, not "your page is
  // private".
  if (error instanceof SocialThrottledError) {
    return {
      code: 'unreachable',
      message:
        'This page is busy and did not let EVA read it just now. Please try again in a few minutes — or tell EVA about your business instead.',
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
      message: 'EVA could not finish analysing the business right now. Please try again.',
    }
  }
  if (error instanceof AiNotConfiguredError) {
    return { code: 'ai_failed', message: 'EVA’s AI backend is not configured yet.' }
  }
  return { code: 'internal', message: 'EVA ran into a problem. Please try again.' }
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
      return 'This website refused to let EVA read it. Your web host or security plugin may be blocking automated visitors.'
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

export async function recordFailure(
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

