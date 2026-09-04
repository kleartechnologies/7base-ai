import { describe, expect, it } from 'vitest'

import { normalisePlan, readDevPlanOverride } from './plan'

/**
 * Plan normalisation is the security floor of model routing: whatever is (or
 * is not) stored in `subscriptions/{uid}`, the answer must never fall upward
 * into Pro. These tests enumerate the ways the data can be wrong.
 */

describe('normalisePlan', () => {
  it('resolves a genuine active Pro subscription to pro', () => {
    expect(
      normalisePlan({ ownerId: 'u1', planId: 'pro', status: 'active', updatedAt: 1 }),
    ).toBe('pro')
  })

  it('resolves an explicit Basic subscription to basic', () => {
    expect(
      normalisePlan({ ownerId: 'u1', planId: 'basic', status: 'active', updatedAt: 1 }),
    ).toBe('basic')
  })

  it('defaults a missing subscription document to basic', () => {
    expect(normalisePlan(null)).toBe('basic')
    expect(normalisePlan(undefined)).toBe('basic')
  })

  it('defaults malformed data to basic', () => {
    expect(normalisePlan({})).toBe('basic')
    expect(normalisePlan('pro')).toBe('basic')
    expect(normalisePlan(['pro'])).toBe('basic')
    expect(normalisePlan(42)).toBe('basic')
    expect(normalisePlan({ planId: 42, status: 'active' })).toBe('basic')
  })

  it('defaults an unknown or misspelled plan to basic, never pro', () => {
    expect(normalisePlan({ planId: 'PRO', status: 'active' })).toBe('basic')
    expect(normalisePlan({ planId: 'enterprise', status: 'active' })).toBe('basic')
    expect(normalisePlan({ planId: 'premium', status: 'active' })).toBe('basic')
  })

  it('requires status to be explicitly active for pro', () => {
    // A lapsed or half-written record must not keep flagship access.
    expect(normalisePlan({ planId: 'pro' })).toBe('basic')
    expect(normalisePlan({ planId: 'pro', status: 'past_due' })).toBe('basic')
    expect(normalisePlan({ planId: 'pro', status: 'cancelled' })).toBe('basic')
    expect(normalisePlan({ planId: 'pro', status: 'ACTIVE' })).toBe('basic')
  })

  it('ignores claim-shaped fields a tampered client might send', () => {
    // The callables never pass request payloads here, but even if one did,
    // nothing short of the server-written shape reads as Pro.
    expect(normalisePlan({ tier: 'pro' })).toBe('basic')
    expect(normalisePlan({ plan: 'pro' })).toBe('basic')
    expect(normalisePlan({ isPro: true, subscription: 'pro' })).toBe('basic')
  })
})

describe('readDevPlanOverride', () => {
  it('is inert outside the Functions emulator, whatever is set', () => {
    expect(readDevPlanOverride({ MARKA_DEV_PLAN_OVERRIDE: 'pro' })).toBeNull()
    expect(
      readDevPlanOverride({ FUNCTIONS_EMULATOR: 'false', MARKA_DEV_PLAN_OVERRIDE: 'pro' }),
    ).toBeNull()
  })

  it('honours basic and pro inside the emulator', () => {
    expect(
      readDevPlanOverride({ FUNCTIONS_EMULATOR: 'true', MARKA_DEV_PLAN_OVERRIDE: 'pro' }),
    ).toBe('pro')
    expect(
      readDevPlanOverride({ FUNCTIONS_EMULATOR: 'true', MARKA_DEV_PLAN_OVERRIDE: 'basic' }),
    ).toBe('basic')
  })

  it('rejects junk override values even in the emulator', () => {
    expect(readDevPlanOverride({ FUNCTIONS_EMULATOR: 'true' })).toBeNull()
    expect(
      readDevPlanOverride({ FUNCTIONS_EMULATOR: 'true', MARKA_DEV_PLAN_OVERRIDE: 'enterprise' }),
    ).toBeNull()
  })
})
