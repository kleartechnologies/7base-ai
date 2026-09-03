import type { ReactNode } from 'react'
import { MarkaLogo } from '@/components/MarkaLogo'

interface AuthLayoutProps {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-10 text-center">
          <MarkaLogo className="text-base" />
        </div>

        <div className="mb-8 space-y-2 text-center">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>

        {children}

        <div className="mt-8 text-center text-sm text-muted-foreground">{footer}</div>
      </div>
    </div>
  )
}
