import { Button } from '@/components/ui/button'
import { useI18n } from '@/hooks/useI18n'
import type { MessageKey } from '@/i18n/translate'
import { SourceBadge } from '@/features/business/components/SectionCard'
import type { Business, DnaSourceSummary } from '@/types'
import { TRAIT_KEYS } from './BrandBoard'
import type { DetectedBrandSlot, DetectedBrandSuggestion } from './brandKit'
import { useStorageUrl } from './useStorageUrl'

/**
 * "EVA found these from your business sources" — discovery's brand data,
 * surfaced but never applied on its own. "Use these" is the only path from
 * here into the Brand Identity, and it runs through the owner's explicit
 * confirmation; "Edit first" opens the sections instead.
 *
 * Source-neutral by design (Phase 7E): a business with no website but a
 * Facebook Page and a few uploaded photos reads exactly like one with a
 * website. What could not be detected is said plainly, never guessed.
 */

const TITLE_KEYS: Record<DetectedBrandSuggestion['source'], MessageKey> = {
  website: 'brand.detectedTitleWebsite',
  facebook: 'brand.detectedTitleFacebook',
  instagram: 'brand.detectedTitleInstagram',
  other: 'brand.detectedTitleOther',
  sources: 'brand.detectedTitleSources',
}

const SLOT_KEYS: Record<DetectedBrandSlot, MessageKey> = {
  logo: 'brand.checklistLogo',
  colors: 'brand.checklistColors',
  typography: 'brand.checklistTypography',
  style: 'brand.checklistStyle',
}

export function DetectedBrandCard({
  suggestion,
  provenance,
  logoAssetPath,
  busy,
  onUse,
  onChange,
}: {
  suggestion: DetectedBrandSuggestion
  provenance: Business['brand']
  /** Storage path of the Asset `suggestion.logoAssetId` points at, if loaded. */
  logoAssetPath: string | null
  busy: boolean
  onUse: () => void
  onChange: () => void
}) {
  const { t } = useI18n()
  const assetLogoUrl = useStorageUrl(logoAssetPath)
  const logoSrc = suggestion.logoUrl ?? assetLogoUrl

  return (
    <section className="rounded-xl border border-eva-tint-border bg-eva-tint px-6 py-5">
      <header className="flex items-start justify-between gap-4">
        <h2 className="text-[15px] font-semibold text-foreground">
          {t(TITLE_KEYS[suggestion.source])}
        </h2>
        {provenance ? <SourceBadge provenance={provenance} /> : null}
      </header>

      {suggestion.sources.length > 0 ? (
        <SourcesLine sources={suggestion.sources} />
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-4">
        {logoSrc ? (
          <img
            src={logoSrc}
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

      {suggestion.traits.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t('brand.checklistStyle')}>
          {suggestion.traits.map((trait) => (
            <li
              key={trait}
              className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[12px] text-foreground"
            >
              {t(TRAIT_KEYS[trait])}
            </li>
          ))}
        </ul>
      ) : null}

      {suggestion.logoAssetId ? (
        <p className="mt-3 text-[12px] text-muted-foreground">{t('brand.detectedLogoAsset')}</p>
      ) : null}

      {suggestion.fontFamily ? (
        <p className="mt-3 text-[12px] text-muted-foreground">
          {suggestion.source === 'sources'
            ? t(
                suggestion.supportedFont
                  ? 'brand.detectedFontSupported'
                  : 'brand.detectedFontUnsupported',
                { font: suggestion.fontFamily },
              )
            : t('brand.detectedFontHint', { font: suggestion.fontFamily })}
        </p>
      ) : null}

      {suggestion.category ? (
        <p className="mt-3 text-[12px] text-muted-foreground">
          {t('brand.detectedCategory', { category: suggestion.category })}
        </p>
      ) : null}

      {suggestion.unknown.length > 0 ? (
        <ul className="mt-3 space-y-0.5 text-[12px] text-muted-foreground">
          {suggestion.unknown.map((slot) => (
            <li key={slot}>
              <span className="text-foreground">{t(SLOT_KEYS[slot])}</span> ·{' '}
              {t('brand.detectedUnknown')}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" disabled={busy} onClick={onUse}>
          {t('brand.useThese')}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onChange}>
          {t('brand.editFirst')}
        </Button>
      </div>
    </section>
  )
}

const SOURCE_KEYS: Record<Exclude<DnaSourceSummary['type'], 'asset'>, MessageKey> = {
  website: 'brand.sourceWebsite',
  facebook: 'brand.sourceFacebook',
  instagram: 'brand.sourceInstagram',
}

const STATUS_KEYS: Record<Exclude<DnaSourceSummary['status'], 'analyzed'>, MessageKey> = {
  limited: 'brand.sourceLimited',
  inaccessible: 'brand.sourceInaccessible',
  failed: 'brand.sourceFailed',
}

/** "Sources analyzed: ✓ Instagram ✓ Facebook ✓ 3 uploaded assets". */
export function SourcesLine({ sources }: { sources: DnaSourceSummary[] }) {
  const { t } = useI18n()
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
      <span>{t('brand.detectedSourcesLabel')}</span>
      {sources.map((source) => {
        const read = source.status === 'analyzed'
        const label =
          source.type === 'asset'
            ? source.count === 1
              ? t('brand.sourceAssetOne')
              : t('brand.sourceAssets', { count: source.count })
            : t(SOURCE_KEYS[source.type])
        return (
          <span key={source.type} className={read ? 'text-foreground' : undefined}>
            {read ? '✓ ' : '· '}
            {label}
            {source.status === 'analyzed' ? '' : ` (${t(STATUS_KEYS[source.status])})`}
          </span>
        )
      })}
    </p>
  )
}
