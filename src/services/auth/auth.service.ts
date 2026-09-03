import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth'
import { getFirebaseAuth } from '@/lib/firebase/app'
import { ensureUserProfile } from '@/services/business/user.service'
import type { UserProfile } from '@/types'

export interface AuthUser {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  emailVerified: boolean
}

function toAuthUser(user: User): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    emailVerified: user.emailVerified,
  }
}

/**
 * Subscribes to sign-in state. Returns the unsubscribe function.
 *
 * On every sign-in the matching `users/{uid}` profile is created if missing,
 * so the rest of the app can assume a profile exists.
 */
export function observeAuth(
  onChange: (user: AuthUser | null, profile: UserProfile | null) => void,
  onError: (error: unknown) => void,
): () => void {
  return onAuthStateChanged(
    getFirebaseAuth(),
    (user) => {
      if (!user) {
        onChange(null, null)
        return
      }
      // Profile creation is best-effort: an offline user should still be
      // considered signed in rather than being bounced to the sign-in page.
      ensureUserProfile(toAuthUser(user))
        .then((profile) => onChange(toAuthUser(user), profile))
        .catch((error) => {
          onError(error)
          onChange(toAuthUser(user), null)
        })
    },
    onError,
  )
}

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthUser> {
  const credential = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password)
  const trimmed = displayName.trim()
  if (trimmed) {
    await updateProfile(credential.user, { displayName: trimmed })
  }
  return toAuthUser(credential.user)
}

export async function signInWithEmail(email: string, password: string): Promise<AuthUser> {
  const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email, password)
  return toAuthUser(credential.user)
}

export async function signInWithGoogle(): Promise<AuthUser> {
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  const credential = await signInWithPopup(getFirebaseAuth(), provider)
  return toAuthUser(credential.user)
}

export async function requestPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(getFirebaseAuth(), email)
}

export async function signOutUser(): Promise<void> {
  await signOut(getFirebaseAuth())
}
