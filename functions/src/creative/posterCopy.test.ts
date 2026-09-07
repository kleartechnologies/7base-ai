import { describe, expect, it } from 'vitest'

import {
  disciplinePosterCopy,
  POSTER_COPY_LIMITS,
  posterCallToAction,
  posterHeadline,
  posterOfferText,
  posterSupportingLine,
  stripLinks,
} from './posterCopy'

/**
 * The poster says one thing and asks for one action; the caption explains.
 * These limits are enforced in code, not asked for in a prompt, so a
 * paragraph headline and a URL set in 40pt cannot reach a poster whichever
 * path the copy came from.
 */

describe('posterHeadline', () => {
  it('keeps a short line exactly as written', () => {
    expect(posterHeadline('Daripada Soalan kepada Faham')).toBe('Daripada Soalan kepada Faham')
  })

  it('drops the full stop — a headline is not a sentence', () => {
    expect(posterHeadline('Lunch without the wait.')).toBe('Lunch without the wait')
  })

  it('takes the first sentence out of a paragraph headline', () => {
    const headline = posterHeadline(
      'Scan your question and understand it. Numi explains every step so you never memorise again.',
    )
    expect(headline).toBe('Scan your question and understand it')
    expect((headline ?? '').length).toBeLessThanOrEqual(POSTER_COPY_LIMITS.headline)
  })

  it('falls back to the leading clause, then to whole words', () => {
    expect(
      posterHeadline('Fresh roasted beans delivered weekly, ground to your brew method, always'),
    ).toBe('Fresh roasted beans delivered weekly')
    const clipped = posterHeadline(
      'Understanding mathematics deeply without memorising formulas repeatedly forever',
    )
    expect((clipped ?? '').length).toBeLessThanOrEqual(POSTER_COPY_LIMITS.headline)
    // Words are never cut in half, and no "…" is invented.
    expect(clipped).not.toContain('…')
    expect('Understanding mathematics deeply without memorising formulas repeatedly forever').toContain(
      clipped ?? '',
    )
  })

  it('never prints a link', () => {
    expect(posterHeadline('Try Matheasy at matheasy.my today')).toBe('Try Matheasy today')
  })
})

describe('posterCallToAction', () => {
  it('leaves a real button alone', () => {
    expect(posterCallToAction('Cuba Percuma')).toBe('Cuba Percuma')
    expect(posterCallToAction('Order on WhatsApp')).toBe('Order on WhatsApp')
  })

  it('strips the URL and the connector it hung on', () => {
    expect(posterCallToAction('Muat turun di matheasy.my')).toBe('Muat turun')
    expect(posterCallToAction('Visit www.example.com/menu now')).toBe('Visit now')
  })

  it('refuses to set a sentence in a button', () => {
    const cta = posterCallToAction('Book your first free class with us this week')
    expect(cta).toBe('Book your first')
    expect((cta ?? '').split(' ')).toHaveLength(3)
  })

  it('is null when there is nothing left to press', () => {
    expect(posterCallToAction(null)).toBeNull()
    expect(posterCallToAction('https://matheasy.my')).toBeNull()
  })
})

describe('posterSupportingLine and posterOfferText', () => {
  it('keeps a real supporting line whole, full stop and all', () => {
    expect(posterSupportingLine('Scan soalan. Faham setiap langkah dengan bantuan Numi.')).toBe(
      'Scan soalan. Faham setiap langkah dengan bantuan Numi.',
    )
  })

  it('cuts a paragraph down to its first sentence', () => {
    const line = posterSupportingLine(
      'Numi explains every step in plain language so nothing is memorised. Thousands of students already study this way, and the first week is free.',
    )
    expect(line).toBe('Numi explains every step in plain language so nothing is memorised.')
    expect((line ?? '').length).toBeLessThanOrEqual(POSTER_COPY_LIMITS.subheadline)
  })

  it('keeps the price and drops the conditions', () => {
    expect(posterOfferText('RM19.90 lunch set, weekdays only, dine-in customers')).toBe(
      'RM19.90 lunch set',
    )
  })
})

describe('stripLinks', () => {
  it('removes links and emails wherever they appear', () => {
    expect(
      stripLinks('Order at https://kedai.my/menu or email us at hi@kedai.my')
        .replace(/\s+/g, ' ')
        .trim(),
    ).toBe('Order or email us')
  })
})

describe('disciplinePosterCopy', () => {
  it('shortens only the poster fields, and only ever by removing words', () => {
    const content = {
      headline: 'Belajar matematik dengan yakin. Setiap langkah dijelaskan dengan sabar.',
      subheadline: 'Numi menerangkan setiap langkah supaya anda faham, bukan menghafal.',
      body: 'The long body stays exactly as it is, because nothing prints it on the poster.',
      callToAction: 'Muat turun percuma di matheasy.my hari ini',
      offerText: 'Percuma untuk 7 hari pertama, tanpa kad kredit',
    }
    const poster = disciplinePosterCopy(content)

    expect(poster.headline).toBe('Belajar matematik dengan yakin')
    expect(poster.callToAction).toBe('Muat turun percuma')
    expect(poster.offerText).toBe('Percuma untuk 7 hari pertama')
    expect(poster.body).toBe(content.body)
    // Every kept word came from the original: shortening cannot invent a claim.
    for (const [field, value] of Object.entries(poster)) {
      if (typeof value !== 'string' || field === 'body') continue
      for (const word of value.split(' ')) {
        expect(content[field as keyof typeof content]).toContain(word)
      }
    }
  })

  it('leaves a creative with no copy alone', () => {
    expect(
      disciplinePosterCopy({
        headline: null,
        subheadline: null,
        body: null,
        callToAction: null,
        offerText: null,
      }),
    ).toEqual({
      headline: null,
      subheadline: null,
      body: null,
      callToAction: null,
      offerText: null,
    })
  })
})
