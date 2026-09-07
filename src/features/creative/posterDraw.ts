import {
  emphasisOn,
  mixHex,
  readableOn,
  withAlpha,
  type PosterDesign,
  type PosterInput,
} from './posterDesign'
import { wrapLines } from './posterSpec'

/**
 * The poster renderer (Phase 7G): executes a `PosterDesign` on a 2D canvas.
 *
 * Coordinates are poster pixels (1080 wide); callers scale the context for
 * previews and leave it at 1:1 for the download, so the two are the same
 * drawing. Nothing here decides *what* to draw — that is `posterDesign` —
 * only how. The logo is always the owner's real file, drawn as-is with its
 * aspect ratio kept; no layout ever redraws or restyles it.
 */

export type PosterBitmap = HTMLImageElement | ImageBitmap

export interface PosterImages {
  image: PosterBitmap | null
  logo: PosterBitmap | null
}

interface TextStyle {
  font: string
  size: number
  weight: number
  color: string
  lineHeight: number
  /** In em; negative tightens display type. */
  tracking: number
}

type StackItem =
  | { kind: 'text'; lines: string[]; style: TextStyle; height: number; gapAfter: number }
  | {
      kind: 'chip'
      label: string
      style: TextStyle
      fill: string | null
      height: number
      width: number
      gapAfter: number
    }
  | {
      kind: 'button'
      label: string
      style: TextStyle
      fill: string
      variant: CtaVariant
      height: number
      width: number
      gapAfter: number
    }

/**
 * How the call to action is drawn. A solid button on a photograph or a
 * neutral ground is the natural emphasis; on a panel that is already the
 * brand colour a second solid shape reads as a sticker, so the outline
 * carries the same weight without fighting the headline.
 */
type CtaVariant = 'solid' | 'outline'

const LOGO_MAX_WIDTH = 220
const LOGO_MAX_HEIGHT = 92
/** Breathing room between the logo and the edge of its lockup plate. */
const LOGO_PLATE_PAD = 18

/** The share of the poster the showcase card is guaranteed, and keeps. */
const MIN_SHOWCASE_CARD = 0.38
/** The most of the poster the promo panel may take; the photo keeps the rest. */
const PROMO_PANEL_MAX = 0.44

export function drawPoster(
  ctx: CanvasRenderingContext2D,
  design: PosterDesign,
  input: PosterInput,
  images: PosterImages,
): void {
  ctx.save()
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  switch (design.layout) {
    case 'showcase':
      drawShowcase(ctx, design, input, images)
      break
    case 'promo':
      drawPromo(ctx, design, input, images)
      break
    case 'minimal':
      drawMinimal(ctx, design, input, images)
      break
    case 'typographic':
      drawTypographic(ctx, design, input, images)
      break
    case 'editorial':
    default:
      drawEditorial(ctx, design, input, images)
      break
  }
  ctx.restore()
}

/* --- layouts ------------------------------------------------------------------ */

/** Full-bleed photo, message bottom-left over a soft scrim. */
function drawEditorial(
  ctx: CanvasRenderingContext2D,
  design: PosterDesign,
  input: PosterInput,
  images: PosterImages,
) {
  const { width, height, margin, palette } = design
  if (images.image) drawCover(ctx, images.image, 0, 0, width, height, 'center')
  else fillRect(ctx, 0, 0, width, height, palette.dark)

  const ctaFill = emphasisOn(palette.dark, palette.accent, '#ffffff')
  const items = fitStack(ctx, design, input, {
    maxWidth: width * 0.84,
    available: height * 0.5,
    eyebrow: { color: readableOn(palette.accent), fill: palette.accent },
    headline: '#ffffff',
    supporting: 'rgba(255,255,255,0.9)',
    cta: { fill: ctaFill, color: readableOn(ctaFill) },
  })
  const total = stackHeight(items)
  const top = height - margin - total

  // A gentle lift at the top for the logo, and below it a scrim measured to
  // the message rather than to half the poster: dark enough for white type
  // wherever the photograph happens to be bright, and the picture left
  // alone above it.
  fillGradient(ctx, 0, 0, width, height * 0.22, [
    [0, 'rgba(0,0,0,0.24)'],
    [1, 'rgba(0,0,0,0)'],
  ])
  const scrimTop = Math.min(height * 0.34, top - 140)
  fillGradient(ctx, 0, scrimTop, width, height - scrimTop, [
    [0, 'rgba(0,0,0,0)'],
    [0.34, 'rgba(0,0,0,0.54)'],
    [1, 'rgba(0,0,0,0.88)'],
  ])

  drawLogo(ctx, images.logo, margin, margin, palette.paper)
  drawStack(ctx, items, margin, top)
}

/** A neutral ground with the product/app shot presented as a card. */
function drawShowcase(
  ctx: CanvasRenderingContext2D,
  design: PosterDesign,
  input: PosterInput,
  images: PosterImages,
) {
  const { width, height, margin, palette } = design
  const darkGround = input.direction === 'hero_product'
  const ground = darkGround ? palette.dark : mixHex(palette.paper, palette.accent, 0.04)
  fillRect(ctx, 0, 0, width, height, ground)

  // A soft brand-coloured light for depth; the colour is felt, not poured.
  // A hard-edged disc at low alpha goes muddy over a dark ground and reads
  // as a stray shape behind the headline — a radial falloff reads as light.
  ctx.save()
  const glow = ctx.createRadialGradient(width * 0.98, height * 0.06, 0, width * 0.98, height * 0.06, width * 0.72)
  glow.addColorStop(0, withAlpha(palette.accent, darkGround ? 0.34 : 0.16))
  glow.addColorStop(1, withAlpha(palette.accent, 0))
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, width, height)
  ctx.restore()

  const logoPlate = darkGround ? palette.paper : null
  drawLogo(ctx, images.logo, margin, margin, logoPlate)

  const ink = darkGround ? '#ffffff' : palette.ink
  const inkSoft = darkGround ? 'rgba(255,255,255,0.78)' : palette.inkSoft
  const emphasis = emphasisOn(ground, palette.accent, ink)
  const ctaFill = emphasisOn(ground, palette.accent, darkGround ? '#ffffff' : palette.ink)

  const image = images.image
  const portraitImage = image !== null && image.height > image.width * 1.2
  const sideBySide = portraitImage && input.format === 'square_post'
  const top = margin + logoBlockHeight(logoPlate) + 48

  if (sideBySide && image) {
    // Text left, the tall shot standing on the right and running off the
    // bottom edge — the natural frame for an app screenshot.
    const cardWidth = width * 0.4
    const cardX = width - margin - cardWidth
    const textWidth = cardX - margin - 56
    const items = fitStack(ctx, design, input, {
      maxWidth: textWidth,
      available: height - top - margin,
      eyebrow: { color: emphasis, fill: withAlpha(palette.accent, darkGround ? 0.22 : 0.12) },
      headline: ink,
      supporting: inkSoft,
      cta: { fill: ctaFill, color: readableOn(ctaFill) },
      headlineScale: 0.82,
    })
    const total = stackHeight(items)
    const textTop = Math.max(top, (height - total) / 2)
    drawStack(ctx, items, margin, textTop)
    drawCard(ctx, image, cardX, top, cardWidth, height - top - margin, 'top', darkGround)
    return
  }

  // Stacked: the message up top, the shot as a card standing on the lower
  // half. The card is budgeted first so it always lands whole inside the
  // poster — a card clipped by the bottom edge looks like a mistake, not a
  // bleed — and the message is fitted to the room that leaves.
  const cardHeight = Math.round(height * MIN_SHOWCASE_CARD)
  const gap = 56
  const items = fitStack(ctx, design, input, {
    maxWidth: width * 0.86,
    available: height - margin - top - cardHeight - gap,
    eyebrow: { color: emphasis, fill: withAlpha(palette.accent, darkGround ? 0.22 : 0.12) },
    headline: ink,
    supporting: inkSoft,
    cta: { fill: ctaFill, color: readableOn(ctaFill) },
  })
  drawStack(ctx, items, margin, top)
  const cardTop = Math.max(top + stackHeight(items) + gap, height - margin - cardHeight)
  if (image) {
    drawCard(
      ctx,
      image,
      margin,
      cardTop,
      width - margin * 2,
      height - margin - cardTop,
      portraitImage ? 'top' : 'center',
      darkGround,
    )
  }
}


/** Photo above, the message on a brand-colour panel sized to hold it. */
function drawPromo(
  ctx: CanvasRenderingContext2D,
  design: PosterDesign,
  input: PosterInput,
  images: PosterImages,
) {
  const { width, height, margin, palette } = design
  const panel = palette.accent
  const panelText = palette.accentText
  const ctaFill = panelText

  // The headline is the hero here as it is everywhere else, and the offer
  // is the small tag above it. Promoting something is not a reason to
  // print "Weekday sets" three times the size of "Beat The Lunch Rush".
  const items = fitStack(ctx, design, input, {
    maxWidth: width - margin * 2,
    available: height * PROMO_PANEL_MAX - margin * 1.6,
    eyebrow: { color: panelText, fill: withAlpha(panelText, 0.18) },
    headline: panelText,
    supporting: withAlpha(panelText, 0.88),
    cta: { fill: ctaFill, color: readableOn(ctaFill), variant: 'outline' },
    headlineWeight: 800,
  })
  const total = stackHeight(items)

  // The panel is sized to the message, not the message to a fixed panel: a
  // half-poster slab of flat colour swallows the photograph and leaves a
  // void above the type. The brand colour emphasises; it is not the poster.
  const panelHeight = Math.round(
    Math.min(height * PROMO_PANEL_MAX, Math.max(height * 0.3, total + margin * 1.6)),
  )
  const photoHeight = height - panelHeight

  if (images.image) drawCover(ctx, images.image, 0, 0, width, photoHeight, 'center')
  else fillRect(ctx, 0, 0, width, photoHeight, palette.dark)
  fillGradient(ctx, 0, 0, width, photoHeight * 0.3, [
    [0, 'rgba(0,0,0,0.26)'],
    [1, 'rgba(0,0,0,0)'],
  ])
  fillRect(ctx, 0, photoHeight, width, panelHeight, panel)
  drawLogo(ctx, images.logo, margin, margin, palette.paper)

  drawStack(ctx, items, margin, photoHeight + (panelHeight - total) / 2)
}


/** The photo framed in whitespace, quiet type beneath. */
function drawMinimal(
  ctx: CanvasRenderingContext2D,
  design: PosterDesign,
  input: PosterInput,
  images: PosterImages,
) {
  const { width, height, margin, palette } = design
  const ground = mixHex(palette.paper, palette.accent, 0.03)
  fillRect(ctx, 0, 0, width, height, ground)
  drawLogo(ctx, images.logo, margin, margin, null)

  const frameTop = margin + LOGO_MAX_HEIGHT + 36
  const frameHeight = Math.round(height * (input.format === 'portrait_post' ? 0.5 : 0.46))
  if (images.image) {
    drawRounded(ctx, margin, frameTop, width - margin * 2, frameHeight, 22, () =>
      drawCover(ctx, images.image as PosterBitmap, margin, frameTop, width - margin * 2, frameHeight, 'center'),
    )
  }

  const emphasis = emphasisOn(ground, palette.accent, palette.ink)
  const ctaFill = emphasisOn(ground, palette.accent, palette.ink)
  const textTop = frameTop + frameHeight + 52
  const items = fitStack(ctx, design, input, {
    maxWidth: width - margin * 2,
    available: height - textTop - margin,
    eyebrow: { color: emphasis, fill: null, uppercase: true },
    headline: palette.ink,
    supporting: palette.inkSoft,
    cta: { fill: ctaFill, color: readableOn(ctaFill), compact: true },
    headlineScale: 0.86,
  })
  drawStack(ctx, items, margin, textTop)
}

/** No visual: the brand colour (or a dark ground) carries the message. */
function drawTypographic(
  ctx: CanvasRenderingContext2D,
  design: PosterDesign,
  input: PosterInput,
  images: PosterImages,
) {
  const { width, height, margin, palette } = design
  const ground = palette.accentFromBrand ? palette.accent : palette.dark
  const text = readableOn(ground)
  fillRect(ctx, 0, 0, width, height, ground)
  ctx.save()
  ctx.fillStyle = withAlpha(text, 0.08)
  ctx.beginPath()
  ctx.arc(width * 0.86, height * 0.84, width * 0.42, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  const logoPlate = text === '#ffffff' ? palette.paper : null
  drawLogo(ctx, images.logo, margin, margin, logoPlate)

  const items = fitStack(ctx, design, input, {
    maxWidth: width * 0.84,
    available: height - margin * 2 - logoBlockHeight(logoPlate) - 40,
    eyebrow: { color: text, fill: withAlpha(text, 0.14) },
    headline: text,
    supporting: withAlpha(text, 0.84),
    cta: { fill: text, color: readableOn(text) },
    headlineScale: 1.08,
  })
  const total = stackHeight(items)
  drawStack(ctx, items, margin, height - margin - total)
}

/* --- the message stack ------------------------------------------------------ */

interface StackOptions {
  maxWidth: number
  /** Vertical room the stack must fit in; sizes step down until it does. */
  available: number
  eyebrow: { color: string; fill: string | null; uppercase?: boolean }
  headline: string
  supporting: string
  cta: { fill: string; color: string; compact?: boolean; variant?: CtaVariant }
  headlineScale?: number
  headlineWeight?: number
}

/**
 * Eyebrow (offer) → headline → supporting line → call to action, measured
 * at the design's sizes and stepped down together until the stack fits the
 * room it has. Copy limits keep this from ever needing much stepping; the
 * loop is what stops a long line from running off the poster.
 */
function fitStack(
  ctx: CanvasRenderingContext2D,
  design: PosterDesign,
  input: PosterInput,
  options: StackOptions,
): StackItem[] {
  let items: StackItem[] = []
  for (const scale of [1, 0.92, 0.84, 0.76, 0.68, 0.6]) {
    items = buildStack(ctx, design, input, options, scale)
    if (stackHeight(items) <= options.available) return items
  }
  return items
}

function buildStack(
  ctx: CanvasRenderingContext2D,
  design: PosterDesign,
  input: PosterInput,
  options: StackOptions,
  scale: number,
): StackItem[] {
  const items: StackItem[] = []
  const measure = (text: string) => ctx.measureText(text).width

  if (input.offerText) {
    const style: TextStyle = {
      font: design.bodyFont,
      size: Math.round(design.eyebrowSize * scale),
      weight: 600,
      color: options.eyebrow.color,
      lineHeight: 1.2,
      tracking: options.eyebrow.uppercase ? 0.08 : 0.01,
    }
    const label = options.eyebrow.uppercase ? input.offerText.toUpperCase() : input.offerText
    applyFont(ctx, style)
    const padX = options.eyebrow.fill ? 20 : 0
    const chipWidth = Math.min(measure(label) + padX * 2, options.maxWidth)
    items.push({
      kind: 'chip',
      label,
      style,
      fill: options.eyebrow.fill,
      width: chipWidth,
      height: style.size + (options.eyebrow.fill ? 24 : 6),
      gapAfter: 26 * scale,
    })
  }

  if (input.headline) {
    const style: TextStyle = {
      font: design.headingFont,
      size: Math.round(design.headlineSize * (options.headlineScale ?? 1) * scale),
      weight: options.headlineWeight ?? 700,
      color: options.headline,
      lineHeight: 1.08,
      tracking: -0.02,
    }
    applyFont(ctx, style)
    const lines = wrapLines(input.headline, options.maxWidth, measure, 3)
    items.push({
      kind: 'text',
      lines,
      style,
      height: lines.length * style.size * style.lineHeight,
      gapAfter: 22 * scale,
    })
  }

  if (input.subheadline) {
    const style: TextStyle = {
      font: design.bodyFont,
      size: Math.round(design.supportingSize * scale),
      weight: 400,
      color: options.supporting,
      lineHeight: 1.36,
      tracking: 0,
    }
    applyFont(ctx, style)
    const lines = wrapLines(input.subheadline, options.maxWidth * 0.92, measure, 2)
    items.push({
      kind: 'text',
      lines,
      style,
      height: lines.length * style.size * style.lineHeight,
      gapAfter: 40 * scale,
    })
  }

  if (input.callToAction) {
    const variant = options.cta.variant ?? 'solid'
    const style: TextStyle = {
      font: design.bodyFont,
      size: Math.round(design.ctaSize * scale),
      weight: 600,
      // An outlined button writes in the colour it is drawn in.
      color: variant === 'outline' ? options.cta.fill : options.cta.color,
      lineHeight: 1,
      tracking: 0,
    }
    applyFont(ctx, style)
    const padX = options.cta.compact ? 32 : 38
    const labelWidth = Math.min(measure(input.callToAction), options.maxWidth - padX * 2)
    items.push({
      kind: 'button',
      label: input.callToAction,
      style,
      fill: options.cta.fill,
      variant,
      width: labelWidth + padX * 2,
      height: style.size + (options.cta.compact ? 34 : 42),
      gapAfter: 0,
    })
  }

  if (items.length > 0) items[items.length - 1]!.gapAfter = 0
  return items
}

function stackHeight(items: StackItem[]): number {
  return items.reduce((sum, item) => sum + item.height + item.gapAfter, 0)
}

function drawStack(ctx: CanvasRenderingContext2D, items: StackItem[], x: number, top: number) {
  let y = top
  for (const item of items) {
    switch (item.kind) {
      case 'text': {
        applyFont(ctx, item.style)
        ctx.fillStyle = item.style.color
        const step = item.style.size * item.style.lineHeight
        // Baseline sits ~80% down the line box for Latin type.
        let baseline = y + item.style.size * 0.8 + (step - item.style.size) / 2
        for (const line of item.lines) {
          ctx.fillText(line, x, baseline)
          baseline += step
        }
        break
      }
      case 'chip': {
        applyFont(ctx, item.style)
        if (item.fill) {
          ctx.fillStyle = item.fill
          roundedRectPath(ctx, x, y, item.width, item.height, 10)
          ctx.fill()
        }
        ctx.fillStyle = item.style.color
        const padX = item.fill ? 20 : 0
        ctx.fillText(item.label, x + padX, y + item.height / 2 + item.style.size * 0.36, item.width - padX * 2)
        break
      }
      case 'button': {
        applyFont(ctx, item.style)
        roundedRectPath(ctx, x, y, item.width, item.height, 14)
        if (item.variant === 'outline') {
          ctx.strokeStyle = item.fill
          ctx.lineWidth = 3
          ctx.stroke()
        } else {
          ctx.fillStyle = item.fill
          ctx.fill()
        }
        ctx.fillStyle = item.style.color
        const padX = (item.width - Math.min(ctx.measureText(item.label).width, item.width)) / 2
        ctx.fillText(
          item.label,
          x + padX,
          y + item.height / 2 + item.style.size * 0.36,
          item.width - padX * 2,
        )
        break
      }
    }
    y += item.height + item.gapAfter
  }
}

/* --- primitives ----------------------------------------------------------------- */

function applyFont(ctx: CanvasRenderingContext2D, style: TextStyle) {
  ctx.font = `${style.weight} ${style.size}px ${style.font}`
  const spacing = `${(style.tracking * style.size).toFixed(2)}px`
  const withSpacing = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  if ('letterSpacing' in withSpacing) withSpacing.letterSpacing = spacing
}

function fillRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color
  ctx.fillRect(x, y, w, h)
}

function fillGradient(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  stops: [number, string][],
) {
  const gradient = ctx.createLinearGradient(0, y, 0, y + h)
  for (const [offset, color] of stops) gradient.addColorStop(offset, color)
  ctx.fillStyle = gradient
  ctx.fillRect(x, y, w, h)
}

/** Cover-fit an image into a box, cropping toward the centre or the top. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  image: PosterBitmap,
  x: number,
  y: number,
  w: number,
  h: number,
  focus: 'center' | 'top',
) {
  if (image.width <= 0 || image.height <= 0) return
  const scale = Math.max(w / image.width, h / image.height)
  const drawWidth = image.width * scale
  const drawHeight = image.height * scale
  const dx = x + (w - drawWidth) / 2
  const dy = focus === 'top' ? y : y + (h - drawHeight) / 2
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.drawImage(image, dx, dy, drawWidth, drawHeight)
  ctx.restore()
}

/** A photo card: rounded, shadowed, cover-fit. */
function drawCard(
  ctx: CanvasRenderingContext2D,
  image: PosterBitmap,
  x: number,
  y: number,
  w: number,
  h: number,
  focus: 'center' | 'top',
  onDark: boolean,
) {
  const radius = 30
  ctx.save()
  ctx.shadowColor = onDark ? 'rgba(0,0,0,0.55)' : 'rgba(20,22,28,0.22)'
  ctx.shadowBlur = 48
  ctx.shadowOffsetY = 22
  ctx.fillStyle = onDark ? '#1d2027' : '#ffffff'
  roundedRectPath(ctx, x, y, w, h, radius)
  ctx.fill()
  ctx.restore()
  drawRounded(ctx, x, y, w, h, radius, () => drawCover(ctx, image, x, y, w, h, focus))
  ctx.save()
  ctx.strokeStyle = onDark ? 'rgba(255,255,255,0.08)' : 'rgba(20,22,28,0.08)'
  ctx.lineWidth = 2
  roundedRectPath(ctx, x + 1, y + 1, w - 2, h - 2, radius - 1)
  ctx.stroke()
  ctx.restore()
}

function drawRounded(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  paint: () => void,
) {
  ctx.save()
  roundedRectPath(ctx, x, y, w, h, radius)
  ctx.clip()
  paint()
  ctx.restore()
}

/**
 * The real logo, contained in a fixed box with its aspect ratio kept —
 * composited deterministically, never drawn by a model.
 *
 * Over a photograph or a dark ground the logo can land on anything, and an
 * owner's dark wordmark simply disappears into it. `plate` paints a small
 * lockup card behind it first, which is how a real brand sits on
 * photography: legible whatever the picture turns out to be.
 */
function drawLogo(
  ctx: CanvasRenderingContext2D,
  logo: PosterBitmap | null,
  x: number,
  y: number,
  plate: string | null,
) {
  if (!logo || logo.width <= 0 || logo.height <= 0) return
  const scale = Math.min(LOGO_MAX_WIDTH / logo.width, LOGO_MAX_HEIGHT / logo.height, 1.5)
  const width = logo.width * scale
  const height = logo.height * scale
  const inset = plate ? LOGO_PLATE_PAD : 0
  if (plate) {
    ctx.save()
    ctx.fillStyle = plate
    roundedRectPath(ctx, x, y, width + inset * 2, height + inset * 2, 14)
    ctx.fill()
    ctx.restore()
  }
  ctx.drawImage(logo, x + inset, y + inset, width, height)
}

/** The vertical room the logo lockup takes at the top of a poster. */
function logoBlockHeight(plate: string | null): number {
  return LOGO_MAX_HEIGHT + (plate ? LOGO_PLATE_PAD * 2 : 0)
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}
