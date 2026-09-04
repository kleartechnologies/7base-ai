import { useCallback, useEffect, useState } from 'react'
import { matchPath, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/app/routes/paths'
import { deleteConversation, observeConversations } from '@/services/chat/chat.service'
import type { Conversation } from '@/types'

interface ListState {
  /** Which account this list belongs to. */
  uid: string | null
  conversations: Conversation[]
  loading: boolean
  error: string | null
}

/**
 * Live conversation list for the sidebar, plus deletion.
 *
 * Like `useConversation`, the state is tagged with the account it describes so
 * a sign-out never briefly shows the previous user's threads, and no effect
 * has to clear state synchronously.
 */
export function useConversations() {
  const { user } = useAuth()
  const navigate = useNavigate()
  // This hook lives in the shell layout, above the chat route, so `useParams`
  // cannot see `:conversationId` — match the location directly instead.
  const { pathname } = useLocation()
  const openId = matchPath(`${ROUTES.chat}/:conversationId`, pathname)?.params.conversationId ?? null
  const uid = user ? user.uid : null

  const [state, setState] = useState<ListState>(() => ({
    uid,
    conversations: [],
    loading: Boolean(uid),
    error: null,
  }))

  const current: ListState =
    state.uid === uid ? state : { uid, conversations: [], loading: Boolean(uid), error: null }

  useEffect(() => {
    if (!uid) return

    const unsubscribe = observeConversations(
      uid,
      (conversations) => {
        setState({ uid, conversations, loading: false, error: null })
      },
      () => {
        setState({
          uid,
          conversations: [],
          loading: false,
          error: 'Could not load your conversations.',
        })
      },
    )

    return unsubscribe
  }, [uid])

  const remove = useCallback(
    async (conversationId: string) => {
      // Not optimistic: the local snapshot cache removes the row the moment
      // the delete is accepted anyway, and a failed delete must not leave the
      // list quietly lying about what still exists.
      try {
        await deleteConversation(conversationId)
      } catch {
        setState((previous) => ({
          ...previous,
          error: 'Could not delete the conversation. Please try again.',
        }))
        return
      }

      if (openId === conversationId) {
        navigate(ROUTES.chat, { replace: true })
      }
    },
    [navigate, openId],
  )

  return {
    conversations: current.conversations,
    loading: current.loading,
    error: current.error,
    remove,
  }
}
