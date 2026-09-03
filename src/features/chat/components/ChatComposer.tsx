import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const MAX_HEIGHT_PX = 200

/**
 * The chat input.
 *
 * Enter sends, Shift+Enter adds a newline — the convention users already know
 * from every other chat product. The field grows with the text up to a cap,
 * then scrolls internally so the composer never eats the conversation.
 */
export function ChatComposer({
  onSend,
  disabled,
  placeholder = 'Tell MARKA what you want to achieve…',
  autoFocus = false,
}: {
  onSend: (text: string) => void
  disabled?: boolean
  placeholder?: string
  autoFocus?: boolean
}) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [value])

  const canSend = value.trim().length > 0 && !disabled

  function submit() {
    if (!canSend) return
    onSend(value.trim())
    setValue('')
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    submit()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex items-end gap-2 rounded-2xl border border-input bg-card px-3.5 py-2.5 shadow-xs transition-colors focus-within:border-ring">
        <label htmlFor="chat-composer" className="sr-only">
          Message MARKA
        </label>
        <Textarea
          id="chat-composer"
          ref={textareaRef}
          variant="chromeless"
          rows={1}
          value={value}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          className="max-h-[200px] py-1.5 text-[15px] leading-[1.6]"
        />
        <Button
          type="submit"
          size="icon-sm"
          disabled={!canSend}
          aria-label="Send message"
          className="mb-0.5 rounded-full"
        >
          <ArrowUp />
        </Button>
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        MARKA can make mistakes. Review important details before publishing.
      </p>
    </form>
  )
}
