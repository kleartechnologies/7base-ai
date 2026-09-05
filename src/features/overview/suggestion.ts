import type { MessageKey } from '@/i18n/translate'
import { missingQuestions } from '@/services/business/completion'
import type { Business, Campaign } from '@/types'

/**
 * What EVA suggests next on the Overview page, chosen deterministically from
 * real workspace state — never invented. Priority order: an incomplete
 * profile sharpens everything else, a first campaign beats polishing, an
 * unfinished draft beats starting fresh.
 */
export function suggestionKey(
  business: Business | null,
  campaigns: Campaign[] | null,
): MessageKey {
  if (business && missingQuestions(business).length > 0) return 'overview.suggestProfile'
  const list = campaigns ?? []
  if (list.filter((c) => c.status !== 'archived').length === 0) return 'overview.suggestFirstCampaign'
  if (list.some((c) => c.status === 'draft')) return 'overview.suggestDraftCampaign'
  return 'overview.suggestKeepGoing'
}
