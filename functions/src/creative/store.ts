import { COLLECTIONS, db } from '../lib/firebase'
import type { MessageMeta } from '../lib/types'
import type {
  CreativeCaptions,
  CreativeContent,
  CreativeEditableField,
  CreativeFormat,
  CreativeStatus,
  CreativeStyle,
} from './validate'

/**
 * Creative persistence, server side.
 *
 * Creatives are created only by Cloud Functions — the client never writes
 * one into existence (security rules deny creates outright, like
 * `recommendations`). The owner may update copy fields directly from the
 * app, so updates are client-allowed but the provenance chain
 * (`businessId`, `campaignId`, `sourceRecommendationId`, `conversationId`)
 * and the image's storage path are frozen by rules and only ever written
 * here, through the Admin SDK.
 *
 * Traceability runs the full length of the product:
 * Creative → campaignId → sourceRecommendationId → diagnosis → Brain.
 */

export interface StoredCreative {
  ownerId: string
  businessId: string
  campaignId: string
  /** The conversation the creative was made in; null outside chat. */
  conversationId: string | null
  /** Copied from the campaign so the chain survives campaign deletion. */
  sourceRecommendationId: string | null
  name: string
  format: CreativeFormat
  status: CreativeStatus
  content: CreativeContent
  captions: CreativeCaptions
  style: CreativeStyle
  /** Flattened export, produced client-side from content + style. Not yet stored. */
  render: null
  /**
   * Fields the owner has taken authority over — by editing directly or by
   * instructing MARKA. An AI update must never silently revert one. Same
   * authority model as campaigns; not a second system.
   */
  userEdited: CreativeEditableField[]
  /**
   * Standing constraints from the owner's instructions ("don't mention
   * discounts"), fed into every later copy or edit call for this creative.
   */
  ownerDirectives: string[]
  /** Safe, owner-facing sentence when the image could not be made. */
  imageError: string | null
  meta: MessageMeta | null
  createdAt: number
  updatedAt: number
}

export function buildStoredCreative(params: {
  ownerId: string
  businessId: string
  campaignId: string
  conversationId: string | null
  sourceRecommendationId: string | null
  name: string
  format: CreativeFormat
  content: CreativeContent
  captions: CreativeCaptions
  style: CreativeStyle
  imageError: string | null
  meta: MessageMeta | null
  now?: number
}): StoredCreative {
  const now = params.now ?? Date.now()
  return {
    ownerId: params.ownerId,
    businessId: params.businessId,
    campaignId: params.campaignId,
    conversationId: params.conversationId,
    sourceRecommendationId: params.sourceRecommendationId,
    name: params.name,
    format: params.format,
    // Copy always exists (the deterministic draft guarantees it), so a
    // creative is 'ready' even when its image failed — the failure is carried
    // in imageError and the UI offers a retry, per the resilience rule that
    // an image failure must not destroy the campaign flow.
    status: 'ready',
    content: params.content,
    captions: params.captions,
    style: params.style,
    render: null,
    userEdited: [],
    ownerDirectives: [],
    imageError: params.imageError,
    meta: params.meta,
    createdAt: now,
    updatedAt: now,
  }
}

export async function saveCreative(creative: StoredCreative): Promise<string> {
  const ref = await db.collection(COLLECTIONS.creatives).add(creative)
  return ref.id
}

export async function updateStoredCreative(
  creativeId: string,
  creative: StoredCreative,
): Promise<void> {
  await db.collection(COLLECTIONS.creatives).doc(creativeId).set(creative)
}

export async function getStoredCreative(
  creativeId: string,
): Promise<StoredCreative | null> {
  const snapshot = await db.collection(COLLECTIONS.creatives).doc(creativeId).get()
  return snapshot.exists ? (snapshot.data() as StoredCreative) : null
}

/**
 * The creative "make the headline more premium" refers to: the most recently
 * touched one in this conversation. Equality-only query (no composite
 * index), sorted in memory — a conversation holds a handful of creatives at
 * most. Mirrors `findLatestEditableCampaign`.
 */
export async function findLatestEditableCreative(
  conversationId: string,
  ownerId: string,
): Promise<{ id: string; creative: StoredCreative } | null> {
  const snapshot = await db
    .collection(COLLECTIONS.creatives)
    .where('conversationId', '==', conversationId)
    .where('ownerId', '==', ownerId)
    .get()

  const editable = snapshot.docs
    .map((doc) => ({ id: doc.id, creative: doc.data() as StoredCreative }))
    .filter((entry) => entry.creative.status === 'ready' || entry.creative.status === 'draft')
    .sort((a, b) => b.creative.updatedAt - a.creative.updatedAt)

  return editable[0] ?? null
}
