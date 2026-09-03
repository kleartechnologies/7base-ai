import {
  RECOMMENDATION_CHANNELS,
  type RecommendationChannel,
} from '../marketing/validate'

/**
 * The campaign domain: types and validation.
 *
 * A campaign is the actionable form of a marketing recommendation — its own
 * object, never a copy of the recommendation and never a wall of generated
 * text. Same validation posture as the marketing engine: a JSON schema
 * constrains the model's output shape, and this module treats the *contents*
 * as untrusted input. Coercion over rejection where honesty allows it, and a
 * provenance basis is never upgraded by anything the model says.
 */

const LIMITS = {
  name: 80,
  shortText: 160,
  mediumText: 400,
  listItemText: 240,
  assumptions: 8,
  unknowns: 8,
  channels: 6,
  maxDurationDays: 90,
} as const

/** Draft until the owner promotes it; no active/paused lifecycle yet. */
export const CAMPAIGN_STATUSES = ['draft', 'ready', 'archived'] as const
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]

/** Same channel vocabulary as recommendations — one list, not two. */
export const CAMPAIGN_CHANNELS = RECOMMENDATION_CHANNELS
export type CampaignChannel = RecommendationChannel

/** 'known' only when the Business Brain establishes the audience. */
export interface CampaignAudience {
  description: string
  basis: 'known' | 'hypothesis'
}

/** 'existing' only for an offer the Business Brain actually records. */
export interface CampaignOffer {
  description: string
  basis: 'existing' | 'recommendation'
}

/**
 * The content of a campaign — everything strategy, nothing ownership.
 * Every field the owner can edit lives here; ids and timestamps do not.
 */
export interface CampaignContent {
  name: string
  objective: string | null
  targetAudience: CampaignAudience | null
  offer: CampaignOffer | null
  positioning: string | null
  keyMessage: string | null
  callToAction: string | null
  channels: CampaignChannel[]
  /** A recommendation, not a known optimum. */
  durationDays: number | null
  startDate: number | null
  endDate: number | null
  notes: string | null
  /** What this campaign quietly relies on. Stated, never hidden. */
  assumptions: string[]
  /** What is not established and must not be invented. */
  unknowns: string[]
}

/**
 * The fields a user or an AI edit may change. `userEdited` records which of
 * these the owner has taken authority over — see `applyCampaignPatch`.
 */
export const CAMPAIGN_EDITABLE_FIELDS = [
  'name',
  'objective',
  'targetAudience',
  'offer',
  'positioning',
  'keyMessage',
  'callToAction',
  'channels',
  'durationDays',
  'startDate',
  'endDate',
  'notes',
] as const
export type CampaignEditableField = (typeof CAMPAIGN_EDITABLE_FIELDS)[number]

/** A validated set of changes. Absent key = untouched field. */
export type CampaignPatch = Partial<
  Pick<
    CampaignContent,
    | 'name'
    | 'objective'
    | 'targetAudience'
    | 'offer'
    | 'positioning'
    | 'keyMessage'
    | 'callToAction'
    | 'channels'
    | 'durationDays'
    | 'notes'
  >
>

/** What the fast polish call may contribute on top of the deterministic draft. */
export interface CampaignPolishDraft {
  name: string | null
  objective: string | null
  keyMessage: string | null
  callToAction: string | null
  notes: string | null
}

/** A validated conversational edit: the patch plus MARKA's short reply. */
export interface CampaignEditDraft {
  reply: string | null
  patch: CampaignPatch
}

export class CampaignValidationError extends Error {
  constructor(reason: string) {
    super(`Campaign output failed validation: ${reason}`)
    this.name = 'CampaignValidationError'
  }
}

/**
 * The polish call only ever contributes copy — a null field means "keep the
 * deterministic draft". Nothing here can touch audience, offer, channels or
 * duration, which is what keeps polish incapable of changing provenance.
 */
export function validateCampaignPolish(raw: unknown): CampaignPolishDraft {
  if (!isRecord(raw)) throw new CampaignValidationError('polish response was not an object')
  return {
    name: text(raw.name, LIMITS.name),
    objective: text(raw.objective, LIMITS.mediumText),
    keyMessage: text(raw.keyMessage, LIMITS.shortText),
    callToAction: text(raw.callToAction, LIMITS.shortText),
    notes: text(raw.notes, LIMITS.mediumText),
  }
}

/**
 * A conversational edit. Null fields are untouched; anything present is
 * validated and clamped. Basis claims are read here but re-clamped against
 * the stored campaign in `applyCampaignPatch` — the model's say-so alone can
 * never mark an audience 'known' or an offer 'existing'.
 */
export function validateCampaignEdit(raw: unknown): CampaignEditDraft {
  if (!isRecord(raw)) throw new CampaignValidationError('edit response was not an object')

  const patch: CampaignPatch = {}

  const name = text(raw.name, LIMITS.name)
  if (name) patch.name = name

  const objective = text(raw.objective, LIMITS.mediumText)
  if (objective) patch.objective = objective

  const audience = readAudience(raw.targetAudience)
  if (audience) patch.targetAudience = audience

  const offer = readOffer(raw.offer)
  if (offer) patch.offer = offer

  const positioning = text(raw.positioning, LIMITS.shortText)
  if (positioning) patch.positioning = positioning

  const keyMessage = text(raw.keyMessage, LIMITS.shortText)
  if (keyMessage) patch.keyMessage = keyMessage

  const callToAction = text(raw.callToAction, LIMITS.shortText)
  if (callToAction) patch.callToAction = callToAction

  if (Array.isArray(raw.channels)) {
    patch.channels = readChannels(raw.channels)
  }

  if (typeof raw.durationDays === 'number' && Number.isFinite(raw.durationDays)) {
    const days = Math.round(raw.durationDays)
    if (days >= 1 && days <= LIMITS.maxDurationDays) patch.durationDays = days
  }

  const notes = text(raw.notes, LIMITS.mediumText)
  if (notes) patch.notes = notes

  return { reply: text(raw.reply, LIMITS.mediumText), patch }
}

export function readAudience(value: unknown): CampaignAudience | null {
  const entry = record(value)
  const description = text(entry.description, LIMITS.mediumText)
  if (!description) return null
  // 'known' must be claimed explicitly; anything else stays a hypothesis.
  return { description, basis: entry.basis === 'known' ? 'known' : 'hypothesis' }
}

export function readOffer(value: unknown): CampaignOffer | null {
  const entry = record(value)
  const description = text(entry.description, LIMITS.mediumText)
  if (!description) return null
  // 'existing' must be claimed explicitly; anything else is a recommendation.
  return { description, basis: entry.basis === 'existing' ? 'existing' : 'recommendation' }
}

export function readChannels(value: unknown): CampaignChannel[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<string>(CAMPAIGN_CHANNELS)
  const seen = new Set<string>()
  const channels: CampaignChannel[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const clean = entry.trim().toLowerCase()
    if (!allowed.has(clean) || seen.has(clean)) continue
    seen.add(clean)
    channels.push(clean as CampaignChannel)
    if (channels.length >= LIMITS.channels) break
  }
  return channels
}

export function readStatus(value: unknown): CampaignStatus {
  return value === 'ready' || value === 'archived' ? value : 'draft'
}

export function dedupeList(values: string[], max: number): string[] {
  const seen = new Set<string>()
  const items: string[] = []
  for (const entry of values) {
    const clean = text(entry, LIMITS.listItemText)
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    items.push(clean)
    if (items.length >= max) break
  }
  return items
}

export const CAMPAIGN_LIMITS = LIMITS

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
  if (/^(unknown|n\/?a|none|not (found|stated|available|specified))$/i.test(clean)) return null
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean
}
