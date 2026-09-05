import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/hooks/useI18n'

/**
 * The fallback, kept as small as it can possibly be.
 *
 * Two questions. Everything else MARKA will either work out in conversation or
 * pick up when a source is connected — the whole point of the product is that
 * the owner never fills in a profile form.
 */
export function ManualStep({
  busy,
  error,
  onSubmit,
  onBack,
}: {
  busy: boolean
  error: string | null
  onSubmit: (name: string, offering: string) => void
  onBack: () => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [offering, setOffering] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    onSubmit(name.trim(), offering.trim())
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="manual-name">{t('onboarding.businessName')}</Label>
        <Input
          id="manual-name"
          autoFocus
          required
          value={name}
          placeholder={t('onboarding.businessNamePlaceholder')}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="manual-offering">{t('onboarding.whatDoYouSell')}</Label>
        <Textarea
          id="manual-offering"
          rows={3}
          value={offering}
          placeholder={t('onboarding.offeringPlaceholder')}
          onChange={(event) => setOffering(event.target.value)}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" size="lg" disabled={busy || !name.trim()}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {t('common.continue')}
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={onBack} disabled={busy}>
          {t('common.back')}
        </Button>
      </div>
    </form>
  )
}
