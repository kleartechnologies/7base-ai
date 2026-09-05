import type { MessageKey } from '@/i18n/translate'
import type { Campaign, Creative, EntityId, MarketingRecommendation, Millis } from '@/types'

/**
 * The EVA Library view model.
 *
 * The Library is a *view* over MARKA's existing sources of truth — creatives,
 * campaigns and recommendations stay in their own collections and remain
 * authoritative. Nothing in this module touches Firestore: these are pure
 * normalizers from the existing entities into one presentation shape, so the
 * Library page can merge, sort and tab-filter them without a second store.
 *
 * "Copywriting" is deliberately not a collection: captions live inside each
 * creative document, so copy items are *derived* from creatives here. A copy
 * item shares its creative's document (and its lifecycle — delete the
 * creative and its captions leave the Library with it), which is why items
 * carry a `key` distinct from `sourceId`.
 */

export type LibraryItemType = 'creative' | 'copy' | 'campaign' | 'recommendation'

export type LibrarySourceType = 'creative' | 'campaign' | 'recommendation'

/** The channels a caption is written for — the keys of `CreativeCaptions`. */
export type CopyChannel = 'facebook' | 'instagram' | 'short' | 'whatsapp'

export const COPY_CHANNELS: readonly CopyChannel[] = [
  'facebook',
  'instagram',
  'short',
  'whatsapp',
]

/** Same dictionary entries the creative preview uses for its caption labels. */
export const COPY_CHANNEL_LABEL_KEYS: Record<CopyChannel, MessageKey> = {
  facebook: 'creative.captionFacebook',
  instagram: 'creative.captionInstagram',
  short: 'creative.captionShort',
  whatsapp: 'creative.captionWhatsapp',
}

export interface LibraryItem {
  /** Unique across the merged view. Copy items share their creative's doc. */
  key: string
  type: LibraryItemType
  /** The underlying document — where this item's truth lives. */
  sourceType: LibrarySourceType
  sourceId: EntityId
  title: string
  /** Short supporting text (objective, caption, summary). */
  preview: string | null
  /** Storage path of a creative's image; resolved to a URL at render time. */
  imagePath: string | null
  /** Per-type vocabulary ('draft' | 'ready' | …); never unified across types. */
  status: string | null
  createdAt: Millis
  updatedAt: Millis
  conversationId: EntityId | null
  campaignId: EntityId | null
  recommendationId: EntityId | null
  businessId: EntityId
  ownerId: EntityId
  /** Copy items only: which channel the caption was written for. */
  channel: CopyChannel | null
}

export type LibraryTab = 'all' | 'creatives' | 'copywriting' | 'campaigns' | 'recommendations'

export const LIBRARY_TABS: readonly { tab: LibraryTab; labelKey: MessageKey }[] = [
  { tab: 'all', labelKey: 'library.tabAll' },
  { tab: 'creatives', labelKey: 'library.tabCreatives' },
  { tab: 'copywriting', labelKey: 'library.tabCopywriting' },
  { tab: 'campaigns', labelKey: 'library.tabCampaigns' },
  { tab: 'recommendations', labelKey: 'library.tabRecommendations' },
]

const TAB_TYPES: Record<Exclude<LibraryTab, 'all'>, LibraryItemType> = {
  creatives: 'creative',
  copywriting: 'copy',
  campaigns: 'campaign',
  recommendations: 'recommendation',
}

export function creativeToItem(creative: Creative): LibraryItem {
  return {
    key: `creative:${creative.id}`,
    type: 'creative',
    sourceType: 'creative',
    sourceId: creative.id,
    title: creative.name,
    preview: creative.content.headline,
    imagePath: creative.content.image?.storagePath ?? null,
    status: creative.status,
    createdAt: creative.createdAt,
    updatedAt: creative.updatedAt,
    conversationId: creative.conversationId,
    campaignId: creative.campaignId,
    recommendationId: creative.sourceRecommendationId,
    businessId: creative.businessId,
    ownerId: creative.ownerId,
    channel: null,
  }
}

/**
 * One copy item per caption the creative actually has. Provenance is the
 * creative's own — a caption found here can always be traced back through
 * its creative to the campaign, recommendation and conversation.
 */
export function creativeToCopyItems(creative: Creative): LibraryItem[] {
  return COPY_CHANNELS.flatMap((channel) => {
    const text = creative.captions[channel]
    if (!text) return []
    return [
      {
        key: `copy:${creative.id}:${channel}`,
        type: 'copy' as const,
        sourceType: 'creative' as const,
        sourceId: creative.id,
        title: creative.name,
        preview: text,
        imagePath: null,
        status: null,
        createdAt: creative.createdAt,
        updatedAt: creative.updatedAt,
        conversationId: creative.conversationId,
        campaignId: creative.campaignId,
        recommendationId: creative.sourceRecommendationId,
        businessId: creative.businessId,
        ownerId: creative.ownerId,
        channel,
      },
    ]
  })
}

export function campaignToItem(campaign: Campaign): LibraryItem {
  return {
    key: `campaign:${campaign.id}`,
    type: 'campaign',
    sourceType: 'campaign',
    sourceId: campaign.id,
    title: campaign.name,
    preview: campaign.objective,
    imagePath: null,
    status: campaign.status,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    conversationId: campaign.conversationId,
    campaignId: campaign.id,
    recommendationId: campaign.sourceRecommendationId,
    businessId: campaign.businessId,
    ownerId: campaign.ownerId,
    channel: null,
  }
}

export function recommendationToItem(recommendation: MarketingRecommendation): LibraryItem {
  return {
    key: `recommendation:${recommendation.id}`,
    type: 'recommendation',
    sourceType: 'recommendation',
    sourceId: recommendation.id,
    title: recommendation.goal,
    preview: recommendation.ownerSummary,
    imagePath: null,
    status: recommendation.status,
    createdAt: recommendation.createdAt,
    updatedAt: recommendation.updatedAt,
    conversationId: recommendation.conversationId,
    campaignId: null,
    recommendationId: recommendation.id,
    businessId: recommendation.businessId,
    ownerId: recommendation.ownerId,
    channel: null,
  }
}

/**
 * The whole Library, most recently touched first — the same "recent first"
 * the workspace tabs already use. `createdAt` breaks ties so the order is
 * stable when several documents were written in the same instant.
 */
export function buildLibraryItems(sources: {
  creatives: Creative[]
  campaigns: Campaign[]
  recommendations: MarketingRecommendation[]
}): LibraryItem[] {
  return [
    ...sources.creatives.map(creativeToItem),
    ...sources.creatives.flatMap(creativeToCopyItems),
    ...sources.campaigns.map(campaignToItem),
    ...sources.recommendations.map(recommendationToItem),
  ].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
}

export function filterByTab(items: LibraryItem[], tab: LibraryTab): LibraryItem[] {
  if (tab === 'all') return items
  const type = TAB_TYPES[tab]
  return items.filter((item) => item.type === type)
}

/**
 * Which recommendations have already become campaigns. A recommendation is
 * never written to after creation (its status stays 'proposed' by design),
 * so "built" is derived from the campaigns the Library loads anyway — the
 * campaign's frozen `sourceRecommendationId` is the authoritative link.
 */
export function builtCampaignsByRecommendation(campaigns: Campaign[]): Map<EntityId, EntityId> {
  const built = new Map<EntityId, EntityId>()
  for (const campaign of campaigns) {
    if (campaign.sourceRecommendationId && !built.has(campaign.sourceRecommendationId)) {
      built.set(campaign.sourceRecommendationId, campaign.id)
    }
  }
  return built
}

/** Campaign names for the small "which campaign is this from" chip. */
export function campaignNamesById(campaigns: Campaign[]): Map<EntityId, string> {
  return new Map(campaigns.map((campaign) => [campaign.id, campaign.name]))
}
