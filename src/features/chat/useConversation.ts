import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { t } from '@/i18n/store'
import { toUserMessage } from '@/lib/firebase/errors'
import { observeMessages, sendMessage } from '@/services/chat/chat.service'
import type { AiError } from '@/services/ai/ai.types'
import type { ActionProgressStep, AttachmentDraft, Message } from '@/types'
import { createStreamBuffer } from './streamBuffer'

interface ThreadState {
  /** Which conversation this state describes. */
  conversationId: string | null
  messages: Message[]
  loading: boolean
  /** True from submit until MARKA's reply lands in the thread. */
  awaitingReply: boolean
  /**
   * EVA's reply as it is being composed, streamed ahead of the stored
   * message. Null when nothing is streaming; the empty string means the
   * stream is open but no text has arrived yet (the thinking state). It is
   * local render state only — the finished message always arrives whole
   * through the Firestore subscription, which is when this clears.
   */
  streamingText: string | null
  /**
   * The steps of an action EVA is carrying out (campaign selected, poster 1
   * of 3 generating…), as the backend reports them. Null when no action is
   * in flight. Display only, and cleared the moment the result lands.
   */
  progress: ActionProgressStep[] | null
  error: string | null
}

export interface UseConversationResult extends Omit<ThreadState, 'conversationId'> {
  send: (text: string, attachments?: AttachmentDraft[]) => Promise<void>
}

// Error strings are resolved through the i18n store at the moment they are
// shown, so they follow the active UI language without this hook re-rendering.

function emptyThread(conversationId: string | null): ThreadState {
  return {
    conversationId,
    messages: [],
    loading: Boolean(conversationId),
    awaitingReply: false,
    streamingText: null,
    progress: null,
    error: null,
  }
}

/**
 * Drives one thread.
 *
 * The user's message and MARKA's reply arrive through the same Firestore
 * subscription, so there is no separate "response" path to keep in sync — the
 * thread is whatever Firestore says it is. Streaming does not change that
 * contract: while EVA composes, her text is mirrored into `streamingText` for
 * immediate rendering, and the moment the stored assistant message arrives it
 * replaces the mirror in the same render. Nothing streamed is ever persisted
 * from the client.
 *
 * State is tagged with the conversation it belongs to and discarded during
 * render when the route changes, rather than being cleared from an effect.
 * That way switching threads never flashes the previous thread's messages and
 * never triggers a cascading re-render.
 *
 * `conversationId` is null for a thread that does not exist yet; the first
 * send creates it and reports the new id through `onConversationCreated` the
 * moment the user's message is stored — *before* the reply is awaited — so
 * the subscription attaches, the message renders and the URL is real for the
 * whole generation. A refresh mid-reply lands on /chat/:id and finds the
 * thread; the reply still arrives through the subscription when it is done.
 */
export function useConversation(
  conversationId: string | null,
  onConversationCreated: (id: string) => void,
): UseConversationResult {
  const { user, business } = useAuth()
  const businessId = business ? business.id : null
  const uid = user ? user.uid : null

  const [state, setState] = useState<ThreadState>(() => emptyThread(conversationId))

  // State from a previous route is stale the moment the id changes.
  const thread = state.conversationId === conversationId ? state : emptyThread(conversationId)

  useEffect(() => {
    if (!conversationId) return

    const unsubscribe = observeMessages(
      conversationId,
      (messages) => {
        // MARKA has answered once the newest turn is hers — which also means
        // any locally streamed mirror of that answer is now redundant.
        const replyArrived = messages.at(-1)?.role === 'assistant'
        setState((current) => ({
          conversationId,
          messages,
          loading: false,
          awaitingReply:
            current.conversationId === conversationId && current.awaitingReply && !replyArrived,
          streamingText:
            current.conversationId === conversationId && !replyArrived
              ? current.streamingText
              : null,
          progress:
            current.conversationId === conversationId && !replyArrived ? current.progress : null,
          error: current.conversationId === conversationId ? current.error : null,
        }))
      },
      () => {
        setState((current) => ({
          ...current,
          conversationId,
          loading: false,
          awaitingReply: false,
          streamingText: null,
          progress: null,
          error: t('chat.loadConversationFailed'),
        }))
      },
    )

    return unsubscribe
  }, [conversationId])

  const send = useCallback(
    async (text: string, attachments?: AttachmentDraft[]) => {
      if (!uid) return

      setState((current) => {
        const base = current.conversationId === conversationId ? current : emptyThread(conversationId)
        return {
          ...base,
          // A brand-new thread flips to the conversation view right away, so
          // the thinking indicator is visible while the reply is generated.
          loading: conversationId ? base.loading : true,
          awaitingReply: true,
          streamingText: null,
          progress: null,
          error: null,
        }
      })

      // The id the in-flight state is tagged with. It starts as the route's
      // id; a brand-new thread is re-tagged to the created conversation's id
      // the moment the user message is stored (below), so every guard here
      // must track that move rather than trusting the closure's original id.
      let threadId = conversationId

      // EVA's text, streamed ahead of the stored message. Flushes are
      // coalesced so a fast stream does not render per token.
      let streamedAny = false
      const buffer = createStreamBuffer((fullText) => {
        streamedAny = true
        // The awaitingReply guard closes a race: once the stored reply has
        // arrived (or failed), a trailing flush must not resurrect the mirror.
        setState((current) =>
          current.conversationId === threadId && current.awaitingReply
            ? { ...current, streamingText: fullText }
            : current,
        )
      })

      // An action's steps, as EVA reports them. Same guard as the text
      // mirror: once the stored result (or a failure) has landed, a late
      // progress frame must not bring the indicator back.
      const showProgress = (steps: ActionProgressStep[]) => {
        setState((current) =>
          current.conversationId === threadId && current.awaitingReply
            ? { ...current, progress: steps }
            : current,
        )
      }

      const adoptCreatedConversation = (createdId: string) => {
        threadId = createdId
        // Re-tag the pending state (thinking indicator, cleared error) with
        // the real id *before* navigation swaps the route param, otherwise
        // the render-time check above would discard it as belonging to
        // another thread and the reply's outcome would be lost.
        setState((current) =>
          current.conversationId === null ? { ...current, conversationId: createdId } : current,
        )
        onConversationCreated(createdId)
      }

      try {
        const outcome = await sendMessage(
          uid,
          { conversationId, businessId, text, attachments },
          (delta) => buffer.push(delta),
          (storedId) => {
            // The user's message is durably in Firestore; the reply has not
            // been requested yet. Adopting the created id *now* attaches the
            // subscription and renders the stored message immediately — the
            // user is never staring at "thinking…" with their own words
            // invisible, and a refresh mid-reply keeps the thread.
            if (!conversationId) adoptCreatedConversation(storedId)
          },
          showProgress,
        )
        buffer.finish()
        const settledId = outcome.conversationId

        if (!conversationId && threadId !== settledId) {
          // Fallback for a send that resolved without reporting the stored
          // message first — not a path the service takes today.
          adoptCreatedConversation(settledId)
        }

        if (outcome.replyError) {
          // A reply that broke after text was already on screen must say so —
          // pretending the visible fragment was EVA's whole answer would be a
          // lie. The fragment is dropped, never stored; retry is a fresh send.
          const message = streamedAny
            ? t('chat.interrupted')
            : describeReplyError(outcome.replyError)
          setState((current) =>
            current.conversationId === settledId || current.conversationId === conversationId
              ? {
                  ...current,
                  conversationId: settledId,
                  awaitingReply: false,
                  streamingText: null,
                  progress: null,
                  error: message,
                }
              : current,
          )
        }
      } catch (caught) {
        buffer.finish()
        // The send itself failed. `threadId` is whichever id the thread had
        // at that point — still the route's id when the write itself failed,
        // the created id if the failure came after the message was stored.
        setState((current) =>
          current.conversationId === threadId
            ? {
                ...current,
                loading: Boolean(threadId) && current.loading,
                awaitingReply: false,
                streamingText: null,
                progress: null,
                error: toUserMessage(caught, t('chat.sendFailed')),
              }
            : current,
        )
      }
    },
    [businessId, conversationId, onConversationCreated, uid],
  )

  return {
    messages: thread.messages,
    loading: thread.loading,
    awaitingReply: thread.awaitingReply,
    streamingText: thread.streamingText,
    progress: thread.progress,
    error: thread.error,
    send,
  }
}

function describeReplyError(error: AiError): string {
  if (error.code === 'not_configured') {
    return t('chat.backendNotConnected')
  }
  return error.message
}
