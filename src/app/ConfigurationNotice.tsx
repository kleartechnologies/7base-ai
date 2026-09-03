/**
 * Shown when the app boots without its Firebase config.
 *
 * This is a developer-facing screen — it names the missing variables, because
 * "app is broken" costs far more time than a precise checklist.
 */
export function ConfigurationNotice({ missingKeys }: { missingKeys: string[] }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-lg">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">
          MARKA is not configured
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Copy <code className="rounded bg-muted px-1 py-0.5 text-xs">.env.example</code> to{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">.env.local</code> and fill in your
          Firebase web config, then restart the dev server.
        </p>

        <div className="mt-6 rounded-xl border border-border bg-card px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Missing variables
          </p>
          <ul className="mt-3 space-y-1.5">
            {missingKeys.map((key) => (
              <li key={key} className="font-mono text-[13px] text-foreground">
                {key}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
