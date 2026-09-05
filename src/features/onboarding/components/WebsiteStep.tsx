import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useI18n } from '@/hooks/useI18n'
import { checkDiscoveryUrl } from '../url'

/**
 * The only question MARKA asks before it starts working: one link where EVA
 * can learn about the business — a website, a Facebook Page, or an Instagram
 * profile.
 *
 * The sub-copy is precise on purpose: EVA reads what is publicly on the page.
 * It does not get access to anything private, does not log in anywhere, and
 * must not imply it does. And the no-link path is a first-class exit, not a
 * dead end — plenty of real businesses have nothing to paste.
 */
export function WebsiteStep({
  initialUrl = '',
  busy,
  onSubmit,
  onBack,
  onNoOnlinePresence,
}: {
  initialUrl?: string
  busy: boolean
  onSubmit: (url: string) => void
  onBack: () => void
  onNoOnlinePresence: () => void
}) {
  const { t } = useI18n()
  const [value, setValue] = useState(initialUrl)
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const check = checkDiscoveryUrl(value)
    if (!check.ok) {
      setError(check.message)
      return
    }
    setError(null)
    onSubmit(check.url)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="website-url">{t('onboarding.websiteLabel')}</Label>
        <Input
          id="website-url"
          autoFocus
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder={t('onboarding.websitePlaceholder')}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby="website-url-help"
          onChange={(event) => {
            setValue(event.target.value)
            if (error) setError(null)
          }}
        />
        <p id="website-url-help" className="text-[13px] leading-relaxed text-muted-foreground">
          {t('onboarding.websiteHelp')}
        </p>
        {error ? (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" size="lg" disabled={busy || value.trim().length === 0}>
          {t('onboarding.letEvaLook')}
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={onBack} disabled={busy}>
          {t('common.back')}
        </Button>
      </div>

      <button
        type="button"
        onClick={onNoOnlinePresence}
        disabled={busy}
        className="text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:underline disabled:opacity-55"
      >
        {t('onboarding.noOnlinePresence')}
      </button>
    </form>
  )
}
