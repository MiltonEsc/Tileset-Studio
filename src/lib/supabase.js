const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// True when env vars are present and look real (not the placeholder).
export const supabaseReady = Boolean(
  url && anonKey && !anonKey.startsWith('REPLACE_WITH')
)

// Lazily import the (heavy) supabase-js SDK and create the client on FIRST use,
// so it lands in its own chunk loaded only when persistence is actually touched
// — not in the initial bundle / app render path. Anon key is public by design;
// access is gated by RLS. Returns null synchronously when unconfigured, else a
// memoized Promise<client>, so callers do `const sb = await getSupabase()`.
let clientPromise = null
export function getSupabase() {
  if (!supabaseReady) return null
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) => createClient(url, anonKey))
  }
  return clientPromise
}
