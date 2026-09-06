import { logger } from 'firebase-functions'
import { HttpsError } from 'firebase-functions/v2/https'
import type { AiTask, SubscriptionPlan } from '../config/models'
import { COLLECTIONS, db } from '../lib/firebase'
import {
  applyReservation,
  applySettlement,
  BLOCK_MESSAGES,
  CATEGORY_FOR_TASK,
  dailyPeriodKeyUtc,
  GUARDRAIL_LIMITS,
  usageDocId,
  ZERO_ACTUAL,
  type UsageActual,
  type UsageDoc,
  type UsageReservation,
} from './limits'

/**
 * Phase 6B — the guardrail's Firestore edge.
 *
 * Two operations, both transactions over usage/{uid}_{YYYY-MM-DD}:
 *
 *   reserveAiUsage — BEFORE OpenAI. Throws `resource-exhausted` (with the
 *   user-facing sentence from limits.ts) when a limit blocks the call, and a
 *   failure to even run the transaction fails CLOSED: no reservation, no
 *   model call.
 *
 *   settleAiUsage — AFTER OpenAI, success or failure. Never throws: by the
 *   time it runs, the money is spent, so a settlement problem is a telemetry
 *   loss, not a reason to fail a request the user already paid for. The
 *   staleness reset in limits.ts is the safety net for lost settlements.
 *
 * All decision logic lives in limits.ts as pure functions; this file only
 * moves documents. That is why it has no unit tests of its own — the
 * arithmetic (including the concurrent-reservation race) is pinned down in
 * limits.test.ts, and this wrapper is exercised end to end by the smoke
 * tests.
 */

export interface UsageHandle {
  uid: string
  plan: SubscriptionPlan
  task: AiTask
  /** The period the reservation was booked under — settlement targets the
   * same document even if the call straddles UTC midnight. */
  period: string
  reservation: UsageReservation
}

export async function reserveAiUsage(args: {
  uid: string
  plan: SubscriptionPlan
  task: AiTask
  reservation: UsageReservation
}): Promise<UsageHandle> {
  const now = Date.now()
  const period = dailyPeriodKeyUtc(now)
  const ref = db.collection(COLLECTIONS.usage).doc(usageDocId(args.uid, period))

  const outcome = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    const result = applyReservation(snapshot.exists ? (snapshot.data() as UsageDoc) : null, {
      uid: args.uid,
      plan: args.plan,
      period,
      reservation: args.reservation,
      now,
    })
    if (result.allowed) tx.set(ref, result.doc)
    return result
  })

  if (!outcome.allowed) {
    // Blocked-request telemetry: who, what, why — never prompt content.
    logger.warn('usage.blocked', {
      uid: args.uid,
      plan: args.plan,
      task: args.task,
      category: args.reservation.category,
      reason: outcome.reason,
      period,
    })
    throw new HttpsError('resource-exhausted', BLOCK_MESSAGES[outcome.reason])
  }

  return { uid: args.uid, plan: args.plan, task: args.task, period, reservation: args.reservation }
}

export async function settleAiUsage(handle: UsageHandle, actual: UsageActual): Promise<void> {
  const now = Date.now()
  const ref = db.collection(COLLECTIONS.usage).doc(usageDocId(handle.uid, handle.period))
  try {
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref)
      // The reservation created this document; if it is somehow gone, there
      // is nothing to release and inventing one would book usage twice.
      if (!snapshot.exists) return
      tx.set(
        ref,
        applySettlement(snapshot.data() as UsageDoc, {
          reservation: handle.reservation,
          actual,
          now,
        }),
      )
    })
  } catch (error) {
    logger.error('usage.settle_failed', {
      uid: handle.uid,
      task: handle.task,
      period: handle.period,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Settlement for a call that failed: zero tokens, the attempt still counted. */
export async function settleAiUsageFailure(handle: UsageHandle): Promise<void> {
  await settleAiUsage(handle, ZERO_ACTUAL)
}

/**
 * Read-only advisory pre-check for callables whose expensive work happens
 * BEFORE their model call (website analysis crawls for up to 45s first).
 * Blocking here saves the crawl when today's request budget is already
 * gone. It is deliberately not atomic and reserves nothing — the
 * transaction inside reserveAiUsage remains the only authority — so a race
 * that slips past this check is still caught there.
 */
export async function assertRequestBudgetRemains(args: {
  uid: string
  plan: SubscriptionPlan
  task: AiTask
}): Promise<void> {
  const category = CATEGORY_FOR_TASK[args.task]
  const limit = GUARDRAIL_LIMITS[args.plan].requests[category]
  const period = dailyPeriodKeyUtc(Date.now())
  const snapshot = await db
    .collection(COLLECTIONS.usage)
    .doc(usageDocId(args.uid, period))
    .get()
  if (!snapshot.exists) return
  const doc = snapshot.data() as UsageDoc
  if (doc.requests[category] >= limit) {
    logger.warn('usage.blocked', {
      uid: args.uid,
      plan: args.plan,
      task: args.task,
      category,
      reason: category === 'imageGeneration' ? 'image_limit' : 'request_limit',
      period,
      precheck: true,
    })
    throw new HttpsError(
      'resource-exhausted',
      BLOCK_MESSAGES[category === 'imageGeneration' ? 'image_limit' : 'request_limit'],
    )
  }
}

/**
 * Phase 7F: how many more requests of each category today's budget allows,
 * read once and reserved never. EVA's chat action uses it to keep a promise
 * honest before making it — "I can create 2 of the 3 today" — while the
 * transaction inside reserveAiUsage stays the only authority: a race that
 * slips past this peek is still blocked there, per poster, and the result
 * message then says so.
 */
export async function peekRemainingRequests(args: {
  uid: string
  plan: SubscriptionPlan
}): Promise<{ aiGeneration: number; imageGeneration: number }> {
  const limits = GUARDRAIL_LIMITS[args.plan].requests
  const period = dailyPeriodKeyUtc(Date.now())
  const snapshot = await db
    .collection(COLLECTIONS.usage)
    .doc(usageDocId(args.uid, period))
    .get()
  const used = snapshot.exists
    ? (snapshot.data() as UsageDoc).requests
    : { aiGeneration: 0, imageGeneration: 0 }
  return {
    aiGeneration: Math.max(0, limits.aiGeneration - (used.aiGeneration ?? 0)),
    imageGeneration: Math.max(0, limits.imageGeneration - (used.imageGeneration ?? 0)),
  }
}
