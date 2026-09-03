import { describe, expect, it, vi } from 'vitest'

/**
 * Regression cover for the `onboarding.step` write.
 *
 * The bug was not a wrong value — it was a wrong *field*. `set(..., { merge:
 * true })` does not parse dotted paths, so `{ 'onboarding.step': step }`
 * created a literal top-level field beside the real `onboarding` map and the
 * nested step never moved.
 *
 * That is only visible in the shape of the payload, which is why
 * `buildUserBusinessLink` exists as its own function. `FieldValue` is stubbed
 * so this stays a pure test — Firestore's sentinels are opaque objects and the
 * assertions here are about where keys land, not what the sentinels contain.
 */

vi.mock('../lib/firebase', () => ({
  COLLECTIONS: { users: 'users' },
  db: {},
  FieldValue: {
    arrayUnion: (value: string) => ({ __sentinel: 'arrayUnion', value }),
    delete: () => ({ __sentinel: 'delete' }),
  },
}))

// `vi.mock` is hoisted above imports, so the stub above is already in place.
import { LEGACY_ONBOARDING_STEP_FIELD, buildUserBusinessLink } from './onboardingState'

const NOW = 1_800_000_000_000

describe('buildUserBusinessLink', () => {
  it('writes the step into the nested onboarding map', () => {
    const payload = buildUserBusinessLink('biz_1', 'reviewing_discovery', NOW)

    expect(payload.onboarding).toEqual({ step: 'reviewing_discovery' })
  })

  it('never writes the step as a literal dotted string value', () => {
    const payload = buildUserBusinessLink('biz_1', 'describe_business', NOW) as unknown as Record<
      string,
      unknown
    >

    // The old bug: a plain string parked under a key containing a dot.
    expect(typeof payload[LEGACY_ONBOARDING_STEP_FIELD]).not.toBe('string')
  })

  it('deletes the stray literal field left behind by the old write', () => {
    const payload = buildUserBusinessLink('biz_1', 'describe_business', NOW) as unknown as Record<
      string,
      unknown
    >

    expect(payload[LEGACY_ONBOARDING_STEP_FIELD]).toEqual({ __sentinel: 'delete' })
  })

  it('merges rather than replaces the onboarding map, so completedAt survives', () => {
    const payload = buildUserBusinessLink('biz_1', 'reviewing_discovery', NOW)

    // A merge write must not carry keys it means to leave alone: naming
    // `completedAt: null` here would blank a completed onboarding.
    expect(Object.keys(payload.onboarding)).toEqual(['step'])
  })

  it('keeps the business index and active business in step', () => {
    const payload = buildUserBusinessLink('biz_7', 'describe_business', NOW)

    expect(payload.activeBusinessId).toBe('biz_7')
    expect(payload.businessIds).toEqual({ __sentinel: 'arrayUnion', value: 'biz_7' })
    expect(payload.updatedAt).toBe(NOW)
  })

  it('carries exactly the keys it means to write', () => {
    const payload = buildUserBusinessLink('biz_1', 'describe_business', NOW)

    expect(Object.keys(payload).sort()).toEqual(
      ['activeBusinessId', 'businessIds', 'onboarding', 'onboarding.step', 'updatedAt'].sort(),
    )
  })
})
