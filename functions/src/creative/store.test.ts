import { describe, expect, it } from 'vitest'

import { buildStoredCreative } from './store'

/**
 * The persisted shape. Security depends on it: the stored creative carries
 * the authenticated uid and the verified campaign/business/conversation ids
 * — the full traceability chain — never anything a client asserted.
 */

const params = {
  ownerId: 'user1',
  businessId: 'biz1',
  campaignId: 'camp1',
  conversationId: 'conv1',
  sourceRecommendationId: 'rec1',
  name: 'Weekday Lunch Growth Poster',
  format: 'square_post' as const,
  content: {
    headline: 'Lunch without the wait',
    subheadline: null,
    body: null,
    callToAction: 'Order on WhatsApp',
    offerText: null,
    image: null,
    layout: 'text_only' as const,
  },
  captions: { facebook: 'fb', instagram: 'ig', short: 's', whatsapp: null },
  style: { palette: null, headingFont: null, bodyFont: null, logoStoragePath: null },
  imageError: null,
  meta: null,
  now: 1234,
}

describe('buildStoredCreative', () => {
  it('carries the full provenance chain, server-verified ids only', () => {
    const creative = buildStoredCreative(params)
    expect(creative.ownerId).toBe('user1')
    expect(creative.businessId).toBe('biz1')
    expect(creative.campaignId).toBe('camp1')
    expect(creative.conversationId).toBe('conv1')
    expect(creative.sourceRecommendationId).toBe('rec1')
  })

  it('starts with no owner authority, no directives, no render', () => {
    const creative = buildStoredCreative(params)
    expect(creative.userEdited).toEqual([])
    expect(creative.ownerDirectives).toEqual([])
    expect(creative.render).toBeNull()
    expect(creative.createdAt).toBe(1234)
    expect(creative.updatedAt).toBe(1234)
  })

  it('is ready even when the image failed — copy always exists, failure is carried', () => {
    const failed = buildStoredCreative({
      ...params,
      imageError: 'The poster image could not be created.',
    })
    expect(failed.status).toBe('ready')
    expect(failed.imageError).toBe('The poster image could not be created.')
  })
})
