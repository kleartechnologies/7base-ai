import { EvaTurn } from './EvaTurn'
import { Markdown } from './Markdown'

/**
 * EVA's reply while it is still being composed.
 *
 * Renders exactly like a finished assistant text block — same width, same
 * type, same spacing — so when the stored message replaces it there is no
 * visual jump; the only addition is a quiet cursor that marks the text as
 * still arriving. The cursor is a fixed-size inline block, so it never
 * changes line height, and it is decorative: hidden from assistive
 * technology, static under reduced motion.
 *
 * Deliberately not a live region. Announcing every streamed update would
 * read the reply to a screen reader dozens of times; the finished message
 * arrives as ordinary new content instead.
 */
export function StreamingMessage({ text }: { text: string }) {
  return (
    <div aria-live="off">
      <EvaTurn>
        <Markdown text={text} trailing={<StreamingCursor />} />
      </EvaTurn>
    </div>
  )
}

function StreamingCursor() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-[1em] w-0.5 translate-y-[0.15em] animate-pulse rounded-sm bg-muted-foreground/70 motion-reduce:animate-none"
    />
  )
}
