import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiResult, DownloadCreativeImageResponse } from '@/services/ai/ai.types'

// poster.ts imports the callable client for its default deps; the tests
// inject their own fakes, so the real client (and Firebase) never loads.
vi.mock('@/services/ai/ai.client', () => ({ downloadCreativeImage: vi.fn() }))

import { downloadCreativePoster, type PosterContent } from './poster'

/**
 * The download orchestration: direct Storage URLs first, backend bytes as
 * the fallback. Driven on fakes — what is under test is the cascade order,
 * that backend bytes become same-origin blob URLs (and are revoked), that a
 * text-only failure is not retried through the backend, and that a backend
 * refusal surfaces as a single safe error.
 */

const CONTENT: PosterContent = {
  name: 'Lunch Poster',
  format: 'square_post',
  headline: 'A proper lunch',
  subheadline: null,
  callToAction: null,
  offerText: null,
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

describe('downloadCreativePoster', () => {
  it('uses only the direct route when it succeeds', async () => {
    const attemptDirect = vi.fn().mockResolvedValue(undefined)
    const fetchImageBytes = vi.fn()
    await downloadCreativePoster(
      { creativeId: 'c1', content: CONTENT, style: null, imageUrl: 'https://x/img.png' },
      { attemptDirect, fetchImageBytes },
    )
    expect(attemptDirect).toHaveBeenCalledTimes(1)
    expect(fetchImageBytes).not.toHaveBeenCalled()
  })

  it('falls back to backend bytes and renders from blob URLs', async () => {
    const attemptDirect = vi
      .fn()
      .mockRejectedValueOnce(new Error('poster image failed to load'))
      .mockResolvedValueOnce(undefined)
    const fetchImageBytes = vi.fn().mockResolvedValue(okResult())

    await downloadCreativePoster(
      { creativeId: 'c1', content: CONTENT, style: null, imageUrl: 'https://x/img.png' },
      { attemptDirect, fetchImageBytes },
    )

    expect(fetchImageBytes).toHaveBeenCalledWith('c1')
    expect(attemptDirect).toHaveBeenCalledTimes(2)
    const second = attemptDirect.mock.calls[1]![0]
    expect(second.imageUrl).toBe('blob:mock-1')
    expect(second.logoUrl).toBeNull()
    // The blob really carries the backend's bytes and type.
    expect(created[0]!.type).toBe('image/png')
    expect(created[0]!.size).toBe('image-bytes'.length)
    // Nothing leaks: every minted URL is revoked again.
    expect(revoked).toEqual(['blob:mock-1'])
  })

  it('composites the backend logo only where the caller had one', async () => {
    const attemptDirect = vi
      .fn()
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValueOnce(undefined)
    const fetchImageBytes = vi.fn().mockResolvedValue(
      okResult({ logo: { contentType: 'image/png', base64: LOGO_B64 } }),
    )

    await downloadCreativePoster(
      {
        creativeId: 'c1',
        content: CONTENT,
        style: null,
        imageUrl: 'https://x/img.png',
        logoUrl: 'https://x/logo.png',
      },
      { attemptDirect, fetchImageBytes },
    )

    const second = attemptDirect.mock.calls[1]![0]
    expect(second.logoUrl).toBe('blob:mock-2')
    expect(revoked).toEqual(['blob:mock-1', 'blob:mock-2'])
  })

  it('ignores a backend logo when the caller was not compositing one', async () => {
    const attemptDirect = vi
      .fn()
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValueOnce(undefined)
    const fetchImageBytes = vi.fn().mockResolvedValue(
      okResult({ logo: { contentType: 'image/png', base64: LOGO_B64 } }),
    )

    await downloadCreativePoster(
      { creativeId: 'c1', content: CONTENT, style: null, imageUrl: 'https://x/img.png' },
      { attemptDirect, fetchImageBytes },
    )

    expect(attemptDirect.mock.calls[1]![0].logoUrl).toBeNull()
  })

  it('does not ask the backend about a text-only poster failure', async () => {
    const attemptDirect = vi.fn().mockRejectedValue(new Error('poster render failed'))
    const fetchImageBytes = vi.fn()

    await expect(
      downloadCreativePoster(
        { creativeId: 'c1', content: CONTENT, style: null, imageUrl: null },
        { attemptDirect, fetchImageBytes },
      ),
    ).rejects.toThrow('poster render failed')
    expect(fetchImageBytes).not.toHaveBeenCalled()
  })

  it('surfaces one safe error when the backend refuses', async () => {
    const attemptDirect = vi.fn().mockRejectedValue(new Error('nope'))
    const fetchImageBytes = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'permission_denied', message: 'You do not have access to that.' },
    })

    await expect(
      downloadCreativePoster(
        { creativeId: 'c1', content: CONTENT, style: null, imageUrl: 'https://x/img.png' },
        { attemptDirect, fetchImageBytes },
      ),
    ).rejects.toThrow('poster download failed')
    expect(attemptDirect).toHaveBeenCalledTimes(1)
  })

  it('revokes blob URLs even when the fallback render fails', async () => {
    const attemptDirect = vi
      .fn()
      .mockRejectedValueOnce(new Error('nope'))
      .mockRejectedValueOnce(new Error('canvas export failed'))
    const fetchImageBytes = vi.fn().mockResolvedValue(okResult())

    await expect(
      downloadCreativePoster(
        { creativeId: 'c1', content: CONTENT, style: null, imageUrl: 'https://x/img.png' },
        { attemptDirect, fetchImageBytes },
      ),
    ).rejects.toThrow()
    expect(revoked).toEqual(['blob:mock-1'])
  })
})
