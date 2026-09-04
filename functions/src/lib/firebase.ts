import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

/**
 * Admin SDK singleton. Cloud Functions reuses warm instances, so
 * initialisation must be idempotent.
 */
if (getApps().length === 0) {
  initializeApp()
}

export const db = getFirestore()

export { FieldValue }

/**
 * The default Storage bucket, resolved lazily so importing this module never
 * requires a bucket to exist (unit tests import it with no Firebase at all).
 */
export function storageBucket() {
  return getStorage().bucket()
}

export const COLLECTIONS = {
  users: 'users',
  businesses: 'businesses',
  conversations: 'conversations',
  messages: 'messages',
  /** Conversation-scoped chat attachments (subcollection of conversations). */
  attachments: 'attachments',
  campaigns: 'campaigns',
  creatives: 'creatives',
  calendarItems: 'calendarItems',
  results: 'results',
  /** Owner-uploaded business files (photos, menus, logos). See src/types/asset.ts. */
  assets: 'assets',
  /** Server-generated marketing intelligence; clients read, never write. */
  recommendations: 'recommendations',
  /**
   * One document per uid: the account's subscription plan. Written only by
   * trusted server code (later, the billing webhook); clients read their own,
   * never write — an account must not be able to upgrade itself.
   */
  subscriptions: 'subscriptions',
  /**
   * Phase 6B AI usage guardrail: one document per uid per UTC day
   * (usage/{uid}_{YYYY-MM-DD}). Server-only in both directions — clients can
   * neither read nor write; even reads are denied so quota internals never
   * become a client contract.
   */
  usage: 'usage',
} as const
