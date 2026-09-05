import { EvaMark } from '@/components/EvaMark'
import { useI18n } from '@/hooks/useI18n'

/** EVA's pulsing spark plus a quiet line while she composes her reply. */
export function ThinkingIndicator() {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-3" role="status" aria-label={t('chat.thinking')}>
      <EvaMark state="thinking" />
      <span className="animate-eva-pulse text-[14px] text-muted-foreground motion-reduce:animate-none">
        {t('chat.thinkingEllipsis')}
      </span>
    </div>
  )
}
