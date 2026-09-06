import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/firebase', () => ({
  COLLECTIONS: { assets: 'assets' },
  db: {},
  storageBucket: () => ({}),
}))

import type { VisualCandidate } from './evidence'
import { asset, BUSINESS_ID, OWNER_ID } from './fixtures'
import { MAX_ASSET_VISUAL_BYTES, resolveVisualEvidence, type VisualResolveDeps } from './visuals'

/**
 * Bytes for the model come from two places only: our own bucket (an Asset
 * re-verified for ownership, business, status, AI-use and path) or the
 * SSRF-guarded image fetcher (a URL a source exposed). Anything that fails
 * is dropped; the survivors are numbered img1… in selection order.
 */

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')
const scope = { businessId: BUSINESS_ID, ownerId: OWNER_ID }

function deps(over: Partial<VisualResolveDeps> = {}): VisualResolveDeps & {
  fetchImage: ReturnType<typeof vi.fn>
  downloadBytes: ReturnType<typeof vi.fn>
} {
  return {
    getAsset: vi.fn(async () => asset({ contentType: 'image/png' })),
    downloadBytes: vi.fn(async () => PNG),
    fetchImage: vi.fn(async () => ({ contentType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/' })),
    ...over,
  } as VisualResolveDeps & { fetchImage: ReturnType<typeof vi.fn>; downloadBytes: ReturnType<typeof vi.fn> }
}

const assetCandidate: VisualCandidate = {
  role: 'asset',
  sourceType: 'asset',
  ref: 'a1',
  assetId: 'a1',
  assetType: 'photo',
  label: 'uploaded asset',
}
const pageCandidate: VisualCandidate = {
  role: 'hero',
  sourceType: 'website',
  ref: 'https://warungmakcik.com/img/hero.jpg',
  assetId: null,
  assetType: null,
  label: 'website hero',
}

describe('resolveVisualEvidence', () => {
  it('numbers survivors img1… in selection order and keeps candidate fields', async () => {
    const d = deps()
    const resolved = await resolveVisualEvidence({ candidates: [pageCandidate, assetCandidate], ...scope }, d)
    expect(resolved.map((v) => [v.id, v.role, v.contentType])).toEqual([
      ['img1', 'hero', 'image/jpeg'],
      ['img2', 'asset', 'image/png'],
    ])
    expect(resolved[1]?.dataUrl).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
    expect(d.fetchImage).toHaveBeenCalledWith(pageCandidate.ref)
    expect(d.downloadBytes).toHaveBeenCalledWith(`businesses/${BUSINESS_ID}/assets/asset_1/rendang.jpg`)
  })

  it('drops a page image the guarded fetcher refused, and renumbers', async () => {
    const d = deps({ fetchImage: vi.fn(async () => null) })
    const resolved = await resolveVisualEvidence({ candidates: [pageCandidate, assetCandidate], ...scope }, d)
    expect(resolved.map((v) => v.id)).toEqual(['img1'])
    expect(resolved[0]?.role).toBe('asset')
  })

  it.each([
    ['another owner', asset({ contentType: 'image/png', ownerId: 'someone_else' })],
    ['another business', asset({ contentType: 'image/png', businessId: 'biz_other' })],
    ['archived', asset({ contentType: 'image/png', status: 'archived' })],
    ['AI use disallowed', asset({ contentType: 'image/png', allowAiUse: false })],
    ['a PDF', asset({ contentType: 'application/pdf' })],
    ['too large', asset({ contentType: 'image/png', sizeBytes: MAX_ASSET_VISUAL_BYTES + 1 })],
    ['path outside the business', asset({ contentType: 'image/png', storagePath: 'businesses/biz_other/assets/x/y.png' })],
  ])('never downloads an Asset that is %s', async (_label, stored) => {
    const d = deps({ getAsset: vi.fn(async () => stored) })
    const resolved = await resolveVisualEvidence({ candidates: [assetCandidate], ...scope }, d)
    expect(resolved).toEqual([])
    expect(d.downloadBytes).not.toHaveBeenCalled()
  })

  it('drops a missing Asset, a failed download and empty bytes without throwing', async () => {
    expect(
      await resolveVisualEvidence({ candidates: [assetCandidate], ...scope }, deps({ getAsset: vi.fn(async () => null) })),
    ).toEqual([])
    expect(
      await resolveVisualEvidence(
        { candidates: [assetCandidate], ...scope },
        deps({ downloadBytes: vi.fn(async () => { throw new Error('boom') }) }),
      ),
    ).toEqual([])
    expect(
      await resolveVisualEvidence(
        { candidates: [assetCandidate], ...scope },
        deps({ downloadBytes: vi.fn(async () => Buffer.alloc(0)) }),
      ),
    ).toEqual([])
  })

  it('refuses a page image whose type is not an accepted raster type', async () => {
    const d = deps({ fetchImage: vi.fn(async () => ({ contentType: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' })) })
    expect(await resolveVisualEvidence({ candidates: [pageCandidate], ...scope }, d)).toEqual([])
  })
})
