import { useState } from 'react'
import { useI18n } from '@/hooks/useI18n'
import { completionIntro, missingQuestions } from '@/services/business/completion'
import type { Business } from '@/types'
import { CompletionQuestions } from './CompletionQuestions'

/**
 * "Help EVA finish your profile", on the Business tab.
 *
 * Renders only while EVA still has questions worth asking, and mounts once per
 * visit — it never nags mid-session as answers land. Missing information is
 * framed as the opportunity it is, not a failure.
 */
export function CompletionCard({
  business,
  onSaved,
}: {
  business: Business
  onSaved?: () => void | Promise<void>
}) {
  const { t } = useI18n()
  // Decided at mount: a card that vanished the moment the last answer saved
  // would swallow its own "EVA will remember your answers" confirmation.
  const [visible] = useState(() => missingQuestions(business).length > 0)
  const [intro] = useState(() => completionIntro(business))

  if (!visible) return null

  return (
    <section className="rounded-xl border border-dashed border-border bg-card px-6 py-5">
      <h2 className="text-[15px] font-semibold text-foreground">{t('business.completionTitle')}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{intro}</p>
      <div className="mt-4">
        <CompletionQuestions business={business} onSaved={onSaved} />
      </div>
    </section>
  )
}
