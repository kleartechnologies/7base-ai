import { useEffect, useMemo, useState } from 'react'
import { observeCampaigns } from '@/services/campaigns/campaign.service'
import { observeCreatives } from '@/services/creatives/creative.service'
import { observeRecommendations } from '@/services/recommendations/recommendation.service'
import type { Campaign, Creative, MarketingRecommendation } from '@/types'
import {
  buildLibraryItems,
  builtCampaignsByRecommendation,
  campaignNamesById,
  type LibraryItem,
} from './libraryItem'

/**
 * The Library's data: the three existing realtime queries the workspace
 * already runs (creatives, campaigns, recommendations), merged client-side
 * into one recent-first list. No new collection, no server aggregation, no
 * AI — the existing per-owner queries and security rules are the whole
 * access story.
 *
 * Each source fails independently: a failed listener empties that source and
 * is named in `failedSources`, while the others keep rendering. `loading` is
 * true until every source has answered once (with data or with an error).
 */

interface SourceState<T> {
  data: T[] | null
  failed: boolean
}

const INITIAL = { data: null, failed: false }

export interface LibraryData {
  items: LibraryItem[]
  campaignNames: Map<string, string>
  builtByRecommendation: Map<string, string>
  loading: boolean
  failedSources: string[]
}

export function useLibrary(ownerId: string | null): LibraryData {
  const [creatives, setCreatives] = useState<SourceState<Creative>>(INITIAL)
  const [campaigns, setCampaigns] = useState<SourceState<Campaign>>(INITIAL)
  const [recommendations, setRecommendations] =
    useState<SourceState<MarketingRecommendation>>(INITIAL)

  // Render-time reset when the owner changes (the documented alternative to
  // resetting inside the effect): the previous owner's data must never show
  // under the next owner, not even for one frame.
  const [prevOwnerId, setPrevOwnerId] = useState(ownerId)
  if (prevOwnerId !== ownerId) {
    setPrevOwnerId(ownerId)
    setCreatives(INITIAL)
    setCampaigns(INITIAL)
    setRecommendations(INITIAL)
  }

  useEffect(() => {
    if (!ownerId) return
    const unsubscribes = [
      observeCreatives(
        ownerId,
        (data) => setCreatives({ data, failed: false }),
        () => setCreatives({ data: [], failed: true }),
      ),
      observeCampaigns(
        ownerId,
        (data) => setCampaigns({ data, failed: false }),
        () => setCampaigns({ data: [], failed: true }),
      ),
      observeRecommendations(
        ownerId,
        (data) => setRecommendations({ data, failed: false }),
        () => setRecommendations({ data: [], failed: true }),
        50,
      ),
    ]
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [ownerId])

  const items = useMemo(
    () =>
      buildLibraryItems({
        creatives: creatives.data ?? [],
        campaigns: campaigns.data ?? [],
        recommendations: recommendations.data ?? [],
      }),
    [creatives.data, campaigns.data, recommendations.data],
  )

  const campaignNames = useMemo(() => campaignNamesById(campaigns.data ?? []), [campaigns.data])

  const builtByRecommendation = useMemo(
    () => builtCampaignsByRecommendation(campaigns.data ?? []),
    [campaigns.data],
  )

  const failedSources = useMemo(() => {
    const failed: string[] = []
    if (creatives.failed) failed.push('creatives')
    if (campaigns.failed) failed.push('campaigns')
    if (recommendations.failed) failed.push('recommendations')
    return failed
  }, [creatives.failed, campaigns.failed, recommendations.failed])

  return {
    items,
    campaignNames,
    builtByRecommendation,
    loading:
      creatives.data === null || campaigns.data === null || recommendations.data === null,
    failedSources,
  }
}
