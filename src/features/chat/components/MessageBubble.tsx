import { memo } from 'react'
import { cn } from '@/lib/utils'
import type { Message } from '@/types'
import { EvaTurn } from './EvaTurn'
import { BlockRenderer } from './blocks/BlockRenderer'

/**
 * One turn in the thread.
 *
 * The user's turn sits in a soft container; EVA's runs full width as plain
 * prose with her mark beside it (desktop) or an "EVA" label above it
 * (mobile) — never a bubble. That asymmetry is what makes a chat read as a
 * conversation rather than a list of cards.
 *
 * Memoised: while EVA streams, the page re-renders on every 50ms flush of
 * local streaming text, but the stored messages themselves are unchanged —
 * without memo every settled bubble re-renders per flush.
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  isLatest = false,
}: {
  message: Message
  /** The newest turn in the thread — the only one whose proposals are live. */
  isLatest?: boolean
}) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex w-full justify-end">
        <div
          className={cn(
            'min-w-0 max-w-[85%] space-y-3 rounded-2xl bg-secondary px-4 py-2.5 text-[15px] leading-[1.6] sm:max-w-[75%]',
          )}
        >
          {message.blocks.map((block) => (
            <BlockRenderer key={block.id} block={block} conversationId={message.conversationId} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <EvaTurn>
      {message.blocks.map((block) => (
        <BlockRenderer
          key={block.id}
          block={block}
          conversationId={message.conversationId}
          markdown
          isLatest={isLatest}
        />
      ))}
    </EvaTurn>
  )
})
