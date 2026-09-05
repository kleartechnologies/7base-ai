import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ROUTES } from '@/app/routes/paths'
import { useI18n } from '@/hooks/useI18n'

export default function NotFoundPage() {
  const { t } = useI18n()
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">
          {t('app.notFoundTitle')}
        </h1>
      </div>
      <Button asChild variant="outline">
        <Link to={ROUTES.chat}>{t('app.notFoundBack')}</Link>
      </Button>
    </div>
  )
}
