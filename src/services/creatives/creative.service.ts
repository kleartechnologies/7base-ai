import {
  getDoc,
  limit as fbLimit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { creativeDoc, creativesCollection } from '@/lib/firebase/collections'
import { fromDocSnapshot, fromSnapshot } from '@/lib/firebase/mapper'
import type { Creative, CreativeCaptions, CreativeEditableField } from '@/types'

/**
 * Creative persistence, client side.
 *
 * Creatives are *created* by Cloud Functions from campaigns — there is
 * deliberately no client-side create here (security rules refuse client
 * creates outright, because a client cannot honestly claim the chain
 * Creative → Campaign → Recommendation). Conversational editing goes through
 * chat, which edits server-side with the authority model intact.
 *
 * The one write that lives here is the owner rewording their own caption in
 * the copy panel — no AI, no plan, no quota, nothing the client could lie
 * about. The rules allow exactly that shape: an owner update whose server
 * fields (the campaign chain, the rendered image, the asset and logo
 * references) are all unchanged. Everything else about a creative is still
 * the backend's to write.
 *
 * Queries constrain `ownerId` — the only shape the list rule can prove safe.
 */

export async function getCreative(creativeId: string): Promise<Creative | null> {
  const snapshot = await getDoc(creativeDoc(creativeId))
  return fromDocSnapshot<Creative>(snapshot)
}

/** One creative, live; null once it no longer exists. */
export function observeCreative(
  creativeId: string,
  onChange: (creative: Creative | null) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    creativeDoc(creativeId),
    (snapshot) => onChange(fromDocSnapshot<Creative>(snapshot)),
    (error) => onError?.(error),
  )
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

/**
 * Saves one caption the owner rewrote, and records their authority over it.
 *
 * `userEdited` is the same authority model campaigns use: once the owner has
 * written this caption themselves, a later AI update must not silently
 * revert it. Nothing else on the creative moves — the poster image, its
 * storage path and the campaign it belongs to are untouched, which is also
 * exactly what the security rules enforce on this write.
 */
export async function updateCreativeCaption(
  creative: Creative,
  caption: keyof CreativeCaptions,
  field: CreativeEditableField,
  text: string,
): Promise<void> {
  const userEdited = [...new Set<CreativeEditableField>([...creative.userEdited, field])]
  // A dotted path so only this one caption is written; a nested object would
  // replace the whole `captions` map and wipe the platforms not on screen.
  await updateDoc(creativeDoc(creative.id), {
    [`captions.${caption}`]: text,
    userEdited,
    updatedAt: Date.now(),
  })
}
