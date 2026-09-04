import { Globe, Share2, Upload, type LucideIcon } from 'lucide-react'

/**
 * How MARKA should learn about the business.
 *
 * Only the website path works today. The other two are shown because they are
 * genuinely coming — but they are disabled and labelled, never dressed up as
 * working buttons.
 */
export function MethodChoice({ onChooseWebsite }: { onChooseWebsite: () => void }) {
  return (
    <div className="space-y-3">
      <Method
        icon={Globe}
        title="From my website"
        description="EVA reads your public website and works out the rest."
        onClick={onChooseWebsite}
      />
      <Method
        icon={Share2}
        title="From my Facebook or Instagram"
        description="Connecting social accounts is coming soon."
        disabled
      />
      <Method
        icon={Upload}
        title="Upload my menu or brochure"
        description="Reading uploaded documents is coming soon."
        disabled
      />
    </div>
  )
}

function Method({
  icon: Icon,
  title,
  description,
  onClick,
  disabled = false,
}: {
  icon: LucideIcon
  title: string
  description: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-start gap-4 rounded-xl border border-border bg-card px-5 py-4 text-left transition-colors hover:border-foreground/20 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-border disabled:hover:bg-card"
    >
      <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="text-[15px] font-medium text-foreground">{title}</span>
          {disabled ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Soon
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  )
}
