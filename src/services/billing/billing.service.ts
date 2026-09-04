import type { EntityId, Millis } from '@/types'

/**
 * Billing seam — Billplz is NOT implemented.
 *
 * This module exists so that plan state has a home and the UI can already ask
 * "what plan is this account on?" without every feature growing its own guess.
 * When Billplz lands it becomes: create bill (Cloud Function, secret key
 * server-side) → redirect to Billplz → webhook verifies the X-Signature and
 * writes the subscription → this module reads it.
 *
 * The plan names here mirror the server's canon (`subscriptions/{uid}` →
 * basic | pro). The server is the authority on what a plan may do — usage
 * limits are enforced in the Cloud Functions, not here — so this module
 * deliberately carries no limit numbers for the UI to drift out of date.
 *
 * No Billplz key must ever appear in this bundle.
 */

export type PlanId = 'basic' | 'pro'

export interface Subscription {
  id: EntityId
  ownerId: EntityId
  planId: PlanId
  status: 'active' | 'past_due' | 'cancelled'
  currentPeriodEnd: Millis | null
}

/** Human name for a plan, for display only. */
export function getPlanName(planId: PlanId): string {
  return planId === 'pro' ? 'Pro' : 'Basic'
}

/**
 * Every account is on `basic` until billing exists — the same default the
 * server applies when no subscription document is found. Kept as a function,
 * not a constant, so callers are already written against an async-shaped
 * source.
 */
export function getCurrentPlan(): PlanId {
  return 'basic'
}
