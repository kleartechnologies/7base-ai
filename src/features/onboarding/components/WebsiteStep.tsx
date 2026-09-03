import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { checkWebsiteUrl } from '../url'

/**
 * The only question MARKA asks before it starts working.
 *
 * The sub-copy is precise on purpose: MARKA reads what is publicly on the
 * site. It does not get access to anything private, and must not imply it
 * does.
 */
export function WebsiteStep({
  initialUrl = '',
  busy,
  onSubmit,
  onBack,
}: {
  initialUrl?: string
  busy: boolean
  onSubmit: (url: string) => void
  onBack: () => void
}) {
  const [value, setValue] = useState(initialUrl)
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const check = checkWebsiteUrl(value)
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
        <Label htmlFor="website-url">Your website</Label>
        <Input
          id="website-url"
          autoFocus
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="warungpakdin.com"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby="website-url-help"
          onChange={(event) => {
            setValue(event.target.value)
            if (error) setError(null)
          }}
        />
        <p id="website-url-help" className="text-[13px] leading-relaxed text-muted-foreground">
          MARKA will analyse publicly available information from your website.
        </p>
        {error ? (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" size="lg" disabled={busy || value.trim().length === 0}>
          Analyse my website
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={onBack} disabled={busy}>
          Back
        </Button>
      </div>
    </form>
  )
}
