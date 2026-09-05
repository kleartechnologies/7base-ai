import type { BaseEntity, EntityId, Millis } from './common'

/**
 * Application-level profile, mirrored from Firebase Auth on first sign-in.
 * The Auth record stays the source of truth for credentials.
 */
export interface UserProfile extends BaseEntity {
  email: string
  displayName: string | null
  photoURL: string | null
  /** Businesses the user can act on. A user may own more than one. */
  businessIds: EntityId[]
  /** The business the app opens into. */
  activeBusinessId: EntityId | null
  onboarding: OnboardingState
  locale: string
  /**
   * Cross-device preferences. Absent on profiles created before Phase 7B and
   * stored as raw strings — always read through the normalisers
   * (`normaliseAppearance`, `normaliseLanguage`), never trusted as typed.
   * localStorage keeps the fast, signed-out copy of the same values.
   */
  preferences?: UserPreferences | null
}

export interface UserPreferences {
  /** 'light' | 'dark' | 'system' once normalised. */
  appearance?: string
  /** 'en' | 'ms' once normalised. EVA also reads this server-side. */
  language?: string
}

export type OnboardingStep =
  | 'not_started'
  | 'describe_business'
  | 'reviewing_discovery'
  | 'complete'

export interface OnboardingState {
  step: OnboardingStep
  completedAt: Millis | null
}
