import { describe, expect, it } from 'vitest'

import type { StoredCampaign } from '../campaign/store'
import { applyCreativePatch } from './edit'
import { draftCreativeCopyFromCampaign, mergeCopy } from './draft'
import { CREATIVE_COPY_PROMPT, buildCreativeEditInput } from './prompt'
import { CREATIVE_COPY_SCHEMA, CREATIVE_EDIT_SCHEMA } from './schema'
import type { StoredCreative } from './store'
import {
  CREATIVE_EDITABLE_FIELDS,
  CREATIVE_LIMITS,
  validateCreativeCopy,
  validateCreativeEdit,
  type CreativeCopyDraft,
} from './validate'

/**
 * Phase 7H: the X and TikTok copy the creative page now offers.
 *
 * The point of these tests is that no second generation path appeared. The
 * platform variants are two more fields on the one structured copy call the
 * creative pipeline already makes, validated by the same grounding rules and
 * patched by the same authority model as every other caption.
 */

const campaign: StoredCampaign = {
  name: 'Weekday Lunch Growth',
  objective: 'Increase weekday lunch customers',
  targetAudience: { description: 'Nearby office workers', basis: 'known' },
  offer: { description: 'Consider a weekday lunch set', basis: 'recommendation' },
  positioning: 'The fast, honest lunch nearby',
  keyMessage: 'Lunch without the wait',
  callToAction: 'Order on WhatsApp',
  channels: ['instagram', 'whatsapp'],
  durationDays: 14,
  startDate: null,
  endDate: null,
  notes: null,
  assumptions: [],
  unknowns: [],
  ownerId: 'user1',
  businessId: 'biz1',
  conversationId: 'conv1',
  sourceRecommendationId: 'rec1',
  status: 'draft',
  userEdited: [],
  meta: null,
  createdAt: 1,
  updatedAt: 1,
}

const creative: StoredCreative = {
  ownerId: 'user1',
  businessId: 'biz1',
  campaignId: 'camp1',
  conversationId: 'conv1',
  sourceRecommendationId: 'rec1',
  name: 'Lunch Poster',
  format: 'square_post',
  status: 'ready',
  content: {
    headline: 'Lunch without the wait',
    subheadline: null,
    body: null,
    callToAction: 'Order on WhatsApp',
    offerText: null,
    layout: 'image_top',
    image: null,
  },
  captions: {
    facebook: 'Lunch without the wait. Order on WhatsApp.',
    instagram: 'Lunch without the wait.',
    short: 'Lunch without the wait.',
    whatsapp: 'Hi! Lunch without the wait — order on WhatsApp.',
    x: 'Lunch without the wait.',
    tiktok: 'No queue at lunch. Order on WhatsApp.',
  },
  style: {
    palette: null,
    headingFont: null,
    bodyFont: null,
    logoStoragePath: null,
    logoAssetId: null,
  },
  assetIds: [],
  render: null,
  userEdited: [],
  ownerDirectives: [],
  imageError: null,
  meta: null,
  createdAt: 1,
  updatedAt: 1,
}

describe('the one copy call produces the platform variants', () => {
  it('asks for xCopy and tiktokCopy in the existing creative_copy schema', () => {
    expect(CREATIVE_COPY_SCHEMA.properties).toHaveProperty('xCopy')
    expect(CREATIVE_COPY_SCHEMA.properties).toHaveProperty('tiktokCopy')
    // Strict structured output: every property is required and nullable.
    expect(CREATIVE_COPY_SCHEMA.required).toContain('xCopy')
    expect(CREATIVE_COPY_SCHEMA.required).toContain('tiktokCopy')
  })

  it('adds no second schema or task for platform copy', () => {
    const names = Object.keys(CREATIVE_COPY_SCHEMA.properties)
    expect(names).toContain('facebookCaption')
    expect(names).toContain('imageBrief')
    // One call: the poster's words, its captions and its image brief together.
    expect(names).toContain('headline')
  })

  it('tells the writer each platform is a different job, not a reword', () => {
    expect(CREATIVE_COPY_PROMPT).toContain('four different jobs')
    expect(CREATIVE_COPY_PROMPT).toMatch(/X is one blunt thought/)
    expect(CREATIVE_COPY_PROMPT).toMatch(/TikTok opens on a hook/)
  })

  it('bans the generic AI filler outright', () => {
    expect(CREATIVE_COPY_PROMPT).toContain('Unlock your potential')
    expect(CREATIVE_COPY_PROMPT).toContain('take your business to the next level')
    expect(CREATIVE_COPY_PROMPT).toContain("don't miss out")
  })

  it('keeps hashtags where they are actually used', () => {
    expect(CREATIVE_COPY_PROMPT).toMatch(/Hashtags belong where they are used/)
  })

  it('holds X inside a length a person can actually post', () => {
    expect(CREATIVE_LIMITS.xCopy).toBeLessThanOrEqual(280)
  })
})

describe('validation applies the same grounding to the new fields', () => {
  const corpus = ['Weekday Lunch Growth', 'Lunch without the wait', 'Order on WhatsApp'].join(' ')

  it('keeps grounded platform copy', () => {
    const copy = validateCreativeCopy(
      { xCopy: 'Lunch without the wait.', tiktokCopy: 'Lunch without the wait — order now.' },
      corpus,
    )
    expect(copy.xCopy).toBe('Lunch without the wait.')
    expect(copy.tiktokCopy).toBe('Lunch without the wait — order now.')
  })

  it('refuses an invented price in an X post the same way it does elsewhere', () => {
    const copy = validateCreativeCopy({ xCopy: 'Lunch sets from RM9.90 today.' }, corpus)
    expect(copy.xCopy).toBeNull()
  })

  it('returns null, never undefined, when the model omits them', () => {
    const copy = validateCreativeCopy({}, corpus)
    expect(copy.xCopy).toBeNull()
    expect(copy.tiktokCopy).toBeNull()
  })
})

describe('the deterministic fallback does not fabricate platform variants', () => {
  it('leaves X and TikTok empty when the writer was unavailable', () => {
    const draft = draftCreativeCopyFromCampaign(campaign)
    expect(draft.captions.x).toBeNull()
    expect(draft.captions.tiktok).toBeNull()
    // The captions that were always assembled from the campaign still are.
    expect(draft.captions.short).toBeTruthy()
  })

  it('folds the model’s platform copy over that draft when it arrives', () => {
    const copy: CreativeCopyDraft = {
      name: null,
      headline: null,
      subheadline: null,
      callToAction: null,
      offerText: null,
      facebookCaption: null,
      instagramCaption: null,
      shortCopy: null,
      whatsappCopy: null,
      xCopy: 'No queue at lunch.',
      tiktokCopy: 'Walk in at 12, eat by 12:05.',
      imageBrief: null,
      altText: null,
    }
    const merged = mergeCopy(draftCreativeCopyFromCampaign(campaign), copy)
    expect(merged.captions.x).toBe('No queue at lunch.')
    expect(merged.captions.tiktok).toBe('Walk in at 12, eat by 12:05.')
  })
})

describe('editing platform copy uses the existing authority model', () => {
  it('lists the new fields as editable, so userEdited can record them', () => {
    expect(CREATIVE_EDITABLE_FIELDS).toContain('xCopy')
    expect(CREATIVE_EDITABLE_FIELDS).toContain('tiktokCopy')
  })

  it('patches only the caption asked for, and leaves the image alone', () => {
    const { creative: next, changed } = applyCreativePatch(
      creative,
      { xCopy: 'Lunch, no queue.' },
      'user_instruction',
    )
    expect(changed).toEqual(['xCopy'])
    expect(next.captions.x).toBe('Lunch, no queue.')
    expect(next.captions.tiktok).toBe(creative.captions.tiktok)
    expect(next.content.image).toBe(creative.content.image)
    expect(next.userEdited).toContain('xCopy')
  })

  it('never lets an assistant edit revert copy the owner wrote', () => {
    const owned = { ...creative, userEdited: ['tiktokCopy' as const] }
    const { changed } = applyCreativePatch(owned, { tiktokCopy: 'Something else.' }, 'assistant')
    expect(changed).toEqual([])
  })

  it('shows the model the existing platform copy so an edit is grounded on it', () => {
    const input = buildCreativeEditInput({
      instruction: 'shorten the X post',
      creative,
      campaign: null,
      businessName: 'Warung Pak Din',
    })
    expect(input).toContain('xCopy')
    expect(input).toContain('tiktokCopy')
  })

  it('a copy-only edit still carries no visual change', () => {
    expect(CREATIVE_EDIT_SCHEMA.properties).toHaveProperty('xCopy')
    const edit = validateCreativeEdit(
      { reply: 'Shortened it.', xCopy: 'Lunch, no queue.', visualChange: null },
      'Lunch, no queue. Lunch without the wait.',
    )
    expect(edit.patch.xCopy).toBe('Lunch, no queue.')
    expect(edit.visualChange).toBeNull()
  })
})

describe('a creative written before Phase 7H still works', () => {
  const legacy: StoredCreative = {
    ...creative,
    captions: {
      facebook: 'Facebook caption.',
      instagram: 'Instagram caption.',
      short: 'General caption.',
      whatsapp: null,
    },
  }

  it('patches cleanly even though the fields were never stored', () => {
    const { creative: next, changed } = applyCreativePatch(
      legacy,
      { tiktokCopy: 'First TikTok caption.' },
      'user_instruction',
    )
    expect(changed).toEqual(['tiktokCopy'])
    expect(next.captions.tiktok).toBe('First TikTok caption.')
  })

  it('is described to the edit model with the missing platforms as null', () => {
    const input = buildCreativeEditInput({
      instruction: 'make it warmer',
      creative: legacy,
      campaign: null,
      businessName: null,
    })
    expect(input).toContain('"xCopy": null')
    expect(input).toContain('"tiktokCopy": null')
  })
})
