import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Plus } from 'lucide-react'
import { ROUTES } from '@/app/routes/paths'
import { EvaSpark } from '@/components/EvaMark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  campaignCreatives,
  campaignDuration,
  campaignProgress,
  workspaceSuggestion,
} from '@/features/campaigns/workspace'
import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/hooks/useI18n'
import type { MessageKey } from '@/i18n/translate'
import { generateCreativeMaterials } from '@/services/ai/ai.client'
import {
  getCampaign,
  setCampaignStatus,
  updateCampaignContent,
  type CampaignContentPatch,
} from '@/services/campaigns/campaign.service'
import { observeCreatives } from '@/services/creatives/creative.service'
import { getAssetUrl } from '@/services/storage/storage.service'
import type { Campaign, CampaignChannel, CampaignStatus, Creative } from '@/types'

// Proper nouns read the same in every language; only in-store and website
// are real words that translate.
const CHANNEL_PROPER_NOUNS: Partial<Record<CampaignChannel, string>> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
}

const CHANNEL_KEYS: CampaignChannel[] = [
  'facebook',
  'instagram',
  'whatsapp',
  'tiktok',
  'in_store',
  'website',
]

const STATUSES: { key: CampaignStatus; labelKey: MessageKey }[] = [
  { key: 'draft', labelKey: 'campaign.statusDraft' },
  { key: 'ready', labelKey: 'campaign.statusReady' },
  { key: 'archived', labelKey: 'campaign.statusArchived' },
]

const STATUS_LABEL_KEYS: Record<CampaignStatus, MessageKey> = {
  draft: 'campaign.statusDraft',
  ready: 'campaign.statusReady',
  archived: 'campaign.statusArchived',
}

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
 * The Campaign Workspace: strategy plus workbench for one campaign.
 *
 * The page answers, top to bottom: what is this campaign, what's the strategy,
 * what creative exists for it, how far along is it, and what should happen
 * next. Everything shown is real stored data — no metrics, no publishing
 * states, no invented lifecycle.
 *
 * Editing stays the same deliberately simple form as before. Provenance rules
 * are applied on save: a rewritten audience is the owner's hypothesis (it only
 * counts as "known" when the Business Brain establishes it), a rewritten offer
 * is a recommendation until the Brain records it. Everything saved here lands
 * in `userEdited`, so a later AI edit cannot silently take it back.
 *
 * "Create creative with EVA" calls the existing server pipeline, which alone
 * assembles Business Brain + Brand Identity + campaign + Assets — the request
 * carries only the campaign id, and the server's in-flight lock absorbs
 * repeated clicks.
 */
export default function CampaignDetailPage() {
  const { t, language } = useI18n()
  const { user } = useAuth()
  const { campaignId } = useParams<{ campaignId: string }>()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [missing, setMissing] = useState(false)
  const [form, setForm] = useState<FormState | null>(null)
  // The page opens as strategy to read; the form appears only on request.
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [materialsError, setMaterialsError] = useState<string | null>(null)
  const [materialsStarted, setMaterialsStarted] = useState(false)
  const [allCreatives, setAllCreatives] = useState<Creative[] | null>(null)
  const [creativesFailed, setCreativesFailed] = useState(false)

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

  // The owner-scoped listener the Creative gallery already uses; the campaign
  // filter happens in memory, so no new query shape or index is needed, and a
  // creative EVA is generating right now appears here live.
  useEffect(() => {
    if (!user) return
    return observeCreatives(
      user.uid,
      (next) => {
        setAllCreatives(next)
        setCreativesFailed(false)
      },
      () => setCreativesFailed(true),
    )
  }, [user])

  if (missing) {
    return (
      <div className="mx-auto w-full max-w-3xl px-8 py-12">
        <p className="text-[14px] text-muted-foreground">{t('campaign.notFound')}</p>
        <Button className="mt-4" size="sm" variant="outline" asChild>
          <Link to={ROUTES.campaigns}>{t('campaign.backToCampaigns')}</Link>
        </Button>
      </div>
    )
  }

  if (!campaign || !form) {
    return (
      <div className="mx-auto w-full max-w-3xl px-8 py-12">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-6 h-7 w-64" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full" />
        <div className="mt-10 rounded-xl border border-border bg-card px-6 py-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-4 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-3/4" />
        </div>
      </div>
    )
  }

  const archived = campaign.status === 'archived'
  const creatives = campaignCreatives(allCreatives, campaign.id)
  const progress = campaignProgress(campaign, creatives ? creatives.length : null)
  const suggestion = editing
    ? null
    : workspaceSuggestion(campaign, creatives ? creatives.length : null)
  const timing = campaignDuration(campaign)
  const purpose = campaign.objective ?? campaign.keyMessage

  const formatDate = (millis: number) =>
    new Date(millis).toLocaleDateString(language === 'ms' ? 'ms-MY' : 'en-MY', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  const channelLabel = (channel: CampaignChannel) =>
    channel === 'in_store'
      ? t('campaign.channelInStore')
      : channel === 'website'
        ? t('campaign.channelWebsite')
        : (CHANNEL_PROPER_NOUNS[channel] ?? channel)

  const set = (patch: Partial<FormState>) => {
    setForm({ ...form, ...patch })
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
      // The workspace must show the saved campaign, not the optimistic form.
      const reloaded = await getCampaign(campaign.id)
      if (reloaded) {
        setCampaign(reloaded)
        setForm(toForm(reloaded))
      }
      setEditing(false)
    } catch {
      setError(t('campaign.saveFailed'))
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
      setError(t('campaign.statusUpdateFailed'))
    }
  }

  async function handleCreateCreative() {
    if (!campaign || creating) return
    setCreating(true)
    setMaterialsError(null)
    setMaterialsStarted(false)
    const result = await generateCreativeMaterials({ campaignId: campaign.id })
    setCreating(false)
    if (!result.ok) setMaterialsError(result.error.message)
    else setMaterialsStarted(true)
  }

  const createButton = (labelKey: MessageKey, variant?: 'outline') => (
    <Button
      size="sm"
      variant={variant}
      onClick={() => void handleCreateCreative()}
      disabled={creating}
    >
      {creating ? t('campaign.creatingMaterials') : t(labelKey)}
    </Button>
  )

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-12">
      <Link
        to={ROUTES.campaigns}
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {t('campaign.pageTitle')}
      </Link>

      {/* --- Header: what is this campaign, at a glance ------------------- */}
      <header className="mt-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {t('campaign.title')}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-foreground">
            {campaign.name}
          </h1>
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {t(STATUS_LABEL_KEYS[campaign.status])}
          </span>
        </div>
        {purpose ? (
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
            {purpose}
          </p>
        ) : null}
        {timing ? (
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {timing.type === 'range'
              ? `${formatDate(timing.start)} – ${formatDate(timing.end)}`
              : t('campaign.durationDays', { days: timing.days })}
          </p>
        ) : null}

        {!editing ? (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {!archived ? createButton('campaign.createWithEva') : null}
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              {t('campaign.editCampaign')}
            </Button>
            {campaign.conversationId ? (
              <Button size="sm" variant="outline" asChild>
                <Link to={ROUTES.conversation(campaign.conversationId)}>
                  {t('campaign.continueInChat')}
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}

        {!editing ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-muted-foreground">
              {t('campaign.statusLabel')}
            </span>
            <div className="flex gap-1" role="group" aria-label={t('campaign.statusLabel')}>
              {STATUSES.map((status) => (
                <Button
                  key={status.key}
                  size="sm"
                  variant={campaign.status === status.key ? 'secondary' : 'ghost'}
                  aria-pressed={campaign.status === status.key}
                  onClick={() => void handleStatus(status.key)}
                >
                  {t(status.labelKey)}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </header>

      {creating ? (
        <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
          {t('campaign.materialsPreparing')}
        </p>
      ) : null}
      {materialsStarted ? (
        <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
          {t('campaign.materialsInWorkbench')}
        </p>
      ) : null}
      {materialsError ? (
        <p role="alert" className="mt-4 text-[13px] text-destructive">
          {materialsError}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}

      {/* --- Strategy: read by default, the same form on request ---------- */}
      <section className="mt-10">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {t('campaign.strategyTitle')}
        </h2>

        {!editing ? (
          <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <ReadRow label={t('campaign.objective')} value={campaign.objective} />
            <ReadRow
              label={t('campaign.fieldTargetAudience')}
              value={campaign.targetAudience?.description}
              tag={
                campaign.targetAudience
                  ? campaign.targetAudience.basis === 'known'
                    ? t('campaign.tagKnown')
                    : t('campaign.tagHypothesis')
                  : undefined
              }
            />
            <ReadRow
              label={t('campaign.offer')}
              value={campaign.offer?.description}
              tag={
                campaign.offer
                  ? campaign.offer.basis === 'existing'
                    ? t('campaign.tagExisting')
                    : t('campaign.tagRecommendation')
                  : undefined
              }
            />
            <ReadRow label={t('campaign.fieldPositioning')} value={campaign.positioning} />
            <ReadRow label={t('campaign.fieldKeyMessage')} value={campaign.keyMessage} />
            <ReadRow label={t('campaign.callToAction')} value={campaign.callToAction} />
            <ReadRow
              label={t('campaign.channels')}
              value={
                campaign.channels.length > 0
                  ? campaign.channels.map(channelLabel).join(' · ')
                  : null
              }
            />
            <ReadRow
              label={t('campaign.fieldDuration')}
              value={
                campaign.durationDays
                  ? t('campaign.durationDays', { days: campaign.durationDays })
                  : null
              }
            />
            <div className="sm:col-span-2">
              <ReadRow label={t('campaign.fieldNotes')} value={campaign.notes} />
            </div>
          </dl>
        ) : (
          <div className="mt-4 space-y-5">
            <Field label={t('campaign.fieldName')}>
              <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label={t('campaign.objective')}>
              <Textarea
                rows={2}
                value={form.objective}
                onChange={(e) => set({ objective: e.target.value })}
              />
            </Field>
            <Field
              label={t('campaign.fieldTargetAudience')}
              tag={
                campaign.targetAudience
                  ? campaign.targetAudience.basis === 'known'
                    ? t('campaign.tagKnown')
                    : t('campaign.tagHypothesis')
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
              label={t('campaign.offer')}
              tag={
                campaign.offer
                  ? campaign.offer.basis === 'existing'
                    ? t('campaign.tagExisting')
                    : t('campaign.tagRecommendation')
                  : undefined
              }
            >
              <Textarea
                rows={2}
                value={form.offer}
                onChange={(e) => set({ offer: e.target.value })}
              />
            </Field>
            <Field label={t('campaign.fieldPositioning')}>
              <Textarea
                rows={2}
                value={form.positioning}
                onChange={(e) => set({ positioning: e.target.value })}
              />
            </Field>
            <Field label={t('campaign.fieldKeyMessage')}>
              <Textarea
                rows={2}
                value={form.keyMessage}
                onChange={(e) => set({ keyMessage: e.target.value })}
              />
            </Field>
            <Field label={t('campaign.callToAction')}>
              <Input
                value={form.callToAction}
                onChange={(e) => set({ callToAction: e.target.value })}
              />
            </Field>
            <Field label={t('campaign.channels')}>
              <div className="flex flex-wrap gap-1.5">
                {CHANNEL_KEYS.map((channel) => {
                  const active = form.channels.includes(channel)
                  return (
                    <Button
                      key={channel}
                      type="button"
                      size="sm"
                      variant={active ? 'secondary' : 'outline'}
                      aria-pressed={active}
                      onClick={() =>
                        set({
                          channels: active
                            ? form.channels.filter((c) => c !== channel)
                            : [...form.channels, channel],
                        })
                      }
                    >
                      {channelLabel(channel)}
                    </Button>
                  )
                })}
              </div>
            </Field>
            <Field label={t('campaign.fieldDuration')}>
              <Input
                inputMode="numeric"
                className="max-w-[120px]"
                value={form.durationDays}
                onChange={(e) => set({ durationDays: e.target.value })}
              />
            </Field>
            <Field label={t('campaign.fieldNotes')}>
              <Textarea
                rows={3}
                value={form.notes}
                onChange={(e) => set({ notes: e.target.value })}
              />
            </Field>

            <div className="flex items-center gap-2 border-t border-border pt-4">
              <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                {saving ? t('common.saving') : t('campaign.saveChanges')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setForm(toForm(campaign))
                  setEditing(false)
                  setError(null)
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
      </section>

      {campaign.assumptions.length > 0 || campaign.unknowns.length > 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-border px-5 py-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {t('campaign.worthConfirming')}
          </p>
          {campaign.assumptions.length > 0 ? (
            <ListSection title={t('campaign.assumptionsTitle')} items={campaign.assumptions} />
          ) : null}
          {campaign.unknowns.length > 0 ? (
            <ListSection title={t('campaign.unknownsTitle')} items={campaign.unknowns} />
          ) : null}
        </div>
      ) : null}

      {!editing ? (
        <>
          {/* --- Creative workbench: what has actually been made ---------- */}
          <section className="mt-10">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {t('campaign.workbenchTitle')}
            </h2>

            {creativesFailed ? (
              <p role="alert" className="mt-4 text-[14px] leading-relaxed text-destructive">
                {t('creative.listLoadFailed')}
              </p>
            ) : creatives === null ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Skeleton className="h-40 rounded-xl" />
                <Skeleton className="h-40 rounded-xl" />
              </div>
            ) : creatives.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-border px-6 py-8 text-center">
                <p className="text-[14px] font-medium text-foreground">
                  {t('campaign.workbenchEmptyTitle')}
                </p>
                <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                  {campaign.status === 'ready'
                    ? t('campaign.workbenchEmptyReady')
                    : t('campaign.workbenchEmptyBody')}
                </p>
                {!archived ? (
                  <div className="mt-4 flex justify-center">
                    {createButton('campaign.createWithEva')}
                  </div>
                ) : null}
              </div>
            ) : (
              <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                {creatives.map((creative) => (
                  <li key={creative.id}>
                    <WorkbenchCreativeCard creative={creative} />
                  </li>
                ))}
                {!archived ? (
                  <li>
                    <button
                      type="button"
                      onClick={() => void handleCreateCreative()}
                      disabled={creating}
                      className="flex h-full min-h-40 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border p-6 text-center transition-colors hover:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Plus className="size-4 text-muted-foreground" aria-hidden />
                      <span className="text-[13px] font-medium text-foreground">
                        {creating
                          ? t('campaign.creatingMaterials')
                          : t('campaign.createAnotherWithEva')}
                      </span>
                    </button>
                  </li>
                ) : null}
              </ul>
            )}
          </section>

          {/* --- Progress: a UX aid derived from real state only ---------- */}
          {!archived ? (
            <section className="mt-10 rounded-xl border border-border bg-card px-6 py-5">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {t('campaign.progressTitle')}
              </h2>
              <ul className="mt-3 space-y-2">
                <ProgressRow done={progress.strategy} label={t('campaign.progressStrategy')} />
                <ProgressRow done={progress.ready} label={t('campaign.progressReady')} />
                <ProgressRow done={progress.creative} label={t('campaign.progressCreative')} />
              </ul>
            </section>
          ) : null}

          {/* --- One deterministic EVA suggestion — no AI call ------------ */}
          {suggestion ? (
            <section className="mt-6 rounded-xl border border-eva-tint-border bg-eva-tint px-6 py-5">
              <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                <EvaSpark className="size-3.5 text-eva" aria-hidden />
                EVA
              </p>
              <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-foreground">
                {suggestion === 'complete_draft'
                  ? t('campaign.evaSuggestDraft')
                  : suggestion === 'first_creative'
                    ? t('campaign.evaSuggestFirst')
                    : t('campaign.evaSuggestAnother')}
              </p>
              <div className="mt-3.5">
                {suggestion === 'complete_draft' ? (
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    {t('campaign.editCampaign')}
                  </Button>
                ) : (
                  createButton('campaign.evaCreateCta')
                )}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/**
 * A compact card for one creative made for this campaign. Shows only what
 * exists — preview, name, format, status, date — and opens the existing
 * Creative gallery, where the full card (download, edit in chat, brand
 * panel) lives.
 */
function WorkbenchCreativeCard({ creative }: { creative: Creative }) {
  const { t, language } = useI18n()
  // Keyed by storage path so a changed image stops matching instead of
  // needing a state reset inside the effect.
  const [resolved, setResolved] = useState<{ path: string; url: string } | null>(null)
  const storagePath = creative.content.image?.storagePath ?? null
  const imageUrl = resolved && resolved.path === storagePath ? resolved.url : null

  useEffect(() => {
    if (!storagePath) return
    let cancelled = false
    getAssetUrl(storagePath)
      .then((url) => {
        if (!cancelled) setResolved({ path: storagePath, url })
      })
      .catch(() => {
        // Card renders text-only; the gallery still has the full view.
      })
    return () => {
      cancelled = true
    }
  }, [storagePath])

  const statusKey: MessageKey | null =
    creative.status === 'generating'
      ? 'library.statusGenerating'
      : creative.status === 'draft'
        ? 'library.statusDraft'
        : creative.status === 'failed'
          ? 'library.statusFailed'
          : null

  return (
    <Link
      to={ROUTES.creative}
      className="block overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-foreground/30"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-poster-surface">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={creative.content.image?.altText ?? creative.content.headline ?? creative.name}
            className="absolute inset-0 size-full object-cover"
          />
        ) : creative.content.headline ? (
          <p className="absolute inset-x-0 bottom-0 p-3 text-[14px] font-semibold leading-snug text-foreground">
            {creative.content.headline}
          </p>
        ) : null}
      </div>
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 truncate text-[13.5px] font-semibold tracking-[-0.01em] text-foreground">
            {creative.name}
          </h3>
          {statusKey ? (
            <span className="ml-auto shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground">
              {t(statusKey)}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {creative.format === 'portrait_post'
            ? t('creative.formatPortrait')
            : t('creative.formatSquare')}{' '}
          ·{' '}
          {t('creative.updatedOn', {
            date: new Date(creative.updatedAt).toLocaleDateString(
              language === 'ms' ? 'ms-MY' : 'en-MY',
            ),
          })}
        </p>
      </div>
    </Link>
  )
}

function ProgressRow({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2.5 text-[13.5px]">
      {done ? (
        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-eva-badge text-eva-badge-foreground">
          <Check className="size-3" aria-hidden />
        </span>
      ) : (
        <span className="inline-block size-4 shrink-0 rounded-full border border-border" aria-hidden />
      )}
      <span className={done ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
    </li>
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

function ReadRow({ label, value, tag }: { label: string; value?: string | null; tag?: string }) {
  if (!value) return null
  return (
    <div>
      <dt className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
        {tag ? (
          <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
            {tag}
          </span>
        ) : null}
      </dt>
      <dd className="mt-1 text-[14px] leading-relaxed text-foreground">{value}</dd>
    </div>
  )
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-4">
      <p className="text-[12px] font-medium text-foreground">{title}</p>
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
