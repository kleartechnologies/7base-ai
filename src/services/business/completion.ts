import type {
  Audience,
  Business,
  MarketingProfile,
  OperationsProfile,
  Product,
} from '@/types'
import { t } from '@/i18n/store'
import type { MessageKey } from '@/i18n/translate'
import type { BusinessFacts } from './brain'

/**
 * EVA Business Profile Completion — the deterministic half.
 *
 * When discovery could not learn enough (a sparse Facebook Page, a thin
 * website, no online presence at all), EVA asks the owner instead of guessing.
 * This module decides *what* to ask and turns each answer into a write against
 * the existing Business Brain — no second profile system, no AI call, no new
 * collection. Gap detection is a handful of null checks against what the Brain
 * already holds, which is also what guarantees EVA never asks something she
 * already knows.
 *
 * Answers become owner-authored facts through the same save paths the Business
 * tab's Edit buttons use, so they carry `source: 'user', confirmed: true` and
 * outrank anything a later re-analysis discovers.
 */

export type CompletionQuestionId =
  | 'best_sellers'
  | 'opening_hours'
  | 'ordering_methods'
  | 'differentiator'
  | 'customers'
  | 'description'

export interface CompletionQuestion {
  id: CompletionQuestionId
  /** EVA's question, in her own voice. */
  prompt: string
  /** A quiet second line under the prompt, when the question needs one. */
  helper: string | null
  kind: 'text' | 'multiline' | 'choices'
  /** Only for `choices`. Pick-many, because the answer genuinely is a mix. */
  choices?: readonly string[]
  placeholder: string | null
}

const ORDERING_CHOICE_KEYS: readonly MessageKey[] = [
  'business.choiceDineIn',
  'business.choiceTakeaway',
  'business.choiceDelivery',
  'business.choiceWhatsappOrders',
]

/** The ordering options, in the active UI language. */
export const ORDERING_CHOICES = (): readonly string[] =>
  ORDERING_CHOICE_KEYS.map((key) => t(key))

/**
 * Everything EVA knows how to ask, in the order that matters for marketing:
 * what sells, when you're open, how people buy, why you, who buys. A missing
 * description is asked only when there is room left — for most businesses the
 * best-sellers answer already says what they offer.
 *
 * Stored as message keys and resolved when the questions are requested, so the
 * wording follows the UI language the owner has picked at that moment.
 */
interface QuestionSpec {
  id: CompletionQuestionId
  promptKey: MessageKey
  helperKey: MessageKey | null
  kind: 'text' | 'multiline' | 'choices'
  choiceKeys?: readonly MessageKey[]
  placeholderKey: MessageKey | null
}

const QUESTIONS: readonly QuestionSpec[] = [
  {
    id: 'best_sellers',
    promptKey: 'business.qBestSellers',
    helperKey: 'business.qBestSellersHelper',
    kind: 'multiline',
    placeholderKey: 'business.qBestSellersPlaceholder',
  },
  {
    id: 'opening_hours',
    promptKey: 'business.qOpeningHours',
    helperKey: null,
    kind: 'text',
    placeholderKey: 'business.qOpeningHoursPlaceholder',
  },
  {
    id: 'ordering_methods',
    promptKey: 'business.qOrdering',
    helperKey: 'business.qOrderingHelper',
    kind: 'choices',
    choiceKeys: ORDERING_CHOICE_KEYS,
    placeholderKey: null,
  },
  {
    id: 'differentiator',
    promptKey: 'business.qDifferentiator',
    helperKey: 'business.qDifferentiatorHelper',
    kind: 'multiline',
    placeholderKey: 'business.qDifferentiatorPlaceholder',
  },
  {
    id: 'customers',
    promptKey: 'business.qCustomers',
    helperKey: null,
    kind: 'text',
    placeholderKey: 'business.qCustomersPlaceholder',
  },
  {
    id: 'description',
    promptKey: 'business.qDescription',
    helperKey: null,
    kind: 'multiline',
    placeholderKey: 'business.qDescriptionPlaceholder',
  },
]

function resolveQuestion(spec: QuestionSpec): CompletionQuestion {
  return {
    id: spec.id,
    prompt: t(spec.promptKey),
    helper: spec.helperKey ? t(spec.helperKey) : null,
    kind: spec.kind,
    ...(spec.choiceKeys ? { choices: spec.choiceKeys.map((key) => t(key)) } : {}),
    placeholder: spec.placeholderKey ? t(spec.placeholderKey) : null,
  }
}

/** Keep the ask short. Skipping is always allowed; more can wait. */
const MAX_QUESTIONS = 5

/** True when the Brain already answers this question. Known ⇒ never asked. */
function isAnswered(business: Business, id: CompletionQuestionId): boolean {
  const { identity, location, products, audience, marketing, operations } = business
  switch (id) {
    case 'best_sellers':
      return products.length > 0 || (marketing?.value.emphasizedProducts.length ?? 0) > 0
    case 'opening_hours':
      return Boolean(location.openingHours || operations?.value.openingHours)
    case 'ordering_methods':
      return (operations?.value.orderingMethods.length ?? 0) > 0
    case 'differentiator':
      return Boolean(
        (marketing?.value.differentiators.length ?? 0) > 0 || marketing?.value.valueProposition,
      )
    case 'customers':
      return Boolean(audience?.value.summary || (audience?.value.customerTypes.length ?? 0) > 0)
    case 'description':
      return Boolean(identity.description?.trim())
  }
}

/**
 * The questions worth asking this business right now.
 *
 * Deterministic on purpose: finding gaps is a comparison against the Brain,
 * not a model call. Works the same whether the Brain came from a website, a
 * Facebook Page, an Instagram profile, or the owner typing two lines.
 */
export function missingQuestions(business: Business): CompletionQuestion[] {
  return QUESTIONS.filter((question) => !isAnswered(business, question.id))
    .slice(0, MAX_QUESTIONS)
    .map(resolveQuestion)
}

/**
 * The sentence that frames the ask. Missing information is an opportunity,
 * not a failure — and the reason is named without technical words.
 */
export function completionIntro(business: Business): string {
  const kind = latestDiscoverySource(business)
  if (!kind) return t('business.completionIntroNoSource')
  const noun =
    kind === 'facebook'
      ? t('onboarding.sourceNounFacebook')
      : kind === 'instagram'
        ? t('onboarding.sourceNounInstagram')
        : t('onboarding.sourceNounWebsite')
  return t('business.completionIntroSource', { source: noun })
}

/** The most recently analysed source, for source-aware wording. */
export function latestDiscoverySource(
  business: Business,
): 'website' | 'facebook' | 'instagram' | null {
  let latest: { kind: 'website' | 'facebook' | 'instagram'; at: number } | null = null
  for (const source of business.sources) {
    if (source.kind !== 'website' && source.kind !== 'facebook' && source.kind !== 'instagram') {
      continue
    }
    const at = source.lastSyncedAt ?? 0
    if (!latest || at >= latest.at) latest = { kind: source.kind, at }
  }
  return latest?.kind ?? null
}

/**
 * One answer, expressed as a write against the existing Brain.
 *
 * The component maps each variant onto the matching service call
 * (`saveBusinessFacts`, `saveProducts`, `saveBrainSection`) — the same
 * owner-authorized paths every Edit button already uses. Null means the answer
 * carried nothing worth writing, and nothing is written: an empty or skipped
 * answer must never manufacture a fact.
 */
export type CompletionWrite =
  | { kind: 'facts'; facts: BusinessFacts }
  | { kind: 'products'; products: Product[] }
  | { kind: 'section'; section: 'audience'; value: Audience }
  | { kind: 'section'; section: 'marketing'; value: MarketingProfile }
  | { kind: 'section'; section: 'operations'; value: OperationsProfile }

export function applyAnswer(
  business: Business,
  id: CompletionQuestionId,
  answer: string | string[],
  now: number = Date.now(),
): CompletionWrite | null {
  switch (id) {
    case 'best_sellers': {
      const names = listFromAnswer(answer)
      if (names.length === 0) return null
      return { kind: 'products', products: withSignatureProducts(business.products, names, now) }
    }
    case 'opening_hours': {
      const hours = textFromAnswer(answer)
      if (!hours) return null
      return {
        kind: 'facts',
        facts: {
          name: business.name,
          identity: business.identity,
          contact: business.contact,
          location: { ...business.location, openingHours: hours },
        },
      }
    }
    case 'ordering_methods': {
      const methods = listFromAnswer(answer)
      if (methods.length === 0) return null
      return {
        kind: 'section',
        section: 'operations',
        value: { ...(business.operations?.value ?? emptyOperations()), orderingMethods: methods },
      }
    }
    case 'differentiator': {
      const text = textFromAnswer(answer)
      if (!text) return null
      const existing = business.marketing?.value ?? emptyMarketing()
      return {
        kind: 'section',
        section: 'marketing',
        value: { ...existing, differentiators: dedupe([...existing.differentiators, text]) },
      }
    }
    case 'customers': {
      const text = textFromAnswer(answer)
      if (!text) return null
      return {
        kind: 'section',
        section: 'audience',
        value: { ...(business.audience?.value ?? emptyAudience()), summary: text },
      }
    }
    case 'description': {
      const text = textFromAnswer(answer)
      if (!text) return null
      return {
        kind: 'facts',
        facts: {
          name: business.name,
          identity: { ...business.identity, description: text },
          contact: business.contact,
          location: business.location,
        },
      }
    }
  }
}

/**
 * Folds the owner's best-seller names into the product list.
 *
 * A name EVA already has becomes signature and owner-confirmed — the owner
 * just vouched for it. A new name becomes an owner-authored product with no
 * invented price or description: only what the owner actually said is stored.
 */
function withSignatureProducts(existing: Product[], names: string[], now: number): Product[] {
  const products = [...existing]
  for (const [index, name] of names.entries()) {
    const key = productNameKey(name)
    const current = products.findIndex((product) => productNameKey(product.name) === key)
    if (current >= 0) {
      const product = products[current]!
      products[current] = { ...product, isSignature: true, confirmed: true, confirmedAt: now }
      continue
    }
    products.push({
      id: `p-user-${now}-${index}`,
      name,
      description: null,
      priceMinor: null,
      currency: 'MYR',
      category: null,
      imageUrl: null,
      isSignature: true,
      attributes: [],
      source: 'user',
      sourceRef: null,
      confidence: 1,
      confirmed: true,
      confirmedAt: now,
    })
  }
  return products
}

/** Matches how the backend merge keys products, so re-analysis lines up. */
function productNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function textFromAnswer(answer: string | string[]): string | null {
  const text = (Array.isArray(answer) ? answer.join(', ') : answer).trim()
  return text.length > 0 ? text : null
}

function listFromAnswer(answer: string | string[]): string[] {
  const parts = Array.isArray(answer) ? answer : answer.split(/[\n,]/)
  return dedupe(parts.map((part) => part.trim()).filter((part) => part.length > 0))
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function emptyAudience(): Audience {
  return {
    summary: null,
    segments: [],
    customerTypes: [],
    demographics: [],
    useCases: [],
    needs: [],
    preferences: [],
  }
}

function emptyMarketing(): MarketingProfile {
  return {
    positioning: null,
    valueProposition: null,
    differentiators: [],
    competitors: [],
    activeChannels: [],
    pastActivity: null,
    promotions: [],
    callsToAction: [],
    themes: [],
    emphasizedProducts: [],
  }
}

function emptyOperations(): OperationsProfile {
  return {
    openingHours: null,
    orderingMethods: [],
    deliveryPlatforms: [],
    reservations: null,
    notes: [],
  }
}
