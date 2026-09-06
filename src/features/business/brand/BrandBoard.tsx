import { useEffect } from 'react'
import { useI18n } from '@/hooks/useI18n'
import type { MessageKey } from '@/i18n/translate'
import type { BrandKit, BrandStyleTrait, Business } from '@/types'
import { ensureBrandFontsLoaded } from './fonts'

/**
 * The brand board: how the identity looks assembled — logo, type pairing,
 * the three colours, the style words — over real Business Brain content.
 *
 * Deliberately THEME-INDEPENDENT: these are the business's colours, not the
 * app's, so the board paints its own fixed light surface and ignores
 * Light/Dark/System entirely. Every colour in here is a literal, on purpose.
 */

export const TRAIT_KEYS: Record<BrandStyleTrait, MessageKey> = {
  modern: 'brand.traitModern',
  premium: 'brand.traitPremium',
  friendly: 'brand.traitFriendly',
  playful: 'brand.traitPlayful',
  minimal: 'brand.traitMinimal',
  bold: 'brand.traitBold',
  elegant: 'brand.traitElegant',
  warm: 'brand.traitWarm',
  traditional: 'brand.traitTraditional',
  professional: 'brand.traitProfessional',
}

const FALLBACK_STACK = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

export function BrandBoard({
  kit,
  business,
  logoUrl,
}: {
  kit: BrandKit
  business: Business
  logoUrl: string | null
}) {
  const { t } = useI18n()
  const heading = kit.typography.heading
  const body = kit.typography.body

  useEffect(() => {
    ensureBrandFontsLoaded([heading, body])
  }, [heading, body])

  // Real Brain content, never lorem: the tagline (or name) as the sample
  // headline, a real product line (or the description) as the sample body.
  const sampleHeadline = business.identity.tagline ?? business.name
  const signature = business.products.find((product) => product.isSignature)
  const sampleBody =
    signature?.description ??
    signature?.name ??
    business.identity.description ??
    t('brand.boardSampleBody')

  const swatches = [
    { label: t('brand.colorPrimary'), hex: kit.colors.primary },
    { label: t('brand.colorSecondary'), hex: kit.colors.secondary },
    { label: t('brand.colorAccent'), hex: kit.colors.accent },
  ]
  const accent = kit.colors.accent ?? kit.colors.primary

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ backgroundColor: '#ffffff', borderColor: '#e7e2dc' }}
      data-testid="brand-board"
    >
      <div className="px-6 py-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p
              className="text-[22px] font-semibold leading-snug"
              style={{
                color: '#2a241f',
                fontFamily: heading ? `'${heading}', ${FALLBACK_STACK}` : FALLBACK_STACK,
              }}
            >
              {sampleHeadline}
            </p>
            <p
              className="mt-2 text-[14px] leading-relaxed"
              style={{
                color: '#6b625a',
                fontFamily: body ? `'${body}', ${FALLBACK_STACK}` : FALLBACK_STACK,
              }}
            >
              {sampleBody}
            </p>
          </div>
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={t('brand.logoAlt', { name: business.name })}
              className="max-h-14 w-auto max-w-[7rem] shrink-0 object-contain"
            />
          ) : null}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {swatches.map(({ label, hex }) => (
            <div key={label} className="min-w-[5.5rem]">
              <div
                className="h-10 rounded-lg border"
                style={{
                  backgroundColor: hex ?? '#f3efe9',
                  borderColor: hex ? 'rgba(0,0,0,0.08)' : '#e7e2dc',
                }}
                aria-hidden
              />
              <p className="mt-1.5 text-[11px] font-medium" style={{ color: '#6b625a' }}>
                {label}
              </p>
              <p className="text-[11px] uppercase" style={{ color: hex ? '#2a241f' : '#a89f96' }}>
                {hex ?? '—'}
              </p>
            </div>
          ))}
        </div>

        {kit.styleTraits.length > 0 ? (
          <ul className="mt-5 flex flex-wrap gap-1.5">
            {kit.styleTraits.map((trait) => (
              <li
                key={trait}
                className="rounded-full px-2.5 py-1 text-[12px] font-medium"
                style={{
                  backgroundColor: '#f3efe9',
                  color: '#4a423b',
                  border: accent ? `1px solid ${accent}33` : '1px solid #e7e2dc',
                }}
              >
                {t(TRAIT_KEYS[trait])}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {accent ? <div className="h-1.5" style={{ backgroundColor: accent }} aria-hidden /> : null}
    </div>
  )
}
