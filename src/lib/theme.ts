/**
 * Appearance preference: the logic half.
 *
 * The design system is entirely CSS-variable driven (see index.css): the
 * light palette lives on `:root`, the dark palette on `.dark`. Switching
 * theme is therefore exactly one decision — does `<html>` carry the `dark`
 * class — made in one place, here. Components never branch on theme.
 *
 * Persistence is two-layered on purpose:
 *  - localStorage answers *before first paint* (the inline script in
 *    index.html reads it, so there is no flash of the wrong theme), and it
 *    keeps working signed-out.
 *  - the user profile (`users/{uid}.preferences.appearance`) makes the
 *    choice survive logout/login and follow the account across browsers.
 *
 * Everything DOM- and storage-shaped takes its collaborator as a parameter
 * with a browser default, so the decision logic is testable in Node.
 */

export type AppearancePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

/** Also hard-coded in index.html's pre-paint script — keep the two in sync. */
export const APPEARANCE_STORAGE_KEY = 'sevenbase.appearance'

export const DEFAULT_APPEARANCE: AppearancePreference = 'system'

export const APPEARANCE_OPTIONS: readonly AppearancePreference[] = ['light', 'dark', 'system']

/**
 * Anything that is not an explicit, recognised choice is System. Values
 * arrive from localStorage and from Firestore profile documents, neither of
 * which is guaranteed to hold what this build wrote.
 */
export function normaliseAppearance(value: unknown): AppearancePreference {
  return value === 'light' || value === 'dark' ? value : DEFAULT_APPEARANCE
}

/** The single rule that turns a preference into a rendered theme. */
export function resolveTheme(
  preference: AppearancePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light'
  return preference
}

export function readStoredAppearance(): AppearancePreference {
  try {
    return normaliseAppearance(window.localStorage.getItem(APPEARANCE_STORAGE_KEY))
  } catch {
    // Storage can throw (private mode, blocked site data); System is always safe.
    return DEFAULT_APPEARANCE
  }
}

export function storeAppearance(preference: AppearancePreference): void {
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, preference)
  } catch {
    // Losing persistence is acceptable; breaking the toggle is not.
  }
}

/**
 * Stamps the resolved theme onto the document. The class must go on `<html>`
 * — Radix portals (tooltips, dropdown menus) render directly under `<body>`,
 * outside the app root, and must flip with everything else. `color-scheme`
 * follows so native form controls and scrollbars match the palette.
 */
export function applyResolvedTheme(theme: ResolvedTheme, root: HTMLElement): void {
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

export function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}
