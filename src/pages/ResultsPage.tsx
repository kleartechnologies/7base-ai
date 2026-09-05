import { TrendingUp } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'
import { PlaceholderPage } from './PlaceholderPage'

export default function ResultsPage() {
  const { t } = useI18n()
  return (
    <PlaceholderPage
      title={t('results.title')}
      description={t('results.description')}
      icon={TrendingUp}
      hint={t('results.hint')}
    />
  )
}
