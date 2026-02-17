import { create } from 'zustand'
import { getSession, loginWithEmail, registerWithEmail, loginWithGoogle, logout, onAuthChange } from '../services/authService'
import { getMyProfile, saveMyProfile } from '../services/profileService'

export const useAuthStore = create((set, get) => ({
  session: null,
  profile: null,
  loading: false,
  error: '',
  inFlight: {},
  singleFlight: async (key, fn) => {
    if (get().inFlight[key]) return get().inFlight[key]
    const p = fn().finally(() => set((s) => ({ inFlight: { ...s.inFlight, [key]: null } })))
    set((s) => ({ inFlight: { ...s.inFlight, [key]: p } }))
    return p
  },
  bootstrap: async () => get().singleFlight('bootstrap', async () => {
    const session = await getSession()
    set({ session })
    if (session?.user) {
      try { set({ profile: await getMyProfile() }) } catch { set({ profile: null }) }
    }
  }),
  subscribe: () => onAuthChange(async (session) => {
    set({ session })
    if (session?.user) {
      try { set({ profile: await getMyProfile() }) } catch { set({ profile: null }) }
    } else {
      set({ profile: null })
    }
  }),
  loginEmail: (email, password) => get().singleFlight('login_email', async () => {
    set({ loading: true, error: '' })
    try { await loginWithEmail(email, password) } catch (e) { set({ error: e.message || 'No se pudo iniciar sesión' }); throw e } finally { set({ loading: false }) }
  }),
  registerEmail: (email, password, meta) => get().singleFlight('register_email', async () => {
    set({ loading: true, error: '' })
    try { await registerWithEmail(email, password, meta) } catch (e) { set({ error: e.message || 'No se pudo registrar' }); throw e } finally { set({ loading: false }) }
  }),
  loginGoogle: () => get().singleFlight('login_google', async () => {
    set({ loading: true, error: '' })
    try { await loginWithGoogle() } catch (e) { set({ error: e.message || 'No se pudo iniciar con Google' }); throw e } finally { set({ loading: false }) }
  }),
  logout: () => get().singleFlight('logout', async () => {
    set({ loading: true, error: '' })
    try { await logout(); set({ session: null, profile: null }) } catch (e) { set({ error: e.message || 'No se pudo cerrar sesión' }); throw e } finally { set({ loading: false }) }
  }),
  saveProfile: ({ firstName, lastName, phone, dni }) => get().singleFlight('save_profile', async () => {
    const profile = await saveMyProfile({ firstName, lastName, phone, dni })
    set({ profile })
  })
}))
