import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth.js'
import { Btn } from '../ui/Btn.jsx'
import { PixIcon } from '../ui/PixIcon.jsx'
import { ICONS } from '../ui/icons.js'

// Gates the whole app behind Supabase Auth. `children` is a render prop that
// receives the auth object (user, signOut, ...) so App can show the account
// menu. When Supabase isn't configured the gate is transparent: the app runs
// in local mode exactly as before (no accounts, empty galleries).
export function AuthGate({ children }) {
  const auth = useAuth()

  if (!auth.configured) return children(auth)
  if (auth.loading) {
    return (
      <div className="auth-screen">
        <div className="auth-card"><p className="auth-note">Loading session…</p></div>
      </div>
    )
  }
  if (auth.recovery) return <RecoveryScreen auth={auth} />
  if (!auth.user) return <AuthScreen auth={auth} />
  return children(auth)
}

function AuthScreen({ auth }) {
  // 'signin' | 'signup' | 'reset'
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const switchMode = (next) => { setMode(next); setError(''); setNotice('') }

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (mode === 'signin') {
        await auth.signIn(email, password)
      } else if (mode === 'signup') {
        const { needsConfirmation } = await auth.signUp(email, password)
        if (needsConfirmation) setNotice('Account created. Check your email to confirm it, then sign in.')
      } else {
        await auth.resetPassword(email)
        setNotice('Password reset email sent. Follow the link, then set a new password here.')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const titles = { signin: 'Sign in', signup: 'Create account', reset: 'Reset password' }
  const ctas   = { signin: 'Sign in', signup: 'Create account', reset: 'Send reset email' }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <div className="brand-mark"><PixIcon grid={ICONS.grid} px={3} color="#06150f" /></div>
          <span className="brand-name">Tileset Studio</span>
        </div>
        <h1 className="auth-title">{titles[mode]}</h1>

        <label className="field-label" htmlFor="auth-email">Email</label>
        <input id="auth-email" className="text-input" type="email" required
          autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />

        {mode !== 'reset' && (
          <>
            <label className="field-label" htmlFor="auth-password">Password</label>
            <input id="auth-password" className="text-input" type="password" required minLength={6}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password} onChange={e => setPassword(e.target.value)} />
          </>
        )}

        {error && <p className="auth-error">{error}</p>}
        {notice && <p className="auth-notice">{notice}</p>}

        {/* Btn renders a <button> without an explicit type → submits the form. */}
        <Btn variant="primary" full disabled={busy} style={{ marginTop: 14 }}>
          {busy ? 'Working…' : ctas[mode]}
        </Btn>

        <div className="auth-links">
          {mode !== 'signin' && (
            <button type="button" className="auth-link" onClick={() => switchMode('signin')}>Sign in</button>
          )}
          {mode !== 'signup' && (
            <button type="button" className="auth-link" onClick={() => switchMode('signup')}>Create account</button>
          )}
          {mode !== 'reset' && (
            <button type="button" className="auth-link" onClick={() => switchMode('reset')}>Forgot password?</button>
          )}
        </div>
      </form>
    </div>
  )
}

// Shown after the user lands from a password-reset email (PASSWORD_RECOVERY).
function RecoveryScreen({ auth }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      await auth.updatePassword(password)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <div className="brand-mark"><PixIcon grid={ICONS.grid} px={3} color="#06150f" /></div>
          <span className="brand-name">Tileset Studio</span>
        </div>
        <h1 className="auth-title">Set a new password</h1>

        <label className="field-label" htmlFor="auth-new-password">New password</label>
        <input id="auth-new-password" className="text-input" type="password" required minLength={6}
          autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />

        {error && <p className="auth-error">{error}</p>}

        <Btn variant="primary" full disabled={busy} style={{ marginTop: 14 }}>
          {busy ? 'Working…' : 'Save password'}
        </Btn>
      </form>
    </div>
  )
}
