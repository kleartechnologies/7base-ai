import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ROUTES } from '@/app/routes/paths'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">
          This page does not exist
        </h1>
      </div>
      <Button asChild variant="outline">
        <Link to={ROUTES.chat}>Back to MARKA</Link>
      </Button>
    </div>
  )
}
