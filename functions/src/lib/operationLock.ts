import { HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { COLLECTIONS, db } from './firebase'

/**
 * Firestore-backed in-flight locks for expensive callables.
 *
 * A double-clicked button or a retried request must not run the same model
 * call twice and bill the owner twice. Each guarded operation holds one
 * document in the server-only `operations` collection while it runs; the
 * document id is deterministic (operation + owner + resource), so a
 * concurrent duplicate fails Firestore's atomic create() and is refused with
 * an owner-readable sentence instead of spending anything.
 *
 * The lock is scoped to the caller: keys embed the uid, and every caller
 * acquires it only *after* its ownership checks, so no account can hold — or
 * probe — a lock over another account's resources.
 *
 * Failure never wedges the operation. The lock is released in `finally`
 * whether the work succeeded or threw; if the process dies outright (crash,
 * function timeout), the abandoned document is taken over once it is older
 * than `OPERATION_LOCK_STALE_MS` — comfortably past the longest callable
 * deadline (540s), mirroring the usage guardrail's stale-inflight window.
 */

export const OPERATION_LOCK_STALE_MS = 10 * 60 * 1000

interface StoredLock {
  ownerId: string
  operation: string
  createdAt: number
}

/** Effectful collaborators, injectable so tests never need Firebase. */
export interface OperationLockDeps {
  /** Atomically creates the lock; must reject if the document exists. */
  createLock: (key: string, lock: StoredLock) => Promise<void>
  /**
   * Transactionally replaces a lock whose createdAt is `staleBefore` or
   * older (or which vanished since createLock failed). Returns true when the
   * caller now holds the lock, false when a fresh lock is still in place.
   */
  takeOverStaleLock: (key: string, lock: StoredLock, staleBefore: number) => Promise<boolean>
  releaseLock: (key: string) => Promise<void>
  now: () => number
}

function locksCollection() {
  return db.collection(COLLECTIONS.operations)
}

const defaultDeps: OperationLockDeps = {
  async createLock(key, lock) {
    await locksCollection().doc(key).create(lock)
  },
  async takeOverStaleLock(key, lock, staleBefore) {
    return db.runTransaction(async (tx) => {
      const ref = locksCollection().doc(key)
      const snapshot = await tx.get(ref)
      if (snapshot.exists) {
        const existing = snapshot.data() as StoredLock
        if (typeof existing.createdAt === 'number' && existing.createdAt > staleBefore) {
          return false
        }
      }
      tx.set(ref, lock)
      return true
    })
  },
  async releaseLock(key) {
    await locksCollection().doc(key).delete()
  },
  now: () => Date.now(),
}

/**
 * Runs `fn` while holding the lock named by `key`, releasing it on every
 * exit path. A concurrent holder of a fresh lock produces an
 * `already-exists` HttpsError carrying `busyMessage` — safe to show the
 * owner — and `fn` is never started, so nothing is billed.
 */
export async function withOperationLock<T>(
  params: { key: string; ownerId: string; operation: string; busyMessage: string },
  fn: () => Promise<T>,
  deps: OperationLockDeps = defaultDeps,
): Promise<T> {
  const lock: StoredLock = {
    ownerId: params.ownerId,
    operation: params.operation,
    createdAt: deps.now(),
  }

  try {
    await deps.createLock(params.key, lock)
  } catch {
    // The document exists (or the create raced) — a fresh lock means a
    // duplicate in flight; a stale one means a crashed run to take over.
    const staleBefore = deps.now() - OPERATION_LOCK_STALE_MS
    let acquired: boolean
    try {
      acquired = await deps.takeOverStaleLock(params.key, lock, staleBefore)
    } catch {
      // A failed probe must read as "busy", never as "acquired".
      acquired = false
    }
    if (!acquired) {
      throw new HttpsError('already-exists', params.busyMessage)
    }
    logger.warn('operation.lock.stale_takeover', { operation: params.operation, key: params.key })
  }

  try {
    return await fn()
  } finally {
    try {
      await deps.releaseLock(params.key)
    } catch (releaseError) {
      // An unreleased lock self-heals via the staleness window; the work's
      // own outcome must not be replaced by a cleanup failure.
      logger.warn('operation.lock.release_failed', {
        operation: params.operation,
        key: params.key,
        reason: releaseError instanceof Error ? releaseError.message : 'unknown',
      })
    }
  }
}
