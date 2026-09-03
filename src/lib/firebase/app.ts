import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore'
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator, type Functions } from 'firebase/functions'
import { getEnv } from '@/lib/env'

/**
 * Single Firebase entry point.
 *
 * Nothing outside `src/lib/firebase` and `src/services` should import the
 * Firebase SDK directly — UI components talk to services, services talk to
 * this module. That keeps the data layer swappable and testable.
 *
 * Initialisation is lazy so a missing-config error surfaces in the boot screen
 * rather than as a blank page during module evaluation.
 */

interface FirebaseClients {
  app: FirebaseApp
  auth: Auth
  db: Firestore
  storage: FirebaseStorage
  functions: Functions
}

let clients: FirebaseClients | null = null

function initClients(): FirebaseClients {
  const env = getEnv()

  const app = getApps().length > 0 ? getApp() : initializeApp(env.firebase)
  const auth = getAuth(app)
  const db = getFirestore(app)
  const storage = getStorage(app)
  const functions = getFunctions(app, env.functionsRegion)

  if (env.useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFirestoreEmulator(db, '127.0.0.1', 8080)
    connectStorageEmulator(storage, '127.0.0.1', 9199)
    connectFunctionsEmulator(functions, '127.0.0.1', 5001)
  }

  return { app, auth, db, storage, functions }
}

function getClients(): FirebaseClients {
  if (!clients) {
    clients = initClients()
  }
  return clients
}

export const getFirebaseApp = () => getClients().app
export const getFirebaseAuth = () => getClients().auth
export const getDb = () => getClients().db
export const getFirebaseStorage = () => getClients().storage
export const getFirebaseFunctions = () => getClients().functions
