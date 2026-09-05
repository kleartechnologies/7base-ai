import { describe, expect, it } from 'vitest'

import type { Business, Campaign, CampaignStatus } from '@/types'
import { emptyBusiness } from '@/services/business/brain'
import { suggestionKey } from './suggestion'

/**
 * The Overview "EVA suggests" card is deterministic: its copy is chosen from
 * real workspace state, never generated. These tests pin the priority order —
 * profile gaps first, then a first campaign, then an unfinished draft.
 */

function business(): Business {
  return {
    id: 'biz_1',
    ...(emptyBusiness('owner_1', { name: 'Nasi Arab AlShams' }, 1) as Omit<Business, 'id'>),
  }
}

function campaign(status: CampaignStatus): Campaign {
  return { id: `camp_${status}`, status } as Campaign
}

describe('suggestionKey', () => {
  it('asks for profile answers first when EVA still has questions', () => {
    expect(suggestionKey(business(), [campaign('ready')])).toBe('overview.suggestProfile')
  })

  it('suggests the first campaign when none exist', () => {
    expect(suggestionKey(null, [])).toBe('overview.suggestFirstCampaign')
    expect(suggestionKey(null, null)).toBe('overview.suggestFirstCampaign')
  })

  it('treats archived-only as having no campaigns', () => {
    expect(suggestionKey(null, [campaign('archived')])).toBe('overview.suggestFirstCampaign')
  })

  it('nudges toward an unfinished draft', () => {
    expect(suggestionKey(null, [campaign('draft'), campaign('ready')])).toBe(
      'overview.suggestDraftCampaign',
    )
  })

  it('falls back to keep-going when everything is in order', () => {
    expect(suggestionKey(null, [campaign('ready')])).toBe('overview.suggestKeepGoing')
  })
})
