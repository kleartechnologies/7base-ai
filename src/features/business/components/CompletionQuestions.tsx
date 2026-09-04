import { useState, type FormEvent } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toUserMessage } from '@/lib/firebase/errors'
import {
  applyAnswer,
  missingQuestions,
  type CompletionQuestion,
  type CompletionWrite,
} from '@/services/business/completion'
import {
  saveBrainSection,
  saveBusinessFacts,
  saveProducts,
} from '@/services/business/business.service'
import type { Business } from '@/types'

/**
 * EVA asks, one question at a time; the owner answers or skips.
 *
 * Each answer is written to the Business Brain the moment it is given, through
 * the same owner-authorized saves the Edit buttons use — so closing the tab
 * halfway loses nothing, and every answer is stamped as the owner's, which is
 * what makes it outrank anything discovery finds later. Skipping writes
 * nothing: a skipped question is not an answer.
 */
export function CompletionQuestions({
  business,
  onSaved,
  onFinished,
}: {
  /** The freshest copy the caller has; answers are applied against it. */
  business: Business
  /** Called after each successful write, so live views can refresh. */
  onSaved?: () => void | Promise<void>
  /** Called once, when the last question has been answered or skipped. */
  onFinished?: () => void
}) {
  // Fixed at mount so answering one question never reshuffles the rest.
  const [questions] = useState<CompletionQuestion[]>(() => missingQuestions(business))
  const [index, setIndex] = useState(0)
  const [text, setText] = useState('')
  const [choices, setChoices] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const question = questions[index]

  function advance() {
    setText('')
    setChoices([])
    setError(null)
    if (index + 1 >= questions.length) onFinished?.()
    setIndex(index + 1)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!question) return
    const answer = question.kind === 'choices' ? choices : text
    const write = applyAnswer(business, question.id, answer)
    if (!write) {
      // Nothing worth writing — treat it as a skip rather than inventing a fact.
      advance()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await persist(business, write)
      await onSaved?.()
      advance()
    } catch (caught) {
      setError(toUserMessage(caught, 'Could not save that. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  if (questions.length === 0) return null

  if (!question) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Check className="size-4 shrink-0" aria-hidden />
        That’s everything for now — EVA will remember your answers.
      </p>
    )
  }

  const hasAnswer = question.kind === 'choices' ? choices.length > 0 : text.trim().length > 0

  return (
    <form onSubmit={submit} className="space-y-4">
      {questions.length > 1 ? (
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
          {index + 1} of {questions.length}
        </p>
      ) : null}

      <div>
        <p className="text-[15px] font-medium text-foreground">{question.prompt}</p>
        {question.helper ? (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {question.helper}
          </p>
        ) : null}
      </div>

      {question.kind === 'choices' ? (
        <div className="flex flex-wrap gap-1.5">
          {(question.choices ?? []).map((choice) => {
            const selected = choices.includes(choice)
            return (
              <button
                key={choice}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  setChoices((current) =>
                    selected ? current.filter((item) => item !== choice) : [...current, choice],
                  )
                }
                className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                  selected
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-secondary text-secondary-foreground hover:border-foreground/40'
                }`}
              >
                {choice}
              </button>
            )
          })}
        </div>
      ) : question.kind === 'multiline' ? (
        <Textarea
          rows={3}
          value={text}
          placeholder={question.placeholder ?? undefined}
          onChange={(event) => setText(event.target.value)}
        />
      ) : (
        <Input
          value={text}
          placeholder={question.placeholder ?? undefined}
          onChange={(event) => setText(event.target.value)}
        />
      )}

      {error ? (
        <p role="alert" className="text-[13px] leading-relaxed text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || !hasAnswer}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Save answer
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={advance} disabled={busy}>
          Skip
        </Button>
      </div>
    </form>
  )
}

/** Maps one answer onto the existing owner-authorized Brain save paths. */
async function persist(business: Business, write: CompletionWrite): Promise<void> {
  switch (write.kind) {
    case 'facts':
      await saveBusinessFacts(business, write.facts)
      return
    case 'products':
      await saveProducts(business.id, write.products)
      return
    case 'section':
      await saveBrainSection(business.id, write.section, write.value)
      return
  }
}
