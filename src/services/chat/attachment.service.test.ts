import { describe, expect, it } from 'vitest'
import {
  buildAttachmentBlocks,
  createChatAttachments,
  type AttachmentPersistenceDeps,
} from './attachment.service'
import type { AttachmentDraft, ChatAttachment } from '@/types'

/**
 * The persistence flow, driven entirely through injected deps — no Firebase.
 * What is under test is the *order and cleanup discipline*: Storage before
 * document, no dangling documents, all-or-nothing batches, and Asset
 * references never touching the Asset's own file.
 */

const PARAMS = {
  ownerId: 'user1',
  businessId: 'biz1',
  conversationId: 'convo1',
  messageId: 'msg1',
}

function fileDraft(name = 'photo.jpg', type = 'image/jpeg', size = 2048): AttachmentDraft {
  return { kind: 'file', file: { name, type, size } as File }
}

function assetDraft(id = 'asset1'): AttachmentDraft {
  return {
    kind: 'asset',
    asset: {
      id,
      fileName: 'logo.png',
      contentType: 'image/png',
      sizeBytes: 512,
      storagePath: `businesses/biz1/assets/123_logo.png`,
    },
  }
}

interface Recorded {
  log: string[]
  docs: Map<string, Omit<ChatAttachment, 'id'>>
  files: Set<string>
}

function makeDeps(
  overrides: Partial<AttachmentPersistenceDeps> = {},
): { deps: AttachmentPersistenceDeps; recorded: Recorded } {
  let nextId = 0
  const recorded: Recorded = { log: [], docs: new Map(), files: new Set() }
  const deps: AttachmentPersistenceDeps = {
    newAttachmentId: () => `att${++nextId}`,
    uploadFile: async (storagePath) => {
      recorded.log.push(`upload:${storagePath}`)
      recorded.files.add(storagePath)
    },
    setAttachmentDoc: async (_conversationId, attachmentId, data) => {
      recorded.log.push(`doc:${attachmentId}`)
      recorded.docs.set(attachmentId, data)
    },
    deleteAttachmentDoc: async (_conversationId, attachmentId) => {
      recorded.log.push(`deleteDoc:${attachmentId}`)
      recorded.docs.delete(attachmentId)
    },
    deleteFile: async (storagePath) => {
      recorded.log.push(`deleteFile:${storagePath}`)
      recorded.files.delete(storagePath)
    },
    ...overrides,
  }
  return { deps, recorded }
}

describe('createChatAttachments — uploads', () => {
  it('uploads to Storage before creating the document, then links both to the message', async () => {
    const { deps, recorded } = makeDeps()
    const [attachment] = await createChatAttachments(
      { ...PARAMS, drafts: [fileDraft('my photo.jpg')] },
      deps,
    )

    expect(recorded.log[0]).toMatch(/^upload:/)
    expect(recorded.log[1]).toBe('doc:att1')
    expect(attachment).toMatchObject({
      id: 'att1',
      ownerId: 'user1',
      businessId: 'biz1',
      conversationId: 'convo1',
      messageId: 'msg1',
      fileName: 'my photo.jpg',
      contentType: 'image/jpeg',
      source: 'upload',
      status: 'active',
      assetId: null,
    })
    expect(attachment!.storagePath).toBe(
      'businesses/biz1/conversations/convo1/attachments/att1_my_photo.jpg',
    )
  })

  it('rejects an invalid file before anything is written', async () => {
    const { deps, recorded } = makeDeps()
    await expect(
      createChatAttachments(
        { ...PARAMS, drafts: [fileDraft('logo.svg', 'image/svg+xml')] },
        deps,
      ),
    ).rejects.toThrow(/SVG/)
    expect(recorded.log).toEqual([])
  })

  it('removes the uploaded file when the document write fails — never a dangling document', async () => {
    const { deps, recorded } = makeDeps({
      setAttachmentDoc: async () => {
        throw new Error('firestore down')
      },
    })
    await expect(
      createChatAttachments({ ...PARAMS, drafts: [fileDraft()] }, deps),
    ).rejects.toThrow('firestore down')
    expect(recorded.files.size).toBe(0)
    expect(recorded.docs.size).toBe(0)
    expect(recorded.log.some((entry) => entry.startsWith('deleteFile:'))).toBe(true)
  })

  it('cleans up earlier attachments when a later one in the batch fails', async () => {
    let uploads = 0
    const { deps, recorded } = makeDeps({
      uploadFile: async (storagePath) => {
        uploads += 1
        if (uploads === 2) throw new Error('storage down')
        recorded.log.push(`upload:${storagePath}`)
        recorded.files.add(storagePath)
      },
    })
    await expect(
      createChatAttachments({ ...PARAMS, drafts: [fileDraft('a.jpg'), fileDraft('b.jpg')] }, deps),
    ).rejects.toThrow('storage down')
    expect(recorded.docs.size).toBe(0)
    expect(recorded.files.size).toBe(0)
  })

  it('refuses more than three attachments before touching Storage', async () => {
    const { deps, recorded } = makeDeps()
    await expect(
      createChatAttachments(
        { ...PARAMS, drafts: [fileDraft(), fileDraft(), fileDraft(), fileDraft()] },
        deps,
      ),
    ).rejects.toThrow(/at most 3/)
    expect(recorded.log).toEqual([])
  })
})

describe('createChatAttachments — Asset references', () => {
  it('references the Asset without uploading anything, keeping its storage path', async () => {
    const { deps, recorded } = makeDeps()
    const [attachment] = await createChatAttachments(
      { ...PARAMS, drafts: [assetDraft('assetX')] },
      deps,
    )
    expect(recorded.log).toEqual(['doc:att1'])
    expect(attachment).toMatchObject({
      source: 'asset',
      assetId: 'assetX',
      storagePath: 'businesses/biz1/assets/123_logo.png',
      fileName: 'logo.png',
    })
  })

  it('never deletes the Asset file when cleanup runs', async () => {
    let docs = 0
    const { deps, recorded } = makeDeps({
      setAttachmentDoc: async (_conversationId, attachmentId, data) => {
        docs += 1
        if (docs === 2) throw new Error('firestore down')
        recorded.log.push(`doc:${attachmentId}`)
        recorded.docs.set(attachmentId, data)
      },
    })
    await expect(
      createChatAttachments({ ...PARAMS, drafts: [assetDraft(), fileDraft()] }, deps),
    ).rejects.toThrow()
    // The Asset reference's document was cleaned up, but no deleteFile ever
    // targeted the Asset's own bytes.
    expect(recorded.log).toContain('deleteDoc:att1')
    expect(
      recorded.log.filter((entry) => entry === 'deleteFile:businesses/biz1/assets/123_logo.png'),
    ).toEqual([])
  })
})

describe('buildAttachmentBlocks', () => {
  const attachment: ChatAttachment = {
    id: 'att9',
    ownerId: 'user1',
    businessId: 'biz1',
    conversationId: 'convo1',
    messageId: 'msg1',
    fileName: 'menu.pdf',
    contentType: 'application/pdf',
    sizeBytes: 900,
    storagePath: 'businesses/biz1/conversations/convo1/attachments/att9_menu.pdf',
    source: 'upload',
    status: 'active',
    assetId: null,
    createdAt: 1,
  }

  it('continues the block numbering after the text block', () => {
    const blocks = buildAttachmentBlocks([attachment, { ...attachment, id: 'att10' }], 1)
    expect(blocks.map((block) => block.id)).toEqual(['b1', 'b2'])
    expect(blocks[0]).toMatchObject({
      type: 'attachment',
      attachmentId: 'att9',
      fileName: 'menu.pdf',
      contentType: 'application/pdf',
      sizeBytes: 900,
      storagePath: attachment.storagePath,
      assetId: null,
    })
  })

  it('starts at b0 for an attachment-only message', () => {
    expect(buildAttachmentBlocks([attachment], 0)[0]!.id).toBe('b0')
  })
})
