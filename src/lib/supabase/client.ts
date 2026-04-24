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

// Only this email is allowed to write in cloud mode. Keep in sync with RLS policies
// in supabase/schema.sql.
export const OWNER_EMAIL = 'amit.gangrade@gmail.com'
