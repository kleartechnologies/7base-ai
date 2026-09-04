import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { requireBusinessOwner, requireUid } from '../lib/auth'
import { internal, invalidArgument, permissionDenied } from '../lib/errors'
import { storageBucket } from '../lib/firebase'
import type {
  CreativeImagePayload,
  DownloadCreativeImageRequest,
  DownloadCreativeImageResponse,
} from '../lib/types'
import { getStoredCreative } from './store'
import type { StoredCreative } from './store'

/**
 * Poster download fallback: returns the creative's image (and logo) bytes to
 * the owner, base64-encoded, so the browser can rebuild the poster from
 * same-origin blob URLs when it cannot read Storage cross-origin.
 *
 * This is a read of the caller's own data through an authenticated door — the
 * bucket stays private, rules stay intact, and nothing here mints a URL that
 * outlives the response. The client tries the direct Storage URL first; this
 * callable is only the fallback, so applying the bucket's CORS configuration
 * (README, `gsutil cors set`) makes this path cost nothing again.
 */

/**
 * Uploads are capped at 20MB by Storage rules, but a callable response is
 * JSON and base64 inflates by a third — cap what we return so the response
 * stays comfortably inside the HTTPS limit.
 */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024

const DOWNLOAD_FAILED_MESSAGE =
  'The poster image could not be read. Please try again.'

/** The only content types a poster image can legitimately be. */
const ALLOWED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export interface DownloadImageDeps {
  getCreative: (creativeId: string) => Promise<StoredCreative | null>
  requireBusinessOwner: (
    businessId: string,
    uid: string,
  ) => Promise<FirebaseFirestore.DocumentData | null>
  /** Null when the object does not exist. */
  readFile: (storagePath: string) => Promise<{ bytes: Buffer; contentType: string } | null>
}

const defaultDeps: DownloadImageDeps = {
  getCreative: getStoredCreative,
  requireBusinessOwner,
  async readFile(storagePath) {
    const file = storageBucket().file(storagePath)
    const [exists] = await file.exists()
    if (!exists) return null
    const [metadata] = await file.getMetadata()
    const size = Number(metadata.size ?? 0)
    if (size > MAX_IMAGE_BYTES) {
      throw new Error(`object too large: ${size} bytes`)
    }
    const [bytes] = await file.download()
    return { bytes, contentType: String(metadata.contentType ?? 'image/png') }
  },
}

function toPayload(read: { bytes: Buffer; contentType: string }): CreativeImagePayload {
  const contentType = ALLOWED_CONTENT_TYPES.has(read.contentType)
    ? read.contentType
    : 'image/png'
  return { contentType, base64: read.bytes.toString('base64') }
}

/**
 * The callable's logic, separated so tests drive it with plain fakes.
 *
 * Nothing from the client is trusted beyond the creative id: the creative
 * must be the caller's, the business must be the caller's, and only paths
 * under that business's own storage prefix are ever read — the recorded
 * paths are server-written, but the prefix check makes tampering moot.
 */
export async function performDownloadCreativeImage(
  params: { uid: string; creativeId: string },
  deps: DownloadImageDeps = defaultDeps,
): Promise<DownloadCreativeImageResponse> {
  const { uid, creativeId } = params

  const creative = await deps.getCreative(creativeId)
  // Missing and foreign answer the same way.
  if (!creative || creative.ownerId !== uid) throw permissionDenied()

  const business = await deps.requireBusinessOwner(creative.businessId, uid)
  if (!business) throw permissionDenied()

  const prefix = `businesses/${creative.businessId}/`

  const imagePath = creative.content?.image?.storagePath ?? null
  const logoPath = creative.style?.logoStoragePath ?? null

  let image: CreativeImagePayload | null = null
  if (imagePath) {
    if (!imagePath.startsWith(prefix)) {
      // Server-written paths always carry this prefix; anything else is not ours to serve.
      logger.warn('creative.download.path_outside_business', { creativeId })
      throw permissionDenied()
    }
    let read: { bytes: Buffer; contentType: string } | null
    try {
      read = await deps.readFile(imagePath)
    } catch (error) {
      logger.warn('creative.download.image_read_failed', {
        creativeId,
        reason: error instanceof Error ? error.message : 'unknown',
      })
      throw new HttpsError('failed-precondition', DOWNLOAD_FAILED_MESSAGE)
    }
    if (!read) {
      // The creative says it has an image but the object is gone. Failing is
      // more honest than silently downloading a text-only poster that does
      // not match what the user is looking at.
      logger.warn('creative.download.image_missing', { creativeId })
      throw new HttpsError('failed-precondition', DOWNLOAD_FAILED_MESSAGE)
    }
    image = toPayload(read)
  }

  // The logo is optional on the poster, so its failures degrade instead of
  // failing the download.
  let logo: CreativeImagePayload | null = null
  if (logoPath && logoPath.startsWith(prefix)) {
    try {
      const read = await deps.readFile(logoPath)
      if (read) logo = toPayload(read)
    } catch (error) {
      logger.warn('creative.download.logo_read_failed', {
        creativeId,
        reason: error instanceof Error ? error.message : 'unknown',
      })
    }
  }

  logger.info('creative.download.served', {
    creativeId,
    hasImage: image !== null,
    hasLogo: logo !== null,
    imageBytes: image ? Math.round((image.base64.length * 3) / 4) : 0,
  })

  return { image, logo }
}

export const creativeDownloadImage = onCall(
  {
    region: 'asia-southeast1',
    // Two Storage reads at most; no model call, no secret.
    timeoutSeconds: 60,
    memory: '512MiB',
    maxInstances: 10,
    cors: true,
  },
  async (
    request: CallableRequest<DownloadCreativeImageRequest>,
  ): Promise<DownloadCreativeImageResponse> => {
    const uid = requireUid(request)
    const { creativeId } = request.data ?? {}

    if (!creativeId || typeof creativeId !== 'string') {
      throw invalidArgument('A creativeId is required.')
    }

    try {
      return await performDownloadCreativeImage({ uid, creativeId })
    } catch (error) {
      if (error instanceof HttpsError) throw error
      throw internal('creativeDownloadImage', error)
    }
  },
)
