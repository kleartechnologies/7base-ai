import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/hooks/useI18n'
import { acceptClaim } from '@/services/business/brain'
import { observeAssets, createAssetFromFile, updateAssetMetadata } from '@/services/assets/asset.service'
import { saveBrandKit } from '@/services/business/business.service'
import {
  BRAND_FONTS,
  BRAND_STYLE_TRAITS,
  BRAND_TRAITS_MAX,
  BRAND_TRAITS_MIN,
  type Asset,
  type BrandFont,
  type BrandKit,
  type BrandStyleTrait,
  type Business,
} from '@/types'
import { cn } from '@/lib/utils'
import { BrandBoard, TRAIT_KEYS } from './BrandBoard'
import { BrandStatusCard } from './BrandStatusCard'
import { BusinessSourcesCard } from './BusinessSourcesCard'
import { DetectedBrandCard } from './DetectedBrandCard'
import { LogoSection } from './LogoSection'
import {
  BRAND_NOTES_COUNTER_AT,
  BRAND_NOTES_SOFT_CAP,
  applyDetectedBrand,
  brandKitChecklist,
  detectedBrandSuggestion,
  emptyBrandKit,
  normalizeBrandHex,
  toggleTrait,
} from './brandKit'
import { ensureBrandFontsLoaded } from './fonts'
import { useStorageUrl } from './useStorageUrl'

/**
 * The Brand Identity tab — the second face of the Business page.
 *
 * Everything here writes one object, `business.brandKit`, through the same
 * ownership-checked document the Profile tab edits. Sections follow the
 * SectionCard read → Edit → Save/Cancel idiom; the brand board at the bottom
 * re-renders from the saved kit, which is the feedback for a routine save —
 * no toasts. Each edit form mounts only while its section is being edited, so
 * its draft state seeds once from the saved kit and Cancel simply unmounts it.
 */

type EditingSection = 'colors' | 'typography' | 'style' | 'notes' | null

/** Anchor ids so "Continue setup" can land the owner on the right section. */
const SECTION_DOM_IDS = {
  logo: 'brand-section-logo',
  colors: 'brand-section-colors',
  typography: 'brand-section-typography',
  style: 'brand-section-style',
} as const

function scrollToSection(part: keyof typeof SECTION_DOM_IDS) {
  document.getElementById(SECTION_DOM_IDS[part])?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  })
}

export function BrandIdentityTab({
  business,
  ownerId,
  onSaved,
  onDirtyChange,
}: {
  business: Business
  ownerId: string
  onSaved: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const { t } = useI18n()
  const kit = useMemo(() => business.brandKit ?? emptyBrandKit(0), [business.brandKit])

  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [assetsFailed, setAssetsFailed] = useState(false)
  const [editing, setEditing] = useState<EditingSection>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return observeAssets(
      ownerId,
      (next) => setAssets(next.filter((asset) => asset.status === 'active')),
      () => {
        setAssets([])
        setAssetsFailed(true)
      },
    )
  }, [ownerId])

  // Every approved face is loaded up-front so the typography pickers can show
  // each option in its own face.
  useEffect(() => {
    ensureBrandFontsLoaded([...BRAND_FONTS])
  }, [])

  useEffect(() => {
    onDirtyChange(editing !== null)
  }, [editing, onDirtyChange])

  const suggestion = useMemo(() => detectedBrandSuggestion(business), [business])
  const suggestedLogoAsset = suggestion?.logoAssetId
    ? (assets ?? []).find((asset) => asset.id === suggestion.logoAssetId) ?? null
    : null
  const logoAsset = kit.logoAssetId
    ? (assets ?? []).find((asset) => asset.id === kit.logoAssetId) ?? null
    : null
  const logoUrl = useStorageUrl(logoAsset?.storagePath ?? null)

  const save = useCallback(
    async (next: BrandKit, acceptedBrand?: Business['brand']) => {
      setBusy(true)
      setSaveError(null)
      try {
        await saveBrandKit(business.id, next, acceptedBrand)
        onSaved()
        setEditing(null)
      } catch {
        setSaveError(t('brand.saveFailed'))
        throw new Error('brand save failed')
      } finally {
        setBusy(false)
      }
    },
    [business.id, onSaved, t],
  )

  /**
   * "Use these": discovered colours, style words, approved font and an
   * already-uploaded logo Asset copied into the kit (never over something the
   * owner set), the discovery marked owner-confirmed with its provenance
   * intact, and a discovered logo URL imported into Assets when the browser
   * can fetch it — a CORS-blocked logo degrades to colours-only, silently.
   * This is the only path from anything detected into the Brand Kit.
   */
  async function handleUseDetected() {
    if (!suggestion) return
    setBusy(true)
    setSaveError(null)
    try {
      let next = applyDetectedBrand(kit, suggestion)
      if (suggestion.logoUrl && !next.logoAssetId) {
        const imported = await importLogoFromUrl(suggestion.logoUrl, ownerId, business.id)
        if (imported) next = { ...next, logoAssetId: imported }
      }
      const acceptedBrand = business.brand ? acceptClaim(business.brand) : undefined
      await saveBrandKit(business.id, next, acceptedBrand)
      onSaved()
    } catch {
      setSaveError(t('brand.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  function openFirstIncomplete() {
    const parts = brandKitChecklist(kit)
    const order = ['logo', 'colors', 'typography', 'style'] as const
    const target = order.find((part) => !parts[part]) ?? 'logo'
    scrollToSection(target)
    if (target !== 'logo') setEditing(target)
  }

  return (
    <div className="space-y-4">
      <BrandStatusCard kit={business.brandKit ?? null} onContinue={openFirstIncomplete} />

      <BusinessSourcesCard
        business={business}
        assets={assets}
        applied={Boolean(business.discovery?.dna) && suggestion === null}
        busy={busy}
      />

      {suggestion ? (
        <DetectedBrandCard
          suggestion={suggestion}
          provenance={business.brand}
          logoAssetPath={suggestedLogoAsset?.storagePath ?? null}
          busy={busy}
          onUse={() => void handleUseDetected()}
          onChange={() => {
            setEditing('colors')
            scrollToSection('colors')
          }}
        />
      ) : null}

      {saveError ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
          {saveError}
        </p>
      ) : null}

      <div id={SECTION_DOM_IDS.logo}>
        {assets === null ? (
          <div className="rounded-xl border border-border bg-card px-6 py-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-4 h-24 w-32 rounded-lg" />
          </div>
        ) : (
          <LogoSection
            business={business}
            ownerId={ownerId}
            logoAssetId={kit.logoAssetId}
            assets={assets}
            assetsFailed={assetsFailed}
            onSetLogo={(assetId) => save({ ...kit, logoAssetId: assetId })}
            onRemoveLogo={() => save({ ...kit, logoAssetId: null })}
          />
        )}
      </div>

      <div id={SECTION_DOM_IDS.colors}>
        <ColorsSection
          kit={kit}
          editing={editing === 'colors'}
          busy={busy}
          suggestionColors={suggestion?.colors ?? null}
          onEdit={() => setEditing('colors')}
          onCancel={() => setEditing(null)}
          onSave={(colors) => save({ ...kit, colors })}
        />
      </div>

      <div id={SECTION_DOM_IDS.typography}>
        <TypographySection
          kit={kit}
          editing={editing === 'typography'}
          busy={busy}
          detectedFont={suggestion?.fontFamily ?? null}
          onEdit={() => setEditing('typography')}
          onCancel={() => setEditing(null)}
          onSave={(typography) => save({ ...kit, typography })}
        />
      </div>

      <div id={SECTION_DOM_IDS.style}>
        <StyleSection
          kit={kit}
          editing={editing === 'style'}
          busy={busy}
          onEdit={() => setEditing('style')}
          onCancel={() => setEditing(null)}
          onSave={(styleTraits, styleNotes) => save({ ...kit, styleTraits, styleNotes })}
        />
      </div>

      <NotesSection
        kit={kit}
        editing={editing === 'notes'}
        busy={busy}
        onEdit={() => setEditing('notes')}
        onCancel={() => setEditing(null)}
        onSave={(notes) => save({ ...kit, notes })}
      />

      <section>
        <h2 className="mb-2 px-1 text-[13px] font-medium text-muted-foreground">
          {t('brand.boardTitle')}
        </h2>
        <BrandBoard kit={kit} business={business} logoUrl={logoUrl} />
        <p className="mt-2 px-1 text-[12px] text-muted-foreground/80">{t('brand.evaConnection')}</p>
      </section>
    </div>
  )
}

/** Save/Cancel that stays reachable on a phone: sticky above the keyboard. */
function EditBar({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  const { t } = useI18n()
  return (
    <div className="sticky bottom-0 z-10 -mx-6 -mb-5 mt-5 flex items-center gap-2 rounded-b-xl border-t border-border bg-card px-6 py-3 sm:static sm:z-auto sm:mx-0 sm:mb-0 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0">
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? t('common.saving') : t('common.save')}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
        {t('common.cancel')}
      </Button>
    </div>
  )
}

function SectionShell({
  title,
  hint,
  editing,
  onEdit,
  children,
}: {
  title: string
  hint: string
  editing: boolean
  onEdit: () => void
  children: React.ReactNode
}) {
  const { t } = useI18n()
  return (
    <section className="rounded-xl border border-border bg-card px-6 py-5">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{hint}</p>
        </div>
        {editing ? null : (
          <Button variant="ghost" size="sm" onClick={onEdit} className="shrink-0">
            {t('common.edit')}
          </Button>
        )}
      </header>
      {children}
    </section>
  )
}

/* --- Colours ------------------------------------------------------------ */

type ColorRole = 'primary' | 'secondary' | 'accent'
const COLOR_ROLES: ColorRole[] = ['primary', 'secondary', 'accent']

function useColorRoleLabels(): Record<ColorRole, string> {
  const { t } = useI18n()
  return {
    primary: t('brand.colorPrimary'),
    secondary: t('brand.colorSecondary'),
    accent: t('brand.colorAccent'),
  }
}

function ColorsSection({
  kit,
  editing,
  busy,
  suggestionColors,
  onEdit,
  onCancel,
  onSave,
}: {
  kit: BrandKit
  editing: boolean
  busy: boolean
  suggestionColors: string[] | null
  onEdit: () => void
  onCancel: () => void
  onSave: (colors: BrandKit['colors']) => Promise<void>
}) {
  const { t } = useI18n()
  const roleLabel = useColorRoleLabels()

  return (
    <SectionShell
      title={t('brand.colorsTitle')}
      hint={t('brand.colorsHint')}
      editing={editing}
      onEdit={onEdit}
    >
      {editing ? (
        <ColorsForm
          initial={{
            primary: kit.colors.primary ?? suggestionColors?.[0] ?? '',
            secondary: kit.colors.secondary ?? suggestionColors?.[1] ?? '',
            accent: kit.colors.accent ?? suggestionColors?.[2] ?? '',
          }}
          busy={busy}
          onCancel={onCancel}
          onSave={onSave}
        />
      ) : (
        <div className="flex flex-wrap gap-4">
          {COLOR_ROLES.map((role) => {
            const hex = kit.colors[role]
            return (
              <div key={role} className="flex items-center gap-2.5">
                <span
                  className="inline-block size-9 rounded-lg border border-black/10"
                  style={{ backgroundColor: hex ?? 'transparent' }}
                  aria-hidden
                />
                <span className="text-[13px]">
                  <span className="block text-muted-foreground">{roleLabel[role]}</span>
                  <span className={hex ? 'uppercase text-foreground' : 'text-eva-label/80'}>
                    {hex ?? t('business.notKnownYet')}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </SectionShell>
  )
}

function ColorsForm({
  initial,
  busy,
  onCancel,
  onSave,
}: {
  initial: Record<ColorRole, string>
  busy: boolean
  onCancel: () => void
  onSave: (colors: BrandKit['colors']) => Promise<void>
}) {
  const { t } = useI18n()
  const roleLabel = useColorRoleLabels()
  const [draft, setDraft] = useState<Record<ColorRole, string>>(initial)
  const [errors, setErrors] = useState<Partial<Record<ColorRole, boolean>>>({})

  function handleBlur(role: ColorRole) {
    const value = draft[role].trim()
    setErrors((prev) => ({ ...prev, [role]: value !== '' && !normalizeBrandHex(value) }))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const next: Partial<Record<ColorRole, string | null>> = {}
    const nextErrors: Partial<Record<ColorRole, boolean>> = {}
    for (const role of COLOR_ROLES) {
      const value = draft[role].trim()
      if (value === '') {
        next[role] = null
        continue
      }
      const hex = normalizeBrandHex(value)
      if (hex) next[role] = hex
      else nextErrors[role] = true
    }
    setErrors(nextErrors)
    // Invalid values stay visible in their fields; nothing is saved past them.
    if (Object.keys(nextErrors).length > 0) return
    try {
      await onSave({
        primary: next.primary ?? null,
        secondary: next.secondary ?? null,
        accent: next.accent ?? null,
      })
    } catch {
      // The container shows the save error; input stays as typed.
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      {COLOR_ROLES.map((role) => {
        const normalized = normalizeBrandHex(draft[role])
        return (
          <div key={role} className="space-y-1.5">
            <Label htmlFor={`brand-color-${role}`}>{roleLabel[role]}</Label>
            <div className="flex items-center gap-3">
              {/* Native picker; the hex field is the accessible alternative. */}
              <input
                type="color"
                aria-label={roleLabel[role]}
                className="size-11 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent p-1"
                value={normalized ?? '#cccccc'}
                onChange={(event) => {
                  setDraft((prev) => ({ ...prev, [role]: event.target.value }))
                  setErrors((prev) => ({ ...prev, [role]: false }))
                }}
              />
              <Input
                id={`brand-color-${role}`}
                value={draft[role]}
                placeholder="#1A7F5A"
                className="max-w-[10rem]"
                aria-invalid={errors[role] || undefined}
                aria-describedby={errors[role] ? `brand-color-${role}-error` : undefined}
                onChange={(event) => setDraft((prev) => ({ ...prev, [role]: event.target.value }))}
                onBlur={() => handleBlur(role)}
              />
            </div>
            {errors[role] ? (
              <p
                id={`brand-color-${role}-error`}
                role="alert"
                className="text-[13px] text-destructive"
              >
                {t('brand.colorInvalid')}
              </p>
            ) : null}
          </div>
        )
      })}
      <EditBar busy={busy} onCancel={onCancel} />
    </form>
  )
}

/* --- Typography --------------------------------------------------------- */

function TypographySection({
  kit,
  editing,
  busy,
  detectedFont,
  onEdit,
  onCancel,
  onSave,
}: {
  kit: BrandKit
  editing: boolean
  busy: boolean
  detectedFont: string | null
  onEdit: () => void
  onCancel: () => void
  onSave: (typography: BrandKit['typography']) => Promise<void>
}) {
  const { t } = useI18n()
  return (
    <SectionShell
      title={t('brand.typographyTitle')}
      hint={t('brand.typographyHint')}
      editing={editing}
      onEdit={onEdit}
    >
      {editing ? (
        <TypographyForm
          initial={kit.typography}
          busy={busy}
          detectedFont={detectedFont}
          onCancel={onCancel}
          onSave={onSave}
        />
      ) : kit.typography.heading || kit.typography.body ? (
        <div className="space-y-3">
          <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">{t('brand.fontHeading')}</dt>
            <dd className="text-foreground">{kit.typography.heading ?? t('business.notKnownYet')}</dd>
            <dt className="text-muted-foreground">{t('brand.fontBody')}</dt>
            <dd className="text-foreground">{kit.typography.body ?? t('business.notKnownYet')}</dd>
          </dl>
          <FontPairPreview heading={kit.typography.heading} body={kit.typography.body} />
        </div>
      ) : (
        <p className="text-sm text-eva-label/80">{t('business.notKnownYet')}</p>
      )}
    </SectionShell>
  )
}

function FontPairPreview({ heading, body }: { heading: string | null; body: string | null }) {
  const { t } = useI18n()
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <p
        className="text-[17px] font-semibold text-foreground"
        style={heading ? { fontFamily: `'${heading}', sans-serif` } : undefined}
      >
        {t('brand.previewHeading')}
      </p>
      <p
        className="mt-1 text-[13px] text-muted-foreground"
        style={body ? { fontFamily: `'${body}', sans-serif` } : undefined}
      >
        {t('brand.previewBody')}
      </p>
    </div>
  )
}

function TypographyForm({
  initial,
  busy,
  detectedFont,
  onCancel,
  onSave,
}: {
  initial: BrandKit['typography']
  busy: boolean
  detectedFont: string | null
  onCancel: () => void
  onSave: (typography: BrandKit['typography']) => Promise<void>
}) {
  const { t } = useI18n()
  const [heading, setHeading] = useState<BrandFont | ''>(initial.heading ?? '')
  const [body, setBody] = useState<BrandFont | ''>(initial.body ?? '')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await onSave({ heading: heading || null, body: body || null })
    } catch {
      // Container renders the error; the selection stays.
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      <FontSelect
        id="brand-font-heading"
        label={t('brand.fontHeading')}
        value={heading}
        onChange={setHeading}
      />
      <FontSelect id="brand-font-body" label={t('brand.fontBody')} value={body} onChange={setBody} />
      {detectedFont ? (
        <p className="text-[12px] text-muted-foreground">
          {t('brand.detectedFontHint', { font: detectedFont })}
        </p>
      ) : null}
      <FontPairPreview heading={heading || null} body={body || null} />
      <EditBar busy={busy} onCancel={onCancel} />
    </form>
  )
}

function FontSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: BrandFont | ''
  onChange: (value: BrandFont | '') => void
}) {
  const { t } = useI18n()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as BrandFont | '')}
        className="h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        style={value ? { fontFamily: `'${value}', sans-serif` } : undefined}
      >
        <option value="">{t('brand.fontNone')}</option>
        {BRAND_FONTS.map((font) => (
          <option key={font} value={font} style={{ fontFamily: `'${font}', sans-serif` }}>
            {font}
          </option>
        ))}
      </select>
    </div>
  )
}

/* --- Style traits ------------------------------------------------------- */

function StyleSection({
  kit,
  editing,
  busy,
  onEdit,
  onCancel,
  onSave,
}: {
  kit: BrandKit
  editing: boolean
  busy: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (traits: BrandStyleTrait[], styleNotes: string | null) => Promise<void>
}) {
  const { t } = useI18n()
  return (
    <SectionShell
      title={t('brand.styleTitle')}
      hint={t('brand.styleHint')}
      editing={editing}
      onEdit={onEdit}
    >
      {editing ? (
        <StyleForm
          initialTraits={kit.styleTraits}
          initialNotes={kit.styleNotes ?? ''}
          busy={busy}
          onCancel={onCancel}
          onSave={onSave}
        />
      ) : kit.styleTraits.length > 0 || kit.styleNotes ? (
        <div className="space-y-3">
          {kit.styleTraits.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {kit.styleTraits.map((trait) => (
                <li
                  key={trait}
                  className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[13px] text-secondary-foreground"
                >
                  <Check className="size-3" aria-hidden />
                  {t(TRAIT_KEYS[trait])}
                </li>
              ))}
            </ul>
          ) : null}
          {kit.styleNotes ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{kit.styleNotes}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-eva-label/80">{t('business.notKnownYet')}</p>
      )}
    </SectionShell>
  )
}

function StyleForm({
  initialTraits,
  initialNotes,
  busy,
  onCancel,
  onSave,
}: {
  initialTraits: BrandStyleTrait[]
  initialNotes: string
  busy: boolean
  onCancel: () => void
  onSave: (traits: BrandStyleTrait[], styleNotes: string | null) => Promise<void>
}) {
  const { t } = useI18n()
  const [traits, setTraits] = useState<BrandStyleTrait[]>(initialTraits)
  const [styleNotes, setStyleNotes] = useState(initialNotes)
  const [minError, setMinError] = useState(false)

  const atMax = traits.length >= BRAND_TRAITS_MAX

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    // Clearing entirely is allowed; a single trait is not enough to describe
    // a style, so one selection asks for a second rather than saving.
    if (traits.length === 1) {
      setMinError(true)
      return
    }
    try {
      await onSave(traits, styleNotes.trim() || null)
    } catch {
      // Container renders the error; selections stay.
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      <div role="group" aria-label={t('brand.styleTitle')} className="flex flex-wrap gap-1.5">
        {BRAND_STYLE_TRAITS.map((trait) => {
          const selected = traits.includes(trait)
          const disabled = !selected && atMax
          return (
            <button
              key={trait}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => {
                setTraits((prev) => toggleTrait(prev, trait))
                setMinError(false)
              }}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                selected
                  ? 'border-foreground/40 bg-secondary font-medium text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              {selected ? <Check className="size-3.5" aria-hidden /> : null}
              {t(TRAIT_KEYS[trait])}
            </button>
          )
        })}
      </div>
      <p className="text-[12px] text-muted-foreground" aria-live="polite">
        {atMax
          ? t('brand.styleMax')
          : t('brand.styleCount', {
              count: traits.length,
              min: BRAND_TRAITS_MIN,
              max: BRAND_TRAITS_MAX,
            })}
      </p>
      {minError ? (
        <p role="alert" className="text-[13px] text-destructive">
          {t('brand.styleMin')}
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="brand-style-notes">{t('brand.styleNotesLabel')}</Label>
        <Textarea
          id="brand-style-notes"
          rows={2}
          value={styleNotes}
          placeholder={t('brand.styleNotesPlaceholder')}
          onChange={(event) => setStyleNotes(event.target.value)}
        />
      </div>
      <EditBar busy={busy} onCancel={onCancel} />
    </form>
  )
}

/* --- Notes -------------------------------------------------------------- */

function NotesSection({
  kit,
  editing,
  busy,
  onEdit,
  onCancel,
  onSave,
}: {
  kit: BrandKit
  editing: boolean
  busy: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (notes: string | null) => Promise<void>
}) {
  const { t } = useI18n()
  return (
    <SectionShell
      title={t('brand.notesTitle')}
      hint={t('brand.notesHint')}
      editing={editing}
      onEdit={onEdit}
    >
      {editing ? (
        <NotesForm initial={kit.notes ?? ''} busy={busy} onCancel={onCancel} onSave={onSave} />
      ) : kit.notes ? (
        <p className="text-sm leading-relaxed text-foreground">{kit.notes}</p>
      ) : (
        <p className="text-sm text-eva-label/80">{t('brand.notesEmpty')}</p>
      )}
    </SectionShell>
  )
}

function NotesForm({
  initial,
  busy,
  onCancel,
  onSave,
}: {
  initial: string
  busy: boolean
  onCancel: () => void
  onSave: (notes: string | null) => Promise<void>
}) {
  const { t } = useI18n()
  const [notes, setNotes] = useState(initial)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await onSave(notes.trim() || null)
    } catch {
      // Container renders the error; the text stays.
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-2">
      <Label htmlFor="brand-notes" className="sr-only">
        {t('brand.notesTitle')}
      </Label>
      <Textarea
        id="brand-notes"
        rows={3}
        maxLength={BRAND_NOTES_SOFT_CAP}
        value={notes}
        placeholder={t('brand.notesPlaceholder')}
        onChange={(event) => setNotes(event.target.value)}
      />
      {notes.length > BRAND_NOTES_COUNTER_AT ? (
        <p className="text-right text-[12px] text-muted-foreground" aria-live="polite">
          {notes.length}/{BRAND_NOTES_SOFT_CAP}
        </p>
      ) : null}
      <EditBar busy={busy} onCancel={onCancel} />
    </form>
  )
}

/**
 * Turns discovery's `brand.logoUrl` into a real Asset via the existing upload
 * pipeline — the only way a logo file enters the system. Best-effort: many
 * sites' images refuse cross-origin fetches, and that quietly costs only the
 * logo import, never the confirm.
 */
async function importLogoFromUrl(
  url: string,
  ownerId: string,
  businessId: string,
): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    if (!blob.type.startsWith('image/')) return null
    const extension = blob.type.split('/')[1]?.split('+')[0] ?? 'png'
    const file = new File([blob], `logo.${extension}`, { type: blob.type })
    const created = await createAssetFromFile(ownerId, businessId, file)
    await updateAssetMetadata(created.id, { type: 'logo' })
    return created.id
  } catch {
    return null
  }
}
