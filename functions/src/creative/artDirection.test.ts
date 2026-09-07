import { describe, expect, it } from 'vitest'

import {
  ACCENT_TREATMENTS,
  COMPOSITIONS,
  CTA_STYLES,
  artDirectionForPosition,
  compositionBrief,
  selectArtDirection,
  type ArtDirection,
  type PosterComposition,
} from './artDirection'
import { CREATIVE_DIRECTIONS, type CreativeDirection } from './direction'

/**
 * Phase 7G.1 §4/§5/§11 — the art direction is the contract between the two
 * halves of the pipeline. The image model is briefed to leave room where the
 * type will go, and the client renderer lays the type into that room, so the
 * values chosen here are pinned: a change to them is a change to what the
 * photograph must be, not an implementation detail.
 */

const base = {
  format: 'square_post' as const,
  hasVisual: true,
  isScreenshot: false,
  position: 0,
}

describe('selectArtDirection', () => {
  it('gives every direction a complete, valid brief', () => {
    for (const direction of CREATIVE_DIRECTIONS) {
      const art = selectArtDirection({ ...base, direction })
      expect(COMPOSITIONS, direction).toContain(art.composition)
      expect(ACCENT_TREATMENTS, direction).toContain(art.accent)
      expect(CTA_STYLES, direction).toContain(art.cta)
      expect(art.device, direction).toBe(false)
    }
  })

  it('frames a screenshot as a device whatever the direction said', () => {
    for (const direction of CREATIVE_DIRECTIONS) {
      const art = selectArtDirection({ ...base, direction, isScreenshot: true })
      expect(art.composition, direction).toMatch(/^device_/)
      expect(art.device, direction).toBe(true)
    }
  })

  it('falls back to type and colour when there is no visual at all', () => {
    expect(selectArtDirection({ ...base, direction: 'lifestyle', hasVisual: false })).toEqual({
      composition: 'typographic',
      accent: 'emphasis_word',
      cta: 'solid',
      device: false,
    })
  })

  it('never puts a full-width bar above a poster’s message', () => {
    // A bar reads as a call to action only at the foot of the poster. Drawn
    // under a headline that sits at the top — over a centred phone, say — it
    // reads as the navigation of the app in the picture. The contact sheet
    // showed exactly that.
    const BOTTOM_ANCHORED: PosterComposition[] = ['center_hero', 'bottom_band', 'full_bleed']
    for (const composition of COMPOSITIONS) {
      const art = artFor(composition)
      if (art.cta === 'bar') expect(BOTTOM_ANCHORED, composition).toContain(composition)
    }
  })

  it('never asks a brand-colour field to also carry a solid brand button', () => {
    for (const composition of COMPOSITIONS) {
      const art = artFor(composition)
      if (art.accent === 'field') expect(art.cta, composition).not.toBe('solid')
    }
  })
})

/** The art direction a composition carries, found by asking for it. */
function artFor(composition: PosterComposition): ArtDirection {
  for (const direction of CREATIVE_DIRECTIONS) {
    for (let position = 0; position < 4; position += 1) {
      for (const isScreenshot of [false, true]) {
        const art = selectArtDirection({ ...base, direction, position, isScreenshot })
        if (art.composition === composition) return art
      }
    }
  }
  return selectArtDirection({ ...base, direction: 'clean_editorial', hasVisual: false })
}

describe('a set of three is three designs (§11)', () => {
  /** The rotation `direction.ts` produces, as a lookup by position. */
  const rotation = (order: CreativeDirection[]) => (position: number) =>
    order[position % order.length]!

  it('gives consecutive positions different arrangements, not different words', () => {
    // The defect: `clean_editorial` leads, `hero_product` follows, and both
    // reach for `full_bleed` — a set of three identical posters carrying
    // three different headlines.
    const order: CreativeDirection[] = ['clean_editorial', 'hero_product', 'bold_promotional']
    const set = [0, 1, 2].map(
      (position) => artDirectionForPosition({ ...base, direction: order[position]!, position }, rotation(order)),
    )
    const compositions = set.map((art) => art.composition)
    expect(new Set(compositions).size).toBe(3)
  })

  it('holds for every possible lead direction', () => {
    for (const lead of CREATIVE_DIRECTIONS) {
      const order = [lead, ...CREATIVE_DIRECTIONS.filter((d) => d !== lead)]
      const compositions = [0, 1, 2].map(
        (position) =>
          artDirectionForPosition({ ...base, direction: order[position]!, position }, rotation(order))
            .composition,
      )
      expect(new Set(compositions).size, lead).toBe(3)
    }
  })

  it('varies a screenshot set too, across the three device arrangements', () => {
    const order: CreativeDirection[] = ['app_showcase', 'clean_editorial', 'feature_highlight']
    const compositions = [0, 1, 2].map(
      (position) =>
        artDirectionForPosition(
          { ...base, direction: order[position]!, position, isScreenshot: true },
          rotation(order),
        ).composition,
    )
    expect(compositions).toEqual(['device_beside', 'device_hero', 'device_stack'])
  })

  it('is deterministic: the same set position always resolves the same way', () => {
    const order: CreativeDirection[] = ['lifestyle', 'hero_product', 'clean_editorial']
    const once = artDirectionForPosition({ ...base, direction: 'clean_editorial', position: 2 }, rotation(order))
    const twice = artDirectionForPosition({ ...base, direction: 'clean_editorial', position: 2 }, rotation(order))
    expect(once).toEqual(twice)
  })
})

describe('the image brief', () => {
  it('tells the model where the subject goes and why the rest stays quiet', () => {
    for (const composition of COMPOSITIONS) {
      if (composition === 'typographic') continue
      const brief = compositionBrief(composition)
      expect(brief.subject.length, composition).toBeGreaterThan(40)
      expect(brief.quiet.length, composition).toBeGreaterThan(40)
      // §14: the quiet part of a frame is still photographed — depth, shadow,
      // a thrown-out background — never a flat empty plane.
      expect(brief.quiet.toLowerCase(), composition).not.toContain('nothing of interest')
    }
  })
})
