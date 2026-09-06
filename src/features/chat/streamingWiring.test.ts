import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Streaming's wiring across module boundaries. Vitest runs in a node
 * environment with no DOM, so the UI checks here are source-level (the same
 * approach as attachmentsWiring.test.ts): they pin that the callable, the
 * client, the hook and the page are actually connected for live delivery —
 * and that the honesty and safety rules around it survive refactors.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('backend streaming wiring', () => {
  const callable = read('../../../functions/src/chat/assistantReply.ts')

  it('streams only when the client asked, through the callable’s own channel', () => {
    expect(callable).toContain('request.acceptsStreaming && response')
    expect(callable).toContain("sendChunk({ type: 'delta', text: delta })")
    // Phase 7F: action progress rides the same channel, same guard.
    expect(callable).toContain("sendChunk({ type: 'progress', steps })")
  })

  it('a disconnected client cannot fail or stall the reply', () => {
    // sendChunk failures are swallowed and further sends stop; generation,
    // persistence and settlement continue regardless.
    expect(callable).toContain('clientGone = true')
    expect(callable).toContain('if (!streaming || clientGone) return')
  })

  it('the streamed reply is still persisted server-side through the same writer', () => {
    const afterRunTask = callable.slice(callable.indexOf('onDelta: sendDelta'))
    expect(afterRunTask).toContain('writeAssistantMessage(')
  })

  it('streaming rides the orchestrator — no second OpenAI path was created', () => {
    const orchestrator = read('../../../functions/src/ai/orchestrator.ts')
    // The only stream flag in the AI layer sits inside runTask, behind the
    // same reserve/settle pair as every other call.
    expect(orchestrator).toContain('stream: true as const')
    // The callable binds the key secret but never constructs a client or
    // calls the provider itself.
    expect(callable).not.toContain('getOpenAI')
    expect(callable).not.toContain('responses.create')
  })
})

describe('client streaming wiring', () => {
  const client = read('../../services/ai/ai.client.ts')

  it('uses the callable stream — same function, same auth, no new endpoint', () => {
    expect(client).toContain('callable.stream(request)')
    expect(client).toContain('CALLABLES.assistantReply')
  })

  it('forwards only well-formed delta and progress chunks', () => {
    expect(client).toContain("chunk?.type === 'delta' && typeof chunk.text === 'string'")
    expect(client).toContain("chunk?.type === 'progress' && Array.isArray(chunk.steps)")
  })

  it('sendMessage routes deltas through the streaming call', () => {
    const service = read('../../services/chat/chat.service.ts')
    expect(service).toContain('onAssistantDelta?: (text: string) => void')
    expect(service).toContain(
      'streamAssistantReply(replyRequest, onAssistantDelta, onAssistantProgress)',
    )
  })

  it('the browser still has no OpenAI client and no key', () => {
    // Prose may mention the provider; what must never appear is an SDK
    // import, a client construction, or key material.
    expect(client).not.toContain("from 'openai'")
    expect(client).not.toContain('new OpenAI')
    expect(client).not.toMatch(/sk-[A-Za-z0-9]{8}/)
    expect(client).not.toMatch(/apiKey\s*[:=]/)
  })
})

describe('useConversation streaming state', () => {
  const hook = read('./useConversation.ts')

  it('buffers deltas so a fast stream does not render per token', () => {
    expect(hook).toContain('createStreamBuffer')
    expect(hook).toContain('buffer.push(delta)')
  })

  it('the mirror clears the moment the stored reply arrives', () => {
    expect(hook).toContain("messages.at(-1)?.role === 'assistant'")
    expect(hook).toContain('!replyArrived')
  })

  it('a trailing flush cannot resurrect the mirror after completion', () => {
    // `threadId` tracks the created id on a first send, so the guard holds
    // across the early navigation as well.
    expect(hook).toContain('current.conversationId === threadId && current.awaitingReply')
  })

  it('a reply that broke after partial text says so — and drops the fragment', () => {
    expect(hook).toContain("t('chat.interrupted')")
    expect(hook).toContain('streamedAny')
    // Every error path clears the streamed mirror; nothing partial survives.
    expect(hook.match(/streamingText: null/g)?.length).toBeGreaterThanOrEqual(4)
  })
})

describe('chat page streaming UI', () => {
  const page = read('./ChatPage.tsx')
  const bubble = read('./components/StreamingMessage.tsx')
  const markdown = read('./components/Markdown.tsx')

  it('shows thinking until first text, then the growing reply', () => {
    expect(page).toContain('<StreamingMessage text={streamingText} />')
    expect(page).toContain('<ThinkingIndicator />')
    // Streamed text takes precedence over the dots once it exists.
    expect(page.indexOf('StreamingMessage text=')).toBeLessThan(page.indexOf('<ThinkingIndicator />'))
  })

  it('streamed growth follows the Phase 6C near-bottom rule, never yanking the reader', () => {
    expect(page).toContain('streamingText?.length')
    expect(page).toContain('nearBottom')
    expect(page).toContain('firstRender || nearBottom')
  })

  it('the streaming bubble matches a finished text block, plus a quiet cursor', () => {
    // Same renderer and typography as a settled text block — no jump on
    // completion. (Phase 7F: both go through the Markdown component.)
    expect(bubble).toContain('<Markdown text={text} trailing={<StreamingCursor />} />')
    expect(markdown).toContain('whitespace-pre-wrap text-[15px] leading-[1.65]')
    // The cursor is decorative and calm: hidden from AT, still under reduced
    // motion, fixed-size so it cannot change line height.
    expect(bubble).toContain('aria-hidden')
    expect(bubble).toContain('motion-reduce:animate-none')
    expect(bubble).toContain('h-[1em]')
  })

  it('streamed updates are not announced token by token', () => {
    expect(bubble).toContain('aria-live="off"')
  })
})
