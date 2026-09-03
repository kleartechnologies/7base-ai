import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/hooks/useAuth'
import { getCurrentPlan, getPlanLimits } from '@/services/billing/billing.service'

export default function SettingsPage() {
  const { user, signOut } = useAuth()
  const plan = getCurrentPlan()
  const limits = getPlanLimits(plan)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-8 py-12">
        <header className="mb-10">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Settings</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            Your account and plan.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-sm font-medium text-foreground">Account</h2>
          <dl className="space-y-3 rounded-xl border border-border bg-card px-5 py-4 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="truncate text-foreground">{user?.displayName ?? '—'}</dd>
            </div>
            <Separator />
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="truncate text-foreground">{user?.email ?? '—'}</dd>
            </div>
          </dl>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-sm font-medium text-foreground">Plan</h2>
          <div className="rounded-xl border border-border bg-card px-5 py-4">
            <p className="text-sm font-medium capitalize text-foreground">{plan}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              Up to {limits.maxCampaignsPerMonth} campaigns and {limits.maxCreativesPerMonth}{' '}
              creatives per month. Paid plans are not available yet.
            </p>
          </div>
        </section>

        <section className="mt-10">
          <Button variant="outline" onClick={() => void signOut()}>
            <LogOut />
            Sign out
          </Button>
        </section>
      </div>
    </div>
  )
}
