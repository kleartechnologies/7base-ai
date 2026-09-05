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
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import {
  attachmentsCollection,
  conversationDoc,
  conversationsCollection,
  messagesCollection,
} from '@/lib/firebase/collections'
import { deleteAsset } from '@/services/storage/storage.service'
import { fromSnapshot } from '@/lib/firebase/mapper'
import type { Conversation, Message, MessageBlock, SendMessageInput } from '@/types'
import { requestAssistantReply, streamAssistantReply } from '@/services/ai/ai.client'
import type { AiError } from '@/services/ai/ai.types'
import {
  buildAttachmentBlocks,
  createChatAttachments,
} from '@/services/chat/attachment.service'

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

/**
 * How many recent messages the chat view subscribes to. Bounds the read cost
 * and render weight of a long-running thread; far beyond what fits on
 * screen. Extension point: "load older messages" would page backwards from
 * before the oldest loaded `createdAt` with a one-shot query — the live
 * window below stays this size regardless.
 */
export const MESSAGE_WINDOW = 200

export function observeMessages(
  conversationId: string,
  onChange: (messages: Message[]) => void,
  onError?: (error: unknown) => void,
  max = MESSAGE_WINDOW,
): () => void {
  return onSnapshot(
    // Newest-first with a limit, then restored to chronological order —
    // ascending + limit would pin the window to the *oldest* messages and
    // new turns would never appear.
    query(messagesCollection(conversationId), orderBy('createdAt', 'desc'), fbLimit(max)),
    (snapshot) => onChange(snapshot.docs.map((d) => fromSnapshot<Message>(d)).reverse()),
    (error) => onError?.(error),
  )
}

export async function renameConversation(conversationId: string, title: string): Promise<void> {
  await updateDoc(conversationDoc(conversationId), { title, updatedAt: Date.now() })
}

/**
 * Deletes a conversation, its messages and its attachments.
 *
 * Firestore does not cascade, so children are removed first; a client-side
 * loop is acceptable at foundation scale and should move to a Cloud Function
 * once threads grow long. Uploaded attachment files are deleted best-effort
 * — an orphaned file costs quota, not correctness — and Asset-referenced
 * attachments never touch the Asset's own file.
 */
export async function deleteConversation(conversationId: string): Promise<void> {
  const [messages, attachments] = await Promise.all([
    getDocs(messagesCollection(conversationId)),
    getDocs(attachmentsCollection(conversationId)),
  ])
  await Promise.all(
    attachments.docs.map(async (a) => {
      const data = a.data()
      if (data.source === 'upload') {
        try {
          await deleteAsset(data.storagePath)
        } catch {
          // Best-effort only; the document delete below is what matters.
        }
      }
      await deleteDoc(a.ref)
    }),
  )
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
 * The user message is stored first, then the reply is requested and awaited.
 * When `onAssistantDelta` is given, the reply is requested as a stream and
 * each piece of EVA's text is forwarded as it is generated — the finished
 * assistant message still lands through the `observeMessages` subscription,
 * written once, server-side, exactly as on the non-streamed path.
 *
 * `onUserMessageStored` fires the moment the user's message is durably in
 * Firestore — before the reply is requested, which can take tens of seconds.
 * It carries the conversation id (freshly created on a first send), so the
 * UI can attach its subscription and render the stored message immediately
 * instead of waiting out the whole generation.
 */
export async function sendMessage(
  ownerId: string,
  input: SendMessageInput,
  onAssistantDelta?: (text: string) => void,
  onUserMessageStored?: (conversationId: string) => void,
): Promise<SendMessageOutcome> {
  const text = input.text.trim()
  const drafts = input.attachments ?? []
  if (!text && drafts.length === 0) {
    throw new Error('Cannot send an empty message.')
  }
  if (drafts.length > 0 && !input.businessId) {
    // Attachment paths and documents are business-scoped; without a business
    // there is nowhere authorised to put the file.
    throw new Error('Set up your business before attaching files.')
  }

  let conversationId = input.conversationId
  if (!conversationId) {
    const conversation = await createConversation(
      ownerId,
      input.businessId,
      deriveTitle(text || drafts.map(draftFileName).join(', ')),
    )
    conversationId = conversation.id
  }

  // The message id is reserved before anything is written, so attachment
  // documents carry their messageId from birth and the message itself never
  // needs a mutating follow-up write.
  const newMessageRef = doc(messagesCollection(conversationId))

  // Attachments first: if any of them fails, nothing is sent — a message may
  // never reference an attachment that does not exist.
  const attachments =
    drafts.length > 0
      ? await createChatAttachments({
          ownerId,
          businessId: input.businessId as string,
          conversationId,
          messageId: newMessageRef.id,
          drafts,
        })
      : []

  // A send with only attachments still needs prose for previews, titles and
  // the model's text channel — a deterministic line, never an invented one.
  const plainText = text || `(attached: ${attachments.map((a) => a.fileName).join(', ')})`

  const blocks: MessageBlock[] = [
    ...(text ? [{ id: 'b0', type: 'text' as const, text }] : []),
    ...buildAttachmentBlocks(attachments, text ? 1 : 0),
  ]

  const now = Date.now()
  const message: Omit<Message, 'id'> = {
    ownerId,
    conversationId,
    role: 'user',
    blocks,
    plainText,
    status: 'complete',
    meta: null,
    createdAt: now,
    updatedAt: now,
  }

  await setDoc(newMessageRef, message)

  // Every message write — here and in each Cloud Function that writes an
  // assistant turn — bumps `messageCount` with the same atomic increment, so
  // the counter stays correct however the writes interleave.
  await updateDoc(conversationDoc(conversationId), {
    lastMessagePreview: plainText.slice(0, 140),
    messageCount: increment(1),
    updatedAt: now,
  })

  // From here the thread exists whatever happens to the reply below. Report
  // it now: whoever is waiting can show the message and survive a refresh.
  onUserMessageStored?.(conversationId)

  const replyRequest = {
    conversationId,
    businessId: input.businessId,
    userMessageId: newMessageRef.id,
  }
  const reply = onAssistantDelta
    ? await streamAssistantReply(replyRequest, onAssistantDelta)
    : await requestAssistantReply(replyRequest)

  return {
    conversationId,
    userMessageId: newMessageRef.id,
    replyError: reply.ok ? null : reply.error,
  }
}

function draftFileName(draft: NonNullable<SendMessageInput['attachments']>[number]): string {
  return draft.kind === 'file' ? draft.file.name : draft.asset.fileName
}

/** Escape hatch for callers that need a raw message ref (e.g. retry). */
export const messageRef = (conversationId: string, messageId: string) =>
  doc(messagesCollection(conversationId), messageId)
