/// <reference types="vite/client" />

/**
 * Only values that are safe to ship to a browser belong here.
 *
 * Firebase web config is public by design — access is controlled by security
 * rules, not by hiding these values. Anything genuinely secret (OpenAI keys,
 * Billplz keys, service accounts) must live in Cloud Functions config and
 * must never gain a `VITE_` prefix.
 */
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  readonly VITE_FIREBASE_STORAGE_BUCKET: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string
  readonly VITE_FIREBASE_APP_ID: string
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string
  readonly VITE_FIREBASE_FUNCTIONS_REGION?: string
  readonly VITE_USE_FIREBASE_EMULATORS?: string
  readonly VITE_APP_ENV?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
