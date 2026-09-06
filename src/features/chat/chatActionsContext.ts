import { createContext, useContext } from 'react'

/**
 * What a card inside the thread may do: send one ordinary chat message on
 * the owner's behalf. That is the whole surface — a proposal's Yes button
 * and a campaign choice are chat messages the server interprets against the
 * conversation, exactly as if the owner had typed them. No id, plan or model
 * ever travels from a card to the backend.
 */
export interface ChatActions {
  sendQuickReply: (text: string) => void
  /** True while a reply is awaited — buttons wait rather than double-send. */
  busy: boolean
}

export const ChatActionsContext = createContext<ChatActions | null>(null)

export function useChatActions(): ChatActions | null {
  return useContext(ChatActionsContext)
}
