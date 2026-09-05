import type { ReactNode } from 'react'
import { EvaSpark } from '@/components/EvaMark'
import { MarkaLogo } from '@/components/MarkaLogo'
import { useI18n } from '@/hooks/useI18n'

/**
 * One calm, centred column for every onboarding step.
 *
 * Deliberately sparse: this is the first thing a new owner sees, and the
 * promise of the product is that it asks for almost nothing. The header names
 * the product and quietly says how far along setup is; EVA's spark appears
 * on the steps where she is the one doing the work.
 */
export function OnboardingLayout({
  title,
  subtitle,
  step,
  spark = false,
  children,
  wide = false,
}: {
  title: string
  subtitle?: ReactNode
  /** 1-based position in the three-step setup, shown in the header. */
  step?: 1 | 2 | 3
  /** Show EVA's pulsing spark above the title — for steps she works on. */
  spark?: boolean
  children: ReactNode
  wide?: boolean
}) {
  const { t } = useI18n()
  return (
    <div className="min-h-dvh overflow-y-auto bg-background">
      <div className={`mx-auto w-full px-6 py-16 sm:py-20 ${wide ? 'max-w-2xl' : 'max-w-xl'}`}>
        <div className="mb-10 flex items-center justify-between">
          <MarkaLogo />
          {step ? (
            <span className="text-[12px] font-medium text-muted-foreground">
              {t('onboarding.stepOf', { step, total: 3 })}
            </span>
          ) : null}
        </div>
        {spark ? (
          <span className="mb-5 flex size-11 items-center justify-center rounded-full border border-eva-tint-border bg-eva-tint">
            <EvaSpark className="size-5 animate-eva-pulse text-eva motion-reduce:animate-none" />
          </span>
        ) : null}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{subtitle}</p>
        ) : null}
        <div className="mt-10">{children}</div>
      </div>
    </div>
  )
}
