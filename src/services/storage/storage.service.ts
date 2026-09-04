import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
  type UploadResult,
} from 'firebase/storage'
import { getFirebaseStorage } from '@/lib/firebase/app'

/**
 * File storage for brand assets, uploaded menus and rendered creatives.
 *
 * Paths are always business-scoped — `businesses/{businessId}/…` — because
 * Storage rules authorise on the path prefix. Building paths here rather than
 * at call sites keeps every write inside the authorised namespace.
 */

export type AssetKind = 'brand' | 'uploads' | 'creatives' | 'assets'

/** The one file-name sanitiser. Every Storage path builder goes through it. */
export function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^\w.-]+/g, '_')
}

export function buildAssetPath(businessId: string, kind: AssetKind, fileName: string): string {
  return `businesses/${businessId}/${kind}/${Date.now()}_${sanitizeFileName(fileName)}`
}

/**
 * Where a chat upload lives: under its conversation, never under the
 * permanent Assets folder — an attachment is conversational context, not a
 * business material, and the paths keep that distinction physical.
 */
export function buildAttachmentPath(
  businessId: string,
  conversationId: string,
  attachmentId: string,
  fileName: string,
): string {
  return `businesses/${businessId}/conversations/${conversationId}/attachments/${attachmentId}_${sanitizeFileName(fileName)}`
}

/** Uploads to an already-built path; callers build paths with the helpers above. */
export async function uploadToPath(storagePath: string, file: File): Promise<void> {
  await uploadBytes(ref(getFirebaseStorage(), storagePath), file, {
    contentType: file.type || 'application/octet-stream',
  })
}

export async function uploadAsset(
  businessId: string,
  kind: AssetKind,
  file: File,
): Promise<{ storagePath: string; downloadUrl: string }> {
  const storagePath = buildAssetPath(businessId, kind, file.name)
  const objectRef = ref(getFirebaseStorage(), storagePath)
  const result: UploadResult = await uploadBytes(objectRef, file, {
    contentType: file.type || 'application/octet-stream',
  })
  const downloadUrl = await getDownloadURL(result.ref)
  return { storagePath, downloadUrl }
}

/** Download URLs are short-lived; entities store the path and resolve on demand. */
export function getAssetUrl(storagePath: string): Promise<string> {
  return getDownloadURL(ref(getFirebaseStorage(), storagePath))
}

export async function deleteAsset(storagePath: string): Promise<void> {
  await deleteObject(ref(getFirebaseStorage(), storagePath))
}
