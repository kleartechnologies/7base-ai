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

export type AssetKind = 'brand' | 'uploads' | 'creatives'

export function buildAssetPath(businessId: string, kind: AssetKind, fileName: string): string {
  const safeName = fileName.replace(/[^\w.-]+/g, '_')
  return `businesses/${businessId}/${kind}/${Date.now()}_${safeName}`
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
