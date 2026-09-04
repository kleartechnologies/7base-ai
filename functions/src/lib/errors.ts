import { HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'

/**
 * Error handling for callables.
 *
 * Two rules:
 *  1. The client gets a message a restaurant owner can read.
 *  2. The details — stack traces, provider responses, ids — go to logs only.
 *
 * Leaking a provider error message to the browser risks exposing prompt
 * content, quota details or internal identifiers.
 */

export function unauthenticated(): HttpsError {
  return new HttpsError('unauthenticated', 'Please sign in again.')
}

export function permissionDenied(): HttpsError {
  return new HttpsError('permission-denied', 'You do not have access to that.')
}

export function invalidArgument(message: string): HttpsError {
  return new HttpsError('invalid-argument', message)
}

export function notConfigured(): HttpsError {
  return new HttpsError(
    'failed-precondition',
    'EVA’s AI backend is not configured yet. An OpenAI API key is required.',
  )
}

/** Logs the real cause and returns a safe error for the client. */
export function internal(context: string, cause: unknown): HttpsError {
  logger.error(`[${context}]`, cause instanceof Error ? cause.stack ?? cause.message : cause)
  return new HttpsError('internal', 'EVA ran into a problem. Please try again.')
}
