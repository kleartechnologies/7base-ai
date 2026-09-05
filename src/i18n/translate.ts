import { en, type MessageKey } from './messages/en'
import { ms } from './messages/ms'
import type { Language } from './language'

const DICTIONARIES: Record<Language, Record<MessageKey, string>> = { en, ms }

export type TranslateParams = Record<string, string | number>

/**
 * Resolves one message in one language, interpolating `{name}` placeholders.
 *
 * A placeholder without a matching param is left visible rather than being
 * swallowed — a `{title}` on screen is a bug you can see and fix; an empty
 * gap is a bug you have to reproduce.
 */
export function translate(language: Language, key: MessageKey, params?: TranslateParams): string {
  const message = DICTIONARIES[language][key]
  if (!params) return message
  return message.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

export type { MessageKey }
