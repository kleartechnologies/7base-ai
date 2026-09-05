import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addDoc, doc, setDoc, updateDoc } from 'firebase/firestore'
import { requestAssistantReply, streamAssistantReply } from '@/services/ai/ai.client'
import { sendMessage } from '@/services/chat/chat.service'

/**
 * Phase 7C regression: submitting a first message must never leave the UI
 * stuck on "EVA is thinking…" with the user's own words invisible.
 *
 * The failure mode: on a new conversation the created id used to surface only
 * after the *entire* reply settled (tens of seconds for a recommendation,
 * which streams zero deltas), so the subscription never attached, the message
 * never rendered, the URL stayed /chat, and a refresh lost the thread. The
 * contract pinned here: `sendMessage` reports the stored user message — with
 * its conversation id — BEFORE the reply is requested, and the hook adopts
 * that id (re-tag, then navigate) at that moment.
 *
 * Behavioural tests run against the real `sendMessage` with Firestore and the
 * AI client mocked at the module boundary; UI-layer checks are source-level,
 * as in streamingWiring.test.ts (node environment, no DOM).
 */

vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn(),
  getDocs: vi.fn(),
  increment: vi.fn((n: number) => n),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  where: vi.fn(),
}))

vi.mock('@/lib/firebase/collections', () => ({
  attachmentsCollection: vi.fn(() => ({})),
  conversationDoc: vi.fn(() => ({})),
  conversationsCollection: vi.fn(() => ({})),
  messagesCollection: vi.fn(() => ({})),
}))

vi.mock('@/services/storage/storage.service', () => ({
  deleteAsset: vi.fn(),
}))

vi.mock('@/services/chat/attachment.service', () => ({
  buildAttachmentBlocks: vi.fn(() => []),
  createChatAttachments: vi.fn(async () => []),
}))

vi.mock('@/services/ai/ai.client', () => ({
  requestAssistantReply: vi.fn(),
  streamAssistantReply: vi.fn(),
}))

/** Order of the steps that matter; the assertions below are about sequence. */
let steps: string[]

beforeEach(() => {
  steps = []
  vi.clearAllMocks()
  vi.mocked(addDoc).mockImplementation(async () => {
    steps.push('createConversation')
    return { id: 'conv_new' } as never
  })
  vi.mocked(doc).mockReturnValue({ id: 'msg_1' } as never)
  vi.mocked(setDoc).mockImplementation(async () => {
    steps.push('writeUserMessage')
  })
  vi.mocked(updateDoc).mockImplementation(async () => {
    steps.push('bumpConversation')
  })
  vi.mocked(streamAssistantReply).mockImplementation(async (request, onDelta) => {
    steps.push('requestReply')
    onDelta('Hello')
    return {
      ok: true,
      data: { conversationId: request.conversationId, assistantMessageId: 'a1' },
    } as never
  })
  vi.mocked(requestAssistantReply).mockImplementation(async (request) => {
    steps.push('requestReply')
    return {
      ok: true,
      data: { conversationId: request.conversationId, assistantMessageId: 'a1' },
    } as never
  })
})

describe('sendMessage reports the stored user message before the reply', () => {
  it('a first send surfaces the created conversation id before the reply is requested', async () => {
    const notified: string[] = []
    const outcome = await sendMessage(
      'owner_1',
      { conversationId: null, businessId: 'biz_1', text: 'Plan my Ramadan promo' },
      () => {},
      (id) => {
        notified.push(id)
        steps.push('reportStored')
      },
    )

    expect(notified).toEqual(['conv_new'])
    // The listener can attach — and the message render — while EVA works.
    expect(steps).toEqual([
      'createConversation',
      'writeUserMessage',
      'bumpConversation',
      'reportStored',
      'requestReply',
    ])
    expect(outcome).toEqual({
      conversationId: 'conv_new',
      userMessageId: 'msg_1',
      replyError: null,
    })
  })

  it('an existing thread reports the same id, still ahead of the reply', async () => {
    const notified: string[] = []
    await sendMessage(
      'owner_1',
      { conversationId: 'conv_9', businessId: 'biz_1', text: 'And for families?' },
      () => {},
      (id) => {
        notified.push(id)
        steps.push('reportStored')
      },
    )
    expect(notified).toEqual(['conv_9'])
    expect(steps).toEqual(['writeUserMessage', 'bumpConversation', 'reportStored', 'requestReply'])
  })

  it('a failed reply still resolves with the id already reported — never a stuck promise', async () => {
    vi.mocked(streamAssistantReply).mockImplementation(async () => {
      steps.push('requestReply')
      return { ok: false, error: { code: 'internal', message: 'EVA hit a problem.' } } as never
    })
    const notified: string[] = []
    const outcome = await sendMessage(
      'owner_1',
      { conversationId: null, businessId: 'biz_1', text: 'Plan my Ramadan promo' },
      () => {},
      (id) => notified.push(id),
    )
    // The thread and the user's message exist and are reachable; only the
    // reply is missing, and the outcome says so for the UI's error state.
    expect(notified).toEqual(['conv_new'])
    expect(outcome.replyError).toEqual({ code: 'internal', message: 'EVA hit a problem.' })
  })

  it('deltas still flow through the streaming path — the report adds no second AI call', async () => {
    const deltas: string[] = []
    await sendMessage(
      'owner_1',
      { conversationId: 'conv_9', businessId: 'biz_1', text: 'Hi' },
      (delta) => deltas.push(delta),
      () => {},
    )
    expect(deltas).toEqual(['Hello'])
    expect(vi.mocked(streamAssistantReply)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(requestAssistantReply)).not.toHaveBeenCalled()
  })

  it('nothing is reported when the message was never stored', async () => {
    const notified: string[] = []
    await expect(
      sendMessage('owner_1', { conversationId: null, businessId: 'biz_1', text: '   ' }, undefined, (id) =>
        notified.push(id),
      ),
    ).rejects.toThrow('Cannot send an empty message.')
    expect(notified).toEqual([])
    expect(steps).toEqual([])
  })
})

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('new-conversation flow wiring', () => {
  const hook = read('./useConversation.ts')
  const service = read('../../services/chat/chat.service.ts')
  const page = read('./ChatPage.tsx')

  it('the service reports after the user message write, before the reply request', () => {
    const report = service.indexOf('onUserMessageStored?.(conversationId)')
    expect(report).toBeGreaterThan(service.indexOf('await setDoc(newMessageRef, message)'))
    expect(report).toBeLessThan(service.indexOf('streamAssistantReply(replyRequest'))
  })

  it('the hook adopts the created id the moment the message is stored', () => {
    expect(hook).toContain('if (!conversationId) adoptCreatedConversation(storedId)')
  })

  it('adoption re-tags the pending state before navigating, so thinking survives the route swap', () => {
    const adopt = hook.slice(hook.indexOf('const adoptCreatedConversation'))
    const reTag = adopt.indexOf('threadId = createdId')
    const navigate = adopt.indexOf('onConversationCreated(createdId)')
    expect(reTag).toBeGreaterThanOrEqual(0)
    expect(navigate).toBeGreaterThan(reTag)
    expect(adopt.indexOf('setState')).toBeLessThan(navigate)
  })

  it('snapshots are authoritative for messages but keep thinking on until the reply lands', () => {
    // The subscription never overwrites the stored user turn (messages come
    // whole from Firestore) and never clears awaitingReply early.
    expect(hook).toContain('current.awaitingReply && !replyArrived')
    expect(hook).toContain("messages.at(-1)?.role === 'assistant'")
  })

  it('every failure path turns thinking off — stuck-forever is impossible on error', () => {
    expect(hook.match(/awaitingReply: false/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('a silent stream cannot hang the send — the callable carries a deadline', () => {
    const client = read('../../services/ai/ai.client.ts')
    expect(client).toContain('ASSISTANT_REPLY_TIMEOUT_MS')
    expect(client).toContain('timeout: ASSISTANT_REPLY_TIMEOUT_MS')
  })

  it('the page shows errors in both branches and re-enables the composer after a reply', () => {
    expect(page.match(/<ErrorNotice message=\{error\} \/>/g)?.length).toBe(2)
    expect(page).toContain('disabled={awaitingReply}')
  })
})
