import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Phase 7G §1 — pages scroll.
 *
 * The shell is a fixed viewport-height flex column with `overflow-hidden`,
 * so a page that simply grows was clipped at the bottom with no way to
 * reach the rest — that was the Creative page's bug, and it was latent in
 * every page that had not remembered to open a scroller of its own.
 *
 * The fix is architectural: the shell's `main` is the one page scroller.
 * These assertions keep it that way — one scroller, no page re-opening a
 * second one, and no page pinned to a viewport height inside it.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const shell = read('./AppShell.tsx')

const PAGES_DIR = new URL('../../pages/', import.meta.url)
const pages = readdirSync(PAGES_DIR)
  .filter((file) => file.endsWith('.tsx'))
  .map((file) => ({ file, source: readFileSync(new URL(file, PAGES_DIR), 'utf8') }))

describe('the shell owns the page scroll', () => {
  it('main is the scroll container, and can shrink so it really scrolls', () => {
    const main = shell.match(/<main className="([^"]*)"/)?.[1] ?? ''
    expect(main).toContain('overflow-y-auto')
    // Without min-h-0 a flex child refuses to shrink below its content and
    // the scroll never engages — the content just overflows the clip.
    expect(main).toContain('min-h-0')
    expect(main).toContain('flex-1')
    // Positioned descendants stay inside the scroller rather than growing
    // the document behind the shell.
    expect(main).toContain('relative')
  })

  it('the shell still clips at the viewport, so the app itself never scrolls', () => {
    expect(shell).toContain('flex h-svh overflow-hidden')
  })

  it('no page opens a second scroller or pins itself to the viewport', () => {
    for (const { file, source } of pages) {
      // NotFoundPage renders outside the shell.
      if (file === 'NotFoundPage.tsx') continue
      expect(source, file).not.toContain('overflow-y-auto')
      expect(source, file).not.toContain('h-screen')
      expect(source, file).not.toContain('h-svh')
      expect(source, file).not.toContain('min-h-svh')
    }
  })

  it('chat is the one page that fills the height and scrolls its own list', () => {
    const chat = read('../chat/ChatPage.tsx')
    expect(chat).toContain('flex h-full min-h-0 flex-col')
    expect(chat).toContain('min-h-0 flex-1 overflow-y-auto')
  })

  it('the creative library is a plain growing page', () => {
    const creative = read('../../pages/CreativePage.tsx')
    expect(creative).toMatch(/<div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-12">/)
    // It grows with its cards — no viewport height, no padding stunt to
    // make room, no scroller of its own.
    expect(creative).not.toMatch(/min-h-(?:screen|svh|\[)/)
    expect(creative).not.toContain('overflow-y-auto')
  })
})
