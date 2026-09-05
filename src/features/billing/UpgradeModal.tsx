import { useEffect, useRef, useState } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'
import { getCurrentPlan, startUpgrade } from '@/services/billing/billing.service'
import { PlanCard } from './PlanCard'

/**
 * The plan-comparison dialog: a 720px card on desktop, a full-screen sheet on
 * mobile (Pro listed first there, with a sticky CTA).
 *
 * No billing exists yet, so "Upgrade to Pro" resolves through the billing
 * seam and — today — always lands on the approved quiet notice: the upgrade
 * couldn't be started and nothing was charged.
 */
export function UpgradeModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const closeRef = useRef<HTMLButtonElement>(null)
  const [upgrading, setUpgrading] = useState(false)
  const [failed, setFailed] = useState(false)
  const currentPlan = getCurrentPlan()

  useEffect(() => {
    closeRef.current?.focus()
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function handleUpgrade() {
    setUpgrading(true)
    setFailed(false)
    try {
      const result = await startUpgrade()
      if (!result.ok) setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setUpgrading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        aria-label={t('common.close')}
        className="absolute inset-0 bg-foreground/30"
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('plan.modalTitle')}
        className="absolute inset-0 flex flex-col overflow-y-auto bg-card sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[720px] sm:max-w-[calc(100vw-32px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:border-border sm:shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 px-5 pb-1 pt-5 sm:px-8 sm:pt-7">
          <div>
            <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-foreground">
              {t('plan.modalTitle')}
            </h2>
            <p className="mt-1 text-[13.5px] text-muted-foreground">{t('plan.modalSubtitle')}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {failed ? (
          <div
            role="alert"
            className="mx-5 mt-3 flex items-start gap-2 rounded-[10px] border border-border bg-muted px-3 py-3 text-[13px] leading-relaxed text-foreground/80 sm:mx-8"
          >
            <AlertCircle className="mt-px size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{t('plan.upgradeErrorNotice')}</span>
          </div>
        ) : null}

        {/* Pro first on mobile (the recommendation leads), side by side on desktop. */}
        <div className="grid flex-1 content-start gap-4 px-5 py-5 sm:grid-cols-2 sm:px-8">
          <div className="order-2 sm:order-1">
            <PlanCard plan="basic" currentPlan={currentPlan} />
          </div>
          <div className="order-1 sm:order-2">
            <PlanCard
              plan="pro"
              currentPlan={currentPlan}
              onUpgrade={() => void handleUpgrade()}
              upgrading={upgrading}
            />
          </div>
        </div>

        <p className="border-t border-border px-5 py-4 text-center text-[12px] leading-relaxed text-muted-foreground sm:border-0 sm:pb-6 sm:pt-0">
          {t('plan.modalFootnote')}
        </p>
      </div>
    </div>
  )
}
