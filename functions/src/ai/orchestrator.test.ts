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
