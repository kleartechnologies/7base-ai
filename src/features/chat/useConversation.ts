import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { observeMessages, sendMessage } from '@/services/chat/chat.service'
import type { AiError } from '@/services/ai/ai.types'
import type { Message } from '@/types'

interface ThreadState {
  /** Which conversation this state describes. */
  conversationId: string | null
  messages: Message[]
  loading: boolean
  /** True from submit until MARKA's reply lands in the thread. */
  awaitingReply: boolean
  error: string | null
}

export interface UseConversationResult extends Omit<ThreadState, 'conversationId'> {
  send: (text: string) => Promise<void>
}

function emptyThread(conversationId: string | null): ThreadState {
  return {
    conversationId,
    messages: [],
    loading: Boolean(conversationId),
    awaitingReply: false,
    error: null,
  }
}

/**
 * Drives one thread.
 *
 * The user's message and MARKA's reply arrive through the same Firestore
 * subscription, so there is no separate "response" path to keep in sync — the
 * thread is whatever Firestore says it is.
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
        setState((current) => ({
          conversationId,
          messages,
          loading: false,
          // MARKA has answered once the newest turn is hers.
          awaitingReply:
            current.conversationId === conversationId &&
            current.awaitingReply &&
            messages.at(-1)?.role !== 'assistant',
          error: current.conversationId === conversationId ? current.error : null,
        }))
      },
      () => {
        setState((current) => ({
          ...current,
          conversationId,
          loading: false,
          awaitingReply: false,
          error: 'Could not load this conversation.',
        }))
      },
    )

    return unsubscribe
  }, [conversationId])

  const send = useCallback(
    async (text: string) => {
      if (!uid) return

      setState((current) => {
        const base = current.conversationId === conversationId ? current : emptyThread(conversationId)
        return {
          ...base,
          // A brand-new thread flips to the conversation view right away, so
          // the thinking indicator is visible while the reply is generated.
          loading: conversationId ? base.loading : true,
          awaitingReply: true,
          error: null,
        }
      })

      try {
        const outcome = await sendMessage(uid, { conversationId, businessId, text })
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
          const message = describeReplyError(outcome.replyError)
          setState((current) =>
            current.conversationId === settledId || current.conversationId === conversationId
              ? { ...current, conversationId: settledId, awaitingReply: false, error: message }
              : current,
          )
        }
      } catch {
        // The send itself failed, so no navigation happened; the state is
        // still tagged with the id this send started from.
        setState((current) =>
          current.conversationId === conversationId
            ? {
                ...current,
                loading: Boolean(conversationId) && current.loading,
                awaitingReply: false,
                error: 'Your message could not be sent. Please try again.',
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
    error: thread.error,
    send,
  }
}

function describeReplyError(error: AiError): string {
  if (error.code === 'not_configured') {
    return 'MARKA’s AI backend is not connected yet. Your message was saved — deploy the Cloud Functions to get a reply.'
  }
  return error.message
}
