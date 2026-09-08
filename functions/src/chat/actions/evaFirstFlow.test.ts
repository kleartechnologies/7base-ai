import { describe, expect, it, vi } from 'vitest'

import type { StoredCampaign } from '../../campaign/store'
import type { CampaignBuildResult } from '../../campaign/build'
import { buildStoredCreative, type StoredCreative } from '../../creative/store'
import type { AssetWithId } from '../../creative/assets'
import type { StoredBusiness } from '../../lib/business.types'
import type {
  ActionProgressStep,
  ActionProposalBlock,
  CampaignCardBlock,
  CreativeSetBlock,
  MessageBlock,
  StoredMessage,
} from '../../lib/types'
import type { StoredRecommendation } from '../../marketing/store'
import type { MarketingRecommendationDraft } from '../../marketing/validate'
import { detectIntent } from '../../marketing/intent'
import { decideChatAction } from './decide'
import {
  proposeFromRecommendation,
  runChatAction,
  type ActionContext,
  type ActionDeps,
  type OfferContext,
} from './execute'

/**
 * Phase 7J — "I want to promote our weekday lunch."
 *
 * The whole point of this phase is that those eight words are enough. This
 * file walks the path they take: recognised as a goal, answered with one
 * offer, agreed to in plain words, and carried out by the pipelines that
 * already existed — one campaign, three posters, no questions in between.
 *
 * Every dependency is a fake, so what is pinned here is the *choreography*:
 * which pipeline runs, under which lock, how many times, and what EVA says.
 * No model, no Firestore.
 */

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const GOAL = 'I want to promote our weekday lunch.'

const draft: MarketingRecommendationDraft = {
  ownerSummary: 'Weekday lunch looks like your best opening.',
  goal: 'More weekday lunch customers',
  diagnosis: { statement: 'Weekday demand appears low.', basis: 'hypothesis' },
  opportunities: [
    {
      title: 'Weekday lunch traffic',
      description: 'Promote the lunch sets to nearby offices.',
      evidence: [],
      assumptions: [],
      potentialImpact: 'high_potential',
      effort: 'medium',
      suitability: null,
    },
  ],
  recommendedIndex: 0,
  rationale: [],
  targetAudience: null,
  offer: null,
  positioning: null,
  coreMessage: null,
  callToAction: null,
  channels: [],
  durationDays: null,
  confidence: 'medium',
  confidenceReason: null,
  assumptions: [],
  unknowns: [],
  nextAction: 'build_campaign',
}

const recommendation: StoredRecommendation = {
  ...draft,
  ownerId: 'user1',
  businessId: 'biz1',
  conversationId: 'conv1',
  status: 'proposed',
  meta: null,
  createdAt: 1000,
  updatedAt: 1000,
}

const builtCampaign: StoredCampaign = {
  ownerId: 'user1',
  businessId: 'biz1',
  conversationId: 'conv1',
  sourceRecommendationId: 'rec1',
  name: 'Weekday Lunch',
  status: 'draft',
  objective: 'More weekday lunch customers',
  targetAudience: { description: 'Office workers nearby', basis: 'hypothesis' },
  offer: { description: 'Lunch set', basis: 'recommendation' },
  positioning: null,
  keyMessage: 'Lunch, sorted',
  callToAction: 'Come by from 12',
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

const branded = {
  name: 'Warung Pak Din',
  identity: { description: 'Home-style Malay food', category: 'restaurant' },
  location: { city: 'Kuala Lumpur' },
  products: [{ name: 'Lunch set' }],
  brandKit: {
    logoAssetId: null,
    colors: { primary: '#c2410c', secondary: null, accent: null },
    typography: { heading: null, body: null },
    styleTraits: [],
    styleNotes: null,
    notes: null,
    updatedAt: 1000,
  },
} as unknown as StoredBusiness

/** The same shop before anyone has set up a Brand Identity. */
const unbranded = {
  name: 'Warung Pak Din',
  identity: { description: 'Home-style Malay food', category: 'restaurant' },
  location: { city: 'Kuala Lumpur' },
  products: [{ name: 'Lunch set' }],
} as unknown as StoredBusiness

const photo: AssetWithId = {
  id: 'asset1',
  asset: {
    ownerId: 'user1',
    businessId: 'biz1',
    type: 'photo',
    name: 'Lunch set on the table',
    fileName: 'lunch.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 2000,
    storagePath: 'businesses/biz1/assets/lunch.jpg',
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

function makeCreative(): StoredCreative {
  return buildStoredCreative({
    ownerId: 'user1',
    businessId: 'biz1',
    campaignId: 'camp1',
    conversationId: 'conv1',
    sourceRecommendationId: 'rec1',
    name: 'Weekday Lunch Poster',
    format: 'square_post',
    content: {
      headline: 'Lunch, sorted',
      subheadline: 'Every weekday from 12',
      body: null,
      callToAction: 'Come by from 12',
      offerText: 'Lunch set',
      image: {
        storagePath: 'businesses/biz1/creatives/x.png',
        prompt: 'a poster',
        altText: 'A lunch set on a table',
        source: 'upload',
      },
      layout: 'image_full_bleed',
    },
    captions: { facebook: 'fb', instagram: 'ig', short: 'short', whatsapp: null },
    style: { palette: ['#c2410c'], headingFont: null, bodyFont: null, logoStoragePath: null },
    assetIds: ['asset1'],
    imageError: null,
    meta: null,
    now: 1000,
  })
}

interface Harness {
  deps: ActionDeps
  ctx: ActionContext
  offerCtx: OfferContext
  builds: string[]
  generated: string[]
  locks: string[]
  progress: ActionProgressStep[][]
}

function harness(
  options: {
    /** A campaign already open in this thread, if any. */
    inThread?: { id: string; campaign: StoredCampaign } | null
    recommendation?: StoredRecommendation | null
    business?: StoredBusiness
    generate?: (index: number) => Promise<never> | null
  } = {},
): Harness {
  const builds: string[] = []
  const generated: string[] = []
  const locks: string[] = []
  const progress: ActionProgressStep[][] = []
  const inThread = options.inThread ?? null
  const business = options.business ?? branded

  const deps: ActionDeps = {
    loadCampaign: async (id) => (id === 'camp1' ? builtCampaign : null),
    loadRecommendation: async (id) =>
      id === 'rec1' ? (options.recommendation === undefined ? recommendation : options.recommendation) : null,
    findConversationCampaign: async () => inThread,
    listBusinessCampaigns: async () => (inThread ? [inThread] : []),
    listEligibleAssets: async () => [photo],
    peekRemaining: async () => ({ aiGeneration: 20, imageGeneration: 20 }),
    withLock: async (lock, fn) => {
      locks.push(lock.key)
      return fn()
    },
    generateCreative: async (params) => {
      const index = generated.length
      const failure = options.generate?.(index)
      if (failure) await failure
      generated.push(params.campaignId)
      return {
        creativeId: `cr${index + 1}`,
        creative: makeCreative(),
        copyFellBack: false,
        meta: null,
        imageBrief: null,
      }
    },
    recommend: vi.fn(),
    saveRecommendation: vi.fn(),
    buildCampaign: async (params): Promise<CampaignBuildResult> => {
      builds.push(params.recommendationId)
      return { campaignId: 'camp1', campaign: builtCampaign, meta: null, reused: false }
    },
  }

  const ctx: ActionContext = {
    uid: 'user1',
    plan: 'basic',
    conversationId: 'conv1',
    businessId: 'biz1',
    business,
    language: 'en',
    text: 'Yes, do it.',
    startedAt: 0,
    now: () => 1000,
    onProgress: (steps) => progress.push(steps),
  }

  const offerCtx: OfferContext = {
    uid: 'user1',
    conversationId: 'conv1',
    businessId: 'biz1',
    business,
    language: 'en',
    text: GOAL,
  }

  return { deps, ctx, offerCtx, builds, generated, locks, progress }
}

/** EVA's turn as it is stored: her recommendation, then what she offered. */
function assistantTurn(proposal: ActionProposalBlock): Pick<StoredMessage, 'role' | 'blocks'> {
  return {
    role: 'assistant',
    blocks: [
      { id: 'b0', type: 'text', text: 'Weekday lunch looks like your best opening.' },
      proposal,
    ],
  }
}

const setBlock = (blocks: MessageBlock[]) =>
  blocks.find((b): b is CreativeSetBlock => b.type === 'creative_set')
const cardBlock = (blocks: MessageBlock[]) =>
  blocks.find((b): b is CampaignCardBlock => b.type === 'campaign_card')
const proposalBlock = (blocks: MessageBlock[]) =>
  blocks.find((b): b is ActionProposalBlock => b.type === 'action_proposal')

describe('“I want to promote our weekday lunch.” — the whole path', () => {
  it('is heard as a goal, not small talk', () => {
    expect(detectIntent(GOAL)).toBe('marketing_goal')
  })

  it('is answered with exactly one offer, and no questions', async () => {
    const h = harness()
    const offer = await proposeFromRecommendation(
      { recommendationId: 'rec1', title: 'Weekday lunch traffic', nextAction: 'build_campaign', brief: GOAL },
      h.offerCtx,
      h.deps,
    )
    if (!offer) throw new Error('expected a proposal')
    const proposal = offer.proposal

    // One thing to say yes to, in words about posters — not about the
    // machinery that makes them.
    expect(proposal.action.kind).toBe('campaign.build')
    expect(proposal.confirmLabel).toBe('Create the campaign')
    expect(proposal.summary).toContain('3 posters')

    // And she says it in words first, in plain language: no product nouns
    // the owner would have to learn, no machinery.
    const lead = offer.lead.type === 'text' ? offer.lead.text : ''
    expect(lead).toBe('I can turn this into a campaign and make 3 posters for it.')
    expect(lead).not.toMatch(/execute|workflow|generate|action|recommendation id/i)
  })

  it('“Yes, do it.” executes that offer unchanged — nothing is re-parsed', async () => {
    const h = harness()
    const offer = await proposeFromRecommendation(
      { recommendationId: 'rec1', title: 'Weekday lunch traffic', nextAction: 'build_campaign', brief: GOAL },
      h.offerCtx,
      h.deps,
    )
    if (!offer) throw new Error('expected a proposal')
    const proposal = offer.proposal

    const decision = decideChatAction({ text: 'Yes, do it.', previousAssistant: assistantTurn(proposal) })
    expect(decision).toEqual({ type: 'confirm', action: proposal.action })
  })

  it('builds one campaign, then three posters, through the existing pipelines', async () => {
    const h = harness()
    const offer = await proposeFromRecommendation(
      { recommendationId: 'rec1', title: 'Weekday lunch traffic', nextAction: 'build_campaign', brief: GOAL },
      h.offerCtx,
      h.deps,
    )
    if (!offer) throw new Error('expected a proposal')
    const proposal = offer.proposal
    const decision = decideChatAction({ text: 'Yes, do it.', previousAssistant: assistantTurn(proposal) })
    if (decision.type !== 'confirm') throw new Error('expected a confirmation')

    const outcome = await runChatAction(decision, h.ctx, h.deps)

    // One campaign — built once, from the recommendation EVA already made.
    expect(h.builds).toEqual(['rec1'])
    // Three posters, all on that campaign.
    expect(h.generated).toEqual(['camp1', 'camp1', 'camp1'])
    // Both pipelines under their own existing locks.
    expect(h.locks).toEqual(['campaign.build_user1_rec1', 'creative.generate_user1_camp1'])

    // What the owner sees: the campaign and the posters, not the plumbing.
    expect(cardBlock(outcome.blocks)?.name).toBe('Weekday Lunch')
    expect(setBlock(outcome.blocks)?.items).toHaveLength(3)
    expect(outcome.plainText).toContain('Done')
    // Nothing left to confirm — the work is finished, not proposed again.
    expect(proposalBlock(outcome.blocks)).toBeUndefined()
  })

  it('offers exactly one thing to do next', async () => {
    const h = harness()
    const outcome = await runChatAction(
      {
        type: 'confirm',
        action: {
          kind: 'campaign.build',
          recommendationId: 'rec1',
          title: 'Weekday lunch traffic',
          then: { format: 'square_post', brief: GOAL, positions: [1, 2, 3], size: 3 },
        },
      },
      h.ctx,
      h.deps,
    )
    const followUp = setBlock(outcome.blocks)?.followUp
    expect(followUp?.label).toBe('Another angle')
    expect(followUp?.text).toContain('different angle')
  })

  it('never claims a capability this product does not have', async () => {
    const h = harness()
    const outcome = await runChatAction(
      {
        type: 'confirm',
        action: {
          kind: 'campaign.build',
          recommendationId: 'rec1',
          title: 'Weekday lunch traffic',
          then: { format: 'square_post', brief: GOAL, positions: [1, 2, 3], size: 3 },
        },
      },
      h.ctx,
      h.deps,
    )
    const said = outcome.plainText.toLowerCase()
    for (const word of ['publish', 'posted for you', 'schedule', 'ad spend', 'boost', 'budget']) {
      expect(said).not.toContain(word)
    }
    // Nor any of the words the machinery uses about itself.
    for (const word of ['workflow', 'execute', 'pipeline', 'classifier', 'token', 'model']) {
      expect(said).not.toContain(word)
    }
  })
})

describe('a campaign that already exists is used, never duplicated', () => {
  it('proposes posters on the open campaign instead of building a second one', async () => {
    const h = harness({ inThread: { id: 'camp1', campaign: builtCampaign } })
    const offer = await proposeFromRecommendation(
      { recommendationId: 'rec1', title: 'Weekday lunch traffic', nextAction: 'build_campaign', brief: GOAL },
      h.offerCtx,
      h.deps,
    )
    if (!offer) throw new Error('expected a proposal')
    const proposal = offer.proposal

    expect(proposal.action.kind).toBe('creative.generate')
    if (proposal.action.kind !== 'creative.generate') throw new Error('unreachable')
    expect(proposal.action.campaignId).toBe('camp1')
    expect(proposal.action.campaignName).toBe('Weekday Lunch')
  })

  it('and saying yes to it builds nothing — it only makes the posters', async () => {
    const h = harness({ inThread: { id: 'camp1', campaign: builtCampaign } })
    const offer = await proposeFromRecommendation(
      { recommendationId: 'rec1', title: 'Weekday lunch traffic', nextAction: 'build_campaign', brief: GOAL },
      h.offerCtx,
      h.deps,
    )
    if (!offer) throw new Error('expected a proposal')
    const proposal = offer.proposal
    const decision = decideChatAction({ text: 'Yes, do it.', previousAssistant: assistantTurn(proposal) })
    if (decision.type !== 'confirm') throw new Error('expected a confirmation')

    await runChatAction(decision, h.ctx, h.deps)
    expect(h.builds).toEqual([])
    expect(h.generated).toEqual(['camp1', 'camp1', 'camp1'])
  })
})

describe('the recommendation behind the offer is re-checked, not trusted', () => {
  const confirm = {
    type: 'confirm' as const,
    action: {
      kind: 'campaign.build' as const,
      recommendationId: 'rec1',
      title: 'Weekday lunch traffic',
      then: null,
    },
  }

  it('refuses one that belongs to another owner, and builds nothing', async () => {
    const h = harness({ recommendation: { ...recommendation, ownerId: 'someone-else' } })
    const outcome = await runChatAction(confirm, h.ctx, h.deps)
    expect(h.builds).toEqual([])
    expect(outcome.plainText).toContain('isn’t available any more')
    expect(outcome.log).toMatchObject({ blocked: 'recommendation_unavailable' })
  })

  it('refuses one from another business the same way', async () => {
    const h = harness({ recommendation: { ...recommendation, businessId: 'biz2' } })
    const outcome = await runChatAction(confirm, h.ctx, h.deps)
    expect(h.builds).toEqual([])
    expect(outcome.log).toMatchObject({ blocked: 'recommendation_unavailable' })
  })

  it('says the same thing when the record is simply gone', async () => {
    const h = harness({ recommendation: null })
    const outcome = await runChatAction(confirm, h.ctx, h.deps)
    expect(h.builds).toEqual([])
    expect(outcome.plainText).toContain('isn’t available any more')
  })
})

describe('a missing Brand Identity is a sentence, not a blocker', () => {
  const confirm = {
    type: 'confirm' as const,
    action: {
      kind: 'campaign.build' as const,
      recommendationId: 'rec1',
      title: 'Weekday lunch traffic',
      then: { format: 'square_post' as const, brief: GOAL, positions: [1, 2, 3], size: 3 },
    },
  }

  it('still makes the posters, and says once which style they used', async () => {
    const h = harness({ business: unbranded })
    const outcome = await runChatAction(confirm, h.ctx, h.deps)

    expect(h.generated).toHaveLength(3)
    expect(outcome.plainText).toContain('clean, neutral style')
    expect(outcome.plainText).toContain('Business → Brand')
    // Said once, not once per poster.
    expect(outcome.plainText.match(/neutral style/g)).toHaveLength(1)
  })

  it('says nothing about style when the business has its own', async () => {
    const h = harness()
    const outcome = await runChatAction(confirm, h.ctx, h.deps)
    expect(outcome.plainText).not.toContain('neutral style')
  })
})
