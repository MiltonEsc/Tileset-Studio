import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth.js'
import { Btn } from '../ui/Btn.jsx'
import { Icon } from '../ui/Icon.jsx'
import { useI18n } from '../../i18n.jsx'

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
  const { t, language, setLanguage } = useI18n()
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

  const titles = { signin: t('signIn'), signup: t('createAccount'), reset: t('resetPassword') }
  const ctas   = { signin: t('signIn'), signup: t('createAccount'), reset: t('sendResetEmail') }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <div className="brand-mark"><Icon name="grid" size={19} /></div>
          <span className="brand-name">Tileset Studio</span>
          <select className="language-select" value={language} onChange={e => setLanguage(e.target.value)} aria-label={t('language')}>
            <option value="es">ES</option><option value="en">EN</option>
          </select>
        </div>
        <h1 className="auth-title">{titles[mode]}</h1>

        <label className="field-label" htmlFor="auth-email">Email</label>
        <input id="auth-email" className="text-input" type="email" required
          autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />

        {mode !== 'reset' && (
          <>
            <label className="field-label" htmlFor="auth-password">{t('password')}</label>
            <input id="auth-password" className="text-input" type="password" required minLength={6}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password} onChange={e => setPassword(e.target.value)} />
          </>
        )}

        {error && <p className="auth-error">{error}</p>}
        {notice && <p className="auth-notice">{notice}</p>}

        {/* Btn renders a <button> without an explicit type → submits the form. */}
        <Btn variant="primary" full disabled={busy} style={{ marginTop: 14 }}>
          {busy ? t('working') : ctas[mode]}
        </Btn>

        <div className="auth-links">
          {mode !== 'signin' && (
            <button type="button" className="auth-link" onClick={() => switchMode('signin')}>{t('signIn')}</button>
          )}
          {mode !== 'signup' && (
            <button type="button" className="auth-link" onClick={() => switchMode('signup')}>{t('createAccount')}</button>
          )}
          {mode !== 'reset' && (
            <button type="button" className="auth-link" onClick={() => switchMode('reset')}>{t('forgotPassword')}</button>
          )}
        </div>
      </form>
    </div>
  )
}

// Shown after the user lands from a password-reset email (PASSWORD_RECOVERY).
function RecoveryScreen({ auth }) {
  const { t } = useI18n()
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
          <div className="brand-mark"><Icon name="grid" size={19} /></div>
          <span className="brand-name">Tileset Studio</span>
        </div>
        <h1 className="auth-title">{t('setNewPassword')}</h1>

        <label className="field-label" htmlFor="auth-new-password">{t('newPassword')}</label>
        <input id="auth-new-password" className="text-input" type="password" required minLength={6}
          autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />

        {error && <p className="auth-error">{error}</p>}

        <Btn variant="primary" full disabled={busy} style={{ marginTop: 14 }}>
          {busy ? t('working') : t('savePassword')}
        </Btn>
      </form>
    </div>
  )
}
