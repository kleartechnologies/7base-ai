import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Fetch-failure classification.
 *
 * `fetch` reports a rejected certificate, a refused connection and a dead host
 * as the same `TypeError: fetch failed`; the real cause is buried on
 * `error.cause`. Collapsing all of them into "unreachable" is what makes an
 * owner's "MARKA can't read my site" unanswerable, so these tests pin each
 * cause to its own outcome — including the walk down a nested cause chain,
 * which is where the interesting codes actually live.
 *
 * The shapes below are the ones Node/undici really produce.
 */

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}))

import { classifyFetchError, fetchPage, PageFetchError } from './fetchPage'

/** A `TypeError: fetch failed` wrapping a system error, as undici throws it. */
function fetchFailed(cause: unknown): TypeError {
  const error = new TypeError('fetch failed')
  Object.defineProperty(error, 'cause', { value: cause, configurable: true })
  return error
}

function systemError(code: string, message = code): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

describe('classifyFetchError', () => {
  it('reports an untrusted certificate as a TLS failure', () => {
    expect(
      classifyFetchError(fetchFailed(systemError('UNABLE_TO_VERIFY_LEAF_SIGNATURE'))),
    ).toBe('tls')
  })

  it('reports an expired certificate as a TLS failure', () => {
    expect(classifyFetchError(fetchFailed(systemError('CERT_HAS_EXPIRED')))).toBe('tls')
  })

  it('reports a self-signed certificate as a TLS failure', () => {
    expect(classifyFetchError(fetchFailed(systemError('DEPTH_ZERO_SELF_SIGNED_CERT')))).toBe('tls')
  })

  it('reports a hostname mismatch as a TLS failure', () => {
    expect(classifyFetchError(fetchFailed(systemError('ERR_TLS_CERT_ALTNAME_INVALID')))).toBe('tls')
  })

  it('treats any ERR_SSL_* code as a TLS failure without listing them all', () => {
    expect(classifyFetchError(fetchFailed(systemError('ERR_SSL_WRONG_VERSION_NUMBER')))).toBe('tls')
    expect(classifyFetchError(fetchFailed(systemError('ERR_SSL_SOMETHING_NEW')))).toBe('tls')
  })

  it('separates a refused connection from a reset one', () => {
    expect(classifyFetchError(fetchFailed(systemError('ECONNREFUSED')))).toBe('refused')
    expect(classifyFetchError(fetchFailed(systemError('ECONNRESET')))).toBe('reset')
    expect(classifyFetchError(fetchFailed(systemError('EPIPE')))).toBe('reset')
  })

  it('reports an unresolvable hostname as DNS, not as a generic failure', () => {
    expect(classifyFetchError(fetchFailed(systemError('ENOTFOUND')))).toBe('dns')
    expect(classifyFetchError(fetchFailed(systemError('EAI_AGAIN')))).toBe('dns')
  })

  it('reports our own abort as a timeout', () => {
    const abort = new Error('This operation was aborted')
    abort.name = 'AbortError'
    expect(classifyFetchError(abort)).toBe('timeout')
  })

  it('reports undici and socket timeouts as timeouts', () => {
    expect(classifyFetchError(fetchFailed(systemError('UND_ERR_CONNECT_TIMEOUT')))).toBe('timeout')
    expect(classifyFetchError(fetchFailed(systemError('UND_ERR_HEADERS_TIMEOUT')))).toBe('timeout')
    expect(classifyFetchError(fetchFailed(systemError('ETIMEDOUT')))).toBe('timeout')
  })

  it('walks a nested cause chain rather than reading only the first level', () => {
    const deep = fetchFailed(fetchFailed(systemError('ECONNREFUSED')))
    expect(classifyFetchError(deep)).toBe('refused')
  })

  it('does not loop forever on a self-referential cause chain', () => {
    const looping: { cause?: unknown } = {}
    looping.cause = looping
    expect(classifyFetchError(looping)).toBe('unreachable')
  })

  it('falls back to unreachable for a cause it does not recognise', () => {
    expect(classifyFetchError(fetchFailed(systemError('ESOMETHINGELSE')))).toBe('unreachable')
    expect(classifyFetchError(new Error('no cause at all'))).toBe('unreachable')
    expect(classifyFetchError(undefined)).toBe('unreachable')
    expect(classifyFetchError('a string')).toBe('unreachable')
  })
})

describe('fetchPage — response classification', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Makes `fetch` answer with exactly this response, whatever the URL. */
  function respondWith(build: () => Response): void {
    vi.stubGlobal('fetch', vi.fn(async () => build()))
  }

  async function failureOf(url = 'https://warungtest.com/'): Promise<PageFetchError> {
    try {
      await fetchPage(url)
    } catch (error) {
      expect(error).toBeInstanceOf(PageFetchError)
      return error as PageFetchError
    }
    throw new Error('expected fetchPage to reject')
  }

  it('keeps 404 apart from other HTTP errors', async () => {
    respondWith(() => new Response('gone', { status: 404 }))
    const error = await failureOf()
    expect(error.failure).toBe('not_found')
    expect(error.status).toBe(404)
  })

  it('reports a WAF block as blocked, not as an unreachable host', async () => {
    respondWith(() => new Response('forbidden', { status: 403 }))
    expect((await failureOf()).failure).toBe('blocked')
  })

  it('reports rate limiting as blocked', async () => {
    respondWith(() => new Response('slow down', { status: 429 }))
    expect((await failureOf()).failure).toBe('blocked')
  })

  it('reports a server fault as an HTTP error and keeps the status', async () => {
    respondWith(() => new Response('boom', { status: 503 }))
    const error = await failureOf()
    expect(error.failure).toBe('http_error')
    expect(error.status).toBe(503)
  })

  it('reports a non-HTML response separately from an unreadable one', async () => {
    respondWith(
      () => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    expect((await failureOf()).failure).toBe('not_html')
  })

  it('reports a redirect with no destination as a server fault, not an unreachable host', async () => {
    respondWith(() => new Response(null, { status: 301 }))
    expect((await failureOf()).failure).toBe('http_error')
  })

  it('reports a redirect loop as an HTTP error once the hop budget is spent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302, headers: { location: '/loop' } })),
    )
    expect((await failureOf()).failure).toBe('http_error')
  })

  it('surfaces a TLS failure from the transport rather than swallowing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw fetchFailed(systemError('UNABLE_TO_VERIFY_LEAF_SIGNATURE'))
    }))
    expect((await failureOf()).failure).toBe('tls')
  })

  it('surfaces a refused connection from the transport', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw fetchFailed(systemError('ECONNREFUSED'))
    }))
    expect((await failureOf()).failure).toBe('refused')
  })

  it('still reads a normal HTML page', async () => {
    respondWith(
      () =>
        new Response('<html><body><h1>Warung</h1></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    )
    const page = await fetchPage('https://warungtest.com/')
    expect(page.status).toBe(200)
    expect(page.html).toContain('Warung')
  })
})
