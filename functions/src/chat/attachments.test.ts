import { describe, expect, it } from 'vitest'

import type { AttachmentBlock, StoredMessage } from '../lib/types'
import {
  buildAttachmentParts,
  buildUnavailableNote,
  collectAttachmentBlocks,
  MAX_AI_ATTACHMENT_BYTES,
  resolveAttachmentInput,
  type AttachmentInputDeps,
  type StoredAttachment,
} from './attachments'

/**
 * The server side of multimodal input. Everything here runs on injected
 * fakes — no Firestore, no Storage, no model. What is under test is the
 * trust boundary: only re-verified, owner-matched, size-checked attachments
 * become model input, and everything else is skipped with an honest reason
 * rather than failing the reply or letting the model guess.
 */

const UID = 'user1'
const CONVO = 'convo1'

function attachment(overrides: Partial<StoredAttachment> = {}): StoredAttachment {
  return {
    ownerId: UID,
    businessId: 'biz1',
    conversationId: CONVO,
    messageId: 'msg1',
    fileName: 'photo.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 2048,
    storagePath: 'businesses/biz1/conversations/convo1/attachments/att1_photo.jpg',
    source: 'upload',
    status: 'active',
    assetId: null,
    createdAt: 1,
    ...overrides,
  }
}

function block(overrides: Partial<AttachmentBlock> = {}): AttachmentBlock {
  return {
    id: 'b1',
    type: 'attachment',
    attachmentId: 'att1',
    fileName: 'photo.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 2048,
    storagePath: 'businesses/biz1/conversations/convo1/attachments/att1_photo.jpg',
    assetId: null,
    ...overrides,
  }
}

function makeDeps(
  attachments: Record<string, StoredAttachment>,
  bytes: Record<string, Buffer> = {},
): { deps: AttachmentInputDeps; downloads: string[] } {
  const downloads: string[] = []
  return {
    downloads,
    deps: {
      getAttachment: async (_conversationId, attachmentId) =>
        attachments[attachmentId] ?? null,
      downloadBytes: async (storagePath) => {
        downloads.push(storagePath)
        const data = bytes[storagePath]
        if (!data) throw new Error('object missing')
        return data
      },
    },
  }
}

function message(blocks: StoredMessage['blocks']): StoredMessage {
  return {
    ownerId: UID,
    conversationId: CONVO,
    role: 'user',
    blocks,
    plainText: 'look at this',
    status: 'complete',
    meta: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('collectAttachmentBlocks', () => {
  it('extracts only attachment blocks', () => {
    const found = collectAttachmentBlocks(
      message([{ id: 'b0', type: 'text', text: 'hi' }, block()]),
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.attachmentId).toBe('att1')
  })

  it('caps at three even when a message carries more blocks', () => {
    const many = [1, 2, 3, 4, 5].map((n) =>
      block({ id: `b${n}`, attachmentId: `att${n}` }),
    )
    expect(collectAttachmentBlocks(message(many))).toHaveLength(3)
  })
})

describe('buildAttachmentParts', () => {
  it('turns an owned image into a base64 input_image built from Storage bytes', async () => {
    const stored = attachment()
    const { deps } = makeDeps(
      { att1: stored },
      { [stored.storagePath]: Buffer.from('image-bytes') },
    )
    const result = await buildAttachmentParts({ uid: UID, conversationId: CONVO, blocks: [block()] }, deps)

    expect(result.skipped).toEqual([])
    expect(result.parts).toEqual([
      {
        type: 'input_image',
        imageUrl: `data:image/jpeg;base64,${Buffer.from('image-bytes').toString('base64')}`,
      },
    ])
  })

  it('turns an owned PDF into an input_file part with its filename', async () => {
    const stored = attachment({
      fileName: 'menu.pdf',
      contentType: 'application/pdf',
      storagePath: 'businesses/biz1/conversations/convo1/attachments/att1_menu.pdf',
    })
    const { deps } = makeDeps(
      { att1: stored },
      { [stored.storagePath]: Buffer.from('%PDF-1.4') },
    )
    const result = await buildAttachmentParts(
      { uid: UID, conversationId: CONVO, blocks: [block({ contentType: 'application/pdf' })] },
      deps,
    )

    expect(result.parts).toEqual([
      {
        type: 'input_file',
        filename: 'menu.pdf',
        fileData: `data:application/pdf;base64,${Buffer.from('%PDF-1.4').toString('base64')}`,
      },
    ])
  })

  it('skips another user’s attachment without downloading it', async () => {
    const { deps, downloads } = makeDeps({ att1: attachment({ ownerId: 'intruder' }) })
    const result = await buildAttachmentParts({ uid: UID, conversationId: CONVO, blocks: [block()] }, deps)
    expect(result.parts).toEqual([])
    expect(result.skipped).toEqual([{ fileName: 'photo.jpg', reason: 'unavailable' }])
    expect(downloads).toEqual([])
  })

  it('skips an attachment recorded against a different conversation', async () => {
    const { deps } = makeDeps({ att1: attachment({ conversationId: 'other' }) })
    const result = await buildAttachmentParts({ uid: UID, conversationId: CONVO, blocks: [block()] }, deps)
    expect(result.skipped).toEqual([{ fileName: 'photo.jpg', reason: 'unavailable' }])
  })

  it('skips a deleted attachment and a missing document identically', async () => {
    const { deps } = makeDeps({ att1: attachment({ status: 'deleted' }) })
    const deleted = await buildAttachmentParts({ uid: UID, conversationId: CONVO, blocks: [block()] }, deps)
    const missing = await buildAttachmentParts(
      { uid: UID, conversationId: CONVO, blocks: [block({ attachmentId: 'ghost' })] },
      makeDeps({}).deps,
    )
    expect(deleted.skipped).toEqual(missing.skipped)
  })

  it('skips an unsupported type without downloading', async () => {
    const { deps, downloads } = makeDeps({
      att1: attachment({ contentType: 'image/gif', fileName: 'anim.gif' }),
    })
    const result = await buildAttachmentParts({ uid: UID, conversationId: CONVO, blocks: [block()] }, deps)
    expect(result.skipped).toEqual([{ fileName: 'anim.gif', reason: 'unsupported_type' }])
    expect(downloads).toEqual([])
  })

  it('skips an attachment whose claimed size exceeds the AI limit, without downloading', async () => {
    const { deps, downloads } = makeDeps({
      att1: attachment({ sizeBytes: MAX_AI_ATTACHMENT_BYTES + 1 }),
    })
    const result = await buildAttachmentParts({ uid: UID, conversationId: CONVO, blocks: [block()] }, deps)
    expect(result.skipped).toEqual([{ fileName: 'photo.jpg', reason: 'too_large' }])
    expect(downloads).toEqual([])
  })

  it('re-checks the real downloaded size — a lying sizeBytes does not smuggle bytes in', async () => {
    const stored = attachment({ sizeBytes: 10 })
    const { deps } = makeDeps(
      { att1: stored },
      { [stored.storagePath]: Buffer.alloc(MAX_AI_ATTACHMENT_BYTES + 1) },
    )
    const result = await buildAttachmentParts({ uid: UID, conversationId: CONVO, blocks: [block()] }, deps)
    expect(result.parts).toEqual([])
    expect(result.skipped).toEqual([{ fileName: 'photo.jpg', reason: 'too_large' }])
  })

  it('skips a forged record pointing outside its own business, without downloading — victim bytes never reach the model', async () => {
    // The Phase 6H F1 shape: an attacker who controls a business whose
    // document id is a regex metacharacter string forges an attachment doc
    // whose storagePath aims at a victim's namespace. The literal-prefix
    // guard must refuse it before any Storage read.
    const forged = attachment({
      businessId: '.*',
      storagePath: 'businesses/victimBiz/assets/1000_secret-menu.jpg',
    })
    const { deps, downloads } = makeDeps(
      { att1: forged },
      { [forged.storagePath]: Buffer.from('victim-bytes') },
    )
    const result = await buildAttachmentParts(
      { uid: UID, conversationId: CONVO, blocks: [block()] },
      deps,
    )
    expect(result.parts).toEqual([])
    expect(result.skipped).toEqual([{ fileName: 'photo.jpg', reason: 'unavailable' }])
    expect(downloads).toEqual([])
  })

  it('a metacharacter businessId grants only its own literal namespace, nothing regex-shaped', async () => {
    // Owning business `.*` is legitimate; it must scope you to the literal
    // folder `businesses/.*/…` and nowhere else.
    const literal = attachment({
      businessId: '.*',
      storagePath: 'businesses/.*/conversations/convo1/attachments/att1_photo.jpg',
    })
    const { deps } = makeDeps(
      { att1: literal },
      { [literal.storagePath]: Buffer.from('own-bytes') },
    )
    const result = await buildAttachmentParts(
      { uid: UID, conversationId: CONVO, blocks: [block()] },
      deps,
    )
    expect(result.skipped).toEqual([])
    expect(result.parts).toHaveLength(1)
  })

  it('reports a failed retrieval as unavailable and keeps analysing the rest', async () => {
    const good = attachment({
      fileName: 'ok.png',
      contentType: 'image/png',
      storagePath: 'businesses/biz1/conversations/convo1/attachments/att2_ok.png',
    })
    const { deps } = makeDeps(
      { att1: attachment(), att2: good },
      { [good.storagePath]: Buffer.from('png') },
    )
    const result = await buildAttachmentParts(
      {
        uid: UID,
        conversationId: CONVO,
        blocks: [
          block(),
          block({ id: 'b2', attachmentId: 'att2', fileName: 'ok.png', contentType: 'image/png' }),
        ],
      },
      deps,
    )
    expect(result.skipped).toEqual([{ fileName: 'photo.jpg', reason: 'unavailable' }])
    expect(result.parts).toHaveLength(1)
  })
})

describe('resolveAttachmentInput', () => {
  it('returns nothing for a message with no attachment blocks — the text-only path', async () => {
    let touched = false
    const deps: AttachmentInputDeps = {
      getAttachment: async () => {
        touched = true
        return null
      },
      downloadBytes: async () => {
        touched = true
        return Buffer.alloc(0)
      },
    }
    const result = await resolveAttachmentInput(
      { uid: UID, conversationId: CONVO, message: message([{ id: 'b0', type: 'text', text: 'hi' }]) },
      deps,
    )
    expect(result).toEqual({ parts: [], skipped: [] })
    expect(touched).toBe(false)
  })

  it('never throws — an unexpected failure downgrades every attachment to skipped', async () => {
    const deps = {
      getAttachment: () => {
        throw new Error('sync explosion')
      },
      downloadBytes: async () => Buffer.alloc(0),
    } as unknown as AttachmentInputDeps
    const result = await resolveAttachmentInput(
      { uid: UID, conversationId: CONVO, message: message([block()]) },
      deps,
    )
    expect(result.parts).toEqual([])
    expect(result.skipped).toEqual([{ fileName: 'photo.jpg', reason: 'unavailable' }])
  })
})

describe('buildUnavailableNote', () => {
  it('is null when nothing was skipped', () => {
    expect(buildUnavailableNote([])).toBeNull()
  })

  it('names the files and forbids inferring their contents', () => {
    const note = buildUnavailableNote([
      { fileName: 'photo.jpg', reason: 'too_large' },
      { fileName: 'menu.pdf', reason: 'unavailable' },
    ])
    expect(note).toContain('photo.jpg, menu.pdf')
    expect(note).toContain('Do not infer')
    expect(note).toContain('could not be analysed')
  })
})
