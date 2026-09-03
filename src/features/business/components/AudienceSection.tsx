import { useState, type FormEvent } from 'react'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Audience, Business } from '@/types'
import { Chips, EditActions, SectionCard } from './SectionCard'
import { fromLines, toLines, trimmedOrNull } from './fields'

/**
 * "Who MARKA thinks your customers are".
 *
 * Deliberately framed as a reading rather than a finding: a website almost
 * never states who its customers are, so this section is inference and the
 * heading says so.
 */
export function AudienceSection({
  business,
  startOpen = false,
  onSave,
}: {
  business: Business
  startOpen?: boolean
  onSave: (audience: Audience) => Promise<void>
}) {
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
      await onSave(toAudience(business, form))
      setEditing(false)
    } catch {
      // The message is rendered by the Brain container; keep the form open so
      // the owner does not lose what they typed.
    } finally {
      setBusy(false)
    }
  }

  const audience = business.audience?.value

  return (
    <SectionCard
      title="Who MARKA thinks your customers are"
      hint="A first guess from your website. Correct it and MARKA will keep your version."
      provenance={business.audience}
      editing={editing}
      onEdit={open}
    >
      {editing ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="audience-summary">In a sentence</Label>
            <Textarea
              id="audience-summary"
              rows={2}
              value={form.summary}
              onChange={(event) => setForm({ ...form, summary: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audience-types">Customer types — one per line</Label>
            <Textarea
              id="audience-types"
              rows={4}
              value={form.customerTypes}
              onChange={(event) => setForm({ ...form, customerTypes: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audience-needs">What they come for — one per line</Label>
            <Textarea
              id="audience-needs"
              rows={3}
              value={form.needs}
              onChange={(event) => setForm({ ...form, needs: event.target.value })}
            />
          </div>
          <EditActions busy={busy} onCancel={() => setEditing(false)} />
        </form>
      ) : (
        <div className="space-y-4">
          <p className={audience?.summary ? 'text-sm text-foreground' : 'text-sm text-muted-foreground/60'}>
            {audience?.summary ?? 'Not known yet'}
          </p>
          <div className="space-y-2">
            <p className="text-[13px] text-muted-foreground">Customer types</p>
            <Chips items={audience?.customerTypes ?? []} />
          </div>
          {audience?.needs.length ? (
            <div className="space-y-2">
              <p className="text-[13px] text-muted-foreground">What they come for</p>
              <Chips items={audience.needs} />
            </div>
          ) : null}
        </div>
      )}
    </SectionCard>
  )
}

interface AudienceForm {
  summary: string
  customerTypes: string
  needs: string
}

function toForm(business: Business): AudienceForm {
  return {
    summary: business.audience?.value.summary ?? '',
    customerTypes: toLines(business.audience?.value.customerTypes),
    needs: toLines(business.audience?.value.needs),
  }
}

function toAudience(business: Business, form: AudienceForm): Audience {
  const existing = business.audience?.value
  return {
    summary: trimmedOrNull(form.summary),
    segments: existing?.segments ?? [],
    customerTypes: fromLines(form.customerTypes),
    demographics: existing?.demographics ?? [],
    useCases: existing?.useCases ?? [],
    needs: fromLines(form.needs),
    preferences: existing?.preferences ?? [],
  }
}
