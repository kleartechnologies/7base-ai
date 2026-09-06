/**
 * The subset of Markdown EVA actually writes, parsed into a small tree the
 * chat renders as real elements.
 *
 * Why this exists: assistant replies are model text, and the model writes
 * Markdown — `**#22c55e**`, `**English — Introduction**`, numbered lists.
 * Rendering that as raw text put the asterisks on screen. The fix belongs
 * here, in the renderer, not in the prompt: a prompt can ask for plain
 * prose, but it cannot make a model that emphasises stop emphasising.
 *
 * Deliberately small and safe: paragraphs, line breaks, **bold**, *italic*,
 * `code`, fenced code, bulleted and numbered lists, headings (rendered as
 * bold lines — chat is not a document), and links to http(s) URLs only. No
 * raw HTML is ever interpreted; anything unrecognised stays literal text.
 * Unclosed emphasis stays literal too, which is what a reply still
 * streaming in needs.
 */

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: InlineNode[] }
  | { type: 'italic'; children: InlineNode[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: InlineNode[] }
  | { type: 'break' }

export type BlockNode =
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'heading'; children: InlineNode[] }
  | { type: 'list'; ordered: boolean; start: number; items: InlineNode[][] }
  | { type: 'code'; text: string }

const FENCE = /^\s*```/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/
const BULLET = /^\s{0,3}(?:[-*+•])\s+(.*)$/
const NUMBERED = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/
const CONTINUATION = /^\s{2,}(\S.*)$/

export function parseMarkdown(text: string): BlockNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: BlockNode[] = []

  let paragraph: string[] = []
  let list: { ordered: boolean; start: number; items: string[][] } | null = null

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push({ type: 'paragraph', children: joinLines(paragraph) })
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    blocks.push({
      type: 'list',
      ordered: list.ordered,
      start: list.start,
      items: list.items.map(joinLines),
    })
    list = null
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''

    if (FENCE.test(line)) {
      flushParagraph()
      flushList()
      const code: string[] = []
      index += 1
      while (index < lines.length && !FENCE.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      blocks.push({ type: 'code', text: code.join('\n') })
      continue
    }

    if (line.trim() === '') {
      flushParagraph()
      flushList()
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', children: parseInline(heading[1] ?? '') })
      continue
    }

    const numbered = NUMBERED.exec(line)
    const bullet = numbered ? null : BULLET.exec(line)
    if (numbered || bullet) {
      flushParagraph()
      const ordered = numbered !== null
      const item = (numbered ? numbered[2] : bullet?.[1]) ?? ''
      if (!list || list.ordered !== ordered) {
        flushList()
        list = { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] }
      }
      list.items.push([item])
      continue
    }

    if (list) {
      // An indented line under an item belongs to it.
      const continuation = CONTINUATION.exec(line)
      const lastItem = list.items.at(-1)
      if (continuation && lastItem) {
        lastItem.push(continuation[1] ?? '')
        continue
      }
      flushList()
    }

    paragraph.push(line.trim())
  }

  flushParagraph()
  flushList()
  return blocks
}

/** Lines of one paragraph or item, joined with explicit line breaks. */
function joinLines(lines: string[]): InlineNode[] {
  const nodes: InlineNode[] = []
  lines.forEach((line, index) => {
    if (index > 0) nodes.push({ type: 'break' })
    nodes.push(...parseInline(line))
  })
  return nodes
}

const SAFE_HREF = /^https?:\/\/[^\s<>]+$/i
const BARE_URL = /https?:\/\/[^\s<>()]+/i

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = []
  let literal = ''
  const pushLiteral = () => {
    if (literal) nodes.push({ type: 'text', text: literal })
    literal = ''
  }

  let index = 0
  while (index < text.length) {
    const rest = text.slice(index)

    // `code` — nothing inside is interpreted.
    if (rest.startsWith('`')) {
      const close = rest.indexOf('`', 1)
      if (close > 1) {
        pushLiteral()
        nodes.push({ type: 'code', text: rest.slice(1, close) })
        index += close + 1
        continue
      }
    }

    // ***both*** — bold and italic at once.
    const both = matchDelimited(rest, '***')
    if (both) {
      pushLiteral()
      nodes.push({ type: 'bold', children: [{ type: 'italic', children: parseInline(both.inner) }] })
      index += both.length
      continue
    }

    // **bold** / __bold__
    const bold = matchDelimited(rest, '**') ?? matchDelimited(rest, '__')
    if (bold) {
      pushLiteral()
      nodes.push({ type: 'bold', children: parseInline(bold.inner) })
      index += bold.length
      continue
    }

    // *italic* / _italic_ — underscores only at word edges, so snake_case
    // and file_names stay literal.
    const italic =
      matchDelimited(rest, '*') ??
      (isWordEdge(text, index) ? matchDelimited(rest, '_', text, index) : null)
    if (italic) {
      pushLiteral()
      nodes.push({ type: 'italic', children: parseInline(italic.inner) })
      index += italic.length
      continue
    }

    // [label](https://…)
    if (rest.startsWith('[')) {
      const link = matchLink(rest)
      if (link) {
        pushLiteral()
        nodes.push({ type: 'link', href: link.href, children: parseInline(link.label) })
        index += link.length
        continue
      }
    }

    // A bare URL becomes a link; trailing punctuation stays outside it.
    if (/^https?:\/\//i.test(rest) && (index === 0 || /[\s(]/.test(text[index - 1] ?? ''))) {
      const match = BARE_URL.exec(rest)
      if (match) {
        const href = match[0].replace(/[.,;:!?'"]+$/, '')
        if (SAFE_HREF.test(href)) {
          pushLiteral()
          nodes.push({ type: 'link', href, children: [{ type: 'text', text: href }] })
          index += href.length
          continue
        }
      }
    }

    literal += text[index]
    index += 1
  }
  pushLiteral()
  return mergeText(nodes)
}

/**
 * `<delimiter>inner<delimiter>` at the start of `rest`, with the CommonMark
 * flanking rule that keeps a lone asterisk in "3 * 4 * 5" literal: the
 * opening run is followed by non-space, the closing run is preceded by it.
 *
 * Runs are matched by length, which is what makes nesting work without a
 * delimiter stack: inside `*italic*` a `**` run is a bold marker, not the
 * close; and `**bold *and italic***` closes bold on the last two stars of
 * the run, leaving the first to close the italic inside.
 */
function matchDelimited(
  rest: string,
  delimiter: string,
  full?: string,
  at?: number,
): { inner: string; length: number } | null {
  if (!rest.startsWith(delimiter)) return null
  const mark = delimiter[0] ?? ''
  const open = delimiter.length
  const first = rest[open]
  // A longer opening run is a different delimiter; a space means "not emphasis".
  if (first === undefined || first === mark || /\s/.test(first)) return null
  let search = open
  while (search < rest.length) {
    const close = rest.indexOf(delimiter, search)
    if (close === -1) return null
    let runEnd = close
    while (rest[runEnd] === mark) runEnd += 1
    const run = runEnd - close
    const before = rest[close - 1] ?? ''
    const closes =
      !/\s/.test(before) &&
      // A longer run inside single emphasis is a nested (bold) marker.
      !(open === 1 && run > 1) &&
      (mark !== '_' || full === undefined || at === undefined || isWordEdgeAfter(full, at + runEnd))
    if (closes) {
      const closeAt = runEnd - open
      return { inner: rest.slice(open, closeAt), length: runEnd }
    }
    search = runEnd
  }
  return null
}

function isWordEdge(text: string, index: number): boolean {
  const before = text[index - 1]
  return before === undefined || !/[\p{L}\p{N}]/u.test(before)
}

function isWordEdgeAfter(text: string, index: number): boolean {
  const after = text[index]
  return after === undefined || !/[\p{L}\p{N}]/u.test(after)
}

function matchLink(rest: string): { label: string; href: string; length: number } | null {
  const close = rest.indexOf('](')
  if (close < 1) return null
  const end = rest.indexOf(')', close + 2)
  if (end === -1) return null
  const label = rest.slice(1, close)
  const href = rest.slice(close + 2, end).trim()
  if (label.includes('[') || label.includes('\n')) return null
  // Only web links. `javascript:` and friends stay literal text.
  if (!SAFE_HREF.test(href)) return null
  return { label, href, length: end + 1 }
}

function mergeText(nodes: InlineNode[]): InlineNode[] {
  const merged: InlineNode[] = []
  for (const node of nodes) {
    const last = merged.at(-1)
    if (node.type === 'text' && last?.type === 'text') {
      merged[merged.length - 1] = { type: 'text', text: last.text + node.text }
    } else {
      merged.push(node)
    }
  }
  return merged
}

/** The tree flattened back to plain words — for tests and previews. */
export function inlineToText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.text
        case 'break':
          return '\n'
        case 'bold':
        case 'italic':
        case 'link':
          return inlineToText(node.children)
      }
    })
    .join('')
}
