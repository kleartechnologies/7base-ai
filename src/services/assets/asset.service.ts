import {
  addDoc,
  limit as fbLimit,
  deleteDoc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { assetDoc, assetsCollection } from '@/lib/firebase/collections'
import { fromSnapshot } from '@/lib/firebase/mapper'
import {
  defaultAssetName,
  defaultAssetType,
  validateAssetFile,
} from '@/features/assets/assetFile'
import { deleteAsset, uploadAsset } from '@/services/storage/storage.service'
import type { Asset, AssetType, EntityId } from '@/types'

/**
 * Asset persistence: the owner's uploaded files and their metadata.
 *
 * The invariant this module protects: a document never points at a file that
 * was not written. Upload order is validate → Storage → Firestore, so a
 * failed upload creates nothing, and a failed document create attempts to
 * remove the file it had just written. The one acceptable leak is an orphaned
 * Storage object when that cleanup also fails — it costs quota, not
 * correctness, and the next upload attempt is unaffected.
 */

/**
 * The owner's assets, most recently touched first. Status and type are
 * filtered client-side — one query shape, one composite index.
 */
export function observeAssets(
  ownerId: string,
  onChange: (assets: Asset[]) => void,
  onError?: (error: unknown) => void,
  max = 100,
): () => void {
  return onSnapshot(
    query(
      assetsCollection(),
      where('ownerId', '==', ownerId),
      orderBy('updatedAt', 'desc'),
      fbLimit(max),
    ),
    (snapshot) => onChange(snapshot.docs.map((d) => fromSnapshot<Asset>(d))),
    (error) => onError?.(error),
  )
}

/**
 * Validates, uploads to `businesses/{businessId}/assets/`, then creates the
 * document. Owner and business come from the caller's authenticated context,
 * never from anything the file claims.
 */
export async function createAssetFromFile(
  ownerId: string,
  businessId: string,
  file: File,
): Promise<Asset> {
  const check = validateAssetFile(file)
  if (!check.ok) {
    throw new Error(check.reason ?? 'This file cannot be uploaded.')
  }

  const { storagePath } = await uploadAsset(businessId, 'assets', file)

  const now = Date.now()
  const data: Omit<Asset, 'id'> = {
    ownerId,
    businessId,
    type: defaultAssetType(file.type),
    name: defaultAssetName(file.name),
    fileName: file.name,
    contentType: file.type,
    sizeBytes: file.size,
    storagePath,
    productId: null,
    description: null,
    tags: [],
    source: 'upload',
    // Uploading to Assets is the owner handing EVA material to work with, so
    // permission defaults on; the card offers the switch-off.
    allowAiUse: true,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }

  try {
    const ref = await addDoc(assetsCollection(), data)
    return { id: ref.id, ...data }
  } catch (error) {
    // Never leave a dangling document; a dangling *file* is the lesser evil.
    try {
      await deleteAsset(storagePath)
    } catch {
      // Best-effort only. The original failure is the one worth reporting.
    }
    throw error
  }
}

export interface AssetMetadataPatch {
  name?: string
  type?: AssetType
  description?: string | null
  tags?: string[]
  productId?: EntityId | null
  allowAiUse?: boolean
}

/** The editable half of an asset. File identity fields are frozen by rules. */
export async function updateAssetMetadata(
  assetId: string,
  patch: AssetMetadataPatch,
): Promise<void> {
  await updateDoc(assetDoc(assetId), { ...patch, updatedAt: Date.now() })
}

/** Archiving is the normal removal; pass `false` to restore. */
export async function archiveAsset(assetId: string, archived = true): Promise<void> {
  await updateDoc(assetDoc(assetId), {
    status: archived ? 'archived' : 'active',
    updatedAt: Date.now(),
  })
}

/**
 * Permanent deletion: the file first, then the document. If the file cannot
 * be deleted the document stays, so nothing ever silently loses its record
 * while the bytes live on. A file that is already gone counts as deleted.
 */
export async function deleteAssetCompletely(asset: Pick<Asset, 'id' | 'storagePath'>): Promise<void> {
  try {
    await deleteAsset(asset.storagePath)
  } catch (error) {
    if (!isStorageObjectMissing(error)) throw error
  }
  await deleteDoc(assetDoc(asset.id))
}

function isStorageObjectMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'storage/object-not-found'
  )
}
