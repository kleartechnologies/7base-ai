import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/hooks/useI18n'
import type { MessageKey } from '@/i18n/translate'
import { checkDiscoveryUrl, displaySource } from '@/features/onboarding/url'
import { knownSources, type KnownSource } from './sources'
import { analyseBusinessDna } from '@/services/ai'
import type { Asset, Business, DiscoveryStage } from '@/types'
import { SourcesLine } from './DetectedBrandCard'

/**
 * Where the owner sees what EVA can read about their business and asks for
 * an analysis (Phase 7E). Deliberately small: a list of known sources, a
 * field to add a link, one button. The run itself is server-side; progress
 * and outcome are read off the live business document, exactly as the
 * onboarding screen reads them.
 *
 * Only the business id and the links go to the server. Nothing about the
 * brand — colours, fonts, a logo — is ever sent from here.
 */

const MAX_LINKS = 3

const STAGE_KEYS: Record<DiscoveryStage, MessageKey> = {
  fetching: 'onboarding.stageFetching',
  reading_pages: 'onboarding.stageReadingPages',
  understanding: 'onboarding.stageUnderstanding',
  building_brain: 'onboarding.stageBuildingBrain',
  saving: 'onboarding.stageSaving',
}

export function BusinessSourcesCard({
  business,
  assets,
  applied,
  busy,
}: {
  business: Business
  /** The owner's active assets, so the count of usable uploads can be shown. */
  assets: Asset[] | null
  /** Everything the last analysis detected has been applied to the kit. */
  applied: boolean
  /** A kit save is in flight; the analyse button waits for it. */
  busy: boolean
}) {
  const { t, language } = useI18n()
  const [links, setLinks] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [requested, setRequested] = useState(false)
  const [callError, setCallError] = useState<string | null>(null)

  const known = knownSources(business)
  const usableAssets = (assets ?? []).filter(
    (asset) => asset.businessId === business.id && asset.allowAiUse,
  ).length
  const discovery = business.discovery
  const dna = discovery?.dna ?? null
  const running = discovery?.status === 'running'
  const failed = requested && discovery?.status === 'failed'
  const hasSources = known.length > 0 || links.length > 0 || usableAssets > 0
  const partial = dna?.sources.some((source) => source.status !== 'analyzed') ?? false

  function addLink(event: FormEvent) {
    event.preventDefault()
    const check = checkDiscoveryUrl(draft)
    if (!check.ok) {
      setLinkError(check.message)
      return
    }
    if (links.length >= MAX_LINKS) {
      setLinkError(t('brand.sourcesTooMany'))
      return
    }
    if (links.includes(check.url) || known.some((source) => source.url === check.url)) {
      setLinkError(t('brand.sourcesDuplicate'))
      return
    }
    setLinks([...links, check.url])
    setDraft('')
    setLinkError(null)
  }

  async function analyse() {
    setRequested(true)
    setCallError(null)
    const result = await analyseBusinessDna({
      businessId: business.id,
      links: links.length > 0 ? links : undefined,
    })
    if (!result.ok) {
      setCallError(result.error.message || t('brand.sourcesFailed'))
      return
    }
    setLinks([])
  }

  const analysedAt = dna?.analysedAt ?? discovery?.completedAt ?? null

  return (
    <section className="rounded-xl border border-border bg-card px-6 py-5">
      <header>
        <h2 className="text-[15px] font-semibold text-foreground">{t('brand.sourcesTitle')}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {t('brand.sourcesHint')}
        </p>
      </header>

      {hasSources ? (
        <ul className="mt-4 space-y-1.5 text-[13px]">
          {known.map((source) => (
            <li key={source.url} className="flex items-center gap-2 text-foreground">
              <span className="text-muted-foreground">{t(SOURCE_KEYS[source.kind])}</span>
              <span className="truncate">{displaySource(source.url)}</span>
            </li>
          ))}
          {links.map((link) => (
            <li key={link} className="flex items-center gap-2 text-foreground">
              <span className="text-muted-foreground">
                {t(SOURCE_KEYS[checkDiscoveryUrl(link).kind])}
              </span>
              <span className="truncate">{displaySource(link)}</span>
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                aria-label={t('brand.sourcesRemoveLink', { link: displaySource(link) })}
                onClick={() => setLinks(links.filter((item) => item !== link))}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
          {usableAssets > 0 ? (
            <li className="text-foreground">
              {usableAssets === 1
                ? t('brand.sourceAssetOne')
                : t('brand.sourceAssets', { count: usableAssets })}
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="mt-4 text-[13px] text-muted-foreground">{t('brand.sourcesNone')}</p>
      )}

      <form onSubmit={addLink} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setLinkError(null)
          }}
          placeholder={t('brand.sourcesAddPlaceholder')}
          aria-label={t('brand.sourcesAddPlaceholder')}
          disabled={running}
          inputMode="url"
        />
        <Button type="submit" variant="outline" size="sm" disabled={running || !draft.trim()}>
          {t('brand.sourcesAdd')}
        </Button>
      </form>
      {linkError ? (
        <p role="alert" className="mt-2 text-[12px] text-destructive">
          {linkError}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={running || busy || !hasSources}
          onClick={() => void analyse()}
        >
          {failed || callError
            ? t('brand.sourcesRetry')
            : dna
              ? t('brand.sourcesReanalyse')
              : t('brand.sourcesAnalyse')}
        </Button>
        {running ? (
          <p className="text-[12px] text-muted-foreground" aria-live="polite">
            {discovery?.stage ? t(STAGE_KEYS[discovery.stage]) : t('brand.sourcesAnalysing')}
          </p>
        ) : analysedAt && dna ? (
          <p className="text-[12px] text-muted-foreground">
            {t('brand.sourcesLastAnalysed', {
              when: new Intl.DateTimeFormat(language === 'ms' ? 'ms-MY' : 'en-MY', {
                dateStyle: 'medium',
              }).format(analysedAt),
            })}
            {applied ? ` ${t('brand.sourcesApplied')}` : ''}
          </p>
        ) : null}
      </div>

      {dna && !running ? <SourcesLine sources={dna.sources} /> : null}
      {partial && !running ? (
        <p className="mt-2 text-[12px] text-muted-foreground">{t('brand.sourcesPartial')}</p>
      ) : null}
      {(failed || callError) && !running ? (
        <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
          {callError ?? discovery?.error ?? t('brand.sourcesFailed')}
        </p>
      ) : null}
    </section>
  )
}

const SOURCE_KEYS: Record<KnownSource['kind'], MessageKey> = {
  website: 'brand.sourceWebsite',
  facebook: 'brand.sourceFacebook',
  instagram: 'brand.sourceInstagram',
}
