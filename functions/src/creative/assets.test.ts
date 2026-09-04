import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StoredCampaign } from '../campaign/store'
import type { Product, StoredBusiness } from '../lib/business.types'
import {
  AssetUnavailableError,
  assetIneligibility,
  buildAssetImageRef,
  buildCreativeAssetProvenance,
  copyAssetToCreativeStorage,
  listEligibleAssets,
  refreshUploadImage,
  resolveRetryImage,
  resolveVisualEditImage,
  selectCreativeAsset,
  selectLogoAsset,
  UPLOAD_IMAGE_KEPT_NOTE,
  type AssetWithId,
  type StoredAsset,
} from './assets'
import { generateCreativeImage } from './image'
import { buildStoredCreative, type StoredCreative } from './store'

/**
 * The Assets → Creative pipeline: deterministic selection, server-side GCS
 * snapshotting, frozen provenance, and the retry/visual-edit rule that a
 * poster on the owner's own photo is never quietly replaced by AI imagery.
 * Firestore, Storage and the image model are all stubbed — no network.
 */

const h = vi.hoisted(() => ({
  /** Docs returned by the eligible-assets query, in insertion order. */
  queryDocs: [] as { id: string; data: Record<string, unknown> }[],
  /** Docs served by assets/{id} lookups. */
  docs: new Map<string, Record<string, unknown>>(),
  copies: [] as { from: string; to: string }[],
  metadataCalls: [] as unknown[],
  failCopy: false,
}))

vi.mock('../lib/firebase', () => {
  const query = {
    where: () => query,
    get: async () => ({
      docs: h.queryDocs.map((doc) => ({ id: doc.id, data: () => doc.data })),
    }),
  }
  return {
    COLLECTIONS: { assets: 'assets', creatives: 'creatives' },
    FieldValue: {},
    db: {
      collection: () => ({
        ...query,
        doc: (id: string) => ({
          get: async () => {
            const data = h.docs.get(id)
            return { exists: data !== undefined, data: () => data }
          },
        }),
      }),
    },
    storageBucket: () => ({
      file: (path: string) => ({
        path,
        copy: async (destination: { path: string }) => {
          if (h.failCopy) throw new Error('source object missing')
          h.copies.push({ from: path, to: destination.path })
        },
        setMetadata: async (metadata: unknown) => {
          h.metadataCalls.push(metadata)
        },
      }),
    }),
  }
})

// The image model behind a spy: these tests assert it is (and is not) called.
vi.mock('./image', () => ({ generateCreativeImage: vi.fn() }))
const generateMock = vi.mocked(generateCreativeImage)

beforeEach(() => {
  h.queryDocs = []
  h.docs = new Map()
  h.copies = []
  h.metadataCalls = []
  h.failCopy = false
  generateMock.mockReset()
})

/* --- fixtures ----------------------------------------------------------- */

function makeAsset(overrides: Partial<StoredAsset> = {}): StoredAsset {
  return {
    ownerId: 'user1',
    businessId: 'biz1',
    type: 'product',
    name: 'Nasi Lemak Ayam',
    fileName: 'nasi.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 1000,
    storagePath: 'businesses/biz1/assets/1_nasi.jpg',
    productId: null,
    description: null,
    tags: [],
    source: 'upload',
    status: 'active',
    allowAiUse: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function withId(id: string, overrides: Partial<StoredAsset> = {}): AssetWithId {
  return { id, asset: makeAsset(overrides) }
}

const campaign = {
  name: 'Weekday Lunch Growth',
  objective: 'Increase weekday lunch customers',
  targetAudience: null,
  offer: { description: 'A weekday Nasi Lemak Ayam set', basis: 'recommendation' },
  positioning: null,
  keyMessage: 'Lunch without the wait',
  callToAction: null,
  channels: [],
  durationDays: null,
  startDate: null,
  endDate: null,
  notes: null,
  assumptions: [],
  unknowns: [],
  ownerId: 'user1',
  businessId: 'biz1',
  conversationId: null,
  sourceRecommendationId: null,
  status: 'draft',
  userEdited: [],
  meta: null,
  createdAt: 1,
  updatedAt: 1,
} as StoredCampaign

const nasiLemak = { id: 'p1', name: 'Nasi Lemak Ayam', isSignature: false } as Product
const laksa = { id: 'p2', name: 'Curry Laksa', isSignature: true } as Product
const products = [laksa, nasiLemak]

function makeCreative(overrides: Partial<StoredCreative> = {}): StoredCreative {
  const base = buildStoredCreative({
    ownerId: 'user1',
    businessId: 'biz1',
    campaignId: 'camp1',
    conversationId: 'conv1',
    sourceRecommendationId: null,
    name: 'Weekday Lunch Growth Poster',
    format: 'square_post',
    content: {
      headline: 'Lunch without the wait',
      subheadline: null,
      body: null,
      callToAction: 'Order on WhatsApp',
      offerText: null,
      image: {
        storagePath: 'businesses/biz1/creatives/snap.jpg',
        prompt: null,
        altText: 'A plate of nasi lemak',
        source: 'upload',
        assetId: 'assetA',
      },
      layout: 'image_full_bleed',
    },
    captions: { facebook: null, instagram: null, short: null, whatsapp: null },
    style: { palette: null, headingFont: null, bodyFont: null, logoStoragePath: null },
    assetIds: ['assetA'],
    imageError: null,
    meta: null,
    now: 1000,
  })
  return { ...base, ...overrides }
}

/* --- listing: only usable assets ever reach selection -------------------- */

describe('listEligibleAssets', () => {
  it('keeps only active, AI-allowed image assets, in stable order', async () => {
    h.queryDocs = [
      { id: 'b', data: makeAsset({ createdAt: 2 }) as unknown as Record<string, unknown> },
      { id: 'archived', data: makeAsset({ status: 'archived' }) as unknown as Record<string, unknown> },
      { id: 'private', data: makeAsset({ allowAiUse: false }) as unknown as Record<string, unknown> },
      { id: 'pdf', data: makeAsset({ contentType: 'application/pdf' }) as unknown as Record<string, unknown> },
      { id: 'a', data: makeAsset({ createdAt: 1 }) as unknown as Record<string, unknown> },
    ]
    const assets = await listEligibleAssets('biz1', 'user1')
    expect(assets.map((entry) => entry.id)).toEqual(['a', 'b'])
  })
})

/* --- selection: deterministic, product photos only ----------------------- */

describe('selectCreativeAsset', () => {
  it('selects an eligible product asset', () => {
    const asset = withId('a1', { type: 'product', name: 'Nasi Lemak Ayam' })
    expect(selectCreativeAsset([asset], campaign, products)?.id).toBe('a1')
  })

  it('selects an eligible photo asset when no product asset exists', () => {
    const photo = withId('ph1', { type: 'photo', name: 'Stall front' })
    expect(selectCreativeAsset([photo], campaign, products)?.id).toBe('ph1')
  })

  it('never selects menus, logos, brand files or documents as the poster photo', () => {
    const unsuitable = [
      withId('m1', { type: 'menu' }),
      withId('l1', { type: 'logo' }),
      withId('b1', { type: 'brand' }),
      withId('d1', { type: 'document' }),
      withId('pr1', { type: 'promotional' }),
      withId('o1', { type: 'other' }),
    ]
    expect(selectCreativeAsset(unsuitable, campaign, products)).toBeNull()
  })

  it('an explicit productId link to a mentioned product wins over a name match', () => {
    const nameMatch = withId('byName', { name: 'nasi lemak ayam closeup', productId: null })
    const linked = withId('byLink', { name: 'IMG_2041', productId: 'p1' })
    expect(selectCreativeAsset([nameMatch, linked], campaign, products)?.id).toBe('byLink')
  })

  it('matches on the asset’s own name, description or tags deterministically', () => {
    const tagged = withId('tagged', {
      name: 'IMG_1',
      tags: ['Nasi Lemak Ayam'],
    })
    const unrelated = withId('other', { name: 'IMG_2' })
    expect(selectCreativeAsset([unrelated, tagged], campaign, products)?.id).toBe('tagged')
  })

  it('falls back to the signature product’s asset, then the first product shot', () => {
    const noMention = { ...campaign, offer: null, name: 'Generic Push', objective: null } as StoredCampaign
    const signatureShot = withId('sig', { name: 'IMG_9', productId: 'p2' })
    const other = withId('first', { name: 'IMG_8' })
    expect(selectCreativeAsset([other, signatureShot], noMention, products)?.id).toBe('sig')
    expect(selectCreativeAsset([other], noMention, products)?.id).toBe('first')
  })

  it('is deterministic — same inputs, same asset', () => {
    const assets = [withId('a1'), withId('a2', { type: 'photo' })]
    expect(selectCreativeAsset(assets, campaign, products)).toEqual(
      selectCreativeAsset(assets, campaign, products),
    )
  })

  it('returns null when nothing usable exists, so the AI path runs instead', () => {
    expect(selectCreativeAsset([], campaign, products)).toBeNull()
  })
})

describe('selectLogoAsset', () => {
  it('picks the first logo asset and nothing else', () => {
    const assets = [withId('a1', { type: 'product' }), withId('logo1', { type: 'logo' })]
    expect(selectLogoAsset(assets)?.id).toBe('logo1')
    expect(selectLogoAsset([withId('a1', { type: 'product' })])).toBeNull()
  })
})

/* --- ownership: ids are resolved, never trusted -------------------------- */

describe('assetIneligibility', () => {
  const scope = { businessId: 'biz1', ownerId: 'user1' }

  it('rejects another owner’s or another business’s asset', () => {
    expect(assetIneligibility(makeAsset({ ownerId: 'intruder' }), scope)).toBe('not_owner')
    expect(assetIneligibility(makeAsset({ businessId: 'biz2' }), scope)).toBe('wrong_business')
  })

  it('rejects archived, AI-disallowed and non-image assets; accepts the eligible', () => {
    expect(assetIneligibility(makeAsset({ status: 'archived' }), scope)).toBe('not_active')
    expect(assetIneligibility(makeAsset({ allowAiUse: false }), scope)).toBe('ai_use_disallowed')
    expect(assetIneligibility(makeAsset({ contentType: 'application/pdf' }), scope)).toBe('not_an_image')
    expect(assetIneligibility(makeAsset(), scope)).toBeNull()
  })
})

/* --- snapshotting: GCS copy, no HTTP fetch ------------------------------- */

describe('copyAssetToCreativeStorage', () => {
  it('copies the asset into the creative-owned folder with a fresh download token', async () => {
    const path = await copyAssetToCreativeStorage(makeAsset(), 'biz1')
    expect(path).toMatch(/^businesses\/biz1\/creatives\/[0-9a-f-]{36}\.jpg$/)
    expect(h.copies).toEqual([{ from: 'businesses/biz1/assets/1_nasi.jpg', to: path }])
    expect(h.metadataCalls).toHaveLength(1)
  })

  it('never fetches over HTTP — the copy is server-side GCS only', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await copyAssetToCreativeStorage(makeAsset(), 'biz1')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('refuses a non-image asset outright', async () => {
    await expect(
      copyAssetToCreativeStorage(makeAsset({ contentType: 'application/pdf' }), 'biz1'),
    ).rejects.toThrow('not a poster-usable image')
  })
})

/* --- provenance ---------------------------------------------------------- */

describe('asset provenance', () => {
  it('an asset-backed image ref carries the assetId, source upload, no prompt', () => {
    const ref = buildAssetImageRef({
      assetId: 'assetA',
      asset: makeAsset(),
      storagePath: 'businesses/biz1/creatives/x.jpg',
      altText: null,
    })
    expect(ref).toEqual({
      storagePath: 'businesses/biz1/creatives/x.jpg',
      prompt: null,
      altText: 'Photo of Nasi Lemak Ayam',
      source: 'upload',
      assetId: 'assetA',
    })
  })

  it('assetIds lists only the assets actually used', () => {
    expect(
      buildCreativeAssetProvenance({ productAssetId: 'a', logoAssetId: 'l' }),
    ).toEqual(['a', 'l'])
    expect(buildCreativeAssetProvenance({ productAssetId: 'a', logoAssetId: null })).toEqual(['a'])
    expect(buildCreativeAssetProvenance({ productAssetId: null, logoAssetId: null })).toEqual([])
  })
})

/* --- refresh: same asset, fresh snapshot, loud failure -------------------- */

describe('refreshUploadImage', () => {
  const params = { assetId: 'assetA', businessId: 'biz1', ownerId: 'user1', altText: 'alt' }

  it('re-snapshots an eligible asset, preserving its assetId', async () => {
    h.docs.set('assetA', makeAsset() as unknown as Record<string, unknown>)
    const ref = await refreshUploadImage(params)
    expect(ref.assetId).toBe('assetA')
    expect(ref.source).toBe('upload')
    expect(ref.storagePath).toMatch(/^businesses\/biz1\/creatives\//)
    expect(h.copies).toHaveLength(1)
  })

  it('fails actionably when the asset is missing, archived or AI-disallowed', async () => {
    await expect(refreshUploadImage(params)).rejects.toBeInstanceOf(AssetUnavailableError)

    h.docs.set('assetA', makeAsset({ status: 'archived' }) as unknown as Record<string, unknown>)
    await expect(refreshUploadImage(params)).rejects.toThrow(/Assets/)

    h.docs.set('assetA', makeAsset({ allowAiUse: false }) as unknown as Record<string, unknown>)
    await expect(refreshUploadImage(params)).rejects.toBeInstanceOf(AssetUnavailableError)
  })

  it('rejects another business’s asset even when the id is known', async () => {
    h.docs.set('assetA', makeAsset({ businessId: 'biz2', ownerId: 'user2' }) as unknown as Record<string, unknown>)
    await expect(refreshUploadImage(params)).rejects.toBeInstanceOf(AssetUnavailableError)
    expect(h.copies).toHaveLength(0)
  })

  it('fails actionably on a legacy upload image with no assetId', async () => {
    await expect(refreshUploadImage({ ...params, assetId: null })).rejects.toThrow(/Assets/)
  })

  it('turns a missing storage object into the same actionable failure', async () => {
    h.docs.set('assetA', makeAsset() as unknown as Record<string, unknown>)
    h.failCopy = true
    await expect(refreshUploadImage(params)).rejects.toBeInstanceOf(AssetUnavailableError)
  })
})

/* --- retry: asset-backed never regenerates ------------------------------- */

describe('resolveRetryImage', () => {
  const business = null as StoredBusiness | null

  it('an upload-backed retry reuses the source Asset and never calls the image model', async () => {
    h.docs.set('assetA', makeAsset() as unknown as Record<string, unknown>)
    const { image, meta } = await resolveRetryImage({
      creative: makeCreative(),
      ownerId: 'user1',
      business,
      plan: 'basic' as never,
    })
    expect(image.assetId).toBe('assetA')
    expect(image.source).toBe('upload')
    expect(meta).toBeNull()
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('an upload-backed retry with an unavailable Asset fails loudly — no silent AI substitute', async () => {
    await expect(
      resolveRetryImage({
        creative: makeCreative(),
        ownerId: 'user1',
        business,
        plan: 'basic' as never,
      }),
    ).rejects.toBeInstanceOf(AssetUnavailableError)
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('a generated-image retry still regenerates, without gaining an assetId', async () => {
    generateMock.mockResolvedValue({
      image: { storagePath: 'businesses/biz1/creatives/new.png', prompt: 'p', altText: null, source: 'generated' },
      meta: { model: 'img', task: 't', latencyMs: 1, usage: null },
    })
    const creative = makeCreative({
      content: {
        ...makeCreative().content,
        image: { storagePath: 'x.png', prompt: 'p', altText: null, source: 'generated' },
      },
      assetIds: [],
    })
    const { image } = await resolveRetryImage({
      creative,
      ownerId: 'user1',
      business,
      plan: 'basic' as never,
    })
    expect(generateMock).toHaveBeenCalledOnce()
    expect(image.source).toBe('generated')
    expect(image.assetId).toBeUndefined()
  })
})

/* --- visual edit: the owner’s photo stays theirs -------------------------- */

describe('resolveVisualEditImage', () => {
  const base = {
    visualChange: 'A brighter scene with morning light',
    ownerId: 'user1',
    business: null as StoredBusiness | null,
    plan: 'basic' as never,
  }

  it('re-snapshots the same Asset for an upload-backed creative — never switches to AI', async () => {
    h.docs.set('assetA', makeAsset() as unknown as Record<string, unknown>)
    const result = await resolveVisualEditImage({ ...base, creative: makeCreative() })
    expect(result.action).toBe('replaced')
    if (result.action === 'replaced') {
      expect(result.image.assetId).toBe('assetA')
      expect(result.note).toBe(UPLOAD_IMAGE_KEPT_NOTE)
    }
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('keeps the existing snapshot when the Asset is gone, still without AI', async () => {
    const result = await resolveVisualEditImage({ ...base, creative: makeCreative() })
    expect(result).toEqual({ action: 'kept', note: UPLOAD_IMAGE_KEPT_NOTE })
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('a generated creative still regenerates from the validated brief', async () => {
    generateMock.mockResolvedValue({
      image: { storagePath: 'businesses/biz1/creatives/new.png', prompt: 'p', altText: null, source: 'generated' },
      meta: null as never,
    })
    const creative = makeCreative({
      content: {
        ...makeCreative().content,
        image: { storagePath: 'x.png', prompt: 'p', altText: null, source: 'generated' },
      },
      assetIds: [],
    })
    const result = await resolveVisualEditImage({ ...base, creative })
    expect(generateMock).toHaveBeenCalledOnce()
    expect(generateMock.mock.calls[0]?.[0]?.brief).toBe(base.visualChange)
    expect(result.action).toBe('replaced')
    if (result.action === 'replaced') expect(result.note).toBeNull()
  })
})
