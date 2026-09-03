import type { DocumentSnapshot, QueryDocumentSnapshot } from 'firebase/firestore'

/**
 * Firestore keeps the id outside the document body; the app wants it inside.
 * These two helpers are the only place that seam is crossed.
 */
export function fromSnapshot<T extends { id: string }>(
  snapshot: QueryDocumentSnapshot<Omit<T, 'id'>>,
): T {
  return { id: snapshot.id, ...snapshot.data() } as T
}

export function fromDocSnapshot<T extends { id: string }>(
  snapshot: DocumentSnapshot<Omit<T, 'id'>>,
): T | null {
  const data = snapshot.data()
  if (!data) return null
  return { id: snapshot.id, ...data } as T
}
