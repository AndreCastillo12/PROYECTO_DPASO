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
let cartToastTimer = null;
let checkoutStepOpen = false;
let storeSettings = null;

const DEFAULT_STORE_SETTINGS = {
  is_open: true,
  open_time: null,
  close_time: null,
  closed_message: 'Estamos cerrados. Vuelve en nuestro horario de atención.',
  timezone: 'America/Lima',
  delivery_fee: 0,
  min_order_delivery: 0
};

function normalizeModalidad(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase();
  if (value === 'delivery') return 'Delivery';
  if (value === 'recojo') return 'Recojo';
  return 'Delivery';
}

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

function clearFeedback() {
  const feedback = document.getElementById('checkout-feedback');
  if (!feedback) return;
  feedback.textContent = '';
  feedback.className = 'checkout-feedback';
}

function showCartToast(message) {
  const toast = document.getElementById('cart-toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add('show');

  if (cartToastTimer) clearTimeout(cartToastTimer);

  cartToastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 1800);
}


function getEffectiveStoreSettings() {
  return { ...DEFAULT_STORE_SETTINGS, ...(storeSettings || {}) };
}

async function getStoreSettings() {
  try {
    const { data, error } = await supabaseClient
      .from('store_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    storeSettings = data
      ? {
          ...DEFAULT_STORE_SETTINGS,
          ...data,
          delivery_fee: Number(data.delivery_fee || 0),
          min_order_delivery: Number(data.min_order_delivery || 0)
        }
      : { ...DEFAULT_STORE_SETTINGS };
  } catch (error) {
    console.warn('⚠️ No se pudo cargar store_settings, usando fallback abierto:', {
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code
    });
    storeSettings = { ...DEFAULT_STORE_SETTINGS };
  }

  renderStoreStatusBanner();
  updateCartTotalsAndAvailability();
}

function getTimeInTimezone(timezone = 'America/Lima') {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(new Date());
  const hour = parts.find(p => p.type === 'hour')?.value || '00';
  const minute = parts.find(p => p.type === 'minute')?.value || '00';
  return `${hour}:${minute}`;
}

function toMinutes(hhmm) {
  if (!hhmm || !/^\d{2}:\d{2}/.test(hhmm)) return null;
  const [hh, mm] = hhmm.slice(0, 5).split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function getStoreOpenInfo() {
  const settings = getEffectiveStoreSettings();

  if (!settings.is_open) {
    return { isOpen: false, reason: settings.closed_message || DEFAULT_STORE_SETTINGS.closed_message };
  }

  const openMin = toMinutes(settings.open_time);
  const closeMin = toMinutes(settings.close_time);

  if (openMin === null || closeMin === null) {
    return { isOpen: true, reason: '' };
  }

  const currentMin = toMinutes(getTimeInTimezone(settings.timezone || 'America/Lima'));
  if (currentMin === null) return { isOpen: true, reason: '' };

  let inRange = false;
  if (openMin <= closeMin) {
    inRange = currentMin >= openMin && currentMin <= closeMin;
  } else {
    inRange = currentMin >= openMin || currentMin <= closeMin;
  }

  return {
    isOpen: inRange,
    reason: inRange ? '' : (settings.closed_message || DEFAULT_STORE_SETTINGS.closed_message)
  };
}

function getCheckoutTotals(modalidad) {
  const normalizedModalidad = normalizeModalidad(modalidad || 'Delivery');
  const settings = getEffectiveStoreSettings();
  const subtotal = Number(getCartTotal());
  const deliveryFee = normalizedModalidad === 'Delivery' ? Number(settings.delivery_fee || 0) : 0;
  const minDelivery = Number(settings.min_order_delivery || 0);
  const totalFinal = subtotal + deliveryFee;

  return { subtotal, deliveryFee, minDelivery, totalFinal, modalidad: normalizedModalidad };
}

function renderStoreStatusBanner() {
  const banner = document.getElementById('store-status-banner');
  if (!banner) return;

  const storeInfo = getStoreOpenInfo();
  if (storeInfo.isOpen) {
    banner.style.display = 'none';
    banner.textContent = '';
    return;
  }

  banner.style.display = 'block';
  banner.textContent = `⏰ ${storeInfo.reason}`;
}

function updateCartTotalsAndAvailability() {
  const subtotalNode = document.getElementById('cart-subtotal');
  const deliveryRow = document.getElementById('cart-delivery-row');
  const deliveryFeeNode = document.getElementById('cart-delivery-fee');
  const totalNode = document.getElementById('cart-total');
  const minNote = document.getElementById('delivery-min-note');
  const modalidad = document.getElementById('checkout-modalidad');
  const confirmBtn = document.getElementById('confirm-order-btn');

  if (!subtotalNode || !deliveryRow || !deliveryFeeNode || !totalNode || !minNote) return;

  const totals = getCheckoutTotals(modalidad?.value || 'Delivery');
  const storeInfo = getStoreOpenInfo();

  subtotalNode.textContent = formatCurrency(totals.subtotal);
  totalNode.textContent = formatCurrency(totals.totalFinal);

  if (totals.modalidad === 'Delivery') {
    deliveryRow.style.display = 'flex';
    deliveryFeeNode.textContent = formatCurrency(totals.deliveryFee);
  } else {
    deliveryRow.style.display = 'none';
    deliveryFeeNode.textContent = formatCurrency(0);
  }

  let blockedMessage = '';

  if (!storeInfo.isOpen) {
    blockedMessage = storeInfo.reason || 'Fuera de horario';
  } else if (totals.modalidad === 'Delivery' && totals.subtotal < totals.minDelivery) {
    blockedMessage = `Mínimo para delivery: ${formatCurrency(totals.minDelivery)}`;
  }

  if (totals.modalidad === 'Delivery' && totals.minDelivery > 0) {
    minNote.style.display = 'block';
    minNote.textContent = totals.subtotal < totals.minDelivery
      ? `❗ Mínimo para delivery: ${formatCurrency(totals.minDelivery)}`
      : `Mínimo para delivery: ${formatCurrency(totals.minDelivery)}`;
  } else {
    minNote.style.display = 'none';
    minNote.textContent = '';
  }

  if (confirmBtn) {
    confirmBtn.disabled = Boolean(blockedMessage);
    confirmBtn.textContent = blockedMessage
      ? (blockedMessage.toLowerCase().includes('mínimo') ? 'Mínimo delivery' : 'Fuera de horario')
      : 'Confirmar pedido';
  }

  renderStoreStatusBanner();

  if (blockedMessage && checkoutStepOpen) {
    showFeedback(blockedMessage, 'error');
  }
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
    `🧮 Subtotal: ${formatCurrency(orderData.subtotal ?? orderData.total)}`,
    `🛵 Delivery: ${formatCurrency(orderData.delivery_fee ?? 0)}`,
    `💰 Total final: ${formatCurrency(orderData.total)}`,
    `👤 Nombre: ${orderData.nombre_cliente}`,
    `📞 Teléfono: ${orderData.telefono}`,
    `🚚 Modalidad: ${orderData.modalidad}`,
    `📍 Dirección: ${orderData.direccion || 'No aplica'}`,
    `🧭 Referencia: ${orderData.referencia || '-'}`,
    `📝 Comentario: ${orderData.comentario || '-'}`
  ];

  return `https://wa.me/${WA_PHONE}?text=${encodeURIComponent(lines.join('\n'))}`;
}


function openReceiptModal() {
  const modal = document.getElementById('receipt-modal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeReceiptModal() {
  const modal = document.getElementById('receipt-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function renderReceipt(orderData) {
  const receiptBox = document.getElementById('order-receipt');
  const receiptContent = document.getElementById('order-receipt-content');
  const receiptWhatsAppBtn = document.getElementById('receipt-whatsapp-btn');
  if (!receiptBox || !receiptContent || !orderData) return;

  const shortId = getShortOrderId(orderData.id);
  const lines = orderData.items.map((it) => `${it.nombre} · Cantidad: ${it.cantidad} · Precio: ${formatCurrency(it.precio)}`);

  receiptContent.innerHTML = `
    <p><strong>Pedido:</strong> #${shortId}</p>
    <p><strong>Cliente:</strong> ${orderData.nombre_cliente}</p>
    <p><strong>Teléfono:</strong> ${orderData.telefono}</p>
    <p><strong>Modalidad:</strong> ${orderData.modalidad}</p>
    <p><strong>Subtotal:</strong> ${formatCurrency(orderData.subtotal ?? orderData.total)}</p>
    <p><strong>Delivery:</strong> ${formatCurrency(orderData.delivery_fee ?? 0)}</p>
    <p><strong>Total final:</strong> ${formatCurrency(orderData.total)}</p>
    <p><strong>Items:</strong></p>
    ${lines.map((line) => `<p>• ${line}</p>`).join('')}
  `;

  if (receiptWhatsAppBtn) {
    receiptWhatsAppBtn.href = buildWhatsAppMessage(orderData);
    receiptWhatsAppBtn.style.display = 'inline-flex';
  }

  receiptBox.style.display = 'block';
}

function hideReceipt() {
  const receiptBox = document.getElementById('order-receipt');
  const receiptContent = document.getElementById('order-receipt-content');
  const receiptWhatsAppBtn = document.getElementById('receipt-whatsapp-btn');

  if (receiptBox) receiptBox.style.display = 'none';
  if (receiptContent) receiptContent.innerHTML = '';
  if (receiptWhatsAppBtn) {
    receiptWhatsAppBtn.style.display = 'none';
    receiptWhatsAppBtn.href = '#';
  }
}

function buildReceiptText(orderData) {
  const shortId = getShortOrderId(orderData.id);
  const itemsText = orderData.items
    .map((it) => `- ${it.nombre} | Cantidad: ${it.cantidad} | Precio: ${formatCurrency(it.precio)}`)
    .join('\n');

  return [
    'DPASO - Comprobante de pedido',
    `Pedido: #${shortId}`,
    `Cliente: ${orderData.nombre_cliente}`,
    `Teléfono: ${orderData.telefono}`,
    `Modalidad: ${orderData.modalidad}`,
    `Subtotal: ${formatCurrency(orderData.subtotal ?? orderData.total)}`,
    `Delivery: ${formatCurrency(orderData.delivery_fee ?? 0)}`,
    `Total final: ${formatCurrency(orderData.total)}`,
    'Items:',
    itemsText
  ].join('\n');
}

function downloadReceiptPdf(orderData) {
  if (!orderData) return;

  const shortId = getShortOrderId(orderData.id);
  const receiptHtml = `
    <html>
      <head>
        <title>Comprobante ${shortId}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; color: #1a1a1a; }
          h2 { margin-bottom: 6px; color: #0b2d4d; }
          p { margin: 4px 0; }
          .box { border: 1px dashed #88a9c7; border-radius: 10px; padding: 12px; }
        </style>
      </head>
      <body>
        <h2>DPASO - Comprobante de pedido</h2>
        <div class="box">
          ${buildReceiptText(orderData).split('\n').map((line) => `<p>${line}</p>`).join('')}
        </div>
      </body>
    </html>
  `;

  const printWindow = window.open('', '_blank', 'width=720,height=840');
  if (!printWindow) return;

  printWindow.document.open();
  printWindow.document.write(receiptHtml);
  printWindow.document.close();

  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 300);
}

// ===============================
// UI CARRITO
// ===============================

function toggleCheckoutSection(forceOpen = false) {
  const goCheckoutBtn = document.getElementById('go-checkout-btn');
  const checkoutSection = document.getElementById('checkout-section');

  if (!goCheckoutBtn || !checkoutSection) return;

  if (!cart.length) {
    checkoutStepOpen = false;
    goCheckoutBtn.style.display = 'none';
    checkoutSection.style.display = 'none';
    return;
  }

  if (forceOpen) checkoutStepOpen = true;

  goCheckoutBtn.style.display = checkoutStepOpen ? 'none' : 'block';
  checkoutSection.style.display = checkoutStepOpen ? 'block' : 'none';
}

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

  const whatsappBtn = document.getElementById('whatsapp-order-btn');
  if (whatsappBtn) {
    whatsappBtn.style.display = 'none';
    whatsappBtn.href = '#';
  }

  checkoutStepOpen = false;
  toggleCheckoutSection(false);
  clearFeedback();
  updateDireccionRequired();
}

function openCartModal() {
  const modal = document.getElementById('cart-modal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  getStoreSettings();
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

    if (checkoutStepOpen) {
      const previewInfo = document.createElement('p');
      previewInfo.className = 'cart-preview-info';
      previewInfo.textContent = 'Vista previa del pedido. Para editar platos, vuelve al carrito.';
      itemsContainer.appendChild(previewInfo);
    }

    cart.forEach(item => {
      const row = document.createElement('div');
      row.className = 'cart-item';

      if (checkoutStepOpen) {
        row.innerHTML = `
          <img src="${item.imagen}" alt="${item.nombre}">
          <div class="cart-item-data">
            <h4>${item.nombre}</h4>
            <p>Cantidad: ${item.cantidad}</p>
            <p>Precio: ${formatCurrency(item.precio)}</p>
          </div>
        `;
      } else {
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
      }

      itemsContainer.appendChild(row);
    });
  }

  toggleCheckoutSection(false);
  updateCartTotalsAndAvailability();
}


function updateDireccionRequired() {
  const modalidad = document.getElementById('checkout-modalidad');
  const direccion = document.getElementById('checkout-direccion');
  const marker = document.getElementById('direccion-required');
  const direccionGroup = document.getElementById('direccion-group');
  const pickupLocation = document.getElementById('pickup-location');
  const referenciaGroup = document.getElementById('referencia-group');

  if (!modalidad || !direccion || !marker || !direccionGroup || !pickupLocation || !referenciaGroup) return;

  const selected = normalizeModalidad(modalidad.value);
  const isDelivery = selected === 'Delivery';

  direccion.required = isDelivery;
  marker.style.visibility = isDelivery ? 'visible' : 'hidden';
  direccionGroup.classList.toggle('hidden', !isDelivery);
  pickupLocation.style.display = isDelivery ? 'none' : 'block';
  referenciaGroup.style.display = isDelivery ? 'grid' : 'none';

  if (!isDelivery) {
    direccion.value = '';
    const referenciaInput = document.getElementById('checkout-referencia');
    if (referenciaInput) referenciaInput.value = '';
  }

  updateCartTotalsAndAvailability();
}


function setupCartModalEvents() {
  const cartButton = document.getElementById('cart-float-btn');
  const closeButton = document.getElementById('cart-close-btn');
  const modal = document.getElementById('cart-modal');
  const itemsContainer = document.getElementById('cart-items');
  const modalidad = document.getElementById('checkout-modalidad');
  const goCheckoutBtn = document.getElementById('go-checkout-btn');
  const backToCartBtn = document.getElementById('back-to-cart-btn');
  const receiptModal = document.getElementById('receipt-modal');
  const receiptCloseBtn = document.getElementById('receipt-close-btn');

  cartButton?.addEventListener('click', openCartModal);
  closeButton?.addEventListener('click', closeCartModal);

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeCartModal();
  });

  receiptModal?.addEventListener('click', (e) => {
    if (e.target === receiptModal) closeReceiptModal();
  });

  receiptCloseBtn?.addEventListener('click', closeReceiptModal);

  itemsContainer?.addEventListener('click', (e) => {
    if (checkoutStepOpen) return;

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

  goCheckoutBtn?.addEventListener('click', () => {
    checkoutStepOpen = true;
    toggleCheckoutSection(true);
    renderCartModal();
    const whatsappBtn = document.getElementById('whatsapp-order-btn');
    if (whatsappBtn) {
      whatsappBtn.style.display = 'none';
      whatsappBtn.href = '#';
    }
    clearFeedback();
    updateDireccionRequired();
  });

  backToCartBtn?.addEventListener('click', () => {
    checkoutStepOpen = false;
    toggleCheckoutSection(false);
    clearFeedback();
    renderCartModal();
  });

  document.getElementById('download-receipt-btn')?.addEventListener('click', () => downloadReceiptPdf(lastOrderData));
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

  clearFeedback();
  hideReceipt();
  closeReceiptModal();

  if (!cart.length) {
    showFeedback('El carrito está vacío. Agrega al menos un plato.', 'error');
    return;
  }

  const formData = new FormData(form);
  const normalizedModalidad = normalizeModalidad(formData.get('modalidad'));
  const totals = getCheckoutTotals(normalizedModalidad);

  const payload = {
    id: crypto.randomUUID(),
    nombre_cliente: String(formData.get('nombre') || '').trim(),
    telefono: String(formData.get('telefono') || '').trim(),
    modalidad: normalizedModalidad,
    direccion: String(formData.get('direccion') || '').trim(),
    referencia: String(formData.get('referencia') || '').trim(),
    comentario: String(formData.get('comentario') || '').trim(),
    total: totals.totalFinal,
    estado: 'pendiente'
  };

  if (!payload.nombre_cliente || !payload.telefono) {
    showFeedback('Nombre y teléfono son obligatorios.', 'error');
    return;
  }

  const telefonoLimpio = payload.telefono.replace(/\D/g, '');
  if (!/^\d{9}$/.test(telefonoLimpio)) {
    showFeedback('El teléfono debe tener exactamente 9 dígitos numéricos.', 'error');
    return;
  }
  payload.telefono = Number(telefonoLimpio);

  if (payload.modalidad === 'Delivery' && !payload.direccion) {
    showFeedback('La dirección es obligatoria para pedidos Delivery.', 'error');
    return;
  }

  const storeInfo = getStoreOpenInfo();
  if (!storeInfo.isOpen) {
    showFeedback(storeInfo.reason || 'Fuera de horario', 'error');
    return;
  }

  if (payload.modalidad === 'Delivery' && totals.subtotal < totals.minDelivery) {
    showFeedback(`Mínimo para delivery: ${formatCurrency(totals.minDelivery)}`, 'error');
    return;
  }

  if (!Number.isFinite(payload.total)) {
    showFeedback('No se pudo calcular el total. Revisa tu carrito.', 'error');
    console.error('❌ Total inválido para orders payload:', payload);
    return;
  }

  let orderId = null;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creando pedido...';

    console.log('📦 Payload orders:', payload);

    const { error: orderError } = await supabaseClient
      .from('orders')
      .insert(payload);

    if (orderError) throw orderError;

    orderId = payload.id;

    if (!orderId) {
      throw new Error('No se pudo obtener el ID del pedido.');
    }

    const orderItems = cart.map(item => ({
      order_id: orderId,
      plato_id: item.id,
      nombre_snapshot: item.nombre,
      precio_snapshot: Number(item.precio),
      cantidad: Number(item.cantidad),
      subtotal: Number(item.precio) * Number(item.cantidad)
    }));

    const hasInvalidItem = orderItems.some((item) => {
      return !Number.isFinite(item.precio_snapshot)
        || !Number.isFinite(item.cantidad)
        || !Number.isFinite(item.subtotal);
    });

    if (hasInvalidItem) {
      console.error('❌ order_items inválidos:', orderItems);
      throw new Error('Items con valores numéricos inválidos.');
    }

    console.log('🧾 Payload order_items:', orderItems);

    const { error: itemsError } = await supabaseClient
      .from('order_items')
      .insert(orderItems);

    if (itemsError) {
      const rollbackResponse = await supabaseClient
        .from('orders')
        .delete()
        .eq('id', orderId);

      if (rollbackResponse.error) {
        console.error('⚠️ Falló rollback lógico (delete order):', {
          orderId,
          message: rollbackResponse.error.message,
          details: rollbackResponse.error.details,
          hint: rollbackResponse.error.hint,
          code: rollbackResponse.error.code
        });
      }

      throw itemsError;
    }

    lastOrderData = {
      id: orderId,
      ...payload,
      subtotal: totals.subtotal,
      delivery_fee: totals.deliveryFee,
      items: orderItems.map(i => ({
        nombre: i.nombre_snapshot,
        precio: i.precio_snapshot,
        cantidad: i.cantidad,
        subtotal: i.subtotal
      }))
    };

    showFeedback(`✅ Pedido creado (#${getShortOrderId(orderId)}). Tu comprobante está listo.`, 'success');
    renderReceipt(lastOrderData);
    closeCartModal();
    openReceiptModal();

    if (whatsappBtn && lastOrderData) {
      whatsappBtn.href = buildWhatsAppMessage(lastOrderData);
      whatsappBtn.style.display = 'inline-flex';
    }

    clearCartAndForm();
  } catch (error) {
    console.error('❌ Error creando pedido:', {
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
      orderId,
      ordersPayload: payload,
      cartSnapshot: cart
    });
    showFeedback('No se pudo crear el pedido. Revisa tu conexión o intenta de nuevo.', 'error');
  } finally {
    submitBtn.disabled = false;
    updateCartTotalsAndAvailability();
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
            showCartToast(`✅ ${item.nombre} agregado al carrito`);
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

  await getStoreSettings();
  await cargarMenu();

  const loader = document.getElementById('loader');
  if (loader) setTimeout(() => loader.classList.add('hide'), 1500);
});
