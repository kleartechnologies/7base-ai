import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runTask } from './orchestrator'
import { getOpenAI, isConfigured } from './openai.client'

/**
 * The multimodal seam in `runTask`. The contract under test: a turn without
 * parts is sent exactly as it always was — a plain string — so text-only
 * conversations are byte-identical to before attachments existed; a turn
 * *with* parts becomes a content array whose first element is the text and
 * whose parts are the server-built image/file payloads.
 */

vi.mock('./openai.client', () => ({
  isConfigured: vi.fn(() => true),
  getOpenAI: vi.fn(),
}))

const createMock = vi.fn()

beforeEach(() => {
  createMock.mockReset()
  createMock.mockResolvedValue({
    status: 'completed',
    output_text: 'a reply',
    usage: { input_tokens: 10, output_tokens: 5 },
  })
  vi.mocked(getOpenAI).mockReturnValue({
    responses: { create: createMock },
  } as unknown as ReturnType<typeof getOpenAI>)
  vi.mocked(isConfigured).mockReturnValue(true)
})

const BASE = {
  task: 'chat.reply' as const,
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
