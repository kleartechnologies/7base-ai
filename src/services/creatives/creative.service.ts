import {
  getDoc,
  limit as fbLimit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { creativeDoc, creativesCollection } from '@/lib/firebase/collections'
import { fromDocSnapshot, fromSnapshot } from '@/lib/firebase/mapper'
import type { Creative } from '@/types'

/**
 * Creative persistence, client side.
 *
 * Creatives are *created* by Cloud Functions from campaigns — there is
 * deliberately no client-side create here (security rules refuse client
 * creates outright, because a client cannot honestly claim the chain
 * Creative → Campaign → Recommendation). Reads only for now; conversational
 * editing goes through chat, which edits server-side with the authority
 * model intact.
 *
 * Queries constrain `ownerId` — the only shape the list rule can prove safe.
 */

export async function getCreative(creativeId: string): Promise<Creative | null> {
  const snapshot = await getDoc(creativeDoc(creativeId))
  return fromDocSnapshot<Creative>(snapshot)
}

/** The owner's creatives, most recently touched first. */
export function observeCreatives(
  ownerId: string,
  onChange: (creatives: Creative[]) => void,
  onError?: (error: unknown) => void,
  max = 100,
): () => void {
  return onSnapshot(
    query(
      creativesCollection(),
      where('ownerId', '==', ownerId),
      orderBy('updatedAt', 'desc'),
      fbLimit(max),
    ),
    (snapshot) => onChange(snapshot.docs.map((d) => fromSnapshot<Creative>(d))),
    (error) => onError?.(error),
  )
}
