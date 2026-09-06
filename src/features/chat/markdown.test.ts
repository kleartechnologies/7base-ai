import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inlineToText, parseInline, parseMarkdown, type InlineNode } from './markdown'

const componentSource = readFileSync(
  new URL('./components/Markdown.tsx', import.meta.url),
  'utf8',
)
const rendererSource = readFileSync(
  new URL('./components/blocks/BlockRenderer.tsx', import.meta.url),
  'utf8',
)
const streamingSource = readFileSync(
  new URL('./components/StreamingMessage.tsx', import.meta.url),
  'utf8',
)

const kinds = (nodes: InlineNode[]) => nodes.map((node) => node.type)

describe('Phase 7F — Markdown regression: the raw-asterisk bug', () => {
  it('renders **#22c55e** as bold text, not literal asterisks', () => {
    // The production reply: "…and Matheasy's green **#22c55e** branding".
    const nodes = parseInline("Matheasy's green **#22c55e** branding")
    expect(kinds(nodes)).toEqual(['text', 'bold', 'text'])
    expect(nodes[1]).toEqual({ type: 'bold', children: [{ type: 'text', text: '#22c55e' }] })
    expect(inlineToText(nodes)).toBe("Matheasy's green #22c55e branding")
    expect(inlineToText(nodes)).not.toContain('*')
  })

  it('renders the poster plan list with bold titles and no raw markers', () => {
    const reply = [
      "I'll design the 3 posters using your uploaded app screenshots and Matheasy's green **#22c55e** branding:",
      '',
      '1. **English — Introduction**',
      '2. **Bahasa Melayu — Step-by-step learning**',
      '3. **English — Numi AI Tutor**',
      '',
      'All at 1080x1080.',
    ].join('\n')
    const blocks = parseMarkdown(reply)
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'list', 'paragraph'])
    const list = blocks[1]
    if (list?.type !== 'list') throw new Error('expected a list')
    expect(list.ordered).toBe(true)
    expect(list.start).toBe(1)
    expect(list.items.map(inlineToText)).toEqual([
      'English — Introduction',
      'Bahasa Melayu — Step-by-step learning',
      'English — Numi AI Tutor',
    ])
    expect(list.items.every((item) => item[0]?.type === 'bold')).toBe(true)
    for (const item of list.items) expect(inlineToText(item)).not.toContain('**')
  })

  it('the chat renders assistant text through the Markdown component, both settled and streaming', () => {
    expect(rendererSource).toContain("import { Markdown } from '../Markdown'")
    expect(rendererSource).toContain('<Markdown text={block.text} />')
    expect(streamingSource).toContain("import { Markdown } from './Markdown'")
    expect(streamingSource).toContain('<Markdown text={text} trailing={')
    // The renderer keeps the paragraph type the chat already used.
    expect(componentSource).toContain(
      "'whitespace-pre-wrap text-[15px] leading-[1.65] text-foreground'",
    )
  })

  it("the owner's own messages are never Markdown-rendered", () => {
    // What someone typed shows exactly as typed — `*` and `_` included.
    expect(rendererSource).toContain('markdown ? <Markdown text={block.text} />')
  })
})

describe('inline parsing', () => {
  it('handles bold, italic, code and nesting', () => {
    expect(parseInline('a **b** c')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' c' },
    ])
    expect(parseInline('__b__')).toEqual([{ type: 'bold', children: [{ type: 'text', text: 'b' }] }])
    expect(parseInline('*i*')).toEqual([{ type: 'italic', children: [{ type: 'text', text: 'i' }] }])
    expect(parseInline('_i_ x')).toEqual([
      { type: 'italic', children: [{ type: 'text', text: 'i' }] },
      { type: 'text', text: ' x' },
    ])
    expect(parseInline('**bold *and italic***')).toEqual([
      {
        type: 'bold',
        children: [
          { type: 'text', text: 'bold ' },
          { type: 'italic', children: [{ type: 'text', text: 'and italic' }] },
        ],
      },
    ])
    expect(parseInline('***both***')).toEqual([
      { type: 'bold', children: [{ type: 'italic', children: [{ type: 'text', text: 'both' }] }] },
    ])
    expect(parseInline('*a **b** c*')).toEqual([
      {
        type: 'italic',
        children: [
          { type: 'text', text: 'a ' },
          { type: 'bold', children: [{ type: 'text', text: 'b' }] },
          { type: 'text', text: ' c' },
        ],
      },
    ])
    expect(parseInline('**one** and **two**')).toEqual([
      { type: 'bold', children: [{ type: 'text', text: 'one' }] },
      { type: 'text', text: ' and ' },
      { type: 'bold', children: [{ type: 'text', text: 'two' }] },
    ])
    expect(parseInline('use `npm run verify` now')).toEqual([
      { type: 'text', text: 'use ' },
      { type: 'code', text: 'npm run verify' },
      { type: 'text', text: ' now' },
    ])
    // Nothing inside code is interpreted.
    expect(parseInline('`**not bold**`')).toEqual([{ type: 'code', text: '**not bold**' }])
  })

  it('keeps unclosed and lone delimiters literal (a reply still streaming in)', () => {
    expect(parseInline('green **#22c')).toEqual([{ type: 'text', text: 'green **#22c' }])
    expect(parseInline('3 * 4 * 5')).toEqual([{ type: 'text', text: '3 * 4 * 5' }])
    expect(parseInline('** not bold **')).toEqual([{ type: 'text', text: '** not bold **' }])
    expect(parseInline('a `tick')).toEqual([{ type: 'text', text: 'a `tick' }])
  })

  it('leaves underscores inside words alone', () => {
    expect(parseInline('file_name_here and snake_case')).toEqual([
      { type: 'text', text: 'file_name_here and snake_case' },
    ])
  })

  it('links only to http(s) URLs and never interprets HTML', () => {
    expect(parseInline('see [our site](https://example.com) now')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'link', href: 'https://example.com', children: [{ type: 'text', text: 'our site' }] },
      { type: 'text', text: ' now' },
    ])
    expect(parseInline('[x](javascript:alert(1))')).toEqual([
      { type: 'text', text: '[x](javascript:alert(1))' },
    ])
    expect(parseInline('[x](mailto:a@b.c)')).toEqual([{ type: 'text', text: '[x](mailto:a@b.c)' }])
    expect(parseInline('<b>bold</b> <script>x</script>')).toEqual([
      { type: 'text', text: '<b>bold</b> <script>x</script>' },
    ])
    expect(componentSource).not.toContain('dangerouslySetInnerHTML')
    expect(componentSource).toContain('rel="noopener noreferrer"')
  })

  it('autolinks bare URLs and keeps trailing punctuation outside', () => {
    expect(parseInline('Go to https://marka.my/app, then post.')).toEqual([
      { type: 'text', text: 'Go to ' },
      { type: 'link', href: 'https://marka.my/app', children: [{ type: 'text', text: 'https://marka.my/app' }] },
      { type: 'text', text: ', then post.' },
    ])
  })
})

describe('block parsing', () => {
  it('splits paragraphs on blank lines and keeps single newlines as breaks', () => {
    const blocks = parseMarkdown('line one\nline two\n\nsecond paragraph')
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'line one' },
          { type: 'break' },
          { type: 'text', text: 'line two' },
        ],
      },
      { type: 'paragraph', children: [{ type: 'text', text: 'second paragraph' }] },
    ])
  })

  it('parses bulleted lists with any of the common markers and indented continuations', () => {
    const blocks = parseMarkdown('- one\n* two\n• three\n  still three')
    expect(blocks).toEqual([
      {
        type: 'list',
        ordered: false,
        start: 1,
        items: [
          [{ type: 'text', text: 'one' }],
          [{ type: 'text', text: 'two' }],
          [{ type: 'text', text: 'three' }, { type: 'break' }, { type: 'text', text: 'still three' }],
        ],
      },
    ])
  })

  it('numbered lists keep their starting number', () => {
    const blocks = parseMarkdown('3. third\n4. fourth')
    expect(blocks[0]).toMatchObject({ type: 'list', ordered: true, start: 3 })
  })

  it('renders headings as bold lines and fenced code verbatim', () => {
    const blocks = parseMarkdown('## Plan\n```\n**raw**\n```\nafter')
    expect(blocks).toEqual([
      { type: 'heading', children: [{ type: 'text', text: 'Plan' }] },
      { type: 'code', text: '**raw**' },
      { type: 'paragraph', children: [{ type: 'text', text: 'after' }] },
    ])
  })

  it('an unterminated fence still renders what arrived', () => {
    expect(parseMarkdown('```\nhalf')).toEqual([{ type: 'code', text: 'half' }])
  })

  it('empty input yields nothing', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('\n\n')).toEqual([])
  })
})
