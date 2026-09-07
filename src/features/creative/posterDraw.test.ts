import { describe, expect, it } from 'vitest'
import { drawPoster, type PosterBitmap, type PosterImages } from './posterDraw'
import { posterDesign, type PosterInput } from './posterDesign'

/**
 * The poster renderer, judged on what it actually puts on the canvas.
 *
 * Phase 7G §3 asks for posters with a real hierarchy and an intentional
 * composition, and names the ways this had been going wrong: the wrong line
 * blown up as the hero, a call to action drawn as a large pill, half the
 * poster given to a flat colour panel, an image clipped by the poster edge.
 * Those are drawing decisions, so they are pinned here by recording every
 * operation a layout performs rather than by eye.
 */

interface Op {
  op: 'text' | 'rect' | 'fillPath' | 'strokePath' | 'image'
  x: number
  y: number
  width: number
  height: number
  style: string
  text?: string
  size?: number
  source?: unknown
}

/** A 2D context that records instead of painting. */
function recorder() {
  const ops: Op[] = []
  let font = '400 16px sans-serif'
  const box = { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  const extend = (x: number, y: number) => {
    box.minX = Math.min(box.minX, x)
    box.minY = Math.min(box.minY, y)
    box.maxX = Math.max(box.maxX, x)
    box.maxY = Math.max(box.maxY, y)
  }
  const size = () => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16)
  const gradient = () => ({ addColorStop: () => {} })
  const ctx = {
    canvas: { width: 1080, height: 1080 },
    textBaseline: 'alphabetic',
    textAlign: 'left',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    letterSpacing: '0px',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
    get font() {
      return font
    },
    set font(value: string) {
      font = value
    },
    save: () => {},
    restore: () => {},
    measureText: (text: string) => ({ width: text.length * size() * 0.5 }),
    fillText(text: string, x: number, y: number) {
      ops.push({ op: 'text', x, y, width: text.length * size() * 0.5, height: size(), style: String(ctx.fillStyle), text, size: size() })
    },
    fillRect(x: number, y: number, width: number, height: number) {
      ops.push({ op: 'rect', x, y, width, height, style: String(ctx.fillStyle) })
    },
    drawImage(source: unknown, x: number, y: number, width: number, height: number) {
      ops.push({ op: 'image', x, y, width, height, style: '', source })
    },
    beginPath() {
      box.minX = Infinity
      box.minY = Infinity
      box.maxX = -Infinity
      box.maxY = -Infinity
    },
    moveTo: extend,
    lineTo: extend,
    arcTo(x1: number, y1: number, x2: number, y2: number) {
      extend(x1, y1)
      extend(x2, y2)
    },
    arc(x: number, y: number, r: number) {
      extend(x - r, y - r)
      extend(x + r, y + r)
    },
    rect(x: number, y: number, w: number, h: number) {
      extend(x, y)
      extend(x + w, y + h)
    },
    closePath: () => {},
    clip: () => {},
    fill() {
      ops.push({ op: 'fillPath', x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY, style: String(ctx.fillStyle) })
    },
    stroke() {
      ops.push({ op: 'strokePath', x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY, style: String(ctx.strokeStyle) })
    },
    createLinearGradient: gradient,
    createRadialGradient: gradient,
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops }
}

const PHOTO = { width: 1024, height: 1024 } as PosterBitmap
const LOGO = { width: 512, height: 160 } as PosterBitmap
const IMAGES: PosterImages = { image: PHOTO, logo: LOGO }

function input(overrides: Partial<PosterInput> = {}): PosterInput {
  return {
    creativeId: 'creative1',
    name: 'Weekday Lunch Poster',
    format: 'square_post',
    headline: 'Beat The Lunch Rush',
    subheadline: 'Order ahead and walk straight in.',
    callToAction: 'Order Ahead',
    offerText: 'Weekday sets',
    imageStoragePath: 'businesses/b1/creatives/c1.png',
    imageAltText: 'A nasi lemak set on a marble table',
    direction: 'bold_promotional',
    palette: ['#c2410c'],
    headingFont: 'Poppins',
    bodyFont: 'Inter',
    logoStoragePath: 'businesses/b1/assets/logo.png',
    ...overrides,
  }
}

function render(over: Partial<PosterInput> = {}, images: PosterImages = IMAGES) {
  const poster = input(over)
  const { ctx, ops } = recorder()
  drawPoster(ctx, posterDesign(poster), poster, images)
  return { ops, poster }
}

const find = (ops: Op[], text: string) => ops.find((op) => op.op === 'text' && op.text === text)

describe('drawPoster — the headline is the hero', () => {
  it('sets the headline larger than the offer tag on a promotion', () => {
    const { ops } = render()
    const headline = find(ops, 'Beat The Lunch Rush')
    const offer = find(ops, 'Weekday sets')
    expect(headline).toBeDefined()
    expect(offer).toBeDefined()
    // The regression this pins: "Weekday sets" used to be blown up as the
    // hero and the real headline demoted to a small grey supporting line.
    expect(headline!.size!).toBeGreaterThan(offer!.size! * 1.8)
  })

  it('sets the headline larger than the supporting line and the call to action', () => {
    for (const direction of ['bold_promotional', 'clean_editorial', 'hero_product', 'minimal_premium'] as const) {
      const { ops } = render({ direction })
      const headline = find(ops, 'Beat The Lunch Rush')!
      const supporting = find(ops, 'Order ahead and walk straight in.')!
      const cta = find(ops, 'Order Ahead')!
      expect(headline.size!, direction).toBeGreaterThan(supporting.size!)
      expect(headline.size!, direction).toBeGreaterThan(cta.size!)
    }
  })
})

describe('drawPoster — the brand colour emphasises, it is not the poster', () => {
  it('keeps the promo panel to under half the poster', () => {
    const { ops } = render()
    const panel = ops.filter((op) => op.op === 'rect' && op.style === '#c2410c')
    expect(panel).toHaveLength(1)
    expect(panel[0]!.height).toBeLessThan(1080 * 0.5)
    // …and the photograph keeps the rest, uncropped by a slab of colour.
    expect(panel[0]!.y + panel[0]!.height).toBe(1080)
  })

  it('sizes the panel to the message, leaving no void above the type', () => {
    const short = render({ subheadline: null, offerText: null })
    const panel = short.ops.filter((op) => op.op === 'rect' && op.style === '#c2410c')[0]!
    const full = render().ops.filter((op) => op.op === 'rect' && op.style === '#c2410c')[0]!
    expect(panel.height).toBeLessThan(full.height)
  })
})

describe('drawPoster — the call to action', () => {
  it('is outlined on the brand panel rather than a large solid pill', () => {
    const { ops } = render()
    const cta = find(ops, 'Order Ahead')!
    const solid = ops.filter(
      (op) => op.op === 'fillPath' && op.y <= cta.y && op.y + op.height >= cta.y && op.width > 100,
    )
    expect(solid).toHaveLength(0)
    expect(ops.some((op) => op.op === 'strokePath' && op.y <= cta.y && op.y + op.height >= cta.y)).toBe(true)
  })

  it('is a solid button on a photograph, where it needs to carry', () => {
    const { ops } = render({ direction: 'clean_editorial' })
    const cta = find(ops, 'Order Ahead')!
    expect(
      ops.some((op) => op.op === 'fillPath' && op.y <= cta.y && op.y + op.height >= cta.y && op.width > 100),
    ).toBe(true)
  })

  it('never runs wider than a third of the poster', () => {
    for (const direction of ['bold_promotional', 'clean_editorial', 'hero_product'] as const) {
      const { ops } = render({ direction, callToAction: 'Order Ahead' })
      const cta = find(ops, 'Order Ahead')!
      const button = ops.find(
        (op) => (op.op === 'fillPath' || op.op === 'strokePath') && op.y <= cta.y && op.y + op.height >= cta.y,
      )!
      expect(button.width, direction).toBeLessThan(1080 / 3)
    }
  })
})

describe('drawPoster — nothing is clipped by the poster edge', () => {
  it('lands the showcase photo card whole inside the poster', () => {
    const { ops } = render({ direction: 'hero_product' })
    const card = ops.filter((op) => op.op === 'fillPath' && op.width > 500 && op.height > 200)
    expect(card.length).toBeGreaterThan(0)
    for (const shape of card) {
      expect(shape.y).toBeGreaterThanOrEqual(0)
      expect(shape.y + shape.height).toBeLessThanOrEqual(1080)
    }
  })

  it('keeps every line of type inside the margins', () => {
    for (const direction of ['bold_promotional', 'clean_editorial', 'hero_product', 'educational'] as const) {
      const { ops } = render({ direction })
      for (const op of ops.filter((o) => o.op === 'text')) {
        expect(op.y, `${direction} ${op.text}`).toBeLessThanOrEqual(1080)
        expect(op.x, `${direction} ${op.text}`).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('drawPoster — the real logo, kept legible', () => {
  it('draws the owner file at its own aspect ratio, never redrawn', () => {
    const { ops } = render()
    const logo = ops.find((op) => op.op === 'image' && op.source === LOGO)!
    expect(logo.width / logo.height).toBeCloseTo(512 / 160, 2)
    expect(logo.height).toBeGreaterThan(40)
  })

  it('sits on a lockup plate over a photograph, so a dark wordmark still reads', () => {
    const { ops } = render()
    const logo = ops.indexOf(ops.find((op) => op.op === 'image' && op.source === LOGO)!)
    const plate = ops[logo - 1]!
    expect(plate.op).toBe('fillPath')
    expect(plate.width).toBeGreaterThan(ops[logo]!.width)
    expect(plate.height).toBeGreaterThan(ops[logo]!.height)
  })

  it('needs no plate on a light ground, where it already reads', () => {
    const { ops } = render({ direction: 'minimal_premium' })
    const index = ops.indexOf(ops.find((op) => op.op === 'image' && op.source === LOGO)!)
    expect(ops[index - 1]!.op).not.toBe('fillPath')
  })

  it('draws nothing when the business has no logo', () => {
    const { ops } = render({}, { image: PHOTO, logo: null })
    expect(ops.some((op) => op.op === 'image' && op.source === LOGO)).toBe(false)
  })
})

describe('drawPoster — type over photography', () => {
  it('lays a scrim under the message rather than over half the picture', () => {
    const { ops } = render({ direction: 'clean_editorial' })
    const headline = find(ops, 'Beat The Lunch Rush')!
    const scrims = ops.filter((op) => op.op === 'rect' && op.width === 1080 && op.y > 0)
    expect(scrims.length).toBeGreaterThan(0)
    const under = scrims.find((op) => op.y < headline.y && op.y + op.height >= 1080)
    expect(under).toBeDefined()
    // It starts above the type, and leaves the top of the picture alone.
    expect(under!.y).toBeLessThan(headline.y)
    expect(under!.y).toBeGreaterThan(1080 * 0.2)
  })
})
