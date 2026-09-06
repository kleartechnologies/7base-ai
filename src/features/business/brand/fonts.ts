import { BRAND_FONTS, type BrandFont } from '@/types'

/**
 * Loads approved brand fonts from Google Fonts, the same host `index.html`
 * already uses for Inter. Only names from the closed BRAND_FONTS list are ever
 * requested — arbitrary font URLs and uploads are out of scope by design.
 *
 * Loading is best-effort: every face is declared with a system fallback stack
 * (see `posterSpec.HEADING_STACK` and the BrandBoard styles), so a blocked or
 * slow font costs fidelity, never functionality.
 */

const LINK_ATTR = 'data-brand-font'

export function ensureBrandFontsLoaded(fonts: (BrandFont | null | undefined)[]): void {
  if (typeof document === 'undefined') return
  const wanted = [...new Set(fonts.filter(isApproved))]
  for (const font of wanted) {
    const id = font.replace(/\s+/g, '-').toLowerCase()
    if (document.querySelector(`link[${LINK_ATTR}="${id}"]`)) continue
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.setAttribute(LINK_ATTR, id)
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(
      /%20/g,
      '+',
    )}:wght@400;600;700&display=swap`
    document.head.appendChild(link)
  }
}

/**
 * Best-effort wait for the faces a canvas render needs, so the poster is not
 * rasterised mid-swap. Resolves quickly (or immediately) when the Font
 * Loading API is unavailable or the font never arrives.
 */
export async function waitForBrandFonts(
  fonts: (string | null | undefined)[],
  timeoutMs = 1500,
): Promise<void> {
  const approved = [...new Set(fonts.filter(isApproved))]
  if (approved.length === 0 || typeof document === 'undefined' || !('fonts' in document)) return
  ensureBrandFontsLoaded(approved)
  const loads = approved.flatMap((font) => [
    document.fonts.load(`600 24px '${font}'`),
    document.fonts.load(`400 16px '${font}'`),
  ])
  await Promise.race([
    Promise.allSettled(loads),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ])
}

function isApproved(font: string | null | undefined): font is BrandFont {
  return typeof font === 'string' && (BRAND_FONTS as readonly string[]).includes(font)
}
