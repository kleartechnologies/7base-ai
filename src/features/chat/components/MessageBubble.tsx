import { memo } from 'react'
import { cn } from '@/lib/utils'
import type { Message } from '@/types'
import { BlockRenderer } from './blocks/BlockRenderer'

/**
 * One turn in the thread.
 *
 * The user's turn sits in a soft container; MARKA's runs full width as plain
 * prose. That asymmetry is what makes a chat read as a conversation rather
 * than a list of cards.
 *
 * Memoised: while EVA streams, the page re-renders on every 50ms flush of
 * local streaming text, but the stored messages themselves are unchanged —
 * without memo every settled bubble re-renders per flush.
 */
export const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'min-w-0 space-y-3',
          isUser
            ? 'max-w-[85%] rounded-2xl bg-secondary px-4 py-2.5 text-[15px] leading-[1.6] sm:max-w-[75%]'
            : 'w-full',
        )}
      >
        {message.blocks.map((block) => (
          <BlockRenderer key={block.id} block={block} conversationId={message.conversationId} />
        ))}
      </div>
    </div>
  )
})
