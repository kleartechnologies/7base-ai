import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/hooks/useI18n'
import type { MessageKey } from '@/i18n/translate'

const SUGGESTION_KEYS: readonly MessageKey[] = [
  'chat.suggestionSlowSales',
  'chat.suggestionNewItem',
  'chat.suggestionWhatToPost',
]

/**
 * The first thing a user sees. One question, a calm greeting, and three
 * openers — no KPI cards, no charts, no widgets.
 */
export function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const { user } = useAuth()
  const { t } = useI18n()
  const firstName = user?.displayName?.trim().split(/\s+/)[0]

  return (
    <div className="mx-auto w-full max-w-2xl text-center">
      <h1 className="text-balance text-[28px] font-semibold tracking-[-0.02em] text-foreground sm:text-[32px]">
        {firstName ? t('chat.helloName', { name: firstName }) : t('chat.hello')}
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
        {t('chat.emptyPrompt')}
      </p>

      <div className="mt-9 flex flex-wrap justify-center gap-2">
        {SUGGESTION_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onPick(t(key))}
            className="rounded-full border border-border bg-card px-3.5 py-2 text-[13px] text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground"
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  )
}
