import type { ReactNode } from 'react'
import { MarkaLogo } from '@/components/MarkaLogo'

/**
 * One calm, centred column for every onboarding step.
 *
 * Deliberately sparse: this is the first thing a new owner sees, and the
 * promise of the product is that it asks for almost nothing.
 */
export function OnboardingLayout({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className="min-h-dvh overflow-y-auto bg-background">
      <div className={`mx-auto w-full px-6 py-16 sm:py-20 ${wide ? 'max-w-2xl' : 'max-w-xl'}`}>
        <MarkaLogo className="mb-10 block" />
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
