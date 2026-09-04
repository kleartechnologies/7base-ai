import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Business } from '@/types'
import { DEFAULT_AUTHENTICATED_ROUTE } from '@/app/routes/paths'
import { useAuth } from '@/hooks/useAuth'
import { toUserMessage } from '@/lib/firebase/errors'
import { acceptBusinessBrain, createBusiness } from '@/services/business/business.service'
import { setActiveBusiness, setOnboardingStep } from '@/services/business/user.service'
import { AnalysingStep } from './components/AnalysingStep'
import { AnalysisFailed } from './components/AnalysisFailed'
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
  const analysis = useWebsiteAnalysis()

  const [step, setStep] = useState<Step>('choose')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
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
      navigate(DEFAULT_AUTHENTICATED_ROUTE, { replace: true })
    } catch (caught) {
      setSubmitError(toUserMessage(caught, 'Could not finish setting up. Please try again.'))
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
      setSubmitError(toUserMessage(caught, 'Could not save your business. Please try again.'))
      setBusy(false)
    }
  }

  function startAnalysis(nextUrl: string) {
    setUrl(nextUrl)
    void analysis.analyse(nextUrl)
  }

  if (analysis.phase === 'starting' || analysis.phase === 'running') {
    return (
      <OnboardingLayout
        title="EVA is taking a look"
        subtitle={`Reading ${displaySource(url)}. This usually takes under a minute.`}
      >
        <AnalysingStep stage={analysis.stage} />
      </OnboardingLayout>
    )
  }

  if (analysis.phase === 'failed' && analysis.failure) {
    return (
      <OnboardingLayout title="EVA couldn’t do that">
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
        title="Here’s what EVA understood"
        subtitle="Have a quick look. Fix anything that’s wrong — EVA will remember your version."
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
        title="Where can EVA learn about your business?"
        subtitle="One link is enough — EVA reads it and works out the rest. You just check what she found."
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
        title="Tell EVA the basics"
        subtitle="Two things is enough. EVA will learn the rest as you work together."
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
      title="Let’s get EVA up to speed"
      subtitle="Rather than asking you to fill in a profile, EVA would rather go and find out."
    >
      <MethodChoice onChooseWebsite={() => setStep('website')} />
      <button
        type="button"
        onClick={() => setStep('manual')}
        className="mt-6 text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        I’d rather type it in myself
      </button>
    </OnboardingLayout>
  )
}
