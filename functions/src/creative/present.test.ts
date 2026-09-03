import { describe, expect, it } from 'vitest'

import { buildStoredCreative, type StoredCreative } from './store'
import {
  buildCreativeEditPresentation,
  buildCreativePresentation,
  buildCreativePreviewBlock,
  buildCreativeRetryPresentation,
  FALLBACK_COPY_NOTE,
  IMAGE_FAILED_LEAD,
} from './present'

/**
 * Honesty rules, pinned: a generated visual is introduced as generated, and
 * an image failure delivers the copy anyway and says so in the exact words
 * the spec requires.
 */

function makeCreative(overrides: Partial<StoredCreative> = {}): StoredCreative {
  const base = buildStoredCreative({
    ownerId: 'user1',
    businessId: 'biz1',
    campaignId: 'camp1',
    conversationId: 'conv1',
    sourceRecommendationId: 'rec1',
    name: 'Weekday Lunch Growth Poster',
    format: 'square_post',
    content: {
      headline: 'Lunch without the wait',
      subheadline: 'Ready in ten minutes',
      body: null,
      callToAction: 'Order on WhatsApp',
      offerText: 'Weekday lunch set',
      image: {
        storagePath: 'businesses/biz1/creatives/x.png',
        prompt: 'a photo',
        altText: 'A plate of nasi lemak',
        source: 'generated',
      },
      layout: 'image_full_bleed',
    },
    captions: {
      facebook: 'fb caption',
      instagram: 'ig caption',
      short: 'short copy',
      whatsapp: null,
    },
    style: { palette: ['#C2410C'], headingFont: null, bodyFont: null, logoStoragePath: null },
    imageError: null,
    meta: null,
    now: 1000,
  })
  return { ...base, ...overrides }
}

describe('buildCreativePreviewBlock', () => {
  it('duplicates only what the block renders, and references the creative by id', () => {
    const block = buildCreativePreviewBlock('b1', 'cr1', makeCreative())
    expect(block).toEqual({
      id: 'b1',
      type: 'creative_preview',
      creativeId: 'cr1',
      campaignId: 'camp1',
      name: 'Weekday Lunch Growth Poster',
      format: 'square_post',
      headline: 'Lunch without the wait',
      subheadline: 'Ready in ten minutes',
      callToAction: 'Order on WhatsApp',
      offerText: 'Weekday lunch set',
      image: {
        storagePath: 'businesses/biz1/creatives/x.png',
        source: 'generated',
        altText: 'A plate of nasi lemak',
      },
      imageFailed: false,
      captions: { facebook: 'fb caption', instagram: 'ig caption', short: 'short copy', whatsapp: null },
    })
  })

  it('a failed image means no image ref and an explicit flag', () => {
    const creative = makeCreative({ imageError: 'The poster image could not be created.' })
    creative.content = { ...creative.content, image: null }
    const block = buildCreativePreviewBlock('b1', 'cr1', creative)
    expect(block.image).toBeNull()
    expect(block.imageFailed).toBe(true)
  })
})

describe('buildCreativePresentation', () => {
  it('introduces a generated visual as AI-generated — honesty over polish', () => {
    const { blocks, plainText } = buildCreativePresentation('cr1', makeCreative())
    expect(blocks[0]).toMatchObject({ type: 'text' })
    const lead = (blocks[0] as { text: string }).text
    expect(lead).toContain('AI-generated')
    expect(plainText).toContain('Weekday Lunch Growth Poster')
    expect(blocks[1]).toMatchObject({ type: 'creative_preview', creativeId: 'cr1' })
  })

  it("says so when the poster uses the owner's own photo", () => {
    const creative = makeCreative()
    creative.content = {
      ...creative.content,
      image: { ...creative.content.image!, source: 'upload' },
    }
    const lead = (buildCreativePresentation('cr1', creative).blocks[0] as { text: string }).text
    expect(lead).toContain('your own photos')
    expect(lead).not.toContain('AI-generated')
  })

  it('delivers the copy with the exact resilience lead when the image failed', () => {
    const creative = makeCreative({ imageError: 'The poster image could not be created.' })
    creative.content = { ...creative.content, image: null }
    const { blocks } = buildCreativePresentation('cr1', creative)
    expect((blocks[0] as { text: string }).text).toBe(IMAGE_FAILED_LEAD)
    expect(IMAGE_FAILED_LEAD).toBe(
      'I couldn’t create the image right now, but your marketing copy is ready. You can retry the image from the preview below.',
    )
  })

  it('labels deterministic fallback copy as a draft to review, without blocking delivery', () => {
    const { blocks } = buildCreativePresentation('cr1', makeCreative(), { fallbackCopy: true })
    const lead = (blocks[0] as { text: string }).text
    expect(lead).toContain(FALLBACK_COPY_NOTE)
    expect(lead).toContain('draft copy')
    // The materials still ship: the preview block is present as always.
    expect(blocks[1]).toMatchObject({ type: 'creative_preview', creativeId: 'cr1' })
  })

  it('combines the image-failure lead with the fallback-copy label when both apply', () => {
    const creative = makeCreative({ imageError: 'The poster image could not be created.' })
    creative.content = { ...creative.content, image: null }
    const lead = (
      buildCreativePresentation('cr1', creative, { fallbackCopy: true }).blocks[0] as {
        text: string
      }
    ).text
    expect(lead).toBe(`${IMAGE_FAILED_LEAD} ${FALLBACK_COPY_NOTE}`)
  })

  it('does not mention the fallback when the AI wording succeeded', () => {
    const lead = (buildCreativePresentation('cr1', makeCreative()).blocks[0] as { text: string })
      .text
    expect(lead).not.toContain(FALLBACK_COPY_NOTE)
  })
})

describe('buildCreativeEditPresentation', () => {
  it("uses the model's reply when there is one", () => {
    const { blocks } = buildCreativeEditPresentation(
      'cr1',
      makeCreative(),
      'Done — premium it is.',
      ['headline'],
    )
    expect((blocks[0] as { text: string }).text).toBe('Done — premium it is.')
  })

  it('falls back honestly: changed vs. nothing changed', () => {
    const changedLead = (
      buildCreativeEditPresentation('cr1', makeCreative(), null, ['headline']).blocks[0] as {
        text: string
      }
    ).text
    const unchangedLead = (
      buildCreativeEditPresentation('cr1', makeCreative(), null, []).blocks[0] as { text: string }
    ).text
    expect(changedLead).toContain('updated')
    expect(unchangedLead).toContain('didn’t change')
  })
})

describe('buildCreativeRetryPresentation', () => {
  it('reports success and failure plainly', () => {
    const ok = (buildCreativeRetryPresentation('cr1', makeCreative()).blocks[0] as { text: string })
      .text
    expect(ok).toContain('ready')

    const failed = makeCreative({ imageError: 'The poster image could not be created.' })
    const stillFailed = (
      buildCreativeRetryPresentation('cr1', failed).blocks[0] as { text: string }
    ).text
    expect(stillFailed).toContain('couldn’t')
    expect(stillFailed).toContain('copy is untouched')
  })
})
