import { CalendarDays } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'
import { PlaceholderPage } from './PlaceholderPage'

export default function CalendarPage() {
  const { t } = useI18n()
  return (
    <PlaceholderPage
      title={t('calendar.title')}
      description={t('calendar.description')}
      icon={CalendarDays}
      hint={t('calendar.hint')}
    />
  )
}
