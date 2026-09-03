import type { EntityId, Millis } from '@/types'

/**
 * Billing seam — Billplz is NOT implemented.
 *
 * This module exists so that plan state has a home and the UI can already ask
 * "what can this account do?" without every feature growing its own guess.
 * When Billplz lands it becomes: create bill (Cloud Function, secret key
 * server-side) → redirect to Billplz → webhook verifies the X-Signature and
 * writes the subscription → this module reads it.
 *
 * No Billplz key must ever appear in this bundle.
 */

export type PlanId = 'free' | 'starter' | 'pro'

export interface Subscription {
  id: EntityId
  ownerId: EntityId
  planId: PlanId
  status: 'active' | 'past_due' | 'cancelled'
  currentPeriodEnd: Millis | null
}

export interface PlanLimits {
  maxBusinesses: number
  maxCampaignsPerMonth: number
  maxCreativesPerMonth: number
}

const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: { maxBusinesses: 1, maxCampaignsPerMonth: 2, maxCreativesPerMonth: 10 },
  starter: { maxBusinesses: 1, maxCampaignsPerMonth: 15, maxCreativesPerMonth: 100 },
  pro: { maxBusinesses: 5, maxCampaignsPerMonth: 100, maxCreativesPerMonth: 1000 },
}

export function getPlanLimits(planId: PlanId): PlanLimits {
  return PLAN_LIMITS[planId]
}

/**
 * Every account is on `free` until billing exists. Kept as a function, not a
 * constant, so callers are already written against an async-shaped source.
 */
export function getCurrentPlan(): PlanId {
  return 'free'
}
