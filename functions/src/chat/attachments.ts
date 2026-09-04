import { logger } from 'firebase-functions'
import { COLLECTIONS, db, storageBucket } from '../lib/firebase'
import type { TurnAttachmentPart } from '../ai/orchestrator'
import type { AttachmentBlock, MessageBlock, StoredMessage } from '../lib/types'

/**
 * Chat attachments on the server side: loading what the latest user message
 * attached and turning it into multimodal model input.
 *
 * The trust boundary is absolute. Nothing from the message block is believed
 * on its own — every attachment is re-read from its Firestore document, its
 * ownership re-verified, and its bytes fetched by this function from the
 * project's own Storage bucket. A client-supplied URL, path or size never
 * reaches the model; the only thing the block contributes is *which document
 * to check*.
 *
 * Failure here is soft by design. An attachment that cannot be analysed —
 * wrong type, too large, missing bytes — is skipped and reported honestly;
 * the reply itself always goes ahead on the text.
 */

/** The stored attachment shape. Mirrors `src/types/chat.ts` — change together. */
export interface StoredAttachment {
  ownerId: string
  businessId: string
  conversationId: string
  messageId: string
  fileName: string
  contentType: string
  sizeBytes: number
  storagePath: string
  source: 'upload' | 'asset'
  status: 'active' | 'deleted'
  assetId: string | null
  createdAt: number
}

/** Mirrors `src/features/chat/attachmentFile.ts` — change together. */
export const ATTACHMENT_AI_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const

/** Above this, bytes stay in Storage and out of the prompt. Mirrors the client. */
export const MAX_AI_ATTACHMENT_BYTES = 8 * 1024 * 1024

/** Server-side ceiling; rules cannot count sibling documents. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 3

/** One attachment that could not become model input, and the honest reason. */
export interface SkippedAttachment {
  fileName: string
  reason: 'unsupported_type' | 'too_large' | 'unavailable'
}

export interface AttachmentPartsResult {
  parts: TurnAttachmentPart[]
  skipped: SkippedAttachment[]
}

/** Effectful collaborators, injectable so tests never need Firebase. */
export interface AttachmentInputDeps {
  getAttachment: (
    conversationId: string,
    attachmentId: string,
  ) => Promise<StoredAttachment | null>
  downloadBytes: (storagePath: string) => Promise<Buffer>
}

const defaultDeps: AttachmentInputDeps = {
  async getAttachment(conversationId, attachmentId) {
    const snapshot = await db
      .collection(COLLECTIONS.conversations)
      .doc(conversationId)
      .collection(COLLECTIONS.attachments)
      .doc(attachmentId)
      .get()
    return snapshot.exists ? (snapshot.data() as StoredAttachment) : null
  },
  async downloadBytes(storagePath) {
    const [bytes] = await storageBucket().file(storagePath).download()
    return bytes
  },
}

/**
 * The attachment blocks of one stored message, capped at the per-message
 * maximum. The cap is enforced here as well as in the client because rules
 * cannot count blocks — a hand-written message with ten blocks still costs
 * at most three downloads.
 */
export function collectAttachmentBlocks(message: StoredMessage): AttachmentBlock[] {
  return message.blocks
    .filter((block): block is AttachmentBlock => block.type === 'attachment')
    .slice(0, MAX_ATTACHMENTS_PER_MESSAGE)
}

/**
 * Resolves the latest user message's attachments into model input parts.
 *
 * Per attachment: re-read the document, verify it belongs to this user and
 * this conversation and is still active, check type and size, download the
 * bytes from our own bucket, and re-check the size against what actually
 * arrived — a document's claimed `sizeBytes` is client-written and not
 * trusted as the final word. Anything that fails any step lands in
 * `skipped`, never in the prompt.
 */
export async function buildAttachmentParts(
  params: { uid: string; conversationId: string; blocks: AttachmentBlock[] },
  deps: AttachmentInputDeps = defaultDeps,
): Promise<AttachmentPartsResult> {
  const parts: TurnAttachmentPart[] = []
  const skipped: SkippedAttachment[] = []

  for (const block of params.blocks.slice(0, MAX_ATTACHMENTS_PER_MESSAGE)) {
    let attachment: StoredAttachment | null
    try {
      attachment = await deps.getAttachment(params.conversationId, block.attachmentId)
    } catch {
      attachment = null
    }

    // A missing, foreign or deleted attachment answers identically: it is
    // simply unavailable. No detail about *why* leaks into the reply.
    if (
      !attachment ||
      attachment.ownerId !== params.uid ||
      attachment.conversationId !== params.conversationId ||
      attachment.status !== 'active'
    ) {
      skipped.push({ fileName: block.fileName, reason: 'unavailable' })
      continue
    }

    if (!(ATTACHMENT_AI_MIME_TYPES as readonly string[]).includes(attachment.contentType)) {
      skipped.push({ fileName: attachment.fileName, reason: 'unsupported_type' })
      continue
    }

    if (attachment.sizeBytes > MAX_AI_ATTACHMENT_BYTES) {
      skipped.push({ fileName: attachment.fileName, reason: 'too_large' })
      continue
    }

    let bytes: Buffer
    try {
      bytes = await deps.downloadBytes(attachment.storagePath)
    } catch {
      skipped.push({ fileName: attachment.fileName, reason: 'unavailable' })
      continue
    }

    if (bytes.length > MAX_AI_ATTACHMENT_BYTES) {
      skipped.push({ fileName: attachment.fileName, reason: 'too_large' })
      continue
    }

    const dataUrl = `data:${attachment.contentType};base64,${bytes.toString('base64')}`
    parts.push(
      attachment.contentType === 'application/pdf'
        ? { type: 'input_file', filename: attachment.fileName, fileData: dataUrl }
        : { type: 'input_image', imageUrl: dataUrl },
    )
  }

  return { parts, skipped }
}

/**
 * A system-prompt suffix for attachments the model will not receive.
 *
 * Deterministic and explicit: the model is told the files exist and are
 * unavailable, and is forbidden from inferring their contents — EVA must
 * never pretend to have read something it did not.
 */
export function buildUnavailableNote(skipped: SkippedAttachment[]): string | null {
  if (skipped.length === 0) return null
  const names = skipped.map((item) => item.fileName).join(', ')
  return (
    `\n\nThe user attached files that are unavailable for visual analysis: ${names}. ` +
    'Do not infer, guess or describe their contents. Respond based only on the text ' +
    'context, and if the attachments are relevant, state plainly that they could not ' +
    'be analysed.'
  )
}

/**
 * Loads multimodal input for a reply, never failing the reply itself.
 *
 * Any unexpected error downgrades every attachment to "skipped" — the user
 * still gets an answer, grounded in text, with an honest note about the
 * files. Telemetry records counts and reasons only; never bytes, paths or
 * URLs.
 */
export async function resolveAttachmentInput(
  params: { uid: string; conversationId: string; message: StoredMessage },
  deps: AttachmentInputDeps = defaultDeps,
): Promise<AttachmentPartsResult> {
  const blocks = collectAttachmentBlocks(params.message)
  if (blocks.length === 0) return { parts: [], skipped: [] }

  let result: AttachmentPartsResult
  try {
    result = await buildAttachmentParts(
      { uid: params.uid, conversationId: params.conversationId, blocks },
      deps,
    )
  } catch {
    result = {
      parts: [],
      skipped: blocks.map((block) => ({
        fileName: block.fileName,
        reason: 'unavailable' as const,
      })),
    }
  }

  logger.info('chat.attachments', {
    conversationId: params.conversationId,
    count: blocks.length,
    analyzed: result.parts.length,
    skipped: result.skipped.map((item) => item.reason),
    multimodal: result.parts.length > 0,
  })

  return result
}

/** Narrow helper for callers that only have the block list. */
export function hasAttachmentBlocks(blocks: MessageBlock[]): boolean {
  return blocks.some((block) => block.type === 'attachment')
}
