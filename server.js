import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import admin from 'firebase-admin'

dotenv.config()

const app = express()
const port = process.env.PORT || 5000

const useApplicationDefault = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS)
let credential

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
  console.error(
    'Firebase Admin credentials are missing. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.',
  )
  process.exit(1)
}

admin.initializeApp({ credential })
const db = admin.firestore()

app.use(cors({ origin: true }))
app.use(express.json())

async function authMiddleware(req, res, next) {
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
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
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

function userSnippetsCollection(uid) {
  return db.collection('users').doc(uid).collection('snippets')
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const snapshot = await userSnippetsCollection(req.user.uid).orderBy('createdAt', 'desc').get()
  const snippets = snapshot.docs.map(normalizeSnippet)
  res.json({ user: req.user, snippets })
})

app.get('/api/snippets', authMiddleware, async (req, res) => {
  const snapshot = await userSnippetsCollection(req.user.uid).orderBy('createdAt', 'desc').get()
  const snippets = snapshot.docs.map(normalizeSnippet)
  res.json({ snippets })
})

app.post('/api/snippets', authMiddleware, async (req, res) => {
  const { title, description, code } = req.body
  if (!title || !code) {
    return res.status(400).json({ error: 'Title and code are required' })
  }

  const newSnippet = {
    title: title.trim(),
    description: (description || '').trim(),
    code: code.trim(),
    createdAt: new Date().toISOString(),
  }

  await userSnippetsCollection(req.user.uid).add(newSnippet)
  const snapshot = await userSnippetsCollection(req.user.uid).orderBy('createdAt', 'desc').get()
  const snippets = snapshot.docs.map(normalizeSnippet)
  res.json({ snippets })
})

app.put('/api/snippets/:id', authMiddleware, async (req, res) => {
  const { title, description, code } = req.body
  if (!title || !code) {
    return res.status(400).json({ error: 'Title and code are required' })
  }

  const snippetRef = userSnippetsCollection(req.user.uid).doc(req.params.id)
  const snapshot = await snippetRef.get()
  if (!snapshot.exists) {
    return res.status(404).json({ error: 'Snippet not found' })
  }

  await snippetRef.update({
    title: title.trim(),
    description: (description || '').trim(),
    code: code.trim(),
  })

  const updatedSnapshot = await userSnippetsCollection(req.user.uid).orderBy('createdAt', 'desc').get()
  const snippets = updatedSnapshot.docs.map(normalizeSnippet)
  res.json({ snippets })
})

app.delete('/api/snippets/:id', authMiddleware, async (req, res) => {
  const snippetRef = userSnippetsCollection(req.user.uid).doc(req.params.id)
  await snippetRef.delete()
  const snapshot = await userSnippetsCollection(req.user.uid).orderBy('createdAt', 'desc').get()
  const snippets = snapshot.docs.map(normalizeSnippet)
  res.json({ snippets })
})

app.listen(port, () => {
  console.log(`Snippet server running on http://localhost:${port}`)
})
