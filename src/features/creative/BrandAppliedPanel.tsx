import { Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ROUTES } from '@/app/routes/paths'
import { useI18n } from '@/hooks/useI18n'
import type { MessageKey } from '@/i18n/translate'
import type { BrandAppliedSummary } from '@/types'

/**
 * Read-only trust panel: what of the owner's Brand Identity EVA actually used
 * for this creative. The summary was stamped server-side at generation time —
 * older creatives don't carry one, and then this renders nothing. Honest when
 * incomplete ("partly applied", with the missing parts named), and never a
 * gate on anything.
 */

const PARTS: { part: keyof BrandAppliedSummary; labelKey: MessageKey }[] = [
  { part: 'logo', labelKey: 'brand.appliedLogo' },
  { part: 'colors', labelKey: 'brand.appliedColors' },
  { part: 'typography', labelKey: 'brand.appliedTypography' },
  { part: 'style', labelKey: 'brand.appliedStyle' },
]

export function BrandAppliedPanel({ applied }: { applied: BrandAppliedSummary }) {
  const { t } = useI18n()
  const full = PARTS.every(({ part }) => applied[part])

  return (
    <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
        <Check className="size-3 text-eva" aria-hidden />
        {full ? t('brand.appliedTitle') : t('brand.appliedPartialTitle')}
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {PARTS.map(({ part, labelKey }) => (
          <li
            key={part}
            className={`inline-flex items-center gap-1 text-[11px] ${
              applied[part] ? 'text-muted-foreground' : 'text-muted-foreground/60'
            }`}
          >
            {applied[part] ? <Check className="size-2.5" aria-hidden /> : null}
            {t(labelKey)}
            {applied[part] ? null : <span> — {t('brand.appliedNotSet')}</span>}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/80">
        {full ? t('brand.appliedBody') : t('brand.appliedPartialBody')}
      </p>
      <Link
        to={ROUTES.businessBrand}
        className="mt-1 inline-block text-[11px] font-medium text-foreground underline-offset-2 hover:underline"
      >
        {full ? t('brand.editBrand') : t('brand.completeBrand')}
      </Link>
    </div>
  )
}
