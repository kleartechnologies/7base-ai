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

/** Source with its comments removed — for rules about what the UI *offers*. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const page = read('../../pages/CampaignDetailPage.tsx')
const library = read('../../pages/CreativePage.tsx')
const card = read('../creative/CreativeCard.tsx')

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
    expect(page).toContain('campaignNextAction(campaign, creatives)')
  })

  it('shows creatives through the one shared card, not a second version', () => {
    expect(page).toContain("import { CreativeCard } from '@/features/creative/CreativeCard'")
    expect(page).toContain('<CreativeCard')
    // The compact campaign-only card is gone; there is one creative card.
    expect(page).not.toContain('WorkbenchCreativeCard')
    expect(page).not.toContain('PosterCanvas')
  })

  it('hands the creative down instead of opening a listener per card', () => {
    expect(card).toContain('creative: Creative')
    expect(card).not.toContain('useCreative')
    expect(card).not.toContain('observeCreative')
  })

  it('the library renders the same card, so the two pages cannot disagree', () => {
    expect(library).toContain("import { CreativeCard } from '@/features/creative/CreativeCard'")
    expect(library).not.toContain('function CreativeCard(')
  })

  it('reuses the shared status vocabulary instead of inventing one', () => {
    expect(card).toContain("'library.statusGenerating'")
  })

  it('counts what exists — never a target, a percentage or a progress bar', () => {
    expect(page).toContain("t('campaign.creativeCountOne')")
    expect(page).toContain("t('campaign.creativeCountMany', { count: creatives.length })")
    // The count is a plain number of things that exist: no denominator, no
    // share of a target, no "3 of 10".
    for (const value of [
      en['campaign.creativeCountOne'],
      en['campaign.creativeCountMany'],
      ms['campaign.creativeCountOne'],
      ms['campaign.creativeCountMany'],
    ]) {
      expect(value).not.toMatch(/[/%]|\bof\b|\bdaripada\b/i)
    }
  })

  it('renders no invented metrics or publishing states', () => {
    expect(page).not.toMatch(/impressions|engagement|ROAS|conversion|published|scheduled/i)
  })

  it('offers only actions that work end to end today', () => {
    // No Publish, Schedule, Boost, Duplicate or Run ads anywhere on the card.
    expect(code(card)).not.toMatch(/publish|schedule|boost|duplicate|run ads|analyz/i)
    expect(card).toContain('DownloadPosterButton')
    expect(card).toContain("t('creative.editInChat')")
  })
})

describe('one next action, derived from state', () => {
  it('the header leads with it and EVA repeats it — never a second opinion', () => {
    expect(page).toContain('{nextActionButton()}')
    expect(page).toContain("nextAction.kind === 'edit_campaign'")
    expect(page).toContain("nextAction.kind === 'review_copy'")
  })

  it('"Review copy" lands on the creative that is missing it', () => {
    expect(page).toContain('function reviewCopy(creativeId: string)')
    expect(page).toContain('setOpenCopyFor(creativeId)')
    expect(page).toContain('anchorId={anchorFor(creative.id)}')
    expect(page).toContain('copyOpen={openCopyFor === creative.id}')
  })

  it('honours reduced motion when it scrolls', () => {
    expect(page).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches")
  })

  it('each poster keeps its own copy — nothing is pooled per campaign', () => {
    expect(card).toContain('<PlatformCopy creative={creative}')
    expect(page).not.toContain('<PlatformCopy')
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
    'campaign.creativeCountOne',
    'campaign.creativeCountMany',
    'campaign.reviewCopy',
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
    'campaign.evaSuggestReviewCopy',
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
