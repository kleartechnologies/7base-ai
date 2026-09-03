import { COLLECTIONS, db } from '../lib/firebase'
import type { MessageMeta } from '../lib/types'
import type { MarketingRecommendationDraft } from './validate'

/**
 * Recommendation persistence.
 *
 * Recommendations are server-generated intelligence, like assistant messages:
 * security rules deny every client write on the collection, so the only path
 * into it is this module, running behind an ownership check. The document
 * shape is built by a pure function so tests can pin it without an emulator.
 */

/** The stored shape. Firestore keeps the id in the path, not the body. */
export interface StoredRecommendation extends MarketingRecommendationDraft {
  ownerId: string
  businessId: string
  conversationId: string
  /** 'proposed' until the campaign phase acts on it. */
  status: 'proposed'
  meta: MessageMeta | null
  createdAt: number
  updatedAt: number
}

export function buildStoredRecommendation(params: {
  ownerId: string
  businessId: string
  conversationId: string
  draft: MarketingRecommendationDraft
  meta: MessageMeta | null
  now?: number
}): StoredRecommendation {
  const now = params.now ?? Date.now()
  return {
    ...params.draft,
    ownerId: params.ownerId,
    businessId: params.businessId,
    conversationId: params.conversationId,
    status: 'proposed',
    meta: params.meta,
    createdAt: now,
    updatedAt: now,
  }
}

export async function saveRecommendation(recommendation: StoredRecommendation): Promise<string> {
  const ref = await db.collection(COLLECTIONS.recommendations).add(recommendation)
  return ref.id
}
