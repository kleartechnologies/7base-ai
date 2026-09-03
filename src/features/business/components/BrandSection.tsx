import { useState, type FormEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Business, BrandProfile, MarketingProfile } from '@/types'
import { ChipGroup, EditActions, Field, SectionCard } from './SectionCard'
import { fromLines, toLines, trimmedOrNull } from './fields'

/**
 * "Your brand" — how the business sounds and what it stands for.
 *
 * Brand and positioning are shown together because that is how an owner thinks
 * about them, even though they are stored as two sections with their own
 * provenance — brand voice and personality come from `brand`, everything about
 * positioning comes from `marketing`.
 *
 * That split is why this card carries no single badge. Labelling the whole
 * thing with the brand section's source said "MARKA's guess" over lines that
 * were quoted from the owner's own homepage, which is the fastest way to make
 * someone stop believing the parts MARKA got right. Each line says for itself
 * where it came from.
 */
export function BrandSection({
  business,
  startOpen = false,
  onSave,
}: {
  business: Business
  startOpen?: boolean
  onSave: (brand: BrandProfile, marketing: MarketingProfile) => Promise<void>
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
      await onSave(toBrand(business, form), toMarketing(business, form))
      setEditing(false)
    } catch {
      // The message is rendered by the Brain container; keep the form open so
      // the owner does not lose what they typed.
    } finally {
      setBusy(false)
    }
  }

  const brand = business.brand?.value
  const marketing = business.marketing?.value

  return (
    <SectionCard
      title="Your brand"
      hint="How MARKA will sound when it writes as you."
      editing={editing}
      onEdit={open}
    >
      {editing ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="brand-voice">Brand voice</Label>
            <Input
              id="brand-voice"
              value={form.voice}
              placeholder="Warm and family-friendly"
              onChange={(event) => setForm({ ...form, voice: event.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="brand-positioning">Positioning</Label>
            <Textarea
              id="brand-positioning"
              rows={2}
              value={form.positioning}
              placeholder="The neighbourhood spot for a proper weekday lunch"
              onChange={(event) => setForm({ ...form, positioning: event.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="brand-traits">Personality — one per line</Label>
            <Textarea
              id="brand-traits"
              rows={3}
              value={form.personality}
              onChange={(event) => setForm({ ...form, personality: event.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="brand-differentiators">What sets you apart — one per line</Label>
            <Textarea
              id="brand-differentiators"
              rows={3}
              value={form.differentiators}
              onChange={(event) => setForm({ ...form, differentiators: event.target.value })}
            />
          </div>

          <EditActions busy={busy} onCancel={() => setEditing(false)} />
        </form>
      ) : (
        <div className="space-y-4">
          <dl className="divide-y divide-border">
            <Field label="Voice" value={brand?.voice} provenance={business.brand} />
            <Field label="Positioning" value={marketing?.positioning} provenance={business.marketing} />
            <Field
              label="Value proposition"
              value={marketing?.valueProposition}
              provenance={business.marketing}
            />
          </dl>
          <ChipGroup
            label="Personality"
            items={brand?.personalityTraits ?? []}
            provenance={business.brand}
          />
          <ChipGroup
            label="What sets you apart"
            items={marketing?.differentiators ?? []}
            provenance={business.marketing}
          />
          {marketing?.promotions.length ? (
            <ChipGroup
              label="Running now"
              items={marketing.promotions}
              provenance={business.marketing}
            />
          ) : null}
        </div>
      )}
    </SectionCard>
  )
}

interface BrandForm {
  voice: string
  personality: string
  positioning: string
  differentiators: string
}

function toForm(business: Business): BrandForm {
  return {
    voice: business.brand?.value.voice ?? '',
    personality: toLines(business.brand?.value.personalityTraits),
    positioning: business.marketing?.value.positioning ?? '',
    differentiators: toLines(business.marketing?.value.differentiators),
  }
}

function toBrand(business: Business, form: BrandForm): BrandProfile {
  return {
    voice: trimmedOrNull(form.voice),
    personalityTraits: fromLines(form.personality),
    colors: business.brand?.value.colors ?? [],
    logoUrl: business.brand?.value.logoUrl ?? null,
    fontFamily: business.brand?.value.fontFamily ?? null,
    visualStyle: business.brand?.value.visualStyle ?? null,
    keyMessages: business.brand?.value.keyMessages ?? [],
    valuePropositions: business.brand?.value.valuePropositions ?? [],
  }
}

function toMarketing(business: Business, form: BrandForm): MarketingProfile {
  const existing = business.marketing?.value
  return {
    positioning: trimmedOrNull(form.positioning),
    valueProposition: existing?.valueProposition ?? null,
    differentiators: fromLines(form.differentiators),
    competitors: existing?.competitors ?? [],
    activeChannels: existing?.activeChannels ?? [],
    pastActivity: existing?.pastActivity ?? null,
    promotions: existing?.promotions ?? [],
    callsToAction: existing?.callsToAction ?? [],
    themes: existing?.themes ?? [],
    emphasizedProducts: existing?.emphasizedProducts ?? [],
  }
}
