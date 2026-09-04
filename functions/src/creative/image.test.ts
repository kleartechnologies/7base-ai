import { beforeEach, describe, expect, it, vi } from 'vitest'

import { generateCreativeImage } from './image'

/**
 * The generation fallback's provenance: a generated image is recorded as
 * generated, stored under the creative folder, and never claims an assetId —
 * so a generated creative can never falsely present itself as being built
 * from one of the owner's own Assets.
 */

const h = vi.hoisted(() => ({
  saves: [] as { path: string; contentType: string }[],
  prompts: [] as string[],
}))

vi.mock('../ai/orchestrator', () => ({
  runImageTask: async (params: { prompt: string }) => {
    h.prompts.push(params.prompt)
    return {
      imageBytes: Buffer.from('png-bytes'),
      meta: { model: 'gpt-image-2', task: 'creative.generate_image', latencyMs: 1, usage: null },
    }
  },
}))

vi.mock('../lib/firebase', () => ({
  storageBucket: () => ({
    file: (path: string) => ({
      save: async (_bytes: Buffer, options: { contentType: string }) => {
        h.saves.push({ path, contentType: options.contentType })
      },
    }),
  }),
}))

beforeEach(() => {
  h.saves = []
  h.prompts = []
})

describe('generateCreativeImage', () => {
  it('records the image as generated, with no assetId, in the creative folder', async () => {
    const { image } = await generateCreativeImage({
      businessId: 'biz1',
      brief: 'A plate of nasi lemak on a wooden table',
      altText: 'A plate of nasi lemak',
      format: 'square_post',
      business: null,
      plan: 'basic' as never,
    })
    expect(image.source).toBe('generated')
    expect('assetId' in image).toBe(false)
    expect(image.storagePath).toMatch(/^businesses\/biz1\/creatives\/[0-9a-f-]{36}\.png$/)
    expect(h.saves).toEqual([{ path: image.storagePath, contentType: 'image/png' }])
  })

  it('keeps the no-text, no-logo instruction in every prompt sent to the model', async () => {
    await generateCreativeImage({
      businessId: 'biz1',
      brief: 'A plate of nasi lemak',
      altText: null,
      format: 'square_post',
      business: null,
      plan: 'basic' as never,
    })
    expect(h.prompts[0]).toMatch(/no text/i)
    expect(h.prompts[0]).toMatch(/no logos/i)
  })
})
