import { create } from 'zustand'
import { refreshCartAvailability } from '../services/orderService'

const STORAGE = 'dpaso_cart_react_v1'

const readStorage = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE) || '[]') } catch { return [] }
}

export const useCartStore = create((set, get) => ({
  items: [],
  availabilityById: {},
  availabilityFlight: null,
  init: () => set({ items: readStorage() }),
  persist: () => localStorage.setItem(STORAGE, JSON.stringify(get().items)),
  add: (dish) => {
    const items = [...get().items]
    const found = items.find((i) => i.id === dish.id)
    if (found) found.cantidad += 1
    else items.push({ id: dish.id, nombre: dish.nombre, precio: Number(dish.precio || 0), cantidad: 1, imagen: dish.imagen })
    set({ items })
    get().persist()
  },
  changeQty: (id, delta) => {
    const items = get().items.map((i) => i.id === id ? { ...i, cantidad: i.cantidad + delta } : i).filter((i) => i.cantidad > 0)
    set({ items })
    get().persist()
  },
  remove: (id) => {
    set({ items: get().items.filter((i) => i.id !== id) })
    get().persist()
  },
  clear: () => { set({ items: [] }); get().persist() },
  validateAvailability: async () => {
    if (get().availabilityFlight) return get().availabilityFlight
    const ids = [...new Set(get().items.map((i) => i.id).filter(Boolean))]
    if (!ids.length) return
    const flight = refreshCartAvailability(ids).then((rows) => {
      const map = {}
      rows.forEach((r) => { map[r.id] = r })
      set({ availabilityById: map })
      set({ items: get().items.map((item) => ({ ...item, precio: Number(map[item.id]?.precio ?? item.precio) })) })
      get().persist()
    }).finally(() => set({ availabilityFlight: null }))
    set({ availabilityFlight: flight })
    return flight
  }
}))
