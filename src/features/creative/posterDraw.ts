import type { PosterCtaStyle } from '@/types'
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
 * The poster renderer (Phase 7G, rebuilt in 7G.1): executes a `PosterDesign`
 * on a 2D canvas.
 *
 * Coordinates are poster pixels (1080 wide); callers scale the context for
 * previews and leave it at 1:1 for the download, so the two are the same
 * drawing. Nothing here decides *what* to draw — that is `posterDesign` —
 * only how. The logo is always the owner's real file, drawn as-is with its
 * aspect ratio kept; no layout ever redraws or restyles it.
 *
 * The rule that keeps these from collapsing back into one template: each
 * layout puts the message somewhere the *photograph was briefed to leave
 * empty*. The image model was told where the subject goes and where the
 * quiet is; here we type into the quiet. That is why there are six of these
 * and not one with parameters.
 */

export type PosterBitmap = HTMLImageElement | ImageBitmap

export interface PosterImages {
  image: PosterBitmap | null
  logo: PosterBitmap | null
  /** The owner's real screen, stood in the phone in the generated scene. */
  device?: PosterBitmap | null
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
  | {
      kind: 'text'
      role: 'headline' | 'supporting'
      lines: string[]
      /** False when wrapping ran out of lines and lost words. */
      complete: boolean
      style: TextStyle
      /** One word lifted into the brand colour, on the line that ends with it. */
      emphasis: { word: string; color: string } | null
      height: number
      gapAfter: number
    }
  | {
      kind: 'chip'
      label: string
      style: TextStyle
      fill: string | null
      /** A brand-colour bar down the leading edge, for the 'rule' treatment. */
      rule: string | null
      height: number
      width: number
      gapAfter: number
    }
  | {
      kind: 'button'
      label: string
      style: TextStyle
      fill: string
      variant: PosterCtaStyle
      height: number
      width: number
      gapAfter: number
    }

const LOGO_MAX_WIDTH = 236
const LOGO_MAX_HEIGHT = 96
/** Breathing room between the logo and the edge of its lockup plate. */
const LOGO_PLATE_PAD = 16

/**
 * How a logo is set down. `auto` looks at the wordmark itself and decides:
 * a plate appears only when the mark would otherwise vanish.
 */
type LogoGround = 'light' | 'dark' | 'photo'

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
    case 'split':
      drawSplit(ctx, design, input, images)
      break
    case 'card':
      drawCardOverlay(ctx, design, input, images)
      break
    case 'band':
      drawBand(ctx, design, input, images)
      break
    case 'device':
      drawDevice(ctx, design, input, images)
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

/**
 * The photograph full-bleed, the message in the quiet the image was framed
 * to leave. `hero_right` means the subject is on the right, so the type takes
 * the left — the anchor mirrors the subject rather than piling onto it.
 */
function drawEditorial(
  ctx: CanvasRenderingContext2D,
  design: PosterDesign,
  input: PosterInput,
  images: PosterImages,
) {
  const { width, height, margin, palette, anchor } = design
  if (images.image) drawCover(ctx, images.image, 0, 0, width, height, 'center')
  else fillRect(ctx, 0, 0, width, height, palette.dark)

  const side = anchor === 'left' || anchor === 'right'
  const columnWidth = side ? width * 0.52 : width * 0.84
  const ctaFill = emphasisOn('#000000', palette.accent, '#ffffff')
  const items = fitStack(ctx, design, input, {
    maxWidth: columnWidth,
    available: side ? height - margin * 2 - 120 : height * 0.56,
    eyebrow: { color: '#ffffff', fill: withAlpha(palette.accent, 0.92) },
    headline: '#ffffff',
    emphasis: emphasisOn('#000000', palette.accent, '#ffffff'),
    supporting: 'rgba(255,255,255,0.9)',
    cta: { fill: ctaFill, color: readableOn(ctaFill) },
  })
  const total = stackHeight(items)

  if (side) {
    // A directional wash into the empty half. It follows the composition, so
    // the subject stays as the photographer framed it and only the type side
    // is darkened enough to write on.
    //
    // It has to hold across the whole type column, not taper through it: at
    // 0.42 by mid-frame the headline was landing on a lit face at half
    // strength. The column runs to roughly 0.56 of the width, so the wash
    // stays dense that far and releases just outside it.
    const fromLeft = anchor === 'left'
    horizontalGradient(ctx, width, height, fromLeft, [
      [0, 'rgba(0,0,0,0.86)'],
      [0.5, 'rgba(0,0,0,0.7)'],
      [0.78, 'rgba(0,0,0,0.2)'],
      [1, 'rgba(0,0,0,0)'],
    ])
    const x = fromLeft ? margin : width - margin - columnWidth
    drawLogo(ctx, images.logo, x, margin, 'photo', palette)
    drawStack(ctx, items, x, Math.max(margin + 150, (height - total) / 2), columnWidth, 'left')
    return
  }

  // A lift at the top for the logo, and below it a scrim measured to the
  // message rather than to half the poster: dark enough for white type
  // wherever the photograph happens to be bright, the picture left alone
  // above it.
  const top = height - margin - total
  fillGradient(ctx, 0, 0, width, height * 0.22, [
    [0, 'rgba(0,0,0,0.26)'],
    [1, 'rgba(0,0,0,0)'],
  ])
  const scrimTop = Math.min(height * 0.32, top - 150)
  fillGradient(ctx, 0, scrimTop, width, height - scrimTop, [
    [0, 'rgba(0,0,0,0)'],
    [0.34, 'rgba(0,0,0,0.55)'],
    [1, 'rgba(0,0,0,0.9)'],
  ])

  const centered = anchor === 'bottom_center'
  drawLogo(ctx, images.logo, margin, margin, 'photo', palette)
  drawStack(
    ctx,
    items,
    centered ? (width - columnWidth) / 2 : margin,
    top,
    columnWidth,
    centered ? 'center' : 'left',
  )
}

/**
 * Two bands with a hard edge: the message on paper up top, the photograph
 * filling the rest. The edge is the design — no scrim, no overlay, nothing
 * apologising for the join.
 */
function drawSplit(
  ctx: CanvasRenderingContext2D,
  design: PosterDesign,
  input: PosterInput,
  images: PosterImages,
) {
  const { width, height, margin, palette } = design
  const top = margin + LOGO_MAX_HEIGHT + 44
  const ctaFill = palette.accentFromBrand ? palette.accent : palette.ink
  const items = fitStack(ctx, design, input, {
    // A little narrower than the band so the headline breaks where an editor
    // would break it, over two lines, rather than running the full measure as
    // one thin line.
    maxWidth: (width - margin * 2) * 0.88,
    available: height * 0.54 - top,
    eyebrow: { color: palette.accentInk, fill: null, rule: palette.accent, uppercase: true },
    headline: palette.ink,
    emphasis: palette.accentInk,
    supporting: palette.inkSoft,
    cta: { fill: ctaFill, color: readableOn(ctaFill) },
  })

  // The edge falls where the message ends, not at a fixed fraction. Fixing it
  // at half the poster left the type stranded at the top of an empty band and
  // forced the headline down two size steps to fit a budget it never needed.
  // Capped at just over half: past that the photograph becomes a letterbox
  // strip under a colour field, which is the template look §5 rules out.
  const textHeight = Math.round(
    Math.min(height * 0.54, Math.max(height * 0.36, top + stackHeight(items) + margin)),
  )
  fillRect(ctx, 0, 0, width, textHeight, palette.paperTint)
  if (images.image) drawCover(ctx, images.image, 0, textHeight, width, height - textHeight, 'upper')
  else fillRect(ctx, 0, textHeight, width, height - textHeight, palette.dark)

  drawLogo(ctx, images.logo, margin, margin, 'light', palette)
  drawStack(ctx, items, margin, top, width - margin * 2, 'left')
}

/**
 * The photograph full-bleed with the message on a card that floats over its
 * lower edge — the arrangement that lets a picture stay a picture while the
 * type sits on something solid enough to read at thumbnail size.
 */
function drawCardOverlay(
  ctx: CanvasRenderingContext2D,
  design: PosterDesign,
  input: PosterInput,
  images: PosterImages,
) {
  const { width, height, margin, palette } = design
  if (images.image) drawCover(ctx, images.image, 0, 0, width, height, 'center')
  else fillRect(ctx, 0, 0, width, height, palette.dark)
  fillGradient(ctx, 0, 0, width, height * 0.24, [
    [0, 'rgba(0,0,0,0.3)'],
    [1, 'rgba(0,0,0,0)'],
  ])
  drawLogo(ctx, images.logo, margin, margin, 'photo', palette)

  const cardX = margin
  const cardWidth = width - margin * 2
  const pad = 52
  const ctaFill = palette.accentFromBrand ? palette.accent : palette.ink
  const items = fitStack(ctx, design, input, {
    maxWidth: cardWidth - pad * 2,
    available: height * 0.46 - pad * 2,
    eyebrow: { color: readableOn(palette.accent), fill: palette.accent },
    headline: palette.ink,
    emphasis: palette.accentInk,
    supporting: palette.inkSoft,
    cta: { fill: ctaFill, color: readableOn(ctaFill) },
  })
  const cardHeight = stackHeight(items) + pad * 2
  const cardY = height - margin - cardHeight

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.42)'
  ctx.shadowBlur = 60
  ctx.shadowOffsetY = 24
  ctx.fillStyle = palette.paper
  roundedRectPath(ctx, cardX, cardY, cardWidth, cardHeight, 28)
  ctx.fill()
  ctx.restore()

  drawStack(ctx, items, cardX + pad, cardY + pad, cardWidth - pad * 2, 'left')
}

/**
 * Photograph above, the offer on a brand band below — cut on a diagonal so
 * the two read as one composition rather than a picture with a coloured
 * rectangle stuck under it.
 */
function drawBand(
  ctx: CanvasRenderingContext2D,
  design: PosterDesign,
  input: PosterInput,
  images: PosterImages,
) {
  const { width, height, margin, palette } = design
  const band = palette.accentFromBrand ? palette.accent : palette.dark
  const bandText = readableOn(band)

  const items = fitStack(ctx, design, input, {
    maxWidth: width - margin * 2.4,
    available: height * 0.46 - margin * 1.6,
    eyebrow: { color: band, fill: bandText },
    headline: bandText,
    emphasis: null,
    supporting: withAlpha(bandText, 0.9),
    cta: { fill: bandText, color: band },
    headlineWeight: 800,
  })
  const total = stackHeight(items)
  const bandHeight = Math.round(
    Math.min(height * 0.5, Math.max(height * 0.34, total + margin * 2)),
  )
  // The diagonal rises to the right; the photo keeps the deeper corner.
  const bandTop = height - bandHeight
  const rise = Math.round(height * 0.06)

  // Same reason as the split: this pane is shorter than the frame it is cut
  // from, and a centred cut takes the face off the top of it.
  if (images.image) drawCover(ctx, images.image, 0, 0, width, bandTop + rise, 'upper')
  else fillRect(ctx, 0, 0, width, bandTop + rise, palette.dark)
  fillGradient(ctx, 0, 0, width, height * 0.22, [
    [0, 'rgba(0,0,0,0.3)'],
    [1, 'rgba(0,0,0,0)'],
  ])

  ctx.save()
  ctx.fillStyle = band
  ctx.beginPath()
  ctx.moveTo(0, bandTop + rise)
  ctx.lineTo(width, bandTop - rise)
  ctx.lineTo(width, height)
  ctx.lineTo(0, height)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  drawLogo(ctx, images.logo, margin, margin, 'photo', palette)
  const centered = design.anchor === 'bottom_center'
  drawStack(
    ctx,
    items,
    centered ? margin * 1.2 : margin,
    bandTop + rise + (bandHeight - rise - total) / 2,
    width - margin * 2.4,
    centered ? 'center' : 'left',
  )
}

/**
 * The owner's real screen, stood up in the scene that was generated around
 * it. The screenshot is never sent to the image model and never redrawn: the
 * interface a customer is shown is the one the owner actually ships.
 */
function drawDevice(
  ctx: CanvasRenderingContext2D,
  design: PosterDesign,
  input: PosterInput,
  images: PosterImages,
) {
  const { width, height, margin, palette, composition } = design
  if (images.image) drawCover(ctx, images.image, 0, 0, width, height, 'center')
  else fillRect(ctx, 0, 0, width, height, palette.dark)

  const stacked = composition === 'device_hero'
  const phoneHeight = Math.round(height * (stacked ? 0.5 : 0.66))
  const phoneWidth = Math.round(phoneHeight * 0.48)
  const phoneX = stacked
    ? Math.round((width - phoneWidth) / 2)
    : Math.round(width - margin - phoneWidth)
  // The centred phone sits deeper in the frame than the beside one: the
  // message has to clear it entirely rather than share the width with it, and
  // starving that column is what made this composition's headline the
  // smallest on the sheet.
  const phoneY = Math.round(height - phoneHeight + phoneHeight * (stacked ? 0.14 : 0.1))

  const columnWidth = stacked ? width - margin * 2 : phoneX - margin * 2
  const ctaFill = emphasisOn('#000000', palette.accent, '#ffffff')
  const items = fitStack(ctx, design, input, {
    maxWidth: columnWidth,
    available: stacked
      ? phoneY - (margin + LOGO_MAX_HEIGHT + 40) - 28
      : height - margin * 2 - 130,
    eyebrow: { color: '#ffffff', fill: withAlpha(palette.accent, 0.92) },
    headline: '#ffffff',
    emphasis: emphasisOn('#000000', palette.accent, '#ffffff'),
    supporting: 'rgba(255,255,255,0.9)',
    cta: { fill: ctaFill, color: readableOn(ctaFill) },
  })
  const total = stackHeight(items)

  if (stacked) {
    fillGradient(ctx, 0, 0, width, height * 0.62, [
      [0, 'rgba(0,0,0,0.86)'],
      [0.7, 'rgba(0,0,0,0.4)'],
      [1, 'rgba(0,0,0,0)'],
    ])
  } else {
    horizontalGradient(ctx, width, height, true, [
      [0, 'rgba(0,0,0,0.84)'],
      [0.56, 'rgba(0,0,0,0.4)'],
      [1, 'rgba(0,0,0,0.05)'],
    ])
  }

  const tilt = composition === 'device_stack' ? -0.055 : 0
  drawPhone(ctx, images.device ?? null, phoneX, phoneY, phoneWidth, phoneHeight, tilt, palette)

  drawLogo(ctx, images.logo, margin, margin, 'photo', palette)
  drawStack(
    ctx,
    items,
    margin,
    stacked ? margin + LOGO_MAX_HEIGHT + 40 : Math.max(margin + 140, (height - total) / 2),
    columnWidth,
    'left',
  )
}

/** No visual: the brand carries the message on its own. */
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

  // Depth without decoration: a light falling from the top-left corner and a
  // deepening at the opposite one. The old translucent disc read as a stray
  // shape parked behind the headline.
  ctx.save()
  const light = ctx.createRadialGradient(width * 0.1, -height * 0.1, 0, width * 0.1, -height * 0.1, width * 1.1)
  light.addColorStop(0, withAlpha(text, 0.13))
  light.addColorStop(1, withAlpha(text, 0))
  ctx.fillStyle = light
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = mixHex(ground, text === '#ffffff' ? '#000000' : '#ffffff', 0.06)
  ctx.globalAlpha = 0.5
  ctx.beginPath()
  ctx.moveTo(width, height * 0.52)
  ctx.lineTo(width, height)
  ctx.lineTo(width * 0.34, height)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  drawLogo(ctx, images.logo, margin, margin, text === '#ffffff' ? 'dark' : 'light', palette)

  const items = fitStack(ctx, design, input, {
    maxWidth: width * 0.86,
    available: height - margin * 2 - LOGO_MAX_HEIGHT - 48,
    eyebrow: { color: ground, fill: text },
    headline: text,
    emphasis: withAlpha(text, 0.6),
    supporting: withAlpha(text, 0.86),
    cta: { fill: text, color: ground },
    headlineScale: 1.08,
  })
  const total = stackHeight(items)
  drawStack(ctx, items, margin, height - margin - total, width * 0.86, 'left')
}

/* --- the message stack ------------------------------------------------------ */

interface StackOptions {
  maxWidth: number
  /** Vertical room the stack must fit in; sizes step down until it does. */
  available: number
  eyebrow: { color: string; fill: string | null; rule?: string; uppercase?: boolean }
  headline: string
  /** The colour one word of the headline is lifted into, or null for none. */
  emphasis: string | null
  supporting: string
  cta: { fill: string; color: string; compact?: boolean }
  headlineScale?: number
  headlineWeight?: number
}

/**
 * Eyebrow (offer) → headline → supporting line → call to action, measured at
 * the design's sizes and stepped down together until the stack fits the room
 * it has. Copy limits keep this from ever needing much stepping; the loop is
 * what stops a long line from running off the poster.
 */
function fitStack(
  ctx: CanvasRenderingContext2D,
  design: PosterDesign,
  input: PosterInput,
  options: StackOptions,
): StackItem[] {
  let items: StackItem[] = []
  for (const scale of [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.44]) {
    items = buildStack(ctx, design, input, options, scale)
    // Fitting is not only about height. `wrapLines` stops at its line limit
    // and silently returns what it had, so type that is too large for its
    // column loses its last words — a poster went out reading "Fresh bread,
    // every". A wrap that dropped a word has not fitted; step down instead.
    if (stackHeight(items) <= options.available && items.every(isComplete)) {
      return scale === 1 ? grown(ctx, design, input, options, items) : items
    }
  }
  return items
}

/**
 * A three-word headline set at the same size as a nine-word one leaves the
 * poster looking timid: the type sits in the middle of its column with the
 * rest of the space unspent, which reads as a template filling a slot rather
 * than a headline that was set. So when the headline came out on a single
 * line and a good third of the room is unused, step the whole stack up.
 *
 * Bounded on purpose. It only ever runs from the natural size, it stops at
 * the first size that fits, and it will not push the headline past two lines
 * — growth that costs a third line is a smaller headline, not a bigger one.
 */
function grown(
  ctx: CanvasRenderingContext2D,
  design: PosterDesign,
  input: PosterInput,
  options: StackOptions,
  base: StackItem[],
): StackItem[] {
  const headline = base.find((item) => item.kind === 'text' && item.role === 'headline')
  if (!headline || headline.kind !== 'text' || headline.lines.length !== 1) return base
  if (stackHeight(base) > options.available * 0.82) return base

  for (const scale of [1.26, 1.18, 1.1]) {
    const items = buildStack(ctx, design, input, options, scale)
    const grownHeadline = items.find((item) => item.kind === 'text' && item.role === 'headline')
    if (!grownHeadline || grownHeadline.kind !== 'text' || grownHeadline.lines.length > 2) continue
    if (stackHeight(items) <= options.available && items.every(isComplete)) return items
  }
  return base
}

function isComplete(item: StackItem): boolean {
  return item.kind !== 'text' || item.complete
}

/** Whether a wrap kept every word it was given. */
function keptEveryWord(text: string, lines: string[]): boolean {
  const words = (candidate: string) => candidate.split(/\s+/).filter(Boolean).length
  return lines.reduce((sum, line) => sum + words(line), 0) === words(text)
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
  const treatment = design.accentTreatment

  if (input.offerText) {
    const ruled = treatment === 'rule' && options.eyebrow.rule !== undefined
    const style: TextStyle = {
      font: design.bodyFont,
      size: Math.round(design.eyebrowSize * scale),
      weight: 700,
      color: options.eyebrow.color,
      lineHeight: 1.2,
      tracking: options.eyebrow.uppercase ? 0.1 : 0.02,
    }
    const label = options.eyebrow.uppercase ? input.offerText.toUpperCase() : input.offerText
    applyFont(ctx, style)
    // A field is a filled chip; a rule writes plain with a brand bar beside
    // it. Both say "offer" — they just do not both say it the same way on
    // every poster in the set.
    const filled = options.eyebrow.fill !== null && !ruled
    const padX = filled ? 22 : ruled ? 22 : 0
    items.push({
      kind: 'chip',
      label,
      style,
      fill: filled ? options.eyebrow.fill : null,
      rule: ruled ? (options.eyebrow.rule as string) : null,
      width: Math.min(measure(label) + padX * 2, options.maxWidth),
      height: style.size + (filled ? 26 : 8),
      gapAfter: 30 * scale,
    })
  }

  if (input.headline) {
    const style: TextStyle = {
      font: design.headingFont,
      size: Math.round(design.headlineSize * (options.headlineScale ?? 1) * scale),
      weight: options.headlineWeight ?? 800,
      color: options.headline,
      lineHeight: 1.04,
      tracking: -0.025,
    }
    applyFont(ctx, style)
    const lines = balancedLines(input.headline, options.maxWidth, measure, 3)
    items.push({
      kind: 'text',
      role: 'headline',
      lines,
      complete: keptEveryWord(input.headline, lines),
      style,
      emphasis:
        treatment === 'emphasis_word' && options.emphasis
          ? emphasisWord(lines, options.emphasis)
          : null,
      height: lines.length * style.size * style.lineHeight,
      gapAfter: 24 * scale,
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
      role: 'supporting',
      lines,
      complete: keptEveryWord(input.subheadline, lines),
      style,
      emphasis: null,
      height: lines.length * style.size * style.lineHeight,
      gapAfter: 42 * scale,
    })
  }

  if (input.callToAction) {
    const variant = design.ctaStyle
    const style: TextStyle = {
      font: design.bodyFont,
      size: Math.round(design.ctaSize * scale),
      weight: 700,
      // An outlined button writes in the colour it is drawn in.
      color: variant === 'outline' ? options.cta.fill : options.cta.color,
      lineHeight: 1,
      tracking: variant === 'bar' ? 0.06 : 0.01,
    }
    applyFont(ctx, style)
    const padX = variant === 'chip' ? 34 : options.cta.compact ? 32 : 42
    const labelWidth = Math.min(measure(input.callToAction), options.maxWidth - padX * 2)
    items.push({
      kind: 'button',
      label: input.callToAction,
      style,
      fill: options.cta.fill,
      variant,
      // A bar spans the column; the others are sized to their label.
      width: variant === 'bar' ? options.maxWidth : labelWidth + padX * 2,
      height: style.size + (options.cta.compact ? 34 : variant === 'bar' ? 48 : 44),
      gapAfter: 0,
    })
  }

  if (items.length > 0) items[items.length - 1]!.gapAfter = 0
  return items
}

/**
 * The word the headline lands on, lifted into the brand colour.
 *
 * Only the last word of the last line qualifies: it is the one the eye stops
 * on, and colouring a word mid-line reads as a highlighter rather than a
 * decision. A one-word headline is already its own emphasis, so it is left
 * alone — colouring the whole thing is just a coloured headline.
 */
function emphasisWord(lines: string[], color: string): { word: string; color: string } | null {
  const last = lines[lines.length - 1]
  if (!last) return null
  const words = last.trim().split(/\s+/)
  const totalWords = lines.join(' ').trim().split(/\s+/).length
  if (totalWords < 3) return null
  const word = words[words.length - 1]
  if (!word || word.length < 3) return null
  return { word, color }
}

/**
 * Wrapping that prefers even lines.
 *
 * Greedy wrapping at the full column width produces the classic ragged
 * orphan — four words then one — which on display type reads as a mistake.
 * Trying progressively narrower columns and keeping the most even result at
 * the same line count costs nothing and is what a designer does by hand.
 */
function balancedLines(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
  maxLines: number,
): string[] {
  const greedy = wrapLines(text, maxWidth, measure, maxLines)
  if (greedy.length < 2) return greedy
  let best = greedy
  let bestSpread = lineSpread(greedy, measure)
  for (const fraction of [0.94, 0.88, 0.82, 0.76, 0.7]) {
    const candidate = wrapLines(text, maxWidth * fraction, measure, maxLines)
    if (candidate.length !== greedy.length) continue
    const spread = lineSpread(candidate, measure)
    if (spread < bestSpread) {
      best = candidate
      bestSpread = spread
    }
  }
  return best
}

/** How uneven a wrap is: the gap between its longest and shortest line. */
function lineSpread(lines: string[], measure: (text: string) => number): number {
  const widths = lines.map(measure)
  return Math.max(...widths) - Math.min(...widths)
}

function stackHeight(items: StackItem[]): number {
  return items.reduce((sum, item) => sum + item.height + item.gapAfter, 0)
}

function drawStack(
  ctx: CanvasRenderingContext2D,
  items: StackItem[],
  x: number,
  top: number,
  columnWidth: number,
  align: 'left' | 'center',
) {
  let y = top
  for (const item of items) {
    switch (item.kind) {
      case 'text': {
        applyFont(ctx, item.style)
        const step = item.style.size * item.style.lineHeight
        // Baseline sits ~80% down the line box for Latin type.
        let baseline = y + item.style.size * 0.8 + (step - item.style.size) / 2
        item.lines.forEach((line, index) => {
          const lineWidth = ctx.measureText(line).width
          const lineX = align === 'center' ? x + (columnWidth - lineWidth) / 2 : x
          const last = index === item.lines.length - 1
          if (last && item.emphasis && line.endsWith(item.emphasis.word)) {
            const head = line.slice(0, line.length - item.emphasis.word.length)
            ctx.fillStyle = item.style.color
            ctx.fillText(head, lineX, baseline)
            ctx.fillStyle = item.emphasis.color
            ctx.fillText(item.emphasis.word, lineX + ctx.measureText(head).width, baseline)
          } else {
            ctx.fillStyle = item.style.color
            ctx.fillText(line, lineX, baseline)
          }
          baseline += step
        })
        break
      }
      case 'chip': {
        applyFont(ctx, item.style)
        const chipX = align === 'center' ? x + (columnWidth - item.width) / 2 : x
        if (item.fill) {
          ctx.fillStyle = item.fill
          roundedRectPath(ctx, chipX, y, item.width, item.height, item.height / 2)
          ctx.fill()
        }
        if (item.rule) {
          ctx.fillStyle = item.rule
          ctx.fillRect(chipX, y + 2, 8, item.height - 4)
        }
        ctx.fillStyle = item.style.color
        const padX = item.fill ? 22 : item.rule ? 22 : 0
        ctx.fillText(
          item.label,
          chipX + padX,
          y + item.height / 2 + item.style.size * 0.36,
          item.width - padX * 2,
        )
        break
      }
      case 'button': {
        applyFont(ctx, item.style)
        const buttonX = align === 'center' ? x + (columnWidth - item.width) / 2 : x
        const radius = item.variant === 'chip' ? item.height / 2 : item.variant === 'bar' ? 0 : 16
        roundedRectPath(ctx, buttonX, y, item.width, item.height, radius)
        if (item.variant === 'outline') {
          ctx.strokeStyle = item.fill
          ctx.lineWidth = 3
          ctx.stroke()
        } else {
          ctx.fillStyle = item.fill
          ctx.fill()
        }
        ctx.fillStyle = item.style.color
        const labelWidth = Math.min(ctx.measureText(item.label).width, item.width)
        ctx.fillText(
          item.label,
          buttonX + (item.width - labelWidth) / 2,
          y + item.height / 2 + item.style.size * 0.36,
          item.width,
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

/** A wash across the poster, running from the type side toward the subject. */
function horizontalGradient(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  fromLeft: boolean,
  stops: [number, string][],
) {
  const gradient = fromLeft
    ? ctx.createLinearGradient(0, 0, width, 0)
    : ctx.createLinearGradient(width, 0, 0, 0)
  for (const [offset, color] of stops) gradient.addColorStop(offset, color)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
}

/** Cover-fit an image into a box, cropping toward the centre or the top. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  image: PosterBitmap,
  x: number,
  y: number,
  w: number,
  h: number,
  focus: 'center' | 'top' | 'upper',
) {
  if (image.width <= 0 || image.height <= 0) return
  const scale = Math.max(w / image.width, h / image.height)
  const drawWidth = image.width * scale
  const drawHeight = image.height * scale
  const dx = x + (w - drawWidth) / 2
  // A letterbox pane cut from a square frame loses whatever a centred crop
  // does not reach, and in advertising photography that is the face: subjects
  // sit above the middle. 'upper' keeps the overflow mostly below the crop.
  const bias = focus === 'top' ? 0 : focus === 'upper' ? 0.28 : 0.5
  const dy = y + (h - drawHeight) * bias
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.drawImage(image, dx, dy, drawWidth, drawHeight)
  ctx.restore()
}

/**
 * A phone, drawn to hold the owner's real screenshot.
 *
 * The screen is cover-fit from the top: app screenshots put the thing worth
 * seeing in the first screenful, so cropping from the bottom keeps it and
 * centring would cut the header off. `tilt` is in radians and turns the
 * handset a few degrees so a two-poster set does not repeat itself.
 */
function drawPhone(
  ctx: CanvasRenderingContext2D,
  screen: PosterBitmap | null,
  x: number,
  y: number,
  w: number,
  h: number,
  tilt: number,
  palette: PosterDesign['palette'],
) {
  const bezel = Math.max(10, Math.round(w * 0.035))
  const radius = Math.round(w * 0.13)

  ctx.save()
  if (tilt !== 0) {
    ctx.translate(x + w / 2, y + h / 2)
    ctx.rotate(tilt)
    ctx.translate(-(x + w / 2), -(y + h / 2))
  }

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 70
  ctx.shadowOffsetY = 28
  ctx.fillStyle = '#101317'
  roundedRectPath(ctx, x, y, w, h, radius)
  ctx.fill()
  ctx.restore()

  const sx = x + bezel
  const sy = y + bezel
  const sw = w - bezel * 2
  const sh = h - bezel * 2
  const screenRadius = Math.max(0, radius - bezel)
  if (screen) {
    drawRounded(ctx, sx, sy, sw, sh, screenRadius, () =>
      drawCover(ctx, screen, sx, sy, sw, sh, 'top'),
    )
  } else {
    ctx.fillStyle = mixHex(palette.dark, palette.accent, 0.25)
    roundedRectPath(ctx, sx, sy, sw, sh, screenRadius)
    ctx.fill()
  }

  // A soft sheen across the glass, so the handset reads as an object in the
  // photograph rather than a screenshot pasted onto it.
  ctx.save()
  roundedRectPath(ctx, sx, sy, sw, sh, screenRadius)
  ctx.clip()
  const sheen = ctx.createLinearGradient(sx, sy, sx + sw, sy + sh * 0.6)
  sheen.addColorStop(0, 'rgba(255,255,255,0.16)')
  sheen.addColorStop(0.45, 'rgba(255,255,255,0.02)')
  sheen.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.fillRect(sx, sy, sw, sh)
  ctx.restore()

  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 2
  roundedRectPath(ctx, x + 1, y + 1, w - 2, h - 2, radius - 1)
  ctx.stroke()
  ctx.restore()

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
 * Whether it needs anything behind it is answered by looking at the mark
 * itself: a light wordmark on a photograph needs only a shadow, and a dark
 * one needs a small plate. The previous renderer plated unconditionally,
 * which is where the white boxes came from — a white card behind a logo that
 * was already white and already legible.
 */
function drawLogo(
  ctx: CanvasRenderingContext2D,
  logo: PosterBitmap | null,
  x: number,
  y: number,
  ground: LogoGround,
  palette: PosterDesign['palette'],
) {
  if (!logo || logo.width <= 0 || logo.height <= 0) return
  const scale = Math.min(LOGO_MAX_WIDTH / logo.width, LOGO_MAX_HEIGHT / logo.height, 1.5)
  const width = logo.width * scale
  const height = logo.height * scale

  const dark = logoIsDark(logo)
  // A wordmark on transparency needs a ground of ours. A logo that ships as a
  // solid tile — an app icon, a badge — already has one, and putting a white
  // card behind it prints a sticker on the poster (§7).
  const selfContained = logoCarriesItsOwnGround(logo)
  // Unknown luminance on a photograph is the one case worth insuring against:
  // a plate is ugly, an invisible logo is worse.
  const needsPlate =
    !selfContained &&
    ((ground === 'dark' && dark !== false) ||
      (ground === 'photo' && dark !== false) ||
      (ground === 'light' && dark === false))
  const plate = needsPlate ? (ground === 'light' ? palette.dark : palette.paper) : null
  const inset = plate ? LOGO_PLATE_PAD : 0

  if (plate) {
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.22)'
    ctx.shadowBlur = 22
    ctx.shadowOffsetY = 6
    ctx.fillStyle = plate
    roundedRectPath(ctx, x, y, width + inset * 2, height + inset * 2, 16)
    ctx.fill()
    ctx.restore()
    ctx.drawImage(logo, x + inset, y + inset, width, height)
    return
  }

  // No plate: a soft drop shadow is what keeps a light mark readable over a
  // bright patch of photograph, without printing a box on the poster.
  ctx.save()
  if (ground === 'photo') {
    ctx.shadowColor = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur = 24
    ctx.shadowOffsetY = 3
  }
  ctx.drawImage(logo, x, y, width, height)
  ctx.restore()
}

/**
 * Whether a wordmark is dark enough to disappear on a dark ground.
 *
 * Answered from the file's own pixels rather than guessed: only pixels that
 * are actually opaque count, because a transparent PNG is mostly nothing and
 * averaging the nothing makes every logo look black. Returns null when the
 * pixels cannot be read at all — a cross-origin bitmap, or a test environment
 * with no real canvas — and the caller insures against the unknown.
 */
interface LogoPixels {
  /** Null when the pixels could not be read at all. */
  dark: boolean | null
  /** Share of the mark's box that is opaque, 0–1. */
  coverage: number
}

const logoPixels = new WeakMap<object, LogoPixels>()

function readLogoPixels(logo: PosterBitmap): LogoPixels {
  const cached = logoPixels.get(logo)
  if (cached) return cached
  const result = measureLogoPixels(logo)
  logoPixels.set(logo, result)
  return result
}

function logoIsDark(logo: PosterBitmap): boolean | null {
  return readLogoPixels(logo).dark
}

/**
 * Whether the logo file is a solid shape rather than a mark on transparency.
 * Nearly every pixel opaque means the owner's file already supplies its own
 * background, and a plate behind it would just be a second one.
 */
function logoCarriesItsOwnGround(logo: PosterBitmap): boolean {
  return readLogoPixels(logo).coverage >= 0.88
}

function measureLogoPixels(logo: PosterBitmap): LogoPixels {
  try {
    if (typeof document === 'undefined') return UNREADABLE
    const size = 32
    const probe = document.createElement('canvas')
    probe.width = size
    probe.height = size
    const probeCtx = probe.getContext('2d', { willReadFrequently: true })
    if (!probeCtx) return UNREADABLE
    probeCtx.drawImage(logo, 0, 0, size, size)
    const { data } = probeCtx.getImageData(0, 0, size, size)
    let sum = 0
    let opaque = 0
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] ?? 0
      if (alpha < 128) continue
      opaque += 1
      sum += 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0)
    }
    if (opaque === 0) return UNREADABLE
    return { dark: sum / opaque < 140, coverage: opaque / (size * size) }
  } catch {
    // A tainted canvas throws on read. Unknown, not dark.
    return UNREADABLE
  }
}

/** Pixels we could not read: assume a transparent mark, luminance unknown. */
const UNREADABLE: LogoPixels = { dark: null, coverage: 0 }

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
