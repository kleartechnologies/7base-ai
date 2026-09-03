import { describe, expect, it } from 'vitest'

import {
  CampaignValidationError,
  validateCampaignEdit,
  validateCampaignPolish,
} from './validate'

/**
 * Model output is untrusted input. The polish call may only contribute copy;
 * the edit call may only contribute the fields the instruction touched; and
 * neither can smuggle in an upgraded provenance basis, an unknown channel,
 * or an absurd duration.
 */

describe('validateCampaignPolish', () => {
  it('accepts copy fields and passes them through cleaned', () => {
    const polish = validateCampaignPolish({
      name: '  Weekday   Lunch Rush ',
      objective: null,
      keyMessage: 'Set lunch, ready in 10 minutes',
      callToAction: null,
      notes: null,
    })
    expect(polish.name).toBe('Weekday Lunch Rush')
    expect(polish.keyMessage).toBe('Set lunch, ready in 10 minutes')
    expect(polish.objective).toBeNull()
  })

  it('rejects a non-object response outright', () => {
    expect(() => validateCampaignPolish('a campaign!')).toThrow(CampaignValidationError)
    expect(() => validateCampaignPolish(null)).toThrow(CampaignValidationError)
  })

  it('treats filler like "unknown" and "N/A" as absent, not as copy', () => {
    const polish = validateCampaignPolish({
      name: 'unknown',
      objective: 'N/A',
      keyMessage: 'not stated',
      callToAction: 42,
      notes: '',
    })
    expect(polish).toEqual({
      name: null,
      objective: null,
      keyMessage: null,
      callToAction: null,
      notes: null,
    })
  })

  it('truncates runaway copy instead of storing an essay', () => {
    const polish = validateCampaignPolish({
      name: 'x'.repeat(300),
      objective: null,
      keyMessage: null,
      callToAction: null,
      notes: null,
    })
    expect(polish.name?.length).toBeLessThanOrEqual(81)
    expect(polish.name?.endsWith('…')).toBe(true)
  })
})

describe('validateCampaignEdit', () => {
  it('null fields stay out of the patch — untouched means untouched', () => {
    const edit = validateCampaignEdit({
      reply: 'Done — premium it is.',
      name: null,
      objective: null,
      targetAudience: null,
      offer: null,
      positioning: null,
      keyMessage: 'An honest lunch, done properly',
      callToAction: null,
      notes: null,
      channels: null,
      durationDays: null,
    })
    expect(edit.reply).toBe('Done — premium it is.')
    expect(edit.patch).toEqual({ keyMessage: 'An honest lunch, done properly' })
  })

  it('rejects a non-object response outright', () => {
    expect(() => validateCampaignEdit([])).toThrow(CampaignValidationError)
  })

  it('filters channels to the known vocabulary, deduplicated', () => {
    const edit = validateCampaignEdit({
      reply: null,
      channels: ['Instagram', 'instagram', 'carrier pigeon', 'whatsapp', 7],
    })
    expect(edit.patch.channels).toEqual(['instagram', 'whatsapp'])
  })

  it('drops durations outside 1–90 days instead of storing them', () => {
    expect(validateCampaignEdit({ reply: null, durationDays: 30 }).patch.durationDays).toBe(30)
    expect(validateCampaignEdit({ reply: null, durationDays: 0 }).patch.durationDays).toBeUndefined()
    expect(
      validateCampaignEdit({ reply: null, durationDays: 365 }).patch.durationDays,
    ).toBeUndefined()
    expect(validateCampaignEdit({ reply: null, durationDays: 29.6 }).patch.durationDays).toBe(30)
  })

  it('a mangled audience basis degrades to hypothesis, never upgrades', () => {
    const edit = validateCampaignEdit({
      reply: null,
      targetAudience: { description: 'Families with young kids', basis: 'definitely-true' },
    })
    expect(edit.patch.targetAudience).toEqual({
      description: 'Families with young kids',
      basis: 'hypothesis',
    })
  })

  it('a mangled offer basis degrades to recommendation, never to existing', () => {
    const edit = validateCampaignEdit({
      reply: null,
      offer: { description: 'Family weekend bundle', basis: 'confirmed' },
    })
    expect(edit.patch.offer).toEqual({
      description: 'Family weekend bundle',
      basis: 'recommendation',
    })
  })

  it('an audience without a description is no audience at all', () => {
    const edit = validateCampaignEdit({
      reply: null,
      targetAudience: { description: '', basis: 'known' },
    })
    expect(edit.patch.targetAudience).toBeUndefined()
  })
})
