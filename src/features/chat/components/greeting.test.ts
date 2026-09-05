import { describe, expect, it } from 'vitest'

import { greetingKey } from './greeting'

/** The empty-state eyebrow follows the clock and uses the name when known. */
describe('greetingKey', () => {
  it('greets by time of day', () => {
    expect(greetingKey(false, 0)).toBe('chat.greetingMorning')
    expect(greetingKey(false, 11)).toBe('chat.greetingMorning')
    expect(greetingKey(false, 12)).toBe('chat.greetingAfternoon')
    expect(greetingKey(false, 18)).toBe('chat.greetingAfternoon')
    expect(greetingKey(false, 19)).toBe('chat.greetingEvening')
    expect(greetingKey(false, 23)).toBe('chat.greetingEvening')
  })

  it('uses the personalised variant when a first name is known', () => {
    expect(greetingKey(true, 9)).toBe('chat.greetingMorningName')
    expect(greetingKey(true, 14)).toBe('chat.greetingAfternoonName')
    expect(greetingKey(true, 21)).toBe('chat.greetingEveningName')
  })
})
