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
 * If the canvas route fails (usually the Storage bucket missing a CORS rule
 * in a new environment), the raw image alone is downloaded instead — a
 * degraded poster beats no poster.
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
}): Promise<void> {
  const fileName = posterFileName(params.content.name, params.content.format)
  try {
    const blob = await renderPosterBlob(params)
    saveBlob(blob, fileName)
  } catch {
    // Canvas failed (image CORS, most likely). Fall back to the raw visual.
    if (!params.imageUrl) throw new Error('poster render failed')
    const response = await fetch(params.imageUrl)
    if (!response.ok) throw new Error('poster image fetch failed')
    saveBlob(await response.blob(), fileName)
  }
}

export async function renderPosterBlob(params: {
  content: PosterContent
  style: PosterStyleSource | null
  imageUrl: string | null
}): Promise<Blob> {
  const spec = posterSpec(params.content.format, params.style)
  const canvas = document.createElement('canvas')
  canvas.width = spec.width
  canvas.height = spec.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')

  const image = params.imageUrl ? await loadImage(params.imageUrl) : null
  drawPoster(ctx, spec, params.content, image)

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

  // 4. Offer badge, top-left — separate from the narrative stack.
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
