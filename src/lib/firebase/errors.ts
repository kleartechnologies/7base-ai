import { FirebaseError } from 'firebase/app'
import { t } from '@/i18n/store'
import type { MessageKey } from '@/i18n/translate'

/**
 * Firebase error codes are precise but unreadable. Restaurant owners should
 * never see `auth/invalid-credential`, and raw codes can also leak whether an
 * account exists, so unknown codes fall back to a generic message.
 *
 * The maps hold dictionary keys, not sentences, and resolve through the i18n
 * store's `t` at the moment the error is shown — so the sentence comes out in
 * whichever language is active then.
 */
const AUTH_MESSAGE_KEYS: Record<string, MessageKey> = {
  'auth/invalid-email': 'firebaseError.invalidEmail',
  'auth/user-disabled': 'firebaseError.userDisabled',
  'auth/user-not-found': 'firebaseError.wrongCredentials',
  'auth/wrong-password': 'firebaseError.wrongCredentials',
  'auth/invalid-credential': 'firebaseError.wrongCredentials',
  'auth/email-already-in-use': 'firebaseError.emailInUse',
  'auth/weak-password': 'firebaseError.weakPassword',
  'auth/popup-closed-by-user': 'firebaseError.popupClosed',
  'auth/cancelled-popup-request': 'firebaseError.popupClosed',
  'auth/popup-blocked': 'firebaseError.popupBlocked',
  'auth/network-request-failed': 'firebaseError.network',
  'auth/too-many-requests': 'firebaseError.tooManyRequests',
  'auth/operation-not-allowed': 'firebaseError.notEnabled',
}

const GENERIC_MESSAGE_KEYS: Record<string, MessageKey> = {
  'permission-denied': 'firebaseError.permissionDenied',
  unauthenticated: 'firebaseError.signInAgain',
  unavailable: 'firebaseError.unreachable',
  'deadline-exceeded': 'firebaseError.tookTooLong',
  'resource-exhausted': 'firebaseError.usageLimit',
  'failed-precondition': 'firebaseError.notSetUp',
}

export function toUserMessage(error: unknown, fallback?: string): string {
  if (error instanceof FirebaseError) {
    const key = AUTH_MESSAGE_KEYS[error.code] ?? GENERIC_MESSAGE_KEYS[error.code]
    if (key) return t(key)
    return fallback ?? t('firebaseError.fallback')
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback ?? t('firebaseError.fallback')
}

export function isFirebaseErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof FirebaseError && error.code === code
}
