import { useEffect, useMemo, useState } from 'react'
import { auth, provider, db, firebaseConfigError } from './firebaseClient'
import {
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth'
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  onSnapshot,
} from 'firebase/firestore'

const emptyForm = {
  title: '',
  description: '',
  code: '',
  language: 'python',
}

const LANGUAGES = [
  { value: 'python', label: 'Python (.py)' },
  { value: 'javascript', label: 'JavaScript (.js)' },
  { value: 'typescript', label: 'TypeScript (.ts)' },
  { value: 'java', label: 'Java (.java)' },
  { value: 'c', label: 'C (.c)' },
  { value: 'cpp', label: 'C++ (.cpp)' },
  { value: 'csharp', label: 'C# (.cs)' },
  { value: 'go', label: 'Go (.go)' },
  { value: 'rust', label: 'Rust (.rs)' },
  { value: 'ruby', label: 'Ruby (.rb)' },
  { value: 'php', label: 'PHP (.php)' },
  { value: 'html', label: 'HTML (.html)' },
  { value: 'css', label: 'CSS (.css)' },
  { value: 'sql', label: 'SQL (.sql)' },
  { value: 'shell', label: 'Shell (.sh)' },
  { value: 'text', label: 'Plain Text (.txt)' },
]

// Dropbox upload URL — in dev, Vite proxies this to Flask on port 5001
// In production, set this to the actual Flask backend URL
const DROPBOX_API_URL = '/api/dropbox/upload'

function App() {
  const [user, setUser] = useState(null)
  const [snippets, setSnippets] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [message, setMessage] = useState('Sign in with Google to start managing your snippets.')
  const [loading, setLoading] = useState(false)
  const [dropboxUploading, setDropboxUploading] = useState(false)

  // Listen for auth state changes
  useEffect(() => {
    if (!auth) {
      setMessage(firebaseConfigError || 'Google auth is unavailable.')
      return undefined
    }

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null)
        setSnippets([])
        return
      }

      setUser({
        uid: firebaseUser.uid,
        name: firebaseUser.displayName || firebaseUser.email,
        email: firebaseUser.email,
        picture: firebaseUser.photoURL,
      })

      setMessage(`Welcome back, ${firebaseUser.displayName || firebaseUser.email}!`)
    })

    return unsubscribe
  }, [])

  // Listen for snippets in real-time when user is signed in
  useEffect(() => {
    if (!user || !db) {
      return undefined
    }

    const snippetsRef = collection(db, 'users', user.uid, 'snippets')
    const snippetsQuery = query(snippetsRef, orderBy('createdAt', 'desc'))

    const unsubscribe = onSnapshot(
      snippetsQuery,
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          title: docSnap.data().title || '',
          description: docSnap.data().description || '',
          code: docSnap.data().code || '',
          language: docSnap.data().language || 'text',
          createdAt: docSnap.data().createdAt || '',
        }))
        setSnippets(data)
      },
      (error) => {
        console.error('Firestore snapshot error:', error)
        setMessage('Unable to load your snippets: ' + error.message)
      },
    )

    return unsubscribe
  }, [user])

  const filteredSnippets = useMemo(() => {
    const term = searchTerm.toLowerCase()
    return snippets.filter((snippet) => {
      return (
        snippet.title.toLowerCase().includes(term) ||
        snippet.description.toLowerCase().includes(term) ||
        snippet.code.toLowerCase().includes(term)
      )
    })
  }, [searchTerm, snippets])

  async function handleGoogleSignIn() {
    if (!auth || !provider) {
      setMessage(firebaseConfigError || 'Firebase is not configured. Check your .env file.')
      return
    }

    setLoading(true)
    setMessage('Signing in with Google...')

    try {
      const result = await signInWithPopup(auth, provider)
      setMessage(`Welcome, ${result.user.displayName || result.user.email}!`)
    } catch (error) {
      setMessage(error.message || 'Unable to sign in right now.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSignOut() {
    setLoading(true)
    try {
      await firebaseSignOut(auth)
      setUser(null)
      setSnippets([])
      setForm(emptyForm)
      setEditingId(null)
      setMessage('Signed out. You can sign in again anytime.')
    } catch (error) {
      setMessage(error.message || 'Unable to sign out.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (!form.title.trim() || !form.code.trim()) {
      setMessage('Add both a title and code before saving your snippet.')
      return
    }

    if (!user || !db) {
      setMessage('Please sign in first.')
      return
    }

    setLoading(true)
    try {
      const snippetsRef = collection(db, 'users', user.uid, 'snippets')

      if (editingId) {
        // Update existing snippet
        const snippetDoc = doc(db, 'users', user.uid, 'snippets', editingId)
        await updateDoc(snippetDoc, {
          title: form.title.trim(),
          description: form.description.trim(),
          code: form.code.trim(),
          language: form.language,
        })
        setMessage('Snippet updated successfully.')
      } else {
        // Create new snippet
        await addDoc(snippetsRef, {
          title: form.title.trim(),
          description: form.description.trim(),
          code: form.code.trim(),
          language: form.language,
          createdAt: new Date().toISOString(),
        })
        setMessage('Snippet created successfully.')
      }

      setForm(emptyForm)
      setEditingId(null)
    } catch (error) {
      setMessage(error.message || 'Something went wrong while saving your snippet.')
    } finally {
      setLoading(false)
    }
  }

  function handleEdit(snippet) {
    setEditingId(snippet.id)
    setForm({
      title: snippet.title,
      description: snippet.description,
      code: snippet.code,
      language: snippet.language || 'text',
    })
    setMessage('Editing snippet. Update the details and save when ready.')
  }

  async function handleDelete(snippetId) {
    if (!user || !db) return

    setLoading(true)
    try {
      const snippetDoc = doc(db, 'users', user.uid, 'snippets', snippetId)
      await deleteDoc(snippetDoc)

      if (editingId === snippetId) {
        setEditingId(null)
        setForm(emptyForm)
      }
      setMessage('Snippet deleted successfully.')
    } catch (error) {
      setMessage(error.message || 'Unable to delete snippet.')
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm)
    setMessage('Form cleared.')
  }

  // ----- Dropbox Upload (Experiment 4) -----

  async function uploadToDropbox(title, code, language) {
    if (!title || !code) {
      setMessage('Add both a title and code before uploading to Dropbox.')
      return
    }

    setDropboxUploading(true)
    setMessage('Uploading to Dropbox...')

    try {
      const response = await fetch(DROPBOX_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          code: code.trim(),
          language: language || 'text',
        }),
      }).catch(() => null)

      if (!response) {
        throw new Error('Unable to reach the Dropbox backend. Make sure the Flask server is running on port 5001.')
      }

      const result = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(result.error || `Dropbox upload failed (status ${response.status})`)
      }

      setMessage(`File uploaded to Dropbox successfully! Stored at: ${result.dropbox_path}`)
    } catch (error) {
      setMessage(error.message || 'Dropbox upload failed.')
    } finally {
      setDropboxUploading(false)
    }
  }

  function handleDropboxUploadFromForm() {
    uploadToDropbox(form.title, form.code, form.language)
  }

  function handleDropboxUploadFromCard(snippet) {
    uploadToDropbox(snippet.title, snippet.code, snippet.language || 'text')
  }

  return (
    <div className="app-shell">
      {!user ? (
        <section className="auth-card">
          <div className="accent-pill">Google sign-in</div>
          <h1>Code Snippet Server</h1>
          <p>
            Securely store and organize your code snippets with real authentication and a backend-powered dashboard.
          </p>
          <button type="button" className="google-btn" onClick={handleGoogleSignIn}>
            <span className="google-icon">G</span>
            Continue with Google
          </button>
          {loading ? <p className="loading-text">Signing you in…</p> : null}
          <small>Your snippets are persisted by the server and linked to your Google account.</small>
        </section>
      ) : (
        <div className="dashboard">
          <header className="topbar">
            <div>
              <p className="eyebrow">Signed in with Google</p>
              <h2>Welcome back, {user.name}</h2>
            </div>
            <div className="user-chip">
              <img src={user.picture || 'https://www.gstatic.com/images/branding/product/2x/google_g_64dp.png'} alt={user.name} />
              <div>
                <strong>{user.name}</strong>
                <span>{user.email}</span>
              </div>
            </div>
          </header>

          <div className="status-banner">{message}</div>

          <main className="content-grid">
            <section className="panel form-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Snippet editor</p>
                  <h3>{editingId ? 'Edit snippet' : 'Create snippet'}</h3>
                </div>
                <button type="button" className="ghost-btn" onClick={resetForm}>
                  Clear
                </button>
              </div>

              <form onSubmit={handleSubmit} className="snippet-form">
                <label>
                  Title
                  <input
                    type="text"
                    value={form.title}
                    onChange={(event) => setForm({ ...form, title: event.target.value })}
                    placeholder="Example: React hook"
                  />
                </label>

                <label>
                  Description
                  <textarea
                    value={form.description}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                    placeholder="Summarize what this snippet does"
                    rows="3"
                  />
                </label>

                <label>
                  Language
                  <select
                    value={form.language}
                    onChange={(event) => setForm({ ...form, language: event.target.value })}
                  >
                    {LANGUAGES.map((lang) => (
                      <option key={lang.value} value={lang.value}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Code
                  <textarea
                    value={form.code}
                    onChange={(event) => setForm({ ...form, code: event.target.value })}
                    placeholder="Paste your code here"
                    rows="8"
                    className="code-area"
                  />
                </label>

                <div className="form-actions">
                  <button type="submit" className="primary-btn">
                    {editingId ? 'Update snippet' : 'Save snippet'}
                  </button>
                  <button
                    type="button"
                    className="dropbox-btn"
                    onClick={handleDropboxUploadFromForm}
                    disabled={dropboxUploading}
                  >
                    <span className="dropbox-icon">📦</span>
                    {dropboxUploading ? 'Uploading…' : 'Save to Dropbox'}
                  </button>
                  <button type="button" className="secondary-btn" onClick={handleSignOut}>
                    Sign out
                  </button>
                </div>
              </form>
            </section>

            <section className="panel list-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Your collection</p>
                  <h3>{snippets.length} snippets</h3>
                </div>
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search snippets"
                />
              </div>

              {filteredSnippets.length === 0 ? (
                <div className="empty-state">
                  <p>No snippets match your search yet.</p>
                </div>
              ) : (
                <div className="snippet-list">
                  {filteredSnippets.map((snippet) => (
                    <article key={snippet.id} className="snippet-card">
                      <div className="snippet-card-top">
                        <div>
                          <h4>{snippet.title}</h4>
                          <p>{snippet.description}</p>
                        </div>
                        <span>{snippet.createdAt}</span>
                      </div>
                      <pre>{snippet.code}</pre>
                      <div className="card-actions">
                        <button type="button" className="ghost-btn" onClick={() => handleEdit(snippet)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="dropbox-btn-sm"
                          onClick={() => handleDropboxUploadFromCard(snippet)}
                          disabled={dropboxUploading}
                        >
                          📦 Dropbox
                        </button>
                        <button type="button" className="danger-btn" onClick={() => handleDelete(snippet.id)}>
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </main>
        </div>
      )}
    </div>
  )
}

export default App
