import { DEFAULT_LANGUAGE, type Language } from './language'
import { translate, type MessageKey, type TranslateParams } from './translate'

/**
 * The current-language store.
 *
 * A plain module store, not React state, because user-facing copy is not
 * produced only by components: services and error mappers (firebase/errors,
 * ai.client) build sentences at event time, outside the tree. They call `t`
 * here; React reads the same value through LocaleProvider's
 * useSyncExternalStore, so both worlds always agree.
 *
 * The store starts at the default and is set from localStorage/profile by
 * LocaleProvider — safe order, because nothing translates before render.
 */

let current: Language = DEFAULT_LANGUAGE
const listeners = new Set<() => void>()

export function getLanguage(): Language {
  return current
}

export function setLanguageValue(next: Language): void {
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Translate in the currently active language. */
export function t(key: MessageKey, params?: TranslateParams): string {
  return translate(current, key, params)
}
