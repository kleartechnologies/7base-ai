import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Image as ImageIcon } from 'lucide-react'
import { ROUTES } from '@/app/routes/paths'
import { downloadPoster } from '@/features/creative/poster'
import { firstUsableColor, readableTextOn } from '@/features/creative/posterSpec'
import { useAuth } from '@/hooks/useAuth'
import { observeCreatives } from '@/services/creatives/creative.service'
import { getAssetUrl } from '@/services/storage/storage.service'
import { Button } from '@/components/ui/button'
import type { Creative } from '@/types'

/**
 * Every creative MARKA has made for this owner, newest first.
 *
 * A reading (and downloading) gallery, not an editor: creatives are edited
 * conversationally in the chat where the authority model lives, so each card
 * links back to its conversation. The poster preview is composed live from
 * the structured fields — the same layout the export draws.
 */
export default function CreativePage() {
  const { user } = useAuth()
  const [creatives, setCreatives] = useState<Creative[] | null>(null)

  useEffect(() => {
    if (!user) return
    return observeCreatives(user.uid, setCreatives, () => setCreatives([]))
  }, [user])

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-12">
      <header>
        <h1 className="flex items-center gap-2.5 text-[22px] font-semibold tracking-[-0.01em] text-foreground">
          <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
          Creative
        </h1>
        <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
          Posters and captions MARKA has made from your campaigns — structured and editable,
          never flattened.
        </p>
      </header>

      {creatives === null ? (
        <p className="mt-10 text-[14px] text-muted-foreground">Loading…</p>
      ) : creatives.length === 0 ? (
        <p className="mt-10 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
          Nothing here yet. Open a campaign and choose “Create Marketing Materials” — the
          poster and captions MARKA makes will be collected here.
        </p>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {creatives.map((creative) => (
            <li key={creative.id}>
              <CreativeCard creative={creative} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CreativeCard({ creative }: { creative: Creative }) {
  // Keyed by storage path so a changed image stops matching instead of
  // needing a state reset inside the effect.
  const [resolved, setResolved] = useState<{ path: string; url: string } | null>(null)
  const [resolvedLogo, setResolvedLogo] = useState<{ path: string; url: string } | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState(false)

  const storagePath = creative.content.image?.storagePath ?? null
  const imageUrl = resolved && resolved.path === storagePath ? resolved.url : null
  const logoPath = creative.style.logoStoragePath ?? null
  const logoUrl = resolvedLogo && resolvedLogo.path === logoPath ? resolvedLogo.url : null

  useEffect(() => {
    if (!storagePath) return
    let cancelled = false
    getAssetUrl(storagePath)
      .then((url) => {
        if (!cancelled) setResolved({ path: storagePath, url })
      })
      .catch(() => {
        // Card renders text-only; download still works without the visual.
      })
    return () => {
      cancelled = true
    }
  }, [storagePath])

  useEffect(() => {
    if (!logoPath) return
    let cancelled = false
    getAssetUrl(logoPath)
      .then((url) => {
        if (!cancelled) setResolvedLogo({ path: logoPath, url })
      })
      .catch(() => {
        // Poster renders without the logo; nothing else is lost.
      })
    return () => {
      cancelled = true
    }
  }, [logoPath])

  const handleDownload = async () => {
    setDownloading(true)
    setDownloadError(false)
    try {
      await downloadPoster({
        content: {
          name: creative.name,
          format: creative.format === 'portrait_post' ? 'portrait_post' : 'square_post',
          headline: creative.content.headline,
          subheadline: creative.content.subheadline,
          callToAction: creative.content.callToAction,
          offerText: creative.content.offerText,
        },
        style: creative.style,
        imageUrl,
        logoUrl,
      })
    } catch {
      setDownloadError(true)
    } finally {
      setDownloading(false)
    }
  }

  const accent = firstUsableColor(creative.style.palette) ?? '#C2410C'
  const accentText = readableTextOn(accent)

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div
        className={`relative w-full overflow-hidden bg-[#20242b] ${
          creative.format === 'portrait_post' ? 'aspect-[4/5]' : 'aspect-square'
        }`}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={creative.content.image?.altText ?? creative.content.headline ?? creative.name}
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}

        <div
          className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/80 via-black/40 to-transparent"
          aria-hidden
        />

        {creative.content.offerText ? (
          <span
            className="absolute left-3 top-3 rounded-md px-2 py-0.5 text-[11px] font-semibold"
            style={{ backgroundColor: accent, color: accentText }}
          >
            {creative.content.offerText}
          </span>
        ) : null}

        {logoUrl ? (
          // The real uploaded logo, same corner the canvas export draws it in.
          <img src={logoUrl} alt="" className="absolute right-3 top-3 max-h-8 max-w-16 object-contain" />
        ) : null}

        <div className="absolute inset-x-0 bottom-0 p-3.5">
          {creative.content.headline ? (
            <p className="text-[17px] font-bold leading-tight text-white">
              {creative.content.headline}
            </p>
          ) : null}
          {creative.content.callToAction ? (
            <span
              className="mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: accent, color: accentText }}
            >
              {creative.content.callToAction}
            </span>
          ) : null}
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 truncate text-[14px] font-semibold tracking-[-0.01em] text-foreground">
            {creative.name}
          </h2>
          {creative.content.image?.source === 'generated' ? (
            <span className="ml-auto shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground">
              AI-generated image
            </span>
          ) : creative.content.image?.source === 'upload' ? (
            <span className="ml-auto shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground">
              Your photo
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {creative.format === 'portrait_post' ? 'Portrait post' : 'Square post'} · Updated{' '}
          {new Date(creative.updatedAt).toLocaleDateString()}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void handleDownload()} disabled={downloading}>
            <Download className="size-3.5" aria-hidden />
            {downloading ? 'Preparing…' : 'Download Poster'}
          </Button>
          {creative.conversationId ? (
            <Button size="sm" variant="outline" asChild>
              <Link to={ROUTES.conversation(creative.conversationId)}>Edit in chat</Link>
            </Button>
          ) : null}
        </div>
        {downloadError ? (
          <p className="mt-2 text-[12px] text-destructive">
            The poster could not be downloaded. Please try again.
          </p>
        ) : null}
      </div>
    </div>
  )
}
