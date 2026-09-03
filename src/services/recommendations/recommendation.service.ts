import {
  getDoc,
  limit as fbLimit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { recommendationDoc, recommendationsCollection } from '@/lib/firebase/collections'
import { fromDocSnapshot, fromSnapshot } from '@/lib/firebase/mapper'
import type { MarketingRecommendation } from '@/types'

/**
 * Read access to MARKA's persisted marketing recommendations.
 *
 * Read-only by design: recommendations are server-generated intelligence,
 * written exclusively by Cloud Functions. Security rules deny every client
 * create and update, so this module offers none.
 */

/** One recommendation, e.g. when following a chat block's reference. */
export async function getRecommendation(
  recommendationId: string,
): Promise<MarketingRecommendation | null> {
  const snapshot = await getDoc(recommendationDoc(recommendationId))
  return fromDocSnapshot<MarketingRecommendation>(snapshot)
}

/** The owner's recommendations, newest first. */
export function observeRecommendations(
  ownerId: string,
  onChange: (recommendations: MarketingRecommendation[]) => void,
  onError?: (error: unknown) => void,
  max = 50,
): () => void {
  return onSnapshot(
    query(
      recommendationsCollection(),
      where('ownerId', '==', ownerId),
      orderBy('createdAt', 'desc'),
      fbLimit(max),
    ),
    (snapshot) => onChange(snapshot.docs.map((d) => fromSnapshot<MarketingRecommendation>(d))),
    (error) => onError?.(error),
  )
}
