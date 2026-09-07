import { posterDesign, posterInput } from '@/features/creative/posterDesign'
import { drawPoster, type PosterImages } from '@/features/creative/posterDraw'
import type { Creative } from '@/types'

/**
 * The browser half of the visual harness: draws fixture creatives through the
 * real renderer onto a contact sheet, which `render.mjs` screenshots.
 *
 * It calls `posterInput` → `posterDesign` → `drawPoster`, exactly as
 * `PosterCanvas` does, so what lands in the screenshot is the picture the
 * owner sees in chat, on the Creative page and in the download. Nothing here
 * may reimplement a layout decision — the moment it does, the harness stops
 * telling the truth.
 */

declare global {
  interface Window {
    __renderPosters: (creatives: Creative[], images: Record<string, string>) => Promise<void>
    __renderLive: (
      entries: { creative: Creative; imageKey: string; meta: string }[],
      images: Record<string, string>,
    ) => Promise<void>
    __posterSheetReady?: boolean
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`failed to load ${src.slice(0, 40)}`))
    image.src = src
  })
}

window.__renderPosters = async (creatives, images) => {
  const bitmaps = new Map<string, HTMLImageElement>()
  await Promise.all(
    Object.entries(images).map(async ([key, src]) => {
      bitmaps.set(key, await loadImage(src))
    }),
  )

  const sheet = document.getElementById('sheet')!
  for (const creative of creatives) {
    const input = posterInput(creative)
    const design = posterDesign(input)

    const cell = document.createElement('figure')
    cell.className = 'cell'
    const canvas = document.createElement('canvas')
    canvas.width = design.width
    canvas.height = design.height
    const ctx = canvas.getContext('2d')!
    const posterImages: PosterImages = {
      image: (input.imageStoragePath && bitmaps.get(input.imageStoragePath)) || null,
      logo: (input.logoStoragePath && bitmaps.get(input.logoStoragePath)) || null,
      device: (input.deviceStoragePath && bitmaps.get(input.deviceStoragePath)) || null,
    }
    drawPoster(ctx, design, input, posterImages)

    const caption = document.createElement('figcaption')
    caption.textContent = `${creative.name} · ${input.direction ?? 'no direction'} · ${design.composition} · ${design.ctaStyle} · ${input.format}`
    cell.append(canvas, caption)
    sheet.append(cell)
  }
  window.__posterSheetReady = true
}

/**
 * Phase 7G.2 §3: the same renderer, but each row shows the raw generated
 * photograph beside the finished poster and the decisions that made it. A
 * defect can then be pinned to the generation, the art direction or the
 * composition instead of being argued about.
 */
window.__renderLive = async (entries, images) => {
  const bitmaps = new Map<string, HTMLImageElement>()
  await Promise.all(
    Object.entries(images).map(async ([key, src]) => {
      bitmaps.set(key, await loadImage(src))
    }),
  )

  const sheet = document.getElementById('sheet')!
  for (const entry of entries) {
    const input = posterInput(entry.creative)
    const design = posterDesign(input)

    const row = document.createElement('section')
    row.className = 'row'

    const raw = document.createElement('figure')
    raw.className = 'cell'
    const rawImage = bitmaps.get(entry.imageKey)
    if (rawImage) raw.append(rawImage.cloneNode(true))
    const rawCaption = document.createElement('figcaption')
    rawCaption.textContent = 'A — the generated photograph'
    raw.append(rawCaption)

    const posterCell = document.createElement('figure')
    posterCell.className = 'cell'
    const canvas = document.createElement('canvas')
    canvas.width = design.width
    canvas.height = design.height
    const ctx = canvas.getContext('2d')!
    drawPoster(ctx, design, input, {
      image: (input.imageStoragePath && bitmaps.get(input.imageStoragePath)) || null,
      logo: (input.logoStoragePath && bitmaps.get(input.logoStoragePath)) || null,
      device: (input.deviceStoragePath && bitmaps.get(input.deviceStoragePath)) || null,
    })
    const posterCaption = document.createElement('figcaption')
    posterCaption.textContent = 'C — the poster the owner receives'
    posterCell.append(canvas, posterCaption)

    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.innerHTML = entry.meta
    row.append(raw, posterCell, meta)
    sheet.append(row)
  }
  window.__posterSheetReady = true
}
