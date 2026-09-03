import { getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { userDoc } from '@/lib/firebase/collections'
import { fromDocSnapshot } from '@/lib/firebase/mapper'
import type { AuthUser } from '@/services/auth/auth.service'
import type { OnboardingStep, UserProfile } from '@/types'

/**
 * Reads `users/{uid}`, creating it on first sign-in.
 *
 * The profile deliberately holds no marketing data — that belongs to the
 * business. It only records identity and which business the app opens into.
 */
export async function ensureUserProfile(user: AuthUser): Promise<UserProfile> {
  const ref = userDoc(user.uid)
  const snapshot = await getDoc(ref)
  const existing = fromDocSnapshot<UserProfile>(snapshot)

  if (existing) {
    return { ...existing, id: user.uid }
  }

  const now = Date.now()
  const profile: Omit<UserProfile, 'id'> = {
    email: user.email ?? '',
    displayName: user.displayName,
    photoURL: user.photoURL,
    businessIds: [],
    activeBusinessId: null,
    onboarding: { step: 'not_started', completedAt: null },
    locale: 'en-MY',
    createdAt: now,
    updatedAt: now,
  }

  await setDoc(ref, profile)
  return { id: user.uid, ...profile }
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const snapshot = await getDoc(userDoc(userId))
  return fromDocSnapshot<UserProfile>(snapshot)
}

export async function setActiveBusiness(userId: string, businessId: string): Promise<void> {
  await updateDoc(userDoc(userId), {
    activeBusinessId: businessId,
    updatedAt: Date.now(),
  })
}

/**
 * Records how far through onboarding the user is.
 *
 * The backend advances this too (it moves the user to `reviewing_discovery`
 * when an analysis lands), so this only ever moves it forward from the UI.
 */
export async function setOnboardingStep(userId: string, step: OnboardingStep): Promise<void> {
  await updateDoc(userDoc(userId), {
    'onboarding.step': step,
    'onboarding.completedAt': step === 'complete' ? Date.now() : null,
    updatedAt: Date.now(),
  })
}

/** `serverTimestamp` is re-exported so callers need not import Firestore. */
export { serverTimestamp }
