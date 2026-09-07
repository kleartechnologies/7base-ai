import type { StoredCampaign } from '../campaign/store'
import type { StoredBusiness } from '../lib/business.types'

/**
 * Which *kind* of poster this creative is — chosen deterministically.
 *
 * A poster for a launch, a discount, a class and a coffee shop are four
 * different design problems, and answering all four with one hard-coded
 * layout ("headline bar, photo, pill button") is why generated posters look
 * templated. So the direction is decided here, in code, from what the
 * campaign and the owner's assets already say: no AI classifier, no new
 * model call, no owner-facing setting. The same campaign always yields the
 * same direction, and a set of N posters deliberately spreads across N
 * directions so three posters are three designs, not one design three times.
 *
 * The direction feeds two places and nothing else: the art-direction brief
 * the image model receives (`buildImagePrompt`) and the persisted
 * `style.direction` the client renderer lays out from. It never changes what
 * the poster is allowed to *claim* — grounding stays where it is.
 */

export const CREATIVE_DIRECTIONS = [
  'hero_product',
  'clean_editorial',
  'bold_promotional',
  'lifestyle',
  'educational',
  'app_showcase',
  'minimal_premium',
  'feature_highlight',
] as const

export type CreativeDirection = (typeof CREATIVE_DIRECTIONS)[number]

/** The owner's own photo that will carry the poster, when one was selected. */
export interface DirectionPhoto {
  type: string
  name: string
  description: string | null
  tags: string[]
}

export interface DirectionContext {
  campaign: StoredCampaign
  /** Null when the business document is gone; the campaign still decides. */
  business: StoredBusiness | null
  /** Null when no eligible asset fits and the visual will be generated. */
  photo: DirectionPhoto | null
}

/* --- signals ------------------------------------------------------------ */

/**
 * Keyword sets are bilingual on purpose: a Malaysian owner's campaign says
 * "kelas" as often as "class", and a direction that only reads English would
 * quietly default every Bahasa Melayu campaign to the same layout.
 */
const SOFTWARE_WORDS = [
  'app',
  'aplikasi',
  'software',
  'perisian',
  'platform',
  'saas',
  'dashboard',
  'website',
  'laman web',
  'web app',
  'mobile app',
  'download',
  'muat turun',
  'sign up free',
  'daftar percuma',
  'play store',
  'app store',
]

const SCREENSHOT_WORDS = ['screenshot', 'screen shot', 'skrin', 'ui', 'app screen', 'interface']

const OFFER_WORDS = [
  'discount',
  'diskaun',
  'promo',
  'promosi',
  'sale',
  'jualan',
  'offer',
  'tawaran',
  'deal',
  'free',
  'percuma',
  'bundle',
  'combo',
  'voucher',
  'baucar',
  'rebat',
  'potongan',
  'limited time',
  'masa terhad',
]

const TEACHING_WORDS = [
  'learn',
  'belajar',
  'class',
  'kelas',
  'course',
  'kursus',
  'tuition',
  'tuisyen',
  'tutor',
  'workshop',
  'bengkel',
  'training',
  'latihan',
  'lesson',
  'pelajaran',
  'exam',
  'peperiksaan',
  'homework',
  'kerja rumah',
  'tips',
  'guide',
  'panduan',
  'explain',
  'terangkan',
  'faham',
  'understand',
  'study',
  'ulangkaji',
  'syllabus',
  'silibus',
]

const PREMIUM_WORDS = [
  'premium',
  'luxury',
  'mewah',
  'exclusive',
  'eksklusif',
  'artisan',
  'handcrafted',
  'handmade',
  'boutique',
  'signature',
  'fine dining',
  'elegant',
  'minimal',
  'minimalis',
  'craft',
]

const LIFESTYLE_WORDS = [
  'family',
  'keluarga',
  'friends',
  'kawan',
  'community',
  'komuniti',
  'experience',
  'pengalaman',
  'suasana',
  'ambience',
  'weekend',
  'hujung minggu',
  'raya',
  'festive',
  'perayaan',
  'dine in',
  'dine-in',
  'makan',
  'hangout',
  'lepak',
  'celebrate',
  'sambutan',
]

const LAUNCH_WORDS = [
  'launch',
  'pelancaran',
  'new',
  'baharu',
  'baru',
  'introducing',
  'memperkenalkan',
  'coming soon',
  'akan datang',
  'opening',
  'pembukaan',
]

/** Lowercased haystack of everything the campaign and business already say. */
function corpusOf(context: DirectionContext): string {
  const c = context.campaign
  const b = context.business
  const parts: (string | null | undefined)[] = [
    c.name,
    c.objective,
    c.targetAudience?.description,
    c.offer?.description,
    c.positioning,
    c.keyMessage,
    c.callToAction,
    c.notes,
    b?.name,
    b?.identity.tagline,
    b?.identity.description,
    b?.identity.category,
    b?.identity.subIndustry,
    b?.identity.businessType,
    ...(b?.products ?? []).flatMap((product) => [product.name, product.description, product.category]),
    context.photo?.name,
    context.photo?.description,
    ...(context.photo?.tags ?? []),
  ]
  return parts.filter(Boolean).join(' \n ').toLowerCase()
}

/**
 * Whole-word matching, compiled once per list. Substring matching is the
 * trap here: "WhatsApp" contains "app", and every campaign with a WhatsApp
 * call to action would otherwise be art-directed as a software product.
 */
const patterns = new Map<readonly string[], RegExp>()

function mentions(corpus: string, words: readonly string[]): boolean {
  let pattern = patterns.get(words)
  if (!pattern) {
    const alternatives = words
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')
    pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})s?(?![\\p{L}\\p{N}])`, 'iu')
    patterns.set(words, pattern)
  }
  return pattern.test(corpus)
}

/** A concrete, printable offer — not "consider a lunch set". */
function hasConcreteOffer(campaign: StoredCampaign, corpus: string): boolean {
  const offer = campaign.offer
  if (!offer || offer.basis !== 'existing') return false
  const text = offer.description.toLowerCase()
  return /(?:rm|myr)\s?\d/.test(text) || /\d+\s?%/.test(text) || mentions(corpus, OFFER_WORDS)
}

/**
 * A screenshot reads as a rectangle of UI, and must be shown as a device.
 *
 * Exported because two decisions turn on it and they must never disagree:
 * which direction this poster is (here) and whether the poster needs a
 * generated scene to hold the screenshot (`artDirection.ts`, via
 * `visualIsScreenshot`). One predicate, one answer.
 */
function photoIsScreenshot(context: DirectionContext, corpus: string): boolean {
  const photo = context.photo
  if (!photo) return false
  const own = [photo.name, photo.description ?? '', ...photo.tags].join(' ').toLowerCase()
  return mentions(own, SCREENSHOT_WORDS) || (mentions(corpus, SOFTWARE_WORDS) && photo.type !== 'logo')
}

/** Food and drink still deserve the appetite-first treatment. */
function isFoodBusiness(context: DirectionContext, corpus: string): boolean {
  if (context.business?.industry === 'food_and_beverage') return true
  return ['restoran', 'restaurant', 'cafe', 'kafe', 'kedai makan', 'catering', 'bakery', 'bakeri']
    .some((word) => corpus.includes(word))
}

/* --- selection ---------------------------------------------------------- */

/**
 * The one direction this campaign leads with. Rules are ordered, first match
 * wins, and the order encodes what a designer would ask first: what am I
 * actually showing, and what is the poster for?
 */
export function selectDirection(context: DirectionContext): CreativeDirection {
  const corpus = corpusOf(context)

  // A screenshot or a piece of software: the product *is* an interface, and
  // pretending otherwise gives you a stock photo with an app's name on it.
  if (photoIsScreenshot(context, corpus) || mentions(corpus, SOFTWARE_WORDS)) {
    return 'app_showcase'
  }

  // A real, stated offer is the message. Everything else supports it.
  if (hasConcreteOffer(context.campaign, corpus)) return 'bold_promotional'

  // Teaching, explaining, classes — the promise is understanding, not a thing.
  if (mentions(corpus, TEACHING_WORDS)) return 'educational'

  // The owner's own photo of the thing they sell.
  if (context.photo && isFoodBusiness(context, corpus)) return 'hero_product'
  if (context.photo && mentions(corpus, LIFESTYLE_WORDS)) return 'lifestyle'
  if (context.photo && mentions(corpus, LAUNCH_WORDS)) return 'hero_product'

  if (mentions(corpus, PREMIUM_WORDS)) return 'minimal_premium'

  // Several things worth naming — a list poster beats a vague one.
  if ((context.business?.products.length ?? 0) >= 3) return 'feature_highlight'

  return 'clean_editorial'
}

/**
 * The order a *set* walks through. The lead direction comes first, then the
 * companions that make a genuinely different second and third poster — a
 * promo followed by another promo is one idea printed twice. Every direction
 * appears exactly once, so a set can never repeat until all eight are used.
 */
const COMPANIONS: Record<CreativeDirection, readonly CreativeDirection[]> = {
  hero_product: ['clean_editorial', 'lifestyle', 'bold_promotional', 'minimal_premium'],
  clean_editorial: ['hero_product', 'bold_promotional', 'minimal_premium', 'lifestyle'],
  bold_promotional: ['hero_product', 'clean_editorial', 'lifestyle', 'feature_highlight'],
  lifestyle: ['hero_product', 'clean_editorial', 'bold_promotional', 'minimal_premium'],
  educational: ['clean_editorial', 'feature_highlight', 'bold_promotional', 'minimal_premium'],
  app_showcase: ['clean_editorial', 'feature_highlight', 'bold_promotional', 'minimal_premium'],
  minimal_premium: ['clean_editorial', 'hero_product', 'lifestyle', 'feature_highlight'],
  feature_highlight: ['clean_editorial', 'bold_promotional', 'hero_product', 'minimal_premium'],
}

/** The full rotation for a context: lead, companions, then the remainder. */
export function directionRotation(context: DirectionContext): CreativeDirection[] {
  const lead = selectDirection(context)
  const ordered = [lead, ...COMPANIONS[lead], ...CREATIVE_DIRECTIONS]
  return [...new Set(ordered)]
}

/**
 * The direction for one poster of a set. Position 0 is the lead direction —
 * a single poster always gets exactly what `selectDirection` chose — and
 * later positions walk the rotation, so "buat 3 poster" yields three designs.
 */
export function directionForPosition(
  context: DirectionContext,
  position: number,
): CreativeDirection {
  const rotation = directionRotation(context)
  const index = Number.isInteger(position) && position > 0 ? position : 0
  return rotation[index % rotation.length] ?? rotation[0] ?? 'clean_editorial'
}

/**
 * Whether the visual chosen for this context is interface rather than
 * photography — the same judgement `selectDirection` makes internally, on
 * the same corpus, so the art direction and the direction cannot diverge.
 */
export function visualIsScreenshot(context: DirectionContext): boolean {
  if (!context.photo) return false
  return photoIsScreenshot(context, corpusOf(context))
}
