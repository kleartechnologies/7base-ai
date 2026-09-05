import { useCallback, useEffect, useState } from 'react'
import { observeBusiness } from '@/services/business/business.service'
import { t } from '@/i18n/store'
import { runWebsiteAnalysis, startWebsiteAnalysis } from '@/services/ai'
import type { Business, DiscoveryErrorCode, DiscoveryStage } from '@/types'

/**
 * Drives one website analysis, from URL to reviewable Business Brain.
 *
 * The callable that does the work can run for minutes, so progress does not
 * come from its promise. The backend writes each stage onto the business
 * document as it actually reaches it, and this hook subscribes to that — which
 * is why the loading screen can name a real step instead of animating a
 * meaningless bar.
 */

export type AnalysisPhase = 'idle' | 'starting' | 'running' | 'complete' | 'failed'

export interface AnalysisFailure {
  code: DiscoveryErrorCode
  message: string
}

export interface WebsiteAnalysis {
  phase: AnalysisPhase
  stage: DiscoveryStage | null
  businessId: string | null
  business: Business | null
  failure: AnalysisFailure | null
  analyse: (websiteUrl: string) => Promise<void>
  reset: () => void
}

// Built at the moment it is shown, so the message follows the active UI
// language rather than the one loaded when this module was first imported.
function genericFailure(): AnalysisFailure {
  return { code: 'internal', message: t('onboarding.analysisFailed') }
}

export function useWebsiteAnalysis(): WebsiteAnalysis {
  // What this hook itself knows: the run has been kicked off, or the call
  // never reached the backend. Everything after that is read off the document.
  const [localPhase, setLocalPhase] = useState<AnalysisPhase>('idle')
  const [localFailure, setLocalFailure] = useState<AnalysisFailure | null>(null)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [business, setBusiness] = useState<Business | null>(null)

  // Live view of the business the backend is writing into. If the listener
  // itself dies we can no longer see how the run ends, so surface a failure
  // instead of spinning forever.
  useEffect(() => {
    if (!businessId) return
    return observeBusiness(businessId, setBusiness, () => {
      setLocalFailure(genericFailure())
      setLocalPhase('failed')
    })
  }, [businessId])

  // The document is the authority on how the run ended: the callable may have
  // been abandoned by a flaky connection long after the work succeeded. Derived
  // during render rather than copied into state by an effect.
  const discovery = business?.discovery
  const phase: AnalysisPhase =
    localPhase === 'idle' || localPhase === 'starting'
      ? localPhase
      : discovery?.status === 'complete'
        ? 'complete'
        : discovery?.status === 'failed'
          ? 'failed'
          : localPhase

  const failure: AnalysisFailure | null =
    phase !== 'failed'
      ? null
      : discovery?.status === 'failed'
        ? {
            code: discovery.errorCode ?? 'internal',
            message: discovery.error ?? genericFailure().message,
          }
        : (localFailure ?? genericFailure())

  const analyse = useCallback(async (websiteUrl: string) => {
    setLocalPhase('starting')
    setLocalFailure(null)
    setBusiness(null)
    setBusinessId(null)

    const started = await startWebsiteAnalysis({ websiteUrl })
    if (!started.ok) {
      setLocalFailure({
        code: started.error.code === 'invalid_request' ? 'invalid_url' : 'internal',
        message: started.error.message || genericFailure().message,
      })
      setLocalPhase('failed')
      return
    }

    setBusinessId(started.data.businessId)
    setLocalPhase('running')

    const finished = await runWebsiteAnalysis({ businessId: started.data.businessId })
    if (!finished.ok) {
      // If the backend recorded its own outcome on the document, the
      // derivation above prefers it; this covers a call that never got there.
      // The callable's message is already owner-readable, so keep it.
      setLocalFailure({
        code: 'internal',
        message: finished.error.message || genericFailure().message,
      })
      setLocalPhase('failed')
    }
  }, [])

  const reset = useCallback(() => {
    setLocalPhase('idle')
    setLocalFailure(null)
    setBusiness(null)
    setBusinessId(null)
  }, [])

  return {
    phase,
    stage: discovery?.stage ?? null,
    businessId,
    business,
    failure,
    analyse,
    reset,
  }
}
