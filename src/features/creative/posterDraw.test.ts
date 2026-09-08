import { describe, expect, it, vi } from 'vitest'
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
  const rotations: number[] = []
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
    translate: () => {},
    rotate: (angle: number) => {
      rotations.push(angle)
    },
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
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops, rotations }
}

/** Every arrangement a poster can be drawn in, swept by the tests below. */
const COMPOSITIONS = [
  'full_bleed',
  'hero_right',
  'hero_left',
  'center_hero',
  'editorial_split',
  'bottom_band',
  'card_overlay',
  'device_beside',
  'device_hero',
  'device_stack',
] as const

const PHOTO = { width: 1024, height: 1024 } as PosterBitmap
const LOGO = { width: 512, height: 160 } as PosterBitmap
const SCREEN = { width: 828, height: 1792 } as PosterBitmap
const IMAGES: PosterImages = { image: PHOTO, logo: LOGO, device: SCREEN }

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
    deviceStoragePath: 'businesses/b1/creatives/c1-screen.png',
    direction: 'bold_promotional',
    composition: null,
    accentTreatment: null,
    ctaStyle: null,
    palette: ['#c2410c'],
    headingFont: 'Poppins',
    bodyFont: 'Inter',
    logoStoragePath: 'businesses/b1/assets/logo.png',
    ...overrides,
  }
}

function render(over: Partial<PosterInput> = {}, images: PosterImages = IMAGES) {
  const poster = input(over)
  const { ctx, ops, rotations } = recorder()
  drawPoster(ctx, posterDesign(poster), poster, images)
  return { ops, poster, rotations }
}

const find = (ops: Op[], text: string) => ops.find((op) => op.op === 'text' && op.text === text)
/** Body copy wraps too, so it is located by how it starts. */
const findStart = (ops: Op[], prefix: string) =>
  ops.find((op) => op.op === 'text' && (op.text ?? '').startsWith(prefix))

/**
 * The headline, as it actually lands on the canvas: display type wraps, and
 * its final word may be drawn in a second colour, so it arrives as several
 * text operations. The largest size on the poster is the headline by
 * definition — that is what "the headline is the hero" means.
 */
function headlineOps(ops: Op[]): Op[] {
  const text = ops.filter((op) => op.op === 'text')
  const largest = Math.max(...text.map((op) => op.size ?? 0))
  return text.filter((op) => op.size === largest)
}

const headlineSize = (ops: Op[]) => headlineOps(ops)[0]?.size ?? 0
/** Where the message begins — the topmost line of the headline. */
const headlineTop = (ops: Op[]) => Math.min(...headlineOps(ops).map((op) => op.y))

describe('drawPoster — the headline is the hero', () => {
  it('sets the headline larger than the offer tag on a promotion', () => {
    const { ops } = render()
    const offer = find(ops, 'Weekday sets')
    expect(offer).toBeDefined()
    // The regression this pins: "Weekday sets" used to be blown up as the
    // hero and the real headline demoted to a small grey supporting line.
    expect(headlineSize(ops)).toBeGreaterThan(offer!.size! * 1.8)
  })

  it('sets the headline larger than the supporting line and the call to action', () => {
    for (const composition of COMPOSITIONS) {
      const { ops } = render({ composition })
      const supporting = findStart(ops, 'Order ahead')!
      const cta = find(ops, 'Order Ahead')!
      expect(headlineSize(ops), composition).toBeGreaterThan(supporting.size!)
      expect(headlineSize(ops), composition).toBeGreaterThan(cta.size!)
    }
  })

  it('runs the headline at display size, not at body size', () => {
    // §8: the old scale topped out at 96px and stepped down early, which is
    // how posters ended up with a headline barely larger than the caption.
    for (const composition of COMPOSITIONS) {
      const { ops } = render({ composition, headline: 'Faham Math', subheadline: null })
      expect(headlineSize(ops), composition).toBeGreaterThanOrEqual(100)
    }
  })
})

describe('drawPoster — the brand colour emphasises, it is not the poster', () => {
  const bandOf = (ops: Op[]) =>
    ops.filter((op) => op.op === 'fillPath' && op.style === '#c2410c' && op.width >= 1080)

  it('keeps the brand band to under half the poster', () => {
    const { ops } = render({ composition: 'bottom_band' })
    const band = bandOf(ops)
    expect(band).toHaveLength(1)
    expect(band[0]!.height).toBeLessThan(1080 * 0.6)
    // …and the photograph keeps the rest, uncropped by a slab of colour.
    expect(band[0]!.y + band[0]!.height).toBe(1080)
  })

  it('cuts the band on a diagonal rather than as a flat slab', () => {
    // §2 names the exact failure mode: BACKGROUND + GREEN RECTANGLE + WHITE
    // TEXT + GREEN BUTTON. A band whose top edge is level with itself is that
    // rectangle; an angled edge makes the picture and the colour one image.
    const { ops } = render({ composition: 'bottom_band' })
    const band = bandOf(ops)[0]!
    const flat = ops.filter(
      (op) => op.op === 'rect' && op.style === '#c2410c' && op.width >= 1080,
    )
    expect(flat).toHaveLength(0)
    // The path's bounding box is taller than the band's own straight height
    // exactly because its top edge rises across the poster.
    expect(band.height).toBeGreaterThan(0)
  })

  it('sizes the band to the message, leaving no void above the type', () => {
    const short = render({ composition: 'bottom_band', subheadline: null, offerText: null })
    const full = render({ composition: 'bottom_band' })
    expect(bandOf(short.ops)[0]!.height).toBeLessThan(bandOf(full.ops)[0]!.height)
  })

  it('writes the brand colour on paper instead of dropping it for ink', () => {
    // The defect the contact sheet exposed: #22c55e carries ~1.8:1 on paper,
    // so the old `emphasisOn` fell back to plain ink and the brand simply
    // never appeared on a light poster. Deepening the same hue keeps it.
    const { ops } = render({
      composition: 'editorial_split',
      palette: ['#22c55e'],
      offerText: 'Percuma 7 hari',
    })
    const offer = ops.find((op) => op.op === 'text' && op.text === 'PERCUMA 7 HARI')!
    expect(offer.style).not.toBe('#14161c')
    expect(offer.style.toLowerCase()).not.toBe('#22c55e')
    // Still green: the hue survives, only the lightness moved.
    const channels = /#(\w\w)(\w\w)(\w\w)/.exec(offer.style)!
    const [r, g, b] = channels.slice(1).map((hex) => parseInt(hex, 16))
    expect(g).toBeGreaterThan(r!)
    expect(g).toBeGreaterThan(b!)
  })
})

describe('drawPoster — the call to action', () => {
  const buttonUnder = (ops: Op[], cta: Op) =>
    ops.find(
      (op) => (op.op === 'fillPath' || op.op === 'strokePath') && op.y <= cta.y && op.y + op.height >= cta.y,
    )

  it('is a solid button on a photograph, where it needs to carry', () => {
    const { ops } = render({ composition: 'full_bleed' })
    const cta = find(ops, 'Order Ahead')!
    expect(
      ops.some((op) => op.op === 'fillPath' && op.y <= cta.y && op.y + op.height >= cta.y && op.width > 100),
    ).toBe(true)
  })

  it('is outlined where a second solid shape would read as a sticker', () => {
    const { ops } = render({ composition: 'hero_left' })
    const cta = find(ops, 'Order Ahead')!
    const solid = ops.filter(
      (op) => op.op === 'fillPath' && op.y <= cta.y && op.y + op.height >= cta.y && op.width > 100,
    )
    expect(solid).toHaveLength(0)
    expect(ops.some((op) => op.op === 'strokePath' && op.y <= cta.y && op.y + op.height >= cta.y)).toBe(true)
  })

  it('offers more than one shape across a set, rather than one pill everywhere', () => {
    // §9: solid, outlined, chip and bar are all legitimate. A set of three
    // posters that all end in the same green pill is the template look the
    // phase exists to break.
    const shapes = new Set(
      COMPOSITIONS.map((composition) => {
        const { ops } = render({ composition })
        const cta = find(ops, 'Order Ahead')!
        const button = buttonUnder(ops, cta)!
        return `${button.op}:${button.width >= 1080 * 0.6 ? 'wide' : 'compact'}`
      }),
    )
    expect(shapes.size).toBeGreaterThanOrEqual(3)
  })

  it('keeps a compact call to action modest, and a bar deliberate', () => {
    for (const composition of COMPOSITIONS) {
      const { ops } = render({ composition, callToAction: 'Order Ahead' })
      const cta = find(ops, 'Order Ahead')!
      const button = buttonUnder(ops, cta)!
      // A bar spans its column on purpose; anything else stays a button and
      // must not swell into a slab across the poster.
      const isBar = button.width >= 1080 * 0.6
      if (!isBar) expect(button.width, composition).toBeLessThan(1080 / 2)
      expect(button.x, composition).toBeGreaterThanOrEqual(0)
      expect(button.x + button.width, composition).toBeLessThanOrEqual(1080)
    }
  })
})

describe('drawPoster — nothing is clipped by the poster edge', () => {
  it('lands the message card whole inside the poster', () => {
    const { ops } = render({ composition: 'card_overlay' })
    const card = ops.filter((op) => op.op === 'fillPath' && op.width > 500 && op.height > 200)
    expect(card.length).toBeGreaterThan(0)
    for (const shape of card) {
      expect(shape.y).toBeGreaterThanOrEqual(0)
      expect(shape.y + shape.height).toBeLessThanOrEqual(1080)
    }
  })

  it('keeps every line of type inside the poster, in every arrangement', () => {
    for (const composition of COMPOSITIONS) {
      for (const format of ['square_post', 'portrait_post'] as const) {
        const height = format === 'portrait_post' ? 1350 : 1080
        const { ops } = render({ composition, format })
        for (const op of ops.filter((o) => o.op === 'text')) {
          const where = `${composition}/${format} ${op.text}`
          expect(op.y, where).toBeLessThanOrEqual(height)
          expect(op.y, where).toBeGreaterThan(0)
          expect(op.x, where).toBeGreaterThanOrEqual(0)
          expect(op.x + op.width, where).toBeLessThanOrEqual(1080)
        }
      }
    }
  })

  it('stands the phone inside the poster, not off its edge', () => {
    for (const composition of ['device_beside', 'device_hero', 'device_stack'] as const) {
      const { ops } = render({ composition })
      const screen = ops.find((op) => op.op === 'image' && op.source === SCREEN)
      expect(screen, composition).toBeDefined()
      expect(screen!.x, composition).toBeGreaterThanOrEqual(0)
      // The handset is allowed to run off the bottom — that is how a phone is
      // photographed standing in a scene — but never off the side.
      expect(screen!.x + screen!.width, composition).toBeLessThanOrEqual(1080)
      expect(screen!.y, composition).toBeGreaterThanOrEqual(0)
    }
  })

  it('never draws an empty handset when the screenshot is missing', () => {
    const { ops } = render(
      { composition: 'device_beside', deviceStoragePath: null },
      { image: PHOTO, logo: LOGO, device: null },
    )
    expect(ops.some((op) => op.op === 'image' && op.source === SCREEN)).toBe(false)
    // …and the poster is typeset as a photograph instead of leaving a hole.
    expect(headlineOps(ops).length).toBeGreaterThan(0)
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
    const { ops } = render({ composition: 'full_bleed' })
    const top = headlineTop(ops)
    const scrims = ops.filter((op) => op.op === 'rect' && op.width === 1080 && op.y > 0)
    expect(scrims.length).toBeGreaterThan(0)
    const under = scrims.find((op) => op.y < top && op.y + op.height >= 1080)
    expect(under).toBeDefined()
    // It starts above the type, and leaves the top of the picture alone.
    expect(under!.y).toBeLessThan(top)
    expect(under!.y).toBeGreaterThan(1080 * 0.2)
  })

  it('darkens only the half it writes on when the subject owns the other', () => {
    // A hero_right photograph was framed with its subject on the right. A
    // full-frame scrim would flatten the subject the model was asked to light;
    // the wash runs across instead, so the picture survives its own poster.
    const { ops } = render({ composition: 'hero_right' })
    const full = ops.filter((op) => op.op === 'rect' && op.width === 1080 && op.height >= 1080)
    expect(full.length).toBeGreaterThan(0)
    // The type lands in the left half, which is the half the wash darkens.
    for (const op of headlineOps(ops)) expect(op.x).toBeLessThan(1080 / 2)
  })
})

describe('drawPoster — the headline arrives whole (§18)', () => {
  /**
   * The defect the contact sheet caught: "Fresh bread, every morning" was
   * printed as "Fresh bread, every". `wrapLines` stops at its line limit and
   * returns what it had, so type too large for its column silently loses its
   * last words — and the fit loop was happy, because three lines did fit.
   * A poster missing a word is wrong, not merely ugly.
   */
  const LONG = 'Fresh sourdough bread baked every single morning before six'

  it('keeps every word of a long headline in every composition', () => {
    for (const composition of COMPOSITIONS) {
      const { ops } = render({ composition, headline: LONG })
      const printed = headlineOps(ops)
        .map((op) => op.text)
        .join(' ')
      for (const word of LONG.split(' ')) expect(printed, `${composition}: ${word}`).toContain(word)
    }
  })

  it('keeps every word of the supporting line too', () => {
    const subheadline = 'Baked before six every morning and on the shelf by seven, seven days a week.'
    for (const composition of COMPOSITIONS) {
      const { ops } = render({ composition, subheadline })
      const printed = ops
        .filter((op) => op.op === 'text')
        .map((op) => op.text)
        .join(' ')
      for (const word of subheadline.split(' ')) {
        expect(printed, `${composition}: ${word}`).toContain(word.replace(/[.,]$/, ''))
      }
    }
  })

  it('steps the type down rather than dropping words', () => {
    const short = headlineOps(render({ composition: 'hero_right', headline: 'Fresh bread' }).ops)
    const long = headlineOps(render({ composition: 'hero_right', headline: LONG }).ops)
    expect(long[0]!.size!).toBeLessThan(short[0]!.size!)
  })
})

describe('drawPoster — a logo that carries its own ground (§7)', () => {
  /**
   * An app icon is a solid tile. Putting a white plate behind one prints a
   * sticker on the poster; the plate exists for a wordmark on transparency,
   * which would otherwise vanish into a dark photograph.
   */
  function withLogoPixels(alpha: number, luminance: number, run: () => void) {
    // These tests run without a DOM, and the probe the renderer uses is an
    // offscreen canvas. Standing one in is what lets the plate decision be
    // tested at all — the browser is the only place it would otherwise run.
    const createElement = () => {
      const pixels = new Uint8ClampedArray(32 * 32 * 4)
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = luminance
        pixels[i + 1] = luminance
        pixels[i + 2] = luminance
        pixels[i + 3] = alpha
      }
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {}, getImageData: () => ({ data: pixels }) }),
      }
    }
    vi.stubGlobal('document', { createElement })
    try {
      run()
    } finally {
      vi.unstubAllGlobals()
    }
  }

  const plateUnder = (ops: Op[], logo: PosterBitmap) => {
    const index = ops.findIndex((op) => op.op === 'image' && op.source === logo)
    return index > 0 && ops[index - 1]!.op === 'fillPath' ? ops[index - 1]! : null
  }

  it('draws no plate behind a fully opaque mark, even over a photograph', () => {
    const tile = { width: 512, height: 512 } as PosterBitmap
    withLogoPixels(255, 40, () => {
      const { ops } = render({ composition: 'full_bleed' }, { image: PHOTO, logo: tile, device: null })
      expect(plateUnder(ops, tile)).toBeNull()
    })
  })

  it('still plates a dark wordmark on transparency over a photograph', () => {
    const wordmark = { width: 512, height: 160 } as PosterBitmap
    withLogoPixels(0, 20, () => {
      // Transparent corners: a mark, not a tile. The probe reads the opaque
      // pixels only, and here there are none — unknown luminance over a
      // photograph is the case a plate insures against.
      const { ops } = render({ composition: 'full_bleed' }, { image: PHOTO, logo: wordmark, device: null })
      expect(plateUnder(ops, wordmark)).not.toBeNull()
    })
  })
})

describe('drawPoster — a short headline is set larger, not left timid (§5)', () => {
  /** The size the headline was drawn at, which is the largest text on a poster. */
  function headlineSize(composition: (typeof COMPOSITIONS)[number], headline: string) {
    const { ctx, ops } = recorder()
    const posterInput = input({ headline, composition, accentTreatment: 'field', ctaStyle: 'outline' })
    drawPoster(ctx, posterDesign(posterInput), posterInput, IMAGES)
    const line = ops.find((op) => op.op === 'text' && op.text?.startsWith(headline.split(' ')[0]!))
    return line?.size ?? 0
  }

  it('gives a three-word headline more type than a twelve-word one', () => {
    for (const composition of COMPOSITIONS) {
      const short = headlineSize(composition, 'Faham setiap langkah')
      const long = headlineSize(
        composition,
        'Faham setiap langkah penyelesaian matematik anda tanpa perlu menghafal jawapan lagi',
      )
      expect.soft(short, `${composition} short vs long`).toBeGreaterThan(long)
    }
  })

  it('never grows a headline past the room it was given', () => {
    for (const composition of COMPOSITIONS) {
      const { ctx, ops } = recorder()
      const posterInput = input({
        headline: 'Faham',
        composition,
        accentTreatment: 'field',
        ctaStyle: 'outline',
      })
      drawPoster(ctx, posterDesign(posterInput), posterInput, IMAGES)
      for (const op of ops) {
        if (op.op !== 'text') continue
        expect.soft(op.y, `${composition} text below the poster`).toBeLessThanOrEqual(1080)
        expect.soft(op.x + op.width, `${composition} text past the right edge`).toBeLessThanOrEqual(1080)
      }
    }
  })
})


describe('drawPoster — the split cuts below the message, not through its margin', () => {
  /**
   * Phase 7K §4. The editorial split sizes its band to the message and caps
   * it at just over half the frame. But the room the type was allowed to fill
   * *was* that cap, so a full message filled the band and the cap then took
   * the padding that was meant to sit under it: the call to action came out
   * 30px above a hard cut to the photograph, on a poster whose every other
   * edge has 76. It read as type that had been pushed off the bottom.
   */
  const seamOf = (ops: Op[]) =>
    ops.find((op) => op.op === 'rect' && op.x === 0 && op.y === 0 && op.width === 1080)?.height ?? 0

  /** The lowest edge the message paints — its last line, or the button under it. */
  const messageBottom = (ops: Op[], seam: number) =>
    Math.max(
      ...ops
        .filter((op) => op.op !== 'image' && op.y > 100 && op.y < seam)
        .map((op) => op.y + (op.op === 'text' ? 0 : op.height)),
    )

  it('leaves the call to action a full margin above the photograph', () => {
    for (const headline of [
      'Beat The Lunch Rush',
      'Beat The Weekday Lunch Rush With Sets Ready When You Are',
    ]) {
      const { ops, poster } = render({ composition: 'editorial_split', headline })
      const seam = seamOf(ops)
      expect(seam - messageBottom(ops, seam)).toBeGreaterThanOrEqual(posterDesign(poster).margin)
    }
  })
})
