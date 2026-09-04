/**
 * Coalesces a streamed reply's deltas into smooth UI updates.
 *
 * Model deltas arrive as token-sized bursts, often several per frame. Setting
 * React state for each would render hundreds of times per reply for no visual
 * gain, while batching too coarsely makes the text arrive in visible lumps.
 * This buffer flushes on the leading edge — the first delta after a quiet
 * moment renders immediately, so time-to-first-text is never taxed — and then
 * at most once per interval, with a trailing flush so no text is ever held
 * back. It never delays beyond the interval: this smooths, it does not slow.
 */

/** Flush cadence. ~20 updates/s reads as continuous typing. */
export const STREAM_FLUSH_INTERVAL_MS = 50

/** Injectable timing seam so tests need no real clock. */
export interface StreamBufferScheduler {
  now(): number
  schedule(flush: () => void, delayMs: number): unknown
  cancel(handle: unknown): void
}

const realScheduler: StreamBufferScheduler = {
  now: () => Date.now(),
  schedule: (flush, delayMs) => setTimeout(flush, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface StreamBuffer {
  /** Appends one delta; `onFlush` receives the full text so far. */
  push(delta: string): void
  /** Cancels any pending flush and returns everything accumulated. */
  finish(): string
}

export function createStreamBuffer(
  onFlush: (fullText: string) => void,
  scheduler: StreamBufferScheduler = realScheduler,
): StreamBuffer {
  let text = ''
  let handle: unknown = null
  let lastFlushAt = -Infinity

  const flushNow = () => {
    handle = null
    lastFlushAt = scheduler.now()
    onFlush(text)
  }

  return {
    push(delta) {
      text += delta
      if (handle !== null) return
      if (scheduler.now() - lastFlushAt >= STREAM_FLUSH_INTERVAL_MS) {
        flushNow()
      } else {
        handle = scheduler.schedule(flushNow, STREAM_FLUSH_INTERVAL_MS)
      }
    },
    finish() {
      if (handle !== null) {
        scheduler.cancel(handle)
        handle = null
      }
      return text
    },
  }
}
