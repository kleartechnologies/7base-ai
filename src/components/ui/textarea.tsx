import type * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * `default` matches Input — border, padding, focus ring, minimum height — so
 * form textareas read as form fields. `chromeless` is the bare field the chat
 * composer embeds inside its own bordered shell; nothing else should use it.
 */
const VARIANTS = {
  default: cn(
    'flex min-h-20 w-full resize-none rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs transition-colors',
    'placeholder:text-muted-foreground',
    'focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25',
    'disabled:cursor-not-allowed disabled:opacity-50',
  ),
  chromeless: cn(
    'flex w-full resize-none rounded-md bg-transparent text-sm outline-none',
    'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
  ),
} as const

interface TextareaProps extends React.ComponentProps<'textarea'> {
  variant?: keyof typeof VARIANTS
}

function Textarea({ className, variant = 'default', ...props }: TextareaProps) {
  return <textarea className={cn(VARIANTS[variant], className)} {...props} />
}

export { Textarea }
