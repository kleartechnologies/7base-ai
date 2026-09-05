import { Check } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'
import type { MessageKey } from '@/i18n/translate'
import { PLAN_PRICING, getPlanName, type PlanId } from '@/services/billing/billing.service'
import { cn } from '@/lib/utils'

/**
 * One plan, as the approved pricing card. Display only — the button is an
 * entry point, not billing logic; what happens on click is the caller's
 * decision (today: the quiet "couldn't be started" notice).
 */

export const PLAN_BENEFIT_KEYS: Record<PlanId, readonly MessageKey[]> = {
  basic: ['plan.benefitChat', 'plan.benefitBrain', 'plan.benefitCampaigns', 'plan.benefitImages'],
  pro: [
    'plan.benefitEverythingBasic',
    'plan.benefitMorePowerful',
    'plan.benefitAdvancedTools',
    'plan.benefitMoreRoom',
  ],
}

const PLAN_DESCRIPTION_KEYS: Record<PlanId, MessageKey> = {
  basic: 'plan.basicDescription',
  pro: 'plan.proDescription',
}

export function LaunchPriceBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-eva-badge-border bg-eva-badge px-2 py-0.5 text-[11px] font-medium text-eva-badge-foreground">
      {label}
    </span>
  )
}

export function PlanBenefits({ plan }: { plan: PlanId }) {
  const { t } = useI18n()
  return (
    <ul className="space-y-2">
      {PLAN_BENEFIT_KEYS[plan].map((key) => (
        <li key={key} className="flex items-center gap-2.5 text-[13px] text-foreground/85">
          <Check
            className={cn('size-3.5 shrink-0', plan === 'pro' ? 'text-eva' : 'text-muted-foreground')}
            aria-hidden
          />
          {t(key)}
        </li>
      ))}
    </ul>
  )
}

export function PlanCard({
  plan,
  currentPlan,
  onUpgrade,
  upgrading,
}: {
  plan: PlanId
  currentPlan: PlanId
  /** Only rendered for the recommended (pro) card when it is not current. */
  onUpgrade?: () => void
  upgrading?: boolean
}) {
  const { t } = useI18n()
  const pricing = PLAN_PRICING[plan]
  const isCurrent = plan === currentPlan
  const recommended = plan === 'pro'

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-[14px] border bg-card p-5',
        recommended ? 'border-[1.5px] border-eva-progress' : 'border-border',
      )}
    >
      {recommended ? (
        <span className="absolute -top-2.5 right-4">
          <LaunchPriceBadge label={t('plan.recommended')} />
        </span>
      ) : null}

      <h3 className="text-[15px] font-semibold text-foreground">{getPlanName(plan)}</h3>
      <p className="mt-0.5 text-[13px] text-muted-foreground">{t(PLAN_DESCRIPTION_KEYS[plan])}</p>

      <p className="mt-4 flex items-baseline gap-1">
        <span className="text-[28px] font-semibold tracking-[-0.01em] text-foreground">
          {pricing.launchPrice}
        </span>
        <span className="text-[13px] text-muted-foreground">{t('plan.perMonth')}</span>
      </p>
      <p className="text-[12px] font-medium text-eva-label">{t('plan.launchPriceFirstMonths')}</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        {t('plan.thenPrice', { price: pricing.normalPrice })}
      </p>

      <div className="mt-4 flex-1">
        <PlanBenefits plan={plan} />
      </div>

      <div className="mt-5">
        {isCurrent ? (
          <span className="flex h-[38px] items-center justify-center rounded-lg bg-muted text-[13px] font-medium text-muted-foreground">
            {t('plan.yourCurrentPlan')}
          </span>
        ) : onUpgrade ? (
          <button
            type="button"
            onClick={onUpgrade}
            disabled={upgrading}
            className="flex h-[38px] w-full items-center justify-center rounded-lg bg-primary text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {upgrading ? t('plan.starting') : t('plan.upgradeToPro')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
