import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Chat attachments' wiring across module boundaries. Vitest runs in a node
 * environment with no DOM, so the UI checks here are source-level: they pin
 * that the composer, the block renderer and the callable client are actually
 * connected — the seams a refactor could silently drop.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('composer wiring', () => {
  const composer = read('./components/ChatComposer.tsx')

  it('has the attach button and the hidden validated file input', () => {
    expect(composer).toContain('aria-label="Attach a file"')
    expect(composer).toContain('ATTACHMENT_FILE_ACCEPT')
    expect(composer).toContain('validateAttachmentFile')
  })

  it('enforces the per-message maximum in the UI', () => {
    expect(composer).toContain('MAX_ATTACHMENTS_PER_MESSAGE')
  })

  it('lets a pending attachment be removed before send', () => {
    expect(composer).toContain('removePending')
    expect(composer).toContain('aria-label={`Remove ${item.fileName}`}')
  })

  it('offers Choose-from-Assets, filtered to what rules would accept', () => {
    expect(composer).toContain('observeAssets')
    expect(composer).toContain("asset.status === 'active'")
    expect(composer).toContain('asset.allowAiUse')
  })

  it('hands drafts to onSend rather than uploading from the composer', () => {
    expect(composer).toContain('onSend(value.trim(), attachments)')
  })
})

describe('thread rendering wiring', () => {
  it('BlockRenderer routes attachment blocks to AttachmentBlockView', () => {
    const renderer = read('./components/blocks/BlockRenderer.tsx')
    expect(renderer).toContain("case 'attachment':")
    expect(renderer).toContain('AttachmentBlockView')
  })

  it('AttachmentBlockView renders lazily, offers Open for PDFs and Save to Assets', () => {
    const view = read('./components/blocks/AttachmentBlockView.tsx')
    expect(view).toContain('loading="lazy"')
    expect(view).toContain('Open')
    expect(view).toContain('saveAttachmentToAssets')
    expect(view).toContain('Save to Assets')
  })

  it('MessageBubble passes the conversation so Save to Assets can be wired', () => {
    const bubble = read('./components/MessageBubble.tsx')
    expect(bubble).toContain('conversationId={message.conversationId}')
  })
})

describe('callable wiring', () => {
  it('the client names the deployed Save-to-Assets callable', () => {
    const client = read('../../services/ai/ai.client.ts')
    expect(client).toContain("saveAttachmentToAssets: 'chatSaveAttachmentToAssets'")
  })

  it('the functions entry point exports it', () => {
    const index = read('../../../functions/src/index.ts')
    expect(index).toContain("export { chatSaveAttachmentToAssets } from './chat/saveAttachment'")
  })
})
