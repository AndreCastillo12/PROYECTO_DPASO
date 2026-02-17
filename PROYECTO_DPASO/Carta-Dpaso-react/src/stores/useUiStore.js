import { create } from 'zustand'

export const useUiStore = create((set) => ({
  modals: { cart: false, checkout: false, account: false, orders: false, profile: false },
  loadingOps: {},
  toast: null,
  setModal: (key, value) => set((s) => ({ modals: { ...s.modals, [key]: value } })),
  setLoading: (key, value) => set((s) => ({ loadingOps: { ...s.loadingOps, [key]: value } })),
  showToast: (message, type = 'info') => set({ toast: { message, type } }),
  clearToast: () => set({ toast: null })
}))
