/**
 * Turning a provider failure into something MARKA can say out loud.
 *
 * Every AI call fails eventually, and the failures are not interchangeable. A
 * rate limit clears in seconds; an exhausted billing quota does not clear at
 * all until someone with a card does something about it. Telling an owner to
 * "try again shortly" when the account is out of credit sends them into a
 * retry loop that can never succeed, and hides a problem only the operator can
 * fix.
 *
 * So this module answers two questions about any thrown value:
 *
 *   1. Is retrying worth anything?
 *   2. What can a restaurant owner be told, in their own language?
 *
 * ## What must never cross this boundary
 *
 * Provider errors carry request payloads, model names, quota figures,
 * organisation ids, endpoint URLs and — in the worst case for a
 * misconfiguration — fragments of the API key or of the prompt itself. None of
 * that is useful to an owner and all of it is dangerous in a browser. The
 * user-facing strings below are therefore *constants*: no provider text is
 * interpolated into them, ever. Diagnosis goes to the logs, and the logs get
 * the status code and the provider's error code — not its message body, which
 * is the field that can echo request content back.
 *
 * Deliberately duck-typed rather than built on `instanceof OpenAI.APIError`:
 * this stays testable without the SDK, and keeps working when a failure is
 * re-thrown by a wrapper, a proxy or a retry layer that loses the class.
 */

export type AiFailureKind =
  /** Credits exhausted, hard billing limit, payment required. Not transient. */
  | 'billing'
  /** Too many requests per minute or per day. Transient. */
  | 'rate_limit'
  /** The key is missing, revoked, or not permitted to use the model. */
  | 'auth'
  /** The provider is down or overloaded. Transient. */
  | 'unavailable'
  /** The request ran past its deadline before the model finished. Transient. */
  | 'timeout'
  /** Anything else, including a bug on MARKA's side. */
  | 'unknown'

/** The only four sentences MARKA will say about an AI failure. */
export const AI_FAILURE_MESSAGES = {
  billing:
    'MARKA’s AI service has reached its usage limit. Please check the account billing settings.',
  busy: 'MARKA is busy right now. Please try again shortly.',
  timeout: 'MARKA is taking longer than expected right now. Please try again.',
  generic: 'MARKA ran into a problem. Please try again.',
} as const

/**
 * A provider failure, already reduced to what the rest of MARKA may know.
 *
 * `message` (the `Error` one) stays internal and generic. `userMessage` is the
 * only field intended to reach a browser.
 */
export class AiServiceError extends Error {
  constructor(
    readonly kind: AiFailureKind,
    readonly userMessage: string,
    /** Whether trying the same request again could plausibly succeed. */
    readonly retryable: boolean,
    /** For logs only. Never rendered. */
    readonly diagnostics: AiFailureDiagnostics,
  ) {
    super(`AI request failed: ${kind}`)
    this.name = 'AiServiceError'
  }
}

/** Safe to log: codes and shapes, no free text from the provider. */
export interface AiFailureDiagnostics {
  kind: AiFailureKind
  /** HTTP status, when the failure came back from the API. */
  status: number | null
  /** The provider's machine-readable code, e.g. `insufficient_quota`. */
  providerCode: string | null
  /** The provider's error type, e.g. `insufficient_quota`. */
  providerType: string | null
  /** The error class name, e.g. `APIConnectionTimeoutError`. */
  errorName: string | null
  retryable: boolean
}

/** Provider codes and types that mean "the money ran out", not "slow down". */
const BILLING_CODES =
  /^(insufficient_quota|billing_hard_limit_reached|billing_not_active|quota_exceeded|account_deactivated)$/i

/** Deadline failures raised without a status: the model ran out of time. */
const TIMEOUT_ERROR_NAMES =
  /^(APIConnectionTimeoutError|AbortError|TimeoutError|ConnectTimeoutError|HeadersTimeoutError)$/

/** Other connection-level failures the SDK raises without a status. */
const TRANSPORT_ERROR_NAMES = /^(APIConnectionError|FetchError)$/

/**
 * Reduces any thrown value to a classified, owner-safe failure.
 *
 * The 429 fork is the one that matters. OpenAI returns 429 both for "you are
 * sending requests too fast" and for "this account has no credit left", and
 * only the `code`/`type` field tells them apart. Treating both as a rate limit
 * — the obvious reading of the status — is exactly the mistake that produces
 * an infinite retry against an account that will never answer.
 */
export function classifyProviderError(error: unknown): AiServiceError {
  if (error instanceof AiServiceError) return error

  const status = readStatus(error)
  const providerCode = readCode(error)
  const providerType = readType(error)
  const errorName = readErrorName(error)
  const errorMessage = error instanceof Error ? error.message : null

  const kind = classifyKind({ status, providerCode, providerType, errorName, errorMessage })

  const retryable = kind === 'rate_limit' || kind === 'unavailable' || kind === 'timeout'
  const userMessage =
    kind === 'billing'
      ? AI_FAILURE_MESSAGES.billing
      : kind === 'rate_limit'
        ? AI_FAILURE_MESSAGES.busy
        : kind === 'timeout'
          ? AI_FAILURE_MESSAGES.timeout
          : AI_FAILURE_MESSAGES.generic

  return new AiServiceError(kind, userMessage, retryable, {
    kind,
    status,
    providerCode,
    providerType,
    errorName,
    retryable,
  })
}

function classifyKind(signals: {
  status: number | null
  providerCode: string | null
  providerType: string | null
  errorName: string | null
  errorMessage: string | null
}): AiFailureKind {
  const { status, providerCode, providerType, errorName, errorMessage } = signals

  // Payment required is unambiguous wherever it appears.
  if (status === 402) return 'billing'

  // A quota code means billing whatever status carries it.
  if (isBillingCode(providerCode) || isBillingCode(providerType)) return 'billing'

  if (status === 429) return 'rate_limit'
  if (status === 401 || status === 403) return 'auth'
  if (status === 408) return 'timeout'
  if (status !== null && status >= 500) return 'unavailable'
  if (status !== null && status >= 400) return 'unknown'

  // No status: a deadline expired, a transport failure, or something that
  // never reached the API.
  if (errorName && TIMEOUT_ERROR_NAMES.test(errorName)) return 'timeout'
  if (errorName && TRANSPORT_ERROR_NAMES.test(errorName)) return 'unavailable'
  // The message is read, never emitted: a re-wrapped timeout can arrive with
  // a generic class but still says what happened.
  if (errorMessage && /\btimed?[ -]?out\b/i.test(errorMessage)) return 'timeout'

  return 'unknown'
}

function isBillingCode(value: string | null): boolean {
  return value !== null && BILLING_CODES.test(value)
}

/* --- reading the shape without trusting it ----------------------------- */

/**
 * The most specific class name available. The OpenAI SDK's error classes do
 * not set `.name`, so a real `APIConnectionTimeoutError` arrives with
 * `name: "Error"` — observed live when Phase 3's first 110s reasoning timeout
 * was logged as `unknown`. The constructor still carries the class, so it is
 * preferred whenever `.name` is the generic default.
 */
function readErrorName(error: unknown): string | null {
  if (!(error instanceof Error)) return null
  if (error.name && error.name !== 'Error') return error.name
  const ctor = error.constructor?.name
  if (ctor && ctor !== 'Error' && ctor !== 'Object') return ctor
  return error.name || null
}

function record(error: unknown): Record<string, unknown> | null {
  return typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : null
}

function readStatus(error: unknown): number | null {
  const source = record(error)
  if (!source) return null
  const candidate = source.status ?? source.statusCode ?? record(source.response)?.status
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
}

function readCode(error: unknown): string | null {
  const source = record(error)
  if (!source) return null
  return readNestedString(source, 'code')
}

function readType(error: unknown): string | null {
  const source = record(error)
  if (!source) return null
  return readNestedString(source, 'type')
}

/**
 * The field can sit on the error, on `error.error` (the SDK's parsed body) or
 * on `error.error.error` (the raw API envelope), depending on which layer
 * threw. All three are checked; nothing else is read.
 */
function readNestedString(source: Record<string, unknown>, key: string): string | null {
  const direct = source[key]
  if (typeof direct === 'string' && direct) return direct

  const body = record(source.error)
  if (!body) return null

  const nested = body[key]
  if (typeof nested === 'string' && nested) return nested

  const envelope = record(body.error)
  const deep = envelope?.[key]
  return typeof deep === 'string' && deep ? deep : null
}
