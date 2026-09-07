import type { CreativeDirection } from './direction'
import type { CreativeFormat } from './validate'

/**
 * The art direction for one poster (Phase 7G.1) — the brief a designer would
 * write before touching the file, expressed as data.
 *
 * `direction.ts` answers "what kind of poster is this?". That was enough to
 * vary the image brief, but not enough to vary the *picture*: eight
 * directions collapsed into five client layouts, so two posters of a set
 * routinely came out as the same arrangement with different words. And
 * because nothing said where the subject sat, how the brand colour was meant
 * to behave or how the call to action should be shaped, every layout reached
 * for the same answer — a photograph, a flat panel of brand colour, white
 * type, a rounded button.
 *
 * So this module makes those decisions explicitly and deterministically, once,
 * server-side. The record it returns is the contract between the two halves of
 * the pipeline: the image model is briefed to leave room where the type will
 * go, and the client renderer lays the type out where the image left room. A
 * composition that the image was not generated for is a poster whose headline
 * fights its own photograph, which is most of what "template-like" actually
 * looks like.
 *
 * Everything here is a pure function of data the owner and the campaign
 * already produced. No classifier, no model call, no owner-facing setting,
 * and the same campaign always yields the same poster.
 */

/**
 * Where the subject sits, where the quiet is, and therefore where the type,
 * the logo and the call to action can go.
 *
 * Device compositions are separate on purpose. A screenshot is a rectangle of
 * interface, not a photograph: cover-fitting one edge to edge crops it into
 * nonsense, and dropping it flat onto a ground reads as a slide. It has to be
 * held — by a phone, by a scene, by a card — so the poster is a picture of
 * software being used rather than a picture of software.
 */
export const COMPOSITIONS = [
  /** Photograph edge to edge; the message in the frame's own quiet corner. */
  'full_bleed',
  /** Subject on the right, the message in a calm left column. */
  'hero_right',
  /** Subject on the left, the message right. */
  'hero_left',
  /** Subject centred and dominant, the message above and below it. */
  'center_hero',
  /** A brand-colour field beside the photograph, carrying the message. */
  'editorial_split',
  /** Photograph, and a shaped brand section beneath it holding the offer. */
  'bottom_band',
  /** Photograph framed, with the message on a card that overlaps it. */
  'card_overlay',
  /** A phone standing in a scene, the message beside it. */
  'device_beside',
  /** A phone centred and large over a scene, the message above and below. */
  'device_hero',
  /** A phone on a brand-tinted ground, the message stacked above. */
  'device_stack',
  /** No visual: the type and the brand colour are the poster. */
  'typographic',
] as const

export type PosterComposition = (typeof COMPOSITIONS)[number]

/** How the brand colour earns its place on the poster. */
export const ACCENT_TREATMENTS = [
  /** One word of the headline set in the brand colour. */
  'emphasis_word',
  /** A drawn rule under, or beside, the headline. */
  'rule',
  /** A field of brand colour occupying part of the composition. */
  'field',
  /** A small label sitting above the headline. */
  'chip',
] as const

export type AccentTreatment = (typeof ACCENT_TREATMENTS)[number]

/** The call to action's shape. Not every advertisement is a rounded pill. */
export const CTA_STYLES = ['solid', 'outline', 'chip', 'bar'] as const

export type CtaStyle = (typeof CTA_STYLES)[number]

export interface ArtDirection {
  composition: PosterComposition
  accent: AccentTreatment
  cta: CtaStyle
  /** True when the visual is interface and must be framed as a device. */
  device: boolean
}

/* --- the image half of the brief ------------------------------------------ */

/**
 * What the photograph must be for each composition: where the subject sits,
 * and — the part that used to be missing — *why* the rest of the frame is
 * quiet.
 *
 * The previous briefs asked for "plain, evenly lit surface with nothing of
 * interest in it", and the model duly delivered: a beige wall taking up a
 * third of the poster. Real advertising photography does not contain empty
 * planes; it contains depth. The quiet in a good frame is a background thrown
 * out of focus, a wall in shadow, a sky — space that is still *photographed*,
 * merely not competing. Asking for that is the difference between a
 * composition and a hole.
 */
export interface CompositionBrief {
  /** Where the subject goes and how it is framed. */
  subject: string
  /** How the rest of the frame stays quiet without going dead. */
  quiet: string
}

const COMPOSITION_BRIEFS: Record<PosterComposition, CompositionBrief> = {
  full_bleed: {
    subject:
      'Fill the frame with the scene. The subject sits in the upper two-thirds, off-centre, and looks or moves back into the frame rather than out of it.',
    quiet:
      'The lower third falls away naturally — a surface running out of focus, a floor in shadow, depth rather than emptiness. It is still part of the photograph; it simply stops competing.',
  },
  hero_right: {
    subject:
      'The subject occupies the right half of the frame and is unmistakably dominant — close enough to read expression and material, lit so it separates cleanly from what is behind it.',
    quiet:
      'The left half is the same room continuing: background thrown well out of focus, or a wall catching soft light. Real space with real tone, just nothing in it that asks to be looked at.',
  },
  hero_left: {
    subject:
      'The subject occupies the left half of the frame and is unmistakably dominant — close enough to read expression and material, lit so it separates cleanly from what is behind it.',
    quiet:
      'The right half is the same room continuing: background thrown well out of focus, or a wall catching soft light. Real space with real tone, just nothing in it that asks to be looked at.',
  },
  center_hero: {
    subject:
      'One subject, centred, filling the middle band of the frame and lit like a product advertisement — directional key light, readable texture and material, a believable surface underneath it.',
    quiet:
      'Above and below, the ground recedes into soft gradient and shadow. Generous room at the top and bottom edges, with the fall-off doing the work rather than flat colour.',
  },
  editorial_split: {
    subject:
      'Compose for the right two-thirds: the subject sits there, framed close, with the energy of the picture on that side.',
    quiet:
      'Toward the left edge the scene runs into soft shadow and out-of-focus depth, so the frame darkens and calms as it goes left without ever becoming a flat block.',
  },
  bottom_band: {
    subject:
      'Compose for the top two-thirds. The subject sits high in the frame, close and confident, with strong directional light and saturated, appetising colour.',
    quiet:
      'The lower part of the frame is the surface the subject stands on, receding out of focus. Depth, not a blank shelf.',
  },
  card_overlay: {
    subject:
      'One quiet, considered subject in the upper half of the frame, lit softly from one side — the restraint of a fragrance or fashion advertisement rather than a catalogue photograph. Whatever the picture is about must read entirely above the midline: hands, faces, the thing being used.',
    // A near-full-width card is laid over the bottom of this frame, so unlike
    // the other briefs this one has to name the region it will cover.
    // Without that the model centres its subject at the midline and the card
    // lands on the phone the whole photograph was about (§5, one focal point).
    quiet:
      'The lower half of the frame is atmosphere and nothing else — a table running out of focus, a floor in shadow, gentle gradient with tone in it. Nothing there that would be missed if it were covered, and never a flat backdrop.',
  },
  device_beside: {
    subject:
      'A real person in a real setting on the right of the frame, holding or looking at a phone, absorbed in what they are doing. Photograph the person and the moment.',
    quiet:
      'The left of the frame is the room behind them, well out of focus. The phone screen itself must read as a blank, evenly lit rectangle — a real screenshot is composited onto it afterwards, so anything drawn there will be covered.',
  },
  device_hero: {
    subject:
      'A hand holding a phone, or a phone standing on a surface, centred in the frame and lit like a technology advertisement — clean highlights, real materials, shallow depth of field.',
    quiet:
      'The surrounding scene recedes into soft focus and gradient light, with room above and below the device. The phone screen must read as a blank, evenly lit rectangle — a real screenshot is composited onto it afterwards.',
  },
  device_stack: {
    subject:
      'A bright, uncluttered environment where the product is used — a desk, a study corner, a counter — photographed with soft daylight and real depth, with the lower half of the frame open.',
    quiet:
      'The whole frame stays calm and evenly bright, an atmosphere rather than a busy scene. No device needs to appear: one is composited in afterwards.',
  },
  typographic: {
    subject: 'No photograph is used for this poster.',
    quiet: 'No photograph is used for this poster.',
  },
}

export function compositionBrief(composition: PosterComposition): CompositionBrief {
  return COMPOSITION_BRIEFS[composition]
}

/* --- selection ------------------------------------------------------------ */

/**
 * Each direction's compositions, in the order a set walks through them.
 *
 * A set that asks for three posters gets three entries from this list, so the
 * second poster of a set is a different *arrangement* and not merely different
 * words. Before this, `app_showcase` and `feature_highlight` both resolved to
 * one client layout, and posters one and three of every Matheasy set came out
 * as the same picture.
 */
const PHOTO_COMPOSITIONS: Record<CreativeDirection, readonly PosterComposition[]> = {
  hero_product: ['center_hero', 'full_bleed', 'bottom_band'],
  clean_editorial: ['full_bleed', 'hero_right', 'editorial_split'],
  bold_promotional: ['bottom_band', 'hero_left', 'full_bleed'],
  lifestyle: ['hero_right', 'full_bleed', 'card_overlay'],
  educational: ['editorial_split', 'hero_right', 'full_bleed'],
  // Only reached when there is no screenshot to composite — `isScreenshot`
  // routes to DEVICE_COMPOSITIONS above. A device composition without a
  // device draws as an ordinary photo layout under a device's name, which is
  // how a set ended up with two posters of the same design (§13).
  app_showcase: ['center_hero', 'hero_left', 'bottom_band'],
  minimal_premium: ['card_overlay', 'center_hero', 'hero_left'],
  feature_highlight: ['hero_left', 'center_hero', 'editorial_split'],
}

/**
 * When the visual is a screenshot, the composition has to hold a device
 * whatever the direction was — a bare interface rectangle is not a
 * photograph and cannot be treated as one.
 */
const DEVICE_COMPOSITIONS: readonly PosterComposition[] = [
  'device_beside',
  'device_hero',
  'device_stack',
]

/**
 * The accent treatment for a composition. Compositions that already commit a
 * region to brand colour take their accent from that field; the rest earn it
 * in the type, which is where a designer would put it.
 */
const ACCENT_FOR: Record<PosterComposition, AccentTreatment> = {
  full_bleed: 'emphasis_word',
  hero_right: 'rule',
  hero_left: 'rule',
  center_hero: 'chip',
  editorial_split: 'field',
  bottom_band: 'field',
  card_overlay: 'emphasis_word',
  device_beside: 'emphasis_word',
  device_hero: 'rule',
  device_stack: 'chip',
  typographic: 'emphasis_word',
}

/**
 * The call to action's shape. A solid button is the default because it is the
 * clearest, but on a ground that is already brand colour a second solid shape
 * reads as a sticker, and under a wide editorial headline a full-width bar
 * reads better than a small pill adrift in the margin. A bar reads as a bar
 * only under a bottom-anchored message: above a phone it reads as navigation
 * belonging to the app in the picture, so the device compositions never take
 * one.
 */
const CTA_FOR: Record<PosterComposition, CtaStyle> = {
  full_bleed: 'solid',
  hero_right: 'solid',
  hero_left: 'solid',
  center_hero: 'bar',
  editorial_split: 'outline',
  bottom_band: 'outline',
  card_overlay: 'chip',
  device_beside: 'solid',
  device_hero: 'chip',
  device_stack: 'solid',
  typographic: 'solid',
}

export interface ArtDirectionContext {
  direction: CreativeDirection
  format: CreativeFormat
  /** False when no visual could be made — the poster is type and colour. */
  hasVisual: boolean
  /** True when the visual is interface rather than photography. */
  isScreenshot: boolean
  /** Position within a requested set; 0 for a single poster. */
  position: number
  /**
   * The compositions the earlier posters of this set already took.
   *
   * Different directions share compositions — a `clean_editorial` lead and a
   * `hero_product` second poster both reach for `full_bleed` — so rotating the
   * direction is not on its own enough to make a set of three look like three
   * designs. Naming what is already spent is (§11).
   */
  previous?: readonly PosterComposition[]
}

/** The one art-direction decision, made from data alone. */
export function selectArtDirection(context: ArtDirectionContext): ArtDirection {
  if (!context.hasVisual) {
    return { composition: 'typographic', accent: 'emphasis_word', cta: 'solid', device: false }
  }

  const options = context.isScreenshot
    ? DEVICE_COMPOSITIONS
    : PHOTO_COMPOSITIONS[context.direction]
  const index = Number.isInteger(context.position) && context.position > 0 ? context.position : 0
  const start = index % options.length
  const taken = context.previous ?? []

  // Walk the direction's own options from its natural starting point and take
  // the first one this set has not used. Falling back to the natural choice
  // when every option is spent keeps a fourth poster valid rather than absent.
  let composition = options[start]!
  for (let step = 0; step < options.length; step += 1) {
    const candidate = options[(start + step) % options.length]!
    if (!taken.includes(candidate)) {
      composition = candidate
      break
    }
  }

  return {
    composition,
    accent: ACCENT_FOR[composition],
    cta: CTA_FOR[composition],
    device: context.isScreenshot,
  }
}

/**
 * The art direction for one poster of a set, replayed from position zero.
 *
 * Each creative is generated on its own, so the only way position N can know
 * what positions 0…N-1 took is to recompute them. That is pure arithmetic over
 * data already decided — no reads, no model calls — and it is what keeps
 * "buat 3 poster" from returning the same arrangement three times.
 */
export function artDirectionForPosition(
  context: Omit<ArtDirectionContext, 'previous'>,
  directionAt: (position: number) => CreativeDirection,
): ArtDirection {
  const position = Number.isInteger(context.position) && context.position > 0 ? context.position : 0
  const previous: PosterComposition[] = []
  for (let i = 0; i < position; i += 1) {
    previous.push(
      selectArtDirection({ ...context, direction: directionAt(i), position: i, previous: [...previous] })
        .composition,
    )
  }
  return selectArtDirection({ ...context, position, previous })
}
