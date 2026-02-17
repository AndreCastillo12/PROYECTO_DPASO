import { useEffect, useMemo, useState } from 'react'
import './styles.css'
import Topbar from './components/Topbar'
import CategorySection from './components/CategorySection'
import CartModal from './components/CartModal'
import CheckoutModal from './components/CheckoutModal'
import AccountModal from './components/AccountModal'
import OrdersModal from './components/OrdersModal'
import ProfileModal from './components/ProfileModal'
import { fetchMenu } from './services/menuService'
import { createOrder, listMyOrders } from './services/orderService'
import { uploadAvatar } from './services/profileService'
import { useCartStore } from './stores/useCartStore'
import { useAuthStore } from './stores/useAuthStore'
import { useUiStore } from './stores/useUiStore'

export default function App() {
  const [menu, setMenu] = useState({ platos: [], categorias: [] })
  const [search, setSearch] = useState('')
  const [orders, setOrders] = useState([])
  const [ordersError, setOrdersError] = useState('')

  const auth = useAuthStore()
  const cart = useCartStore()
  const ui = useUiStore()

  useEffect(() => {
    cart.init()
    auth.bootstrap()
    const { data: sub } = auth.subscribe()
    return () => sub?.subscription?.unsubscribe?.()
  }, [])

  useEffect(() => {
    fetchMenu(search).then(setMenu).catch((e) => ui.showToast(e.message || 'No se pudo cargar menú', 'error'))
  }, [search])

  const grouped = useMemo(() => {
    const byCat = {}
    menu.categorias.forEach((c) => { byCat[c.id] = [] })
    menu.platos.forEach((p) => { if (byCat[p.categoria_id]) byCat[p.categoria_id].push(p) })
    return byCat
  }, [menu])

  const handleCheckout = async (form) => {
    await cart.validateAvailability()
    const payload = {
      customer: {
        name: form.nombre,
        phone: String(form.telefono || '').replace(/\D/g, ''),
        modalidad: form.modalidad,
        address: form.direccion || null,
        referencia: form.referencia || null,
        provincia: null,
        distrito: null,
        email: auth.session?.user?.email || null
      },
      comment: form.comentario || null,
      items: cart.items.map((item) => ({ plato_id: item.id, nombre: item.nombre, precio: Number(item.precio), qty: Number(item.cantidad) })),
      totals: { subtotal: cart.items.reduce((a, i) => a + Number(i.precio) * Number(i.cantidad), 0), delivery_fee: 0, total: cart.items.reduce((a, i) => a + Number(i.precio) * Number(i.cantidad), 0) }
    }
    ui.setLoading('create_order', true)
    try {
      await createOrder(payload)
      cart.clear()
      ui.setModal('checkout', false)
      ui.setModal('cart', false)
      ui.showToast('✅ Pedido creado', 'success')
    } catch (e) {
      ui.showToast(e.message || 'No se pudo crear pedido', 'error')
    } finally {
      ui.setLoading('create_order', false)
    }
  }

  const refreshOrders = async () => {
    ui.setLoading('get_orders', true)
    setOrdersError('')
    try { setOrders(await listMyOrders()) } catch (e) { setOrdersError(e.message || 'No se pudo cargar pedidos') } finally { ui.setLoading('get_orders', false) }
  }

  return (
    <>
      <Topbar search={search} setSearch={setSearch} onOpenCart={() => { ui.setModal('cart', true); cart.validateAvailability() }} onOpenAccount={() => ui.setModal('account', true)} />
      <main className="menu-wrapper"><section className="menu" id="menu">{menu.categorias.map((cat) => <CategorySection key={cat.id} category={cat} items={grouped[cat.id] || []} onAdd={cart.add} />)}</section></main>

      <CartModal open={ui.modals.cart} items={cart.items} onClose={() => ui.setModal('cart', false)} onQty={cart.changeQty} onDelete={cart.remove} onCheckout={() => ui.setModal('checkout', true)} />
      <CheckoutModal open={ui.modals.checkout} onClose={() => ui.setModal('checkout', false)} onSubmit={handleCheckout} busy={!!ui.loadingOps.create_order} />
      <AccountModal
        open={ui.modals.account}
        onClose={() => ui.setModal('account', false)}
        onLogin={(email, pass) => auth.loginEmail(email, pass)}
        onRegister={(email, pass) => auth.registerEmail(email, pass, {})}
        onGoogle={() => auth.loginGoogle()}
        onOpenOrders={() => { ui.setModal('orders', true); refreshOrders() }}
        onOpenProfile={() => ui.setModal('profile', true)}
        loading={auth.loading}
        error={auth.error}
        session={auth.session}
        onLogout={() => auth.logout()}
      />
      <OrdersModal open={ui.modals.orders} onClose={() => ui.setModal('orders', false)} orders={orders} onRefresh={refreshOrders} loading={!!ui.loadingOps.get_orders} error={ordersError} />
      <ProfileModal
        open={ui.modals.profile}
        onClose={() => ui.setModal('profile', false)}
        profile={auth.profile}
        onSave={(data) => auth.saveProfile(data)}
        onUploadAvatar={async (file) => {
          const result = await uploadAvatar({ userId: auth.session?.user?.id, file, previousAvatarUrl: auth.profile?.avatar_url })
          if (!result.synced) ui.showToast('Foto subida, metadata pendiente. Reintentando...', 'info')
        }}
      />

      {ui.toast ? <div className={`cart-toast show ${ui.toast.type}`}>{ui.toast.message}</div> : null}
    </>
  )
}
