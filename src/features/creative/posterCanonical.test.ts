import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Phase 7G §2/§16 — one creative, one picture.
 *
 * The poster the owner sees in the chat, on the Creative page, on the
 * campaign page and in the downloaded file must be the *same* poster: the
 * persisted creative, drawn by the shared renderer. The bug this pins down
 * was a real one — the chat composed its own overlay from the message
 * snapshot with no palette and no logo, so the same creative appeared
 * orange in the thread and green in the library.
 *
 * These are source-level assertions because the rule is architectural: no
 * surface may compose a poster of its own.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const SURFACES: { name: string; source: string }[] = [
  { name: 'CreativeCard', source: read('./CreativeCard.tsx') },
  { name: 'CreativePage', source: read('../../pages/CreativePage.tsx') },
  { name: 'CampaignDetailPage', source: read('../../pages/CampaignDetailPage.tsx') },
  { name: 'CreativeSetCard', source: read('../chat/components/blocks/CreativeSetCard.tsx') },
  { name: 'CreativePreview', source: read('../chat/components/blocks/CreativePreview.tsx') },
]

describe('every surface draws the persisted creative through the shared renderer', () => {
  it('renders posters with PosterCanvas, never a hand-composed overlay', () => {
    for (const { name, source } of SURFACES) {
      // Either it draws through the shared renderer, or it delegates to the
      // one card that does. Nothing in between.
      expect(source, name).toMatch(/PosterCanvas|LivePosterFrame|<CreativeCard/)
      // No surface paints its own poster: no <img> ground, no scrim, no
      // inline accent chips over one.
      expect(source, name).not.toContain('object-cover')
      expect(source, name).not.toContain('bg-gradient-to-t from-black')
      expect(source, name).not.toContain('firstUsableColor')
      expect(source, name).not.toContain('readableTextOn')
    }
  })

  it('the chat reads the creative by id rather than rendering its own snapshot', () => {
    for (const file of ['CreativeSetCard', 'CreativePreview']) {
      const source = SURFACES.find((s) => s.name === file)!.source
      expect(source, file).toContain('useLivePoster(')
      // The block's copy fields are no longer painted onto a poster here.
      expect(source, file).not.toMatch(/block\.headline|item\.headline/)
    }
  })

  it('the download takes the whole creative — no per-surface style argument', () => {
    const poster = read('./poster.ts')
    expect(poster).toContain('export async function downloadCreativePoster(\n  creative: Creative,')
    expect(poster).toContain('posterInput(creative)')
    expect(poster).toContain('posterDesign(input)')
    // The bug that made chat downloads differ: a caller passing no style.
    for (const { name, source } of SURFACES) {
      expect(source, name).not.toContain('style: null')
    }
  })

  it('the renderer is the only place a poster is drawn', () => {
    const canvas = read('./PosterCanvas.tsx')
    const poster = read('./poster.ts')
    expect(canvas).toContain('drawPoster(ctx, design, input, images)')
    expect(poster).toContain('drawPoster(ctx, design, input, images)')
    // Both take their image bitmaps from the same loader, keyed by storage
    // path, so the preview and the export are the same file.
    expect(canvas).toContain('loadPosterImages')
    expect(poster).toContain('loadPosterImages')
  })

  it('the logo is always the owner’s file, drawn as-is', () => {
    const draw = read('./posterDraw.ts')
    // Aspect ratio preserved, never stretched to a box.
    expect(draw).toContain('Math.min(LOGO_MAX_WIDTH / logo.width, LOGO_MAX_HEIGHT / logo.height')
    expect(draw).toContain('ctx.drawImage(logo')
  })
})
