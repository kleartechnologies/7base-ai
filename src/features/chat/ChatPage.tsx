import { useCallback, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { ROUTES } from '@/app/routes/paths'
import { useConversation } from './useConversation'
import { ChatComposer } from './components/ChatComposer'
import { EmptyState } from './components/EmptyState'
import { MessageBubble } from './components/MessageBubble'
import { ThinkingIndicator } from './components/ThinkingIndicator'

/**
 * The main surface. Serves both `/chat` (no thread yet) and
 * `/chat/:conversationId`, because the transition between them should not
 * unmount and remount the view — the user types once and stays put.
 */
export default function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>()
  const navigate = useNavigate()
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

  const { messages, loading, awaitingReply, error, send } = useConversation(
    conversationId ?? null,
    handleConversationCreated,
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, awaitingReply])

  const isEmpty = !loading && messages.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      {isEmpty ? (
        <div className="flex min-h-0 flex-1 flex-col justify-center px-6 pb-6">
          <EmptyState onPick={(text) => void send(text)} />
          <div className="mx-auto mt-10 w-full max-w-3xl">
            <ChatComposer onSend={(text, attachments) => void send(text, attachments)} autoFocus />
            {error ? <ErrorNotice message={error} /> : null}
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl space-y-7 px-6 py-8">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              {awaitingReply ? <ThinkingIndicator /> : null}
              <div ref={bottomRef} />
            </div>
          </div>

          <div className="shrink-0 px-6 pb-5">
            <div className="mx-auto w-full max-w-3xl">
              <ChatComposer onSend={(text, attachments) => void send(text, attachments)} disabled={awaitingReply} />
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
