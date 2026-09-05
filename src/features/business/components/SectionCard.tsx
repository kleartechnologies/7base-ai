import type { ReactNode } from 'react'
import { Check, Globe, Pencil, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/hooks/useI18n'
import { describeSource, sourceTone, type SourceMark } from '@/services/business/brain'

/** Anything that carries provenance: a section, a field stamp, a product. */
export type SourceClaim = SourceMark | null | undefined

/**
 * The frame every Business Brain section shares.
 *
 * Both the onboarding review and the Business tab render the same sections
 * from the same data — there is no second profile system — so the difference
 * between them is only whether editing starts open.
 */
export function SectionCard({
  title,
  hint,
  provenance,
  editing,
  onEdit,
  children,
}: {
  title: string
  hint?: string
  provenance?: SourceClaim
  editing: boolean
  onEdit: () => void
  children: ReactNode
}) {
  const { t } = useI18n()
  return (
    <section className="rounded-xl border border-border bg-card px-6 py-5">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
          {hint ? (
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {provenance ? <SourceBadge provenance={provenance} /> : null}
          {editing ? null : (
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Pencil aria-hidden />
              {t('common.edit')}
            </Button>
          )}
        </div>
      </header>
      {children}
    </section>
  )
}

const TONE_ICON = {
  confirmed: Check,
  sourced: Globe,
  inferred: Sparkles,
} as const

/**
 * Says where one value came from.
 *
 * A fact read off the owner's own website, something MARKA worked out from the
 * tone of the copy, and something the owner has stood behind are three
 * different kinds of claim. Before this was per-value, a whole section could
 * be labelled "MARKA's guess" while half the lines in it were quoted straight
 * from the site — which makes an owner distrust the half that was right.
 *
 * The wording lives in `describeSource` so the Brain and the UI cannot drift.
 */
export function SourceBadge({ provenance }: { provenance: SourceClaim }) {
  // Subscribes to language changes; the wording itself comes from
  // `describeSource`, which resolves through the same i18n store.
  useI18n()
  const label = describeSource(provenance)
  const tone = sourceTone(provenance)
  if (!label || !tone) return null

  const Icon = TONE_ICON[tone]
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  )
}

/**
 * The same statement at field scale: quiet enough to sit on every row without
 * turning the page into a report, loud enough to answer "where did that come
 * from?" without opening anything.
 */
export function SourceTag({ provenance }: { provenance: SourceClaim }) {
  useI18n()
  const label = describeSource(provenance)
  const tone = sourceTone(provenance)
  if (!label || !tone) return null

  const Icon = TONE_ICON[tone]
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground/70"
      title={label}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  )
}

/**
 * A label/value line. Empty values say so plainly rather than disappearing.
 *
 * A field MARKA never found carries no source tag — there is nothing to
 * attribute, and "Not known yet" is already the whole story.
 */
export function Field({
  label,
  value,
  provenance,
}: {
  label: string
  value: string | null | undefined
  provenance?: SourceClaim
}) {
  const { t } = useI18n()
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={value ? 'text-foreground' : 'text-muted-foreground/60'}>
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span>{value || t('business.notKnownYet')}</span>
          {value ? <SourceTag provenance={provenance} /> : null}
        </span>
      </dd>
    </div>
  )
}

/** A titled group of chips, tagged with where the group came from. */
export function ChipGroup({
  label,
  items,
  provenance,
}: {
  label: string
  items: string[]
  provenance?: SourceClaim
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p className="text-[13px] text-muted-foreground">{label}</p>
        {items.length > 0 ? <SourceTag provenance={provenance} /> : null}
      </div>
      <Chips items={items} />
    </div>
  )
}

/** Short list values, shown as calm chips rather than bullet lists. */
export function Chips({ items }: { items: string[] }) {
  const { t } = useI18n()
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground/60">{t('business.notKnownYet')}</p>
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item}
          className="rounded-full bg-secondary px-2.5 py-1 text-[13px] text-secondary-foreground"
        >
          {item}
        </li>
      ))}
    </ul>
  )
}

/** Save / Cancel, identical in every section so editing feels the same. */
export function EditActions({
  busy,
  onCancel,
}: {
  busy: boolean
  onCancel: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="mt-5 flex items-center gap-2">
      <Button type="submit" size="sm" disabled={busy}>
        {t('common.save')}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
        {t('common.cancel')}
      </Button>
    </div>
  )
}
