import { Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ROUTES } from '@/app/routes/paths'
import { useI18n } from '@/hooks/useI18n'
import type { MessageKey } from '@/i18n/translate'
import type { BrandAppliedSummary } from '@/types'

/**
 * "Did EVA use my brand?" — answered in one plain line. The summary was
 * stamped server-side at generation time; older creatives don't carry one
 * and then this renders nothing. Honest when incomplete: the parts that
 * were used get a tick, the ones the owner hasn't set yet say so, with a
 * link to set them. Never a gate on anything.
 */

const PARTS: { part: keyof BrandAppliedSummary; labelKey: MessageKey }[] = [
  { part: 'logo', labelKey: 'brand.partLogo' },
  { part: 'colors', labelKey: 'brand.partColors' },
  { part: 'style', labelKey: 'brand.partStyle' },
  { part: 'typography', labelKey: 'brand.partTypography' },
]

export function BrandAppliedPanel({ applied }: { applied: BrandAppliedSummary }) {
  const { t } = useI18n()
  const used = PARTS.filter(({ part }) => applied[part])
  const full = used.length === PARTS.length

  if (used.length === 0) {
    return (
      <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
        {t('brand.usedNone')}{' '}
        <Link
          to={ROUTES.businessBrand}
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          {t('brand.setUpBrand')}
        </Link>
      </p>
    )
  }

  return (
    <div className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
      {full ? (
        <p className="flex items-center gap-1.5">
          <Check className="size-3 shrink-0 text-eva" aria-hidden />
          {t('brand.usedFull')}
        </p>
      ) : (
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {PARTS.map(({ part, labelKey }) =>
            applied[part] ? (
              <span key={part} className="inline-flex items-center gap-1">
                {t(labelKey)}
                <Check className="size-3 text-eva" aria-hidden />
              </span>
            ) : (
              <span key={part} className="inline-flex items-center gap-1 text-muted-foreground/70">
                {t(labelKey)} {t('brand.partNotSet')}
              </span>
            ),
          )}
          <Link
            to={ROUTES.businessBrand}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            {t('brand.completeBrand')}
          </Link>
        </p>
      )}
    </div>
  )
}
