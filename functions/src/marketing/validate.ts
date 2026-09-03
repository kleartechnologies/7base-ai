/**
 * Validation of the model's marketing recommendation.
 *
 * Same posture as the Business Brain validator: a JSON schema constrains
 * generation, it does not guarantee it. The response is treated as untrusted
 * input and either becomes a value the rest of MARKA can rely on, or is
 * refused. Nothing malformed is ever written to Firestore or shown in chat.
 *
 * Coercion over rejection where honesty allows it — a confidence the model
 * mangled becomes 'low', never 'high'; an unknown channel is dropped; an
 * out-of-range recommended index falls back to the first opportunity. What
 * cannot be coerced honestly (no goal, no diagnosis, no opportunities) fails
 * the whole recommendation.
 */

const LIMITS = {
  shortText: 160,
  mediumText: 400,
  longText: 800,
  opportunities: 4,
  rationale: 5,
  evidence: 5,
  assumptions: 6,
  unknowns: 6,
  channels: 6,
  listItemText: 240,
  maxDurationDays: 90,
} as const

export type RecommendationConfidence = 'low' | 'medium' | 'high'
export type OpportunityImpact =
  | 'high_potential'
  | 'moderate_potential'
  | 'low_potential'
  | 'unknown'
export type OpportunityEffort = 'low' | 'medium' | 'high'
export type RationaleKind = 'fact' | 'inference' | 'recommendation'
export type RecommendationNextAction =
  | 'build_campaign'
  | 'confirm_business_info'
  | 'clarify_goal'

export const RECOMMENDATION_CHANNELS = [
  'facebook',
  'instagram',
  'whatsapp',
  'tiktok',
  'in_store',
  'website',
] as const
export type RecommendationChannel = (typeof RECOMMENDATION_CHANNELS)[number]

/**
 * The Business Brain areas a rationale line may cite. Internal references for
 * future clickable provenance — never raw database paths shown to users.
 */
export const RATIONALE_SOURCES = [
  'identity',
  'products',
  'location',
  'contact',
  'audience',
  'brand',
  'marketing',
  'operations',
  'conversation',
] as const
export type RationaleSource = (typeof RATIONALE_SOURCES)[number]

export interface MarketingOpportunityDraft {
  title: string
  description: string
  evidence: string[]
  assumptions: string[]
  potentialImpact: OpportunityImpact
  effort: OpportunityEffort
  suitability: string | null
}

export interface RecommendationRationaleDraft {
  statement: string
  kind: RationaleKind
  basedOn: RationaleSource | null
}

export interface RecommendationDiagnosisDraft {
  statement: string
  basis: 'evidence' | 'hypothesis'
}

export interface RecommendationAudienceDraft {
  description: string
  basis: 'known' | 'hypothesis'
}

export interface RecommendationOfferDraft {
  description: string
  basis: 'existing' | 'recommendation'
}

/** A validated recommendation, before ownership and ids are attached. */
export interface MarketingRecommendationDraft {
  ownerSummary: string
  goal: string
  diagnosis: RecommendationDiagnosisDraft
  opportunities: MarketingOpportunityDraft[]
  recommendedIndex: number
  rationale: RecommendationRationaleDraft[]
  targetAudience: RecommendationAudienceDraft | null
  offer: RecommendationOfferDraft | null
  positioning: string | null
  coreMessage: string | null
  callToAction: string | null
  channels: RecommendationChannel[]
  durationDays: number | null
  confidence: RecommendationConfidence
  confidenceReason: string | null
  assumptions: string[]
  unknowns: string[]
  nextAction: RecommendationNextAction
}

export class RecommendationValidationError extends Error {
  constructor(reason: string) {
    super(`Marketing recommendation failed validation: ${reason}`)
    this.name = 'RecommendationValidationError'
  }
}

export function validateMarketingRecommendation(raw: unknown): MarketingRecommendationDraft {
  if (!isRecord(raw)) throw new RecommendationValidationError('response was not an object')

  const ownerSummary = text(raw.ownerSummary, LIMITS.longText)
  if (!ownerSummary) throw new RecommendationValidationError('missing owner summary')

  const goal = text(raw.goal, LIMITS.mediumText)
  if (!goal) throw new RecommendationValidationError('missing goal')

  const diagnosisRecord = record(raw.diagnosis)
  const diagnosisStatement = text(diagnosisRecord.statement, LIMITS.mediumText)
  if (!diagnosisStatement) throw new RecommendationValidationError('missing diagnosis')

  const opportunities = readOpportunities(raw.opportunities)
  if (opportunities.length === 0) {
    throw new RecommendationValidationError('no usable opportunities')
  }

  return {
    ownerSummary,
    goal,
    diagnosis: {
      statement: diagnosisStatement,
      // Only an explicit 'evidence' counts as evidence — a mangled or missing
      // basis must never upgrade a hypothesis into a finding.
      basis: diagnosisRecord.basis === 'evidence' ? 'evidence' : 'hypothesis',
    },
    opportunities,
    recommendedIndex: readIndex(raw.recommendedIndex, opportunities.length),
    rationale: readRationale(raw.rationale),
    targetAudience: readAudience(raw.targetAudience),
    offer: readOffer(raw.offer),
    positioning: text(raw.positioning, LIMITS.shortText),
    coreMessage: text(raw.coreMessage, LIMITS.shortText),
    callToAction: text(raw.callToAction, LIMITS.shortText),
    channels: readChannels(raw.channels),
    durationDays: readDuration(raw.durationDays),
    confidence: readConfidence(raw.confidence),
    confidenceReason: text(raw.confidenceReason, LIMITS.mediumText),
    assumptions: list(raw.assumptions).slice(0, LIMITS.assumptions),
    unknowns: list(raw.unknowns).slice(0, LIMITS.unknowns),
    nextAction: readNextAction(raw.nextAction),
  }
}

/** The opportunity the draft points at, tolerating a repaired index. */
export function recommendedOpportunity(
  draft: MarketingRecommendationDraft,
): MarketingOpportunityDraft {
  const chosen = draft.opportunities[draft.recommendedIndex] ?? draft.opportunities[0]
  if (!chosen) throw new RecommendationValidationError('no usable opportunities')
  return chosen
}

/* --- readers ------------------------------------------------------------ */

function readOpportunities(value: unknown): MarketingOpportunityDraft[] {
  if (!Array.isArray(value)) return []
  const items: MarketingOpportunityDraft[] = []

  for (const entry of value) {
    if (!isRecord(entry)) continue
    const title = text(entry.title, LIMITS.shortText)
    const description = text(entry.description, LIMITS.mediumText)
    if (!title || !description) continue

    items.push({
      title,
      description,
      evidence: list(entry.evidence).slice(0, LIMITS.evidence),
      assumptions: list(entry.assumptions).slice(0, LIMITS.assumptions),
      potentialImpact: readImpact(entry.potentialImpact),
      effort: readEffort(entry.effort),
      suitability: text(entry.suitability, LIMITS.mediumText),
    })
    if (items.length >= LIMITS.opportunities) break
  }

  return items
}

function readRationale(value: unknown): RecommendationRationaleDraft[] {
  if (!Array.isArray(value)) return []
  const items: RecommendationRationaleDraft[] = []
  const sources = new Set<string>(RATIONALE_SOURCES)

  for (const entry of value) {
    if (!isRecord(entry)) continue
    const statement = text(entry.statement, LIMITS.mediumText)
    if (!statement) continue

    const kind = entry.kind
    const basedOn = typeof entry.basedOn === 'string' ? entry.basedOn.trim().toLowerCase() : null

    items.push({
      statement,
      // A claim of unknown kind is treated as MARKA's own recommendation —
      // the one label that never overstates what is known.
      kind: kind === 'fact' || kind === 'inference' ? kind : 'recommendation',
      basedOn: basedOn && sources.has(basedOn) ? (basedOn as RationaleSource) : null,
    })
    if (items.length >= LIMITS.rationale) break
  }

  return items
}

function readAudience(value: unknown): RecommendationAudienceDraft | null {
  const entry = record(value)
  const description = text(entry.description, LIMITS.mediumText)
  if (!description) return null
  // 'known' must be claimed explicitly; anything else stays a hypothesis.
  return { description, basis: entry.basis === 'known' ? 'known' : 'hypothesis' }
}

function readOffer(value: unknown): RecommendationOfferDraft | null {
  const entry = record(value)
  const description = text(entry.description, LIMITS.mediumText)
  if (!description) return null
  // 'existing' must be claimed explicitly; anything else is a recommendation.
  return {
    description,
    basis: entry.basis === 'existing' ? 'existing' : 'recommendation',
  }
}

function readChannels(value: unknown): RecommendationChannel[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<string>(RECOMMENDATION_CHANNELS)
  const channels: RecommendationChannel[] = []
  const seen = new Set<string>()

  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const clean = entry.trim().toLowerCase()
    if (!allowed.has(clean) || seen.has(clean)) continue
    seen.add(clean)
    channels.push(clean as RecommendationChannel)
    if (channels.length >= LIMITS.channels) break
  }

  return channels
}

function readIndex(value: unknown, count: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  const index = Math.trunc(value)
  return index >= 0 && index < count ? index : 0
}

function readDuration(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const days = Math.round(value)
  return days >= 1 && days <= LIMITS.maxDurationDays ? days : null
}

function readConfidence(value: unknown): RecommendationConfidence {
  // A confidence the model failed to state honestly defaults down, never up.
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low'
}

function readImpact(value: unknown): OpportunityImpact {
  return value === 'high_potential' || value === 'moderate_potential' || value === 'low_potential'
    ? value
    : 'unknown'
}

function readEffort(value: unknown): OpportunityEffort {
  return value === 'low' || value === 'high' ? value : 'medium'
}

function readNextAction(value: unknown): RecommendationNextAction {
  return value === 'confirm_business_info' || value === 'clarify_goal' ? value : 'build_campaign'
}

/* --- coercion helpers --------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  // Models occasionally answer the prompt instead of the field.
  if (/^(unknown|n\/?a|none|not (found|stated|available|specified))$/i.test(clean)) return null
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const items: string[] = []
  const seen = new Set<string>()

  for (const entry of value) {
    const clean = text(entry, LIMITS.listItemText)
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    items.push(clean)
  }

  return items
}
