import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Phase 7F — EVA acts. Wiring assertions across the callable and the chat
 * UI: the decision runs first, proposals live on EVA's turn, a card's button
 * is only ever a chat message, and nothing about models, plans or ids is
 * decided in the browser. The behaviour itself is covered by the unit
 * suites under functions/src/chat/actions.
 */
const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

describe('the callable acts before it chats', () => {
  const callable = read('../../../functions/src/chat/assistantReply.ts')

  it('decides from the stored thread, never from the request payload', () => {
    expect(callable).toContain('const decision = decideChatAction({')
    expect(callable).toContain('previousAssistant: lastAssistant ?? null')
    expect(callable).toContain('const proposal = pendingProposal(lastAssistant ?? null)')
  })

  it('runs the action route ahead of creative edit, campaign edit and conversation', () => {
    const action = callable.indexOf("if (decision.type !== 'none') {")
    const creativeEdit = callable.indexOf('detectCreativeEdit(latest.text)')
    const campaignEdit = callable.indexOf('if (detectCampaignEdit(latest.text)) {')
    const chat = callable.indexOf("task: 'chat.reply'")
    expect(action).toBeGreaterThan(-1)
    expect(action).toBeLessThan(creativeEdit)
    expect(creativeEdit).toBeLessThan(campaignEdit)
    expect(campaignEdit).toBeLessThan(chat)
  })

  it('executes through the shared executor with the server-known plan and business', () => {
    expect(callable).toContain('await runChatAction(decision, {')
    expect(callable).toMatch(/runChatAction\(decision, \{\s*uid,\s*plan,\s*conversationId,\s*businessId,\s*business,/)
    expect(callable).toContain('onProgress: sendProgress')
  })

  it("turns EVA's own offer into a proposal on her turn, so the next yes executes", () => {
    expect(callable).toContain('const offer = detectAssistantOffer(result.plainText)')
    expect(callable).toContain('attached = await proposeFromOffer(')
    expect(callable).toContain('if (!attached && carried) attached = carried')
    expect(callable).toContain("pendingOffer: carried ? describeProposal(carried.action) : null")
  })

  it('a declined offer is dropped, not carried', () => {
    expect(callable).toContain("const declined = proposal !== null && readAffirmation(latest.text) === 'no'")
    expect(callable).toContain('const carried = proposal && !declined ? proposal : null')
  })

  it('the result is persisted through the same writer as every reply', () => {
    expect(callable).toMatch(/const assistantMessageId = await writeAssistantMessage\(\s*outcome\.blocks,\s*outcome\.plainText,\s*outcome\.meta,?\s*\)/)
  })
})

describe('the executor reuses the secure pipelines', () => {
  const execute = read('../../../functions/src/chat/actions/execute.ts')

  it('generates through generateCreativeForCampaign under its own lock', () => {
    expect(execute).toContain('generateCreativeForCampaign')
    expect(execute).toContain('creativeGenerateLockKey(')
    expect(execute).not.toContain('runTask(')
    expect(execute).not.toContain('openai')
  })

  it('builds campaigns through buildCampaignFromRecommendationRecord under its lock', () => {
    expect(execute).toContain('buildCampaignFromRecommendationRecord')
    expect(execute).toContain('campaignBuildLockKey(')
  })

  it('re-checks ownership of every campaign it touches', () => {
    expect(execute).toContain('campaign.ownerId !== ctx.uid')
    expect(execute).toContain('campaign.businessId !== ctx.businessId')
  })
})

describe('the chat UI', () => {
  const renderer = read('./components/blocks/BlockRenderer.tsx')
  const proposal = read('./components/blocks/ActionProposalCard.tsx')
  const set = read('./components/blocks/CreativeSetCard.tsx')
  const page = read('./ChatPage.tsx')
  const bubble = read('./components/MessageBubble.tsx')
  const progress = read('./components/ActionProgress.tsx')

  it('renders the two new blocks', () => {
    expect(renderer).toContain("case 'action_proposal':")
    expect(renderer).toContain('<ActionProposalCard block={block} isLatest={isLatest} />')
    expect(renderer).toContain("case 'creative_set':")
    expect(renderer).toContain('<CreativeSetCard block={block} />')
  })

  it('a proposal button sends an ordinary chat message and nothing else', () => {
    expect(proposal).toContain("actions.sendQuickReply(t('chat.quickYes'))")
    expect(proposal).toContain("actions.sendQuickReply(t('chat.quickUseCampaign', { name: choice.name }))")
    // No callable, no ids, no plan: the card has no authority of its own.
    expect(proposal).not.toContain('httpsCallable')
    expect(proposal).not.toContain('services/ai')
    expect(proposal).not.toContain('campaignId:')
    expect(page).toContain('sendQuickReply: (text) => void send(text)')
  })

  it('only the newest turn shows go-ahead buttons, and never while a reply is awaited', () => {
    expect(proposal).toContain('if (!isLatest || !actions) return null')
    expect(proposal).toContain('disabled={busy}')
    expect(page).toContain('isLatest={index === messages.length - 1}')
    expect(page).toContain('busy: awaitingReply')
    expect(bubble).toContain('isLatest={isLatest}')
  })

  it('shows action progress in place of the thinking line while EVA works', () => {
    expect(page).toContain('<ActionProgress steps={progress} />')
    const streaming = page.indexOf('<StreamingMessage text={streamingText} />')
    const steps = page.indexOf('<ActionProgress steps={progress} />')
    const thinking = page.indexOf('<ThinkingIndicator />')
    expect(streaming).toBeLessThan(steps)
    expect(steps).toBeLessThan(thinking)
  })

  it('progress labels are business steps in the owner’s language — no model, task or quota talk', () => {
    for (const key of [
      'chat.progressCampaign',
      'chat.progressBrand',
      'chat.progressAssets',
      'chat.progressConcepts',
      'chat.progressPoster',
    ]) {
      expect(progress).toContain(key)
    }
    // The labels themselves, in both languages.
    const en = read('../../i18n/messages/en.ts')
    const ms = read('../../i18n/messages/ms.ts')
    for (const dictionary of [en, ms]) {
      const labels = dictionary
        .split('\n')
        .filter((line) => line.includes("'chat.progress"))
        .join('\n')
        .toLowerCase()
      expect(labels).not.toBe('')
      for (const word of ['model', 'token', 'quota', 'task', 'cost', 'gpt', 'openai']) {
        expect(labels).not.toContain(word)
      }
    }
  })

  it('the result card links to the Creative page, the canonical home of the posters', () => {
    expect(set).toContain('<Link to={ROUTES.creative}>')
    expect(set).toContain("t('chat.viewAllCreatives')")
    expect(set).toContain("t('chat.creativeSetPartial', { created, requested: block.requested })")
  })
})
