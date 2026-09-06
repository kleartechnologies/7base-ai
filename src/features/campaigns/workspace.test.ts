import { describe, expect, it } from 'vitest'
import type { Campaign, Creative } from '@/types'
import {
  campaignCreatives,
  campaignDuration,
  campaignProgress,
  hasStrategy,
  workspaceSuggestion,
} from './workspace'

/**
 * The Campaign Workspace derives everything it says from stored data. These
 * tests pin the honesty rules: no step reads as complete without the data
 * behind it, an unloaded creative list never counts as anything, and the EVA
 * suggestion is a pure function of status + creative count.
 */

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1',
    ownerId: 'alice',
    createdAt: 1,
    updatedAt: 1,
    businessId: 'biz-1',
    conversationId: null,
    sourceRecommendationId: null,
    name: 'September Lunch Push',
    status: 'ready',
    objective: 'Increase weekday lunch visits',
    targetAudience: { description: 'Office workers around Banting', basis: 'hypothesis' },
    offer: { description: 'Lunch set promotion', basis: 'recommendation' },
    positioning: null,
    keyMessage: 'A satisfying lunch without the premium price',
    callToAction: 'Visit us today',
    channels: ['facebook', 'instagram'],
    durationDays: 30,
    startDate: null,
    endDate: null,
    notes: null,
    assumptions: [],
    unknowns: [],
    userEdited: [],
    meta: null,
    ...overrides,
  }
}

function creative(overrides: Partial<Creative> = {}): Creative {
  return {
    id: 'cre-1',
    ownerId: 'alice',
    createdAt: 1,
    updatedAt: 1,
    businessId: 'biz-1',
    campaignId: 'camp-1',
    conversationId: null,
    sourceRecommendationId: null,
    name: 'Lunch poster',
    format: 'square_post',
    status: 'ready',
    content: {
      headline: null,
      subheadline: null,
      body: null,
      callToAction: null,
      offerText: null,
      image: null,
      layout: 'image_full_bleed',
    },
    captions: { facebook: null, instagram: null, short: null, whatsapp: null },
    style: { palette: null, headingFont: null, bodyFont: null, logoStoragePath: null },
    render: null,
    userEdited: [],
    ownerDirectives: [],
    imageError: null,
    ...overrides,
  }
}

describe('hasStrategy', () => {
  it('true when any strategy field carries substance', () => {
    expect(hasStrategy(campaign())).toBe(true)
    expect(
      hasStrategy(
        campaign({
          objective: null,
          keyMessage: null,
          positioning: 'Affordable lunch',
          targetAudience: null,
          offer: null,
        }),
      ),
    ).toBe(true)
  })

  it('false when the campaign is only a name', () => {
    expect(
      hasStrategy(
        campaign({
          objective: null,
          keyMessage: null,
          positioning: null,
          targetAudience: null,
          offer: null,
        }),
      ),
    ).toBe(false)
  })
})

describe('campaignProgress — real state only', () => {
  it('a ready campaign with a creative completes all three steps', () => {
    expect(campaignProgress(campaign(), 2)).toEqual({
      strategy: true,
      ready: true,
      creative: true,
    })
  })

  it('a draft is not "ready" and zero creatives is not "creative created"', () => {
    expect(campaignProgress(campaign({ status: 'draft' }), 0)).toEqual({
      strategy: true,
      ready: false,
      creative: false,
    })
  })

  it('an unloaded creative list never counts as a created creative', () => {
    expect(campaignProgress(campaign(), null).creative).toBe(false)
  })

  it('archived is not the same as ready', () => {
    expect(campaignProgress(campaign({ status: 'archived' }), 1).ready).toBe(false)
  })
})

describe('workspaceSuggestion — deterministic, no AI call', () => {
  it('a draft asks to be completed, regardless of creatives', () => {
    expect(workspaceSuggestion(campaign({ status: 'draft' }), null)).toBe('complete_draft')
    expect(workspaceSuggestion(campaign({ status: 'draft' }), 3)).toBe('complete_draft')
  })

  it('ready without creatives asks for the first one; with creatives, another', () => {
    expect(workspaceSuggestion(campaign(), 0)).toBe('first_creative')
    expect(workspaceSuggestion(campaign(), 2)).toBe('another_creative')
  })

  it('waits for the creative list instead of guessing', () => {
    expect(workspaceSuggestion(campaign(), null)).toBeNull()
  })

  it('archived campaigns get no nudge', () => {
    expect(workspaceSuggestion(campaign({ status: 'archived' }), 0)).toBeNull()
  })
})

describe('campaignCreatives', () => {
  it('keeps only this campaign’s creatives, and null while loading', () => {
    const mine = creative()
    const other = creative({ id: 'cre-2', campaignId: 'camp-other' })
    const orphan = creative({ id: 'cre-3', campaignId: null })
    expect(campaignCreatives([mine, other, orphan], 'camp-1')).toEqual([mine])
    expect(campaignCreatives(null, 'camp-1')).toBeNull()
  })
})

describe('campaignDuration', () => {
  it('a real date range wins over the recommended length', () => {
    expect(campaignDuration(campaign({ startDate: 100, endDate: 200 }))).toEqual({
      type: 'range',
      start: 100,
      end: 200,
    })
  })

  it('falls back to the recommended number of days', () => {
    expect(campaignDuration(campaign())).toEqual({ type: 'days', days: 30 })
  })

  it('a lone start date is not a range, and nothing means nothing', () => {
    expect(campaignDuration(campaign({ startDate: 100, durationDays: null }))).toBeNull()
    expect(campaignDuration(campaign({ durationDays: null }))).toBeNull()
  })
})
