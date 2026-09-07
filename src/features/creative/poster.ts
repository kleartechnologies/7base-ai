import { downloadCreativeImage } from '@/services/ai/ai.client'
import type { AiResult, CreativeImagePayload, DownloadCreativeImageResponse } from '@/services/ai/ai.types'
import { waitForBrandFonts } from '@/features/business/brand/fonts'
import type { Creative } from '@/types'
import { posterDesign, posterInput, type PosterDesign, type PosterInput } from './posterDesign'
import { drawPoster, type PosterBitmap, type PosterImages } from './posterDraw'
import { loadImageElement, loadPosterImages } from './posterImages'
import { posterFileName } from './posterSpec'

/**
 * Poster download: the persisted creative in, a usable PNG out.
 *
 * The download is the *same drawing* as the preview — `drawPoster` on the
 * same design from the same creative — rasterised at full social resolution
 * (1080px) instead of the preview's box. So what the owner downloads is
 * exactly what they saw, in chat and on the Creative page alike, and a text
 * edit re-exports without ever regenerating the image.
 *
 * The direct route needs the Storage bucket to answer with CORS headers so
 * the canvas stays exportable. When it doesn't, the bytes come through the
 * authenticated backend callable and the poster is rebuilt from same-origin
 * blob URLs — the download works either way.
 */

export interface PosterDownloadDeps {
  loadImages?: (paths: {
    imageStoragePath: string | null
    logoStoragePath: string | null
    deviceStoragePath: string | null
  }) => Promise<PosterImages>
  render?: (design: PosterDesign, input: PosterInput, images: PosterImages) => Promise<Blob>
  fetchImageBytes?: (creativeId: string) => Promise<AiResult<DownloadCreativeImageResponse>>
  loadFromUrl?: (url: string) => Promise<PosterBitmap>
  save?: (blob: Blob, fileName: string) => void
}

export async function downloadCreativePoster(
  creative: Creative,
  deps: PosterDownloadDeps = {},
): Promise<void> {
  const loadImages = deps.loadImages ?? loadPosterImages
  const render = deps.render ?? renderPosterBlob
  const fetchImageBytes =
    deps.fetchImageBytes ?? ((creativeId: string) => downloadCreativeImage({ creativeId }))
  const loadFromUrl = deps.loadFromUrl ?? ((url: string) => loadImageElement(url, false))
  const save = deps.save ?? saveBlob

  const input = posterInput(creative)
  const design = posterDesign(input)
  const fileName = posterFileName(input.name, input.format)

  try {
    const images = await loadImages({
      imageStoragePath: input.imageStoragePath,
      logoStoragePath: input.logoStoragePath,
      deviceStoragePath: input.deviceStoragePath,
    })
    save(await render(design, input, images), fileName)
    return
  } catch (error) {
    // A poster without a visual renders entirely locally; its failure is
    // not a cross-origin problem the backend can solve.
    if (!input.imageStoragePath) throw error
    console.warn('[poster] direct download failed, using backend fallback', {
      creativeId: input.creativeId,
      reason: error instanceof Error ? error.message : 'unknown',
    })
  }

  const result = await fetchImageBytes(input.creativeId)
  if (!result.ok) {
    console.warn('[poster] backend image fetch failed', {
      creativeId: input.creativeId,
      code: result.error.code,
    })
    throw new Error('poster download failed')
  }

  const objectUrls: string[] = []
  const asObjectUrl = (payload: CreativeImagePayload): string => {
    const url = base64ToObjectUrl(payload)
    objectUrls.push(url)
    return url
  }

  try {
    const image = result.data.image ? await loadFromUrl(asObjectUrl(result.data.image)) : null
    // The logo appears wherever the creative carries one — same as the preview.
    const logo =
      input.logoStoragePath && result.data.logo
        ? await loadFromUrl(asObjectUrl(result.data.logo)).catch(() => null)
        : null
    // The device layer comes back through the same authenticated door, and
    // is optional in the same way: without it the handset renders empty
    // rather than the download failing.
    const device =
      input.deviceStoragePath && result.data.device
        ? await loadFromUrl(asObjectUrl(result.data.device)).catch(() => null)
        : null
    save(await render(design, input, { image, logo, device }), fileName)
  } finally {
    for (const url of objectUrls) URL.revokeObjectURL(url)
  }
}

function base64ToObjectUrl(payload: CreativeImagePayload): string {
  const binary = atob(payload.base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: payload.contentType }))
}

/** The poster at export resolution, as a PNG blob. */
export async function renderPosterBlob(
  design: PosterDesign,
  input: PosterInput,
  images: PosterImages,
): Promise<Blob> {
  // Approved brand fonts are fetched before rasterising so the canvas does
  // not paint mid-swap. Best-effort with a short cap — a missing font falls
  // back to the system stack, never blocks the download.
  await waitForBrandFonts([input.headingFont, input.bodyFont])
  const canvas = document.createElement('canvas')
  canvas.width = design.width
  canvas.height = design.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  drawPoster(ctx, design, input, images)
  return await new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('canvas export failed'))),
        'image/png',
      )
    } catch (error) {
      // A tainted canvas (image loaded without CORS) throws here.
      reject(error instanceof Error ? error : new Error('canvas export failed'))
    }
  })
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** Clipboard with a fallback for non-secure contexts. True on success. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const copied = document.execCommand('copy')
    area.remove()
    return copied
  } catch {
    return false
  }
}
