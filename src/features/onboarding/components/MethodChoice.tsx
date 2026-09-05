import { Globe, Upload, type LucideIcon } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'

/**
 * How MARKA should learn about the business.
 *
 * One link — website, Facebook Page, or Instagram profile — is a single path
 * now, because to the owner it is a single idea: "here is where my business
 * lives online." Uploads are shown because they are genuinely coming — but
 * disabled and labelled, never dressed up as a working button.
 */
export function MethodChoice({ onChooseWebsite }: { onChooseWebsite: () => void }) {
  const { t } = useI18n()
  return (
    <div className="space-y-3">
      <Method
        icon={Globe}
        title={t('onboarding.methodWebsiteTitle')}
        description={t('onboarding.methodWebsiteDescription')}
        onClick={onChooseWebsite}
      />
      <Method
        icon={Upload}
        title={t('onboarding.methodUploadTitle')}
        description={t('onboarding.methodUploadDescription')}
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
  const { t } = useI18n()
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
              {t('onboarding.soon')}
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
