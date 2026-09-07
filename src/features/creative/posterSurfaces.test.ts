import { describe, expect, it } from 'vitest'

import type { Creative } from '@/types'
import { posterDesign, posterInput } from './posterDesign'
import { drawPoster, type PosterBitmap, type PosterImages } from './posterDraw'

/**
 * Phase 7G.1 §17/§21 — one creative, one poster, on every surface.
 *
 * The bug: the same creative appeared with a red call to action in the chat
 * and a green one on the Creative page. It was never a rendering bug. The
 * chat card composed its own overlay from the message snapshot and passed
 * `style: null`, so its accent came from a hard-coded fallback
 * (`firstUsableColor(null) ?? '#C2410C'`) while the library drew the brand
 * palette off the creative document.
 *
 * `posterCanonical.test.ts` pins the architecture that made that possible —
 * no surface composes a poster of its own. This file pins the *result*: the
 * pixels a surface draws are a function of the creative and nothing else, so
 * the two can never disagree again even if a new surface appears.
 */

interface Op {
  op: string
  x: number
  y: number
  width: number
  height: number
  style: string
  text?: string
  size?: number
}

/** A 2D context that records instead of painting, optionally scaled as the preview is. */
function recorder(scale = 1) {
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
    canvas: { width: 1080 * scale, height: 1080 * scale },
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
    scale: () => {},
    translate: () => {},
    rotate: () => {},
    measureText: (text: string) => ({ width: text.length * size() * 0.5 }),
    fillText(text: string, x: number, y: number) {
      ops.push({ op: 'text', x, y, width: 0, height: size(), style: String(ctx.fillStyle), text, size: size() })
    },
    fillRect(x: number, y: number, width: number, height: number) {
      ops.push({ op: 'rect', x, y, width, height, style: String(ctx.fillStyle) })
    },
    drawImage(_source: unknown, x: number, y: number, width: number, height: number) {
      ops.push({ op: 'image', x, y, width, height, style: '' })
    },
    beginPath() {
      box.minX = Infinity
      box.minY = Infinity
      box.maxX = -Infinity
      box.maxY = -Infinity
    },
    moveTo: extend,
    lineTo: extend,
    arcTo: (x1: number, y1: number, x2: number, y2: number) => {
      extend(x1, y1)
      extend(x2, y2)
    },
    arc: (x: number, y: number, r: number) => {
      extend(x - r, y - r)
      extend(x + r, y + r)
    },
    rect: (x: number, y: number, w: number, h: number) => {
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

const IMAGES: PosterImages = {
  image: { width: 1024, height: 1024 } as PosterBitmap,
  logo: { width: 512, height: 160 } as PosterBitmap,
  device: null,
}

/** The Matheasy creative as it is stored — green palette, app screenshot. */
function creative(overrides: Partial<Creative> = {}): Creative {
  return {
    id: 'creative-1',
    businessId: 'biz-1',
    campaignId: 'camp-1',
    name: 'Scan. Selesai. Faham.',
    status: 'ready',
    content: {
      format: 'square_post',
      headline: 'Scan. Selesai. Faham.',
      subheadline: 'Penyelesaian langkah demi langkah untuk setiap soalan.',
      callToAction: 'Muat turun',
      offerText: null,
      imageAltText: 'A student scanning a question',
      image: { storagePath: 'businesses/biz-1/creatives/creative-1.png', assetId: null, source: 'generated' },
      deviceImage: null,
    },
    style: {
      palette: ['#22c55e', '#0f172a'],
      headingFont: 'Poppins',
      bodyFont: 'Inter',
      logoStoragePath: 'businesses/biz-1/assets/logo.png',
      direction: 'app_showcase',
      artDirection: { composition: 'device_beside', accent: 'emphasis_word', cta: 'solid', device: true },
    },
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    ...overrides,
  } as Creative
}

/** Everything a surface does before drawing, done the one way there is. */
function drawSurface(source: Creative, scale = 1) {
  const input = posterInput(source)
  const design = posterDesign(input)
  const { ctx, ops } = recorder(scale)
  drawPoster(ctx, design, input, IMAGES)
  return ops
}

describe('the same creative draws the same poster on every surface', () => {
  it('produces an identical operation stream for chat, library and download', () => {
    // The three surfaces differ only in where the creative came from: the
    // chat looks it up by id, the page reads it from the collection, the
    // download takes the object it was handed. Same document, same poster.
    const stored = creative()
    const fromChatLookup = drawSurface({ ...stored })
    const fromLibraryQuery = drawSurface(JSON.parse(JSON.stringify(stored)) as Creative)
    const fromDownload = drawSurface(stored)
    expect(fromLibraryQuery).toEqual(fromChatLookup)
    expect(fromDownload).toEqual(fromChatLookup)
  })

  it('paints the brand green, and never the fallback the chat used to reach for', () => {
    const ops = drawSurface(creative())
    const colours = ops.map((op) => op.style.toLowerCase())
    // #C2410C — the burnt orange a styleless surface fell back to.
    expect(colours).not.toContain('#c2410c')
    expect(colours.some((colour) => colour.includes('22c55e'))).toBe(true)
  })

  it('changes colour only when the creative’s palette changes', () => {
    const green = drawSurface(creative())
    const red = drawSurface(
      creative({
        style: { ...creative().style, palette: ['#dc2626'] },
      } as Partial<Creative>),
    )
    // Same geometry, different colour: the palette is the only input that
    // moved, and it moved nothing else.
    expect(red.map(({ x, y, width, height }) => ({ x, y, width, height }))).toEqual(
      green.map(({ x, y, width, height }) => ({ x, y, width, height })),
    )
    expect(red.map((op) => op.style)).not.toEqual(green.map((op) => op.style))
  })

  it('draws the preview and the export at the same proportions', () => {
    // The chat card draws into a small canvas and the download into a
    // 1080px one, by scaling the context — not by laying out differently.
    const exported = drawSurface(creative(), 1)
    const preview = drawSurface(creative(), 0.35)
    expect(preview).toEqual(exported)
  })

  it('honours the composition the server persisted, on every surface alike', () => {
    const band = drawSurface(
      creative({
        style: {
          ...creative().style,
          artDirection: { composition: 'bottom_band', accent: 'field', cta: 'outline', device: false },
        },
      } as Partial<Creative>),
    )
    const split = drawSurface(
      creative({
        style: {
          ...creative().style,
          artDirection: { composition: 'editorial_split', accent: 'field', cta: 'outline', device: false },
        },
      } as Partial<Creative>),
    )
    expect(band).not.toEqual(split)
  })
})
