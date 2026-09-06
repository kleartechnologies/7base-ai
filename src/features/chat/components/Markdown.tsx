import { Fragment, memo, type ReactNode } from 'react'
import { parseMarkdown, type BlockNode, type InlineNode } from '../markdown'

/**
 * EVA's prose, rendered as real elements instead of raw Markdown.
 *
 * Same type, width and rhythm as the plain text paragraph it replaces, so
 * older messages and the streaming reply look identical — the only change is
 * that `**bold**` is bold and a numbered list is a list. `trailing` is a
 * node appended inside the last paragraph (the streaming cursor), so the
 * cursor sits at the end of the text rather than on its own line.
 */
export const Markdown = memo(function Markdown({
  text,
  trailing,
}: {
  text: string
  trailing?: ReactNode
}) {
  const blocks = parseMarkdown(text)
  if (blocks.length === 0) {
    return trailing ? <p className={PARAGRAPH}>{trailing}</p> : null
  }
  const lastIndex = blocks.length - 1
  return (
    <>
      {blocks.map((block, index) => (
        <Fragment key={index}>{renderBlock(block, index === lastIndex ? trailing : undefined)}</Fragment>
      ))}
    </>
  )
})

const PARAGRAPH = 'whitespace-pre-wrap text-[15px] leading-[1.65] text-foreground'

function renderBlock(block: BlockNode, trailing: ReactNode): ReactNode {
  switch (block.type) {
    case 'paragraph':
      return (
        <p className={PARAGRAPH}>
          {renderInline(block.children)}
          {trailing}
        </p>
      )
    case 'heading':
      // Chat is not a document: a heading is a bold line, same size as prose.
      return (
        <p className={`${PARAGRAPH} font-semibold`}>
          {renderInline(block.children)}
          {trailing}
        </p>
      )
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <>
          <Tag
            start={block.ordered ? block.start : undefined}
            className={`${PARAGRAPH} space-y-1 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
          >
            {block.items.map((item, index) => (
              <li key={index} className="pl-0.5">
                {renderInline(item)}
              </li>
            ))}
          </Tag>
          {trailing ? <p className={PARAGRAPH}>{trailing}</p> : null}
        </>
      )
    }
    case 'code':
      return (
        <>
          <pre className="overflow-x-auto rounded-lg bg-secondary px-3 py-2.5 font-mono text-[13px] leading-[1.6] text-foreground">
            <code>{block.text}</code>
          </pre>
          {trailing ? <p className={PARAGRAPH}>{trailing}</p> : null}
        </>
      )
  }
}

function renderInline(nodes: InlineNode[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={index}>{node.text}</Fragment>
      case 'break':
        return <br key={index} />
      case 'bold':
        return (
          <strong key={index} className="font-semibold">
            {renderInline(node.children)}
          </strong>
        )
      case 'italic':
        return <em key={index}>{renderInline(node.children)}</em>
      case 'code':
        return (
          <code key={index} className="rounded bg-secondary px-1 py-0.5 font-mono text-[13px]">
            {node.text}
          </code>
        )
      case 'link':
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {renderInline(node.children)}
          </a>
        )
    }
  })
}
