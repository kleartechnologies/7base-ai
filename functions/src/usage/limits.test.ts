import { describe, expect, it } from 'vitest'

import { estimateCostUsd } from '../config/models'
import {
  applyReservation,
  applySettlement,
  BLOCK_MESSAGES,
  buildUsageReservation,
  CATEGORY_FOR_TASK,
  CHAT_HISTORY_MAX_CHARS,
  dailyPeriodKeyUtc,
  emptyUsageDoc,
  GUARDRAIL_LIMITS,
  MAX_REQUEST_CHARS,
  STALE_INFLIGHT_MS,
  trimTurnsToCharBudget,
  usageDocId,
  ZERO_ACTUAL,
  type UsageDoc,
  type UsageReservation,
} from './limits'

/**
 * The Phase 6B guardrail arithmetic, pinned down without Firestore.
 *
 * guardrail.ts persists exactly what `applyReservation` / `applySettlement`
 * return inside a transaction, so proving these functions correct — up to
 * and including the concurrent-race simulation at the bottom, which models
 * optimistic transaction retries the way Firestore serialises them — is what
 * makes "two requests race for the last slot, exactly one wins" a property
 * of the system rather than a hope.
 */

const NOW = Date.UTC(2026, 8, 4, 10, 0, 0)

function freshDoc(overrides: Partial<UsageDoc> = {}): UsageDoc {
  return {
    ...emptyUsageDoc({ uid: 'u1', plan: 'basic', period: '2026-09-04', now: NOW }),
    ...overrides,
  }
}

function reservation(overrides: Partial<UsageReservation> = {}): UsageReservation {
  return { category: 'chat', inputTokens: 1_000, outputTokens: 2_048, costUsd: 0.003, ...overrides }
}

function reserve(doc: UsageDoc | null, r: UsageReservation, plan: 'basic' | 'pro' = 'basic') {
  return applyReservation(doc, {
    uid: 'u1',
    plan,
    period: '2026-09-04',
    reservation: r,
    now: NOW,
  })
}

/* --- shape and configuration sanity -------------------------------------- */

describe('guardrail configuration', () => {
  it('routes every AI task to a category — a task the guardrail cannot classify cannot exist', () => {
    // Compile-time exhaustiveness is enforced by the Record type; this pins
    // the runtime shape for anyone weakening the type later.
    expect(Object.keys(CATEGORY_FOR_TASK)).toHaveLength(10)
    expect(CATEGORY_FOR_TASK['creative.generate_image']).toBe('imageGeneration')
    expect(CATEGORY_FOR_TASK['business.analyse_website']).toBe('websiteAnalysis')
  })

  it('Pro is a superset of Basic on every axis — an upgrade can never reduce an allowance', () => {
    const basic = GUARDRAIL_LIMITS.basic
    const pro = GUARDRAIL_LIMITS.pro
    for (const category of Object.keys(basic.requests) as (keyof typeof basic.requests)[]) {
      expect(pro.requests[category]).toBeGreaterThanOrEqual(basic.requests[category])
    }
    expect(pro.dailyInputTokens).toBeGreaterThanOrEqual(basic.dailyInputTokens)
    expect(pro.dailyOutputTokens).toBeGreaterThanOrEqual(basic.dailyOutputTokens)
    expect(pro.dailyCostUsd).toBeGreaterThanOrEqual(basic.dailyCostUsd)
    expect(pro.maxConcurrent).toBeGreaterThanOrEqual(basic.maxConcurrent)
  })

  it("Basic's worst-case legitimate day fits under its own cost ceiling", () => {
    // All text on Luna at the pinned rates, every image slot used: the cost
    // ceiling must be a backstop behind the token limits, not the limiter a
    // legitimate Basic user actually feels.
    const basic = GUARDRAIL_LIMITS.basic
    const textCost = estimateCostUsd('gpt-5.6-luna', {
      inputTokens: basic.dailyInputTokens,
      outputTokens: basic.dailyOutputTokens,
    })!
    const imageCost =
      basic.requests.imageGeneration *
      estimateCostUsd('gpt-image-2', { inputTokens: 100, outputTokens: 2_000 })!
    expect(textCost + imageCost).toBeLessThan(basic.dailyCostUsd)
  })

  it('per-request ceilings clear every legitimate payload with room to spare', () => {
    // The analysis corpus is budgeted at 24k chars (sliced ≤ 28k) plus
    // prompt overhead; chat is system prompt + trimmed 60k history.
    expect(MAX_REQUEST_CHARS['business.analyse_website']).toBeGreaterThan(28_000 * 3)
    expect(MAX_REQUEST_CHARS['chat.reply']).toBeGreaterThan(CHAT_HISTORY_MAX_CHARS + 20_000)
  })

  it('uses UTC date keys, so the reset hour does not depend on server locale', () => {
    expect(dailyPeriodKeyUtc(Date.UTC(2026, 8, 4, 23, 59, 59))).toBe('2026-09-04')
    expect(dailyPeriodKeyUtc(Date.UTC(2026, 8, 5, 0, 0, 1))).toBe('2026-09-05')
    expect(usageDocId('u1', '2026-09-04')).toBe('u1_2026-09-04')
  })
})

/* --- history trimming ----------------------------------------------------- */

describe('trimTurnsToCharBudget', () => {
  it('keeps the newest turns and drops the oldest when over budget', () => {
    const turns = [
      { text: 'a'.repeat(400) },
      { text: 'b'.repeat(400) },
      { text: 'c'.repeat(400) },
    ]
    expect(trimTurnsToCharBudget(turns, 900)).toEqual([turns[1], turns[2]])
  })

  it('returns everything untouched when under budget', () => {
    const turns = [{ text: 'hello' }, { text: 'world' }]
    expect(trimTurnsToCharBudget(turns, 1_000)).toEqual(turns)
  })

  it('always keeps the newest turn, even when it alone busts the budget', () => {
    // Silently deleting the message being replied to would be worse than
    // letting the per-request ceiling reject it with an honest sentence.
    const turns = [{ text: 'old' }, { text: 'x'.repeat(5_000) }]
    expect(trimTurnsToCharBudget(turns, 1_000)).toEqual([turns[1]])
  })
})

/* --- reservation building ------------------------------------------------- */

describe('buildUsageReservation', () => {
  it('reserves estimated input plus the full output ceiling for text tasks', () => {
    const r = buildUsageReservation({
      task: 'chat.reply',
      model: 'gpt-5.6-luna',
      maxOutputTokens: 2_048,
      promptChars: 8_000,
    })
    expect(r.category).toBe('chat')
    expect(r.inputTokens).toBe(2_000) // 8000 chars / 4
    expect(r.outputTokens).toBe(2_048)
    expect(r.costUsd).toBeGreaterThan(0)
  })

  it('adds flat conservative weight for attachment parts the char count cannot see', () => {
    const bare = buildUsageReservation({
      task: 'chat.reply',
      model: 'gpt-5.6-luna',
      maxOutputTokens: 2_048,
      promptChars: 4_000,
    })
    const loaded = buildUsageReservation({
      task: 'chat.reply',
      model: 'gpt-5.6-luna',
      maxOutputTokens: 2_048,
      promptChars: 4_000,
      imageParts: 2,
      fileParts: 1,
    })
    expect(loaded.inputTokens).toBeGreaterThan(bare.inputTokens + 20_000)
  })

  it('image reservations carry zero text tokens but real pinned-rate dollars', () => {
    const r = buildUsageReservation({
      task: 'creative.generate_image',
      model: 'gpt-image-2',
      maxOutputTokens: 0,
      promptChars: 400,
    })
    expect(r.category).toBe('imageGeneration')
    expect(r.inputTokens).toBe(0)
    expect(r.outputTokens).toBe(0)
    // 100 text-in tokens at $5/1M + 2000 image-out at $30/1M ≈ $0.06.
    expect(r.costUsd).toBeCloseTo(0.0605, 4)
  })
})

/* --- applyReservation ------------------------------------------------------ */

describe('applyReservation', () => {
  it('creates the day document on first use and takes the reservation', () => {
    const outcome = reserve(null, reservation())
    expect(outcome.allowed).toBe(true)
    if (!outcome.allowed) return
    expect(outcome.doc.requests.chat).toBe(1)
    expect(outcome.doc.reservedInputTokens).toBe(1_000)
    expect(outcome.doc.reservedOutputTokens).toBe(2_048)
    expect(outcome.doc.inflight).toBe(1)
  })

  it('blocks the request over the category limit — and only that category', () => {
    const doc = freshDoc({
      requests: { chat: 100, websiteAnalysis: 0, aiGeneration: 0, imageGeneration: 0 },
    })
    const chat = reserve(doc, reservation())
    expect(chat).toEqual({ allowed: false, reason: 'request_limit' })
    // A different category is untouched by chat exhaustion.
    const analysis = reserve(doc, reservation({ category: 'websiteAnalysis' }))
    expect(analysis.allowed).toBe(true)
  })

  it('image exhaustion reads as image_limit, with its own user-facing sentence', () => {
    const doc = freshDoc({
      requests: { chat: 0, websiteAnalysis: 0, aiGeneration: 0, imageGeneration: 10 },
    })
    const outcome = reserve(
      doc,
      reservation({ category: 'imageGeneration', inputTokens: 0, outputTokens: 0 }),
    )
    expect(outcome).toEqual({ allowed: false, reason: 'image_limit' })
    expect(BLOCK_MESSAGES.image_limit).toContain('image-generation limit')
  })

  it('blocks on the input-token budget, counting outstanding reservations', () => {
    const doc = freshDoc({ inputTokens: 900_000, reservedInputTokens: 99_500 })
    expect(reserve(doc, reservation({ inputTokens: 1_000 }))).toEqual({
      allowed: false,
      reason: 'token_limit',
    })
    // Under the line, it passes: the boundary is exact.
    expect(reserve(doc, reservation({ inputTokens: 500 })).allowed).toBe(true)
  })

  it('blocks on the output-token budget independently of input', () => {
    const doc = freshDoc({ outputTokens: 399_000 })
    expect(reserve(doc, reservation({ outputTokens: 2_048 }))).toEqual({
      allowed: false,
      reason: 'token_limit',
    })
  })

  it('blocks on the cost ceiling across categories, images included', () => {
    const doc = freshDoc({ estimatedCostUsd: 1.98, reservedCostUsd: 0.01 })
    expect(reserve(doc, reservation({ costUsd: 0.02 }))).toEqual({
      allowed: false,
      reason: 'cost_limit',
    })
    expect(reserve(doc, reservation({ costUsd: 0.005 })).allowed).toBe(true)
  })

  it('plan isolation: the same day state that blocks Basic admits Pro on Pro limits', () => {
    const doc = freshDoc({
      plan: 'basic',
      requests: { chat: 150, websiteAnalysis: 0, aiGeneration: 0, imageGeneration: 0 },
    })
    expect(reserve(doc, reservation())).toEqual({ allowed: false, reason: 'request_limit' })
    expect(reserve(doc, reservation(), 'pro').allowed).toBe(true)
  })

  it('caps concurrent in-flight calls', () => {
    const doc = freshDoc({ inflight: 4, lastReserveAt: NOW - 1_000 })
    expect(reserve(doc, reservation())).toEqual({ allowed: false, reason: 'concurrency' })
  })

  it('forgives reservations orphaned by a crashed call, after the stale window', () => {
    // 4 in flight, none reserved recently: every function timeout is well
    // under the stale window, so these are dead. The user is not locked out.
    const doc = freshDoc({
      inflight: 4,
      lastReserveAt: NOW - STALE_INFLIGHT_MS - 1,
      reservedInputTokens: 500_000,
      reservedOutputTokens: 100_000,
      reservedCostUsd: 1.5,
    })
    const outcome = reserve(doc, reservation())
    expect(outcome.allowed).toBe(true)
    if (!outcome.allowed) return
    expect(outcome.doc.inflight).toBe(1)
    expect(outcome.doc.reservedInputTokens).toBe(1_000)
  })

  it('does NOT reset while a recent reservation is live — the window protects, never erases', () => {
    const doc = freshDoc({ inflight: 4, lastReserveAt: NOW - STALE_INFLIGHT_MS + 5_000 })
    expect(reserve(doc, reservation())).toEqual({ allowed: false, reason: 'concurrency' })
  })
})

/* --- applySettlement ------------------------------------------------------- */

describe('applySettlement', () => {
  it('releases the reservation and books the provider-reported actuals', () => {
    const reserved = reserve(null, reservation())
    if (!reserved.allowed) throw new Error('setup failed')
    const settled = applySettlement(reserved.doc, {
      reservation: reservation(),
      actual: {
        inputTokens: 700,
        outputTokens: 150,
        cachedInputTokens: 300,
        imageInputTokens: 0,
        imageOutputTokens: 0,
        costUsd: 0.0005,
        imageGenerated: false,
      },
      now: NOW + 5_000,
    })
    expect(settled.reservedInputTokens).toBe(0)
    expect(settled.reservedOutputTokens).toBe(0)
    expect(settled.inflight).toBe(0)
    expect(settled.inputTokens).toBe(700)
    expect(settled.outputTokens).toBe(150)
    expect(settled.cachedInputTokens).toBe(300)
    expect(settled.estimatedCostUsd).toBeCloseTo(0.0005, 6)
    // The attempt itself is never released.
    expect(settled.requests.chat).toBe(1)
  })

  it('a failed call keeps its request count but books zero tokens', () => {
    const reserved = reserve(null, reservation())
    if (!reserved.allowed) throw new Error('setup failed')
    const settled = applySettlement(reserved.doc, {
      reservation: reservation(),
      actual: ZERO_ACTUAL,
      now: NOW + 5_000,
    })
    expect(settled.requests.chat).toBe(1)
    expect(settled.inputTokens).toBe(0)
    expect(settled.reservedInputTokens).toBe(0)
    expect(settled.estimatedCostUsd).toBe(0)
  })

  it('floors at zero after a staleness reset already released the reservation', () => {
    // The reset zeroed the reserved counters; the late settlement of the
    // dead call must not drive them negative and mint budget.
    const settled = applySettlement(freshDoc(), {
      reservation: reservation(),
      actual: ZERO_ACTUAL,
      now: NOW,
    })
    expect(settled.reservedInputTokens).toBe(0)
    expect(settled.reservedOutputTokens).toBe(0)
    expect(settled.reservedCostUsd).toBe(0)
    expect(settled.inflight).toBe(0)
  })

  it('books image actuals to the image counters and counts the delivered image', () => {
    const r = reservation({ category: 'imageGeneration', inputTokens: 0, outputTokens: 0, costUsd: 0.06 })
    const reserved = reserve(null, r)
    if (!reserved.allowed) throw new Error('setup failed')
    const settled = applySettlement(reserved.doc, {
      reservation: r,
      actual: {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        imageInputTokens: 40,
        imageOutputTokens: 1_600,
        costUsd: 0.0482,
        imageGenerated: true,
      },
      now: NOW + 20_000,
    })
    expect(settled.imageInputTokens).toBe(40)
    expect(settled.imageOutputTokens).toBe(1_600)
    expect(settled.imagesGenerated).toBe(1)
    expect(settled.inputTokens).toBe(0)
    expect(settled.outputTokens).toBe(0)
  })
})

/* --- the concurrent race --------------------------------------------------- */

/**
 * A minimal model of Firestore's optimistic transactions: each "request"
 * reads the current document, applies the pure transition, and commits only
 * if the document has not changed since its read; on conflict it retries.
 * This is exactly the serialisation guarantee guardrail.ts leans on.
 *
 * With `settle: true` each granted reservation is settled immediately after
 * committing (actuals mirroring the reservation), the way a completed call
 * would — so a long burst exercises the DAILY limits rather than parking the
 * whole burst on the concurrency cap.
 */
async function raceReservations(
  initial: UsageDoc | null,
  reservations: UsageReservation[],
  opts: { settle?: boolean } = {},
): Promise<{ granted: number; blocked: number; doc: UsageDoc | null }> {
  let stored = initial
  let version = 0
  let granted = 0
  let blocked = 0

  await Promise.all(
    reservations.map(async (r) => {
      // Interleave: everyone reads before anyone commits on the first pass.
      for (;;) {
        const readVersion = version
        const readDoc = stored
        await Promise.resolve() // yield, so reads genuinely interleave
        const outcome = applyReservation(readDoc, {
          uid: 'u1',
          plan: 'basic',
          period: '2026-09-04',
          reservation: r,
          now: NOW,
        })
        if (!outcome.allowed) {
          blocked += 1
          return
        }
        if (version !== readVersion) continue // conflict: retry from a fresh read
        stored = outcome.doc
        version += 1
        granted += 1
        if (opts.settle) {
          stored = applySettlement(stored, {
            reservation: r,
            actual: {
              ...ZERO_ACTUAL,
              inputTokens: r.inputTokens,
              outputTokens: r.outputTokens,
              imageGenerated: r.category === 'imageGeneration',
              costUsd: r.costUsd,
            },
            now: NOW,
          })
          version += 1
        }
        return
      }
    }),
  )

  return { granted, blocked, doc: stored }
}

describe('concurrent reservation race (the §15 boundary)', () => {
  it('limit 10, current 9, two concurrent requests: EXACTLY one succeeds', async () => {
    const doc = freshDoc({
      requests: { chat: 0, websiteAnalysis: 0, aiGeneration: 0, imageGeneration: 9 },
    })
    const r = reservation({ category: 'imageGeneration', inputTokens: 0, outputTokens: 0 })
    const { granted, blocked, doc: final } = await raceReservations(doc, [r, r])
    expect(granted).toBe(1)
    expect(blocked).toBe(1)
    expect(final!.requests.imageGeneration).toBe(10)
  })

  it('an unsettled burst parks on the concurrency cap — at most maxConcurrent ever in flight', async () => {
    const burst = Array.from({ length: 20 }, () => reservation())
    const { granted, blocked, doc: final } = await raceReservations(null, burst)
    expect(granted).toBe(GUARDRAIL_LIMITS.basic.maxConcurrent)
    expect(blocked).toBe(20 - granted)
    expect(final!.inflight).toBe(granted)
  })

  it('the request limit lands exactly, however a settling burst races', async () => {
    // 210 chat calls, each completing normally. The chat limit is 100:
    // exactly 100 win, and the settled output totals exactly 100 ceilings.
    const r = reservation({ inputTokens: 10, outputTokens: 2_048, costUsd: 0 })
    const burst = Array.from({ length: 210 }, () => r)
    const { granted, blocked, doc: final } = await raceReservations(null, burst, { settle: true })
    expect(granted).toBe(GUARDRAIL_LIMITS.basic.requests.chat)
    expect(blocked).toBe(210 - granted)
    expect(final!.outputTokens).toBe(granted * 2_048)
    expect(final!.outputTokens).toBeLessThanOrEqual(GUARDRAIL_LIMITS.basic.dailyOutputTokens)
    expect(final!.inflight).toBe(0)
  })

  it('a full day of racing traffic lands exactly on the Basic limits, never past them', async () => {
    const mixed: UsageReservation[] = [
      ...Array.from({ length: 120 }, () => reservation()),
      ...Array.from({ length: 12 }, () =>
        reservation({ category: 'imageGeneration', inputTokens: 0, outputTokens: 0, costUsd: 0.06 }),
      ),
      ...Array.from({ length: 30 }, () =>
        reservation({ category: 'aiGeneration', inputTokens: 5_000, outputTokens: 2_048 }),
      ),
    ]
    const { doc: final } = await raceReservations(null, mixed, { settle: true })
    const limits = GUARDRAIL_LIMITS.basic
    expect(final!.requests.chat).toBe(limits.requests.chat)
    expect(final!.requests.imageGeneration).toBe(limits.requests.imageGeneration)
    expect(final!.requests.aiGeneration).toBe(limits.requests.aiGeneration)
    expect(final!.imagesGenerated).toBe(limits.requests.imageGeneration)
    expect(final!.inputTokens).toBeLessThanOrEqual(limits.dailyInputTokens)
    expect(final!.estimatedCostUsd).toBeLessThanOrEqual(limits.dailyCostUsd)
    expect(final!.inflight).toBe(0)
    expect(final!.reservedInputTokens).toBe(0)
  })
})
