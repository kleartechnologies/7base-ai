import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { en } from '@/i18n/messages/en'
import { ms } from '@/i18n/messages/ms'

/**
 * Phase 7H wiring. Vitest runs with no DOM here, so the component checks are
 * source-level, the workspaceWiring/brandWiring approach. They pin the
 * properties a rendered screenshot cannot prove: that the copy panel reads
 * the creative document rather than holding marketing text of its own, that
 * saving a caption sends nothing the client could lie about, and that the
 * creation state shows no invented progress.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const panel = read('./PlatformCopy.tsx')
const model = read('./copyPlatforms.ts')
const service = read('../../services/creatives/creative.service.ts')
const creating = read('../../components/EvaCreatingState.tsx')
const creativePage = read('../../pages/CreativePage.tsx')
const creativeCard = read('./CreativeCard.tsx')
const chatPreview = read('../chat/components/blocks/CreativePreview.tsx')
const setCard = read('../chat/components/blocks/CreativeSetCard.tsx')
const campaignCard = read('../chat/components/blocks/CampaignCard.tsx')
const campaignPage = read('../../pages/CampaignDetailPage.tsx')
const rules = readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8')

describe('the copy comes from the creative, never from the frontend', () => {
  it('reads the stored captions and nothing else', () => {
    expect(panel).toContain('platformCopyEntries(creative ? creative.captions')
  })

  it('holds no marketing copy of its own', () => {
    // Every string the panel renders is a translation key or stored copy.
    expect(panel).not.toMatch(/#[A-Za-z]{3,}/) // no hard-coded hashtags
    expect(panel).not.toMatch(/Shop now|Order now|Don't miss|Limited time/i)
    expect(model).not.toMatch(/Shop now|Order now|Don't miss|Limited time/i)
  })

  it('never composes a variant for a platform that has none', () => {
    expect(model).toContain('if (text.length > 0) entries.push')
    expect(model).not.toMatch(/\?\?\s*captions\.(short|facebook)/)
  })

  it('says so plainly when a creative has no copy yet', () => {
    expect(panel).toContain("t('creative.copyNotReady')")
    expect(en['creative.copyNotReady']).toBeTruthy()
    expect(ms['creative.copyNotReady']).toBeTruthy()
  })
})

describe('the copy panel is collapsed until it is asked for', () => {
  it('starts closed', () => {
    expect(panel).toContain('defaultOpen = false')
    expect(panel).toContain('useState(defaultOpen)')
    expect(panel).toContain('aria-expanded={open}')
    expect(panel).toContain('aria-controls={panelId}')
  })

  it('"Review copy" can open it, and closing it again sticks', () => {
    // The prop only ever opens the panel; nothing forces it back open, so the
    // owner's close is final.
    expect(panel).toContain('if (defaultOpen) setOpen(true)')
    expect(panel).not.toContain('setOpen(defaultOpen)')
  })

  it('is one platform selector, not a stack of accordions', () => {
    expect(panel).toContain('aria-pressed={current}')
    expect((panel.match(/aria-expanded/g) ?? []).length).toBe(1)
  })
})

describe('copying puts only the marketing text on the clipboard', () => {
  it('reuses the existing clipboard helper with its fallback', () => {
    expect(panel).toContain("import { copyTextToClipboard } from './poster'")
    expect(panel).toContain('copyTextToClipboard(entry.text)')
  })

  it('never copies a label or any surrounding chrome', () => {
    expect(panel).not.toMatch(/copyTextToClipboard\([^)]*t\(/)
    expect(panel).not.toMatch(/copyTextToClipboard\([^)]*label/)
  })

  it('confirms in place and handles a browser that refuses', () => {
    expect(panel).toContain("t('creative.copied')")
    expect(panel).toContain('setCopyFailed(true)')
    expect(en['creative.copyFailed']).toBeTruthy()
    expect(ms['creative.copyFailed']).toBeTruthy()
    // A small inline confirmation, not a blocking overlay.
    expect(panel).not.toMatch(/toast|Dialog|Modal/i)
  })
})

describe('editing a caption', () => {
  it('is explicit — read-only until Edit, then Save or Cancel', () => {
    expect(panel).toContain("t('common.edit')")
    expect(panel).toContain("t('common.save')")
    expect(panel).toContain("t('common.cancel')")
    expect(panel).not.toContain('onBlur')
  })

  it('gives the textarea a label a screen reader can read', () => {
    expect(panel).toContain('htmlFor={fieldId}')
    expect(panel).toContain("t('creative.editCopyLabel'")
  })

  it('keeps the owner’s words on screen when a save fails', () => {
    expect(panel).toContain('setSaveError(true)')
    expect(panel).toMatch(/catch \{\s*\n\s*\/\/[^\n]*\n\s*setSaveError\(true\)/)
  })

  it('does not regenerate the poster or touch the campaign', () => {
    expect(panel).not.toContain('retryCreativeImage')
    expect(panel).not.toContain('generateCreativeMaterials')
    // (The word "campaign" appears in the file's own doc comment; what must
    // not appear is any campaign write, read or id.)
    expect(panel).not.toMatch(/campaignDoc|updateCampaign|campaignId|observeCampaign/)
  })
})

describe('saving is server-authoritative in the way the rules require', () => {
  it('writes one caption field and the owner-authority list, nothing else', () => {
    expect(service).toContain('`captions.${caption}`')
    expect(service).toContain('userEdited,')
    expect(service).toContain('updatedAt: Date.now(),')
  })

  it('sends no businessId, ownerId, plan, quota, model, token or cost', () => {
    const write = service.slice(service.indexOf('export async function updateCreativeCaption'))
    expect(write).not.toMatch(/businessId|ownerId|plan|quota|model|token|cost/i)
  })

  it('relies on the existing rule that freezes every server field', () => {
    expect(rules).toContain('creativeServerFieldsUnchanged()')
    // The image, the asset provenance and the campaign chain stay frozen, so
    // a caption edit cannot reach any of them.
    expect(rules).toMatch(/request\.resource\.data\.get\('content', \{\}\)\.get\('image', null\)/)
    expect(rules).toContain("allow create: if false;")
  })

  it('adds no client create path for creatives', () => {
    expect(service).not.toContain('addDoc')
    expect(service).not.toContain('setDoc')
  })
})

describe('the EVA creation state is honest', () => {
  it('shows no percentage, no countdown and no timed steps', () => {
    // No progress figure, and no timer that could advance one.
    expect(creating).not.toMatch(/\d\s*%/)
    expect(creating).not.toContain('setInterval')
    expect(creating).not.toContain('setTimeout')
    expect(creating).not.toMatch(/Almost done|nearly there/i)
  })

  it('is EVA’s mark, not a spinner', () => {
    expect(creating).toContain('EvaMark')
    expect(creating).toContain('animate-eva-orbit')
    expect(creating).not.toContain('animate-spin')
  })

  it('stops moving when the viewer asks for less motion', () => {
    const animations = creating.match(/animate-eva-[a-z]+/g) ?? []
    expect(animations.length).toBeGreaterThan(0)
    expect((creating.match(/motion-reduce:animate-none/g) ?? []).length).toBe(animations.length)
  })

  it('reserves its height so nothing jumps when it appears', () => {
    expect(creating).toContain('min-h-')
  })

  it('announces itself to a screen reader without stealing focus', () => {
    expect(creating).toContain('role="status"')
    expect(creating).toContain('aria-live="polite"')
    expect(creating).not.toContain('autoFocus')
  })

  it('describes only work the generation call actually does', () => {
    expect(en['creative.evaCreatingDetail']).toMatch(/copy.*visual.*poster/i)
    expect(ms['creative.evaCreatingDetail']).toBeTruthy()
  })
})

describe('the creation state replaced the generic loading line', () => {
  it('is shown the moment generation starts on both button paths', () => {
    expect(campaignCard).toContain('{creating ? (\n          <EvaCreatingState')
    expect(campaignPage).toContain('{creating ? <EvaCreatingState')
  })

  it('leaves the existing generation call and its error handling alone', () => {
    expect(campaignCard).toContain('generateCreativeMaterials({ campaignId: block.campaignId })')
    expect(campaignCard).toContain('setMaterialsError(result.error.message)')
    expect(campaignPage).toContain('generateCreativeMaterials({ campaignId: campaign.id })')
    expect(campaignPage).toContain('setMaterialsError(result.error.message)')
  })

  it('does not touch the chat progress stream, which reports real steps', () => {
    const progress = read('../chat/components/ActionProgress.tsx')
    expect(progress).toContain('steps.map')
    expect(progress).toContain('EvaTurn markState="thinking"')
  })
})

describe('the copy sits with its own poster, everywhere a poster appears', () => {
  it('is under the poster on the one creative card both pages render', () => {
    expect(creativeCard).toContain('<PlatformCopy creative={creative}')
    expect(creativeCard).toContain('className="mt-3"')
    // The pages render the card; neither pools copy of its own beside it.
    expect(creativePage).toContain('<CreativeCard')
    expect(creativePage).not.toContain('<PlatformCopy')
    expect(campaignPage).not.toContain('<PlatformCopy')
  })

  it('is under the poster in a chat preview, reading the live document', () => {
    expect(chatPreview).toContain('<PlatformCopy creative={creative}')
    expect(chatPreview).toContain('fallbackCaptions={block.captions}')
  })

  it('is under each tile of a set — never one pooled block for the set', () => {
    const tile = setCard.slice(setCard.indexOf('function PosterTile'))
    expect(tile).toContain('<PlatformCopy')
    const header = setCard.slice(0, setCard.indexOf('function PosterTile'))
    expect(header).not.toContain('<PlatformCopy')
  })

  it('leaves the poster renderer and the download path untouched', () => {
    expect(panel).not.toContain('PosterCanvas')
    expect(panel).not.toContain('drawPoster')
    expect(panel).not.toContain('downloadCreativePoster')
    expect(chatPreview).toContain('<LivePosterFrame lookup={lookup}')
    expect(creativeCard).toContain('<PosterCanvas creative={creative}')
    expect(creativeCard).toContain('<DownloadPosterButton creative={creative} />')
  })
})

describe('theme, language and layout', () => {
  it('uses semantic theme tokens only — no hard-coded colours', () => {
    for (const source of [panel, creating]) {
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(source).not.toMatch(/\b(?:rgb|hsl)a?\(/)
      expect(source).not.toMatch(/\b(?:bg|text|border)-(?:white|black|slate|zinc|gray|neutral)-/)
    }
  })

  it('every string it renders exists in both dictionaries', () => {
    const keys = [...panel.matchAll(/t\('([a-z]+\.[A-Za-z]+)'/g)].map((match) => match[1])
    expect(keys.length).toBeGreaterThan(4)
    for (const key of keys) {
      expect(en[key as keyof typeof en], key).toBeTruthy()
      expect(ms[key as keyof typeof ms], key).toBeTruthy()
    }
  })

  it('cannot push a phone into horizontal scroll', () => {
    // Long unbroken caption text wraps; the collapsed preview truncates.
    expect(panel).toContain('whitespace-pre-wrap')
    expect(panel).toContain('truncate')
    expect(panel).toContain('flex-wrap')
    // The truncating preview must carry `w-0` as well as `min-w-0`. Without
    // it the line reports its whole text as a minimum width, the card grows
    // past the viewport and the page scrolls sideways — the defect the 390px
    // screenshots caught.
    expect(panel).toContain('w-0 min-w-0 flex-1 truncate')
  })
})
