import { getAssetUrl } from '@/services/storage/storage.service'
import type { PosterBitmap, PosterImages } from './posterDraw'

/**
 * Loads the bitmaps a poster is drawn from — the visual and the logo — by
 * their Storage paths, once per path per session. Every surface that shows
 * a creative asks for the same paths, so the chat card and the Creative
 * page share one decoded image rather than two fetches of it.
 *
 * Cross-origin first (which the bucket's CORS configuration allows, and
 * which keeps the canvas exportable); if that fails the image is loaded
 * plainly so the preview still draws — the download then takes its
 * backend-bytes route instead of exporting a tainted canvas.
 */

const bitmaps = new Map<string, Promise<PosterBitmap>>()

export interface PosterImageDeps {
  resolveUrl?: (storagePath: string) => Promise<string>
  load?: (url: string, crossOrigin: boolean) => Promise<PosterBitmap>
}

export async function loadPosterImages(
  paths: { imageStoragePath: string | null; logoStoragePath: string | null },
  deps: PosterImageDeps = {},
): Promise<PosterImages> {
  const [image, logo] = await Promise.all([
    paths.imageStoragePath ? loadStorageImage(paths.imageStoragePath, deps).catch(() => null) : null,
    paths.logoStoragePath ? loadStorageImage(paths.logoStoragePath, deps).catch(() => null) : null,
  ])
  return { image, logo }
}

export function loadStorageImage(storagePath: string, deps: PosterImageDeps = {}): Promise<PosterBitmap> {
  const cached = bitmaps.get(storagePath)
  if (cached) return cached
  const resolveUrl = deps.resolveUrl ?? getAssetUrl
  const load = deps.load ?? loadImageElement
  const pending = resolveUrl(storagePath).then(async (url) => {
    try {
      return await load(url, true)
    } catch {
      return await load(url, false)
    }
  })
  bitmaps.set(storagePath, pending)
  pending.catch(() => bitmaps.delete(storagePath))
  return pending
}

/** For tests and for a changed file behind the same path. */
export function forgetPosterImage(storagePath: string): void {
  bitmaps.delete(storagePath)
}

export function loadImageElement(url: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    if (crossOrigin) image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('poster image failed to load'))
    image.src = url
  })
}
