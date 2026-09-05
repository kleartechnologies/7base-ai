import type { MessageKey } from '@/i18n/translate'

/** The greeting follows the clock, like the approved design's eyebrow. */
export function greetingKey(hasName: boolean, hour: number): MessageKey {
  if (hour < 12) return hasName ? 'chat.greetingMorningName' : 'chat.greetingMorning'
  if (hour < 19) return hasName ? 'chat.greetingAfternoonName' : 'chat.greetingAfternoon'
  return hasName ? 'chat.greetingEveningName' : 'chat.greetingEvening'
}
