import { COLLECTIONS, db, storageBucket } from '../../lib/firebase'
import { isPathWithinBusiness } from '../../lib/storagePaths'
import { assetIneligibility, type StoredAsset } from '../../creative/assets'
import { fetchSourceImage, IMAGE_MIME_TYPES, MAX_IMAGE_BYTES } from '../website/fetchImage'
import type { VisualCandidate, VisualEvidence } from './evidence'

/**
 * Turns the selected visual candidates into bytes the model may see
 * (Phase 7E). Two paths, both server-only:
 *
 *  - an Asset: re-read from Firestore, ownership/business/status/AI-use
 *    re-verified (the same `assetIneligibility` creative generation uses),
 *    path containment re-checked, bytes downloaded from our own bucket and
 *    size-capped — the chat-attachment discipline, applied to Assets.
 *  - a page image: a URL an approved source fetch exposed, through the
 *    SSRF-guarded `fetchSourceImage`.
 *
 * Anything that fails is dropped silently. The model only ever sees images
 * that passed, numbered img1… in selection order, and refers to them by
 * that id alone.
 */

/** Asset bytes above this stay in Storage. Same ceiling as chat attachments. */
export const MAX_ASSET_VISUAL_BYTES = 8 * 1024 * 1024

export interface VisualResolveDeps {
  getAsset: (assetId: string) => Promise<StoredAsset | null>
  downloadBytes: (storagePath: string) => Promise<Buffer>
  fetchImage: (url: string) => Promise<{ contentType: string; dataUrl: string } | null>
}

const defaultDeps: VisualResolveDeps = {
  async getAsset(assetId) {
    const snapshot = await db.collection(COLLECTIONS.assets).doc(assetId).get()
    return snapshot.exists ? (snapshot.data() as StoredAsset) : null
  },
  async downloadBytes(storagePath) {
    const [bytes] = await storageBucket().file(storagePath).download()
    return bytes
  },
  fetchImage: fetchSourceImage,
}

export async function resolveVisualEvidence(
  params: { candidates: VisualCandidate[]; businessId: string; ownerId: string },
  deps: VisualResolveDeps = defaultDeps,
): Promise<VisualEvidence[]> {
  const resolved: VisualEvidence[] = []

  for (const candidate of params.candidates) {
    const image =
      candidate.sourceType === 'asset'
        ? await resolveAssetImage(candidate, params, deps)
        : await resolvePageImage(candidate, deps)
    if (!image) continue
    resolved.push({ ...candidate, id: `img${resolved.length + 1}`, ...image })
  }

  return resolved
}

async function resolveAssetImage(
  candidate: VisualCandidate,
  scope: { businessId: string; ownerId: string },
  deps: VisualResolveDeps,
): Promise<{ contentType: string; dataUrl: string } | null> {
  if (!candidate.assetId) return null
  let asset: StoredAsset | null
  try {
    asset = await deps.getAsset(candidate.assetId)
  } catch {
    return null
  }
  if (!asset || assetIneligibility(asset, scope) !== null) return null
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(asset.contentType)) return null
  if (asset.sizeBytes > MAX_ASSET_VISUAL_BYTES) return null
  if (!isPathWithinBusiness(asset.storagePath, scope.businessId)) return null

  let bytes: Buffer
  try {
    bytes = await deps.downloadBytes(asset.storagePath)
  } catch {
    return null
  }
  if (bytes.length === 0 || bytes.length > MAX_ASSET_VISUAL_BYTES) return null

  return {
    contentType: asset.contentType,
    dataUrl: `data:${asset.contentType};base64,${bytes.toString('base64')}`,
  }
}

async function resolvePageImage(
  candidate: VisualCandidate,
  deps: VisualResolveDeps,
): Promise<{ contentType: string; dataUrl: string } | null> {
  const image = await deps.fetchImage(candidate.ref)
  if (!image) return null
  // Belt and braces: the fetcher already refuses other types and sizes.
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(image.contentType)) return null
  if (image.dataUrl.length > MAX_IMAGE_BYTES * 1.4) return null
  return image
}
