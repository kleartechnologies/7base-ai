import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Brand Identity's wiring across module boundaries (Phase 7D). Vitest runs
 * with no DOM, so the UI checks are source-level — the streamingWiring
 * approach: pin that Brand Identity actually reaches creative generation,
 * that the client cannot inject brand values into a request, and that the
 * board stays theme-independent.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('creative generation inherits Brand Identity server-side', () => {
  const generate = read('../../../../functions/src/creative/generate.ts')

  it('reads the kit from the server-fetched business document', () => {
    expect(generate).toContain('readBrandKit(business)')
  })

  it('prefers the official logo reference when selecting the logo asset', () => {
    expect(generate).toContain('selectLogoAsset(assets, brandKit?.logoAssetId ?? null)')
  })

  it('resolves palette and fonts through the brand resolver and stamps brandApplied', () => {
    expect(generate).toContain('resolveBrandStyle(business)')
    expect(generate).toContain('brandApplied: brandAppliedSummary(business')
  })

  it('feeds the owner brand style line into the copy prompt', () => {
    expect(generate).toContain('brandStyle: brandStyleLine(business)')
  })

  it('the request still carries only campaignId and format — injection is impossible', () => {
    // The callable reads nothing else off request.data, so the authoritative
    // Brand Identity can only come from the server-fetched business document.
    const reads = generate.match(/request\.data[?]?\.?\w*/g) ?? []
    expect(reads.length).toBeGreaterThan(0)
    for (const readSite of reads) {
      expect(['request.data', 'request.data?', 'request.data?.format']).toContain(readSite)
    }
    expect(generate).toContain('const { campaignId } = request.data ?? {}')
    expect(generate).toContain('const { creativeId } = request.data ?? {}')
    expect(generate).not.toMatch(/request\.data[?.]*\s*\.\s*(brand|logo|color|palette|font)/i)
  })
})

describe('image and chat prompts see the same resolved brand', () => {
  it('image prompts take palette and visual style from the resolvers', () => {
    const image = read('../../../../functions/src/creative/image.ts')
    expect(image).toContain('resolveBrandStyle(')
    expect(image).toContain('resolveVisualStyle(')
  })

  it('EVA’s chat context carries the owner-set Brand Identity with the on-brand default', () => {
    const context = read('../../../../functions/src/ai/context.ts')
    expect(context).toContain('BRAND IDENTITY — SET BY THE OWNER')
    expect(context).toContain('one-off exception')
  })
})

describe('client surface', () => {
  it('the Business page routes both tabs to the same page component', () => {
    const router = read('../../../app/router.tsx')
    expect(router).toContain("path: 'business/brand'")
    const paths = read('../../../app/routes/paths.ts')
    expect(paths).toContain("businessBrand: '/business/brand'")
  })

  it('the tab bar switches on the route and guards unsaved brand edits', () => {
    const page = read('../../../pages/BusinessPage.tsx')
    expect(page).toContain('ROUTES.businessBrand')
    expect(page).toContain("t('brand.unsavedGuard')")
    expect(page).toContain('BrandIdentityTab')
  })

  it('the brand board is theme-independent — literal colours, no theme classes', () => {
    const board = read('./BrandBoard.tsx')
    expect(board).not.toContain('dark:')
    expect(board).not.toContain('var(--')
    // The board paints its own ground rather than inheriting the app theme.
    expect(board).toContain("'#ffffff'")
  })

  it('saving a kit goes through the businesses service patch, not a new write path', () => {
    const service = read('../../../services/business/business.service.ts')
    expect(service).toContain('export async function saveBrandKit')
  })

  it('the poster pipeline honours the kit fonts', () => {
    const posterSpec = read('../../creative/posterSpec.ts')
    expect(posterSpec).toContain('style?.bodyFont')
    const poster = read('../../creative/poster.ts')
    expect(poster).toContain('waitForBrandFonts')
  })

  it('the applied panel renders only from the server-stamped summary', () => {
    const creativePage = read('../../../pages/CreativePage.tsx')
    expect(creativePage).toContain('creative.style.brandApplied ?')
    const panel = read('../../creative/BrandAppliedPanel.tsx')
    expect(panel).toContain('ROUTES.businessBrand')
  })

  it('logo upload rides the existing Assets pipeline, typed logo after the fact', () => {
    const logo = read('./LogoSection.tsx')
    expect(logo).toContain('createAssetFromFile(')
    expect(logo).toContain("updateAssetMetadata(created.id, { type: 'logo' })")
    // Remove clears the reference — no Asset delete call in this file.
    expect(logo).not.toContain('deleteAsset')
  })
})
