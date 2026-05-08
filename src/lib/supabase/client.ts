import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null

export const supabaseEnabled = supabase !== null

// The original owner's email. The DB trigger automatically flips is_admin=true
// on this profile at insert time. Kept here only so the UI can hint "you'll be
// promoted to admin" before the row exists.
export const OWNER_EMAIL = 'amit.gangrade@gmail.com'
