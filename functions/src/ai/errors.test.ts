import { describe, expect, it } from 'vitest'

import { AI_FAILURE_MESSAGES, AiServiceError, classifyProviderError } from './errors'

/**
 * The failure MARKA must never get wrong is the 429 fork.
 *
 * OpenAI returns 429 for "slow down" *and* for "this account is out of
 * credit". They look identical at the status line and differ only in `code`.
 * Reading both as a rate limit puts an owner into a retry loop against an
 * account that cannot answer until someone pays a bill — so most of this file
 * is about keeping those two apart.
 *
 * The other rule under test: nothing from the provider reaches `userMessage`.
 */

/** A failure shaped like the OpenAI SDK's `APIError`. */
function apiError(
  status: number,
  body: { code?: string; type?: string; message?: string } = {},
): Error & Record<string, unknown> {
  const error = new Error(body.message ?? 'Request failed') as Error & Record<string, unknown>
  error.name = 'APIError'
  error.status = status
  error.code = body.code
  error.type = body.type
  // The SDK also hangs the parsed body off `.error`.
  error.error = { message: body.message, code: body.code, type: body.type }
  return error
}

describe('billing and exhausted credit', () => {
  it('reads insufficient_quota on a 429 as billing, not as a rate limit', () => {
    const failure = classifyProviderError(
      apiError(429, { code: 'insufficient_quota', type: 'insufficient_quota' }),
    )

    expect(failure.kind).toBe('billing')
    expect(failure.userMessage).toBe(
      'EVA’s AI service has reached its usage limit. Please check the account billing settings.',
    )
  })

  it('never tells the owner to retry a billing failure', () => {
    const failure = classifyProviderError(apiError(429, { code: 'insufficient_quota' }))

    expect(failure.retryable).toBe(false)
    expect(failure.userMessage).not.toMatch(/try again/i)
  })

  it('treats a hard billing limit as billing', () => {
    expect(classifyProviderError(apiError(429, { code: 'billing_hard_limit_reached' })).kind).toBe(
      'billing',
    )
  })

  it('treats payment required as billing', () => {
    expect(classifyProviderError(apiError(402)).kind).toBe('billing')
  })

  it('finds the quota code nested in the raw API envelope', () => {
    const error = new Error('failed') as Error & Record<string, unknown>
    error.status = 429
    error.error = { error: { code: 'insufficient_quota' } }

    expect(classifyProviderError(error).kind).toBe('billing')
  })
})

describe('rate limits', () => {
  it('classifies a plain 429 as a transient rate limit', () => {
    const failure = classifyProviderError(apiError(429, { code: 'rate_limit_exceeded' }))

    expect(failure.kind).toBe('rate_limit')
    expect(failure.retryable).toBe(true)
    expect(failure.userMessage).toBe('EVA is busy right now. Please try again shortly.')
  })

  it('classifies a 429 with no code at all as a rate limit', () => {
    expect(classifyProviderError(apiError(429)).kind).toBe('rate_limit')
  })
})

describe('other provider failures', () => {
  it('gives a 500 the safe generic message and allows a retry', () => {
    const failure = classifyProviderError(apiError(500, { code: 'server_error' }))

    expect(failure.kind).toBe('unavailable')
    expect(failure.retryable).toBe(true)
    expect(failure.userMessage).toBe('EVA ran into a problem. Please try again.')
  })

  it('classifies 503 as unavailable', () => {
    expect(classifyProviderError(apiError(503)).kind).toBe('unavailable')
  })

  it('classifies a bad key as auth, and does not blame billing for it', () => {
    const failure = classifyProviderError(apiError(401, { code: 'invalid_api_key' }))

    expect(failure.kind).toBe('auth')
    expect(failure.retryable).toBe(false)
    expect(failure.userMessage).toBe('EVA ran into a problem. Please try again.')
    expect(failure.userMessage).not.toMatch(/billing|key/i)
  })

  it('classifies a connection failure as unavailable, not as a timeout', () => {
    const error = new Error('Connection error.')
    error.name = 'APIConnectionError'

    const failure = classifyProviderError(error)
    expect(failure.kind).toBe('unavailable')
    expect(failure.retryable).toBe(true)
  })

  it('classifies a 400 as unknown rather than as something transient', () => {
    const failure = classifyProviderError(apiError(400, { code: 'invalid_request_error' }))

    expect(failure.kind).toBe('unknown')
    expect(failure.retryable).toBe(false)
  })

  it('classifies a plain programming error as unknown', () => {
    const failure = classifyProviderError(new TypeError('x is not a function'))

    expect(failure.kind).toBe('unknown')
    expect(failure.userMessage).toBe('EVA ran into a problem. Please try again.')
  })

  it('survives being handed something that is not an error at all', () => {
    for (const thrown of [null, undefined, 'boom', 42, {}]) {
      const failure = classifyProviderError(thrown)
      expect(failure).toBeInstanceOf(AiServiceError)
      expect(failure.userMessage).toBe('EVA ran into a problem. Please try again.')
    }
  })

  it('passes an already-classified failure straight through', () => {
    const original = classifyProviderError(apiError(429, { code: 'insufficient_quota' }))

    expect(classifyProviderError(original)).toBe(original)
  })
})

describe('timeouts', () => {
  const TIMEOUT_MESSAGE = 'EVA is taking longer than expected right now. Please try again.'

  it('classifies the real OpenAI SDK timeout, whose .name is just "Error"', () => {
    // The SDK's error classes never set `.name` — the live Phase 3 timeout
    // arrived as name: "Error" and was logged as `unknown`. Only the
    // constructor carries the class, so that is what must be read.
    class APIConnectionTimeoutError extends Error {}
    const failure = classifyProviderError(new APIConnectionTimeoutError('Request timed out.'))

    expect(failure.kind).toBe('timeout')
    expect(failure.retryable).toBe(true)
    expect(failure.userMessage).toBe(TIMEOUT_MESSAGE)
  })

  it('classifies a timeout whose name survived', () => {
    const error = new Error('Request timed out.')
    error.name = 'APIConnectionTimeoutError'

    expect(classifyProviderError(error).kind).toBe('timeout')
  })

  it('classifies a re-wrapped timeout by its message when the class is lost', () => {
    expect(classifyProviderError(new Error('Request timed out.')).kind).toBe('timeout')
  })

  it('classifies an HTTP 408 as a timeout', () => {
    expect(classifyProviderError(apiError(408)).kind).toBe('timeout')
  })

  it('classifies an AbortError as a timeout', () => {
    const error = new Error('This operation was aborted')
    error.name = 'AbortError'

    expect(classifyProviderError(error).kind).toBe('timeout')
  })

  it('says nothing about the provider in the timeout message', () => {
    class APIConnectionTimeoutError extends Error {}
    const failure = classifyProviderError(
      new APIConnectionTimeoutError('Request to https://api.openai.com/v1/responses timed out.'),
    )

    expect(failure.userMessage).toBe(TIMEOUT_MESSAGE)
    expect(failure.userMessage).not.toMatch(/openai|api|http/i)
  })

  it('keeps timeout distinct from billing, rate limit, and unavailable', () => {
    const kinds = new Set([
      classifyProviderError(apiError(429, { code: 'insufficient_quota' })).kind,
      classifyProviderError(apiError(429)).kind,
      classifyProviderError(apiError(408)).kind,
      classifyProviderError(apiError(503)).kind,
      classifyProviderError(new TypeError('x is not a function')).kind,
    ])

    expect(kinds).toEqual(new Set(['billing', 'rate_limit', 'timeout', 'unavailable', 'unknown']))
  })
})

describe('nothing internal reaches the owner', () => {
  const SECRETS = [
    'sk-proj-abc123SECRETKEYVALUE',
    'https://api.openai.com/v1/responses',
    'org-9f8e7d6c',
    'You are MARKA’s business analyst.',
  ]

  it('never interpolates the provider message into the owner-facing text', () => {
    for (const secret of SECRETS) {
      const failure = classifyProviderError(
        apiError(500, { message: `Incorrect API key provided: ${secret}` }),
      )

      expect(failure.userMessage).not.toContain(secret)
      expect(failure.userMessage).toBe(AI_FAILURE_MESSAGES.generic)
    }
  })

  it('produces only the four approved sentences, whatever it is given', () => {
    const approved: string[] = [
      AI_FAILURE_MESSAGES.billing,
      AI_FAILURE_MESSAGES.busy,
      AI_FAILURE_MESSAGES.timeout,
      AI_FAILURE_MESSAGES.generic,
    ]
    const cases = [
      apiError(402),
      apiError(429, { code: 'insufficient_quota' }),
      apiError(429),
      apiError(401),
      apiError(403),
      apiError(408),
      apiError(500),
      apiError(502),
      apiError(400),
      new Error('boom'),
      'not an error',
    ]

    for (const thrown of cases) {
      expect(approved).toContain(classifyProviderError(thrown).userMessage)
    }
  })

  it('keeps diagnostics to codes, with no free text from the provider', () => {
    const failure = classifyProviderError(
      apiError(429, {
        code: 'insufficient_quota',
        type: 'insufficient_quota',
        message: 'You exceeded your current quota for org-9f8e7d6c, key sk-proj-abc123.',
      }),
    )

    const serialised = JSON.stringify(failure.diagnostics)
    expect(serialised).not.toContain('sk-proj')
    expect(serialised).not.toContain('org-9f8e7d6c')
    expect(failure.diagnostics).toEqual({
      kind: 'billing',
      status: 429,
      providerCode: 'insufficient_quota',
      providerType: 'insufficient_quota',
      errorName: 'APIError',
      retryable: false,
    })
  })

  it('keeps the stack trace off the owner-facing message', () => {
    const failure = classifyProviderError(apiError(500))

    expect(failure.userMessage).not.toContain('at ')
    expect(failure.userMessage.split('\n')).toHaveLength(1)
  })
})
