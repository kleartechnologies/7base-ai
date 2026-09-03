import { assertResolvesToPublicAddress } from './guard'
import { normalizeWebsiteUrl } from './url'

/**
 * Fetches one public HTML page, under strict limits.
 *
 * Redirects are followed manually rather than by `fetch`, because every hop is
 * a fresh chance to be pointed at an internal address — each one is
 * re-validated and re-resolved before it is followed.
 *
 * Nothing here executes page JavaScript. MARKA reads the served HTML and
 * nothing else.
 */

/** Per-page wall clock. The crawl budget bounds the total separately. */
const REQUEST_TIMEOUT_MS = 10_000

/** 2 MB of HTML is already far more than any restaurant page needs. */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

const MAX_REDIRECTS = 4

const USER_AGENT =
  'MarkaBot/1.0 (+https://marka.my/bot; AI marketing assistant reading a customer-supplied website)'

export interface FetchedPage {
  /** The URL that finally served the content, after redirects. */
  url: string
  html: string
  status: number
}

/**
 * Why one page could not be read.
 *
 * These are deliberately finer-grained than anything the owner is shown. A
 * site that is refusing connections, one presenting an untrusted certificate
 * and one that simply does not resolve all look identical to a visitor, but
 * they are three different problems with three different fixes — and when an
 * owner reports "MARKA can't read my site", the logs are the only place that
 * difference survives. Nothing here reaches the client verbatim; see
 * `classify` in `analyzeWebsite.ts` for the owner-facing wording.
 */
export type PageFetchFailure =
  /** Certificate rejected, protocol failure, or any other TLS handshake error. */
  | 'tls'
  /** The host answered the connection attempt with a refusal. */
  | 'refused'
  /** The connection was established and then dropped mid-flight. */
  | 'reset'
  /** The hostname does not resolve. */
  | 'dns'
  /** No answer within the per-page budget. */
  | 'timeout'
  /** A response arrived, with a status that is not usable. */
  | 'http_error'
  /** 404 or 410 — a specific `http_error` worth keeping apart. */
  | 'not_found'
  /** 401, 403 or 429 — reachable, but declining to serve this crawler. */
  | 'blocked'
  /** A response arrived, but it was not HTML. */
  | 'not_html'
  /** The body exceeded the cap. */
  | 'too_large'
  /** Nothing above matched. Reaching this often means a case worth adding. */
  | 'unreachable'

export class PageFetchError extends Error {
  constructor(
    readonly failure: PageFetchFailure,
    readonly url: string,
    /** Present for `http_error`, `not_found` and `blocked`. */
    readonly status?: number,
  ) {
    super(`Could not fetch ${url}: ${failure}${status ? ` (${status})` : ''}`)
    this.name = 'PageFetchError'
  }
}

/** Error codes that mean the TLS layer, not the application, said no. */
const TLS_CODES = new Set([
  'EPROTO',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_PACKET_LENGTH_TOO_LONG',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

const TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN'])

/**
 * Works out what actually went wrong with a transport-level fetch failure.
 *
 * `fetch` reports nearly everything as the same opaque `TypeError: fetch
 * failed`; the real reason sits on `error.cause`, sometimes another level down
 * again, which is why this walks the chain rather than reading one property.
 *
 * Exported for tests: this is where a misclassification would hide, and a
 * misclassification here is what turns a five-minute certificate fix into an
 * afternoon of guessing.
 */
export function classifyFetchError(error: unknown): PageFetchFailure {
  // An abort is our own timeout firing, and it is not wrapped in a cause chain.
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'timeout'
  }

  for (let node: unknown = error, depth = 0; node !== null && node !== undefined && depth < 6; depth += 1) {
    if (typeof node !== 'object') break

    const code = (node as { code?: unknown }).code
    if (typeof code === 'string') {
      if (TLS_CODES.has(code) || code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_')) return 'tls'
      if (code === 'ECONNREFUSED') return 'refused'
      if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'UND_ERR_SOCKET') return 'reset'
      if (TIMEOUT_CODES.has(code)) return 'timeout'
      if (DNS_CODES.has(code)) return 'dns'
      if (code === 'ABORT_ERR') return 'timeout'
    }

    // Node's OpenSSL errors sometimes carry the reason only in `reason`.
    const reason = (node as { reason?: unknown }).reason
    if (typeof reason === 'string' && /certificate|self.signed|ssl|tls/i.test(reason)) return 'tls'

    node = (node as { cause?: unknown }).cause
  }

  return 'unreachable'
}

/** 401/403/429 mean "reachable but declining"; other 4xx/5xx are plain errors. */
function classifyStatus(status: number): PageFetchFailure {
  if (status === 404 || status === 410) return 'not_found'
  if (status === 401 || status === 403 || status === 429) return 'blocked'
  return 'http_error'
}

export async function fetchPage(rawUrl: string): Promise<FetchedPage> {
  let current = normalizeWebsiteUrl(rawUrl)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const target = new URL(current)
    await assertResolvesToPublicAddress(target.hostname)

    const response = await requestOnce(current)

    if (isRedirect(response.status)) {
      const location = response.headers.get('location')
      // A redirect status with nowhere to go is a broken response, not an
      // unreachable host — the server answered us perfectly well.
      if (!location) throw new PageFetchError('http_error', current, response.status)

      // Resolve relative redirects, then put the result back through the same
      // validation the original URL faced.
      const next = new URL(location, current).toString()
      current = normalizeWebsiteUrl(next)
      // Drain so the socket is released before the next hop.
      await response.body?.cancel().catch(() => undefined)
      continue
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new PageFetchError(classifyStatus(response.status), current, response.status)
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!isHtml(contentType)) {
      await response.body?.cancel().catch(() => undefined)
      throw new PageFetchError('not_html', current)
    }

    const declaredLength = Number(response.headers.get('content-length') ?? '0')
    if (declaredLength > MAX_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => undefined)
      throw new PageFetchError('too_large', current)
    }

    const html = await readCapped(response, current, contentType)
    return { url: current, html, status: response.status }
  }

  // Out of hops: a redirect loop, which is a server-side fault.
  throw new PageFetchError('http_error', current)
}

async function requestOnce(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    return await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en,ms;q=0.8',
      },
    })
  } catch (error) {
    throw new PageFetchError(classifyFetchError(error), url)
  } finally {
    clearTimeout(timer)
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function isHtml(contentType: string): boolean {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return type === 'text/html' || type === 'application/xhtml+xml'
}

/**
 * Streams the body, stopping the moment it exceeds the cap.
 *
 * A `content-length` header is a claim, not a guarantee, so the limit is
 * enforced on bytes actually received.
 */
async function readCapped(response: Response, url: string, contentType: string): Promise<string> {
  const body = response.body
  if (!body) throw new PageFetchError('http_error', url)

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      received += value.byteLength
      if (received > MAX_RESPONSE_BYTES) {
        throw new PageFetchError('too_large', url)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
    await body.cancel().catch(() => undefined)
  }

  const buffer = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }

  return decode(buffer, contentType)
}

function decode(buffer: Uint8Array, contentType: string): string {
  const declared = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/["']/g, '')
  if (declared) {
    try {
      return new TextDecoder(declared).decode(buffer)
    } catch {
      // Unknown label — fall through to UTF-8.
    }
  }
  return new TextDecoder('utf-8').decode(buffer)
}
