import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useI18n } from '@/hooks/useI18n'
import { toUserMessage } from '@/lib/firebase/errors'
import { signInWithEmail, signInWithGoogle } from '@/services/auth/auth.service'
import { AuthLayout } from './components/AuthLayout'
import { FormError } from './components/FormError'
import { GoogleButton } from './components/GoogleButton'
import { DEFAULT_AUTHENTICATED_ROUTE, ROUTES } from '@/app/routes/paths'

export default function SignInPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const redirectTo =
    (location.state as { from?: string } | null)?.from ?? DEFAULT_AUTHENTICATED_ROUTE

  async function run(action: () => Promise<unknown>) {
    setError(null)
    setBusy(true)
    try {
      await action()
      navigate(redirectTo, { replace: true })
    } catch (caught) {
      setError(toUserMessage(caught, t('auth.signInFailed')))
    } finally {
      setBusy(false)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void run(() => signInWithEmail(email.trim(), password))
  }

  return (
    <AuthLayout
      title={t('auth.welcomeBack')}
      subtitle={t('auth.signInSubtitle')}
      footer={
        <>
          {t('auth.newHere')}{' '}
          <Link to={ROUTES.signUp} className="font-medium text-foreground hover:underline">
            {t('auth.createAccountLink')}
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        <GoogleButton
          label={t('auth.continueWithGoogle')}
          disabled={busy}
          onClick={() => void run(signInWithGoogle)}
        />

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">{t('common.or')}</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormError message={error} />

          <div className="space-y-2">
            <Label htmlFor="email">{t('auth.email')}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t('auth.emailPlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">{t('auth.password')}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
            />
          </div>

          <Button type="submit" className="h-10 w-full" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('auth.signIn')}
          </Button>
        </form>
      </div>
    </AuthLayout>
  )
}
