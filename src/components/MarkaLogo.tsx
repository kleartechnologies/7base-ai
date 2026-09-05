import { cn } from '@/lib/utils'

/**
 * The wordmark. Restrained by design — no gradient, no glow.
 *
 * The customer-facing product name is 7BASE AI; the component keeps its
 * historical identifier, which is internal and safe to leave.
 */
export function MarkaLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'select-none text-[15px] font-semibold tracking-[-0.02em] text-foreground',
        className,
      )}
    >
      7BASE AI
    </span>
  )
}
