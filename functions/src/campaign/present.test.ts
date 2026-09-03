import { describe, expect, it } from 'vitest'

import {
  buildCampaignBuiltPresentation,
  buildCampaignCardBlock,
  buildCampaignEditPresentation,
  CAMPAIGN_CLARIFICATION_REPLY,
} from './present'
import type { StoredCampaign } from './store'

/**
 * What the owner actually sees: MARKA takes responsibility in one calm
 * sentence, then shows the structured campaign — never a JSON dump, never
 * "here is your campaign" followed by prose.
 */

const stored: StoredCampaign = {
  ownerId: 'user1',
  businessId: 'biz1',
  conversationId: 'conv1',
  sourceRecommendationId: 'rec1',
  name: 'Weekday Lunch Rush',
  status: 'draft',
  objective: 'Increase weekday customers',
  targetAudience: { description: 'Nearby office workers', basis: 'hypothesis' },
  offer: { description: 'Weekday lunch set', basis: 'recommendation' },
  positioning: null,
  keyMessage: 'Lunch without the wait',
  callToAction: 'Order on WhatsApp',
  channels: ['instagram', 'whatsapp'],
  durationDays: 14,
  startDate: null,
  endDate: null,
  notes: null,
  assumptions: [],
  unknowns: ['Pricing not confirmed'],
  userEdited: [],
  meta: null,
  createdAt: 1000,
  updatedAt: 1000,
}

describe('buildCampaignCardBlock', () => {
  const block = buildCampaignCardBlock('b1', 'camp1', stored)

  it('references the persisted campaign and carries only render fields', () => {
    expect(block.type).toBe('campaign_card')
    expect(block.campaignId).toBe('camp1')
    expect(block.name).toBe('Weekday Lunch Rush')
    expect(block.status).toBe('draft')
    expect('ownerId' in block).toBe(false)
    expect('meta' in block).toBe(false)
  })

  it('keeps provenance on the card', () => {
    expect(block.audience?.basis).toBe('hypothesis')
    expect(block.offer?.basis).toBe('recommendation')
  })
})

describe('buildCampaignBuiltPresentation', () => {
  const presentation = buildCampaignBuiltPresentation('camp1', stored)

  it('MARKA takes responsibility, then shows the campaign', () => {
    expect(presentation.blocks[0]?.type).toBe('text')
    const lead = presentation.blocks[0] as { text: string }
    expect(lead.text).toContain('turned that recommendation into a campaign draft')
    expect(presentation.blocks[1]?.type).toBe('campaign_card')
  })

  it('plain text preview names the campaign', () => {
    expect(presentation.plainText).toContain('Weekday Lunch Rush')
  })
})

describe('buildCampaignEditPresentation', () => {
  it('uses the model reply when there is one', () => {
    const presentation = buildCampaignEditPresentation('camp1', stored, 'Premium it is.', [
      'keyMessage',
    ])
    const lead = presentation.blocks[0] as { text: string }
    expect(lead.text).toBe('Premium it is.')
    expect(presentation.blocks[1]?.type).toBe('campaign_card')
  })

  it('says plainly when nothing changed', () => {
    const presentation = buildCampaignEditPresentation('camp1', stored, null, [])
    const lead = presentation.blocks[0] as { text: string }
    expect(lead.text.toLowerCase()).toContain('change anything')
  })

  it('falls back to a calm confirmation when something changed silently', () => {
    const presentation = buildCampaignEditPresentation('camp1', stored, null, ['name'])
    const lead = presentation.blocks[0] as { text: string }
    expect(lead.text.toLowerCase()).toContain('updated the campaign')
  })
})

describe('clarification reply', () => {
  it('is honest about which campaign it cannot find, and suggests the way forward', () => {
    expect(CAMPAIGN_CLARIFICATION_REPLY).toContain('Campaigns tab')
  })
})
