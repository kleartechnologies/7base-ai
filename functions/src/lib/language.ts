/**
 * Reply-language preference resolution — the pure half.
 *
 * The source of truth is `users/{uid}.preferences.language`, the same field
 * the app's Settings page writes for its own UI. Unlike the subscription
 * plan, this is deliberately a user-writable preference: the only thing it
 * can change is which language EVA *defaults* to when a message carries no
 * language signal of its own. It grants nothing — no model, no plan, no
 * quota — so client writes are harmless.
 *
 * Mirrors lib/plan.ts: this module has no Firebase imports so the shape
 * handling can be unit tested exhaustively; the Firestore lookup lives in
 * lib/auth.ts with the other per-request reads.
 */

export type UserLanguage = 'en' | 'ms'

export const DEFAULT_USER_LANGUAGE: UserLanguage = 'en'

/**
 * Reduces whatever is (or is not) stored to a supported language, fail-safe.
 * Only the exact string 'ms' selects Bahasa Melayu; a missing document, a
 * missing field, or any other value — 'en-MY', 'id', numbers, objects —
 * lands on English, matching the app's own `normaliseLanguage`.
 */
export function normaliseUserLanguage(data: unknown): UserLanguage {
  if (typeof data !== 'object' || data === null) return DEFAULT_USER_LANGUAGE
  const preferences = (data as Record<string, unknown>).preferences
  if (typeof preferences !== 'object' || preferences === null) return DEFAULT_USER_LANGUAGE
  const language = (preferences as Record<string, unknown>).language
  return language === 'ms' ? 'ms' : DEFAULT_USER_LANGUAGE
}
