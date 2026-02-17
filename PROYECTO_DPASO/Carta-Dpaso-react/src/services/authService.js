import { supabase } from '../lib/supabaseClient'

export const getSession = async () => {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data?.session || null
}

export const onAuthChange = (callback) => supabase.auth.onAuthStateChange((_event, session) => callback(session || null))

export async function loginWithEmail(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function registerWithEmail(email, password, metadata = {}) {
  const { error } = await supabase.auth.signUp({ email, password, options: { data: metadata } })
  if (error) throw error
}

export async function loginWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
  if (error) throw error
}

export async function logout() {
  const { error } = await supabase.auth.signOut({ scope: 'global' })
  if (error) throw error
}
