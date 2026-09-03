import { useAuth } from '@/hooks/useAuth'

const SUGGESTIONS = [
  'My weekday sales are slow. What should I do?',
  'Help me promote my new menu item.',
  'What should I post this week?',
]

/**
 * The first thing a user sees. One question, a calm greeting, and three
 * openers — no KPI cards, no charts, no widgets.
 */
export function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const { user } = useAuth()
  const firstName = user?.displayName?.trim().split(/\s+/)[0]

  return (
    <div className="mx-auto w-full max-w-2xl text-center">
      <h1 className="text-balance text-[28px] font-semibold tracking-[-0.02em] text-foreground sm:text-[32px]">
        {firstName ? `Hello, ${firstName}` : 'Hello'}
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
        What would you like to achieve for your business?
      </p>

      <div className="mt-9 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onPick(suggestion)}
            className="rounded-full border border-border bg-card px-3.5 py-2 text-[13px] text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  )
}
