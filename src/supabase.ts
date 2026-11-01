import { createClient } from '@supabase/supabase-js'
import { localClient } from './local'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// No keys in .env -> offline test mode in this browser.
export const LOCAL = !url || !key
export const supabase = LOCAL
  ? (localClient as unknown as ReturnType<typeof createClient>)
  : createClient(url, key)
