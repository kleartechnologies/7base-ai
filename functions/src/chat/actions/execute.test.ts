import { describe, expect, it, vi } from 'vitest'

import { HttpsError } from 'firebase-functions/v2/https'
import type { StoredCampaign } from '../../campaign/store'
import type { StoredBusiness } from '../../lib/business.types'
import type {
  ActionProgressStep,
  ActionProposalBlock,
  CreativeRequestSpec,
  CreativeSetBlock,
} from '../../lib/types'
import { buildStoredCreative, type StoredCreative } from '../../creative/store'
import type { CreativeGenerationParams, CreativeGenerationResult } from '../../creative/generate'
import type { CampaignBuildParams } from '../../campaign/build'
import type { AssetWithId } from '../../creative/assets'
import {
  buildSetContext,
  describeProposal,
  proposeFromOffer,
  runChatAction,
  type ActionContext,
  type ActionDeps,
} from './execute'

/**
 * Phase 7F — carrying the action out. Every dependency is a fake: the tests
 * pin *what* gets called with *which* campaign, format, set context and
 * Brand Identity, that a partial failure offers only the missing poster,
 * that a quota shortfall is said out loud before anything is made, and that
 * a campaign the caller does not own is refused. No model, no Firestore.
 */

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const campaign: StoredCampaign = {
  ownerId: 'user1',
  businessId: 'biz1',
  conversationId: 'conv1',
  sourceRecommendationId: 'rec1',
  name: 'Matheasy Launch',
  status: 'draft',
  objective: 'Get parents to try the app',
  targetAudience: { description: 'Parents of primary-school children', basis: 'hypothesis' },
  offer: { description: 'Free first month', basis: 'recommendation' },
  positioning: null,
  keyMessage: 'Maths made simple',
  callToAction: 'Download the app',
  channels: ['instagram', 'facebook'],
  durationDays: 14,
  startDate: null,
  endDate: null,
  notes: null,
  assumptions: [],
  unknowns: [],
  userEdited: [],
  meta: null,
  createdAt: 1000,
  updatedAt: 1000,
}

const business = {
  name: 'Matheasy',
  identity: { description: 'A maths learning app for primary-school children', category: 'edtech' },
  location: { city: 'Kuala Lumpur' },
  products: [{ name: 'Matheasy app' }],
  brand: { value: { primaryColour: '#22c55e' }, confirmed: true },
} as unknown as StoredBusiness

function makeCreative(overrides: Partial<StoredCreative> = {}): StoredCreative {
  return {
    ...buildStoredCreative({
      ownerId: 'user1',
      businessId: 'biz1',
      campaignId: 'camp1',
      conversationId: 'conv1',
      sourceRecommendationId: 'rec1',
      name: 'Matheasy Launch Poster',
      format: 'square_post',
      content: {
        headline: 'Maths made simple',
        subheadline: 'Learn step by step',
        body: null,
        callToAction: 'Download the app',
        offerText: 'Free first month',
        image: {
          storagePath: 'businesses/biz1/creatives/x.png',
          prompt: 'a poster',
          altText: 'A child solving sums',
          source: 'generated',
        },
        layout: 'image_full_bleed',
      },
      captions: { facebook: 'fb', instagram: 'ig', short: 'short', whatsapp: null },
      style: { palette: ['#22c55e'], headingFont: null, bodyFont: null, logoStoragePath: null },
      assetIds: [],
      imageError: null,
      meta: null,
      now: 1000,
    }),
    ...overrides,
  }
}

const photo: AssetWithId = {
  id: 'asset1',
  asset: {
    ownerId: 'user1',
    businessId: 'biz1',
    type: 'photo',
    name: 'App screenshot',
    fileName: 'shot.png',
    contentType: 'image/png',
    sizeBytes: 1000,
    storagePath: 'businesses/biz1/assets/shot.png',
    productId: null,
    description: null,
    tags: [],
    source: 'upload',
    status: 'active',
    allowAiUse: true,
    createdAt: 1,
    updatedAt: 1,
  },
}

const THREE: CreativeRequestSpec = {
  format: 'square_post',
  brief: '1. English — Introduction\n2. Bahasa Melayu — Step-by-step\n3. English — Numi AI Tutor',
  positions: [1, 2, 3],
  size: 3,
}

interface Harness {
  deps: ActionDeps
  calls: CreativeGenerationParams[]
  locks: string[]
  progress: ActionProgressStep[][]
  ctx: ActionContext
}

function harness(options: {
  generate?: (params: CreativeGenerationParams, index: number) => Promise<CreativeGenerationResult>
  remaining?: { aiGeneration: number; imageGeneration: number }
  assets?: AssetWithId[]
  campaigns?: { id: string; campaign: StoredCampaign }[]
  inThread?: { id: string; campaign: StoredCampaign } | null
  business?: StoredBusiness | null
  now?: () => number
} = {}): Harness {
  const calls: CreativeGenerationParams[] = []
  const locks: string[] = []
  const progress: ActionProgressStep[][] = []
  const campaigns = options.campaigns ?? [{ id: 'camp1', campaign }]
  const deps: ActionDeps = {
    loadCampaign: async (id) => campaigns.find((c) => c.id === id)?.campaign ?? null,
    findConversationCampaign: async () =>
      options.inThread === undefined ? (campaigns[0] ?? null) : options.inThread,
    listBusinessCampaigns: async () => campaigns,
    listEligibleAssets: async () => options.assets ?? [photo],
    peekRemaining: async () => options.remaining ?? { aiGeneration: 10, imageGeneration: 10 },
    withLock: async (lock, fn) => {
      locks.push(lock.key)
      return fn()
    },
    generateCreative: async (params) => {
      calls.push(params)
      const index = calls.length - 1
      if (options.generate) return options.generate(params, index)
      return {
        creativeId: `cr${index + 1}`,
        creative: makeCreative({ name: `Poster ${index + 1}` }),
        copyFellBack: false,
        meta: { model: 'gpt-test', task: 'creative.generate_copy', latencyMs: 5, usage: null },
      }
    },
    recommend: vi.fn(),
    saveRecommendation: vi.fn(),
    buildCampaign: vi.fn(),
  }
  const ctx: ActionContext = {
    uid: 'user1',
    plan: 'basic',
    conversationId: 'conv1',
    businessId: 'biz1',
    business: options.business === undefined ? business : options.business,
    language: 'en',
    text: 'okay go design',
    startedAt: 0,
    now: options.now ?? (() => 1000),
    onProgress: (steps) => progress.push(steps),
  }
  return { deps, calls, locks, progress, ctx }
}

const confirmThree = {
  type: 'confirm' as const,
  action: {
    kind: 'creative.generate' as const,
    campaignId: 'camp1',
    campaignName: 'Matheasy Launch',
    spec: THREE,
  },
}

function setBlock(blocks: { type: string }[]): CreativeSetBlock | undefined {
  return blocks.find((b): b is CreativeSetBlock => b.type === 'creative_set')
}
function proposalBlock(blocks: { type: string }[]): ActionProposalBlock | undefined {
  return blocks.find((b): b is ActionProposalBlock => b.type === 'action_proposal')
}

describe('runChatAction — the confirmed 3-poster set (the "okay go design" bug)', () => {
  it('creates all three through the existing pipeline, in order, under the campaign lock', async () => {
    const h = harness()
    const outcome = await runChatAction(confirmThree, h.ctx, h.deps)

    expect(h.calls).toHaveLength(3)
    expect(h.calls.map((c) => c.campaignId)).toEqual(['camp1', 'camp1', 'camp1'])
    expect(h.calls.map((c) => c.format)).toEqual(['square_post', 'square_post', 'square_post'])
    // Brand Identity and the Business Brain travel with every call.
    expect(h.calls.every((c) => c.business === business)).toBe(true)
    expect(h.calls.every((c) => c.plan === 'basic' && c.uid === 'user1')).toBe(true)
    // Each poster knows its place in the set and the plan the owner agreed to.
    expect(h.calls[0]?.setContext).toContain('number 1 of a set of 3')
    expect(h.calls[2]?.setContext).toContain('number 3 of a set of 3')
    expect(h.calls[1]?.setContext).toContain('Bahasa Melayu — Step-by-step')
    expect(h.locks).toEqual(['creative.generate_user1_camp1'])

    expect(outcome.plainText).toContain('Done — I created 3 posters for “Matheasy Launch”.')
    const set = setBlock(outcome.blocks)
    expect(set?.items.map((i) => i.creativeId)).toEqual(['cr1', 'cr2', 'cr3'])
    expect(set?.items.map((i) => i.position)).toEqual([1, 2, 3])
    expect(set?.requested).toBe(3)
    expect(proposalBlock(outcome.blocks)).toBeUndefined()
    expect(outcome.log).toMatchObject({ created: 3, failed: 0, creativeIds: ['cr1', 'cr2', 'cr3'] })
  })

  it('reports progress: assembly steps done, then each poster active → done', async () => {
    const h = harness()
    await runChatAction(confirmThree, h.ctx, h.deps)

    const first = h.progress[0] as ActionProgressStep[]
    expect(first.map((s) => `${s.key}:${s.state}`)).toEqual([
      'campaign:done',
      'brand:done',
      'assets:done',
      'concepts:done',
      'poster:pending',
      'poster:pending',
      'poster:pending',
    ])
    const activeSeen = h.progress.filter((steps) =>
      steps.some((s) => s.key === 'poster' && s.state === 'active'),
    )
    expect(activeSeen).toHaveLength(3)
    const last = h.progress.at(-1) as ActionProgressStep[]
    expect(last.filter((s) => s.key === 'poster').every((s) => s.state === 'done')).toBe(true)
    expect(last.find((s) => s.key === 'poster')?.total).toBe(3)
  })

  it('avoids reusing a photo already placed on an earlier poster of the set', async () => {
    const h = harness({
      generate: async (_params, index) => ({
        creativeId: `cr${index + 1}`,
        creative: makeCreative({ assetIds: [`asset${index + 1}`] }),
        copyFellBack: false,
        meta: null,
      }),
    })
    await runChatAction(confirmThree, h.ctx, h.deps)
    expect(h.calls.map((c) => [...c.avoidAssetIds])).toEqual([[], ['asset1'], ['asset1', 'asset2']])
  })
})

describe('runChatAction — partial failure', () => {
  it('keeps the two that worked and offers to retry only the third', async () => {
    const h = harness({
      generate: async (_params, index) => {
        if (index === 2) throw new HttpsError('internal', 'The poster image could not be created.')
        return {
          creativeId: `cr${index + 1}`,
          creative: makeCreative(),
          copyFellBack: false,
          meta: null,
        }
      },
    })
    const outcome = await runChatAction(confirmThree, h.ctx, h.deps)

    expect(outcome.plainText).toContain('I created 2 of the 3 posters. One couldn’t be completed.')
    expect(setBlock(outcome.blocks)?.items.map((i) => i.creativeId)).toEqual(['cr1', 'cr2'])
    const retry = proposalBlock(outcome.blocks)
    expect(retry?.action).toEqual({
      kind: 'creative.generate',
      campaignId: 'camp1',
      campaignName: 'Matheasy Launch',
      spec: { ...THREE, positions: [3] },
    })
    expect(retry?.confirmLabel).toBe('Try the third one again')
    expect(outcome.log).toMatchObject({ created: 2, failed: 1 })
  })

  it('a confirmed retry makes only the missing poster — no duplicates of the two that exist', async () => {
    const h = harness()
    const outcome = await runChatAction(
      {
        type: 'confirm',
        action: { ...confirmThree.action, spec: { ...THREE, positions: [3] } },
      },
      h.ctx,
      h.deps,
    )
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]?.setContext).toContain('number 3 of a set of 3')
    expect(outcome.plainText).toContain('Done — I created 1 poster for “Matheasy Launch”.')
    expect(setBlock(outcome.blocks)?.items.map((i) => i.position)).toEqual([3])
  })

  it('a daily-limit block mid-set stops the rest and repeats the guardrail sentence, without a retry offer', async () => {
    const limit = "You've reached today's AI request limit. Please try again tomorrow."
    const h = harness({
      generate: async (_params, index) => {
        if (index === 1) throw new HttpsError('resource-exhausted', limit)
        return { creativeId: `cr${index + 1}`, creative: makeCreative(), copyFellBack: false, meta: null }
      },
    })
    const outcome = await runChatAction(confirmThree, h.ctx, h.deps)
    expect(h.calls).toHaveLength(2)
    expect(outcome.plainText).toContain('I created 1 of the 3 posters.')
    expect(outcome.plainText).toContain(limit)
    expect(proposalBlock(outcome.blocks)).toBeUndefined()
  })

  it('an unexpected crash on one poster is contained: the others ship, that one is reported', async () => {
    const h = harness({
      generate: async (_params, index) => {
        if (index === 0) throw new TypeError('boom')
        return { creativeId: `cr${index + 1}`, creative: makeCreative(), copyFellBack: false, meta: null }
      },
    })
    const outcome = await runChatAction(confirmThree, h.ctx, h.deps)
    expect(h.calls).toHaveLength(3)
    expect(setBlock(outcome.blocks)?.items.map((i) => i.position)).toEqual([2, 3])
    expect(proposalBlock(outcome.blocks)?.action).toMatchObject({ spec: { positions: [1] } })
  })

  it('stops starting posters once the soft deadline has passed, and offers the rest', async () => {
    let clock = 0
    const h = harness({
      now: () => clock,
      generate: async (_params, index) => {
        clock += 200_000
        return { creativeId: `cr${index + 1}`, creative: makeCreative(), copyFellBack: false, meta: null }
      },
    })
    const outcome = await runChatAction(confirmThree, h.ctx, h.deps)
    expect(h.calls).toHaveLength(2)
    expect(proposalBlock(outcome.blocks)?.action).toMatchObject({ spec: { positions: [3] } })
  })
})

describe('runChatAction — quota honesty, before anything is made', () => {
  it('offers the maximum safe number when the daily budget cannot cover the request', async () => {
    const h = harness({ remaining: { aiGeneration: 2, imageGeneration: 10 } })
    const outcome = await runChatAction(confirmThree, h.ctx, h.deps)
    expect(h.calls).toHaveLength(0)
    expect(outcome.plainText).toBe(
      'I can create 2 of the 3 today — you’ve reached today’s limit for the rest. Want me to go ahead with 2?',
    )
    expect(proposalBlock(outcome.blocks)?.action).toMatchObject({ spec: { positions: [1, 2], size: 3 } })
    expect(proposalBlock(outcome.blocks)?.confirmLabel).toBe('Yes, create the 2 posters')
  })

  it('counts image budget only when no photo asset could carry the poster', async () => {
    const withPhoto = harness({ remaining: { aiGeneration: 10, imageGeneration: 0 } })
    await runChatAction(confirmThree, withPhoto.ctx, withPhoto.deps)
    expect(withPhoto.calls).toHaveLength(3)

    const noPhoto = harness({ remaining: { aiGeneration: 10, imageGeneration: 0 }, assets: [] })
    const outcome = await runChatAction(confirmThree, noPhoto.ctx, noPhoto.deps)
    expect(noPhoto.calls).toHaveLength(0)
    expect(outcome.plainText).toBe(
      "You've reached today's image-generation limit. Please try again tomorrow.",
    )
  })

  it('says so plainly when nothing can be made today', async () => {
    const h = harness({ remaining: { aiGeneration: 0, imageGeneration: 0 } })
    const outcome = await runChatAction(confirmThree, h.ctx, h.deps)
    expect(h.calls).toHaveLength(0)
    expect(outcome.plainText).toBe("You've reached today's AI request limit. Please try again tomorrow.")
    expect(proposalBlock(outcome.blocks)).toBeUndefined()
  })
})

describe('runChatAction — ownership and scope', () => {
  it("refuses a campaign that is not the caller's, without touching the pipeline", async () => {
    const h = harness({ campaigns: [{ id: 'camp1', campaign: { ...campaign, ownerId: 'someone-else' } }] })
    const outcome = await runChatAction(confirmThree, h.ctx, h.deps)
    expect(h.calls).toHaveLength(0)
    expect(h.locks).toEqual([])
    expect(outcome.plainText).toBe(
      'That campaign isn’t available any more. Tell me which campaign you mean, or I can create a new one.',
    )
    expect(outcome.log).toMatchObject({ blocked: 'campaign_unavailable' })
  })

  it('refuses a campaign that belongs to another business, and a missing one', async () => {
    const other = harness({ campaigns: [{ id: 'camp1', campaign: { ...campaign, businessId: 'biz2' } }] })
    expect((await runChatAction(confirmThree, other.ctx, other.deps)).log).toMatchObject({
      blocked: 'campaign_other_business',
    })
    const missing = harness({ campaigns: [] })
    expect((await runChatAction(confirmThree, missing.ctx, missing.deps)).log).toMatchObject({
      blocked: 'campaign_unavailable',
    })
  })

  it('never makes more than the per-request cap even if a proposal carries more positions', async () => {
    const h = harness()
    await runChatAction(
      { type: 'confirm', action: { ...confirmThree.action, spec: { ...THREE, positions: [1, 2, 3, 4, 5], size: 5 } } },
      h.ctx,
      h.deps,
    )
    expect(h.calls).toHaveLength(3)
  })
})

describe('runChatAction — explicit requests resolve the campaign server-side', () => {
  const request = { type: 'creative_request' as const, spec: { ...THREE, brief: 'make 3 posters' } }

  it("uses this thread's campaign when it has one", async () => {
    const h = harness()
    const outcome = await runChatAction(request, h.ctx, h.deps)
    expect(h.calls).toHaveLength(3)
    expect(outcome.log).toMatchObject({ campaignId: 'camp1', fromProposal: false })
  })

  it('asks which campaign when several could be meant, and acts on the pick', async () => {
    const second = { ...campaign, name: 'Raya Promo' }
    const h = harness({
      inThread: null,
      campaigns: [
        { id: 'camp1', campaign },
        { id: 'camp2', campaign: second },
      ],
    })
    const outcome = await runChatAction(request, h.ctx, h.deps)
    expect(h.calls).toHaveLength(0)
    expect(outcome.plainText).toBe('Which campaign should these posters be for? Matheasy Launch / Raya Promo')
    expect(proposalBlock(outcome.blocks)?.action).toEqual({
      kind: 'campaign.choose',
      choices: [
        { campaignId: 'camp1', name: 'Matheasy Launch' },
        { campaignId: 'camp2', name: 'Raya Promo' },
      ],
      then: request.spec,
    })

    const picked = await runChatAction(
      {
        type: 'choose',
        action: { kind: 'creative.generate', campaignId: 'camp2', campaignName: 'Raya Promo', spec: request.spec },
      },
      h.ctx,
      h.deps,
    )
    expect(h.calls.map((c) => c.campaignId)).toEqual(['camp2', 'camp2', 'camp2'])
    expect(picked.plainText).toContain('for “Raya Promo”')
  })

  it('picks the campaign the message names when several exist', async () => {
    const h = harness({
      inThread: null,
      campaigns: [
        { id: 'camp1', campaign },
        { id: 'camp2', campaign: { ...campaign, name: 'Raya Promo' } },
      ],
    })
    h.ctx.text = 'make 3 posters for the Raya Promo'
    await runChatAction(request, h.ctx, h.deps)
    expect(h.calls.map((c) => c.campaignId)).toEqual(['camp2', 'camp2', 'camp2'])
  })

  it('offers to create a campaign first when there is none, in the exact empty-state words', async () => {
    const h = harness({ inThread: null, campaigns: [] })
    h.ctx.text = 'make 3 posters for my app launch'
    const outcome = await runChatAction(request, h.ctx, h.deps)
    expect(h.calls).toHaveLength(0)
    expect(outcome.plainText).toBe(
      'You don’t have a campaign for this yet. I can create one for you, then make the 3 posters. Want me to go ahead?',
    )
    expect(proposalBlock(outcome.blocks)?.action).toEqual({
      kind: 'campaign.create',
      goal: 'make 3 posters for my app launch',
      then: request.spec,
    })
  })

  it('says a Business Brain is needed when there is no campaign and nothing to build one from', async () => {
    const h = harness({ inThread: null, campaigns: [], business: null })
    const outcome = await runChatAction(request, h.ctx, h.deps)
    expect(proposalBlock(outcome.blocks)).toBeUndefined()
    expect(outcome.log).toMatchObject({ blocked: 'missing_brain' })
  })
})

describe('runChatAction — creating the campaign, then the posters', () => {
  it('runs recommendation → build under the build lock → posters, and shows the campaign card', async () => {
    const h = harness({ inThread: null, campaigns: [] })
    const built = { ...campaign, name: 'App Launch Push' }
    const recommend = h.deps.recommend as ReturnType<typeof vi.fn>
    recommend.mockResolvedValue({
      draft: {
        ownerSummary: 's',
        goal: 'launch',
        diagnosis: { statement: 'x', basis: 'hypothesis' },
        opportunities: [],
        recommendedIndex: 0,
        rationale: [],
        targetAudience: null,
        offer: null,
        positioning: null,
        coreMessage: null,
        callToAction: null,
        channels: [],
        durationDays: null,
        confidence: 'low',
        confidenceReason: null,
        assumptions: [],
        unknowns: [],
        nextAction: 'build_campaign',
      },
      meta: { model: 'gpt-test', task: 'campaign.diagnose', latencyMs: 1, usage: null },
      richness: 'grounded',
    })
    ;(h.deps.saveRecommendation as ReturnType<typeof vi.fn>).mockResolvedValue('rec9')
    const buildCampaign = h.deps.buildCampaign as ReturnType<typeof vi.fn>
    buildCampaign.mockImplementation(async (params: CampaignBuildParams) => {
      // The posters must target the campaign just built: register it.
      h.deps.loadCampaign = async (id) => (id === 'camp9' ? built : null)
      expect(params.recommendationId).toBe('rec9')
      return { campaignId: 'camp9', campaign: built, meta: null, reused: false }
    })

    const outcome = await runChatAction(
      { type: 'confirm', action: { kind: 'campaign.create', goal: 'launch my app', then: THREE } },
      h.ctx,
      h.deps,
    )

    expect(recommend).toHaveBeenCalledWith(
      expect.objectContaining({ goal: 'launch my app', uid: 'user1', plan: 'basic' }),
    )
    expect(h.locks).toEqual(['campaign.build_user1_rec9', 'creative.generate_user1_camp9'])
    expect(h.calls.map((c) => c.campaignId)).toEqual(['camp9', 'camp9', 'camp9'])
    expect(outcome.plainText).toContain('I created a campaign for this: “App Launch Push”.')
    expect(outcome.plainText).toContain('Done — I created 3 posters')
    expect(outcome.blocks.map((b) => b.type)).toEqual(['text', 'campaign_card', 'creative_set'])
    expect(h.progress[0]?.[0]).toEqual({ key: 'campaign_create', state: 'active' })
    expect(h.progress.at(-1)?.[0]).toEqual({ key: 'campaign_create', state: 'done' })
  })

  it('reports a failed build in plain words and makes no posters', async () => {
    const h = harness({ inThread: null, campaigns: [] })
    ;(h.deps.recommend as ReturnType<typeof vi.fn>).mockRejectedValue(
      new HttpsError('resource-exhausted', "You've reached today's AI request limit. Please try again tomorrow."),
    )
    const outcome = await runChatAction(
      { type: 'confirm', action: { kind: 'campaign.create', goal: 'launch my app', then: THREE } },
      h.ctx,
      h.deps,
    )
    expect(h.calls).toHaveLength(0)
    expect(outcome.plainText).toContain("You've reached today's AI request limit.")
    expect(outcome.log).toMatchObject({ failed: 'blocked' })
    expect(h.progress.at(-1)?.[0]).toEqual({ key: 'campaign_create', state: 'failed' })
  })
})

describe('proposeFromOffer — EVA’s prose offer becomes a real proposal', () => {
  const offer = { count: 3, format: 'square_post' as const, brief: '1. A\n2. B\n3. C' }
  const ctx = { uid: 'user1', conversationId: 'conv1', businessId: 'biz1', business, language: 'en' as const, text: 'design them' }

  it('targets the thread campaign, with the agreed plan as the brief', async () => {
    const h = harness()
    const block = await proposeFromOffer(offer, ctx, h.deps)
    expect(block).toEqual({
      id: 'b1',
      type: 'action_proposal',
      confirmLabel: 'Yes, create the 3 posters',
      action: {
        kind: 'creative.generate',
        campaignId: 'camp1',
        campaignName: 'Matheasy Launch',
        spec: { format: 'square_post', brief: '1. A\n2. B\n3. C', positions: [1, 2, 3], size: 3 },
      },
    })
  })

  it('offers a choice among several, a campaign when none, nothing without a Brain', async () => {
    const many = harness({
      inThread: null,
      campaigns: [
        { id: 'camp1', campaign },
        { id: 'camp2', campaign: { ...campaign, name: 'Raya Promo' } },
      ],
    })
    expect((await proposeFromOffer(offer, ctx, many.deps))?.action.kind).toBe('campaign.choose')

    const none = harness({ inThread: null, campaigns: [] })
    expect((await proposeFromOffer(offer, ctx, none.deps))?.action).toEqual({
      kind: 'campaign.create',
      goal: 'design them',
      then: { format: 'square_post', brief: '1. A\n2. B\n3. C', positions: [1, 2, 3], size: 3 },
    })

    expect(await proposeFromOffer(offer, { ...ctx, business: null }, none.deps)).toBeNull()
  })
})

describe('buildSetContext / describeProposal', () => {
  it('gives each poster its position and the plan, and single posters only the brief', () => {
    expect(buildSetContext(2, THREE)).toContain('number 2 of a set of 3')
    expect(buildSetContext(2, THREE)).toContain('concept 2 of the list')
    expect(buildSetContext(1, { format: 'square_post', brief: null, positions: [1], size: 1 })).toBeNull()
    expect(buildSetContext(1, { format: 'square_post', brief: 'raya poster', positions: [1], size: 1 })).toContain('raya poster')
  })

  it('describes a pending proposal without ids, models or costs', () => {
    expect(describeProposal(confirmThree.action)).toBe(
      'to create 3 poster(s) for the campaign "Matheasy Launch"',
    )
    expect(describeProposal({ kind: 'campaign.create', goal: 'g', then: null })).toBe('to create a campaign')
    expect(describeProposal({ kind: 'campaign.create', goal: 'g', then: THREE })).toBe(
      'to create a campaign and then 3 poster(s) for it',
    )
  })
})
