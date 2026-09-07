import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiResult, DownloadCreativeImageResponse } from '@/services/ai/ai.types'
import type { Creative } from '@/types'

// poster.ts imports the callable client for its default deps; the tests
// inject their own fakes, so the real client (and Firebase) never loads.
vi.mock('@/services/ai/ai.client', () => ({ downloadCreativeImage: vi.fn() }))

import { downloadCreativePoster } from './poster'
import { posterDesign, posterInput } from './posterDesign'

/**
 * The download orchestration: the persisted creative in, the shared
 * renderer's PNG out — direct Storage bitmaps first, backend bytes as the
 * fallback. Driven on fakes: what is under test is the cascade order, that
 * the renderer is handed the same design the preview draws, that backend
 * bytes become same-origin blob URLs (and are revoked), that a poster with
 * no visual is not retried through the backend, and that a backend refusal
 * surfaces as a single safe error.
 */

function creative(overrides: Partial<Creative> = {}): Creative {
  return {
    id: 'c1',
    ownerId: 'u1',
    businessId: 'b1',
    campaignId: 'camp1',
    conversationId: null,
    sourceRecommendationId: null,
    name: 'Lunch Poster',
    format: 'square_post',
    status: 'ready',
    content: {
      headline: 'A proper lunch',
      subheadline: null,
      body: null,
      callToAction: null,
      offerText: null,
      image: {
        storagePath: 'businesses/b1/creatives/x.png',
        prompt: null,
        altText: 'lunch',
        source: 'generated',
      },
      layout: 'image_full_bleed',
    },
    captions: { facebook: null, instagram: null, short: null, whatsapp: null },
    style: {
      palette: ['#16a34a'],
      headingFont: null,
      bodyFont: null,
      logoStoragePath: null,
    },
    render: null,
    userEdited: [],
    ownerDirectives: [],
    imageError: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Creative
}

const IMAGE_B64 = Buffer.from('image-bytes').toString('base64')
const LOGO_B64 = Buffer.from('logo-bytes').toString('base64')

function okResult(
  overrides: Partial<DownloadCreativeImageResponse> = {},
): AiResult<DownloadCreativeImageResponse> {
  return {
    ok: true,
    data: {
      image: { contentType: 'image/png', base64: IMAGE_B64 },
      logo: null,
      ...overrides,
    },
  }
}

const created: Blob[] = []
const revoked: string[] = []

beforeEach(() => {
  created.length = 0
  revoked.length = 0
  const RealURL = globalThis.URL
  class MockURL extends RealURL {
    static override createObjectURL(blob: Blob): string {
      created.push(blob)
      return `blob:mock-${created.length}`
    }
    static override revokeObjectURL(url: string): void {
      revoked.push(url)
    }
  }
  vi.stubGlobal('URL', MockURL)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const BITMAP = { width: 10, height: 10 } as unknown as HTMLImageElement
const blob = () => new Blob(['png'], { type: 'image/png' })

describe('downloadCreativePoster', () => {
  it('uses only the direct route when it succeeds, and saves under the creative name', async () => {
    const loadImages = vi.fn().mockResolvedValue({ image: BITMAP, logo: null })
    const render = vi.fn().mockResolvedValue(blob())
    const fetchImageBytes = vi.fn()
    const save = vi.fn()

    await downloadCreativePoster(creative(), { loadImages, render, fetchImageBytes, save })

    expect(loadImages).toHaveBeenCalledWith({
      imageStoragePath: 'businesses/b1/creatives/x.png',
      logoStoragePath: null,
    })
    expect(fetchImageBytes).not.toHaveBeenCalled()
    expect(save.mock.calls[0]![1]).toBe('lunch-poster-square.png')
  })

  it('renders the download from the same design the preview draws', async () => {
    const subject = creative({
      style: {
        palette: ['#16a34a'],
        headingFont: 'Poppins',
        bodyFont: null,
        logoStoragePath: 'businesses/b1/logo.png',
      },
    } as Partial<Creative>)
    const render = vi.fn().mockResolvedValue(blob())

    await downloadCreativePoster(subject, {
      loadImages: vi.fn().mockResolvedValue({ image: BITMAP, logo: BITMAP }),
      render,
      save: vi.fn(),
    })

    const [design, input] = render.mock.calls[0]!
    expect(design).toEqual(posterDesign(posterInput(subject)))
    expect(input).toEqual(posterInput(subject))
    // The brand colour is the poster's accent, not a client default.
    expect(design.palette.accent).toBe('#16a34a')
    expect(design.width).toBe(1080)
  })

  it('falls back to backend bytes and renders from blob URLs', async () => {
    const render = vi.fn().mockResolvedValue(blob())
    const loadFromUrl = vi.fn().mockResolvedValue(BITMAP)
    const fetchImageBytes = vi.fn().mockResolvedValue(okResult())

    await downloadCreativePoster(creative(), {
      loadImages: vi.fn().mockRejectedValue(new Error('poster image failed to load')),
      render,
      fetchImageBytes,
      loadFromUrl,
      save: vi.fn(),
    })

    expect(fetchImageBytes).toHaveBeenCalledWith('c1')
    expect(loadFromUrl).toHaveBeenCalledWith('blob:mock-1')
    expect(render.mock.calls[0]![2]).toEqual({ image: BITMAP, logo: null })
    // The blob really carries the backend's bytes and type.
    expect(created[0]!.type).toBe('image/png')
    expect(created[0]!.size).toBe('image-bytes'.length)
    // Nothing leaks: every minted URL is revoked again.
    expect(revoked).toEqual(['blob:mock-1'])
  })

  it('composites the backend logo only where the creative has one', async () => {
    const withLogo = creative({
      style: {
        palette: null,
        headingFont: null,
        bodyFont: null,
        logoStoragePath: 'businesses/b1/logo.png',
      },
    } as Partial<Creative>)
    const render = vi.fn().mockResolvedValue(blob())

    await downloadCreativePoster(withLogo, {
      loadImages: vi.fn().mockRejectedValue(new Error('nope')),
      render,
      fetchImageBytes: vi
        .fn()
        .mockResolvedValue(okResult({ logo: { contentType: 'image/png', base64: LOGO_B64 } })),
      loadFromUrl: vi.fn().mockResolvedValue(BITMAP),
      save: vi.fn(),
    })

    expect(render.mock.calls[0]![2]).toEqual({ image: BITMAP, logo: BITMAP })
    expect(revoked).toEqual(['blob:mock-1', 'blob:mock-2'])
  })

  it('ignores a backend logo when the creative carries none', async () => {
    const render = vi.fn().mockResolvedValue(blob())

    await downloadCreativePoster(creative(), {
      loadImages: vi.fn().mockRejectedValue(new Error('nope')),
      render,
      fetchImageBytes: vi
        .fn()
        .mockResolvedValue(okResult({ logo: { contentType: 'image/png', base64: LOGO_B64 } })),
      loadFromUrl: vi.fn().mockResolvedValue(BITMAP),
      save: vi.fn(),
    })

    expect(render.mock.calls[0]![2]!.logo).toBeNull()
    expect(revoked).toEqual(['blob:mock-1'])
  })

  it('does not ask the backend about a poster that has no visual', async () => {
    const fetchImageBytes = vi.fn()
    const textOnly = creative({
      content: { ...creative().content, image: null },
    } as Partial<Creative>)

    await expect(
      downloadCreativePoster(textOnly, {
        loadImages: vi.fn().mockResolvedValue({ image: null, logo: null }),
        render: vi.fn().mockRejectedValue(new Error('canvas unavailable')),
        fetchImageBytes,
        save: vi.fn(),
      }),
    ).rejects.toThrow('canvas unavailable')
    expect(fetchImageBytes).not.toHaveBeenCalled()
  })

  it('surfaces one safe error when the backend refuses', async () => {
    const render = vi.fn().mockRejectedValue(new Error('nope'))
    const fetchImageBytes = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'permission_denied', message: 'You do not have access to that.' },
    })

    await expect(
      downloadCreativePoster(creative(), {
        loadImages: vi.fn().mockResolvedValue({ image: BITMAP, logo: null }),
        render,
        fetchImageBytes,
        save: vi.fn(),
      }),
    ).rejects.toThrow('poster download failed')
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('revokes blob URLs even when the fallback render fails', async () => {
    await expect(
      downloadCreativePoster(creative(), {
        loadImages: vi.fn().mockRejectedValue(new Error('nope')),
        render: vi.fn().mockRejectedValue(new Error('canvas export failed')),
        fetchImageBytes: vi.fn().mockResolvedValue(okResult()),
        loadFromUrl: vi.fn().mockResolvedValue(BITMAP),
        save: vi.fn(),
      }),
    ).rejects.toThrow()
    expect(revoked).toEqual(['blob:mock-1'])
  })
})
