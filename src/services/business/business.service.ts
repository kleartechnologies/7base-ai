import {
  addDoc,
  arrayUnion,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { businessDoc, businessesCollection, userDoc } from '@/lib/firebase/collections'
import { fromDocSnapshot, fromSnapshot } from '@/lib/firebase/mapper'
import type { Business, BusinessDraft, Product } from '@/types'
import {
  acceptBrain,
  emptyBusiness,
  provenanceForEdits,
  userDiscovered,
  type BrainSectionKey,
  type BusinessFacts,
} from './brain'

/**
 * Business Brain persistence.
 *
 * Creation stays deliberately thin: a name is enough. Everything else is
 * either discovered later (website analysis, connected sources) or edited by
 * the owner from the Business tab. No onboarding questionnaire.
 *
 * `sources` and `discovery` never appear in a write from here. They are the
 * backend's record of what it actually did, and security rules reject a client
 * that tries to change them.
 */

export async function createBusiness(ownerId: string, draft: BusinessDraft): Promise<Business> {
  const data = emptyBusiness(ownerId, draft)
  const ref = await addDoc(businessesCollection(), data)

  // Keep the user profile's index in step so the app can resolve a business
  // without querying by `ownerId` on every boot.
  await updateDoc(userDoc(ownerId), {
    businessIds: arrayUnion(ref.id),
    activeBusinessId: ref.id,
    updatedAt: Date.now(),
  })

  return { id: ref.id, ...data }
}

export async function getBusiness(businessId: string): Promise<Business | null> {
  const snapshot = await getDoc(businessDoc(businessId))
  return fromDocSnapshot<Business>(snapshot)
}

export async function listBusinesses(ownerId: string): Promise<Business[]> {
  const snapshot = await getDocs(
    query(businessesCollection(), where('ownerId', '==', ownerId), orderBy('createdAt', 'asc')),
  )
  return snapshot.docs.map((doc) => fromSnapshot<Business>(doc))
}

export async function getPrimaryBusiness(ownerId: string): Promise<Business | null> {
  const snapshot = await getDocs(
    query(
      businessesCollection(),
      where('ownerId', '==', ownerId),
      orderBy('createdAt', 'asc'),
      limit(1),
    ),
  )
  const first = snapshot.docs[0]
  return first ? fromSnapshot<Business>(first) : null
}

export function observeBusiness(
  businessId: string,
  onChange: (business: Business | null) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    businessDoc(businessId),
    (snapshot) => onChange(fromDocSnapshot<Business>(snapshot)),
    (error) => onError?.(error),
  )
}

/**
 * Partial update. Nested Business Brain sections are replaced wholesale rather
 * than dot-path merged — the sections are small, and whole-object writes keep
 * the discovered/confirmed state internally consistent.
 */
export async function updateBusiness(
  businessId: string,
  patch: Partial<Omit<Business, 'id' | 'ownerId' | 'createdAt' | 'sources' | 'discovery'>>,
): Promise<void> {
  await updateDoc(businessDoc(businessId), { ...patch, updatedAt: Date.now() })
}

/**
 * Saves the owner's edits to the plain business facts.
 *
 * Every field they actually changed is stamped as user-confirmed, which is
 * what makes a correction stick through the next website analysis.
 */
export async function saveBusinessFacts(business: Business, next: BusinessFacts): Promise<void> {
  const now = Date.now()
  await updateDoc(businessDoc(business.id), {
    name: next.name.trim() || business.name,
    identity: next.identity,
    contact: next.contact,
    location: next.location,
    provenance: provenanceForEdits(business, next, now),
    updatedAt: now,
  })
}

/**
 * Records the owner accepting the Business Brain as MARKA presented it.
 *
 * This is what "Looks good — continue" actually means. Everything MARKA
 * discovered and the owner did not change becomes owner-accepted: it keeps the
 * source it came from and gains the authority to survive the next website
 * analysis. Fields MARKA never found stay unstamped so they can still be
 * discovered later.
 */
export async function acceptBusinessBrain(business: Business): Promise<void> {
  const now = Date.now()
  await updateDoc(businessDoc(business.id), {
    ...acceptBrain(business, now),
    updatedAt: now,
  })
}

/**
 * Saves an owner-edited Brain section (audience, brand, marketing,
 * operations), replacing whatever MARKA had inferred.
 */
export async function saveBrainSection<K extends BrainSectionKey>(
  businessId: string,
  section: K,
  value: NonNullable<Business[K]>['value'],
): Promise<void> {
  const now = Date.now()
  await updateDoc(businessDoc(businessId), {
    [section]: userDiscovered(value, now),
    updatedAt: now,
  })
}

/**
 * Saves the owner's Brand Identity (Phase 7D).
 *
 * The kit is owner-authored by definition, so the whole object is replaced —
 * the same wholesale-write discipline as the Brain sections. When discovered
 * brand values were confirmed via "Use these", the caller passes the accepted
 * `brand` wrapper too, so the discovery keeps its provenance (source stays
 * 'website') while gaining owner authority.
 */
export async function saveBrandKit(
  businessId: string,
  kit: NonNullable<Business['brandKit']>,
  acceptedBrand?: Business['brand'],
): Promise<void> {
  const now = Date.now()
  const patch: Record<string, unknown> = {
    brandKit: { ...kit, updatedAt: now },
    updatedAt: now,
  }
  if (acceptedBrand) patch.brand = acceptedBrand
  await updateDoc(businessDoc(businessId), patch)
}

/**
 * Saves the product list.
 *
 * Products the owner touched are marked confirmed so a later analysis leaves
 * them alone; the rest keep the provenance the analysis gave them.
 */
export async function saveProducts(businessId: string, products: Product[]): Promise<void> {
  await updateDoc(businessDoc(businessId), {
    products,
    updatedAt: Date.now(),
  })
}
