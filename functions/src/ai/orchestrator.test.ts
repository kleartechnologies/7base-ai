import { HttpsError } from 'firebase-functions/v2/https'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reserveAiUsage, settleAiUsage, settleAiUsageFailure } from '../usage/guardrail'
import { runImageTask, runStructuredTask, runTask } from './orchestrator'
import { getOpenAI, isConfigured } from './openai.client'

/**
 * Two seams under test here.
 *
 * The multimodal seam in `runTask`: a turn without parts is sent exactly as
 * it always was — a plain string — so text-only conversations are
 * byte-identical to before attachments existed; a turn *with* parts becomes
 * a content array whose first element is the text and whose parts are the
 * server-built image/file payloads.
 *
 * The Phase 6B guardrail seam: every run* function must reserve usage
 * BEFORE touching OpenAI, must NOT touch OpenAI when the reservation is
 * refused, and must settle afterwards — with the provider's actual usage on
 * success, with zeros on failure. The guardrail module itself is mocked
 * (its arithmetic is pinned down in usage/limits.test.ts); what this file
 * proves is the ORDERING: enforcement before spend, measurement after.
 */

vi.mock('./openai.client', () => ({
  isConfigured: vi.fn(() => true),
  getOpenAI: vi.fn(),
}))

// The guardrail talks to Firestore; mocked so these stay pure-function tests.
vi.mock('../usage/guardrail', () => ({
  reserveAiUsage: vi.fn(),
  settleAiUsage: vi.fn(),
  settleAiUsageFailure: vi.fn(),
}))

const createMock = vi.fn()
const imageMock = vi.fn()

beforeEach(() => {
  createMock.mockReset()
  createMock.mockResolvedValue({
    status: 'completed',
    output_text: 'a reply',
    usage: { input_tokens: 10, output_tokens: 5 },
  })
  imageMock.mockReset()
  imageMock.mockResolvedValue({
    data: [{ b64_json: Buffer.from('png').toString('base64') }],
    usage: { input_tokens: 40, output_tokens: 1600 },
  })
  vi.mocked(getOpenAI).mockReturnValue({
    responses: { create: createMock },
    images: { generate: imageMock },
  } as unknown as ReturnType<typeof getOpenAI>)
  vi.mocked(isConfigured).mockReturnValue(true)

  vi.mocked(reserveAiUsage).mockReset()
  vi.mocked(reserveAiUsage).mockImplementation(async (args) => ({
    uid: args.uid,
    plan: args.plan,
    task: args.task,
    period: '2026-09-04',
    reservation: args.reservation,
  }))
  vi.mocked(settleAiUsage).mockReset()
  vi.mocked(settleAiUsage).mockResolvedValue(undefined)
  vi.mocked(settleAiUsageFailure).mockReset()
  vi.mocked(settleAiUsageFailure).mockResolvedValue(undefined)
})

const BASE = {
  task: 'chat.reply' as const,
  uid: 'user-1',
  plan: 'basic' as const,
  systemPrompt: 'You are MARKA.',
}

describe('runTask input mapping', () => {
  it('sends text-only turns as plain strings — the pre-attachment shape, unchanged', async () => {
    await runTask({
      ...BASE,
      history: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'hi there' },
        { role: 'user', text: 'help me market my café' },
      ],
    })

    const request = createMock.mock.calls[0]![0]
    expect(request.input).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'user', content: 'help me market my café' },
    ])
  })

  it('expands a turn with parts into input_text plus image and file parts', async () => {
    await runTask({
      ...BASE,
      history: [
        { role: 'user', text: 'earlier turn with an old image, sent as text only' },
        {
          role: 'user',
          text: 'what do you think?',
          parts: [
            { type: 'input_image', imageUrl: 'data:image/jpeg;base64,AAAA' },
            { type: 'input_file', filename: 'menu.pdf', fileData: 'data:application/pdf;base64,BBBB' },
          ],
        },
      ],
    })

    const request = createMock.mock.calls[0]![0]
    // Only the turn that carries parts changes shape.
    expect(request.input[0]).toEqual({
      role: 'user',
      content: 'earlier turn with an old image, sent as text only',
    })
    expect(request.input[1]).toEqual({
      role: 'user',
      content: [
        { type: 'input_text', text: 'what do you think?' },
        { type: 'input_image', detail: 'auto', image_url: 'data:image/jpeg;base64,AAAA' },
        { type: 'input_file', filename: 'menu.pdf', file_data: 'data:application/pdf;base64,BBBB' },
      ],
    })
  })

  it('treats an empty parts array exactly like no parts', async () => {
    await runTask({
      ...BASE,
      history: [{ role: 'user', text: 'hello', parts: [] }],
    })
    expect(createMock.mock.calls[0]![0].input).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('still returns a single text block either way', async () => {
    const result = await runTask({
      ...BASE,
      history: [
        {
          role: 'user',
          text: 'see attached',
          parts: [{ type: 'input_image', imageUrl: 'data:image/png;base64,CCCC' }],
        },
      ],
    })
    expect(result.blocks).toEqual([{ id: 'b0', type: 'text', text: 'a reply' }])
    expect(result.plainText).toBe('a reply')
  })
})

const STRUCTURED_BASE = {
  task: 'campaign.build' as const,
  uid: 'user-1',
  plan: 'basic' as const,
  systemPrompt: 'Polish.',
  input: 'the campaign',
  schema: { name: 'test_schema', schema: { type: 'object' } as Record<string, unknown> },
}

const IMAGE_BASE = {
  task: 'creative.generate_image' as const,
  uid: 'user-1',
  plan: 'basic' as const,
  prompt: 'a poster',
  size: '1024x1024' as const,
}

describe('runStructuredTask input mapping (Phase 7E)', () => {
  it('without parts the request keeps the plain-string content it always had', async () => {
    createMock.mockResolvedValue({
      status: 'completed',
      output_text: '{"ok":true}',
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    await runStructuredTask(STRUCTURED_BASE)
    expect(createMock.mock.calls[0]![0].input).toEqual([{ role: 'user', content: 'the campaign' }])
  })

  it('with parts the text comes first, then the server-built image parts', async () => {
    createMock.mockResolvedValue({
      status: 'completed',
      output_text: '{"ok":true}',
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    await runStructuredTask({
      ...STRUCTURED_BASE,
      task: 'business.analyse_dna',
      parts: [{ type: 'input_image', imageUrl: 'data:image/png;base64,AAAA' }],
    })
    expect(createMock.mock.calls[0]![0].input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'the campaign' },
          { type: 'input_image', detail: 'auto', image_url: 'data:image/png;base64,AAAA' },
        ],
      },
    ])
    // The reservation counted the image, so the cap sees the visual weight.
    expect(vi.mocked(reserveAiUsage).mock.calls[0]![0].task).toBe('business.analyse_dna')
    expect(vi.mocked(reserveAiUsage).mock.calls[0]![0].reservation.inputTokens).toBeGreaterThan(
      STRUCTURED_BASE.input.length,
    )
  })
})

describe('usage guardrail ordering', () => {
  it('reserves BEFORE the model call, with the resolved model and full output ceiling', async () => {
    let callsAtCreateTime = -1
    createMock.mockImplementation(async () => {
      callsAtCreateTime = vi.mocked(reserveAiUsage).mock.calls.length
      return { status: 'completed', output_text: 'a reply', usage: { input_tokens: 10, output_tokens: 5 } }
    })

    await runTask({ ...BASE, history: [{ role: 'user', text: 'hello' }] })

    // The reservation existed by the time OpenAI was invoked.
    expect(callsAtCreateTime).toBe(1)
    const args = vi.mocked(reserveAiUsage).mock.calls[0]![0]
    expect(args.uid).toBe('user-1')
    expect(args.plan).toBe('basic')
    expect(args.reservation.category).toBe('chat')
    // Basic's fast tier: worst case is the tier's 2048-token output ceiling.
    expect(args.reservation.outputTokens).toBe(2048)
    expect(args.reservation.inputTokens).toBeGreaterThan(0)
  })

  it('a refused reservation means OpenAI is NEVER called — enforcement precedes spend', async () => {
    vi.mocked(reserveAiUsage).mockRejectedValue(
      new HttpsError('resource-exhausted', "You've reached today's AI request limit. Please try again tomorrow."),
    )

    await expect(
      runTask({ ...BASE, history: [{ role: 'user', text: 'hello' }] }),
    ).rejects.toMatchObject({ code: 'resource-exhausted' })
    expect(createMock).not.toHaveBeenCalled()

    await expect(runStructuredTask(STRUCTURED_BASE)).rejects.toMatchObject({
      code: 'resource-exhausted',
    })
    expect(createMock).not.toHaveBeenCalled()

    await expect(runImageTask(IMAGE_BASE)).rejects.toMatchObject({ code: 'resource-exhausted' })
    expect(imageMock).not.toHaveBeenCalled()
    // And nothing was settled, because nothing was reserved.
    expect(settleAiUsage).not.toHaveBeenCalled()
    expect(settleAiUsageFailure).not.toHaveBeenCalled()
  })

  it('settles with the provider-reported actuals after a successful text call', async () => {
    createMock.mockResolvedValue({
      status: 'completed',
      output_text: 'a reply',
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        input_tokens_details: { cached_tokens: 400 },
      },
    })

    await runTask({ ...BASE, history: [{ role: 'user', text: 'hello' }] })

    expect(settleAiUsage).toHaveBeenCalledTimes(1)
    const [, actual] = vi.mocked(settleAiUsage).mock.calls[0]!
    expect(actual.inputTokens).toBe(1000)
    expect(actual.outputTokens).toBe(200)
    expect(actual.cachedInputTokens).toBe(400)
    // Basic chat runs Luna: (600 × $0.20 + 400 × $0.02 + 200 × $1.20) / 1M.
    expect(actual.costUsd).toBeCloseTo(0.000368, 6)
    expect(actual.imageInputTokens).toBe(0)
    expect(actual.imageOutputTokens).toBe(0)
  })

  it('a failed provider call settles as a failure: attempt kept, tokens released', async () => {
    createMock.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))

    await expect(runTask({ ...BASE, history: [{ role: 'user', text: 'hi' }] })).rejects.toThrow()

    expect(settleAiUsageFailure).toHaveBeenCalledTimes(1)
    expect(settleAiUsage).not.toHaveBeenCalled()
  })

  it('an unparseable structured response is still settled — the tokens were billed', async () => {
    createMock.mockResolvedValue({
      status: 'completed',
      output_text: 'not json at all',
      usage: { input_tokens: 50, output_tokens: 20 },
    })

    await expect(runStructuredTask(STRUCTURED_BASE)).rejects.toThrow(
      'Model did not return usable structured output',
    )
    expect(settleAiUsage).toHaveBeenCalledTimes(1)
    expect(vi.mocked(settleAiUsage).mock.calls[0]![1].inputTokens).toBe(50)
  })

  it('books image tokens to the image counters, never the text budget', async () => {
    await runImageTask(IMAGE_BASE)

    const reserveArgs = vi.mocked(reserveAiUsage).mock.calls[0]![0]
    expect(reserveArgs.reservation.category).toBe('imageGeneration')
    expect(reserveArgs.reservation.inputTokens).toBe(0)
    expect(reserveArgs.reservation.outputTokens).toBe(0)
    // gpt-image-2 is pinned, so the image attempt reserves real dollars.
    expect(reserveArgs.reservation.costUsd).toBeGreaterThan(0)

    const [, actual] = vi.mocked(settleAiUsage).mock.calls[0]!
    expect(actual.inputTokens).toBe(0)
    expect(actual.outputTokens).toBe(0)
    expect(actual.imageInputTokens).toBe(40)
    expect(actual.imageOutputTokens).toBe(1600)
    expect(actual.imageGenerated).toBe(true)
    // (40 × $5 + 1600 × $30) / 1M — the pinned gpt-image-2 rates.
    expect(actual.costUsd).toBeCloseTo(0.0482, 6)
  })

  it('rejects an oversized context BEFORE reserving anything — no quota spent on it', async () => {
    await expect(
      runTask({ ...BASE, history: [{ role: 'user', text: 'x'.repeat(200_000) }] }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })

    expect(reserveAiUsage).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
  })
})

/* --- streaming ----------------------------------------------------------- */

/**
 * The streaming seam in `runTask`: with `onDelta`, the same request runs with
 * `stream: true`, forwards each text delta as it arrives, and reads status
 * and usage from the terminal event. What must hold is that streaming changes
 * NOTHING about accounting — one reservation before the provider, one
 * settlement after, one request counted, whether the reply arrives as one
 * body or five hundred chunks — and that a stream that dies midway settles as
 * a failure instead of leaving the reservation inflight.
 */

function streamOf(events: unknown[], failAfter?: number) {
  return {
    async *[Symbol.asyncIterator]() {
      let index = 0
      for (const event of events) {
        if (failAfter !== undefined && index === failAfter) {
          throw Object.assign(new Error('connection reset'), { name: 'APIConnectionError' })
        }
        index += 1
        yield event
      }
      if (failAfter !== undefined && failAfter >= events.length) {
        throw Object.assign(new Error('connection reset'), { name: 'APIConnectionError' })
      }
    },
  }
}

const delta = (text: string) => ({ type: 'response.output_text.delta', delta: text })
const completed = (usage: Record<string, unknown> = { input_tokens: 10, output_tokens: 5 }) => ({
  type: 'response.completed',
  response: { status: 'completed', usage },
})

describe('runTask streaming', () => {
  const HISTORY = [{ role: 'user' as const, text: 'apa patut saya promote minggu ni?' }]

  it('forwards every delta in order and assembles the identical final text', async () => {
    createMock.mockResolvedValue(
      streamOf([delta('Kalau ikut '), delta('apa yang saya tahu'), delta('…'), completed()]),
    )

    const seen: string[] = []
    const result = await runTask({ ...BASE, history: HISTORY, onDelta: (d) => seen.push(d) })

    expect(seen).toEqual(['Kalau ikut ', 'apa yang saya tahu', '…'])
    expect(result.plainText).toBe('Kalau ikut apa yang saya tahu…')
    expect(result.blocks).toEqual([
      { id: 'b0', type: 'text', text: 'Kalau ikut apa yang saya tahu…' },
    ])
    // The provider request is the buffered request plus the stream flag.
    expect(createMock.mock.calls[0]![0].stream).toBe(true)
    expect(createMock.mock.calls[0]![0].input).toEqual([
      { role: 'user', content: 'apa patut saya promote minggu ni?' },
    ])
  })

  it('a streamed reply is ONE request: one reservation before, one settlement after', async () => {
    let reservationsWhenProviderRan = -1
    createMock.mockImplementation(async () => {
      reservationsWhenProviderRan = vi.mocked(reserveAiUsage).mock.calls.length
      return streamOf([delta('a'), delta('b'), delta('c'), delta('d'),
        completed({ input_tokens: 900, output_tokens: 120, input_tokens_details: { cached_tokens: 300 } })])
    })

    await runTask({ ...BASE, history: HISTORY, onDelta: () => {} })

    expect(reservationsWhenProviderRan).toBe(1)
    expect(reserveAiUsage).toHaveBeenCalledTimes(1)
    expect(settleAiUsage).toHaveBeenCalledTimes(1)
    // Settlement uses the terminal event's usage — chunks are not counted.
    const [, actual] = vi.mocked(settleAiUsage).mock.calls[0]!
    expect(actual.inputTokens).toBe(900)
    expect(actual.outputTokens).toBe(120)
    expect(actual.cachedInputTokens).toBe(300)
  })

  it('a stream that dies mid-reply settles as a failure — reservation released, attempt kept', async () => {
    createMock.mockResolvedValue(streamOf([delta('Hello'), delta(' there')], 2))

    const seen: string[] = []
    await expect(
      runTask({ ...BASE, history: HISTORY, onDelta: (d) => seen.push(d) }),
    ).rejects.toMatchObject({ name: 'AiServiceError' })

    // The partial text did reach the consumer before the failure…
    expect(seen).toEqual(['Hello', ' there'])
    // …but accounting closed out exactly as for any other provider failure.
    expect(settleAiUsageFailure).toHaveBeenCalledTimes(1)
    expect(settleAiUsage).not.toHaveBeenCalled()
  })

  it('a stream failing before any token behaves like a plain provider failure', async () => {
    createMock.mockResolvedValue(streamOf([], 0))

    const seen: string[] = []
    await expect(
      runTask({ ...BASE, history: HISTORY, onDelta: (d) => seen.push(d) }),
    ).rejects.toMatchObject({ name: 'AiServiceError' })
    expect(seen).toEqual([])
    expect(settleAiUsageFailure).toHaveBeenCalledTimes(1)
  })

  it('a stream that ends without a terminal event is a failure, never a silent half-answer', async () => {
    createMock.mockResolvedValue(streamOf([delta('half an ans')]))

    await expect(runTask({ ...BASE, history: HISTORY, onDelta: () => {} })).rejects.toMatchObject({
      name: 'AiServiceError',
    })
    expect(settleAiUsageFailure).toHaveBeenCalledTimes(1)
    expect(settleAiUsage).not.toHaveBeenCalled()
  })

  it('a response.failed terminal event is classified like a thrown provider error', async () => {
    createMock.mockResolvedValue(
      streamOf([
        {
          type: 'response.failed',
          response: { status: 'failed', error: { code: 'server_error' }, usage: null },
        },
      ]),
    )

    await expect(runTask({ ...BASE, history: HISTORY, onDelta: () => {} })).rejects.toMatchObject({
      name: 'AiServiceError',
    })
    expect(settleAiUsageFailure).toHaveBeenCalledTimes(1)
  })

  it('an empty completed stream falls back to the same apology as the buffered path', async () => {
    createMock.mockResolvedValue(streamOf([completed()]))

    const result = await runTask({ ...BASE, history: HISTORY, onDelta: () => {} })
    expect(result.plainText).toBe('')
    expect(result.blocks[0]!.type).toBe('text')
    expect((result.blocks[0] as { text: string }).text).toContain('could not put together a reply')
    // Billed and settled: the provider ran even though it said nothing.
    expect(settleAiUsage).toHaveBeenCalledTimes(1)
  })

  it('a throwing consumer cannot break the reply or its accounting', async () => {
    createMock.mockResolvedValue(streamOf([delta('still '), delta('fine'), completed()]))

    const result = await runTask({
      ...BASE,
      history: HISTORY,
      onDelta: () => {
        throw new Error('client vanished')
      },
    })

    expect(result.plainText).toBe('still fine')
    expect(settleAiUsage).toHaveBeenCalledTimes(1)
    expect(settleAiUsageFailure).not.toHaveBeenCalled()
  })

  it('without onDelta the request is byte-identical to before streaming existed', async () => {
    await runTask({ ...BASE, history: HISTORY })
    expect('stream' in createMock.mock.calls[0]![0]).toBe(false)
  })
})
