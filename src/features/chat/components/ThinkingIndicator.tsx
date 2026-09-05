import { useI18n } from '@/hooks/useI18n'

/** A quiet three-dot pulse while EVA composes its reply. */
export function ThinkingIndicator() {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-1.5 py-1" role="status" aria-label={t('chat.thinking')}>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${delay}ms`, animationDuration: '1.1s' }}
        />
      ))}
    </div>
  )
}
