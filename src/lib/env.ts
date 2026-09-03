/**
 * Validated access to client environment variables.
 *
 * Reading `import.meta.env` directly across the codebase makes a missing
 * variable fail late and cryptically (usually as an opaque Firebase error).
 * This module fails once, loudly, with the name of what is missing.
 */

const REQUIRED_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const

type RequiredKey = (typeof REQUIRED_KEYS)[number]

export class MissingEnvError extends Error {
  constructor(readonly keys: string[]) {
    super(
      `Missing required environment variables: ${keys.join(', ')}. ` +
        'Copy .env.example to .env.local and fill in your Firebase web config.',
    )
    this.name = 'MissingEnvError'
  }
}

function readRequired(): Record<RequiredKey, string> {
  const missing: string[] = []
  const values = {} as Record<RequiredKey, string>

  for (const key of REQUIRED_KEYS) {
    const value = import.meta.env[key]
    if (!value) {
      missing.push(key)
    } else {
      values[key] = value
    }
  }

  if (missing.length > 0) {
    throw new MissingEnvError(missing)
  }

  return values
}

function readBoolean(value: string | undefined): boolean {
  return value === 'true' || value === '1'
}

export interface AppEnv {
  firebase: {
    apiKey: string
    authDomain: string
    projectId: string
    storageBucket: string
    messagingSenderId: string
    appId: string
    measurementId?: string
  }
  functionsRegion: string
  useEmulators: boolean
  appEnv: string
  isProduction: boolean
}

let cached: AppEnv | null = null

/** Throws `MissingEnvError` if the app is not configured. */
export function getEnv(): AppEnv {
  if (cached) return cached

  const required = readRequired()
  const measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID

  cached = {
    firebase: {
      apiKey: required.VITE_FIREBASE_API_KEY,
      authDomain: required.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: required.VITE_FIREBASE_PROJECT_ID,
      storageBucket: required.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: required.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: required.VITE_FIREBASE_APP_ID,
      ...(measurementId ? { measurementId } : {}),
    },
    functionsRegion: import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'asia-southeast1',
    useEmulators: readBoolean(import.meta.env.VITE_USE_FIREBASE_EMULATORS),
    appEnv: import.meta.env.VITE_APP_ENV || import.meta.env.MODE,
    isProduction: import.meta.env.PROD,
  }

  return cached
}

/** Non-throwing check used by the boot screen to render a helpful message. */
export function getMissingEnvKeys(): string[] {
  return REQUIRED_KEYS.filter((key) => !import.meta.env[key])
}
