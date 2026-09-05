import { useState, type FormEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/hooks/useI18n'
import type { Business } from '@/types'
import type { BusinessFacts } from '@/services/business/brain'
import { EditActions, Field, SectionCard } from './SectionCard'
import { trimmedOrNull } from './fields'

/**
 * "Your Business" — the plain facts MARKA read off the site.
 *
 * Editing writes back through `saveBusinessFacts`, which stamps every field
 * the owner actually changed as theirs. That stamp is what stops a later
 * re-analysis from undoing a correction.
 *
 * Provenance is per field, not per section: MARKA typically reads the name and
 * phone straight off the page but infers the cuisine from the menu, and one
 * badge over the whole card cannot say both.
 */
export function BusinessSection({
  business,
  startOpen = false,
  onSave,
}: {
  business: Business
  startOpen?: boolean
  onSave: (facts: BusinessFacts) => Promise<void>
}) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(startOpen)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState(() => toForm(business))

  function open() {
    setForm(toForm(business))
    setEditing(true)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await onSave(toFacts(business, form))
      setEditing(false)
    } catch {
      // The message is rendered by the Brain container; keep the form open so
      // the owner does not lose what they typed.
    } finally {
      setBusy(false)
    }
  }

  const location = [business.location.city, business.location.state].filter(Boolean).join(', ')
  const provenance = business.provenance

  return (
    <SectionCard
      title={t('business.sectionBusinessTitle')}
      hint={t('business.sectionBusinessHint')}
      editing={editing}
      onEdit={open}
    >
      {editing ? (
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Text id="brain-name" label={t('business.fieldBusinessName')} value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Text id="brain-kind" label={t('business.fieldKind')} value={form.businessType} placeholder={t('business.fieldKindPlaceholder')} onChange={(v) => setForm({ ...form, businessType: v })} />
            <Text id="brain-cuisine" label={t('business.fieldCuisine')} value={form.subIndustry} placeholder={t('business.fieldCuisinePlaceholder')} onChange={(v) => setForm({ ...form, subIndustry: v })} />
            <Text id="brain-city" label={t('business.fieldCity')} value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
            <Text id="brain-state" label={t('business.fieldState')} value={form.state} onChange={(v) => setForm({ ...form, state: v })} />
            <Text id="brain-phone" label={t('business.fieldPhone')} value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
            <Text id="brain-email" label={t('business.fieldEmail')} value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            <Text id="brain-hours" label={t('business.fieldOpeningHours')} value={form.openingHours} placeholder={t('business.fieldOpeningHoursPlaceholder')} onChange={(v) => setForm({ ...form, openingHours: v })} />
          </div>

          <div className="mt-4 space-y-2">
            <Label htmlFor="brain-description">{t('business.fieldWhatItDoes')}</Label>
            <Textarea
              id="brain-description"
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </div>

          <EditActions busy={busy} onCancel={() => setEditing(false)} />
        </form>
      ) : (
        <dl className="divide-y divide-border">
          <Field label={t('business.labelName')} value={business.name} provenance={provenance.name} />
          <Field
            label={t('business.labelType')}
            value={business.identity.businessType ?? business.identity.category}
            provenance={
              business.identity.businessType
                ? provenance['identity.businessType']
                : provenance['identity.category']
            }
          />
          <Field
            label={t('business.fieldCuisine')}
            value={business.identity.subIndustry}
            provenance={provenance['identity.subIndustry']}
          />
          <Field
            label={t('business.labelWhatYouDo')}
            value={business.identity.description}
            provenance={provenance['identity.description']}
          />
          <Field
            label={t('business.labelLocation')}
            value={location || null}
            provenance={provenance['location.city'] ?? provenance['location.state']}
          />
          <Field
            label={t('business.fieldOpeningHours')}
            value={business.location.openingHours}
            provenance={provenance['location.openingHours']}
          />
          <Field label={t('business.fieldPhone')} value={business.contact.phone} provenance={provenance['contact.phone']} />
          <Field label={t('business.labelWebsite')} value={business.contact.website} />
        </dl>
      )}
    </SectionCard>
  )
}

function Text({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  /** Stable, language-independent input id — labels change with the UI language. */
  id: string
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

interface FactForm {
  name: string
  businessType: string
  subIndustry: string
  description: string
  city: string
  state: string
  phone: string
  email: string
  openingHours: string
}

function toForm(business: Business): FactForm {
  return {
    name: business.name,
    businessType: business.identity.businessType ?? '',
    subIndustry: business.identity.subIndustry ?? '',
    description: business.identity.description ?? '',
    city: business.location.city ?? '',
    state: business.location.state ?? '',
    phone: business.contact.phone ?? '',
    email: business.contact.email ?? '',
    openingHours: business.location.openingHours ?? '',
  }
}

function toFacts(business: Business, form: FactForm): BusinessFacts {
  return {
    name: form.name.trim() || business.name,
    identity: {
      ...business.identity,
      businessType: trimmedOrNull(form.businessType),
      subIndustry: trimmedOrNull(form.subIndustry),
      description: trimmedOrNull(form.description),
    },
    contact: {
      ...business.contact,
      phone: trimmedOrNull(form.phone),
      email: trimmedOrNull(form.email),
    },
    location: {
      ...business.location,
      city: trimmedOrNull(form.city),
      state: trimmedOrNull(form.state),
      openingHours: trimmedOrNull(form.openingHours),
    },
  }
}
