import { describe, expect, it } from 'vitest'
import {
  ACCEPTED_ATTACHMENT_MIME_TYPES,
  ATTACHMENT_FILE_ACCEPT,
  canAddAttachment,
  isAiEligibleAttachment,
  isImageAttachment,
  isPdfAttachment,
  MAX_AI_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  validateAttachmentFile,
} from './attachmentFile'
import { buildAttachmentPath, sanitizeFileName } from '@/services/storage/storage.service'

function fakeFile(overrides: Partial<{ name: string; type: string; size: number }> = {}) {
  return { name: 'photo.jpg', type: 'image/jpeg', size: 1024, ...overrides }
}

describe('validateAttachmentFile', () => {
  it('accepts a JPEG', () => {
    expect(validateAttachmentFile(fakeFile({ type: 'image/jpeg' })).ok).toBe(true)
  })

  it('accepts a PNG', () => {
    expect(validateAttachmentFile(fakeFile({ name: 'a.png', type: 'image/png' })).ok).toBe(true)
  })

  it('accepts a WebP', () => {
    expect(validateAttachmentFile(fakeFile({ name: 'a.webp', type: 'image/webp' })).ok).toBe(true)
  })

  it('accepts a PDF', () => {
    expect(
      validateAttachmentFile(fakeFile({ name: 'menu.pdf', type: 'application/pdf' })).ok,
    ).toBe(true)
  })

  it('rejects an SVG with a specific reason', () => {
    const check = validateAttachmentFile(fakeFile({ name: 'logo.svg', type: 'image/svg+xml' }))
    expect(check.ok).toBe(false)
    expect(check.reason).toContain('SVG')
  })

  it('rejects an unsupported type', () => {
    const check = validateAttachmentFile(fakeFile({ name: 'a.gif', type: 'image/gif' }))
    expect(check.ok).toBe(false)
    expect(check.reason).toContain('not supported')
  })

  it('rejects an empty file', () => {
    const check = validateAttachmentFile(fakeFile({ size: 0 }))
    expect(check.ok).toBe(false)
    expect(check.reason).toContain('empty')
  })

  it('accepts a file at exactly the 10 MiB boundary', () => {
    expect(validateAttachmentFile(fakeFile({ size: MAX_ATTACHMENT_BYTES })).ok).toBe(true)
  })

  it('rejects a file one byte over 10 MiB', () => {
    const check = validateAttachmentFile(fakeFile({ size: MAX_ATTACHMENT_BYTES + 1 }))
    expect(check.ok).toBe(false)
    expect(check.reason).toContain('too large')
  })

  it('rejects by type before size, so an oversized SVG names the real problem', () => {
    const check = validateAttachmentFile(
      fakeFile({ type: 'image/svg+xml', size: MAX_ATTACHMENT_BYTES + 1 }),
    )
    expect(check.reason).toContain('SVG')
  })
})

describe('attachment limits', () => {
  it('allows adding up to exactly three attachments', () => {
    expect(MAX_ATTACHMENTS_PER_MESSAGE).toBe(3)
    expect(canAddAttachment(0)).toBe(true)
    expect(canAddAttachment(2)).toBe(true)
    expect(canAddAttachment(3)).toBe(false)
    expect(canAddAttachment(4)).toBe(false)
  })

  it('keeps the accept attribute in sync with the MIME allow-list', () => {
    expect(ACCEPTED_ATTACHMENT_MIME_TYPES).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ])
    expect(ATTACHMENT_FILE_ACCEPT).toBe('.jpg,.jpeg,.png,.webp,.pdf')
  })
})

describe('content-type helpers', () => {
  it('classifies images and PDFs', () => {
    expect(isImageAttachment('image/png')).toBe(true)
    expect(isImageAttachment('application/pdf')).toBe(false)
    expect(isPdfAttachment('application/pdf')).toBe(true)
    expect(isPdfAttachment('image/png')).toBe(false)
  })
})

describe('isAiEligibleAttachment', () => {
  it('accepts a supported type at the 8 MiB AI boundary', () => {
    expect(
      isAiEligibleAttachment({ contentType: 'image/png', sizeBytes: MAX_AI_ATTACHMENT_BYTES }),
    ).toBe(true)
  })

  it('rejects an attachment over the AI limit even though it stores fine', () => {
    const oversized = { contentType: 'image/png', sizeBytes: MAX_AI_ATTACHMENT_BYTES + 1 }
    expect(validateAttachmentFile(fakeFile({ size: oversized.sizeBytes })).ok).toBe(true)
    expect(isAiEligibleAttachment(oversized)).toBe(false)
  })

  it('rejects unsupported types and empty files', () => {
    expect(isAiEligibleAttachment({ contentType: 'image/gif', sizeBytes: 100 })).toBe(false)
    expect(isAiEligibleAttachment({ contentType: 'image/png', sizeBytes: 0 })).toBe(false)
  })
})

describe('attachment storage paths', () => {
  it('sanitises the filename with the shared sanitiser', () => {
    expect(sanitizeFileName('my café menu (final)!.pdf')).toBe('my_caf_menu_final_.pdf')
  })

  it('builds a conversation-scoped path, never the Assets namespace', () => {
    const path = buildAttachmentPath('biz1', 'convo1', 'att1', 'my photo.jpg')
    expect(path).toBe('businesses/biz1/conversations/convo1/attachments/att1_my_photo.jpg')
    expect(path).not.toContain('/assets/')
  })
})
