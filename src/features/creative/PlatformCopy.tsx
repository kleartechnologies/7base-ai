import { useEffect, useId, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/hooks/useI18n'
import { cn } from '@/lib/utils'
import { updateCreativeCaption } from '@/services/creatives/creative.service'
import type { Creative, CreativeCaptions } from '@/types'
import { copyTextToClipboard } from './poster'
import {
  collapsedPreview,
  platformCopyEntries,
  type CopyPlatform,
  type PlatformCopyEntry,
} from './copyPlatforms'

/**
 * The marketing copy that goes with one poster.
 *
 * Sits directly under its own creative — never pooled at the bottom of a
 * campaign — and stays collapsed until asked for, because the poster is the
 * thing the owner came to see. Open, it is one platform at a time: a row of
 * platforms, the copy for the selected one, a Copy button and an Edit button.
 * Three stacked accordions would say the same thing in three times the space
 * and would not survive a 390px phone.
 *
 * Copy always comes from the creative document — the same field generation
 * wrote and conversational editing patches. Nothing here composes marketing
 * text of its own, and a platform with no copy is left out rather than filled
 * with a rewrapped general caption.
 */
export function PlatformCopy({
  creative,
  fallbackCaptions,
  className,
}: {
  /** The live creative. Null while a chat card is still loading its document. */
  creative: Creative | null
  /** The captions frozen into a chat message, used only until it loads. */
  fallbackCaptions?: CreativeCaptions
  className?: string
}) {
  const { t } = useI18n()
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<CopyPlatform | null>(null)

  const entries = platformCopyEntries(creative ? creative.captions : (fallbackCaptions ?? null))
  // Selection survives a save; it falls back to the first platform only when
  // the one being shown genuinely no longer has copy.
  const active = entries.find((entry) => entry.platform === selected) ?? entries[0]

  if (!active) {
    return (
      <p className={cn('text-[13px] leading-relaxed text-muted-foreground', className)}>
        {t('creative.copyNotReady')}
      </p>
    )
  }

  const preview = collapsedPreview(entries)

  return (
    <div className={cn('rounded-lg border border-border', className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
      >
        <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          {t('creative.copyForPosting')}
        </span>
        {!open && preview ? (
          /* `w-0` as well as `min-w-0`: a truncating line still reports its
             full text as a minimum width, which pushes the whole card wider
             than a 390px phone. Zero width plus flex-grow fills what is there
             and truncates, without ever asking the card for room. */
          <span className="w-0 min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
            {preview}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <ChevronDown
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      <div id={panelId} hidden={!open} className="border-t border-border px-3 py-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('creative.copyPlatforms')}>
          {entries.map((entry) => {
            const current = entry.platform === active.platform
            return (
              <button
                key={entry.platform}
                type="button"
                aria-pressed={current}
                onClick={() => setSelected(entry.platform)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                  current
                    ? 'border-eva-badge-border bg-eva-badge text-eva-badge-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                {t(entry.chip)}
              </button>
            )
          })}
        </div>

        <CopyPane key={active.platform} creative={creative} entry={active} />
      </div>
    </div>
  )
}

/**
 * One platform's copy: read-only until the owner asks to edit it, then a
 * plain textarea with Save and Cancel. Never autosaved — this is the text
 * they are about to publish, and a half-typed sentence should not become the
 * stored version because focus moved.
 */
function CopyPane({ creative, entry }: { creative: Creative | null; entry: PlatformCopyEntry }) {
  const { t } = useI18n()
  const fieldId = useId()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.text)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopy = async () => {
    setCopyFailed(false)
    // Only the marketing text — never the platform label above it.
    if (await copyTextToClipboard(entry.text)) setCopied(true)
    else setCopyFailed(true)
  }

  const handleEdit = () => {
    setDraft(entry.text)
    setSaveError(false)
    setEditing(true)
  }

  const handleSave = async () => {
    if (!creative) return
    const text = draft.trim()
    if (text.length === 0 || text === entry.text) {
      setEditing(false)
      return
    }
    setSaving(true)
    setSaveError(false)
    try {
      await updateCreativeCaption(creative, entry.field, entry.editable, text)
      setEditing(false)
    } catch {
      // The draft stays on screen — a failed save must not eat their words.
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {t(entry.label)}
      </p>

      {editing ? (
        <div className="mt-1.5">
          <label htmlFor={fieldId} className="sr-only">
            {t('creative.editCopyLabel', { platform: t(entry.label) })}
          </label>
          <Textarea
            id={fieldId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-28 text-[14px] leading-relaxed"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
          </div>
          {saveError ? (
            <p role="alert" className="mt-2 text-[12px] leading-relaxed text-destructive">
              {t('creative.copySaveFailed')}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">
            {entry.text}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-[12px]"
              onClick={() => void handleCopy()}
            >
              {copied ? (
                <>
                  <Check className="size-3.5" aria-hidden />
                  {t('creative.copied')}
                </>
              ) : (
                t('creative.copy')
              )}
            </Button>
            {creative ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-[12px] text-muted-foreground"
                onClick={handleEdit}
              >
                {t('common.edit')}
              </Button>
            ) : null}
          </div>
          {copyFailed ? (
            <p role="alert" className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              {t('creative.copyFailed')}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
