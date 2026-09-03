import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toUserMessage } from '@/lib/firebase/errors'
import { signInWithEmail, signInWithGoogle } from '@/services/auth/auth.service'
import { AuthLayout } from './components/AuthLayout'
import { FormError } from './components/FormError'
import { GoogleButton } from './components/GoogleButton'
import { DEFAULT_AUTHENTICATED_ROUTE, ROUTES } from '@/app/routes/paths'

export default function SignInPage() {
  const navigate = useNavigate()
  const location = useLocation()
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
      setError(toUserMessage(caught, 'Could not sign in. Please try again.'))
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
      title="Welcome back"
      subtitle="Sign in to continue with MARKA."
      footer={
        <>
          New to MARKA?{' '}
          <Link to={ROUTES.signUp} className="font-medium text-foreground hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        <GoogleButton
          label="Continue with Google"
          disabled={busy}
          onClick={() => void run(signInWithGoogle)}
        />

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormError message={error} />

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@restaurant.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
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
            Sign in
          </Button>
        </form>
      </div>
    </AuthLayout>
  )
}
