/**
 * The Firebase-backed leaves, replaced for the UI harness.
 *
 * The harness renders the real chat components against fixture data in a
 * real browser; these stubs stand in for the four service modules that would
 * otherwise open a network connection at import time. Nothing here
 * reimplements a component or a layout decision — they only hand back the
 * data a live app would have delivered.
 */
import type { Creative } from '@/types'

/** Set by the entry before rendering, so poster tiles resolve their creative. */
export const CREATIVES = new Map<string, Creative>()

/** Synthetic photography, injected by the harness page. */
export const IMAGES: Record<string, string> = {}

export function observeCreative(
  creativeId: string,
  onData: (creative: Creative | null) => void,
): () => void {
  onData(CREATIVES.get(creativeId) ?? null)
  return () => {}
}

export function observeCreatives(_ownerId: string, onData: (creatives: Creative[]) => void) {
  onData([...CREATIVES.values()])
  return () => {}
}

export async function updateCreativeCaption() {}
export async function getCreative(creativeId: string) {
  return CREATIVES.get(creativeId) ?? null
}

export function observeCampaigns(_ownerId: string, onData: (campaigns: unknown[]) => void) {
  onData([])
  return () => {}
}

export async function getAssetUrl(storagePath: string) {
  return IMAGES[storagePath] ?? ''
}

export function buildCampaignFromRecommendation() {
  return Promise.resolve({ ok: true as const, value: { campaignId: 'camp1' } })
}
export function generateCreativeMaterials() {
  return Promise.resolve({ ok: true as const, value: {} })
}
export function downloadCreativeImage() {
  return Promise.resolve({ ok: true as const, value: {} })
}
export function retryCreativeImage() {
  return Promise.resolve({ ok: true as const, value: {} })
}

export async function saveAttachmentToAssets() {
  return { ok: true as const, value: {} }
}

export function observeAssets(_ownerId: string, onData: (assets: unknown[]) => void) {
  onData([])
  return () => {}
}
