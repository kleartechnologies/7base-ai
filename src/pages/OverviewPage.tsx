import { LayoutGrid } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'
import { PlaceholderPage } from './PlaceholderPage'

export default function OverviewPage() {
  const { t } = useI18n()
  return (
    <PlaceholderPage
      title={t('overview.title')}
      description={t('overview.description')}
      icon={LayoutGrid}
      hint={t('overview.hint')}
    />
  )
}
