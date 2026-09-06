import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/hooks/useI18n'
import type { MessageKey } from '@/i18n/translate'
import type { BrandKit } from '@/types'
import {
  brandKitChecklist,
  brandKitProgress,
  brandKitStatus,
  type BrandKitChecklist,
} from './brandKit'

/**
 * Where the owner stands, without a warning in sight: EVA's quiet badge for
 * partial, a plain "Ready" line (no celebration) once the four required
 * sections are done. Readiness is derived on every render — never stored.
 */

const ROWS: { part: keyof BrandKitChecklist; labelKey: MessageKey; optional?: boolean }[] = [
  { part: 'logo', labelKey: 'brand.checklistLogo' },
  { part: 'colors', labelKey: 'brand.checklistColors' },
  { part: 'typography', labelKey: 'brand.checklistTypography' },
  { part: 'style', labelKey: 'brand.checklistStyle' },
  { part: 'notes', labelKey: 'brand.checklistNotes', optional: true },
]

export function BrandStatusCard({
  kit,
  onContinue,
}: {
  kit: BrandKit | null
  onContinue: () => void
}) {
  const { t } = useI18n()
  const status = brandKitStatus(kit)
  const checklist = brandKitChecklist(kit)
  const { done, total } = brandKitProgress(kit)

  if (status === 'ready') {
    // Collapses to one calm line: the work is done, EVA is using it.
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-5 py-3.5">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-eva-badge-border bg-eva-badge px-2.5 py-1 text-[11px] font-medium text-eva-badge-foreground">
          <Check className="size-3" aria-hidden />
          {t('brand.statusReady')}
        </span>
        <p className="text-[13px] text-muted-foreground">{t('brand.readyUsing')}</p>
      </div>
    )
  }

  return (
    <section className="rounded-xl border border-border bg-card px-6 py-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">{t('brand.statusTitle')}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {t('brand.pageHint')}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center rounded-full border border-eva-badge-border bg-eva-badge px-2.5 py-1 text-[11px] font-medium text-eva-badge-foreground">
          {status === 'partial' ? t('brand.statusPartial') : t('brand.statusNotStarted')}
        </span>
      </header>

      <div
        className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={t('brand.progressAria', { done, total })}
        aria-label={t('brand.statusTitle')}
      >
        <div
          className="h-full rounded-full bg-eva-progress transition-[width]"
          style={{ width: `${(done / total) * 100}%` }}
        />
      </div>

      <ul className="mt-4 space-y-1.5">
        {ROWS.map(({ part, labelKey, optional }) => (
          <li key={part} className="flex items-center gap-2 text-[13px]">
            <span
              className={
                checklist[part]
                  ? 'inline-flex size-4 items-center justify-center rounded-full bg-eva-badge text-eva-badge-foreground'
                  : 'inline-block size-4 rounded-full border border-border'
              }
              aria-hidden
            >
              {checklist[part] ? <Check className="size-3" /> : null}
            </span>
            <span className={checklist[part] ? 'text-foreground' : 'text-muted-foreground'}>
              {t(labelKey)}
              {optional ? (
                <span className="text-muted-foreground/70"> · {t('brand.optional')}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      <Button size="sm" className="mt-5" onClick={onContinue}>
        {status === 'partial' ? t('brand.continueCta') : t('brand.setUpCta')}
      </Button>
    </section>
  )
}
