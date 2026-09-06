import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { en } from '@/i18n/messages/en'
import { ms } from '@/i18n/messages/ms'

/**
 * Campaign Workspace wiring (Phase 7E). Vitest runs with no DOM, so the page
 * checks are source-level — the streamingWiring/brandWiring approach. They
 * pin the properties that matter: generation goes through the existing
 * server pipeline with only the campaign id, the workbench reuses the
 * existing owner-scoped listener, and nothing fake is rendered.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const page = read('../../pages/CampaignDetailPage.tsx')

describe('create creative with EVA uses the existing flow', () => {
  it('calls the existing callable client with only the campaign id', () => {
    expect(page).toContain('generateCreativeMaterials({ campaignId: campaign.id })')
  })

  it('sends no brand, plan, or model configuration with the request', () => {
    // Brand Identity stays server-authoritative (Phase 7D): the workspace has
    // no way to push brand values, plans, or model choices into generation.
    expect(page).not.toMatch(
      /generateCreativeMaterials\(\{[^)]*(brand|color|font|logo|palette|plan|model)/i,
    )
  })

  it('does not add a second client-side idempotency or retry system', () => {
    // The server's in-flight operation lock is the idempotency mechanism; the
    // client only disables the buttons while a request is in flight.
    expect(page).toContain('if (!campaign || creating) return')
  })
})

describe('workbench reuses existing creative infrastructure', () => {
  it('lists creatives through the existing owner-scoped listener, no new query', () => {
    expect(page).toContain('observeCreatives(')
    expect(page).not.toContain('creativesCollection')
    expect(page).not.toContain('onSnapshot')
  })

  it('filters to this campaign in memory and derives progress from real state', () => {
    expect(page).toContain('campaignCreatives(allCreatives, campaign.id)')
    expect(page).toContain('campaignProgress(campaign,')
    expect(page).toContain('workspaceSuggestion(campaign,')
  })

  it('creative cards open the existing Creative route', () => {
    expect(page).toContain('to={ROUTES.creative}')
  })

  it('reuses the shared status vocabulary instead of inventing one', () => {
    expect(page).toContain("'library.statusGenerating'")
  })

  it('renders no invented metrics or publishing states', () => {
    expect(page).not.toMatch(/impressions|engagement|ROAS|conversion|published|scheduled/i)
  })
})

describe('editing reuses the existing campaign save path', () => {
  it('saves through updateCampaignContent and reloads the campaign', () => {
    expect(page).toContain('updateCampaignContent(campaign, patch)')
    expect(page).toContain('getCampaign(campaign.id)')
  })

  it('keeps the provenance rules on audience and offer edits', () => {
    expect(page).toContain("basis: 'hypothesis'")
    expect(page).toContain("basis: 'recommendation'")
  })

  it('keeps the existing status vocabulary — draft, ready, archived', () => {
    expect(page).toContain("'campaign.statusDraft'")
    expect(page).toContain("'campaign.statusReady'")
    expect(page).toContain("'campaign.statusArchived'")
  })
})

describe('workspace copy exists in both languages', () => {
  const keys = [
    'campaign.strategyTitle',
    'campaign.statusLabel',
    'campaign.editCampaign',
    'campaign.createWithEva',
    'campaign.createAnotherWithEva',
    'campaign.workbenchTitle',
    'campaign.workbenchEmptyTitle',
    'campaign.workbenchEmptyReady',
    'campaign.workbenchEmptyBody',
    'campaign.progressTitle',
    'campaign.progressStrategy',
    'campaign.progressReady',
    'campaign.progressCreative',
    'campaign.evaSuggestDraft',
    'campaign.evaSuggestFirst',
    'campaign.evaSuggestAnother',
    'campaign.evaCreateCta',
    'campaign.materialsInWorkbench',
  ] as const

  it.each(keys)('%s is translated in EN and BM', (key) => {
    expect(en[key], `en missing ${key}`).toBeTruthy()
    expect(ms[key], `ms missing ${key}`).toBeTruthy()
  })

  it('the two dictionaries carry the same key set', () => {
    expect(Object.keys(ms).sort()).toEqual(Object.keys(en).sort())
  })
})
