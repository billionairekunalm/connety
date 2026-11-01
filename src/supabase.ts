import { createClient } from '@supabase/supabase-js'
import { localClient } from './local'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
const missing = !url || !key

// Test mode (data in this browser) is only for local development. A production build without
// keys shows a setup error instead of silently pretending to work.
export const LOCAL = missing && !import.meta.env.PROD
export const MISCONFIGURED = missing && import.meta.env.PROD
export const supabase = missing
  ? (localClient as unknown as ReturnType<typeof createClient>)
  : createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
