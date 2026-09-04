import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { ROUTES } from '@/app/routes/paths'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { generateCreativeMaterials } from '@/services/ai/ai.client'
import {
  getCampaign,
  setCampaignStatus,
  updateCampaignContent,
  type CampaignContentPatch,
} from '@/services/campaigns/campaign.service'
import type { Campaign, CampaignChannel, CampaignStatus } from '@/types'

const CHANNELS: { key: CampaignChannel; label: string }[] = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'in_store', label: 'In-store' },
  { key: 'website', label: 'Website' },
]

const STATUSES: { key: CampaignStatus; label: string }[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'ready', label: 'Ready' },
  { key: 'archived', label: 'Archived' },
]

interface FormState {
  name: string
  objective: string
  audience: string
  offer: string
  positioning: string
  keyMessage: string
  callToAction: string
  channels: CampaignChannel[]
  durationDays: string
  notes: string
}

function toForm(campaign: Campaign): FormState {
  return {
    name: campaign.name,
    objective: campaign.objective ?? '',
    audience: campaign.targetAudience?.description ?? '',
    offer: campaign.offer?.description ?? '',
    positioning: campaign.positioning ?? '',
    keyMessage: campaign.keyMessage ?? '',
    callToAction: campaign.callToAction ?? '',
    channels: [...campaign.channels],
    durationDays: campaign.durationDays ? String(campaign.durationDays) : '',
    notes: campaign.notes ?? '',
  }
}

/**
 * One campaign: view it, edit it, or continue the conversation about it.
 *
 * Deliberately a simple form, not a builder. Provenance rules are applied on
 * save: a rewritten audience is the owner's hypothesis (it only counts as
 * "known" when the Business Brain establishes it), a rewritten offer is a
 * recommendation until the Brain records it as something the business sells.
 * Everything saved here lands in `userEdited`, so a later AI edit cannot
 * silently take it back.
 */
export default function CampaignDetailPage() {
  const { campaignId } = useParams<{ campaignId: string }>()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [missing, setMissing] = useState(false)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [materialsError, setMaterialsError] = useState<string | null>(null)
  const [materialsStarted, setMaterialsStarted] = useState(false)

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false
    getCampaign(campaignId)
      .then((loaded) => {
        if (cancelled) return
        if (!loaded) setMissing(true)
        else {
          setCampaign(loaded)
          setForm(toForm(loaded))
        }
      })
      .catch(() => !cancelled && setMissing(true))
    return () => {
      cancelled = true
    }
  }, [campaignId])

  if (missing) {
    return (
      <div className="mx-auto w-full max-w-2xl px-8 py-12">
        <p className="text-[14px] text-muted-foreground">
          This campaign doesn’t exist or isn’t yours.
        </p>
        <Button className="mt-4" size="sm" variant="outline" asChild>
          <Link to={ROUTES.campaigns}>Back to campaigns</Link>
        </Button>
      </div>
    )
  }

  if (!campaign || !form) {
    return (
      <div className="mx-auto w-full max-w-2xl px-8 py-12">
        <p className="text-[14px] text-muted-foreground">Loading…</p>
      </div>
    )
  }

  const set = (patch: Partial<FormState>) => {
    setForm({ ...form, ...patch })
    setSaved(false)
  }

  async function handleSave() {
    if (!campaign || !form) return
    setSaving(true)
    setError(null)

    const clean = (value: string) => value.trim() || null
    const duration = Math.round(Number(form.durationDays))
    const audience = clean(form.audience)
    const offer = clean(form.offer)

    const patch: CampaignContentPatch = {
      ...(form.name.trim() ? { name: form.name.trim() } : {}),
      objective: clean(form.objective),
      // Basis is never upgraded by an edit: a changed audience is the owner's
      // hypothesis, a changed offer is a recommendation. Unchanged text keeps
      // the provenance it already earned.
      targetAudience:
        audience === (campaign.targetAudience?.description ?? null)
          ? campaign.targetAudience
          : audience
            ? { description: audience, basis: 'hypothesis' }
            : null,
      offer:
        offer === (campaign.offer?.description ?? null)
          ? campaign.offer
          : offer
            ? { description: offer, basis: 'recommendation' }
            : null,
      positioning: clean(form.positioning),
      keyMessage: clean(form.keyMessage),
      callToAction: clean(form.callToAction),
      channels: form.channels,
      durationDays:
        Number.isFinite(duration) && duration > 0 ? Math.min(duration, 90) : null,
      notes: clean(form.notes),
    }

    try {
      await updateCampaignContent(campaign, patch)
      const reloaded = await getCampaign(campaign.id)
      if (reloaded) {
        setCampaign(reloaded)
        setForm(toForm(reloaded))
      }
      setSaved(true)
    } catch {
      setError('Could not save the campaign. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatus(status: CampaignStatus) {
    if (!campaign || status === campaign.status) return
    try {
      await setCampaignStatus(campaign.id, status)
      setCampaign({ ...campaign, status })
    } catch {
      // The buttons reflect `campaign.status`, so a failed write leaves them
      // truthful — but the click must not vanish without a word.
      setError('Could not update the campaign status. Please try again.')
    }
  }

  async function handleCreateMaterials() {
    if (!campaign) return
    setCreating(true)
    setMaterialsError(null)
    setMaterialsStarted(false)
    const result = await generateCreativeMaterials({ campaignId: campaign.id })
    setCreating(false)
    if (!result.ok) setMaterialsError(result.error.message)
    else setMaterialsStarted(true)
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-8 py-12">
      <Link
        to={ROUTES.campaigns}
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Campaigns
      </Link>

      <header className="mt-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Campaign
          </p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.01em] text-foreground">
            {campaign.name}
          </h1>
        </div>
        <div className="flex gap-1.5 pt-1">
          {STATUSES.map((status) => (
            <Button
              key={status.key}
              size="sm"
              variant={campaign.status === status.key ? 'secondary' : 'ghost'}
              onClick={() => void handleStatus(status.key)}
            >
              {status.label}
            </Button>
          ))}
        </div>
      </header>

      <div className="mt-8 space-y-5">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Objective">
          <Textarea
            rows={2}
            value={form.objective}
            onChange={(e) => set({ objective: e.target.value })}
          />
        </Field>
        <Field
          label="Target audience"
          tag={
            campaign.targetAudience
              ? campaign.targetAudience.basis === 'known'
                ? 'Known'
                : 'Hypothesis'
              : undefined
          }
        >
          <Textarea
            rows={2}
            value={form.audience}
            onChange={(e) => set({ audience: e.target.value })}
          />
        </Field>
        <Field
          label="Offer"
          tag={
            campaign.offer
              ? campaign.offer.basis === 'existing'
                ? 'Existing'
                : 'Recommendation'
              : undefined
          }
        >
          <Textarea rows={2} value={form.offer} onChange={(e) => set({ offer: e.target.value })} />
        </Field>
        <Field label="Positioning">
          <Textarea
            rows={2}
            value={form.positioning}
            onChange={(e) => set({ positioning: e.target.value })}
          />
        </Field>
        <Field label="Key message">
          <Textarea
            rows={2}
            value={form.keyMessage}
            onChange={(e) => set({ keyMessage: e.target.value })}
          />
        </Field>
        <Field label="Call to action">
          <Input
            value={form.callToAction}
            onChange={(e) => set({ callToAction: e.target.value })}
          />
        </Field>
        <Field label="Channels">
          <div className="flex flex-wrap gap-1.5">
            {CHANNELS.map((channel) => {
              const active = form.channels.includes(channel.key)
              return (
                <Button
                  key={channel.key}
                  type="button"
                  size="sm"
                  variant={active ? 'secondary' : 'outline'}
                  onClick={() =>
                    set({
                      channels: active
                        ? form.channels.filter((c) => c !== channel.key)
                        : [...form.channels, channel.key],
                    })
                  }
                >
                  {channel.label}
                </Button>
              )
            })}
          </div>
        </Field>
        <Field label="Duration (days)">
          <Input
            inputMode="numeric"
            className="max-w-[120px]"
            value={form.durationDays}
            onChange={(e) => set({ durationDays: e.target.value })}
          />
        </Field>
        <Field label="Notes">
          <Textarea rows={3} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </div>

      {campaign.assumptions.length > 0 ? (
        <ListSection title="Assumptions this campaign relies on" items={campaign.assumptions} />
      ) : null}
      {campaign.unknowns.length > 0 ? (
        <ListSection title="Still unknown — confirm before launch" items={campaign.unknowns} />
      ) : null}

      <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-border pt-5">
        <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
        </Button>
        {campaign.conversationId ? (
          <Button size="sm" variant="outline" asChild>
            <Link to={ROUTES.conversation(campaign.conversationId)}>Continue in chat</Link>
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleCreateMaterials()}
          disabled={creating}
        >
          {creating ? 'Creating your marketing materials…' : 'Create Marketing Materials'}
        </Button>
      </div>
      {creating ? (
        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
          EVA is writing your copy and preparing the poster — this can take a minute or two.
        </p>
      ) : null}
      {materialsStarted ? (
        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
          Your marketing materials are ready — they’re waiting in the conversation.{' '}
          {campaign.conversationId ? (
            <Link
              to={ROUTES.conversation(campaign.conversationId)}
              className="font-medium text-foreground underline underline-offset-2"
            >
              Open the chat to see them.
            </Link>
          ) : null}
        </p>
      ) : null}
      {materialsError ? (
        <p className="mt-3 text-[13px] text-destructive">{materialsError}</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function Field({
  label,
  tag,
  children,
}: {
  label: string
  tag?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-2 text-[12px] text-muted-foreground">
        {label}
        {tag ? (
          <span className="rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground">
            {tag}
          </span>
        ) : null}
      </Label>
      {children}
    </div>
  )
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-8">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="text-[13px] leading-relaxed text-muted-foreground">
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
