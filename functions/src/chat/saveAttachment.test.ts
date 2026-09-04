import { describe, expect, it } from 'vitest'
import { HttpsError } from 'firebase-functions/v2/https'

import type { StoredAsset } from '../creative/assets'
import { performSaveAttachmentToAssets, type SaveAttachmentDeps } from './saveAttachment'
import type { StoredAttachment } from './attachments'

/**
 * "Save to Assets" — the server-side copy that turns conversational context
 * into a permanent business Asset. Driven on fakes: what is under test is
 * ownership enforcement, the independence of the copy, the deterministic
 * Asset schema, and idempotency.
 */

const UID = 'user1'
const CONVO = 'convo1'

function attachment(overrides: Partial<StoredAttachment> = {}): StoredAttachment {
  return {
    ownerId: UID,
    businessId: 'biz1',
    conversationId: CONVO,
    messageId: 'msg1',
    fileName: 'shop front.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 2048,
    storagePath: 'businesses/biz1/conversations/convo1/attachments/att1_shop_front.jpg',
    source: 'upload',
    status: 'active',
    assetId: null,
    createdAt: 1,
    ...overrides,
  }
}

interface Recorded {
  copies: { from: string; to: string }[]
  assets: StoredAsset[]
  backrefs: { conversationId: string; attachmentId: string; assetId: string }[]
  conversationChecks: string[]
  businessChecks: string[]
}

function makeDeps(
  stored: StoredAttachment | null,
  overrides: Partial<SaveAttachmentDeps> = {},
): { deps: SaveAttachmentDeps; recorded: Recorded } {
  const recorded: Recorded = {
    copies: [],
    assets: [],
    backrefs: [],
    conversationChecks: [],
    businessChecks: [],
  }
  const deps: SaveAttachmentDeps = {
    requireConversationOwner: async (conversationId) => {
      recorded.conversationChecks.push(conversationId)
      return { ownerId: UID }
    },
    requireBusinessOwner: async (businessId) => {
      recorded.businessChecks.push(businessId)
      return { ownerId: UID }
    },
    getAttachment: async () => stored,
    copyFile: async (from, to) => {
      recorded.copies.push({ from, to })
    },
    createAssetDoc: async (asset) => {
      recorded.assets.push(asset)
      return 'newAsset1'
    },
    setAttachmentAssetId: async (conversationId, attachmentId, assetId) => {
      recorded.backrefs.push({ conversationId, attachmentId, assetId })
    },
    ...overrides,
  }
  return { deps, recorded }
}

const PARAMS = { uid: UID, conversationId: CONVO, attachmentId: 'att1' }

describe('performSaveAttachmentToAssets — the copy', () => {
  it('copies into the Assets namespace as an independent object and returns the new id', async () => {
    const { deps, recorded } = makeDeps(attachment())
    const result = await performSaveAttachmentToAssets(PARAMS, deps)

    expect(result).toEqual({ assetId: 'newAsset1' })
    expect(recorded.copies).toHaveLength(1)
    const copy = recorded.copies[0]!
    expect(copy.from).toBe(attachment().storagePath)
    expect(copy.to).toMatch(/^businesses\/biz1\/assets\/\d+_shop_front\.jpg$/)
    expect(copy.to).not.toBe(copy.from)
    expect(recorded.backrefs).toEqual([
      { conversationId: CONVO, attachmentId: 'att1', assetId: 'newAsset1' },
    ])
  })

  it('creates the Asset with the deterministic upload-default schema — no AI metadata', async () => {
    const { deps, recorded } = makeDeps(attachment())
    await performSaveAttachmentToAssets(PARAMS, deps)

    expect(recorded.assets[0]).toMatchObject({
      ownerId: UID,
      businessId: 'biz1',
      type: 'photo',
      name: 'shop front',
      fileName: 'shop front.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
      productId: null,
      description: null,
      tags: [],
      source: 'upload',
      status: 'active',
      allowAiUse: true,
    })
    expect(recorded.assets[0]!.storagePath).toBe(recorded.copies[0]!.to)
  })

  it('saves a PDF as a document-type Asset', async () => {
    const { deps, recorded } = makeDeps(
      attachment({ fileName: 'menu.pdf', contentType: 'application/pdf' }),
    )
    await performSaveAttachmentToAssets(PARAMS, deps)
    expect(recorded.assets[0]).toMatchObject({ type: 'document', name: 'menu' })
  })

  it('still succeeds when the best-effort back-reference write fails', async () => {
    const { deps } = makeDeps(attachment(), {
      setAttachmentAssetId: async () => {
        throw new Error('update refused')
      },
    })
    await expect(performSaveAttachmentToAssets(PARAMS, deps)).resolves.toEqual({
      assetId: 'newAsset1',
    })
  })

  it('surfaces a copy failure as failed-precondition and creates no Asset document', async () => {
    const { deps, recorded } = makeDeps(attachment(), {
      copyFile: async () => {
        throw new Error('source object missing')
      },
    })
    await expect(performSaveAttachmentToAssets(PARAMS, deps)).rejects.toMatchObject({
      code: 'failed-precondition',
    })
    expect(recorded.assets).toEqual([])
    expect(recorded.backrefs).toEqual([])
  })
})

describe('performSaveAttachmentToAssets — idempotency', () => {
  it('returns the existing assetId without copying when the attachment already has one', async () => {
    const { deps, recorded } = makeDeps(attachment({ assetId: 'already' }))
    const result = await performSaveAttachmentToAssets(PARAMS, deps)
    expect(result).toEqual({ assetId: 'already' })
    expect(recorded.copies).toEqual([])
    expect(recorded.assets).toEqual([])
  })

  it('treats an Asset-sourced attachment the same way — never a second copy', async () => {
    const { deps, recorded } = makeDeps(
      attachment({
        source: 'asset',
        assetId: 'libraryAsset',
        storagePath: 'businesses/biz1/assets/123_logo.png',
      }),
    )
    const result = await performSaveAttachmentToAssets(PARAMS, deps)
    expect(result).toEqual({ assetId: 'libraryAsset' })
    expect(recorded.copies).toEqual([])
  })
})

describe('performSaveAttachmentToAssets — ownership', () => {
  it('rejects a conversation the caller does not own before reading anything', async () => {
    let read = false
    const { deps } = makeDeps(attachment(), {
      requireConversationOwner: async () => {
        throw new HttpsError('permission-denied', 'denied')
      },
      getAttachment: async () => {
        read = true
        return attachment()
      },
    })
    await expect(performSaveAttachmentToAssets(PARAMS, deps)).rejects.toMatchObject({
      code: 'permission-denied',
    })
    expect(read).toBe(false)
  })

  it('rejects an attachment owned by someone else, and one from another conversation', async () => {
    for (const stored of [
      attachment({ ownerId: 'intruder' }),
      attachment({ conversationId: 'otherConvo' }),
      attachment({ status: 'deleted' as const }),
      null,
    ]) {
      const { deps, recorded } = makeDeps(stored)
      await expect(performSaveAttachmentToAssets(PARAMS, deps)).rejects.toMatchObject({
        code: 'permission-denied',
      })
      expect(recorded.copies).toEqual([])
    }
  })

  it('verifies the business on the attachment — never one the client names', async () => {
    const { deps, recorded } = makeDeps(attachment({ businessId: 'bizFromDoc' }))
    await performSaveAttachmentToAssets(PARAMS, deps)
    expect(recorded.businessChecks).toEqual(['bizFromDoc'])
  })

  it('rejects when the attachment’s business no longer resolves to the caller', async () => {
    const { deps, recorded } = makeDeps(attachment(), {
      requireBusinessOwner: async () => null,
    })
    await expect(performSaveAttachmentToAssets(PARAMS, deps)).rejects.toMatchObject({
      code: 'permission-denied',
    })
    expect(recorded.copies).toEqual([])
  })
})
