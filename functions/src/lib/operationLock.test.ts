import { describe, expect, it } from 'vitest'
import { HttpsError } from 'firebase-functions/v2/https'

import {
  OPERATION_LOCK_STALE_MS,
  withOperationLock,
  type OperationLockDeps,
} from './operationLock'

/**
 * The idempotency lock around every expensive callable. What must hold:
 * a duplicate in flight is refused before any work starts, a crashed run's
 * abandoned lock is taken over rather than wedging the operation forever,
 * and the lock is released on success and failure alike.
 */

const PARAMS = {
  key: 'campaign.build_alice_rec1',
  ownerId: 'alice',
  operation: 'campaign.build',
  busyMessage: 'This campaign is already being built.',
}

interface FakeLockState {
  held: Map<string, { createdAt: number }>
  events: string[]
}

function fakeDeps(state: FakeLockState, nowMs = 1_000_000): OperationLockDeps {
  return {
    async createLock(key, lock) {
      if (state.held.has(key)) throw new Error('ALREADY_EXISTS')
      state.held.set(key, { createdAt: lock.createdAt })
      state.events.push('create')
    },
    async takeOverStaleLock(key, lock, staleBefore) {
      const existing = state.held.get(key)
      if (existing && existing.createdAt > staleBefore) return false
      state.held.set(key, { createdAt: lock.createdAt })
      state.events.push('takeover')
      return true
    },
    async releaseLock(key) {
      state.held.delete(key)
      state.events.push('release')
    },
    now: () => nowMs,
  }
}

describe('withOperationLock', () => {
  it('acquires, runs the work, and releases on success', async () => {
    const state: FakeLockState = { held: new Map(), events: [] }
    const result = await withOperationLock(PARAMS, async () => 'done', fakeDeps(state))

    expect(result).toBe('done')
    expect(state.events).toEqual(['create', 'release'])
    expect(state.held.size).toBe(0)
  })

  it('refuses a concurrent duplicate before any work starts', async () => {
    const state: FakeLockState = { held: new Map(), events: [] }
    const deps = fakeDeps(state)
    // A fresh holder: same instant, so far from stale.
    state.held.set(PARAMS.key, { createdAt: 1_000_000 })

    let ran = false
    const attempt = withOperationLock(
      PARAMS,
      async () => {
        ran = true
      },
      deps,
    )

    await expect(attempt).rejects.toMatchObject({
      code: 'already-exists',
      message: PARAMS.busyMessage,
    })
    await expect(attempt).rejects.toBeInstanceOf(HttpsError)
    expect(ran).toBe(false)
    // The duplicate must not release the original holder's lock.
    expect(state.held.has(PARAMS.key)).toBe(true)
    expect(state.events).toEqual([])
  })

  it('releases the lock when the work throws — a failed attempt never wedges the operation', async () => {
    const state: FakeLockState = { held: new Map(), events: [] }

    await expect(
      withOperationLock(
        PARAMS,
        async () => {
          throw new Error('model exploded')
        },
        fakeDeps(state),
      ),
    ).rejects.toThrow('model exploded')

    expect(state.held.size).toBe(0)
    expect(state.events).toEqual(['create', 'release'])
  })

  it('takes over a lock abandoned by a crashed run', async () => {
    const state: FakeLockState = { held: new Map(), events: [] }
    const now = 10_000_000
    // Older than the staleness window: the holder is long dead.
    state.held.set(PARAMS.key, { createdAt: now - OPERATION_LOCK_STALE_MS - 1 })

    const result = await withOperationLock(PARAMS, async () => 'recovered', fakeDeps(state, now))

    expect(result).toBe('recovered')
    expect(state.events).toEqual(['takeover', 'release'])
    expect(state.held.size).toBe(0)
  })

  it('does not take over a lock that is merely old, not stale', async () => {
    const state: FakeLockState = { held: new Map(), events: [] }
    const now = 10_000_000
    // One millisecond inside the window: still presumed alive.
    state.held.set(PARAMS.key, { createdAt: now - OPERATION_LOCK_STALE_MS + 1 })

    await expect(
      withOperationLock(PARAMS, async () => 'never', fakeDeps(state, now)),
    ).rejects.toMatchObject({ code: 'already-exists' })
  })

  it('returns the work result even when the release fails — staleness self-heals it', async () => {
    const state: FakeLockState = { held: new Map(), events: [] }
    const deps = fakeDeps(state)
    deps.releaseLock = async () => {
      throw new Error('firestore hiccup')
    }

    await expect(withOperationLock(PARAMS, async () => 42, deps)).resolves.toBe(42)
  })

  it('treats a takeover probe failure as busy, never as acquired', async () => {
    const state: FakeLockState = { held: new Map(), events: [] }
    const deps = fakeDeps(state)
    state.held.set(PARAMS.key, { createdAt: 1 })
    deps.takeOverStaleLock = async () => {
      throw new Error('transaction aborted')
    }

    await expect(withOperationLock(PARAMS, async () => 'no', deps)).rejects.toMatchObject({
      code: 'already-exists',
    })
  })
})
