import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The AI boundary: OpenAI exists only behind Cloud Functions.
 *
 * The API key lives in a server-side secret, so the frontend must never
 * import the SDK, call the API, or even depend on the package — a bundle
 * that talks to OpenAI is a bundle that leaks the key. This test walks the
 * actual source tree instead of trusting the convention.
 */

const ROOT = resolve(process.cwd())

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path)
  }
  return out
}

describe('frontend never talks to OpenAI', () => {
  it('no src file imports the openai SDK', () => {
    const offenders = sourceFiles(join(ROOT, 'src')).filter((path) =>
      /from\s+['"]openai|require\(\s*['"]openai|api\.openai\.com/.test(
        readFileSync(path, 'utf8'),
      ),
    )
    expect(offenders).toEqual([])
  })

  it('the app package does not depend on openai', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain('openai')
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain('openai')
  })
})
