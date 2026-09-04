import { randomUUID } from 'node:crypto'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import type { StoredAsset } from '../creative/assets'
import { requireBusinessOwner, requireConversationOwner, requireUid } from '../lib/auth'
import { internal, invalidArgument, permissionDenied } from '../lib/errors'
import { COLLECTIONS, db, storageBucket } from '../lib/firebase'
import type {
  SaveAttachmentToAssetsRequest,
  SaveAttachmentToAssetsResponse,
} from '../lib/types'
import type { StoredAttachment } from './attachments'

/**
 * "Save to Assets": promotes one chat attachment to a permanent Asset.
 *
 * The copy is the point. An attachment is conversation-scoped and may go
 * away with its thread; an Asset is business-owned and permanent. So the
 * file is copied server-side into the Assets storage area — an independent
 * object with its own download token — and a new Asset document is created
 * with the same deterministic defaults a direct upload gets. The attachment
 * and its message are never modified beyond recording the resulting assetId
 * on the attachment *document* (the message block stays immutable history).
 *
 * Idempotent: an attachment that already points at an Asset — because it
 * was attached *from* Assets, or saved before — returns that id without a
 * second copy.
 */

/** Mirrors `sanitizeFileName` in src/services/storage/storage.service.ts. */
function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^\w.-]+/g, '_')
}

/** Mirrors `defaultAssetType` in src/features/assets/assetFile.ts. */
function assetTypeFor(contentType: string): StoredAsset['type'] {
  return contentType === 'application/pdf' ? 'document' : 'photo'
}

/** Mirrors `defaultAssetName` in src/features/assets/assetFile.ts. */
function assetNameFor(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '').trim()
  return withoutExtension || fileName
}

const SAVE_FAILED_MESSAGE =
  'This file could not be saved to Assets. It may no longer be available — try again, or re-upload it in Assets.'

/** Effectful collaborators, injectable so tests never need Firebase. */
export interface SaveAttachmentDeps {
  requireConversationOwner: (
    conversationId: string,
    uid: string,
  ) => Promise<FirebaseFirestore.DocumentData>
  requireBusinessOwner: (
    businessId: string,
    uid: string,
  ) => Promise<FirebaseFirestore.DocumentData | null>
  getAttachment: (
    conversationId: string,
    attachmentId: string,
  ) => Promise<StoredAttachment | null>
  /** Copies the object and gives the copy its own download token. */
  copyFile: (sourcePath: string, destinationPath: string) => Promise<void>
  createAssetDoc: (asset: StoredAsset) => Promise<string>
  setAttachmentAssetId: (
    conversationId: string,
    attachmentId: string,
    assetId: string,
  ) => Promise<void>
}

const defaultDeps: SaveAttachmentDeps = {
  requireConversationOwner,
  requireBusinessOwner,
  async getAttachment(conversationId, attachmentId) {
    const snapshot = await db
      .collection(COLLECTIONS.conversations)
      .doc(conversationId)
      .collection(COLLECTIONS.attachments)
      .doc(attachmentId)
      .get()
    return snapshot.exists ? (snapshot.data() as StoredAttachment) : null
  },
  async copyFile(sourcePath, destinationPath) {
    const bucket = storageBucket()
    const [copy] = await bucket.file(sourcePath).copy(bucket.file(destinationPath))
    // A fresh token: the Asset must be downloadable on its own terms, not
    // through whatever token the chat attachment happened to carry.
    await copy.setMetadata({
      metadata: { firebaseStorageDownloadTokens: randomUUID() },
    })
  },
  async createAssetDoc(asset) {
    const created = await db.collection(COLLECTIONS.assets).add(asset)
    return created.id
  },
  async setAttachmentAssetId(conversationId, attachmentId, assetId) {
    await db
      .collection(COLLECTIONS.conversations)
      .doc(conversationId)
      .collection(COLLECTIONS.attachments)
      .doc(attachmentId)
      .update({ assetId })
  },
}

/**
 * The callable's logic, separated so tests drive it with plain fakes.
 *
 * Nothing from the client is trusted beyond the two ids: the conversation
 * must be the caller's, the attachment must belong to that conversation and
 * that caller, and the business the copy lands in is the one recorded on
 * the attachment at creation — never one the request names.
 */
export async function performSaveAttachmentToAssets(
  params: { uid: string; conversationId: string; attachmentId: string },
  deps: SaveAttachmentDeps = defaultDeps,
): Promise<SaveAttachmentToAssetsResponse> {
  const { uid, conversationId, attachmentId } = params

  await deps.requireConversationOwner(conversationId, uid)

  const attachment = await deps.getAttachment(conversationId, attachmentId)
  if (
    !attachment ||
    attachment.ownerId !== uid ||
    attachment.conversationId !== conversationId ||
    attachment.status !== 'active'
  ) {
    // Missing, foreign and deleted all answer the same way.
    throw permissionDenied()
  }

  // Already an Asset — attached from the library, or saved before. Saving
  // again must not mint duplicates.
  if (attachment.assetId) {
    return { assetId: attachment.assetId }
  }

  const business = await deps.requireBusinessOwner(attachment.businessId, uid)
  if (!business) throw permissionDenied()

  const destinationPath = `businesses/${attachment.businessId}/assets/${Date.now()}_${sanitizeFileName(attachment.fileName)}`

  try {
    await deps.copyFile(attachment.storagePath, destinationPath)
  } catch (error) {
    logger.warn('chat.attachment.save_copy_failed', {
      conversationId,
      attachmentId,
      reason: error instanceof Error ? error.message : 'unknown',
    })
    throw new HttpsError('failed-precondition', SAVE_FAILED_MESSAGE)
  }

  const now = Date.now()
  // Deterministic metadata, identical to a direct upload's defaults. No AI
  // classification, no tagging — the owner edits metadata in Assets.
  const asset: StoredAsset = {
    ownerId: uid,
    businessId: attachment.businessId,
    type: assetTypeFor(attachment.contentType),
    name: assetNameFor(attachment.fileName),
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    storagePath: destinationPath,
    productId: null,
    description: null,
    tags: [],
    source: 'upload',
    status: 'active',
    allowAiUse: true,
    createdAt: now,
    updatedAt: now,
  }

  const assetId = await deps.createAssetDoc(asset)

  // Best-effort back-reference so the thread can show "Saved" and repeat
  // saves stay idempotent. The Admin SDK bypasses the client freeze rules;
  // the message itself is untouched.
  try {
    await deps.setAttachmentAssetId(conversationId, attachmentId, assetId)
  } catch (error) {
    logger.warn('chat.attachment.save_backref_failed', {
      conversationId,
      attachmentId,
      assetId,
      reason: error instanceof Error ? error.message : 'unknown',
    })
  }

  logger.info('chat.attachment.saved_to_assets', {
    conversationId,
    attachmentId,
    assetId,
    contentType: attachment.contentType,
  })

  return { assetId }
}

export const chatSaveAttachmentToAssets = onCall(
  {
    region: 'asia-southeast1',
    // A Storage copy plus three document operations; no model call, no secret.
    timeoutSeconds: 60,
    memory: '256MiB',
    maxInstances: 10,
    cors: true,
  },
  async (
    request: CallableRequest<SaveAttachmentToAssetsRequest>,
  ): Promise<SaveAttachmentToAssetsResponse> => {
    const uid = requireUid(request)
    const { conversationId, attachmentId } = request.data ?? {}

    if (!conversationId || typeof conversationId !== 'string') {
      throw invalidArgument('A conversationId is required.')
    }
    if (!attachmentId || typeof attachmentId !== 'string') {
      throw invalidArgument('An attachmentId is required.')
    }

    try {
      return await performSaveAttachmentToAssets({ uid, conversationId, attachmentId })
    } catch (error) {
      if (error instanceof HttpsError) throw error
      throw internal('chatSaveAttachmentToAssets', error)
    }
  },
)
