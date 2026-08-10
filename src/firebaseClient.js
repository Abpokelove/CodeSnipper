import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const missingKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key)

let auth = null
let provider = null
let db = null
let firebaseConfigError = ''

if (missingKeys.length > 0) {
  firebaseConfigError = `Firebase config is missing: ${missingKeys.join(', ')}. Please create a .env file based on .env.example.`
} else {
  try {
    const app = initializeApp(firebaseConfig)
    auth = getAuth(app)
    provider = new GoogleAuthProvider()
    db = getFirestore(app)
  } catch (error) {
    firebaseConfigError = `Firebase initialization failed: ${error.message}`
  }
}

export { auth, provider, db, firebaseConfigError }
