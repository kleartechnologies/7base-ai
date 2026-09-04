import { FirebaseError } from 'firebase/app'

/**
 * Firebase error codes are precise but unreadable. Restaurant owners should
 * never see `auth/invalid-credential`, and raw codes can also leak whether an
 * account exists, so unknown codes fall back to a generic message.
 */
const AUTH_MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'That email address does not look right.',
  'auth/user-disabled': 'This account has been disabled. Please contact support.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account already exists with that email.',
  'auth/weak-password': 'Please choose a password with at least 6 characters.',
  'auth/popup-closed-by-user': 'Sign-in was cancelled.',
  'auth/cancelled-popup-request': 'Sign-in was cancelled.',
  'auth/popup-blocked': 'Your browser blocked the sign-in window. Please allow popups and retry.',
  'auth/network-request-failed': 'Network problem. Please check your connection and try again.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/operation-not-allowed': 'This sign-in method is not enabled for this project.',
}

const GENERIC_MESSAGES: Record<string, string> = {
  'permission-denied': 'You do not have access to that.',
  unauthenticated: 'Please sign in again.',
  unavailable: 'EVA could not reach the server. Please try again.',
  'deadline-exceeded': 'That took too long. Please try again.',
  'resource-exhausted': 'You have reached a usage limit. Please try again later.',
  'failed-precondition': 'EVA is not set up to do that yet.',
}

export function toUserMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof FirebaseError) {
    return AUTH_MESSAGES[error.code] ?? GENERIC_MESSAGES[error.code] ?? fallback
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

export function isFirebaseErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof FirebaseError && error.code === code
}
