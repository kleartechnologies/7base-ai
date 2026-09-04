import { deleteDoc, doc, setDoc } from 'firebase/firestore'
import { attachmentDoc, attachmentsCollection } from '@/lib/firebase/collections'
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  validateAttachmentFile,
} from '@/features/chat/attachmentFile'
import {
  buildAttachmentPath,
  deleteAsset,
  uploadToPath,
} from '@/services/storage/storage.service'
import { saveChatAttachmentToAssets } from '@/services/ai/ai.client'
import type { AiResult } from '@/services/ai/ai.types'
import type { AttachmentBlock, AttachmentDraft, ChatAttachment } from '@/types'

/**
 * Chat attachment persistence.
 *
 * The invariant, inherited from the Assets upload flow: nothing ever points
 * at a file that was not written. Per upload the order is validate → Storage
 * → document; a failed document write attempts to remove the file it had
 * just written. And because attachments are created *before* their message,
 * a failed batch means no message is sent at all — a message can never
 * reference an attachment that does not exist.
 *
 * An Asset reference (`kind: 'asset'`) writes only a document: the physical
 * file already exists in the Assets library and is never duplicated here.
 * Security rules verify the referenced Asset is really the caller's and that
 * the claimed storagePath is really that Asset's path.
 */

/** The effectful collaborators, injectable so the flow is testable. */
export interface AttachmentPersistenceDeps {
  newAttachmentId: (conversationId: string) => string
  uploadFile: (storagePath: string, file: File) => Promise<void>
  setAttachmentDoc: (
    conversationId: string,
    attachmentId: string,
    data: Omit<ChatAttachment, 'id'>,
  ) => Promise<void>
  deleteAttachmentDoc: (conversationId: string, attachmentId: string) => Promise<void>
  deleteFile: (storagePath: string) => Promise<void>
}

const defaultDeps: AttachmentPersistenceDeps = {
  newAttachmentId: (conversationId) => doc(attachmentsCollection(conversationId)).id,
  uploadFile: uploadToPath,
  setAttachmentDoc: (conversationId, attachmentId, data) =>
    setDoc(attachmentDoc(conversationId, attachmentId), data),
  deleteAttachmentDoc: (conversationId, attachmentId) =>
    deleteDoc(attachmentDoc(conversationId, attachmentId)),
  deleteFile: deleteAsset,
}

/**
 * Stages every draft for one message: uploads new files, references Assets,
 * and creates all the attachment documents. All-or-nothing — on any failure
 * the already-created documents (and uploaded files) are removed
 * best-effort, and the original error is rethrown so no message is sent.
 */
export async function createChatAttachments(
  params: {
    ownerId: string
    businessId: string
    conversationId: string
    /** Reserved before the message is written, so the link is set at birth. */
    messageId: string
    drafts: AttachmentDraft[]
  },
  deps: AttachmentPersistenceDeps = defaultDeps,
): Promise<ChatAttachment[]> {
  if (params.drafts.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Error(`A message can carry at most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments.`)
  }

  const created: ChatAttachment[] = []
  try {
    for (const draft of params.drafts) {
      created.push(await createOne(params, draft, deps))
    }
    return created
  } catch (error) {
    await cleanupAttachments(params.conversationId, created, deps)
    throw error
  }
}

async function createOne(
  params: { ownerId: string; businessId: string; conversationId: string; messageId: string },
  draft: AttachmentDraft,
  deps: AttachmentPersistenceDeps,
): Promise<ChatAttachment> {
  const attachmentId = deps.newAttachmentId(params.conversationId)
  const base = {
    ownerId: params.ownerId,
    businessId: params.businessId,
    conversationId: params.conversationId,
    messageId: params.messageId,
    status: 'active' as const,
    createdAt: Date.now(),
  }

  if (draft.kind === 'asset') {
    // Reference, not copy: the attachment points at the Asset's own file.
    const data: Omit<ChatAttachment, 'id'> = {
      ...base,
      fileName: draft.asset.fileName,
      contentType: draft.asset.contentType,
      sizeBytes: draft.asset.sizeBytes,
      storagePath: draft.asset.storagePath,
      source: 'asset',
      assetId: draft.asset.id,
    }
    await deps.setAttachmentDoc(params.conversationId, attachmentId, data)
    return { id: attachmentId, ...data }
  }

  const check = validateAttachmentFile(draft.file)
  if (!check.ok) {
    throw new Error(check.reason ?? 'This file cannot be attached.')
  }

  const storagePath = buildAttachmentPath(
    params.businessId,
    params.conversationId,
    attachmentId,
    draft.file.name,
  )
  await deps.uploadFile(storagePath, draft.file)

  const data: Omit<ChatAttachment, 'id'> = {
    ...base,
    fileName: draft.file.name,
    contentType: draft.file.type,
    sizeBytes: draft.file.size,
    storagePath,
    source: 'upload',
    assetId: null,
  }
  try {
    await deps.setAttachmentDoc(params.conversationId, attachmentId, data)
  } catch (error) {
    // Never leave a dangling document; a dangling *file* is the lesser evil.
    try {
      await deps.deleteFile(storagePath)
    } catch {
      // Best-effort only. The original failure is the one worth reporting.
    }
    throw error
  }
  return { id: attachmentId, ...data }
}

/** Best-effort removal of staged attachments after a failed send. */
async function cleanupAttachments(
  conversationId: string,
  created: ChatAttachment[],
  deps: AttachmentPersistenceDeps,
): Promise<void> {
  for (const attachment of created) {
    try {
      await deps.deleteAttachmentDoc(conversationId, attachment.id)
      // Only uploads own their file; an Asset reference must never delete
      // the Asset's own bytes.
      if (attachment.source === 'upload') {
        await deps.deleteFile(attachment.storagePath)
      }
    } catch {
      // Best-effort only.
    }
  }
}

/**
 * The immutable blocks a message carries for its attachments. Ids continue
 * the message's block numbering after the text block.
 */
export function buildAttachmentBlocks(
  attachments: ChatAttachment[],
  startIndex: number,
): AttachmentBlock[] {
  return attachments.map((attachment, index) => ({
    id: `b${startIndex + index}`,
    type: 'attachment' as const,
    attachmentId: attachment.id,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    storagePath: attachment.storagePath,
    assetId: attachment.assetId,
  }))
}

/**
 * Promotes one uploaded attachment to a permanent Asset, server-side. The
 * backend copies the file into the Assets namespace and creates the Asset
 * document — the attachment and its message are never modified beyond the
 * document's own `assetId` bookmark, and calling twice returns the same
 * Asset rather than creating a duplicate.
 */
export function saveAttachmentToAssets(
  conversationId: string,
  attachmentId: string,
): Promise<AiResult<{ assetId: string }>> {
  return saveChatAttachmentToAssets({ conversationId, attachmentId })
}
