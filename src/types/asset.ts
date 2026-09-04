import type { EntityId, OwnedEntity } from './common'

/**
 * An asset is a file the owner has given EVA — a dish photo, a menu PDF, a
 * logo — plus the metadata that makes it usable later: what it shows, which
 * product it belongs to, and whether EVA may use it in marketing.
 *
 * The document lives in the top-level `assets` collection; the file itself
 * lives in Storage under `businesses/{businessId}/assets/`. That separation
 * is deliberate: documents are queried per owner like every other collection,
 * while Storage stays authorised by business path prefix.
 */

/** What the file depicts, chosen by the owner. A label, not an AI judgement. */
export const ASSET_TYPES = [
  'product',
  'menu',
  'logo',
  'brand',
  'photo',
  'document',
  'promotional',
  'other',
] as const

export type AssetType = (typeof ASSET_TYPES)[number]

/**
 * How the file arrived. Only direct upload exists today; chat attachments and
 * website imports must be new members here, not a schema change.
 */
export type AssetSource = 'upload'

/** Archiving is the normal way to remove an asset; deletion is permanent. */
export type AssetStatus = 'active' | 'archived'

export interface Asset extends OwnedEntity {
  businessId: EntityId
  type: AssetType
  /** Display name, editable — defaults from the file name at upload. */
  name: string
  /** The original file name, kept for provenance. Frozen after creation. */
  fileName: string
  /** MIME type as uploaded. Frozen after creation. */
  contentType: string
  /** Size as uploaded. Frozen after creation. */
  sizeBytes: number
  /** Where the file lives in Storage. Frozen after creation. */
  storagePath: string
  /** The business product this file shows, when it shows one. */
  productId: EntityId | null
  description: string | null
  tags: string[]
  source: AssetSource
  status: AssetStatus
  /** Permission metadata only — nothing reads it yet, and no AI is called. */
  allowAiUse: boolean
}
