import { COLLECTIONS, FieldValue, db } from '../lib/firebase'

/**
 * Keeps `users/{uid}` in step with the business the backend just wrote.
 *
 * Done server-side so a client cannot claim a business it does not own by
 * writing its own profile index.
 *
 * ## Why this is not a one-liner
 *
 * Firestore parses dotted field paths in `update()` and **not** in `set()`.
 * An earlier version of this wrote:
 *
 *     ref.set({ 'onboarding.step': step }, { merge: true })
 *
 * which does not touch `onboarding.step` at all — it creates a *literal*
 * top-level field whose name happens to contain a dot, sitting beside the real
 * `onboarding` map. The app reads `profile.onboarding.step`, so onboarding
 * silently never advanced, and every affected profile carried a stray field
 * that no reader would ever look at.
 *
 * The correct form for a merge write is a nested object: `set` merges maps
 * key by key, so `{ onboarding: { step } }` updates the step and leaves
 * `onboarding.completedAt` alone.
 */

/** The literal field name the buggy write produced. Removed on every link. */
export const LEGACY_ONBOARDING_STEP_FIELD = 'onboarding.step'

export type BackendOnboardingStep = 'describe_business' | 'reviewing_discovery'

export interface UserBusinessLink {
  businessIds: unknown
  activeBusinessId: string
  onboarding: { step: BackendOnboardingStep }
  /** A delete sentinel, so the stray literal field is cleaned up in place. */
  [LEGACY_ONBOARDING_STEP_FIELD]: unknown
  updatedAt: number
}

/**
 * The exact merge payload written to `users/{uid}`.
 *
 * Split out from the write so the shape can be asserted in a unit test: the
 * bug this replaces was invisible at the call site and only observable in the
 * stored document.
 */
export function buildUserBusinessLink(
  businessId: string,
  step: BackendOnboardingStep,
  now: number = Date.now(),
): UserBusinessLink {
  return {
    businessIds: FieldValue.arrayUnion(businessId),
    activeBusinessId: businessId,
    // Nested, not dotted — see the note above.
    onboarding: { step },
    [LEGACY_ONBOARDING_STEP_FIELD]: FieldValue.delete(),
    updatedAt: now,
  }
}

export async function linkBusinessToUser(
  uid: string,
  businessId: string,
  step: BackendOnboardingStep,
): Promise<void> {
  await db
    .collection(COLLECTIONS.users)
    .doc(uid)
    .set(buildUserBusinessLink(businessId, step), { merge: true })
}
