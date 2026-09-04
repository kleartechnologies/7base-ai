import type { FileLike } from '@/features/assets/assetFile'

/**
 * Chat attachment validation, kept pure — no Firebase, no DOM — like
 * `assetFile.ts` before it.
 *
 * Attachments are deliberately stricter than Assets: they ride along with a
 * chat message, so the ceiling is 10 MiB rather than the Storage rule's
 * 20 MiB, and at most three travel with one message. A file at exactly
 * 10 MiB is allowed — the Storage rule (`size < 20 MiB`) is nowhere near it.
 *
 * The MIME allow-list matches Assets: SVG is an `image/*` type the Storage
 * rule would admit, but it is a script container, so it is refused by name.
 */

export const ACCEPTED_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const

/** Per-file ceiling for chat uploads. Inclusive: exactly 10 MiB is fine. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/**
 * Ceiling for what may be sent to the model as visual/document context. A
 * larger attachment is still stored and rendered — it just is not analysed,
 * and EVA says so rather than pretending.
 */
export const MAX_AI_ATTACHMENT_BYTES = 8 * 1024 * 1024

export const MAX_ATTACHMENTS_PER_MESSAGE = 3

/** For the file input's `accept` attribute. Advisory only; validate too. */
export const ATTACHMENT_FILE_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf'

export interface AttachmentFileCheck {
  ok: boolean
  /** Owner-readable reason when not ok. */
  reason: string | null
}

export function validateAttachmentFile(file: FileLike): AttachmentFileCheck {
  if (file.type === 'image/svg+xml') {
    return { ok: false, reason: 'SVG files are not supported. Please use JPEG, PNG or WebP.' }
  }
  if (!(ACCEPTED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
    return {
      ok: false,
      reason: 'This file type is not supported. Please attach a JPEG, PNG, WebP or PDF.',
    }
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: 'This file is too large. The maximum size is 10 MB.' }
  }
  if (file.size <= 0) {
    return { ok: false, reason: 'This file is empty.' }
  }
  return { ok: true, reason: null }
}

/** Whether one more attachment may join a message carrying `currentCount`. */
export function canAddAttachment(currentCount: number): boolean {
  return currentCount < MAX_ATTACHMENTS_PER_MESSAGE
}

export function isImageAttachment(contentType: string): boolean {
  return contentType.startsWith('image/')
}

export function isPdfAttachment(contentType: string): boolean {
  return contentType === 'application/pdf'
}

/**
 * Whether an attachment's bytes may be handed to the model. Rendering has no
 * such limit — this gates only the AI input path, deterministically.
 */
export function isAiEligibleAttachment(attachment: {
  contentType: string
  sizeBytes: number
}): boolean {
  return (
    (ACCEPTED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(attachment.contentType) &&
    attachment.sizeBytes > 0 &&
    attachment.sizeBytes <= MAX_AI_ATTACHMENT_BYTES
  )
}
