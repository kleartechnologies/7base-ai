import {
  getDoc,
  limit as fbLimit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { campaignDoc, campaignsCollection } from '@/lib/firebase/collections'
import { fromDocSnapshot, fromSnapshot } from '@/lib/firebase/mapper'
import type { Campaign, CampaignEditableField, CampaignStatus } from '@/types'

/**
 * Campaign persistence, client side.
 *
 * Campaigns are *created* by Cloud Functions from recommendations — there is
 * deliberately no client-side create here, because a client cannot honestly
 * claim a campaign was built from a recommendation (security rules refuse
 * `sourceRecommendationId` on client creates anyway).
 *
 * Edits are the owner's, so they happen directly: every content change made
 * through `updateCampaignContent` is recorded in `userEdited`, which is what
 * stops a later AI update from silently reverting the owner's decision.
 *
 * Queries constrain `ownerId` — the only shape the list rule can prove safe.
 */

/** The fields the edit surface may change; ids and provenance are not here. */
export type CampaignContentPatch = Partial<
  Pick<
    Campaign,
    | 'name'
    | 'objective'
    | 'targetAudience'
    | 'offer'
    | 'positioning'
    | 'keyMessage'
    | 'callToAction'
    | 'channels'
    | 'durationDays'
    | 'startDate'
    | 'endDate'
    | 'notes'
  >
>

export async function getCampaign(campaignId: string): Promise<Campaign | null> {
  const snapshot = await getDoc(campaignDoc(campaignId))
  return fromDocSnapshot<Campaign>(snapshot)
}

/** The owner's campaigns, most recently touched first. */
export function observeCampaigns(
  ownerId: string,
  onChange: (campaigns: Campaign[]) => void,
  onError?: (error: unknown) => void,
  max = 100,
): () => void {
  return onSnapshot(
    query(
      campaignsCollection(),
      where('ownerId', '==', ownerId),
      orderBy('updatedAt', 'desc'),
      fbLimit(max),
    ),
    (snapshot) => onChange(snapshot.docs.map((d) => fromSnapshot<Campaign>(d))),
    (error) => onError?.(error),
  )
}

/**
 * Applies the owner's edits and records their authority over every field the
 * patch actually changes. The `campaign` argument is the version being
 * edited, so unchanged fields are not spuriously locked.
 */
export async function updateCampaignContent(
  campaign: Campaign,
  patch: CampaignContentPatch,
): Promise<void> {
  const changed = (Object.keys(patch) as (keyof CampaignContentPatch)[]).filter(
    (field) => JSON.stringify(patch[field]) !== JSON.stringify(campaign[field]),
  )
  if (changed.length === 0) return

  const userEdited = [
    ...new Set<CampaignEditableField>([...campaign.userEdited, ...changed]),
  ]
  await updateDoc(campaignDoc(campaign.id), { ...patch, userEdited, updatedAt: Date.now() })
}

export async function setCampaignStatus(
  campaignId: string,
  status: CampaignStatus,
): Promise<void> {
  await updateDoc(campaignDoc(campaignId), { status, updatedAt: Date.now() })
}
