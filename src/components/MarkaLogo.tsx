import { cn } from '@/lib/utils'

/** The wordmark. Restrained by design — no gradient, no glow. */
export function MarkaLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'select-none text-[15px] font-semibold tracking-[-0.02em] text-foreground',
        className,
      )}
    >
      MARKA
    </span>
  )
}
