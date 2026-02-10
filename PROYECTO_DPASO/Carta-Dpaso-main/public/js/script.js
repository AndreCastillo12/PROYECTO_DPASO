// ===============================
// SUPABASE CONFIG
// ===============================
const SUPABASE_URL = 'https://gtczpfxdkiajprnluokq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0Y3pwZnhka2lhanBybmx1b2txIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzOTc5MTAsImV4cCI6MjA4NTk3MzkxMH0.UrV46fOq-YFQWykvR-eqPmlr-33w1aC7ynmywu_nsQ8';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CART_STORAGE_KEY = 'dpaso_cart_v1';
const WA_PHONE = '51941552878';

let cart = [];
let lastOrderData = null;

// ===============================
// HELPERS
// ===============================
function formatCurrency(value) {
  return `S/ ${Number(value).toFixed(2)}`;
}

function getCartTotal() {
  return cart.reduce((acc, item) => acc + (Number(item.precio) * Number(item.cantidad)), 0);
}

function getCartCount() {
  return cart.reduce((acc, item) => acc + Number(item.cantidad), 0);
}

function getShortOrderId(id = '') {
  return id.slice(-6).toUpperCase();
}

function loadCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    cart = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(cart)) cart = [];
  } catch (_) {
    cart = [];
  }
}

function saveCart() {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
}

function showFeedback(message, type = 'info') {
  const feedback = document.getElementById('checkout-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `checkout-feedback ${type}`;
}

function buildWhatsAppMessage(orderData) {
  const itemsTxt = orderData.items
    .map(it => `- ${it.nombre} x${it.cantidad} (${formatCurrency(it.precio)} c/u) = ${formatCurrency(it.subtotal)}`)
    .join('\n');

  const shortId = getShortOrderId(orderData.id);
  const lines = [
    `Hola DPASO, acabo de crear el pedido #${shortId}`,
    '',
    '🧾 Detalle:',
    itemsTxt,
    '',
    `💰 Total: ${formatCurrency(orderData.total)}`,
    `👤 Nombre: ${orderData.nombre_cliente}`,
    `📞 Teléfono: ${orderData.telefono}`,
    `🚚 Modalidad: ${orderData.modalidad}`,
    `📍 Dirección: ${orderData.direccion || 'No aplica'}`,
    `🧭 Referencia: ${orderData.referencia || '-'}`,
    `📝 Comentario: ${orderData.comentario || '-'}`
  ];

  return `https://wa.me/${WA_PHONE}?text=${encodeURIComponent(lines.join('\n'))}`;
}

// ===============================
// UI CARRITO
// ===============================
function updateCartBadge() {
  const badge = document.getElementById('cart-badge');
  if (!badge) return;
  badge.textContent = getCartCount();
}

function addToCart(item) {
  const found = cart.find(x => x.id === item.id);

  if (found) {
    found.cantidad += 1;
  } else {
    cart.push({
      id: item.id,
      nombre: item.nombre,
      precio: Number(item.precio),
      cantidad: 1,
      imagen: item.imagen
    });
  }

  saveCart();
  updateCartBadge();
  renderCartModal();
}

function changeCartQty(itemId, delta) {
  const item = cart.find(x => x.id === itemId);
  if (!item) return;

  item.cantidad += delta;
  if (item.cantidad <= 0) {
    cart = cart.filter(x => x.id !== itemId);
  }

  saveCart();
  updateCartBadge();
  renderCartModal();
}

function removeCartItem(itemId) {
  cart = cart.filter(x => x.id !== itemId);
  saveCart();
  updateCartBadge();
  renderCartModal();
}

function clearCartAndForm() {
  cart = [];
  saveCart();
  updateCartBadge();
  renderCartModal();

  const form = document.getElementById('checkout-form');
  if (form) form.reset();

  updateDireccionRequired();
}

function openCartModal() {
  const modal = document.getElementById('cart-modal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeCartModal() {
  const modal = document.getElementById('cart-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function renderCartModal() {
  const itemsContainer = document.getElementById('cart-items');
  const emptyText = document.getElementById('cart-empty');
  const totalNode = document.getElementById('cart-total');

  if (!itemsContainer || !emptyText || !totalNode) return;

  itemsContainer.innerHTML = '';

  if (!cart.length) {
    emptyText.style.display = 'block';
  } else {
    emptyText.style.display = 'none';

    cart.forEach(item => {
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <img src="${item.imagen}" alt="${item.nombre}">
        <div class="cart-item-data">
          <h4>${item.nombre}</h4>
          <p>${formatCurrency(item.precio)}</p>
          <div class="cart-item-actions">
            <button type="button" data-action="minus" data-id="${item.id}">-</button>
            <span>${item.cantidad}</span>
            <button type="button" data-action="plus" data-id="${item.id}">+</button>
            <button type="button" data-action="delete" data-id="${item.id}" class="danger">Eliminar</button>
          </div>
        </div>
      `;
      itemsContainer.appendChild(row);
    });
  }

  totalNode.textContent = formatCurrency(getCartTotal());
}

function updateDireccionRequired() {
  const modalidad = document.getElementById('checkout-modalidad');
  const direccion = document.getElementById('checkout-direccion');
  const marker = document.getElementById('direccion-required');

  if (!modalidad || !direccion || !marker) return;

  const isDelivery = modalidad.value === 'Delivery';
  direccion.required = isDelivery;
  marker.style.visibility = isDelivery ? 'visible' : 'hidden';
}

function setupCartModalEvents() {
  const cartButton = document.getElementById('cart-float-btn');
  const closeButton = document.getElementById('cart-close-btn');
  const modal = document.getElementById('cart-modal');
  const itemsContainer = document.getElementById('cart-items');
  const modalidad = document.getElementById('checkout-modalidad');

  cartButton?.addEventListener('click', openCartModal);
  closeButton?.addEventListener('click', closeCartModal);

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeCartModal();
  });

  itemsContainer?.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.dataset.action;
    const id = target.dataset.id;
    if (!action || !id) return;

    if (action === 'minus') changeCartQty(id, -1);
    if (action === 'plus') changeCartQty(id, 1);
    if (action === 'delete') removeCartItem(id);
  });

  modalidad?.addEventListener('change', updateDireccionRequired);

  document.getElementById('checkout-form')?.addEventListener('submit', submitOrder);
}

// ===============================
// CHECKOUT + SUPABASE
// ===============================
async function submitOrder(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const submitBtn = document.getElementById('confirm-order-btn');
  const whatsappBtn = document.getElementById('whatsapp-order-btn');

  if (whatsappBtn) {
    whatsappBtn.style.display = 'none';
    whatsappBtn.href = '#';
  }

  if (!cart.length) {
    showFeedback('El carrito está vacío. Agrega al menos un plato.', 'error');
    return;
  }

  const formData = new FormData(form);
  const payload = {
    nombre_cliente: String(formData.get('nombre') || '').trim(),
    telefono: String(formData.get('telefono') || '').trim(),
    modalidad: String(formData.get('modalidad') || 'Delivery'),
    direccion: String(formData.get('direccion') || '').trim(),
    referencia: String(formData.get('referencia') || '').trim(),
    comentario: String(formData.get('comentario') || '').trim(),
    total: getCartTotal(),
    estado: 'pendiente'
  };

  if (!payload.nombre_cliente || !payload.telefono) {
    showFeedback('Nombre y teléfono son obligatorios.', 'error');
    return;
  }

  if (payload.modalidad === 'Delivery' && !payload.direccion) {
    showFeedback('La dirección es obligatoria para pedidos Delivery.', 'error');
    return;
  }

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creando pedido...';

    const { data: orderData, error: orderError } = await supabaseClient
      .from('orders')
      .insert(payload)
      .select('id')
      .single();

    if (orderError) throw orderError;

    const orderItems = cart.map(item => ({
      order_id: orderData.id,
      plato_id: item.id,
      nombre_snapshot: item.nombre,
      precio_snapshot: Number(item.precio),
      cantidad: Number(item.cantidad),
      subtotal: Number(item.precio) * Number(item.cantidad)
    }));

    const { error: itemsError } = await supabaseClient
      .from('order_items')
      .insert(orderItems);

    if (itemsError) throw itemsError;

    lastOrderData = {
      id: orderData.id,
      ...payload,
      items: orderItems.map(i => ({
        nombre: i.nombre_snapshot,
        precio: i.precio_snapshot,
        cantidad: i.cantidad,
        subtotal: i.subtotal
      }))
    };

    showFeedback(`✅ Pedido creado (#${getShortOrderId(orderData.id)})`, 'success');

    if (whatsappBtn && lastOrderData) {
      whatsappBtn.href = buildWhatsAppMessage(lastOrderData);
      whatsappBtn.style.display = 'inline-flex';
    }

    clearCartAndForm();
  } catch (error) {
    console.error('❌ Error creando pedido:', error);
    showFeedback('No se pudo crear el pedido. Intenta nuevamente.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirmar pedido';
  }
}

// ===============================
// CARGAR MENÚ Y NAVBAR
// ===============================
async function cargarMenu() {
  const menu = document.getElementById('menu');
  const nav = document.querySelector('.nav');
  if (!menu || !nav) return;

  try {
    const { data: platosData, error: platosError } = await supabaseClient
      .from('platos')
      .select('*')
      .order('orden', { ascending: true });

    if (platosError) throw platosError;

    const { data: categoriasData, error: categoriasError } = await supabaseClient
      .from('categorias')
      .select('*')
      .order('orden', { ascending: true });

    if (categoriasError) throw categoriasError;

    menu.innerHTML = '';
    nav.innerHTML = '';

    categoriasData.forEach(cat => {
      const items = platosData.filter(p => p.categoria_id === cat.id);

      const navLink = document.createElement('a');
      navLink.href = `#${cat.id}`;
      navLink.textContent = cat.nombre;
      nav.appendChild(navLink);

      const h2 = document.createElement('h2');
      h2.className = 'section-title fade-up';
      h2.id = cat.id;
      h2.textContent = cat.nombre;
      menu.appendChild(h2);

      if (items.length > 0) {
        items.forEach(item => {
          const div = document.createElement('div');
          div.className = 'plato fade-up';

          const imageUrl = item.imagen
            ? `${SUPABASE_URL}/storage/v1/object/public/platos/${item.imagen}`
            : 'images/Logos/logo.jpg';

          div.innerHTML = `
            <img src="${imageUrl}" alt="${item.nombre}">
            <h3>${item.nombre}</h3>
            <p>${item.descripcion || ''}</p>
            <span>${formatCurrency(item.precio)}</span>
            <button type="button" class="add-cart-btn">Agregar al carrito</button>
          `;

          div.querySelector('.add-cart-btn')?.addEventListener('click', () => {
            addToCart({
              id: item.id,
              nombre: item.nombre,
              precio: item.precio,
              imagen: imageUrl
            });
            showFeedback(`Agregaste "${item.nombre}" al carrito.`, 'info');
          });

          menu.appendChild(div);
        });
      } else {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'plato fade-up';
        emptyDiv.innerHTML = '<p>No hay platos en esta categoría.</p>';
        menu.appendChild(emptyDiv);
      }
    });

    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('show');
          observer.unobserve(e.target);
        }
      });
    }, { threshold: 0.15 });

    document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));
  } catch (err) {
    console.error('❌ Error cargando menú:', err);
    menu.innerHTML = '<p>Error cargando el menú. Revisa la consola.</p>';
  }
}

// ===============================
// REFRESH MANUAL PARA FRONT
// ===============================
window.refreshMenu = async function () {
  await cargarMenu();
};

// ===============================
// INIT
// ===============================
window.addEventListener('load', async () => {
  loadCart();
  setupCartModalEvents();
  updateDireccionRequired();
  updateCartBadge();
  renderCartModal();

  await cargarMenu();

  const loader = document.getElementById('loader');
  if (loader) setTimeout(() => loader.classList.add('hide'), 1500);
});
