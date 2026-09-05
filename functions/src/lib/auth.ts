import type { CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { DEFAULT_PLAN, type SubscriptionPlan } from '../config/models'
import { permissionDenied, unauthenticated } from './errors'
import { COLLECTIONS, db } from './firebase'
import { DEFAULT_USER_LANGUAGE, normaliseUserLanguage, type UserLanguage } from './language'
import { assertOwnership } from './ownership'
import { normalisePlan, readDevPlanOverride } from './plan'

/**
 * Authorisation helpers.
 *
 * Security rules protect direct client access to Firestore, but the Admin SDK
 * bypasses rules entirely. Every callable must therefore re-check ownership
 * itself — these helpers are that check.
 */

export { assertOwnership }

export function requireUid(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid
  if (!uid) throw unauthenticated()
  return uid
}

/** Throws unless `uid` owns the conversation. Returns its data. */
export async function requireConversationOwner(
  conversationId: string,
  uid: string,
): Promise<FirebaseFirestore.DocumentData> {
  const snapshot = await db.collection(COLLECTIONS.conversations).doc(conversationId).get()
  if (!snapshot.exists) throw permissionDenied()

  const data = snapshot.data()
  assertOwnership(data, uid)

  return data as FirebaseFirestore.DocumentData
}

/**
 * The user's real subscription plan, resolved server-side.
 *
 * Reads `subscriptions/{uid}` through the Admin SDK — never a client payload,
 * never a client-writable field. Every failure mode (no document, malformed
 * document, Firestore error) resolves to Basic: a lookup problem may degrade
 * an account's model quality for one request, but must never upgrade it.
 *
 * Called once per callable invocation and threaded through to every model
 * call in that request, so a multi-call flow (copy + image) costs one read.
 */
export async function resolvePlanForUser(uid: string): Promise<SubscriptionPlan> {
  const override = readDevPlanOverride()
  if (override) {
    // Emulator-only (see lib/plan.ts). Logged loudly so a dev session's
    // routing is never mistaken for a real subscription.
    logger.info('plan.dev_override', { uid, plan: override })
    return override
  }

  try {
    const snapshot = await db.collection(COLLECTIONS.subscriptions).doc(uid).get()
    return normalisePlan(snapshot.exists ? snapshot.data() : null)
  } catch (error) {
    logger.warn('plan.lookup_failed', {
      uid,
      reason: error instanceof Error ? error.message : 'unknown',
    })
    return DEFAULT_PLAN
  }
}

/**
 * The user's saved app language, read server-side from their own profile
 * (`users/{uid}.preferences.language`) — the same value Settings writes for
 * the UI, reused as a deterministic signal for EVA's default reply language.
 * It is a preference, not an entitlement: any failure or unknown value
 * resolves to English, and nothing about models, plans or quotas depends on
 * it.
 */
export async function resolveLanguageForUser(uid: string): Promise<UserLanguage> {
  try {
    const snapshot = await db.collection(COLLECTIONS.users).doc(uid).get()
    return normaliseUserLanguage(snapshot.exists ? snapshot.data() : null)
  } catch (error) {
    logger.warn('language.lookup_failed', {
      uid,
      reason: error instanceof Error ? error.message : 'unknown',
    })
    return DEFAULT_USER_LANGUAGE
  }
}

/** Throws unless `uid` owns the business. Returns its data, or null if absent. */
export async function requireBusinessOwner(
  businessId: string,
  uid: string,
): Promise<FirebaseFirestore.DocumentData | null> {
  const snapshot = await db.collection(COLLECTIONS.businesses).doc(businessId).get()
  if (!snapshot.exists) return null

  const data = snapshot.data()
  assertOwnership(data, uid)

  return data as FirebaseFirestore.DocumentData
}
