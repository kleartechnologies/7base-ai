import { describe, expect, it } from 'vitest'

import { getCurrentPlan, getPlanName, PLAN_PRICING, startUpgrade } from './billing.service'

/**
 * The billing seam: display-only pricing and a deliberately unstartable
 * upgrade. Nothing here may charge anyone or claim success — the UI's quiet
 * "you haven't been charged" notice depends on that.
 */
describe('billing seam', () => {
  it('every account reads as Basic until billing exists', () => {
    expect(getCurrentPlan()).toBe('basic')
  })

  it('names plans for display', () => {
    expect(getPlanName('basic')).toBe('Basic')
    expect(getPlanName('pro')).toBe('Pro')
  })

  it('carries the approved launch and normal prices for both plans', () => {
    expect(PLAN_PRICING.basic).toEqual({ launchPrice: 'RM19.90', normalPrice: 'RM29.90' })
    expect(PLAN_PRICING.pro).toEqual({ launchPrice: 'RM39.90', normalPrice: 'RM49.90' })
  })

  it('startUpgrade always reports failure without throwing — nobody is charged', async () => {
    await expect(startUpgrade()).resolves.toEqual({ ok: false })
  })
})
