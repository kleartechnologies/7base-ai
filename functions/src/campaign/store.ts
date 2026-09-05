import { COLLECTIONS, db } from '../lib/firebase'
import type { MessageMeta } from '../lib/types'
import {
  type CampaignContent,
  type CampaignEditableField,
  type CampaignStatus,
} from './validate'

/**
 * Campaign persistence, server side.
 *
 * Campaigns are created by Cloud Functions from recommendations; the owner
 * can also edit theirs directly from the app, so unlike `recommendations`
 * the collection is client-writable — but the provenance fields
 * (`sourceRecommendationId`, `businessId`, `conversationId`) are protected
 * by security rules and only ever written here, through the Admin SDK.
 */

export interface StoredCampaign extends CampaignContent {
  ownerId: string
  businessId: string
  /** The conversation the campaign was built in; null outside chat. */
  conversationId: string | null
  /** Traceability back to the recommendation. Server-set, never client-set. */
  sourceRecommendationId: string | null
  status: CampaignStatus
  /**
   * Fields the owner has taken authority over — by editing directly or by
   * instructing MARKA. An AI update must never silently revert one.
   */
  userEdited: CampaignEditableField[]
  meta: MessageMeta | null
  createdAt: number
  updatedAt: number
}

export function buildStoredCampaign(params: {
  ownerId: string
  businessId: string
  conversationId: string | null
  sourceRecommendationId: string | null
  content: CampaignContent
  meta: MessageMeta | null
  now?: number
}): StoredCampaign {
  const now = params.now ?? Date.now()
  return {
    ...params.content,
    ownerId: params.ownerId,
    businessId: params.businessId,
    conversationId: params.conversationId,
    sourceRecommendationId: params.sourceRecommendationId,
    status: 'draft',
    userEdited: [],
    meta: params.meta,
    createdAt: now,
    updatedAt: now,
  }
}

export async function saveCampaign(campaign: StoredCampaign): Promise<string> {
  const ref = await db.collection(COLLECTIONS.campaigns).add(campaign)
  return ref.id
}

/**
 * The campaign already built from this recommendation, if any. A
 * recommendation is built at most once — "Build this campaign" clicked twice
 * must reuse the first result, not bill a second polish call. Equality-only
 * query (no composite index), sorted in memory; one recommendation yields at
 * most a campaign, so the scan is tiny.
 */
export async function findCampaignByRecommendation(
  recommendationId: string,
  ownerId: string,
): Promise<{ id: string; campaign: StoredCampaign } | null> {
  const snapshot = await db
    .collection(COLLECTIONS.campaigns)
    .where('sourceRecommendationId', '==', recommendationId)
    .where('ownerId', '==', ownerId)
    .get()

  const existing = snapshot.docs
    .map((doc) => ({ id: doc.id, campaign: doc.data() as StoredCampaign }))
    .sort((a, b) => a.campaign.createdAt - b.campaign.createdAt)

  return existing[0] ?? null
}

export async function updateStoredCampaign(
  campaignId: string,
  campaign: StoredCampaign,
): Promise<void> {
  await db.collection(COLLECTIONS.campaigns).doc(campaignId).set(campaign)
}

/**
 * The campaign "make this more premium" refers to: the most recently touched
 * draft or ready campaign in this conversation. Equality-only query (no
 * composite index), sorted in memory — a conversation holds a handful of
 * campaigns at most. Archived campaigns are deliberately not editable from
 * chat.
 */
export async function findLatestEditableCampaign(
  conversationId: string,
  ownerId: string,
): Promise<{ id: string; campaign: StoredCampaign } | null> {
  const snapshot = await db
    .collection(COLLECTIONS.campaigns)
    .where('conversationId', '==', conversationId)
    .where('ownerId', '==', ownerId)
    .get()

  const editable = snapshot.docs
    .map((doc) => ({ id: doc.id, campaign: doc.data() as StoredCampaign }))
    .filter((entry) => entry.campaign.status === 'draft' || entry.campaign.status === 'ready')
    .sort((a, b) => b.campaign.updatedAt - a.campaign.updatedAt)

  return editable[0] ?? null
}
