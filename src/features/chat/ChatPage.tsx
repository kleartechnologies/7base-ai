import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { ROUTES } from '@/app/routes/paths'
import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/hooks/useI18n'
import { ChatActionsContext, type ChatActions } from './chatActionsContext'
import { useConversation } from './useConversation'
import { ActionProgress } from './components/ActionProgress'
import { ChatComposer } from './components/ChatComposer'
import { EmptyState, ExploreGrid, SuggestionChips } from './components/EmptyState'
import { MessageBubble } from './components/MessageBubble'
import { StreamingMessage } from './components/StreamingMessage'
import { ThinkingIndicator } from './components/ThinkingIndicator'

/**
 * The main surface. Serves both `/chat` (no thread yet) and
 * `/chat/:conversationId`, because the transition between them should not
 * unmount and remount the view — the user types once and stays put.
 */
export default function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>()
  const navigate = useNavigate()
  const { business } = useAuth()
  const { t } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const handleConversationCreated = useCallback(
    (id: string) => {
      // `replace` keeps Back going to wherever the user came from rather than
      // to an empty composer.
      navigate(ROUTES.conversation(id), { replace: true })
    },
    [navigate],
  )

  const { messages, loading, awaitingReply, streamingText, progress, error, send } =
    useConversation(conversationId ?? null, handleConversationCreated)

  // A card's button sends an ordinary chat message on the owner's behalf —
  // the same path as typing it. The server decides what it meant.
  const chatActions = useMemo<ChatActions>(
    () => ({ sendQuickReply: (text) => void send(text), busy: awaitingReply }),
    [send, awaitingReply],
  )

  // Opening a thread jumps to the newest message. After that, new content only
  // scrolls the view when the user is already at (or near) the bottom — never
  // yanking someone away from an older message they scrolled up to read.
  // Streamed text growth follows the same rule: the view keeps up with EVA's
  // typing only for a reader already at the bottom.
  const scrolledThreadRef = useRef<string | null>(null)
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const threadKey = conversationId ?? 'new'
    const firstRender = scrolledThreadRef.current !== threadKey
    const nearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 120

    if (firstRender || nearBottom) {
      bottomRef.current?.scrollIntoView({ block: 'end' })
    }
    if (messages.length > 0) {
      scrolledThreadRef.current = threadKey
    }
  }, [conversationId, messages.length, awaitingReply, streamingText?.length, progress?.length])

  const isEmpty = !loading && messages.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      {isEmpty ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-6 py-10">
            <EmptyState />
            <div className="mx-auto mt-8 w-full max-w-[640px]">
              <ChatComposer
                onSend={(text, attachments) => void send(text, attachments)}
                autoFocus
              />
              {error ? <ErrorNotice message={error} /> : null}
            </div>
            <SuggestionChips onPick={(text) => void send(text)} />
            <ExploreGrid />
            {business ? (
              <p className="mt-10 text-center text-xs text-muted-foreground">
                {t('chat.evaKnowsFooter', { name: business.name })}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <ChatActionsContext.Provider value={chatActions}>
              <div className="mx-auto w-full max-w-3xl space-y-7 px-6 py-8">
                {messages.map((message, index) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isLatest={index === messages.length - 1}
                  />
                ))}
                {streamingText ? (
                  // EVA's reply, rendered as it is generated. Swapped for the
                  // stored message in the same render the snapshot delivers it.
                  <StreamingMessage text={streamingText} />
                ) : progress && progress.length > 0 ? (
                  // EVA doing the work: the steps of an action, as reported.
                  <ActionProgress steps={progress} />
                ) : awaitingReply ? (
                  <ThinkingIndicator />
                ) : null}
                <div ref={bottomRef} />
              </div>
            </ChatActionsContext.Provider>
          </div>

          <div className="shrink-0 px-6 pb-5">
            <div className="mx-auto w-full max-w-3xl">
              <ChatComposer
                onSend={(text, attachments) => void send(text, attachments)}
                disabled={awaitingReply}
                placeholder={t('chat.replyPlaceholder')}
              />
              {error ? <ErrorNotice message={error} /> : null}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted px-3 py-2.5 text-[13px] leading-relaxed text-muted-foreground"
    >
      <AlertCircle className="mt-px size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  )
}
