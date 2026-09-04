import { describe, expect, it } from 'vitest'
import { HttpsError } from 'firebase-functions/v2/https'

import { performDownloadCreativeImage, type DownloadImageDeps } from './downloadImage'
import type { StoredCreative } from './store'

/**
 * Poster download fallback — the authenticated door to the caller's own
 * image bytes. Driven on fakes: what is under test is ownership enforcement,
 * the business-prefix fence on storage paths, the degradation rules (logo
 * optional, image mandatory), and that failures answer with safe errors.
 */

const UID = 'user1'
const BIZ = 'biz1'
const IMAGE_PATH = `businesses/${BIZ}/creatives/img1.png`
const LOGO_PATH = `businesses/${BIZ}/assets/logo.png`

const IMAGE_BYTES = Buffer.from('image-bytes')
const LOGO_BYTES = Buffer.from('logo-bytes')

function creative(overrides: Partial<StoredCreative> = {}): StoredCreative {
  return {
    ownerId: UID,
    businessId: BIZ,
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
        storagePath: IMAGE_PATH,
        prompt: null,
        altText: null,
        source: 'generated',
      },
      layout: 'image_full_bleed',
    },
    captions: { facebook: null, instagram: null, short: null, whatsapp: null },
    style: {
      palette: null,
      headingFont: null,
      bodyFont: null,
      logoStoragePath: null,
    },
    assetIds: [],
    render: null,
    userEdited: [],
    ownerDirectives: [],
    imageError: null,
    meta: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function makeDeps(
  stored: StoredCreative | null,
  overrides: Partial<DownloadImageDeps> = {},
): { deps: DownloadImageDeps; reads: string[] } {
  const reads: string[] = []
  const deps: DownloadImageDeps = {
    getCreative: async () => stored,
    requireBusinessOwner: async () => ({ ownerId: UID }),
    readFile: async (storagePath) => {
      reads.push(storagePath)
      if (storagePath === IMAGE_PATH) return { bytes: IMAGE_BYTES, contentType: 'image/png' }
      if (storagePath === LOGO_PATH) return { bytes: LOGO_BYTES, contentType: 'image/png' }
      return null
    },
    ...overrides,
  }
  return { deps, reads }
}

const PARAMS = { uid: UID, creativeId: 'creative1' }

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof HttpsError && error.code === code,
  )
}

describe('performDownloadCreativeImage', () => {
  it('serves the owner their creative image as base64', async () => {
    const { deps } = makeDeps(creative())
    const result = await performDownloadCreativeImage(PARAMS, deps)
    expect(result.image).toEqual({
      contentType: 'image/png',
      base64: IMAGE_BYTES.toString('base64'),
    })
    expect(result.logo).toBeNull()
  })

  it('includes the snapshotted logo when the creative has one', async () => {
    const { deps } = makeDeps(
      creative({
        style: { palette: null, headingFont: null, bodyFont: null, logoStoragePath: LOGO_PATH },
      }),
    )
    const result = await performDownloadCreativeImage(PARAMS, deps)
    expect(result.logo).toEqual({
      contentType: 'image/png',
      base64: LOGO_BYTES.toString('base64'),
    })
  })

  it('answers a missing creative with permission denied', async () => {
    const { deps } = makeDeps(null)
    await expectCode(performDownloadCreativeImage(PARAMS, deps), 'permission-denied')
  })

  it('answers a foreign creative with permission denied', async () => {
    const { deps } = makeDeps(creative({ ownerId: 'someone-else' }))
    await expectCode(performDownloadCreativeImage(PARAMS, deps), 'permission-denied')
  })

  it('denies when the business is not the callers', async () => {
    const { deps } = makeDeps(creative(), { requireBusinessOwner: async () => null })
    await expectCode(performDownloadCreativeImage(PARAMS, deps), 'permission-denied')
  })

  it('refuses an image path outside the business prefix without reading it', async () => {
    const { deps, reads } = makeDeps(
      creative({
        content: {
          ...creative().content,
          image: {
            storagePath: 'businesses/other-biz/creatives/x.png',
            prompt: null,
            altText: null,
            source: 'generated',
          },
        },
      }),
    )
    await expectCode(performDownloadCreativeImage(PARAMS, deps), 'permission-denied')
    expect(reads).toEqual([])
  })

  it('fails honestly when the recorded image object is gone', async () => {
    const { deps } = makeDeps(creative(), { readFile: async () => null })
    await expectCode(performDownloadCreativeImage(PARAMS, deps), 'failed-precondition')
  })

  it('fails safely when the image read throws (e.g. object too large)', async () => {
    const { deps } = makeDeps(creative(), {
      readFile: async () => {
        throw new Error('object too large: 99999999 bytes')
      },
    })
    await expectCode(performDownloadCreativeImage(PARAMS, deps), 'failed-precondition')
  })

  it('returns nulls for a text-only creative without touching storage', async () => {
    const { deps, reads } = makeDeps(
      creative({ content: { ...creative().content, image: null } }),
    )
    const result = await performDownloadCreativeImage(PARAMS, deps)
    expect(result).toEqual({ image: null, logo: null })
    expect(reads).toEqual([])
  })

  it('degrades to no logo when the logo read fails', async () => {
    const { deps } = makeDeps(
      creative({
        style: { palette: null, headingFont: null, bodyFont: null, logoStoragePath: LOGO_PATH },
      }),
      {
        readFile: async (storagePath) => {
          if (storagePath === LOGO_PATH) throw new Error('boom')
          return { bytes: IMAGE_BYTES, contentType: 'image/png' }
        },
      },
    )
    const result = await performDownloadCreativeImage(PARAMS, deps)
    expect(result.image).not.toBeNull()
    expect(result.logo).toBeNull()
  })

  it('silently skips a logo path outside the business prefix', async () => {
    const { deps, reads } = makeDeps(
      creative({
        style: {
          palette: null,
          headingFont: null,
          bodyFont: null,
          logoStoragePath: 'businesses/other-biz/assets/logo.png',
        },
      }),
    )
    const result = await performDownloadCreativeImage(PARAMS, deps)
    expect(result.image).not.toBeNull()
    expect(result.logo).toBeNull()
    expect(reads).toEqual([IMAGE_PATH])
  })

  it('coerces an unexpected content type to image/png', async () => {
    const { deps } = makeDeps(creative(), {
      readFile: async () => ({ bytes: IMAGE_BYTES, contentType: 'text/html' }),
    })
    const result = await performDownloadCreativeImage(PARAMS, deps)
    expect(result.image?.contentType).toBe('image/png')
  })
})
