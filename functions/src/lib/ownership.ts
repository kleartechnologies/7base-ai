import { permissionDenied } from './errors'

/**
 * The ownership check, kept in its own module.
 *
 * Security rules protect direct client access to Firestore, but the Admin SDK
 * bypasses rules entirely — so every callable has to re-check ownership
 * itself. Every one of those paths funnels through this single comparison,
 * which is why it lives apart from the Firestore handle: it can then be tested
 * on its own, without an Admin app.
 */
export function assertOwnership(data: { ownerId?: unknown } | null | undefined, uid: string): void {
  // An empty uid must never match an empty `ownerId`. Callables authenticate
  // before reaching here, so this cannot happen today — but the cost of the
  // check is nothing next to the cost of it ever becoming possible.
  if (!uid || !data || typeof data.ownerId !== 'string' || data.ownerId !== uid) {
    throw permissionDenied()
  }
}
