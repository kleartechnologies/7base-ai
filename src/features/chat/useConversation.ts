import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { toUserMessage } from '@/lib/firebase/errors'
import { observeMessages, sendMessage } from '@/services/chat/chat.service'
import type { AiError } from '@/services/ai/ai.types'
import type { AttachmentDraft, Message } from '@/types'
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
  error: string | null
}

export interface UseConversationResult extends Omit<ThreadState, 'conversationId'> {
  send: (text: string, attachments?: AttachmentDraft[]) => Promise<void>
}

/** Shown when a reply broke after some of it was already on screen (§ honesty). */
const INTERRUPTED_MESSAGE = 'EVA’s response was interrupted. Please try again.'

function emptyThread(conversationId: string | null): ThreadState {
  return {
    conversationId,
    messages: [],
    loading: Boolean(conversationId),
    awaitingReply: false,
    streamingText: null,
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
 * send creates it and reports the new id through `onConversationCreated`.
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
          error: 'Could not load this conversation.',
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
          error: null,
        }
      })

      // EVA's text, streamed ahead of the stored message. Deltas arrive while
      // the state is still tagged with the id this send started from (a new
      // thread is re-tagged only after the reply completes), so the closure id
      // is the right guard. Flushes are coalesced so a fast stream does not
      // render per token.
      let streamedAny = false
      const buffer = createStreamBuffer((fullText) => {
        streamedAny = true
        // The awaitingReply guard closes a race: once the stored reply has
        // arrived (or failed), a trailing flush must not resurrect the mirror.
        setState((current) =>
          current.conversationId === conversationId && current.awaitingReply
            ? { ...current, streamingText: fullText }
            : current,
        )
      })

      try {
        const outcome = await sendMessage(
          uid,
          { conversationId, businessId, text, attachments },
          (delta) => buffer.push(delta),
        )
        buffer.finish()
        const settledId = outcome.conversationId

        if (!conversationId) {
          // The first send just created the conversation. Re-tag the pending
          // state (thinking indicator, cleared error) with the real id *before*
          // navigation swaps the route param, otherwise the render-time check
          // above would discard it as belonging to another thread and the
          // outcome below would be lost.
          setState((current) =>
            current.conversationId === null ? { ...current, conversationId: settledId } : current,
          )
          onConversationCreated(settledId)
        }

        if (outcome.replyError) {
          // A reply that broke after text was already on screen must say so —
          // pretending the visible fragment was EVA's whole answer would be a
          // lie. The fragment is dropped, never stored; retry is a fresh send.
          const message = streamedAny
            ? INTERRUPTED_MESSAGE
            : describeReplyError(outcome.replyError)
          setState((current) =>
            current.conversationId === settledId || current.conversationId === conversationId
              ? {
                  ...current,
                  conversationId: settledId,
                  awaitingReply: false,
                  streamingText: null,
                  error: message,
                }
              : current,
          )
        }
      } catch (caught) {
        buffer.finish()
        // The send itself failed, so no navigation happened; the state is
        // still tagged with the id this send started from.
        setState((current) =>
          current.conversationId === conversationId
            ? {
                ...current,
                loading: Boolean(conversationId) && current.loading,
                awaitingReply: false,
                streamingText: null,
                error: toUserMessage(caught, 'Your message could not be sent. Please try again.'),
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
    error: thread.error,
    send,
  }
}

function describeReplyError(error: AiError): string {
  if (error.code === 'not_configured') {
    return 'EVA’s AI backend is not connected yet. Your message was saved — deploy the Cloud Functions to get a reply.'
  }
  return error.message
}
