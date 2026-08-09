import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import admin from 'firebase-admin'
import fs from 'fs/promises'
import path from 'path'

dotenv.config()

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
})

const app = express()
const port = process.env.PORT || 5000
const dataDir = path.resolve(process.cwd(), 'data')
const localStorePath = path.join(dataDir, 'local-snippets.json')

let db = null
let authAvailable = false
let authError = null

function isFirestorePermissionError(error) {
  const message = String(error?.message || '').toLowerCase()
  return (
    error?.code === 7 ||
    error?.code === 'permission-denied' ||
    error?.status === 403 ||
    message.includes('permission') ||
    message.includes('missing or insufficient permissions')
  )
}

async function readLocalStore() {
  try {
    const contents = await fs.readFile(localStorePath, 'utf-8')
    return JSON.parse(contents)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { users: {} }
    }
    throw error
  }
}

async function writeLocalStore(store) {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(localStorePath, JSON.stringify(store, null, 2), 'utf-8')
}

async function getLocalUserSnippets(uid) {
  const store = await readLocalStore()
  return store.users?.[uid] ?? []
}

async function saveLocalUserSnippets(uid, snippets) {
  const store = await readLocalStore()
  store.users = store.users || {}
  store.users[uid] = snippets
  await writeLocalStore(store)
}

async function addLocalSnippet(uid, snippet) {
  const snippets = await getLocalUserSnippets(uid)
  snippets.unshift(snippet)
  await saveLocalUserSnippets(uid, snippets)
  return snippets
}

async function updateLocalSnippet(uid, snippetId, updates) {
  const snippets = await getLocalUserSnippets(uid)
  const index = snippets.findIndex((snippet) => snippet.id === snippetId)
  if (index === -1) {
    return null
  }
  snippets[index] = { ...snippets[index], ...updates }
  await saveLocalUserSnippets(uid, snippets)
  return snippets
}

async function deleteLocalSnippet(uid, snippetId) {
  const snippets = await getLocalUserSnippets(uid)
  const filtered = snippets.filter((snippet) => snippet.id !== snippetId)
  await saveLocalUserSnippets(uid, filtered)
  return filtered
}

function sortSnippetsByCreatedAt(snippets) {
  return [...snippets].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
}

function normalizeSnippet(doc) {
  const data = doc.data() || {}
  return {
    id: doc.id,
    title: data.title || '',
    description: data.description || '',
    code: data.code || '',
    createdAt: data.createdAt || '',
  }
}

function tryFirestore(operation) {
  if (!db) {
    const error = new Error('Firestore is not available.')
    error.status = 503
    throw error
  }

  return operation().catch((error) => {
    if (isFirestorePermissionError(error)) {
      console.error('Firestore permission denied:', error.message)
      const err = new Error('Firestore permission denied. Confirm your service account credentials and IAM roles.')
      err.status = 403
      throw err
    }
    throw error
  })
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

async function loadSnippetsFromFirestore(uid) {
  const snapshot = await db.collection('users').doc(uid).collection('snippets').orderBy('createdAt', 'desc').get()
  return snapshot.docs.map(normalizeSnippet)
}

async function getUserSnippets(uid) {
  if (!db) {
    return sortSnippetsByCreatedAt(await getLocalUserSnippets(uid))
  }

  return await tryFirestore(async () => await loadSnippetsFromFirestore(uid))
}

const useApplicationDefault = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS)
let credential = null

if (useApplicationDefault) {
  credential = admin.credential.applicationDefault()
} else if (
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY
) {
  credential = admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  })
} else {
  authError = 'Firebase Admin credentials are missing. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.'
}

if (credential) {
  try {
    admin.initializeApp({ credential })
    db = admin.firestore()
    authAvailable = true
    console.log('Firebase Admin initialized successfully.')
  } catch (error) {
    authError = `Firebase Admin initialization failed: ${error.message}`
    db = null
    console.error(authError)
  }
} else {
  console.warn('Firebase Admin credentials were not configured. Auth routes will return 503 until credentials are added.')
}

app.use(cors({ origin: true }))
app.use(express.json())

async function authMiddleware(req, res, next) {
  if (!authAvailable) {
    return res.status(503).json({ error: authError || 'Authentication is not configured on the server.' })
  }

  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token)
    req.user = {
      uid: decodedToken.uid,
      name: decodedToken.name || decodedToken.email,
      email: decodedToken.email,
      picture: decodedToken.picture,
    }
    next()
  } catch (error) {
    console.error('Token verification failed:', error.message)
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, firestore: Boolean(db), authConfigured: authAvailable, authError })
})

app.get('/api/auth/me', authMiddleware, asyncHandler(async (req, res) => {
  const snippets = await getUserSnippets(req.user.uid)
  res.json({ user: req.user, snippets })
}))

app.get('/api/snippets', authMiddleware, asyncHandler(async (req, res) => {
  const snippets = await getUserSnippets(req.user.uid)
  res.json({ snippets })
}))

app.post('/api/snippets', authMiddleware, asyncHandler(async (req, res) => {
  const { title, description, code } = req.body
  if (!title || !code) {
    return res.status(400).json({ error: 'Title and code are required' })
  }

  const snippetId = String(Date.now())
  const snippetData = {
    title: title.trim(),
    description: (description || '').trim(),
    code: code.trim(),
    createdAt: new Date().toISOString(),
  }

  const snippets = db
    ? await tryFirestore(async () => {
        await db.collection('users').doc(req.user.uid).collection('snippets').doc(snippetId).set(snippetData)
        return await loadSnippetsFromFirestore(req.user.uid)
      })
    : await addLocalSnippet(req.user.uid, { id: snippetId, ...snippetData })

  res.json({ snippets })
}))

app.put('/api/snippets/:id', authMiddleware, asyncHandler(async (req, res) => {
  const { title, description, code } = req.body
  if (!title || !code) {
    return res.status(400).json({ error: 'Title and code are required' })
  }

  const snippets = db
    ? await tryFirestore(async () => {
        const snippetRef = db.collection('users').doc(req.user.uid).collection('snippets').doc(req.params.id)
        const snapshot = await snippetRef.get()
        if (!snapshot.exists) {
          return null
        }

        await snippetRef.update({
          title: title.trim(),
          description: (description || '').trim(),
          code: code.trim(),
        })

        return await loadSnippetsFromFirestore(req.user.uid)
      })
    : await updateLocalSnippet(req.user.uid, req.params.id, {
        title: title.trim(),
        description: (description || '').trim(),
        code: code.trim(),
      })

  if (snippets === null) {
    return res.status(404).json({ error: 'Snippet not found' })
  }

  res.json({ snippets })
}))

app.delete('/api/snippets/:id', authMiddleware, asyncHandler(async (req, res) => {
  const snippets = db
    ? await tryFirestore(async () => {
        const snippetRef = db.collection('users').doc(req.user.uid).collection('snippets').doc(req.params.id)
        await snippetRef.delete()
        return await loadSnippetsFromFirestore(req.user.uid)
      })
    : await deleteLocalSnippet(req.user.uid, req.params.id)

  res.json({ snippets })
}))

app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err)
  if (res.headersSent) {
    return next(err)
  }

  const status = err.status || (err.message && err.message.toLowerCase().includes('permission denied') ? 403 : 500)
  res.status(status).json({ error: err.message || 'Internal server error.' })
})

app.listen(port, () => {
  console.log(`Snippet server running on http://localhost:${port}`)
})
