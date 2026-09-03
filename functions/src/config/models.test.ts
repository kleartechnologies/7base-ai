import { describe, expect, it } from 'vitest'

import { CRAWL_LIMITS } from '../business/website/crawl'
import { estimateCostUsd, getModelConfig, resolveModelForTask } from './models'

/**
 * The deadline arithmetic behind every caller of the reasoning tier.
 *
 * A callable function gives itself a fixed number of seconds. Inside that it
 * may crawl (up to `CRAWL_LIMITS.budgetMs`), must wait out a reasoning call
 * (`timeoutMs * (maxRetries + 1)` before the client gives up), and still
 * needs a safety margin for Firestore reads and writes around the model. The
 * Phase 2 latency investigation found the failure mode this file pins down:
 * with one retry, a 110s reasoning timeout became 220s of model time, which
 * plus the 45s crawl sailed past the function's own deadline — the retry was
 * billed and then killed along with the function.
 *
 * These tests fail if anyone re-loosens a knob (retries, timeout, crawl
 * budget) without re-doing that arithmetic.
 */

/** Mirrors `timeoutSeconds: 300` on businessRunWebsiteAnalysis. */
const ANALYSIS_FUNCTION_BUDGET_MS = 300_000

/** Mirrors `timeoutSeconds: 180` on chatAssistantReply. */
const CHAT_FUNCTION_BUDGET_MS = 180_000

/** Firestore reads/writes and framing around the model call. */
const SAFETY_MARGIN_MS = 20_000

describe('reasoning tier retry budget', () => {
  it('does not retry: a timed-out reasoning call fails fast instead of dying with the function', () => {
    expect(getModelConfig('reasoning').maxRetries).toBe(0)
  })

  it('fits crawl budget + request timeout + safety margin inside the 300s analysis deadline', () => {
    const reasoning = getModelConfig('reasoning')
    const worstCaseModelMs = reasoning.timeoutMs * (reasoning.maxRetries + 1)

    expect(CRAWL_LIMITS.budgetMs + worstCaseModelMs + SAFETY_MARGIN_MS).toBeLessThan(
      ANALYSIS_FUNCTION_BUDGET_MS,
    )
  })
})

describe('marketing recommendation budget', () => {
  it('fits request timeout + safety margin inside the 180s chat function deadline', () => {
    const reasoning = getModelConfig('reasoning')
    const worstCaseModelMs = reasoning.timeoutMs * (reasoning.maxRetries + 1)

    expect(worstCaseModelMs + SAFETY_MARGIN_MS).toBeLessThan(CHAT_FUNCTION_BUDGET_MS)
  })

  it('gives a real diagnosis room: the timeout clears the slowest live call with 3x headroom', () => {
    // Phase 3's live smoke test measured real diagnoses at 31-47s; the false
    // timeout it caught was a call that finished in 44s on retry. 150s keeps
    // ~3x headroom over the slowest observed success without loosening the
    // deadline arithmetic above.
    expect(getModelConfig('reasoning').timeoutMs).toBeGreaterThanOrEqual(47_000 * 3)
  })
})

describe('campaign task routing', () => {
  // The strategy behind a campaign was decided (and paid for) on the
  // reasoning tier when the recommendation was made. Building and editing
  // the campaign are transformations of that decision — fast tier, always.
  it('builds campaigns on the fast tier', () => {
    expect(resolveModelForTask('campaign.build')).toEqual(getModelConfig('fast'))
  })

  it('edits campaigns on the fast tier', () => {
    expect(resolveModelForTask('campaign.edit')).toEqual(getModelConfig('fast'))
  })

  it('keeps diagnosis on the reasoning tier', () => {
    expect(resolveModelForTask('campaign.diagnose')).toEqual(getModelConfig('reasoning'))
  })
})

describe('creative task routing', () => {
  // Creative copy and edits inherit strategy the reasoning tier already
  // decided and billed for — a creative must never trigger a reasoning call.
  it('writes creative copy on the fast tier', () => {
    expect(resolveModelForTask('creative.generate_copy')).toEqual(getModelConfig('fast'))
  })

  it('edits creatives on the fast tier', () => {
    expect(resolveModelForTask('creative.edit')).toEqual(getModelConfig('fast'))
  })

  it('generates images on the image tier', () => {
    expect(resolveModelForTask('creative.generate_image')).toEqual(getModelConfig('image'))
    expect(getModelConfig('image').model).toBe('gpt-image-2')
  })
})

describe('estimateCostUsd', () => {
  it('prices a known model from the pinned table', () => {
    expect(estimateCostUsd('gpt-5.6-terra', { inputTokens: 1_000_000, outputTokens: 500_000 })).toBe(
      8,
    )
  })

  it('returns null rather than inventing a price for an unpinned model', () => {
    expect(estimateCostUsd('gpt-image-2', { inputTokens: 1000, outputTokens: 1000 })).toBeNull()
    expect(estimateCostUsd('some-future-model', { inputTokens: 1, outputTokens: 1 })).toBeNull()
  })

  it('returns null without usage data', () => {
    expect(estimateCostUsd('gpt-5.6-terra', null)).toBeNull()
  })
})
