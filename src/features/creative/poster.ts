import { downloadCreativeImage } from '@/services/ai/ai.client'
import type { AiResult, CreativeImagePayload, DownloadCreativeImageResponse } from '@/services/ai/ai.types'
import { waitForBrandFonts } from '@/features/business/brand/fonts'
import { posterFileName, posterSpec, wrapLines, type PosterSpec } from './posterSpec'

/**
 * Poster export: structured creative in, usable PNG out.
 *
 * The stored image is a clean visual with no words on it; the words live in
 * the creative's fields. Download composes the two on a canvas at full social
 * resolution (1080px), which is what makes "Download Poster" a real image
 * file rather than a screenshot — and what lets a text edit re-export without
 * ever regenerating the image.
 *
 * Both direct routes — the canvas draw and the raw fetch — need the Storage
 * bucket to answer with CORS headers. When it doesn't (bucket CORS not
 * configured), `downloadCreativePoster` falls back to fetching the bytes
 * through the backend and rebuilding the poster from same-origin blob URLs,
 * so the download works either way and becomes free again the moment the
 * bucket is configured.
 */

export interface PosterContent {
  name: string
  format: 'square_post' | 'portrait_post'
  headline: string | null
  subheadline: string | null
  callToAction: string | null
  offerText: string | null
}

export interface PosterStyleSource {
  palette: string[] | null
  headingFont: string | null
  bodyFont: string | null
  logoStoragePath: string | null
}

export async function downloadPoster(params: {
  content: PosterContent
  style: PosterStyleSource | null
  /** Resolved download URL of the visual, or null for a text-only poster. */
  imageUrl: string | null
  /** Resolved download URL of the business logo snapshot, when one exists. */
  logoUrl?: string | null
}): Promise<void> {
  const fileName = posterFileName(params.content.name, params.content.format)
  try {
    const blob = await renderPosterBlob(params)
    saveBlob(blob, fileName)
  } catch (error) {
    // Canvas failed. A raw fetch of the visual can still succeed when the
    // failure was canvas-specific — but not when the cause is missing CORS,
    // which blocks fetch exactly the same way. That case is handled one
    // level up, in downloadCreativePoster's backend fallback.
    if (!params.imageUrl) throw new Error('poster render failed', { cause: error })
    console.warn('[poster] canvas render failed, trying raw image', {
      imageUrl: sanitizeUrlForLog(params.imageUrl),
      reason: error instanceof Error ? error.message : 'unknown',
    })
    const response = await fetch(params.imageUrl)
    if (!response.ok) throw new Error('poster image fetch failed', { cause: error })
    saveBlob(await response.blob(), fileName)
  }
}

/**
 * "Download Poster", end to end. Tries the direct Storage URLs first — free,
 * and all it needs once the bucket's CORS configuration is applied. When the
 * browser cannot read the image cross-origin, fetches the bytes through the
 * authenticated backend callable and renders the same poster from
 * same-origin blob URLs.
 *
 * The deps parameter exists for tests; callers pass only params.
 */
export async function downloadCreativePoster(
  params: {
    creativeId: string
    content: PosterContent
    style: PosterStyleSource | null
    imageUrl: string | null
    logoUrl?: string | null
  },
  deps: {
    attemptDirect?: typeof downloadPoster
    fetchImageBytes?: (creativeId: string) => Promise<AiResult<DownloadCreativeImageResponse>>
  } = {},
): Promise<void> {
  const attemptDirect = deps.attemptDirect ?? downloadPoster
  const fetchImageBytes =
    deps.fetchImageBytes ?? ((creativeId: string) => downloadCreativeImage({ creativeId }))

  try {
    await attemptDirect(params)
    return
  } catch (error) {
    // A text-only poster renders entirely locally; its failure is not a
    // cross-origin problem the backend can solve.
    if (!params.imageUrl) throw error
    console.warn('[poster] direct download failed, using backend fallback', {
      creativeId: params.creativeId,
      imageUrl: sanitizeUrlForLog(params.imageUrl),
      reason: error instanceof Error ? error.message : 'unknown',
    })
  }

  const result = await fetchImageBytes(params.creativeId)
  if (!result.ok) {
    console.warn('[poster] backend image fetch failed', {
      creativeId: params.creativeId,
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
    const imageUrl = result.data.image ? asObjectUrl(result.data.image) : null
    // The logo only appears where the caller was already compositing one —
    // the chat preview downloads without a logo today and stays that way.
    const logoUrl = params.logoUrl && result.data.logo ? asObjectUrl(result.data.logo) : null
    await attemptDirect({ content: params.content, style: params.style, imageUrl, logoUrl })
  } finally {
    for (const url of objectUrls) URL.revokeObjectURL(url)
  }
}

/** Strips path details and query strings (download tokens) before a URL reaches a log. */
function sanitizeUrlForLog(url: string | null | undefined): string {
  if (!url) return '(none)'
  try {
    return new URL(url).origin
  } catch {
    return '(unparseable)'
  }
}

function base64ToObjectUrl(payload: CreativeImagePayload): string {
  const binary = atob(payload.base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: payload.contentType }))
}

export async function renderPosterBlob(params: {
  content: PosterContent
  style: PosterStyleSource | null
  imageUrl: string | null
  logoUrl?: string | null
}): Promise<Blob> {
  const spec = posterSpec(params.content.format, params.style)
  // Approved brand fonts are fetched before rasterising so the canvas does
  // not paint mid-swap. Best-effort with a short cap — a missing font falls
  // back to the system stack, never blocks the download.
  await waitForBrandFonts([params.style?.headingFont, params.style?.bodyFont])
  const canvas = document.createElement('canvas')
  canvas.width = spec.width
  canvas.height = spec.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')

  const image = params.imageUrl ? await loadImage(params.imageUrl) : null
  // The logo is optional garnish: a failed load costs the logo, not the poster.
  const logo = params.logoUrl ? await loadImage(params.logoUrl).catch(() => null) : null
  drawPoster(ctx, spec, params.content, image, logo)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas export failed'))),
      'image/png',
    )
  })
}

function drawPoster(
  ctx: CanvasRenderingContext2D,
  spec: PosterSpec,
  content: PosterContent,
  image: HTMLImageElement | null,
  logo: HTMLImageElement | null = null,
): void {
  const { width, height, margin } = spec

  // 1. Ground: the visual, cover-fit; a soft dark ground without one.
  if (image) {
    const scale = Math.max(width / image.width, height / image.height)
    const drawWidth = image.width * scale
    const drawHeight = image.height * scale
    ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
  } else {
    ctx.fillStyle = '#20242b'
    ctx.fillRect(0, 0, width, height)
  }

  // 2. Scrim: keeps white text readable over any photo.
  const scrimTop = height * (1 - spec.scrimFraction)
  const gradient = ctx.createLinearGradient(0, scrimTop, 0, height)
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(0.45, 'rgba(0,0,0,0.45)')
  gradient.addColorStop(1, 'rgba(0,0,0,0.78)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, scrimTop, width, height - scrimTop)

  const maxTextWidth = width - margin * 2
  ctx.textBaseline = 'alphabetic'

  // 3. Text stack, laid out bottom-up so the CTA anchors the corner.
  let cursorY = height - margin

  if (content.callToAction) {
    ctx.font = `600 ${spec.ctaSize}px ${spec.bodyFont}`
    const label = content.callToAction
    const paddingX = 36
    const pillHeight = spec.ctaSize + 44
    const pillWidth = Math.min(ctx.measureText(label).width + paddingX * 2, maxTextWidth)
    const pillY = cursorY - pillHeight
    ctx.fillStyle = spec.accent
    drawRoundedRect(ctx, margin, pillY, pillWidth, pillHeight, pillHeight / 2)
    ctx.fillStyle = spec.accentText
    ctx.fillText(label, margin + paddingX, pillY + pillHeight / 2 + spec.ctaSize * 0.36, maxTextWidth - paddingX * 2)
    cursorY = pillY - 44
  }

  if (content.subheadline) {
    ctx.font = `400 ${spec.subheadlineSize}px ${spec.bodyFont}`
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    const lines = wrapLines(content.subheadline, maxTextWidth, (s) => ctx.measureText(s).width, 2)
    for (const line of [...lines].reverse()) {
      ctx.fillText(line, margin, cursorY)
      cursorY -= spec.subheadlineSize * 1.35
    }
    cursorY -= 12
  }

  if (content.headline) {
    ctx.font = `700 ${spec.headlineSize}px ${spec.headingFont}`
    ctx.fillStyle = '#ffffff'
    const lines = wrapLines(content.headline, maxTextWidth, (s) => ctx.measureText(s).width, 3)
    for (const line of [...lines].reverse()) {
      ctx.fillText(line, margin, cursorY)
      cursorY -= spec.headlineSize * 1.14
    }
  }

  // 4. Logo, top-right — the real uploaded mark, composited deterministically
  // (never drawn by an image model). Contained within a fixed box, aspect
  // ratio preserved.
  if (logo && logo.width > 0 && logo.height > 0) {
    const maxLogoWidth = 220
    const maxLogoHeight = 110
    const scale = Math.min(maxLogoWidth / logo.width, maxLogoHeight / logo.height, 1)
    const logoWidth = logo.width * scale
    const logoHeight = logo.height * scale
    ctx.drawImage(logo, width - margin - logoWidth, margin, logoWidth, logoHeight)
  }

  // 5. Offer badge, top-left — separate from the narrative stack.
  if (content.offerText) {
    ctx.font = `600 ${spec.offerSize}px ${spec.bodyFont}`
    const paddingX = 28
    const badgeHeight = spec.offerSize + 36
    const badgeWidth = Math.min(ctx.measureText(content.offerText).width + paddingX * 2, maxTextWidth)
    ctx.fillStyle = spec.accent
    drawRoundedRect(ctx, margin, margin, badgeWidth, badgeHeight, 18)
    ctx.fillStyle = spec.accentText
    ctx.fillText(
      content.offerText,
      margin + paddingX,
      margin + badgeHeight / 2 + spec.offerSize * 0.36,
      maxTextWidth - paddingX * 2,
    )
  }
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
  ctx.fill()
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    // Required for canvas export; the bucket must allow cross-origin reads.
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('poster image failed to load'))
    image.src = url
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
