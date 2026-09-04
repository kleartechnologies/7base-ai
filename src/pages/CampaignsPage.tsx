import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Megaphone } from 'lucide-react'
import { ROUTES } from '@/app/routes/paths'
import { useAuth } from '@/hooks/useAuth'
import { observeCampaigns } from '@/services/campaigns/campaign.service'
import type { Campaign } from '@/types'

const STATUS_LABELS: Record<Campaign['status'], string> = {
  draft: 'Draft',
  ready: 'Ready',
  archived: 'Archived',
}

/**
 * Every campaign MARKA has built with this owner, most recently touched
 * first. V1 is deliberately a reading list, not a dashboard: open, review,
 * edit, continue the conversation. No analytics.
 */
export default function CampaignsPage() {
  const { user } = useAuth()
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    if (!user) return
    // A dead listener must not masquerade as "no campaigns yet".
    return observeCampaigns(
      user.uid,
      (next) => {
        setCampaigns(next)
        setLoadError(false)
      },
      () => setLoadError(true),
    )
  }, [user])

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-12">
      <header>
        <h1 className="flex items-center gap-2.5 text-[22px] font-semibold tracking-[-0.01em] text-foreground">
          <Megaphone className="size-5 text-muted-foreground" aria-hidden />
          Campaigns
        </h1>
        <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
          Every campaign EVA builds with you, kept as structured strategy rather than loose
          text.
        </p>
      </header>

      {loadError ? (
        <p role="alert" className="mt-10 text-[14px] leading-relaxed text-destructive">
          Your campaigns could not be loaded. Please check your connection and refresh.
        </p>
      ) : campaigns === null ? (
        <p className="mt-10 text-[14px] text-muted-foreground">Loading…</p>
      ) : campaigns.length === 0 ? (
        <p className="mt-10 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
          Nothing here yet. Ask EVA what you want to achieve in the chat — when it recommends
          a move, one click turns that recommendation into a campaign, saved here.
        </p>
      ) : (
        <ul className="mt-8 space-y-3">
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              <Link
                to={ROUTES.campaignDetail(campaign.id)}
                className="block rounded-xl border border-border bg-card px-5 py-4 transition-colors hover:border-foreground/20"
              >
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                    {campaign.name}
                  </h2>
                  <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                    {STATUS_LABELS[campaign.status]}
                  </span>
                </div>
                {campaign.objective ? (
                  <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                    {campaign.objective}
                  </p>
                ) : null}
                <p className="mt-2 text-[12px] text-muted-foreground">
                  {campaign.durationDays ? `${campaign.durationDays} days · ` : ''}
                  Updated {new Date(campaign.updatedAt).toLocaleDateString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
