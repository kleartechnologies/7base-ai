import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toUserMessage } from '@/lib/firebase/errors'
import { signInWithGoogle, signUpWithEmail } from '@/services/auth/auth.service'
import { AuthLayout } from './components/AuthLayout'
import { FormError } from './components/FormError'
import { GoogleButton } from './components/GoogleButton'
import { DEFAULT_AUTHENTICATED_ROUTE, ROUTES } from '@/app/routes/paths'

const MIN_PASSWORD_LENGTH = 6

export default function SignUpPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<unknown>) {
    setError(null)
    setBusy(true)
    try {
      await action()
      navigate(DEFAULT_AUTHENTICATED_ROUTE, { replace: true })
    } catch (caught) {
      setError(toUserMessage(caught, 'Could not create your account. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Please choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    void run(() => signUpWithEmail(email.trim(), password, name))
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Set up MARKA in under a minute."
      footer={
        <>
          Already have an account?{' '}
          <Link to={ROUTES.signIn} className="font-medium text-foreground hover:underline">
            Sign in
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
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Aisyah"
            />
          </div>

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
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 6 characters"
            />
          </div>

          <Button type="submit" className="h-10 w-full" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Create account
          </Button>
        </form>
      </div>
    </AuthLayout>
  )
}
