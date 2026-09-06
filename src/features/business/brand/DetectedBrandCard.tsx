import { Button } from '@/components/ui/button'
import { useI18n } from '@/hooks/useI18n'
import type { MessageKey } from '@/i18n/translate'
import { SourceBadge } from '@/features/business/components/SectionCard'
import type { Business } from '@/types'
import type { DetectedBrandSuggestion } from './brandKit'

/**
 * "EVA found these from your website" — discovery's brand data, surfaced but
 * never applied on its own. "Use these" is the only path from here into the
 * Brand Identity, and it runs through the owner's explicit confirmation.
 */

const TITLE_KEYS: Record<DetectedBrandSuggestion['source'], MessageKey> = {
  website: 'brand.detectedTitleWebsite',
  facebook: 'brand.detectedTitleFacebook',
  instagram: 'brand.detectedTitleInstagram',
  other: 'brand.detectedTitleOther',
}

export function DetectedBrandCard({
  suggestion,
  provenance,
  busy,
  onUse,
  onChange,
}: {
  suggestion: DetectedBrandSuggestion
  provenance: Business['brand']
  busy: boolean
  onUse: () => void
  onChange: () => void
}) {
  const { t } = useI18n()
  return (
    <section className="rounded-xl border border-eva-tint-border bg-eva-tint px-6 py-5">
      <header className="flex items-start justify-between gap-4">
        <h2 className="text-[15px] font-semibold text-foreground">
          {t(TITLE_KEYS[suggestion.source])}
        </h2>
        <SourceBadge provenance={provenance} />
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        {suggestion.logoUrl ? (
          <img
            src={suggestion.logoUrl}
            alt={t('brand.detectedLogoAlt')}
            className="max-h-12 w-auto max-w-[6rem] rounded-md object-contain"
          />
        ) : null}
        {suggestion.colors.length > 0 ? (
          <div className="flex items-center gap-2">
            {suggestion.colors.map((hex) => (
              <span
                key={hex}
                className="inline-block size-8 rounded-md border border-black/10"
                style={{ backgroundColor: hex }}
                title={hex}
              />
            ))}
          </div>
        ) : null}
        {suggestion.visualStyle ? (
          <p className="min-w-0 text-[13px] leading-relaxed text-muted-foreground">
            {suggestion.visualStyle}
          </p>
        ) : null}
      </div>

      {suggestion.fontFamily ? (
        <p className="mt-3 text-[12px] text-muted-foreground">
          {t('brand.detectedFontHint', { font: suggestion.fontFamily })}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" disabled={busy} onClick={onUse}>
          {t('brand.useThese')}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onChange}>
          {t('brand.changeDetected')}
        </Button>
      </div>
    </section>
  )
}
