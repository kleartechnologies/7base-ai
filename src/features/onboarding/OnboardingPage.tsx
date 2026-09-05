import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Business } from '@/types'
import { DEFAULT_AUTHENTICATED_ROUTE } from '@/app/routes/paths'
import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/hooks/useI18n'
import { toUserMessage } from '@/lib/firebase/errors'
import { acceptBusinessBrain, createBusiness } from '@/services/business/business.service'
import { missingQuestions } from '@/services/business/completion'
import { setActiveBusiness, setOnboardingStep } from '@/services/business/user.service'
import { AnalysingStep } from './components/AnalysingStep'
import { AnalysisFailed } from './components/AnalysisFailed'
import { CompletionStep } from './components/CompletionStep'
import { ManualStep } from './components/ManualStep'
import { MethodChoice } from './components/MethodChoice'
import { OnboardingLayout } from './components/OnboardingLayout'
import { ReviewStep } from './components/ReviewStep'
import { WebsiteStep } from './components/WebsiteStep'
import { useWebsiteAnalysis } from './useWebsiteAnalysis'
import { displaySource } from './url'

/**
 * First run: MARKA learns the business instead of interviewing the owner.
 *
 * The owner supplies one thing — a link to wherever their business lives
 * online: a website, a public Facebook Page, or an Instagram profile — and
 * reviews what EVA understood. Every other step here exists only for when
 * that does not work, and none of them can be blocked by it failing.
 */
type Step = 'choose' | 'website' | 'manual'

export default function OnboardingPage() {
  const navigate = useNavigate()
  const { user, refresh } = useAuth()
  const { t } = useI18n()
  const analysis = useWebsiteAnalysis()

  const [step, setStep] = useState<Step>('choose')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  // Set once onboarding is complete and EVA still has questions worth asking.
  const [completingId, setCompletingId] = useState<string | null>(null)
  // Shown wherever the failed submit happened — the review step and the manual
  // step both render it. A confirm that fails must never look like success.
  const [submitError, setSubmitError] = useState<string | null>(null)

  /**
   * Onboarding is done the moment a business exists and the owner has stood
   * behind it.
   *
   * Accepting comes first and is not optional: without it, everything MARKA
   * discovered would stay unconfirmed and the next website analysis could
   * overwrite the very thing the owner just approved.
   *
   * Only after onboarding is fully recorded as complete does EVA offer to fill
   * the gaps — the completion questions are a bonus on top of a finished
   * setup, never a gate in front of one. Closing the tab mid-question loses
   * nothing but the unanswered questions.
   */
  async function finish(business: Business) {
    if (!user) return
    setBusy(true)
    setSubmitError(null)
    try {
      await acceptBusinessBrain(business)
      await setActiveBusiness(user.uid, business.id)
      await setOnboardingStep(user.uid, 'complete')
      await refresh()
      if (missingQuestions(business).length > 0) {
        setCompletingId(business.id)
        setBusy(false)
        return
      }
      navigate(DEFAULT_AUTHENTICATED_ROUTE, { replace: true })
    } catch (caught) {
      setSubmitError(toUserMessage(caught, t('onboarding.finishFailed')))
      setBusy(false)
    }
  }

  async function handleManual(name: string, offering: string) {
    if (!user) return
    setBusy(true)
    setSubmitError(null)
    try {
      const created = await createBusiness(user.uid, { name, offering: offering || null })
      await finish(created)
    } catch (caught) {
      setSubmitError(toUserMessage(caught, t('onboarding.saveBusinessFailed')))
      setBusy(false)
    }
  }

  function startAnalysis(nextUrl: string) {
    setUrl(nextUrl)
    void analysis.analyse(nextUrl)
  }

  if (completingId) {
    return (
      <OnboardingLayout
        title={t('onboarding.completionTitle')}
        subtitle={t('onboarding.completionSubtitle')}
      >
        <CompletionStep
          businessId={completingId}
          onDone={() => navigate(DEFAULT_AUTHENTICATED_ROUTE, { replace: true })}
        />
      </OnboardingLayout>
    )
  }

  if (analysis.phase === 'starting' || analysis.phase === 'running') {
    return (
      <OnboardingLayout
        title={t('onboarding.analysingTitle')}
        subtitle={t('onboarding.analysingSubtitle', { source: displaySource(url) })}
      >
        <AnalysingStep stage={analysis.stage} />
      </OnboardingLayout>
    )
  }

  if (analysis.phase === 'failed' && analysis.failure) {
    return (
      <OnboardingLayout title={t('onboarding.failedTitle')}>
        <AnalysisFailed
          failure={analysis.failure}
          onRetryWebsite={() => {
            analysis.reset()
            setStep('website')
          }}
          onContinueManually={() => {
            analysis.reset()
            setStep('manual')
          }}
        />
      </OnboardingLayout>
    )
  }

  if (analysis.phase === 'complete' && analysis.business) {
    return (
      <OnboardingLayout
        wide
        title={t('onboarding.reviewTitle')}
        subtitle={t('onboarding.reviewSubtitle')}
      >
        <ReviewStep
          business={analysis.business}
          busy={busy}
          error={submitError}
          onConfirm={() => void finish(analysis.business!)}
          onReanalyse={() => {
            analysis.reset()
            setStep('website')
          }}
        />
      </OnboardingLayout>
    )
  }

  if (step === 'website') {
    return (
      <OnboardingLayout
        title={t('onboarding.websiteTitle')}
        subtitle={t('onboarding.websiteSubtitle')}
      >
        <WebsiteStep
          initialUrl={url}
          busy={busy}
          onSubmit={startAnalysis}
          onBack={() => setStep('choose')}
          onNoOnlinePresence={() => setStep('manual')}
        />
      </OnboardingLayout>
    )
  }

  if (step === 'manual') {
    return (
      <OnboardingLayout
        title={t('onboarding.manualTitle')}
        subtitle={t('onboarding.manualSubtitle')}
      >
        <ManualStep
          busy={busy}
          error={submitError}
          onSubmit={(name, offering) => void handleManual(name, offering)}
          onBack={() => setStep('choose')}
        />
      </OnboardingLayout>
    )
  }

  return (
    <OnboardingLayout
      title={t('onboarding.chooseTitle')}
      subtitle={t('onboarding.chooseSubtitle')}
    >
      <MethodChoice onChooseWebsite={() => setStep('website')} />
      <button
        type="button"
        onClick={() => setStep('manual')}
        className="mt-6 text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t('onboarding.typeItMyself')}
      </button>
    </OnboardingLayout>
  )
}
