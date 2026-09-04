import { afterEach, describe, expect, it, vi } from 'vitest'

import { CRAWL_LIMITS } from '../business/website/crawl'
import {
  estimateCostUsd,
  getModelConfig,
  resolveModelForTask,
  type SubscriptionPlan,
} from './models'

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
  // Pro's models are the tier defaults, so Pro is the plan these tier
  // equalities hold for exactly; Basic differs only in the model id.
  it('builds campaigns on the fast tier', () => {
    expect(resolveModelForTask('campaign.build', 'pro')).toEqual(getModelConfig('fast'))
  })

  it('edits campaigns on the fast tier', () => {
    expect(resolveModelForTask('campaign.edit', 'pro')).toEqual(getModelConfig('fast'))
  })

  it('keeps diagnosis on the reasoning tier', () => {
    expect(resolveModelForTask('campaign.diagnose', 'pro')).toEqual(getModelConfig('reasoning'))
  })
})

describe('creative task routing', () => {
  // Creative copy and edits inherit strategy the reasoning tier already
  // decided and billed for — a creative must never trigger a reasoning call.
  it('writes creative copy on the fast tier', () => {
    expect(resolveModelForTask('creative.generate_copy', 'pro')).toEqual(getModelConfig('fast'))
  })

  it('edits creatives on the fast tier', () => {
    expect(resolveModelForTask('creative.edit', 'pro')).toEqual(getModelConfig('fast'))
  })

  it('generates images on the image tier', () => {
    expect(resolveModelForTask('creative.generate_image', 'pro')).toEqual(getModelConfig('image'))
    expect(getModelConfig('image').model).toBe('gpt-image-2')
  })
})

describe('subscription plan model routing', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('Basic runs reasoning tasks on the low-cost model', () => {
    expect(resolveModelForTask('campaign.diagnose', 'basic').model).toBe('gpt-5.6-luna')
    expect(resolveModelForTask('business.analyse_website', 'basic').model).toBe('gpt-5.6-luna')
  })

  it('Basic runs fast tasks on the low-cost model', () => {
    expect(resolveModelForTask('chat.reply', 'basic').model).toBe('gpt-5.6-luna')
    expect(resolveModelForTask('creative.generate_copy', 'basic').model).toBe('gpt-5.6-luna')
  })

  it('Pro runs reasoning tasks on the flagship', () => {
    expect(resolveModelForTask('campaign.diagnose', 'pro').model).toBe('gpt-5.6-sol')
    expect(resolveModelForTask('business.analyse_website', 'pro').model).toBe('gpt-5.6-sol')
  })

  it('Pro runs fast tasks on the mid tier — the flagship is bought only where judgement is the product', () => {
    expect(resolveModelForTask('chat.reply', 'pro').model).toBe('gpt-5.6-terra')
    expect(resolveModelForTask('campaign.build', 'pro').model).toBe('gpt-5.6-terra')
  })

  it('both plans share one image model', () => {
    expect(resolveModelForTask('creative.generate_image', 'basic').model).toBe('gpt-image-2')
    expect(resolveModelForTask('creative.generate_image', 'pro').model).toBe('gpt-image-2')
  })

  it('the plan changes the model id, never the tier operational envelope', () => {
    // Basic's website analysis still gets the reasoning tier's deadline and
    // output ceiling — a cheaper model does not mean a truncated Brain.
    const basic = resolveModelForTask('business.analyse_website', 'basic')
    const reasoning = getModelConfig('reasoning')
    expect(basic.timeoutMs).toBe(reasoning.timeoutMs)
    expect(basic.maxOutputTokens).toBe(reasoning.maxOutputTokens)
    expect(basic.maxRetries).toBe(reasoning.maxRetries)
  })

  it('an unrecognised plan degrades to Basic models, never Pro', () => {
    // The type says this cannot happen; the runtime guard assumes it will.
    for (const junk of ['enterprise', 'PRO', '', null, undefined, 42]) {
      expect(resolveModelForTask('campaign.diagnose', junk as SubscriptionPlan).model).toBe(
        'gpt-5.6-luna',
      )
    }
  })

  it('every plan default is a model the cost estimator can price', () => {
    // A plan default missing from the pricing table would silently null out
    // the Basic-vs-Pro cost comparison this feature exists to enable.
    for (const plan of ['basic', 'pro'] as const) {
      for (const task of ['campaign.diagnose', 'chat.reply'] as const) {
        const { model } = resolveModelForTask(task, plan)
        expect(
          estimateCostUsd(model, { inputTokens: 1000, outputTokens: 1000 }),
        ).not.toBeNull()
      }
    }
  })

  it('plan-specific environment overrides win, and touch only their own plan', () => {
    vi.stubEnv('MARKA_MODEL_PRO_REASONING', 'pro-reasoning-override')
    vi.stubEnv('MARKA_MODEL_BASIC_FAST', 'basic-fast-override')

    expect(resolveModelForTask('campaign.diagnose', 'pro').model).toBe('pro-reasoning-override')
    expect(resolveModelForTask('campaign.diagnose', 'basic').model).toBe('gpt-5.6-luna')
    expect(resolveModelForTask('chat.reply', 'basic').model).toBe('basic-fast-override')
    expect(resolveModelForTask('chat.reply', 'pro').model).toBe('gpt-5.6-terra')
  })

  it('the pre-plan variables continue working: a tier-wide override moves every plan', () => {
    vi.stubEnv('MARKA_MODEL_REASONING', 'tier-wide-reasoning')
    vi.stubEnv('MARKA_MODEL_FAST', 'tier-wide-fast')
    vi.stubEnv('MARKA_MODEL_IMAGE', 'tier-wide-image')

    for (const plan of ['basic', 'pro'] as const) {
      expect(resolveModelForTask('campaign.diagnose', plan).model).toBe('tier-wide-reasoning')
      expect(resolveModelForTask('chat.reply', plan).model).toBe('tier-wide-fast')
      expect(resolveModelForTask('creative.generate_image', plan).model).toBe('tier-wide-image')
    }
  })

  it('a plan-specific override beats a tier-wide one', () => {
    vi.stubEnv('MARKA_MODEL_REASONING', 'tier-wide-reasoning')
    vi.stubEnv('MARKA_MODEL_BASIC_REASONING', 'basic-specific')

    expect(resolveModelForTask('campaign.diagnose', 'basic').model).toBe('basic-specific')
    expect(resolveModelForTask('campaign.diagnose', 'pro').model).toBe('tier-wide-reasoning')
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
