import { describe, expect, it } from 'vitest'

import {
  createStreamBuffer,
  STREAM_FLUSH_INTERVAL_MS,
  type StreamBufferScheduler,
} from './streamBuffer'

/**
 * The rendering cadence of a streamed reply.
 *
 * Two properties carry the feel: the first delta after quiet renders
 * IMMEDIATELY (time-to-first-text is the whole point of streaming), and a
 * burst of deltas coalesces into one update instead of one render per token.
 * And one property carries correctness: however the flush timing falls, no
 * text is ever lost — the assembled text always equals the concatenation of
 * everything pushed.
 */

/** A hand-cranked clock: flushes run only when the test advances time. */
function fakeScheduler() {
  let now = 0
  const timers = new Map<number, { at: number; run: () => void }>()
  let nextId = 1

  const scheduler: StreamBufferScheduler = {
    now: () => now,
    schedule: (flush, delayMs) => {
      const id = nextId++
      timers.set(id, { at: now + delayMs, run: flush })
      return id
    },
    cancel: (handle) => {
      timers.delete(handle as number)
    },
  }

  return {
    scheduler,
    advance(ms: number) {
      now += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id)
          timer.run()
        }
      }
    },
    pendingTimers: () => timers.size,
  }
}

describe('createStreamBuffer', () => {
  it('flushes the very first delta immediately — no tax on time to first text', () => {
    const clock = fakeScheduler()
    const flushes: string[] = []
    const buffer = createStreamBuffer((text) => flushes.push(text), clock.scheduler)

    buffer.push('Kalau ')
    expect(flushes).toEqual(['Kalau '])
  })

  it('coalesces a fast burst into a single trailing flush with the full text', () => {
    const clock = fakeScheduler()
    const flushes: string[] = []
    const buffer = createStreamBuffer((text) => flushes.push(text), clock.scheduler)

    buffer.push('a') // leading flush
    buffer.push('b')
    buffer.push('c')
    buffer.push('d')
    expect(flushes).toEqual(['a'])

    clock.advance(STREAM_FLUSH_INTERVAL_MS)
    expect(flushes).toEqual(['a', 'abcd'])
  })

  it('renders continuously — a long stream flushes about once per interval, not once per token', () => {
    const clock = fakeScheduler()
    const flushes: string[] = []
    const buffer = createStreamBuffer((text) => flushes.push(text), clock.scheduler)

    // 100 deltas arriving at 10ms spacing = 1s of streaming.
    let expected = ''
    for (let index = 0; index < 100; index += 1) {
      buffer.push('x')
      expected += 'x'
      clock.advance(10)
    }

    // The trailing flush lands within one interval of the last delta.
    clock.advance(STREAM_FLUSH_INTERVAL_MS)

    // ~20 flushes for 100 chunks: smooth, but never one render per chunk.
    expect(flushes.length).toBeGreaterThanOrEqual(15)
    expect(flushes.length).toBeLessThanOrEqual(25)
    // No text is ever held back: the last flush holds everything pushed.
    expect(flushes.at(-1)).toBe(expected)
  })

  it('assembles the exact concatenation of every delta, in order', () => {
    const clock = fakeScheduler()
    const buffer = createStreamBuffer(() => {}, clock.scheduler)

    const deltas = ['Kalau ikut ', 'apa yang ', 'saya tahu ', 'tentang bisnes awak…']
    for (const piece of deltas) buffer.push(piece)

    expect(buffer.finish()).toBe(deltas.join(''))
  })

  it('finish cancels the pending flush so nothing renders after completion', () => {
    const clock = fakeScheduler()
    const flushes: string[] = []
    const buffer = createStreamBuffer((text) => flushes.push(text), clock.scheduler)

    buffer.push('a')
    buffer.push('b') // schedules a trailing flush
    expect(buffer.finish()).toBe('ab')

    clock.advance(STREAM_FLUSH_INTERVAL_MS * 2)
    expect(flushes).toEqual(['a']) // the trailing flush never fired
    expect(clock.pendingTimers()).toBe(0)
  })

  it('an empty stream flushes nothing and finishes empty', () => {
    const clock = fakeScheduler()
    const flushes: string[] = []
    const buffer = createStreamBuffer((text) => flushes.push(text), clock.scheduler)

    expect(buffer.finish()).toBe('')
    expect(flushes).toEqual([])
  })
})
