import {
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  increment,
  limit as fbLimit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import {
  conversationDoc,
  conversationsCollection,
  messagesCollection,
} from '@/lib/firebase/collections'
import { fromSnapshot } from '@/lib/firebase/mapper'
import type { Conversation, Message, SendMessageInput } from '@/types'
import { requestAssistantReply } from '@/services/ai/ai.client'
import type { AiError } from '@/services/ai/ai.types'

/**
 * Chat persistence and the client half of the AI round trip.
 *
 * The split of responsibility is deliberate:
 *  - the client writes the *user* message, so it appears instantly
 *  - the backend writes the *assistant* message, so prompts and API keys
 *    never reach the browser
 *
 * Firestore rules enforce this — a client write with `role: 'assistant'` is
 * rejected. The UI never polls; it subscribes with `onSnapshot` and the
 * assistant reply simply arrives.
 */

const TITLE_MAX_LENGTH = 60

function deriveTitle(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  if (clean.length <= TITLE_MAX_LENGTH) return clean || 'New conversation'
  return `${clean.slice(0, TITLE_MAX_LENGTH).trimEnd()}…`
}

export async function createConversation(
  ownerId: string,
  businessId: string | null,
  title: string,
): Promise<Conversation> {
  const now = Date.now()
  const data: Omit<Conversation, 'id'> = {
    ownerId,
    businessId,
    title,
    lastMessagePreview: null,
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
  }
  const ref = await addDoc(conversationsCollection(), data)
  return { id: ref.id, ...data }
}

export function observeConversations(
  ownerId: string,
  onChange: (conversations: Conversation[]) => void,
  onError?: (error: unknown) => void,
  max = 50,
): () => void {
  return onSnapshot(
    query(
      conversationsCollection(),
      where('ownerId', '==', ownerId),
      orderBy('updatedAt', 'desc'),
      fbLimit(max),
    ),
    (snapshot) => onChange(snapshot.docs.map((d) => fromSnapshot<Conversation>(d))),
    (error) => onError?.(error),
  )
}

export function observeMessages(
  conversationId: string,
  onChange: (messages: Message[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    query(messagesCollection(conversationId), orderBy('createdAt', 'asc')),
    (snapshot) => onChange(snapshot.docs.map((d) => fromSnapshot<Message>(d))),
    (error) => onError?.(error),
  )
}

export async function renameConversation(conversationId: string, title: string): Promise<void> {
  await updateDoc(conversationDoc(conversationId), { title, updatedAt: Date.now() })
}

/**
 * Deletes a conversation and its messages.
 *
 * Firestore does not cascade, so messages are removed first; a client-side
 * loop is acceptable at foundation scale and should move to a Cloud Function
 * once threads grow long.
 */
export async function deleteConversation(conversationId: string): Promise<void> {
  const messages = await getDocs(messagesCollection(conversationId))
  await Promise.all(messages.docs.map((m) => deleteDoc(m.ref)))
  await deleteDoc(conversationDoc(conversationId))
}

export interface SendMessageOutcome {
  conversationId: string
  userMessageId: string
  /**
   * Set when the reply could not be requested. The user's message is still
   * stored — only MARKA's answer is missing — so the UI shows this inline in
   * the thread with a retry, rather than discarding what was typed.
   */
  replyError: AiError | null
}

/**
 * Writes the user's message, then asks the backend for a reply.
 *
 * Resolves as soon as the user message is stored. The assistant reply lands
 * separately through the `observeMessages` subscription.
 */
export async function sendMessage(
  ownerId: string,
  input: SendMessageInput,
): Promise<SendMessageOutcome> {
  const text = input.text.trim()
  if (!text) {
    throw new Error('Cannot send an empty message.')
  }

  let conversationId = input.conversationId
  if (!conversationId) {
    const conversation = await createConversation(ownerId, input.businessId, deriveTitle(text))
    conversationId = conversation.id
  }

  const now = Date.now()
  const message: Omit<Message, 'id'> = {
    ownerId,
    conversationId,
    role: 'user',
    blocks: [{ id: 'b0', type: 'text', text }],
    plainText: text,
    status: 'complete',
    meta: null,
    createdAt: now,
    updatedAt: now,
  }

  const ref = await addDoc(messagesCollection(conversationId), message)

  // Every message write — here and in each Cloud Function that writes an
  // assistant turn — bumps `messageCount` with the same atomic increment, so
  // the counter stays correct however the writes interleave.
  await updateDoc(conversationDoc(conversationId), {
    lastMessagePreview: text.slice(0, 140),
    messageCount: increment(1),
    updatedAt: now,
  })

  const reply = await requestAssistantReply({
    conversationId,
    businessId: input.businessId,
    userMessageId: ref.id,
  })

  return {
    conversationId,
    userMessageId: ref.id,
    replyError: reply.ok ? null : reply.error,
  }
}

/** Escape hatch for callers that need a raw message ref (e.g. retry). */
export const messageRef = (conversationId: string, messageId: string) =>
  doc(messagesCollection(conversationId), messageId)
