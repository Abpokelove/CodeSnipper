import { useEffect, useMemo, useState } from 'react'
import { auth, provider, firebaseConfigError } from './firebaseClient'
import {
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth'

const emptyForm = {
  title: '',
  description: '',
  code: '',
}

function App() {
  const [user, setUser] = useState(null)
  const [snippets, setSnippets] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [message, setMessage] = useState('Sign in with Google to start managing your snippets.')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!auth) {
      setMessage(firebaseConfigError || 'Google auth is unavailable.')
      return undefined
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
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

      try {
        const token = await firebaseUser.getIdToken()
        const data = await loadSnippets(token)
        setSnippets(data)
      } catch (error) {
        setMessage(error.message || 'Unable to load your snippets.')
      }
    })

    return unsubscribe
  }, [])

  async function loadSnippets(token) {
    const response = await fetch('/api/snippets', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error || 'Unable to load snippets')
    }

    const data = await response.json()
    return data.snippets || []
  }

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
      const token = await result.user.getIdToken()
      const data = await loadSnippets(token)
      setSnippets(data)
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

  async function getIdToken() {
    const currentUser = auth.currentUser
    if (!currentUser) {
      throw new Error('Please sign in first.')
    }

    return currentUser.getIdToken(true)
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (!form.title.trim() || !form.code.trim()) {
      setMessage('Add both a title and code before saving your snippet.')
      return
    }

    setLoading(true)
    try {
      const token = await getIdToken()
      const url = editingId ? `/api/snippets/${editingId}` : '/api/snippets'
      const method = editingId ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          code: form.code.trim(),
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Unable to save snippet')
      }

      setSnippets(data.snippets || [])
      setForm(emptyForm)
      setEditingId(null)
      setMessage(editingId ? 'Snippet updated successfully.' : 'Snippet created successfully.')
    } catch (error) {
      setMessage(error.message || 'Something went wrong while saving your snippet.')
    } finally {
      setLoading(false)
    }
  }

  async function handleEdit(snippet) {
    setEditingId(snippet.id)
    setForm({
      title: snippet.title,
      description: snippet.description,
      code: snippet.code,
    })
    setMessage('Editing snippet. Update the details and save when ready.')
  }

  async function handleDelete(snippetId) {
    setLoading(true)

    try {
      const token = await getIdToken()
      const response = await fetch(`/api/snippets/${snippetId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Unable to delete snippet')
      }

      setSnippets(data.snippets || [])
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
