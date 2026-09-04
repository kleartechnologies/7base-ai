/** A quiet three-dot pulse while MARKA composes its reply. */
export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-1" role="status" aria-label="EVA is thinking">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${delay}ms`, animationDuration: '1.1s' }}
        />
      ))}
    </div>
  )
}
