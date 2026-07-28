import { useState, useEffect, useCallback } from 'react'
import { getSupabase, supabaseReady } from '../lib/supabase.js'

// Supabase Auth session state + the account actions the AuthGate/topbar need.
// When Supabase isn't configured (no env vars) `configured` is false and the
// app runs unauthenticated in local mode (galleries empty, like before).
export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(supabaseReady)
  // True after Supabase fires PASSWORD_RECOVERY (user landed from a reset
  // email); the AuthGate then shows the "set a new password" form.
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    if (!supabaseReady) return undefined
    let cancelled = false
    let subscription = null
    getSupabase().then(sb => {
      if (cancelled) return
      sb.auth.getSession().then(({ data }) => {
        if (cancelled) return
        setUser(data.session?.user ?? null)
        setLoading(false)
      })
      const { data } = sb.auth.onAuthStateChange((event, session) => {
        if (cancelled) return
        if (event === 'PASSWORD_RECOVERY') setRecovery(true)
        setUser(session?.user ?? null)
        setLoading(false)
      })
      subscription = data.subscription
    })
    return () => { cancelled = true; subscription?.unsubscribe() }
  }, [])

  const signIn = useCallback(async (email, password) => {
    const sb = await getSupabase()
    const { error } = await sb.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
  }, [])

  // Depending on the project's email-confirmation setting, signUp may return a
  // live session (auto-confirmed) or require the user to click a mail link.
  const signUp = useCallback(async (email, password) => {
    const sb = await getSupabase()
    const { data, error } = await sb.auth.signUp({ email, password })
    if (error) throw new Error(error.message)
    return { needsConfirmation: !data.session }
  }, [])

  const signOut = useCallback(async () => {
    const sb = await getSupabase()
    await sb.auth.signOut()
  }, [])

  const resetPassword = useCallback(async (email) => {
    const sb = await getSupabase()
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    if (error) throw new Error(error.message)
  }, [])

  const updatePassword = useCallback(async (password) => {
    const sb = await getSupabase()
    const { error } = await sb.auth.updateUser({ password })
    if (error) throw new Error(error.message)
    setRecovery(false)
  }, [])

  return {
    configured: supabaseReady,
    user, loading, recovery,
    signIn, signUp, signOut, resetPassword, updatePassword,
  }
}
