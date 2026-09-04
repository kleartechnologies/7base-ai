import {
  collection,
  doc,
  type CollectionReference,
  type DocumentReference,
} from 'firebase/firestore'
import { getDb } from './app'
import type {
  Asset,
  Business,
  CalendarItem,
  Campaign,
  ChatAttachment,
  Conversation,
  Creative,
  MarketingRecommendation,
  Message,
  ResultEntry,
  UserProfile,
} from '@/types'

/**
 * Collection names in one place.
 *
 * These strings are duplicated in `firestore.rules` and in the Cloud Functions
 * codebase — changing one means changing all three, so keep them here rather
 * than inline at call sites.
 */
export const COLLECTIONS = {
  users: 'users',
  businesses: 'businesses',
  conversations: 'conversations',
  /** Sub-collection of `conversations`. */
  messages: 'messages',
  /** Sub-collection of `conversations`: files attached to messages. */
  attachments: 'attachments',
  campaigns: 'campaigns',
  creatives: 'creatives',
  calendarItems: 'calendarItems',
  results: 'results',
  /** Server-generated marketing intelligence; clients read, never write. */
  recommendations: 'recommendations',
  /** Owner-uploaded business materials; the files live in Storage. */
  assets: 'assets',
} as const

/**
 * Firestore stores the document id in the path, not the body. These helpers
 * type the *stored shape*, i.e. the entity without its `id`.
 */
export type StoredDoc<T extends { id: string }> = Omit<T, 'id'>

const typedCollection = <T>(path: string) =>
  collection(getDb(), path) as CollectionReference<T>

export const usersCollection = () => typedCollection<StoredDoc<UserProfile>>(COLLECTIONS.users)
export const businessesCollection = () =>
  typedCollection<StoredDoc<Business>>(COLLECTIONS.businesses)
export const conversationsCollection = () =>
  typedCollection<StoredDoc<Conversation>>(COLLECTIONS.conversations)
export const campaignsCollection = () =>
  typedCollection<StoredDoc<Campaign>>(COLLECTIONS.campaigns)
export const creativesCollection = () =>
  typedCollection<StoredDoc<Creative>>(COLLECTIONS.creatives)
export const calendarItemsCollection = () =>
  typedCollection<StoredDoc<CalendarItem>>(COLLECTIONS.calendarItems)
export const resultsCollection = () =>
  typedCollection<StoredDoc<ResultEntry>>(COLLECTIONS.results)
export const recommendationsCollection = () =>
  typedCollection<StoredDoc<MarketingRecommendation>>(COLLECTIONS.recommendations)
export const assetsCollection = () => typedCollection<StoredDoc<Asset>>(COLLECTIONS.assets)

export const userDoc = (userId: string) =>
  doc(getDb(), COLLECTIONS.users, userId) as DocumentReference<StoredDoc<UserProfile>>

export const businessDoc = (businessId: string) =>
  doc(getDb(), COLLECTIONS.businesses, businessId) as DocumentReference<StoredDoc<Business>>

export const conversationDoc = (conversationId: string) =>
  doc(
    getDb(),
    COLLECTIONS.conversations,
    conversationId,
  ) as DocumentReference<StoredDoc<Conversation>>

export const campaignDoc = (campaignId: string) =>
  doc(getDb(), COLLECTIONS.campaigns, campaignId) as DocumentReference<StoredDoc<Campaign>>

export const creativeDoc = (creativeId: string) =>
  doc(getDb(), COLLECTIONS.creatives, creativeId) as DocumentReference<StoredDoc<Creative>>

export const recommendationDoc = (recommendationId: string) =>
  doc(
    getDb(),
    COLLECTIONS.recommendations,
    recommendationId,
  ) as DocumentReference<StoredDoc<MarketingRecommendation>>

export const assetDoc = (assetId: string) =>
  doc(getDb(), COLLECTIONS.assets, assetId) as DocumentReference<StoredDoc<Asset>>

/**
 * Messages live under their conversation so a single security rule on the
 * parent governs the whole thread, and reads never need a composite index.
 */
export const messagesCollection = (conversationId: string) =>
  collection(
    getDb(),
    COLLECTIONS.conversations,
    conversationId,
    COLLECTIONS.messages,
  ) as CollectionReference<StoredDoc<Message>>

/**
 * Attachments live beside messages under their conversation, for the same
 * reason: the parent's ownership governs the whole thread's files.
 */
export const attachmentsCollection = (conversationId: string) =>
  collection(
    getDb(),
    COLLECTIONS.conversations,
    conversationId,
    COLLECTIONS.attachments,
  ) as CollectionReference<StoredDoc<ChatAttachment>>

export const attachmentDoc = (conversationId: string, attachmentId: string) =>
  doc(attachmentsCollection(conversationId), attachmentId)
