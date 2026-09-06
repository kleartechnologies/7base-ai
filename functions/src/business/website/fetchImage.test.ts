import { describe, expect, it, vi } from 'vitest'

import { BlockedHostError } from './guard'
import { fetchSourceImage, IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, type ImageFetchDeps } from './fetchImage'

/**
 * The image fetcher is the page fetcher's discipline applied to one image:
 * the same URL normalisation, the same DNS guard on every hop, and a hard
 * type/size gate on what comes back. It never throws — a refusal is simply
 * "no image" — and it never says why.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

function response(over: { status?: number; headers?: Record<string, string>; body?: Uint8Array | null } = {}): Response {
  const body = over.body === undefined ? PNG : over.body
  return new Response(body === null ? null : Buffer.from(body), {
    status: over.status ?? 200,
    headers: { 'content-type': 'image/png', ...(over.headers ?? {}) },
  })
}

function deps(over: Partial<ImageFetchDeps> = {}): ImageFetchDeps & { request: ReturnType<typeof vi.fn>; assertPublic: ReturnType<typeof vi.fn> } {
  return {
    request: vi.fn(async () => response()),
    assertPublic: vi.fn(async () => undefined),
    ...over,
  } as ImageFetchDeps & { request: ReturnType<typeof vi.fn>; assertPublic: ReturnType<typeof vi.fn> }
}

describe('fetchSourceImage', () => {
  it('returns a data URL for an accepted raster image', async () => {
    const d = deps()
    const image = await fetchSourceImage('warungmakcik.com/icon.png', d)
    expect(image).toEqual({
      url: 'https://warungmakcik.com/icon.png',
      contentType: 'image/png',
      bytes: PNG.byteLength,
      dataUrl: `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`,
    })
    // Normalised before the guard, guard before the request.
    expect(d.assertPublic).toHaveBeenCalledWith('warungmakcik.com')
    expect(d.request).toHaveBeenCalledWith('https://warungmakcik.com/icon.png')
  })

  it.each(['http://localhost/x.png', 'http://127.0.0.1/x.png', 'file:///etc/passwd', 'javascript:alert(1)', 'http://user:pw@example.com/a.png', ''])(
    'refuses %s at normalisation without any request',
    async (url) => {
      const d = deps()
      expect(await fetchSourceImage(url, d)).toBeNull()
      expect(d.request).not.toHaveBeenCalled()
    },
  )

  it('refuses a host the DNS guard rejects, and never surfaces the reason', async () => {
    const d = deps({ assertPublic: vi.fn(async () => { throw new BlockedHostError('10.0.0.1') }) })
    expect(await fetchSourceImage('https://internal.example.com/a.png', d)).toBeNull()
    expect(d.request).not.toHaveBeenCalled()
  })

  it('re-validates and re-guards every redirect hop', async () => {
    const d = deps({
      request: vi
        .fn()
        .mockResolvedValueOnce(response({ status: 302, headers: { location: '/moved/icon.png' }, body: null }))
        .mockResolvedValueOnce(response()),
    })
    const image = await fetchSourceImage('https://warungmakcik.com/icon.png', d)
    expect(image?.url).toBe('https://warungmakcik.com/moved/icon.png')
    expect(d.assertPublic).toHaveBeenCalledTimes(2)
  })

  it('a redirect to a blocked destination is refused', async () => {
    const d = deps({
      request: vi.fn().mockResolvedValueOnce(
        response({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' }, body: null }),
      ),
    })
    expect(await fetchSourceImage('https://warungmakcik.com/icon.png', d)).toBeNull()
    expect(d.request).toHaveBeenCalledTimes(1)
  })

  it('gives up after too many redirects', async () => {
    const d = deps({
      request: vi.fn(async () => response({ status: 301, headers: { location: 'https://warungmakcik.com/again.png' }, body: null })),
    })
    expect(await fetchSourceImage('https://warungmakcik.com/icon.png', d)).toBeNull()
    expect(d.request.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it.each(['image/svg+xml', 'text/html', 'application/octet-stream'])('refuses a %s body', async (type) => {
    const d = deps({ request: vi.fn(async () => response({ headers: { 'content-type': type } })) })
    expect(await fetchSourceImage('https://warungmakcik.com/icon', d)).toBeNull()
    expect(IMAGE_MIME_TYPES).not.toContain(type)
  })

  it('refuses an image that declares or streams more than the cap', async () => {
    const declared = deps({
      request: vi.fn(async () => response({ headers: { 'content-length': String(MAX_IMAGE_BYTES + 1) } })),
    })
    expect(await fetchSourceImage('https://warungmakcik.com/big.png', declared)).toBeNull()

    const streamed = deps({
      request: vi.fn(async () => response({ body: new Uint8Array(MAX_IMAGE_BYTES + 1) })),
    })
    expect(await fetchSourceImage('https://warungmakcik.com/big.png', streamed)).toBeNull()
  })

  it('treats a non-2xx, an empty body and a thrown transport error as no image', async () => {
    expect(await fetchSourceImage('https://warungmakcik.com/a.png', deps({ request: vi.fn(async () => response({ status: 404 })) }))).toBeNull()
    expect(await fetchSourceImage('https://warungmakcik.com/a.png', deps({ request: vi.fn(async () => response({ body: new Uint8Array(0) })) }))).toBeNull()
    expect(await fetchSourceImage('https://warungmakcik.com/a.png', deps({ request: vi.fn(async () => { throw new TypeError('fetch failed') }) }))).toBeNull()
  })
})
