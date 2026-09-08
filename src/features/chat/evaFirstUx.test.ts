import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Phase 7J — EVA absorbs the product.
 *
 * The rules this phase is judged by are about what an owner sees: one thing
 * to say yes to, words instead of product nouns, and no page they must learn
 * before they can promote their lunch. Those live in JSX and in the two
 * dictionaries, so they are asserted here as wiring, the way Phase 7F did.
 * The behaviour behind them is covered under functions/src/chat/actions.
 */
const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const en = read('../../i18n/messages/en.ts')
const ms = read('../../i18n/messages/ms.ts')

/** The value of one dictionary entry, for asserting on the words themselves. */
function entry(dictionary: string, key: string): string {
  const match = new RegExp(`'${key}':\\s*\\n?\\s*'([^']*(?:\\\\'[^']*)*)'`).exec(dictionary)
  if (!match?.[1]) throw new Error(`missing dictionary entry: ${key}`)
  return match[1]
}

describe('one obvious next step per turn', () => {
  const proposal = read('./components/blocks/ActionProposalCard.tsx')
  const recommendation = read('./components/blocks/RecommendationCard.tsx')
  const campaign = read('./components/blocks/CampaignCard.tsx')
  const renderer = read('./components/blocks/BlockRenderer.tsx')
  const bubble = read('./components/MessageBubble.tsx')

  it('the proposal has one primary, and a secondary that starts nothing', () => {
    expect(proposal).toContain("actions.sendQuickReply(t('chat.quickYes'))")
    expect(proposal).toContain("{t('chat.changeSomething')}")
    // "Change something" hands over the keyboard — it sends nothing, calls
    // nothing, and cannot create anything.
    expect(proposal).toContain("document.getElementById('chat-composer')?.focus()")
    expect(proposal).not.toContain('httpsCallable')
    expect(proposal).not.toContain('services/ai')
  })

  it('the cards stand down when EVA has already offered the same step', () => {
    expect(bubble).toContain("message.blocks.some((block) => block.type === 'action_proposal')")
    expect(bubble).toContain('hasProposal={hasProposal}')
    expect(renderer).toContain('<RecommendationCard block={block} hasProposal={hasProposal} />')
    expect(renderer).toContain('<CampaignCard block={block} hasProposal={hasProposal} />')
    expect(recommendation).toContain("block.nextAction === 'build_campaign' && !hasProposal ?")
    expect(campaign).toContain('{hasProposal ? null : (')
  })

  it('only the newest turn can carry a live proposal', () => {
    // An answered proposal is history: `hasProposal` is gated on isLatest, so
    // an older recommendation keeps its own button and stays buildable.
    expect(bubble).toContain('isLatest && message.blocks.some(')
  })

  it('the campaign card leads with the posters and links to the campaign second', () => {
    const primary = campaign.indexOf("t('campaign.createMaterials')")
    const secondary = campaign.indexOf("t('campaign.viewCampaign')")
    expect(primary).toBeGreaterThan(-1)
    expect(secondary).toBeGreaterThan(primary)
    expect(campaign).toContain('variant="ghost"')
  })
})

describe('buttons are written in the owner’s words, not the system’s', () => {
  const labels = [
    'chat.quickYes',
    'chat.changeSomething',
    'campaign.buildCampaign',
    'campaign.askSomethingElse',
    'campaign.createMaterials',
    'campaign.viewCampaign',
    'campaign.building',
  ]

  for (const dictionary of [en, ms]) {
    for (const key of labels) {
      it(`${key} says nothing about the machinery`, () => {
        const value = entry(dictionary, key).toLowerCase()
        for (const word of [
          'execute',
          'workflow',
          'action',
          'confirm action',
          'run ',
          'task',
          'generate',
          'classif',
        ]) {
          expect(value).not.toContain(word)
        }
      })
    }
  }
})

describe('the first screen asks about the business, not the product', () => {
  const empty = read('./components/EmptyState.tsx')
  const overview = read('../../pages/OverviewPage.tsx')

  it('the chips are goals an owner would say out loud', () => {
    for (const key of [
      'chat.chipCustomers',
      'chat.chipSomethingNew',
      'chat.chipPoster',
      'chat.chipQuiet',
    ]) {
      expect(empty).toContain(key)
    }
    // The product's own nouns are gone from the labels: nobody arrives
    // wanting to "create a campaign".
    for (const dictionary of [en, ms]) {
      for (const key of ['chat.chipCustomers', 'chat.chipSomethingNew', 'chat.chipQuiet']) {
        const value = entry(dictionary, key).toLowerCase()
        for (const word of ['campaign', 'kempen', 'creative', 'kreatif', 'profile', 'profil']) {
          expect(value).not.toContain(word)
        }
      }
    }
  })

  it('an empty Overview says what to do, and hands the words to the chat', () => {
    expect(overview).toContain('<NoCampaignsYet />')
    expect(overview).toContain("navigate(ROUTES.chat, { state: { prompt: t(promptKey) } })")
    // The doorway is the conversation — no second campaign wizard.
    expect(overview).not.toContain('createCampaign')
    for (const dictionary of [en, ms]) {
      const value = entry(dictionary, 'overview.noCampaigns').toLowerCase()
      expect(value).not.toContain('no campaigns yet')
      expect(value).not.toContain('belum ada kempen')
    }
  })

  it('a handed-over prompt lands in the composer and is never sent for the owner', () => {
    const page = read('./ChatPage.tsx')
    const composer = read('./components/ChatComposer.tsx')
    expect(page).toContain('initialText={handoffPrompt}')
    // Read once as the field's starting value; nothing auto-sends it.
    expect(composer).toContain('const [value, setValue] = useState(initialText)')
    expect(page).not.toContain('void send(handoffPrompt')
  })
})

describe('after the posters, exactly one suggestion', () => {
  const set = read('./components/blocks/CreativeSetCard.tsx')

  it('renders the single server-written follow-up as a chat message', () => {
    expect(set).toContain('const followUp = block.followUp ?? null')
    expect(set).toContain('actions.sendQuickReply(followUp.text)')
    // One suggestion, not a menu of them.
    expect(set.match(/sendQuickReply/g)).toHaveLength(1)
  })

  it('keeps the way out to the Creative page quiet beside it', () => {
    expect(set).toContain("t('chat.viewAllCreatives')")
    const followUp = set.indexOf('followUp.label')
    const viewAll = set.indexOf("t('chat.viewAllCreatives')")
    expect(followUp).toBeLessThan(viewAll)
  })
})

describe('EVA never implies a capability this product does not have', () => {
  it('no dictionary entry offers to publish, schedule or spend', () => {
    for (const dictionary of [en, ms]) {
      const chat = dictionary
        .split('\n')
        .filter((line) => line.includes("'chat.") || line.includes("'overview."))
        // The disclaimer is the one honest mention: it reminds the owner to
        // check a poster before *they* publish it anywhere.
        .filter((line) => !line.includes("'chat.disclaimer'"))
        .join('\n')
        .toLowerCase()
      for (const word of ['publish', 'terbit', 'schedule', 'jadual', 'ad spend', 'boost']) {
        expect(chat).not.toContain(word)
      }
    }
  })
})

/**
 * What the §24 screenshots turned up. Each of these was visible in a real
 * browser and invisible to every other test: the same question asked twice,
 * the same ask made by two cards, a caption preview squeezed to "W." in a
 * three-up grid, and a tour of the product's own architecture on the one
 * screen that should say "just tell me what you want".
 */
describe('what the visual QA pass caught', () => {
  it('the campaign choice asks once — the buttons are the answer', () => {
    const proposal = read('./components/blocks/ActionProposalCard.tsx')
    // The label survives only as the group's accessible name; the visible
    // question is EVA's own sentence above the buttons.
    expect(proposal).toContain("aria-label={t('chat.chooseCampaign')}")
    expect(proposal).not.toContain(">{t('chat.chooseCampaign')}</span>")
  })

  it('the collapsed caption preview is dropped rather than clipped to nothing', () => {
    const copy = read('../creative/PlatformCopy.tsx')
    expect(copy).toContain('@container')
    expect(copy).toContain('@[17rem]:block')
    expect(copy).toContain('@[17rem]:hidden')
  })

  it('the empty chat teaches no product vocabulary', () => {
    const empty = read('./components/EmptyState.tsx')
    const page = read('./ChatPage.tsx')
    expect(empty).not.toContain('ExploreGrid')
    expect(empty).not.toContain('EXPLORE_CARDS')
    expect(page).not.toContain('ExploreGrid')
    for (const key of ["'nav.business'", "'nav.campaigns'", "'nav.creative'"]) {
      expect(empty).not.toContain(key)
    }
  })

  it('an empty workspace is told what to do, not asked for its profile twice', () => {
    const suggestion = read('../overview/suggestion.ts')
    const firstCampaign = suggestion.indexOf("'overview.suggestFirstCampaign'")
    const profile = suggestion.indexOf("'overview.suggestProfile'")
    expect(firstCampaign).toBeGreaterThan(-1)
    expect(firstCampaign).toBeLessThan(profile)
  })
})

describe('what the production pass caught (Phase 7K)', () => {
  it('an empty workspace makes its one ask once, not twice side by side', () => {
    const page = read('../../pages/OverviewPage.tsx')
    // The campaigns panel already says "tell EVA what you want to promote"
    // and hands over three ways to phrase it. The suggestion card stands
    // down rather than saying it again a hand's width to the right.
    expect(page).toContain("proposed === 'overview.suggestFirstCampaign' && activeCampaigns.length === 0")
    expect(page).toContain('{suggestion ? (')
  })

  it('a single poster card ends where the poster does', () => {
    const preview = read('./components/blocks/CreativePreview.tsx')
    // The poster and its copy are capped at max-w-sm. Left to fill the
    // thread, the card drew a 384px poster inside a 680px frame with an
    // empty column beside it.
    expect(preview).toContain('max-w-[26.5rem]')
  })

  it('an empty library asks EVA rather than teaching where things live', () => {
    for (const dictionary of [en, ms]) {
      for (const key of ['library.emptyCreatives', 'library.emptyCampaigns']) {
        expect(entry(dictionary, key)).toMatch(/EVA/)
      }
    }
    // "Open a campaign and choose 'Make the posters'" taught the object model
    // and sent the owner down a button path instead of to EVA.
    expect(entry(en, 'library.emptyCreatives')).not.toMatch(/open a campaign/i)
    expect(entry(ms, 'library.emptyCreatives')).not.toMatch(/buka satu kempen/i)
  })
})
