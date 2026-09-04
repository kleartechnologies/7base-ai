import { DEFAULT_PLAN, type SubscriptionPlan } from '../config/models'

/**
 * Subscription plan resolution — the pure half.
 *
 * The source of truth is `subscriptions/{uid}`, a document only Cloud
 * Functions (the Admin SDK) can write: security rules refuse every client
 * write, so an account cannot upgrade itself by editing Firestore, and the
 * callables never read a plan from a request payload. When billing lands
 * (Billplz webhook → verified signature → Admin write), it writes this
 * document; until then it is set by trusted server-side tooling only.
 *
 * This module has no Firebase imports on purpose — it is the part worth unit
 * testing exhaustively, because every malformed shape must land on Basic.
 * The Firestore lookup that feeds it lives in lib/auth.ts with the other
 * per-request identity checks.
 */

/**
 * The shape billing will eventually write. Kept to the minimum a model
 * router needs; limits, periods and invoices belong to the billing project.
 */
export interface StoredSubscription {
  ownerId: string
  planId: SubscriptionPlan
  /** Anything but 'active' — past_due, cancelled — routes as Basic. */
  status: 'active' | 'past_due' | 'cancelled'
  updatedAt: number
}

/**
 * Reduces whatever is (or is not) stored to a plan, fail-safe.
 *
 * Pro requires the full, explicit claim: `planId: 'pro'` AND
 * `status: 'active'`. A missing document, a missing status, a lapsed
 * subscription, a typo, or a value invented by anything untrusted all
 * resolve to Basic. Never the other way around.
 */
export function normalisePlan(data: unknown): SubscriptionPlan {
  if (typeof data !== 'object' || data === null) return DEFAULT_PLAN
  const record = data as Record<string, unknown>
  if (record.planId === 'pro' && record.status === 'active') return 'pro'
  return DEFAULT_PLAN
}

/**
 * Development-only plan override, so both tiers can be exercised locally
 * without a billing system or hand-written Firestore documents:
 *
 *   MARKA_DEV_PLAN_OVERRIDE=pro firebase emulators:start ...
 *
 * Honoured ONLY inside the Functions emulator (`FUNCTIONS_EMULATOR=true`,
 * set by the emulator itself and absent in deployed containers). In
 * production the variable is dead config; there is no client-reachable or
 * deploy-time path that turns a real account Pro through this mechanism.
 */
export function readDevPlanOverride(
  env: NodeJS.ProcessEnv = process.env,
): SubscriptionPlan | null {
  if (env.FUNCTIONS_EMULATOR !== 'true') return null
  const value = env.MARKA_DEV_PLAN_OVERRIDE
  return value === 'pro' || value === 'basic' ? value : null
}
