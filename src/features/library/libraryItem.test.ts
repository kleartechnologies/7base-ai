import { describe, expect, it } from 'vitest'
import type { Campaign, Creative, MarketingRecommendation } from '@/types'
import {
  COPY_CHANNELS,
  LIBRARY_TABS,
  buildLibraryItems,
  builtCampaignsByRecommendation,
  campaignNamesById,
  campaignToItem,
  creativeToCopyItems,
  creativeToItem,
  filterByTab,
  recommendationToItem,
} from './libraryItem'

/** Full, valid entities with every field the real documents carry. */

function makeCreative(overrides: Partial<Creative> = {}): Creative {
  return {
    id: 'cr-1',
    ownerId: 'owner-1',
    createdAt: 1_000,
    updatedAt: 2_000,
    businessId: 'biz-1',
    campaignId: 'ca-1',
    conversationId: 'conv-1',
    sourceRecommendationId: 'rec-1',
    name: 'Merdeka Promo Poster',
    format: 'square_post',
    status: 'ready',
    content: {
      headline: 'Merdeka Special: 20% Off',
      subheadline: null,
      body: null,
      callToAction: 'Order today',
      offerText: '20% off all cakes',
      image: {
        storagePath: 'businesses/biz-1/creatives/cr-1/image.png',
        prompt: 'a kek lapis on a table',
        altText: 'Layered cake',
        source: 'generated',
      },
      layout: 'image_top',
    },
    captions: {
      facebook: 'FB caption text',
      instagram: 'IG caption text',
      short: null,
      whatsapp: 'WA message text',
    },
    style: { palette: null, headingFont: null, bodyFont: null, logoStoragePath: null },
    render: null,
    userEdited: [],
    ownerDirectives: [],
    imageError: null,
    ...overrides,
  }
}

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'ca-1',
    ownerId: 'owner-1',
    createdAt: 500,
    updatedAt: 1_500,
    businessId: 'biz-1',
    conversationId: 'conv-1',
    sourceRecommendationId: 'rec-1',
    name: 'Merdeka Promo',
    status: 'draft',
    objective: 'Bring back weekday customers',
    targetAudience: null,
    offer: null,
    positioning: null,
    keyMessage: null,
    callToAction: null,
    channels: ['facebook'],
    durationDays: 14,
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

function makeRecommendation(
  overrides: Partial<MarketingRecommendation> = {},
): MarketingRecommendation {
  return {
    id: 'rec-1',
    ownerId: 'owner-1',
    createdAt: 100,
    updatedAt: 100,
    businessId: 'biz-1',
    conversationId: 'conv-1',
    status: 'proposed',
    ownerSummary: 'Run a Merdeka week promotion on Facebook.',
    goal: 'More weekday sales',
    diagnosis: { statement: 'Weekdays are quiet', basis: 'hypothesis' },
    opportunities: [],
    recommendedIndex: 0,
    rationale: [],
    targetAudience: null,
    offer: null,
    positioning: null,
    coreMessage: null,
    callToAction: null,
    channels: ['facebook'],
    durationDays: 7,
    confidence: 'medium',
    confidenceReason: null,
    assumptions: [],
    unknowns: [],
    nextAction: 'build_campaign',
    meta: null,
    ...overrides,
  }
}

describe('creativeToItem', () => {
  it('normalizes a creative with full provenance', () => {
    const item = creativeToItem(makeCreative())
    expect(item).toMatchObject({
      key: 'creative:cr-1',
      type: 'creative',
      sourceType: 'creative',
      sourceId: 'cr-1',
      title: 'Merdeka Promo Poster',
      preview: 'Merdeka Special: 20% Off',
      imagePath: 'businesses/biz-1/creatives/cr-1/image.png',
      status: 'ready',
      createdAt: 1_000,
      updatedAt: 2_000,
      conversationId: 'conv-1',
      campaignId: 'ca-1',
      recommendationId: 'rec-1',
      businessId: 'biz-1',
      ownerId: 'owner-1',
      channel: null,
    })
  })

  it('handles a creative with no image and no provenance', () => {
    const item = creativeToItem(
      makeCreative({
        campaignId: null,
        conversationId: null,
        sourceRecommendationId: null,
        content: {
          headline: null,
          subheadline: null,
          body: null,
          callToAction: null,
          offerText: null,
          image: null,
          layout: 'text_only',
        },
      }),
    )
    expect(item.preview).toBeNull()
    expect(item.imagePath).toBeNull()
    expect(item.campaignId).toBeNull()
    expect(item.conversationId).toBeNull()
    expect(item.recommendationId).toBeNull()
  })

  it('handles an image object whose storagePath is null', () => {
    const creative = makeCreative()
    creative.content.image = { storagePath: null, prompt: null, altText: null, source: 'upload' }
    expect(creativeToItem(creative).imagePath).toBeNull()
  })
})

describe('creativeToCopyItems', () => {
  it('derives one item per non-null caption, in channel order', () => {
    const items = creativeToCopyItems(makeCreative())
    expect(items.map((i) => i.channel)).toEqual(['facebook', 'instagram', 'whatsapp'])
    expect(items.map((i) => i.key)).toEqual([
      'copy:cr-1:facebook',
      'copy:cr-1:instagram',
      'copy:cr-1:whatsapp',
    ])
    expect(items[0]).toMatchObject({
      type: 'copy',
      sourceType: 'creative',
      sourceId: 'cr-1',
      title: 'Merdeka Promo Poster',
      preview: 'FB caption text',
      imagePath: null,
      status: null,
    })
  })

  it('carries the creative provenance and timestamps on every copy item', () => {
    for (const item of creativeToCopyItems(makeCreative())) {
      expect(item.conversationId).toBe('conv-1')
      expect(item.campaignId).toBe('ca-1')
      expect(item.recommendationId).toBe('rec-1')
      expect(item.businessId).toBe('biz-1')
      expect(item.ownerId).toBe('owner-1')
      expect(item.createdAt).toBe(1_000)
      expect(item.updatedAt).toBe(2_000)
    }
  })

  it('returns nothing when every caption is null', () => {
    const creative = makeCreative({
      captions: { facebook: null, instagram: null, short: null, whatsapp: null },
    })
    expect(creativeToCopyItems(creative)).toEqual([])
  })

  it('treats an empty-string caption as absent', () => {
    const creative = makeCreative({
      captions: { facebook: '', instagram: null, short: 'Short!', whatsapp: null },
    })
    expect(creativeToCopyItems(creative).map((i) => i.channel)).toEqual(['short'])
  })
})

describe('campaignToItem', () => {
  it('normalizes a campaign; campaignId is its own id', () => {
    const item = campaignToItem(makeCampaign())
    expect(item).toMatchObject({
      key: 'campaign:ca-1',
      type: 'campaign',
      sourceType: 'campaign',
      sourceId: 'ca-1',
      title: 'Merdeka Promo',
      preview: 'Bring back weekday customers',
      status: 'draft',
      campaignId: 'ca-1',
      recommendationId: 'rec-1',
      ownerId: 'owner-1',
    })
  })

  it('tolerates null objective and provenance', () => {
    const item = campaignToItem(
      makeCampaign({ objective: null, conversationId: null, sourceRecommendationId: null }),
    )
    expect(item.preview).toBeNull()
    expect(item.conversationId).toBeNull()
    expect(item.recommendationId).toBeNull()
  })
})

describe('recommendationToItem', () => {
  it('normalizes a recommendation; recommendationId is its own id', () => {
    const item = recommendationToItem(makeRecommendation())
    expect(item).toMatchObject({
      key: 'recommendation:rec-1',
      type: 'recommendation',
      sourceType: 'recommendation',
      sourceId: 'rec-1',
      title: 'More weekday sales',
      preview: 'Run a Merdeka week promotion on Facebook.',
      status: 'proposed',
      conversationId: 'conv-1',
      campaignId: null,
      recommendationId: 'rec-1',
      ownerId: 'owner-1',
    })
  })
})

describe('buildLibraryItems', () => {
  it('merges all sources and sorts most recently updated first', () => {
    const items = buildLibraryItems({
      creatives: [
        makeCreative({
          id: 'cr-1',
          updatedAt: 2_000,
          captions: { facebook: null, instagram: null, short: null, whatsapp: null },
        }),
      ],
      campaigns: [makeCampaign({ id: 'ca-1', updatedAt: 3_000 })],
      recommendations: [makeRecommendation({ id: 'rec-1', updatedAt: 100 })],
    })
    expect(items.map((i) => i.key)).toEqual([
      'campaign:ca-1',
      'creative:cr-1',
      'recommendation:rec-1',
    ])
  })

  it('includes derived copy items alongside their creative', () => {
    const items = buildLibraryItems({
      creatives: [makeCreative()],
      campaigns: [],
      recommendations: [],
    })
    expect(items.filter((i) => i.type === 'creative')).toHaveLength(1)
    expect(items.filter((i) => i.type === 'copy')).toHaveLength(3)
  })

  it('breaks updatedAt ties with createdAt, newest created first', () => {
    const items = buildLibraryItems({
      creatives: [],
      campaigns: [
        makeCampaign({ id: 'older', createdAt: 100, updatedAt: 5_000 }),
        makeCampaign({ id: 'newer', createdAt: 200, updatedAt: 5_000 }),
      ],
      recommendations: [],
    })
    expect(items.map((i) => i.sourceId)).toEqual(['newer', 'older'])
  })

  it('returns an empty list for empty sources', () => {
    expect(buildLibraryItems({ creatives: [], campaigns: [], recommendations: [] })).toEqual([])
  })

  it('every item keeps the owner it came from — scoping is passed through, never widened', () => {
    const items = buildLibraryItems({
      creatives: [makeCreative({ ownerId: 'owner-A' })],
      campaigns: [makeCampaign({ ownerId: 'owner-A' })],
      recommendations: [makeRecommendation({ ownerId: 'owner-A' })],
    })
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((i) => i.ownerId === 'owner-A')).toBe(true)
  })
})

describe('filterByTab', () => {
  const items = buildLibraryItems({
    creatives: [makeCreative()],
    campaigns: [makeCampaign()],
    recommendations: [makeRecommendation()],
  })

  it('all returns everything', () => {
    expect(filterByTab(items, 'all')).toEqual(items)
  })

  it('each typed tab returns exactly its own type', () => {
    expect(filterByTab(items, 'creatives').map((i) => i.type)).toEqual(['creative'])
    expect(filterByTab(items, 'copywriting').every((i) => i.type === 'copy')).toBe(true)
    expect(filterByTab(items, 'copywriting')).toHaveLength(3)
    expect(filterByTab(items, 'campaigns').map((i) => i.type)).toEqual(['campaign'])
    expect(filterByTab(items, 'recommendations').map((i) => i.type)).toEqual(['recommendation'])
  })

  it('typed tabs together cover every item exactly once', () => {
    const covered = LIBRARY_TABS.filter(({ tab }) => tab !== 'all').flatMap(({ tab }) =>
      filterByTab(items, tab),
    )
    expect(covered).toHaveLength(items.length)
  })
})

describe('builtCampaignsByRecommendation', () => {
  it('maps a recommendation to the campaign built from it', () => {
    const built = builtCampaignsByRecommendation([
      makeCampaign({ id: 'ca-1', sourceRecommendationId: 'rec-1' }),
    ])
    expect(built.get('rec-1')).toBe('ca-1')
  })

  it('ignores campaigns without a source recommendation', () => {
    const built = builtCampaignsByRecommendation([
      makeCampaign({ id: 'ca-1', sourceRecommendationId: null }),
    ])
    expect(built.size).toBe(0)
  })

  it('keeps the first campaign when two share a recommendation', () => {
    const built = builtCampaignsByRecommendation([
      makeCampaign({ id: 'ca-first', sourceRecommendationId: 'rec-1' }),
      makeCampaign({ id: 'ca-second', sourceRecommendationId: 'rec-1' }),
    ])
    expect(built.get('rec-1')).toBe('ca-first')
  })
})

describe('campaignNamesById', () => {
  it('maps campaign ids to names', () => {
    const names = campaignNamesById([
      makeCampaign({ id: 'ca-1', name: 'Merdeka Promo' }),
      makeCampaign({ id: 'ca-2', name: 'Raya Push' }),
    ])
    expect(names.get('ca-1')).toBe('Merdeka Promo')
    expect(names.get('ca-2')).toBe('Raya Push')
  })
})

describe('constants', () => {
  it('COPY_CHANNELS matches the CreativeCaptions keys', () => {
    const creative = makeCreative()
    expect([...COPY_CHANNELS].sort()).toEqual(Object.keys(creative.captions).sort())
  })

  it('LIBRARY_TABS covers the five sections, All first', () => {
    expect(LIBRARY_TABS.map(({ tab }) => tab)).toEqual([
      'all',
      'creatives',
      'copywriting',
      'campaigns',
      'recommendations',
    ])
  })
})
