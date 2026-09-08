import type { MessageKey } from '@/i18n/translate'
import { missingQuestions } from '@/services/business/completion'
import type { Business, Campaign } from '@/types'

/**
 * What EVA suggests next on the Overview page, chosen deterministically from
 * real workspace state — never invented. Priority order: on an empty
 * workspace the first move is to promote something, then an incomplete
 * profile sharpens everything else, then an unfinished draft beats starting
 * fresh.
 *
 * The profile nudge deliberately sits *below* the first campaign: the
 * Business profile card underneath this one already asks for those answers,
 * and an owner with nothing made yet was being asked to fill in a profile
 * twice instead of being told what this product is for (Phase 7J §6/§15).
 */
export function suggestionKey(
  business: Business | null,
  campaigns: Campaign[] | null,
): MessageKey {
  const list = campaigns ?? []
  if (list.filter((c) => c.status !== 'archived').length === 0) return 'overview.suggestFirstCampaign'
  if (business && missingQuestions(business).length > 0) return 'overview.suggestProfile'
  if (list.some((c) => c.status === 'draft')) return 'overview.suggestDraftCampaign'
  return 'overview.suggestKeepGoing'
}
