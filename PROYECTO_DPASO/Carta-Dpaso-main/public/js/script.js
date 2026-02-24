// ===============================
// SUPABASE CONFIG
// ===============================
const SUPABASE_URL = 'https://gtczpfxdkiajprnluokq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0Y3pwZnhka2lhanBybmx1b2txIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzOTc5MTAsImV4cCI6MjA4NTk3MzkxMH0.UrV46fOq-YFQWykvR-eqPmlr-33w1aC7ynmywu_nsQ8';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const guestSupabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
});

const CART_STORAGE_KEY = 'dpaso_cart_v1';
const CART_GUEST_STORAGE_KEY = `${CART_STORAGE_KEY}:guest`;
const TRACKING_LAST_CODE_STORAGE_KEY = 'dpaso_last_tracking_code';
const WA_PHONE = '51941552878';

let cart = [];
let lastOrderData = null;
let cartToastTimer = null;
let checkoutStepOpen = false;
let storeSettings = null;
let deliveryZones = [];
let deliveryZonesLoaded = false;
let orderSubmitBusy = false;
let platosState = new Map();
let lastOrderCode = '';
let trackingIntervalId = null;
let trackingLastCode = '';
let categoryObserver = null;
let activeNavLockUntil = 0;

const appRuntime = window.__dpaso_runtime || {
  inited: false,
  initCounter: 0,
  checkoutSubmitCounter: 0,
  authMode: 'login',
  authBusy: false,
  authSubscription: null,
  authUnsubscribe: null
};
window.__dpaso_runtime = appRuntime;
if (typeof window.__dpasoSubmitting !== 'boolean') window.__dpasoSubmitting = false;

if (!(appRuntime.listenerScopes instanceof Map)) appRuntime.listenerScopes = new Map();
if (!appRuntime.listenerStats || typeof appRuntime.listenerStats !== 'object') appRuntime.listenerStats = {};
if (!(appRuntime.boundActionKeys instanceof Set)) appRuntime.boundActionKeys = new Set();
if (!(appRuntime.scopeControllers instanceof Map)) appRuntime.scopeControllers = new Map();
if (!('lastAuthUserId' in appRuntime)) appRuntime.lastAuthUserId = null;
if (!('lastAuthEvent' in appRuntime)) appRuntime.lastAuthEvent = '';
if (typeof appRuntime.profileSaveBusy !== 'boolean') appRuntime.profileSaveBusy = false;
if (!('cartOwnerId' in appRuntime)) appRuntime.cartOwnerId = 'guest';
if (typeof appRuntime.loginFailureCount !== 'number') appRuntime.loginFailureCount = 0;
if (typeof appRuntime.loginCooldownUntil !== 'number') appRuntime.loginCooldownUntil = 0;
if (!('googleProfilePromptedFor' in appRuntime)) appRuntime.googleProfilePromptedFor = '';
if (!('lastCustomerSyncError' in appRuntime)) appRuntime.lastCustomerSyncError = '';
if (typeof appRuntime.checkoutDuplicateSubmitBlocked !== 'number') appRuntime.checkoutDuplicateSubmitBlocked = 0;
if (typeof appRuntime.orderCancelBusy !== 'boolean') appRuntime.orderCancelBusy = false;
if (!Array.isArray(appRuntime.lastCartPriceChanges)) appRuntime.lastCartPriceChanges = [];
if (typeof appRuntime.lastCartPriceChangeDigest !== 'string') appRuntime.lastCartPriceChangeDigest = '';
if (typeof appRuntime.autoReceiptEmailSentFor !== 'string') appRuntime.autoReceiptEmailSentFor = '';
if (typeof appRuntime.receiptSendBusy !== 'boolean') appRuntime.receiptSendBusy = false;
if (typeof appRuntime.recoveryBusy !== 'boolean') appRuntime.recoveryBusy = false;
if (!appRuntime.emailCooldownUntil || typeof appRuntime.emailCooldownUntil !== 'object') appRuntime.emailCooldownUntil = {};
if (!appRuntime.emailCooldownTimers || typeof appRuntime.emailCooldownTimers !== 'object') appRuntime.emailCooldownTimers = {};

function resetGlobalEventWiring() {
  appRuntime.scopeControllers.forEach((controller) => controller.abort());
  appRuntime.scopeControllers = new Map();
  appRuntime.listenerScopes = new Map();
  appRuntime.listenerStats = {};
  appRuntime.boundActionKeys = new Set();
}

function getOrCreateListenerScope(scopeName) {
  const previousController = appRuntime.scopeControllers.get(scopeName);
  if (previousController) previousController.abort();

  const controller = new AbortController();
  appRuntime.scopeControllers.set(scopeName, controller);

  const scope = {
    name: scopeName,
    actions: new Set(),
    controller
  };

  appRuntime.listenerScopes.set(scopeName, scope);
  return scope;
}

function bindScopedListener(scope, target, type, handler, options = {}, actionKey = null) {
  if (!scope || !target || !target.addEventListener) return;

  const key = actionKey || `${scope.name}:${type}`;
  if (scope.actions.has(key)) {
    debugWarn(`⚠️ Doble bind detectado en scope=${scope.name}, action=${key}`);
    debugWarn(new Error('Double bind guard stack').stack);
  }
  scope.actions.add(key);

  appRuntime.listenerStats[key] = Number(appRuntime.listenerStats[key] || 0) + 1;

  if (appRuntime.boundActionKeys.has(key)) {
    debugWarn(`⚠️ Acción ya estaba registrada previamente: ${key}`);
    debugWarn(new Error('Repeated action stack').stack);
  }
  appRuntime.boundActionKeys.add(key);

  const finalOptions = { ...options, signal: scope.controller.signal };
  target.addEventListener(type, handler, finalOptions);
}

function logListenerStats(scopeName = '') {
  const prefix = scopeName ? `${scopeName}:` : '';
  const stats = Object.keys(appRuntime.listenerStats)
    .filter((key) => !prefix || key.startsWith(prefix))
    .sort()
    .map((key) => ({ action: key, binds: appRuntime.listenerStats[key] }));

  debugLog(`🧩 Listener debug${scopeName ? ` [${scopeName}]` : ''}:`, stats);
}

function getFallbackFocusElement(...ids) {
  for (const id of ids) {
    const node = document.getElementById(id);
    if (node && typeof node.focus === 'function' && !node.hasAttribute('disabled')) return node;
  }
  return null;
}

function openModalSafe(modal, focusNode = null) {
  if (!modal) return;
  modal.removeAttribute('inert');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  if (focusNode && typeof focusNode.focus === 'function') focusNode.focus();
}

function closeModalSafe(modal, fallbackFocusNode = null) {
  if (!modal) return;

  const active = document.activeElement;
  if (active && modal.contains(active) && fallbackFocusNode && typeof fallbackFocusNode.focus === 'function') {
    fallbackFocusNode.focus();
  }

  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('inert', '');
}

const STATUS_ORDER = ['pending', 'accepted', 'preparing', 'ready', 'dispatched', 'delivered', 'cancelled'];
const STATUS_NORMALIZATION = { completed: 'delivered' };
const DELIVERY_STATUS_FLOW = ['pending', 'accepted', 'preparing', 'dispatched', 'delivered'];
const PICKUP_STATUS_FLOW = ['pending', 'accepted', 'preparing', 'ready', 'delivered'];

function normalizeOrderStatus(status = '') {
  const key = String(status || '').toLowerCase();
  return STATUS_NORMALIZATION[key] || key || 'pending';
}

function isPickupMode(modalidad = '') {
  const text = String(modalidad || '').toLowerCase();
  return ['recojo', 'recoger', 'pickup', 'pick-up', 'local', 'tienda'].some((token) => text.includes(token));
}

function getTrackingStatusFlow(modalidad = '') {
  return isPickupMode(modalidad) ? PICKUP_STATUS_FLOW : DELIVERY_STATUS_FLOW;
}

const DEFAULT_STORE_SETTINGS = {
  is_open: true,
  open_time: null,
  close_time: null,
  closed_message: 'Estamos cerrados. Vuelve en nuestro horario de atención.',
  timezone: 'America/Lima'
};

const DELIVERY_ZONES_LIMA = {
  'Barranca': ['Barranca', 'Paramonga', 'Pativilca', 'Supe', 'Supe Puerto'],
  'Cajatambo': ['Cajatambo', 'Copa', 'Gorgor', 'Huancapon', 'Manas'],
  'Canta': ['Canta', 'Arahuay', 'Huamantanga', 'Huaros', 'Lachaqui', 'San Buenaventura', 'Santa Rosa de Quives'],
  'Cañete': ['San Vicente de Cañete', 'Asia', 'Calango', 'Cerro Azul', 'Chilca', 'Coayllo', 'Imperial', 'Lunahuaná', 'Mala', 'Nuevo Imperial', 'Pacarán', 'Quilmaná', 'San Antonio', 'San Luis', 'Santa Cruz de Flores', 'Zúñiga'],
  'Huaral': ['Huaral', 'Atavillos Alto', 'Atavillos Bajo', 'Aucallama', 'Chancay', 'Ihuari', 'Lampián', 'Pacaraos', 'San Miguel de Acos', 'Santa Cruz de Andamarca', 'Sumbilca', 'Veintisiete de Noviembre'],
  'Huarochirí': ['Matucana', 'Antioquia', 'Callahuanca', 'Carampoma', 'Chicla', 'Cuenca', 'Huachupampa', 'Huanza', 'Huarochirí', 'Lahuaytambo', 'Langa', 'Laraos', 'Mariatana', 'Ricardo Palma', 'San Andrés de Tupicocha', 'San Antonio', 'San Bartolomé', 'San Damián', 'San Juan de Iris', 'San Juan de Tantaranche', 'San Lorenzo de Quinti', 'San Mateo', 'San Mateo de Otao', 'San Pedro de Casta', 'San Pedro de Huancayre', 'Sangallaya', 'Santa Cruz de Cocachacra', 'Santa Eulalia', 'Santiago de Anchucaya', 'Santiago de Tuna', 'Santo Domingo de los Olleros', 'Surco'],
  'Huaura': ['Huacho', 'Ámbar', 'Caleta de Carquín', 'Checras', 'Hualmay', 'Huaura', 'Leoncio Prado', 'Paccho', 'Santa Leonor', 'Santa María', 'Sayán', 'Végueta'],
  'Lima': ['Lima', 'Ancón', 'Ate', 'Barranco', 'Breña', 'Carabayllo', 'Chaclacayo', 'Chorrillos', 'Cieneguilla', 'Comas', 'El Agustino', 'Independencia', 'Jesús María', 'La Molina', 'La Victoria', 'Lince', 'Los Olivos', 'Lurigancho', 'Lurín', 'Magdalena del Mar', 'Miraflores', 'Pachacámac', 'Pucusana', 'Pueblo Libre', 'Puente Piedra', 'Punta Hermosa', 'Punta Negra', 'Rímac', 'San Bartolo', 'San Borja', 'San Isidro', 'San Juan de Lurigancho', 'San Juan de Miraflores', 'San Luis', 'San Martín de Porres', 'San Miguel', 'Santa Anita', 'Santa María del Mar', 'Santa Rosa', 'Santiago de Surco', 'Surquillo', 'Villa El Salvador', 'Villa María del Triunfo'],
  'Oyón': ['Oyón', 'Andajes', 'Caujul', 'Cochamarca', 'Naván', 'Pachangara'],
  'Yauyos': ['Yauyos', 'Alis', 'Ayauca', 'Ayavirí', 'Azángaro', 'Cacra', 'Carania', 'Catahuasi', 'Chocos', 'Cochas', 'Colonia', 'Hongos', 'Huampará', 'Huancaya', 'Huangáscar', 'Huantán', 'Huañec', 'Laraos', 'Lincha', 'Madeán', 'Miraflores', 'Omas', 'Putinza', 'Quinches', 'Quinocay', 'San Joaquín', 'San Pedro de Pilas', 'Tanta', 'Tauripampa', 'Tomás', 'Tupe', 'Viñac', 'Vitis']
};

const PROVINCIAS_LIMA = Object.keys(DELIVERY_ZONES_LIMA).sort((a, b) => a.localeCompare(b));

const DEBUG_FRONT = false;

function debugLog(...args) {
  if (!DEBUG_FRONT) return;
  console.log(...args);
}

function debugWarn(...args) {
  if (!DEBUG_FRONT) return;
  console.warn(...args);
}

function getErrorMeta(error) {
  return {
    message: error?.message || String(error || ''),
    code: error?.code || null,
    details: error?.details || null,
    hint: error?.hint || null
  };
}

async function reportCriticalError(eventName, context, error, extra = {}) {
  const payload = {
    ...extra,
    error: getErrorMeta(error)
  };

  try {
    await supabaseClient.rpc('log_app_event', {
      p_event_name: eventName,
      p_level: 'error',
      p_context: context,
      p_source: 'public_carta',
      p_payload: payload
    });
  } catch (logError) {
    debugWarn('⚠️ No se pudo registrar evento crítico:', getErrorMeta(logError));
  }
}

async function reportOperationalMetric(eventName, payload = {}) {
  try {
    await supabaseClient.rpc('log_app_event', {
      p_event_name: eventName,
      p_level: 'info',
      p_context: 'operational_metrics',
      p_source: 'public_carta',
      p_payload: payload
    });
  } catch (logError) {
    debugWarn('⚠️ No se pudo registrar métrica operativa:', getErrorMeta(logError));
  }
}

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

function getCartItemAvailability(item) {
  const plato = platosState.get(item.id);
  return !isPlatoSoldOut(plato);
}

function getCartTotal() {
  return cart.reduce((acc, item) => {
    if (!getCartItemAvailability(item)) return acc;
    return acc + (Number(item.precio) * Number(item.cantidad));
  }, 0);
}

function getUnavailableCartItemsCount() {
  return getUnavailableCartItems().reduce((acc, item) => acc + Number(item.cantidad || 0), 0);
}

function getCartCount() {
  return cart.reduce((acc, item) => acc + Number(item.cantidad), 0);
}

function getShortOrderId(id = '') {
  return id.slice(-6).toUpperCase();
}

function getSafeOrderPayloadForLogs(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  return {
    customer: {
      ...payload.customer,
      phone: payload.customer?.phone ? '***' : ''
    },
    items_count: Array.isArray(payload.items) ? payload.items.length : 0,
    totals: payload.totals
  };
}

function getCartStorageKey(ownerId = appRuntime.cartOwnerId || 'guest') {
  return ownerId && ownerId !== 'guest' ? `${CART_STORAGE_KEY}:user:${ownerId}` : CART_GUEST_STORAGE_KEY;
}

function readCartFromStorage(ownerId = appRuntime.cartOwnerId || 'guest') {
  try {
    const raw = localStorage.getItem(getCartStorageKey(ownerId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function loadCart(ownerId = appRuntime.cartOwnerId || 'guest') {
  appRuntime.cartOwnerId = ownerId || 'guest';
  cart = readCartFromStorage(appRuntime.cartOwnerId);
}

function saveCart() {
  localStorage.setItem(getCartStorageKey(appRuntime.cartOwnerId), JSON.stringify(cart));
}

function mergeCartItems(base = [], extra = []) {
  const map = new Map();
  [...base, ...extra].forEach((item) => {
    if (!item?.id) return;
    const key = String(item.id);
    const prev = map.get(key);
    const qty = Number(item.cantidad || 0);
    if (prev) {
      prev.cantidad += qty;
      return;
    }
    map.set(key, {
      id: item.id,
      nombre: item.nombre,
      precio: Number(item.precio || 0),
      cantidad: qty,
      imagen: item.imagen || ''
    });
  });
  return [...map.values()].filter((x) => Number(x.cantidad) > 0);
}

function switchCartOwner(nextOwnerId = 'guest', options = {}) {
  const owner = nextOwnerId || 'guest';
  const prevOwner = appRuntime.cartOwnerId || 'guest';
  const preserveGuestOnLogin = Boolean(options.preserveGuestOnLogin);

  if (prevOwner === owner) {
    loadCart(owner);
    updateCartBadge();
    renderCartModal();
    return;
  }

  const previousCart = readCartFromStorage(prevOwner);
  let targetCart = readCartFromStorage(owner);

  if (preserveGuestOnLogin && prevOwner === 'guest' && owner !== 'guest' && previousCart.length) {
    targetCart = mergeCartItems(targetCart, previousCart);
    localStorage.setItem(getCartStorageKey(owner), JSON.stringify(targetCart));
    localStorage.removeItem(getCartStorageKey('guest'));
  }

  appRuntime.cartOwnerId = owner;
  cart = targetCart;
  saveCart();
  updateCartBadge();
  renderCartModal();
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

function showCartToast(message, durationMs = 2200) {
  const toast = document.getElementById('cart-toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add('show');

  if (cartToastTimer) clearTimeout(cartToastTimer);

  cartToastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, durationMs);
}

function isPlatoSoldOut(plato) {
  if (!plato) return false;
  if (plato.is_available === false) return true;
  if (plato.track_stock === true && (plato.stock == null || Number(plato.stock) <= 0)) return true;
  return false;
}

function getPlatoAvailabilityMessage(plato) {
  if (!plato) return '';
  if (plato.is_available === false) return 'No disponible por el momento';
  if (plato.track_stock === true && (plato.stock == null || Number(plato.stock) <= 0)) return 'Agotado';
  return '';
}

function getUnavailableCartItems() {
  return cart.filter((item) => {
    const plato = platosState.get(item.id);
    return isPlatoSoldOut(plato);
  });
}

function getPriceChangeDigest(changes = []) {
  return changes
    .map((change) => `${change.id}:${Number(change.oldPrice).toFixed(2)}>${Number(change.newPrice).toFixed(2)}`)
    .sort()
    .join('|');
}

function renderCartPriceChangesNotice(changes = []) {
  const container = document.getElementById('cart-price-changes');
  if (!container) return;
  if (!changes.length) {
    container.style.display = 'none';
    container.textContent = '';
    appRuntime.lastCartPriceChanges = [];
    appRuntime.lastCartPriceChangeDigest = '';
    return;
  }

  const digest = getPriceChangeDigest(changes);
  appRuntime.lastCartPriceChanges = changes.map((change) => ({ ...change }));
  appRuntime.lastCartPriceChangeDigest = digest;

  const names = changes.map((change) => change.nombre).join(', ');
  const plural = changes.length > 1;
  container.style.display = 'block';
  container.textContent = plural
    ? `Hubo cambios de precio en: ${names}. Se actualizó tu carrito con el precio vigente.`
    : `Hubo cambio de precio en ${names}. Se actualizó tu carrito con el precio vigente.`;
}



function formatTrackingDate(dateIso) {
  if (!dateIso) return '-';
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('es-PE');
}

function normalizeTrackingCode(rawCode = '') {
  return String(rawCode).trim().toUpperCase();
}


function saveLastTrackingCode(code = '') {
  const normalized = normalizeTrackingCode(code);
  if (!normalized) return;
  localStorage.setItem(TRACKING_LAST_CODE_STORAGE_KEY, normalized);
}

function getLastTrackingCode() {
  return normalizeTrackingCode(localStorage.getItem(TRACKING_LAST_CODE_STORAGE_KEY) || '');
}

function refreshTrackingLastButton() {
  const lastBtn = document.getElementById('trackingLastBtn');
  if (!lastBtn) return;
  const lastCode = getLastTrackingCode();
  lastBtn.style.display = lastCode ? 'inline-flex' : 'none';
}

function humanTrackingStatus(status) {
  const map = {
    pending: 'Pendiente',
    accepted: 'Aceptado',
    preparing: 'En preparación',
    ready: 'Listo',
    dispatched: 'En reparto',
    delivered: 'Entregado',
    cancelled: 'Cancelado'
  };
  const normalized = normalizeOrderStatus(status);
  return map[normalized] || normalized || '-';
}


function canCustomerCancelOrder(status = '') {
  const normalized = normalizeOrderStatus(status);
  return ['pending', 'accepted', 'preparing', 'ready'].includes(normalized);
}

function stopTrackingAutoRefresh() {
  if (trackingIntervalId) {
    clearInterval(trackingIntervalId);
    trackingIntervalId = null;
  }
}

function startTrackingAutoRefresh() {
  stopTrackingAutoRefresh();
  if (!trackingLastCode) return;

  trackingIntervalId = setInterval(() => {
    const modal = document.getElementById('trackingModal');
    if (!modal || !modal.classList.contains('open')) {
      stopTrackingAutoRefresh();
      return;
    }
    fetchOrderStatus(trackingLastCode, { silent: true });
  }, 25000);
}

function openTrackingModal(prefillCode = '') {
  const modal = document.getElementById('trackingModal');
  const input = document.getElementById('trackingCode');
  if (!modal || !input) return;

  const codeToUse = normalizeTrackingCode(prefillCode) || getLastTrackingCode();

  if (codeToUse) input.value = codeToUse;
  openModalSafe(modal, input);
  refreshTrackingLastButton();

  if (codeToUse && prefillCode) {
    fetchOrderStatus(codeToUse);
  }
}

function closeTrackingModal() {
  const modal = document.getElementById('trackingModal');
  if (!modal) return;
  closeModalSafe(modal, getFallbackFocusElement('btnTrackingTop', 'btnTracking', 'cart-float-btn'));
  stopTrackingAutoRefresh();
}

function renderTrackingError(message) {
  const result = document.getElementById('trackingResult');
  const refreshBtn = document.getElementById('trackingRefreshBtn');
  if (!result) return;

  result.innerHTML = `<p class="tracking-error">${message}</p>`;
  if (refreshBtn) refreshBtn.disabled = true;
  stopTrackingAutoRefresh();
}

function buildTrackingTimeline(status, modalidad = '') {
  const normalizedStatus = normalizeOrderStatus(status);
  if (normalizedStatus === 'cancelled') {
    return `<div class="tracking-timeline">
      <div class="tracking-step cancelled">
        <span class="tracking-step-dot"></span>
        <span>Pedido cancelado</span>
      </div>
    </div>`;
  }

  const flow = getTrackingStatusFlow(modalidad);
  const idx = flow.indexOf(normalizedStatus);
  const safeIndex = idx === -1 ? 0 : idx;

  const steps = flow.map((step, index) => {
    const cls = index < safeIndex ? 'completed' : (index === safeIndex ? 'active' : '');
    return `<div class="tracking-step ${cls}">
      <span class="tracking-step-dot"></span>
      <span>${humanTrackingStatus(step)}</span>
    </div>`;
  }).join('');

  return `<div class="tracking-timeline">${steps}</div>`;
}

function renderTracking(data) {
  const result = document.getElementById('trackingResult');
  const refreshBtn = document.getElementById('trackingRefreshBtn');
  if (!result || !data) return;

  result.innerHTML = `
    <div class="tracking-order-meta">
      <p><strong>Código:</strong> ${data.short_code}</p>
      <p><strong>Estado:</strong> ${humanTrackingStatus(data.status)}</p>
      <p><strong>Modalidad:</strong> ${data.modalidad || '-'}</p>
      <p><strong>Total:</strong> ${formatCurrency(data.total || 0)}</p>
      <p><strong>Creado:</strong> ${formatTrackingDate(data.created_at)}</p>
      <p><strong>Actualizado:</strong> ${formatTrackingDate(data.updated_at)}</p>
    </div>
    ${buildTrackingTimeline(data.status, data.modalidad)}
  `;

  if (refreshBtn) refreshBtn.disabled = false;
}

async function fetchOrderStatus(code, options = {}) {
  const normalizedCode = normalizeTrackingCode(code);
  const result = document.getElementById('trackingResult');
  const refreshBtn = document.getElementById('trackingRefreshBtn');

  if (!normalizedCode) {
    renderTrackingError('Ingresa un código válido para rastrear tu pedido.');
    return;
  }

  if (!options.silent && result) {
    result.innerHTML = '<p>Consultando estado...</p>';
  }

  try {
    const { data, error } = await supabaseClient.rpc('get_order_status', { short_code: normalizedCode });
    if (error) throw error;

    trackingLastCode = normalizedCode;
    saveLastTrackingCode(normalizedCode);
    refreshTrackingLastButton();
    renderTracking(data);
    if (refreshBtn) refreshBtn.disabled = false;
    startTrackingAutoRefresh();
  } catch (error) {
    await reportCriticalError('tracking_error', 'fetchOrderStatus', error, { code: normalizedCode });
    const errMsg = String(error?.message || '');
    if (errMsg.includes('INVALID_CODE')) {
      renderTrackingError('Código inválido. Verifica e inténtalo nuevamente.');
    } else if (errMsg.includes('NOT_FOUND')) {
      renderTrackingError('No encontramos ese pedido. Revisa tu código.');
    } else {
      renderTrackingError('No se pudo consultar el estado del pedido. Intenta de nuevo.');
    }
  }
}

function setupTrackingEvents() {
  const scope = getOrCreateListenerScope('tracking');
  const openBtn = document.getElementById('btnTracking');
  const topBtn = document.getElementById('btnTrackingTop');
  const closeBtn = document.getElementById('trackingCloseBtn');
  const searchBtn = document.getElementById('trackingSearchBtn');
  const refreshBtn = document.getElementById('trackingRefreshBtn');
  const lastBtn = document.getElementById('trackingLastBtn');
  const input = document.getElementById('trackingCode');
  const modal = document.getElementById('trackingModal');

  bindScopedListener(scope, openBtn, 'click', (event) => {
    event.preventDefault();
    openTrackingModal();
  }, {}, 'tracking:open-link');

  bindScopedListener(scope, topBtn, 'click', (event) => {
    event.preventDefault();
    openTrackingModal();
  }, {}, 'tracking:open-top');


  bindScopedListener(scope, closeBtn, 'click', closeTrackingModal, {}, 'tracking:close-btn');

  bindScopedListener(scope, searchBtn, 'click', () => {
    fetchOrderStatus(input?.value || '');
  }, {}, 'tracking:search-btn');

  bindScopedListener(scope, refreshBtn, 'click', () => {
    if (!trackingLastCode) return;
    fetchOrderStatus(trackingLastCode);
  }, {}, 'tracking:refresh-btn');

  bindScopedListener(scope, lastBtn, 'click', () => {
    const lastCode = getLastTrackingCode();
    if (!lastCode) return;
    if (input) input.value = lastCode;
    fetchOrderStatus(lastCode);
  }, {}, 'tracking:last-btn');

  bindScopedListener(scope, input, 'keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      fetchOrderStatus(input.value);
    }
  }, {}, 'tracking:enter-search');

  refreshTrackingLastButton();

  bindScopedListener(scope, document, 'keydown', (event) => {
    if (event.key === 'Escape' && modal?.classList.contains('open')) {
      closeTrackingModal();
    }
  }, {}, 'tracking:escape-close');

  logListenerStats('tracking');
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
          ...data
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

async function getDeliveryZones() {
  try {
    const { data, error } = await supabaseClient
      .from('delivery_zones')
      .select('*')
      .eq('activo', true)
      .order('provincia', { ascending: true })
      .order('distrito', { ascending: true });

    if (error) throw error;

    deliveryZones = (data || []).map((zone) => ({
      ...zone,
      tarifa: Number(zone.tarifa || 0),
      minimo: Number(zone.minimo || 0)
    }));
    deliveryZonesLoaded = true;
  } catch (error) {
    console.warn('⚠️ No se pudo cargar delivery_zones:', {
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code
    });
    deliveryZones = [];
    deliveryZonesLoaded = false;
  }

  renderDeliveryZoneOptions();
  updateCartTotalsAndAvailability();
}

function getDistrictsByProvincia(provincia) {
  return DELIVERY_ZONES_LIMA[provincia] || [];
}

function getSelectedZone() {

  const provincia = document.getElementById('checkout-provincia')?.value || '';
  const distrito = document.getElementById('checkout-distrito')?.value || '';
  if (!provincia || !distrito) return { zona: null, provincia, distrito };
  const zona = deliveryZones.find((z) => z.provincia === provincia && z.distrito === distrito) || null;
  return { zona, provincia, distrito };
}

function renderDeliveryZoneOptions() {
  const provinciaSelect = document.getElementById('checkout-provincia');
  const distritoSelect = document.getElementById('checkout-distrito');
  if (!provinciaSelect || !distritoSelect) return;

  const currentProvincia = provinciaSelect.value;
  const currentDistrito = distritoSelect.value;

  provinciaSelect.innerHTML = '<option value="">Selecciona provincia</option>';
  PROVINCIAS_LIMA.forEach((prov) => {
    const option = document.createElement('option');
    option.value = prov;
    option.textContent = prov;
    provinciaSelect.appendChild(option);
  });

  if (PROVINCIAS_LIMA.includes(currentProvincia)) {
    provinciaSelect.value = currentProvincia;
  }

  const districts = getDistrictsByProvincia(provinciaSelect.value);
  distritoSelect.innerHTML = '<option value="">Selecciona distrito</option>';
  districts.forEach((dist) => {
    const option = document.createElement('option');
    option.value = dist;
    option.textContent = dist;
    distritoSelect.appendChild(option);
  });

  if (districts.includes(currentDistrito)) {
    distritoSelect.value = currentDistrito;
  }
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

  const currentMin = toMinutes(getTimeInTimezone('America/Lima'));
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
  const subtotal = Number(getCartTotal());
  const selected = getSelectedZone();
  const zona = selected?.zona || null;
  const deliveryFee = normalizedModalidad === 'Delivery' ? Number(zona?.tarifa || 0) : 0;
  const totalFinal = subtotal + deliveryFee;

  return {
    subtotal,
    deliveryFee,
    totalFinal,
    modalidad: normalizedModalidad,
    provincia: selected?.provincia || '',
    distrito: selected?.distrito || '',
    hasZoneSelected: Boolean(selected?.provincia && selected?.distrito),
    hasCoverage: Boolean(zona),
    hasZonesAvailable: PROVINCIAS_LIMA.length > 0
  };
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
  const modalidad = document.getElementById('checkout-modalidad');
  const confirmBtn = document.getElementById('confirm-order-btn');
  const zoneGroup = document.getElementById('delivery-zone-group');
  const zoneFeedback = document.getElementById('delivery-zone-feedback');
  const availabilityNote = document.getElementById('cart-availability-note');

  if (!subtotalNode || !deliveryRow || !deliveryFeeNode || !totalNode) return;

  const totals = getCheckoutTotals(modalidad?.value || 'Delivery');
  const storeInfo = getStoreOpenInfo();
  const unavailableItems = getUnavailableCartItems();

  subtotalNode.textContent = formatCurrency(totals.subtotal);
  totalNode.textContent = formatCurrency(totals.totalFinal);

  let blockedMessage = '';

  if (unavailableItems.length > 0) {
    blockedMessage = 'Tienes productos agotados en el carrito.';
  }

  if (!blockedMessage && !storeInfo.isOpen) {
    blockedMessage = storeInfo.reason || 'Fuera de horario';
    deliveryRow.style.display = 'none';
    if (zoneGroup) zoneGroup.style.display = 'none';
    if (zoneFeedback) {
      zoneFeedback.style.display = 'none';
      zoneFeedback.textContent = '';
    }
  } else if (!blockedMessage && totals.modalidad === 'Delivery') {
    if (zoneGroup) zoneGroup.style.display = 'grid';

    if (!totals.hasZonesAvailable) {
      blockedMessage = 'Delivery no disponible por ahora. Selecciona Recojo.';
      deliveryRow.style.display = 'none';
      if (zoneFeedback) {
        zoneFeedback.style.display = 'block';
        zoneFeedback.textContent = 'Delivery no disponible por ahora.';
      }
    } else if (!totals.hasZoneSelected) {
      blockedMessage = 'Selecciona provincia y distrito para delivery.';
      deliveryRow.style.display = 'none';
      if (zoneFeedback) {
        zoneFeedback.style.display = 'block';
        zoneFeedback.textContent = 'Selecciona provincia y distrito.';
      }
    } else if (!totals.hasCoverage) {
      blockedMessage = 'No hay cobertura para la zona seleccionada.';
      deliveryRow.style.display = 'none';
      if (zoneFeedback) {
        zoneFeedback.style.display = 'block';
        zoneFeedback.textContent = 'No hay cobertura para esta zona.';
      }
    } else {
      deliveryRow.style.display = 'flex';
      deliveryFeeNode.textContent = formatCurrency(totals.deliveryFee);

      if (zoneFeedback) {
        zoneFeedback.style.display = 'block';
        zoneFeedback.textContent = `Zona: ${totals.provincia} - ${totals.distrito}`;
      }

      if (!totals.hasCoverage) {
      showFeedback('No hay cobertura para la zona seleccionada.', 'error');
      return;
    }
    }
  } else {
    deliveryRow.style.display = 'none';
    if (zoneGroup) zoneGroup.style.display = 'none';
    if (zoneFeedback) {
      zoneFeedback.style.display = 'none';
      zoneFeedback.textContent = '';
    }
  }

  if (confirmBtn) {
    confirmBtn.disabled = Boolean(blockedMessage);
    if (!blockedMessage) {
      confirmBtn.textContent = 'Confirmar pedido';
    } else if (unavailableItems.length > 0) {
      confirmBtn.textContent = 'Corrige productos';
    } else {
      confirmBtn.textContent = storeInfo.isOpen ? 'Completa delivery' : 'Fuera de horario';
    }
  }

  renderStoreStatusBanner();

  const unavailableCount = getUnavailableCartItemsCount();
  if (availabilityNote) {
    if (unavailableCount > 0) {
      availabilityNote.style.display = 'block';
      availabilityNote.textContent = `${unavailableCount} item(s) no disponible(s) no se incluyen en el total.`;
    } else {
      availabilityNote.style.display = 'none';
      availabilityNote.textContent = '';
    }
  }

  if (unavailableItems.length > 0) {
    showFeedback('Algunos productos ya no están disponibles, elimínalos del carrito.', 'error');
  }

}

function buildWhatsAppMessage(orderData) {
  const itemsTxt = orderData.items
    .map(it => `- ${it.nombre} x${it.cantidad} (${formatCurrency(it.precio)} c/u) = ${formatCurrency(it.subtotal)}`)
    .join('\n');

  const shortId = orderData.short_id || getShortOrderId(orderData.id);
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
    `🗺️ Zona: ${orderData.modalidad === 'Delivery' ? `${orderData.provincia || '-'} - ${orderData.distrito || '-'}` : 'No aplica'}`,
    `📍 Dirección: ${orderData.direccion || 'No aplica'}`,
    `🧭 Referencia: ${orderData.referencia || '-'}`,
    `📝 Comentario: ${orderData.comentario || '-'}`
  ];

  return `https://wa.me/${WA_PHONE}?text=${encodeURIComponent(lines.join('\n'))}`;
}

async function sendReceiptEmail(orderData, { trigger = 'manual' } = {}) {
  if (!orderData?.id) return { ok: false, reason: 'ORDER_ID_REQUIRED' };

  const receiptEmail = normalizeEmail(orderData.email || appRuntime.lastAuthEmail || '');
  const receiptToken = String(orderData.receipt_token || '').trim();

  if (!receiptEmail) {
    if (trigger === 'manual') showFeedback('No hay correo válido para enviar el comprobante.', 'error');
    return { ok: false, reason: 'EMAIL_REQUIRED' };
  }
  if (!receiptToken) {
    if (trigger === 'manual') showFeedback('No se encontró token de seguridad del comprobante.', 'error');
    return { ok: false, reason: 'TOKEN_REQUIRED' };
  }
  if (appRuntime.receiptSendBusy) return { ok: false, reason: 'BUSY' };

  const receiptBtn = document.getElementById('receipt-email-btn');
  appRuntime.receiptSendBusy = true;

  const prevText = receiptBtn?.textContent || 'Enviar comprobante por correo';
  if (receiptBtn) {
    receiptBtn.disabled = true;
    receiptBtn.textContent = 'Enviando...';
  }

  try {
    const functionName = 'send-receipt';
    const invokePayload = {
      order_id: orderData.id,
      email: receiptEmail,
      token: receiptToken
    };

    const anonProjectRef = (() => {
      try {
        const payload = JSON.parse(atob(String(SUPABASE_ANON_KEY || '').split('.')[1] || ''));
        return payload?.ref || '';
      } catch (_) {
        return '';
      }
    })();

    console.log('📨 send-receipt invoke config', {
      functionName,
      supabaseUrl: SUPABASE_URL,
      anonProjectRef,
      usesAnonClient: true,
      orderId: invokePayload.order_id,
      trigger
    });

    let { data, error } = await guestSupabaseClient.functions.invoke(functionName, {
      body: invokePayload,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    console.log('📨 send-receipt invoke result', { data, error });

    if (error) {
      console.warn('⚠️ send-receipt invoke via SDK falló, intentando fetch manual', {
        message: error?.message,
        status: error?.context?.status || error?.status
      });

      const manualResponse = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(invokePayload)
      });
      const manualBody = await manualResponse.json().catch(() => ({}));
      console.log('📨 send-receipt fetch fallback result', {
        ok: manualResponse.ok,
        status: manualResponse.status,
        body: manualBody
      });

      if (!manualResponse.ok) {
        throw Object.assign(new Error(`SEND_RECEIPT_HTTP_${manualResponse.status}`), {
          details: manualBody,
          status: manualResponse.status
        });
      }

      data = manualBody;
      error = null;
    }

    showCartToast(`📧 Comprobante enviado a ${receiptEmail}`);
    if (trigger === 'manual') showFeedback(`Comprobante enviado al correo ${receiptEmail}.`, 'success');
    return { ok: true, data };
  } catch (error) {
    console.error('❌ Error enviando comprobante por Edge Function:', {
      message: error?.message,
      details: error?.context?.details || error?.details,
      hint: error?.context?.hint || error?.hint,
      status: error?.context?.status || error?.status,
      trigger,
      orderId: orderData?.id,
      supabaseUrl: SUPABASE_URL
    });
    if (trigger === 'manual') showFeedback('No se pudo enviar el comprobante por correo. Intenta nuevamente.', 'error');
    return { ok: false, reason: String(error?.message || 'SEND_RECEIPT_FAILED') };
  } finally {
    appRuntime.receiptSendBusy = false;
    if (receiptBtn) {
      receiptBtn.disabled = false;
      receiptBtn.textContent = prevText;
    }
  }
}

function openReceiptModal() {
  const modal = document.getElementById('receipt-modal');
  if (!modal) return;
  openModalSafe(modal, document.getElementById('receipt-close-btn'));
}

function closeReceiptModal() {
  const modal = document.getElementById('receipt-modal');
  if (!modal) return;
  closeModalSafe(modal, getFallbackFocusElement('cart-float-btn', 'auth-account-btn'));
}

function renderReceipt(orderData) {
  const receiptBox = document.getElementById('order-receipt');
  const receiptContent = document.getElementById('order-receipt-content');
  const receiptWhatsAppBtn = document.getElementById('receipt-whatsapp-btn');
  const receiptTrackBtn = document.getElementById('btnVerEstadoPedido');
  const receiptEmailBtn = document.getElementById('receipt-email-btn');
  if (!receiptBox || !receiptContent || !orderData) return;

  const shortId = orderData.short_id || getShortOrderId(orderData.id);
  const trackingCode = orderData.short_code || shortId;
  const lines = orderData.items.map((it) => `${it.nombre} · Cantidad: ${it.cantidad} · Precio: ${formatCurrency(it.precio)}`);

  receiptContent.innerHTML = `
    <p><strong>Pedido:</strong> #${shortId}</p>
    <p><strong>Código de rastreo:</strong> ${trackingCode}</p>
    <p><strong>Cliente:</strong> ${orderData.nombre_cliente}</p>
    <p><strong>Teléfono:</strong> ${orderData.telefono}</p>
    <p><strong>Correo comprobante:</strong> ${orderData.email || 'No registrado'}</p>
    <p><strong>Modalidad:</strong> ${orderData.modalidad}</p>
    <p><strong>Zona:</strong> ${orderData.modalidad === 'Delivery' ? `${orderData.provincia || '-'} - ${orderData.distrito || '-'}` : 'No aplica'}</p>
    <p><strong>Subtotal:</strong> ${formatCurrency(orderData.subtotal ?? orderData.total)}</p>
    <p><strong>Delivery:</strong> ${formatCurrency(orderData.delivery_fee ?? 0)}</p>
    <p><strong>Total final:</strong> ${formatCurrency(orderData.total)}</p>
    <p><strong>Items:</strong></p>
    ${lines.map((line) => `<p>• ${line}</p>`).join('')}
  `;

  if (receiptTrackBtn) {
    receiptTrackBtn.style.display = 'inline-flex';
  }

  if (receiptWhatsAppBtn) {
    receiptWhatsAppBtn.href = buildWhatsAppMessage(orderData);
    receiptWhatsAppBtn.style.display = 'inline-flex';
  }

  const receiptEmail = normalizeEmail(orderData.email || '');
  const isLoggedInOrder = receiptEmail && normalizeEmail(appRuntime.lastAuthEmail || '') === receiptEmail;

  if (receiptEmailBtn) {
    if (!isLoggedInOrder && receiptEmail) {
      receiptEmailBtn.style.display = 'inline-flex';
      receiptEmailBtn.dataset.email = receiptEmail;
      receiptEmailBtn.textContent = `Enviar comprobante por correo (${receiptEmail})`;
    } else {
      receiptEmailBtn.style.display = 'none';
      receiptEmailBtn.dataset.email = '';
    }
  }

  if (isLoggedInOrder && receiptEmail) {
    const orderRef = orderData.short_code || shortId;
    if (appRuntime.autoReceiptEmailSentFor !== orderRef) {
      appRuntime.autoReceiptEmailSentFor = orderRef;
      sendReceiptEmail(orderData, { trigger: 'auto' });
    }
  }

  receiptBox.style.display = 'block';
}

function hideReceipt() {
  const receiptBox = document.getElementById('order-receipt');
  const receiptContent = document.getElementById('order-receipt-content');
  const receiptWhatsAppBtn = document.getElementById('receipt-whatsapp-btn');
  const receiptTrackBtn = document.getElementById('btnVerEstadoPedido');
  const receiptEmailBtn = document.getElementById('receipt-email-btn');

  if (receiptBox) receiptBox.style.display = 'none';
  if (receiptContent) receiptContent.innerHTML = '';
  if (receiptTrackBtn) receiptTrackBtn.style.display = 'none';
  if (receiptEmailBtn) {
    receiptEmailBtn.style.display = 'none';
    receiptEmailBtn.dataset.email = '';
  }
  if (receiptWhatsAppBtn) {
    receiptWhatsAppBtn.style.display = 'none';
    receiptWhatsAppBtn.href = '#';
  }
}

function buildReceiptText(orderData) {
  const shortId = orderData.short_id || getShortOrderId(orderData.id);
  const itemsText = orderData.items
    .map((it) => `- ${it.nombre} | Cantidad: ${it.cantidad} | Precio: ${formatCurrency(it.precio)}`)
    .join('\n');

  return [
    'DPASO - Comprobante de pedido',
    `Pedido: #${shortId}`,
    `Cliente: ${orderData.nombre_cliente}`,
    `Teléfono: ${orderData.telefono}`,
    `Correo comprobante: ${orderData.email || 'No registrado'}`,
    `Modalidad: ${orderData.modalidad}`,
    `Zona: ${orderData.modalidad === 'Delivery' ? `${orderData.provincia || '-'} - ${orderData.distrito || '-'}` : 'No aplica'}`,
    `Subtotal: ${formatCurrency(orderData.subtotal ?? orderData.total)}`,
    `Delivery: ${formatCurrency(orderData.delivery_fee ?? 0)}`,
    `Total final: ${formatCurrency(orderData.total)}`,
    'Items:',
    itemsText
  ].join('\n');
}

function downloadReceiptPdf(orderData) {
  if (!orderData) return;

  const shortId = orderData.short_id || getShortOrderId(orderData.id);
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

async function refreshCartAvailability({ showPriceChangeToast = false } = {}) {
  const ids = [...new Set(cart.map((item) => item.id).filter(Boolean))];
  if (!ids.length) {
    renderCartPriceChangesNotice([]);
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from('platos')
      .select('id,nombre,is_available,track_stock,stock,precio')
      .in('id', ids);

    if (error) throw error;

    (data || []).forEach((row) => {
      const prev = platosState.get(row.id) || {};
      platosState.set(row.id, { ...prev, ...row });
    });

    const changedPrices = [];
    cart = cart.map((item) => {
      const latest = (data || []).find((row) => row.id === item.id);
      if (!latest) return item;

      const oldPrice = Number(item.precio);
      const newPrice = Number(latest.precio ?? item.precio);

      if (Number.isFinite(oldPrice) && Number.isFinite(newPrice) && Math.abs(oldPrice - newPrice) > 0.009) {
        changedPrices.push({
          id: item.id,
          nombre: latest.nombre || item.nombre,
          oldPrice,
          newPrice
        });
      }

      return { ...item, precio: newPrice };
    });

    const nextDigest = getPriceChangeDigest(changedPrices);
    const isNewChangeSet = Boolean(nextDigest) && nextDigest !== appRuntime.lastCartPriceChangeDigest;
    renderCartPriceChangesNotice(changedPrices);

    if (showPriceChangeToast && isNewChangeSet && changedPrices.length > 0) {
      const names = changedPrices.map((change) => change.nombre).join(', ');
      const plural = changedPrices.length > 1;
      showCartToast(plural
        ? `⚠️ Cambiaron precios en: ${names}`
        : `⚠️ Cambió el precio de ${names}`);
    }

    saveCart();
  } catch (error) {
    console.warn('⚠️ No se pudo refrescar disponibilidad del carrito:', error?.message || error);
  }
}


function addToCart(item) {
  const platoState = platosState.get(item.id);
  if (isPlatoSoldOut(platoState)) {
    showCartToast(`⚠️ ${item.nombre} está agotado`);
    return;
  }

  const found = cart.find(x => x.id === item.id);

  if (found && platoState?.track_stock === true) {
    const maxStock = Number(platoState.stock ?? 0);
    if (found.cantidad >= maxStock) {
      showCartToast(`⚠️ Solo quedan ${maxStock} de ${item.nombre}`);
      return;
    }
  }

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

  const platoState = platosState.get(itemId);
  if (delta > 0 && isPlatoSoldOut(platoState)) {
    showCartToast(`⚠️ ${item.nombre} no está disponible`);
    return;
  }

  if (delta > 0 && platoState?.track_stock === true) {
    const maxStock = Number(platoState.stock ?? 0);
    if (item.cantidad >= maxStock) {
      showCartToast(`⚠️ Stock máximo alcanzado para ${item.nombre}`);
      return;
    }
  }

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
  openModalSafe(modal, document.getElementById('cart-close-btn'));
  getStoreSettings();
  getDeliveryZones();
  refreshCartAvailability().then(() => renderCartModal());
}

function closeCartModal() {
  const modal = document.getElementById('cart-modal');
  if (!modal) return;
  closeModalSafe(modal, getFallbackFocusElement('cart-float-btn', 'auth-account-btn'));
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
      const platoInfo = platosState.get(item.id);
      const isUnavailable = isPlatoSoldOut(platoInfo);
      const availabilityMsg = getPlatoAvailabilityMessage(platoInfo);

      if (checkoutStepOpen) {
        row.innerHTML = `
          <img src="${item.imagen}" alt="${item.nombre}">
          <div class="cart-item-data">
            <h4>${item.nombre}</h4>
            <p>Cantidad: ${item.cantidad}</p>
            <p>Precio: ${formatCurrency(item.precio)}</p>
            ${availabilityMsg ? `<p style="color:#b42318;font-weight:600;">${availabilityMsg}</p>` : ''}
          </div>
        `;
      } else {
        row.innerHTML = `
          <img src="${item.imagen}" alt="${item.nombre}">
          <div class="cart-item-data">
            <h4>${item.nombre}</h4>
            <p>${formatCurrency(item.precio)}</p>
            ${availabilityMsg ? `<p style="color:#b42318;font-weight:600;">${availabilityMsg}</p>` : ''}
            <div class="cart-item-actions">
              <button type="button" data-action="minus" data-id="${item.id}">-</button>
              <span>${item.cantidad}</span>
              <button type="button" data-action="plus" data-id="${item.id}" ${isUnavailable ? 'disabled title="Producto no disponible"' : ''}>+</button>
              <button type="button" data-action="delete" data-id="${item.id}" class="danger">Eliminar</button>
            </div>
          </div>
        `;
      }

      itemsContainer.appendChild(row);
    });
  }

  const priceChanges = Array.isArray(appRuntime.lastCartPriceChanges) ? appRuntime.lastCartPriceChanges : [];
  renderCartPriceChangesNotice(priceChanges);

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

  const provincia = document.getElementById('checkout-provincia');
  const distrito = document.getElementById('checkout-distrito');
  const forOtherCheckbox = document.getElementById('checkout-for-other');

  if (!isDelivery) {
    direccion.value = '';
    const referenciaInput = document.getElementById('checkout-referencia');
    if (referenciaInput) referenciaInput.value = '';
    if (provincia) provincia.value = '';
    if (distrito) distrito.value = '';
  }

  updateCartTotalsAndAvailability();
}


function fillCheckoutWithProfileData() {
  const checkoutName = document.getElementById('checkout-nombre');
  const checkoutPhone = document.getElementById('checkout-telefono');
  const checkoutEmail = document.getElementById('checkout-email');
  if (checkoutName && appRuntime.checkoutProfileName) checkoutName.value = appRuntime.checkoutProfileName;
  if (checkoutPhone && appRuntime.checkoutProfilePhone) checkoutPhone.value = appRuntime.checkoutProfilePhone;
  if (checkoutEmail && appRuntime.lastAuthEmail) checkoutEmail.value = normalizeEmail(appRuntime.lastAuthEmail);
}

function updateCheckoutIdentityControlsVisibility(user = null) {
  const row = document.getElementById('checkout-identity-row');
  const help = document.getElementById('checkout-identity-help');
  const forOtherCheckbox = document.getElementById('checkout-for-other');

  const loggedIn = Boolean(user?.id);
  if (row) row.style.display = loggedIn ? 'flex' : 'none';
  if (help) help.style.display = loggedIn ? 'block' : 'none';
  if (forOtherCheckbox) {
    forOtherCheckbox.disabled = !loggedIn;
    if (!loggedIn) forOtherCheckbox.checked = false;
  }
}

function setupCartModalEvents() {
  const scope = getOrCreateListenerScope('cart');
  const cartButton = document.getElementById('cart-float-btn');
  const closeButton = document.getElementById('cart-close-btn');
  const modal = document.getElementById('cart-modal');
  const itemsContainer = document.getElementById('cart-items');
  const modalidad = document.getElementById('checkout-modalidad');
  const goCheckoutBtn = document.getElementById('go-checkout-btn');
  const backToCartBtn = document.getElementById('back-to-cart-btn');
  const receiptModal = document.getElementById('receipt-modal');
  const receiptCloseBtn = document.getElementById('receipt-close-btn');
  const trackOrderBtn = document.getElementById('btnVerEstadoPedido');
  const provincia = document.getElementById('checkout-provincia');
  const distrito = document.getElementById('checkout-distrito');
  const forOtherCheckbox = document.getElementById('checkout-for-other');
  const receiptEmailBtn = document.getElementById('receipt-email-btn');

  bindScopedListener(scope, cartButton, 'click', openCartModal, {}, 'cart:open');
  bindScopedListener(scope, closeButton, 'click', closeCartModal, {}, 'cart:close');

  bindScopedListener(scope, modal, 'click', () => {
    // Evitamos cierre por clic fuera del modal; se cierra solo con la X.
  }, {}, 'cart:backdrop-close');

  bindScopedListener(scope, receiptModal, 'click', (e) => {
    if (e.target === receiptModal) closeReceiptModal();
  }, {}, 'receipt:backdrop-close');

  bindScopedListener(scope, receiptCloseBtn, 'click', closeReceiptModal, {}, 'receipt:close-btn');

  bindScopedListener(scope, trackOrderBtn, 'click', () => {
    const code = lastOrderCode || lastOrderData?.short_id || '';
    closeReceiptModal();
    openTrackingModal(code);
  }, {}, 'receipt:open-tracking');

  bindScopedListener(scope, itemsContainer, 'click', (e) => {
    if (checkoutStepOpen) return;

    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.dataset.action;
    const id = target.dataset.id;
    if (!action || !id) return;

    if (action === 'minus') changeCartQty(id, -1);
    if (action === 'plus') changeCartQty(id, 1);
    if (action === 'delete') removeCartItem(id);
  }, {}, 'cart:items-actions');

  bindScopedListener(scope, modalidad, 'change', updateDireccionRequired, {}, 'checkout:modalidad-change');

  bindScopedListener(scope, provincia, 'change', () => {
    const districts = getDistrictsByProvincia(provincia.value);
    if (distrito) {
      distrito.innerHTML = '<option value="">Selecciona distrito</option>';
      districts.forEach((dist) => {
        const option = document.createElement('option');
        option.value = dist;
        option.textContent = dist;
        distrito.appendChild(option);
      });
    }
    updateCartTotalsAndAvailability();
  }, {}, 'checkout:provincia-change');

  bindScopedListener(scope, distrito, 'change', updateCartTotalsAndAvailability, {}, 'checkout:distrito-change');

  bindScopedListener(scope, forOtherCheckbox, 'change', () => {
    const checkoutName = document.getElementById('checkout-nombre');
    const checkoutPhone = document.getElementById('checkout-telefono');
    if (forOtherCheckbox?.checked) {
      if (checkoutName) checkoutName.value = '';
      if (checkoutPhone) checkoutPhone.value = '';
      return;
    }
    fillCheckoutWithProfileData();
  }, {}, 'checkout:for-other-change');

  bindScopedListener(scope, goCheckoutBtn, 'click', () => {
    checkoutStepOpen = true;
    toggleCheckoutSection(true);
    renderCartModal();
    const whatsappBtn = document.getElementById('whatsapp-order-btn');
    if (whatsappBtn) {
      whatsappBtn.style.display = 'none';
      whatsappBtn.href = '#';
    }
    clearFeedback();
    if (!forOtherCheckbox?.checked) fillCheckoutWithProfileData();
    updateDireccionRequired();
  }, {}, 'checkout:open-step');

  bindScopedListener(scope, backToCartBtn, 'click', () => {
    checkoutStepOpen = false;
    toggleCheckoutSection(false);
    clearFeedback();
    renderCartModal();
  }, {}, 'checkout:back-step');

  bindScopedListener(scope, document.getElementById('download-receipt-btn'), 'click', () => downloadReceiptPdf(lastOrderData), {}, 'receipt:download');

  bindScopedListener(scope, receiptEmailBtn, 'click', async () => {
    if (!lastOrderData) return;
    await sendReceiptEmail(lastOrderData, { trigger: 'manual' });
  }, {}, 'receipt:email-send');

  logListenerStats('cart');
}


// ===============================
// CHECKOUT + SUPABASE
// ===============================
async function submitOrder(eventOrForm) {
  if (eventOrForm?.preventDefault) eventOrForm.preventDefault();

  if (orderSubmitBusy || window.__dpasoSubmitting) {
    appRuntime.checkoutDuplicateSubmitBlocked += 1;
    debugLog(`🛡️ Checkout duplicate submit bloqueado #${appRuntime.checkoutDuplicateSubmitBlocked}`);
    return;
  }

  appRuntime.checkoutSubmitCounter += 1;
  debugLog(`🧾 submitOrder intento #${appRuntime.checkoutSubmitCounter}`);

  const form = eventOrForm?.currentTarget || eventOrForm;
  const submitBtn = document.getElementById('confirm-order-btn');
  if (!form || !(form instanceof HTMLFormElement)) return;

  const whatsappBtn = document.getElementById('whatsapp-order-btn');

  orderSubmitBusy = true;
  window.__dpasoSubmitting = true;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Procesando...';

  let rpcPayload = null;
  let orderId = null;

  try {
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

    await withTimeout(
      refreshCartAvailability({ showPriceChangeToast: true }),
      7000,
      'No se pudo validar disponibilidad del carrito a tiempo.'
    );

  const formData = new FormData(form);
  const unavailableItems = getUnavailableCartItems();
  if (unavailableItems.length > 0) {
    showFeedback('Algunos productos ya no están disponibles, elimínalos del carrito.', 'error');
    renderCartModal();
    return;
  }

  const normalizedModalidad = normalizeModalidad(formData.get('modalidad'));
  const totals = getCheckoutTotals(normalizedModalidad);

  const customerName = collapseSpaces(formData.get('nombre') || '');
  const phoneRaw = String(formData.get('telefono') || '').trim();
  const addressRaw = String(formData.get('direccion') || '').trim();
  const referenciaRaw = String(formData.get('referencia') || '').trim();
  const comentarioRaw = String(formData.get('comentario') || '').trim();
  const emailRaw = normalizeEmail(formData.get('email') || '');
  const sessionUser = (await supabaseClient.auth.getSession())?.data?.session?.user || null;
  const orderForOther = Boolean(sessionUser?.id) && Boolean(document.getElementById('checkout-for-other')?.checked);


  if (!customerName || !phoneRaw) {
    showFeedback('Nombre y teléfono son obligatorios.', 'error');
    return;
  }

  if (!PERSON_NAME_REGEX.test(customerName)) {
    showFeedback('Ingresa un nombre válido (mínimo 2 caracteres).', 'error');
    return;
  }

  const telefonoLimpio = phoneRaw.replace(/\D/g, '');
  if (!/^\d{9}$/.test(telefonoLimpio)) {
    showFeedback('El teléfono debe tener exactamente 9 dígitos numéricos.', 'error');
    return;
  }

  if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    showFeedback('Ingresa un correo válido para enviar el comprobante.', 'error');
    return;
  }

  if (normalizedModalidad === 'Delivery' && !addressRaw) {
    showFeedback('La dirección es obligatoria para pedidos Delivery.', 'error');
    return;
  }

  const storeInfo = getStoreOpenInfo();
  if (!storeInfo.isOpen) {
    showFeedback(storeInfo.reason || 'Fuera de horario', 'error');
    return;
  }

  if (normalizedModalidad === 'Delivery') {
    if (!totals.hasZonesAvailable) {
      showFeedback('Delivery no disponible por ahora. Selecciona Recojo.', 'error');
      return;
    }

    if (!totals.hasZoneSelected) {
      showFeedback('Selecciona provincia y distrito para delivery.', 'error');
      return;
    }

    if (!totals.hasCoverage) {
      showFeedback('No hay cobertura para la zona seleccionada.', 'error');
      return;
    }
  }

  if (!Number.isFinite(totals.totalFinal)) {
    showFeedback('No se pudo calcular el total. Revisa tu carrito.', 'error');
    console.error('❌ Total inválido para create_order payload:', {
      subtotal: totals.subtotal,
      deliveryFee: totals.deliveryFee,
      totalFinal: totals.totalFinal
    });
    return;
  }

  const normalizedItems = cart.map((item) => {
    const precio = Number(item.precio);
    const qty = Number(item.cantidad);
    return {
      plato_id: item.id,
      nombre: item.nombre,
      precio,
      qty,
      subtotal: precio * qty
    };
  });

  const hasInvalidItem = normalizedItems.some((item) => {
    return !Number.isFinite(item.precio)
      || !Number.isFinite(item.qty)
      || item.qty <= 0
      || item.precio < 0
      || !Number.isFinite(item.subtotal);
  });

  if (hasInvalidItem) {
    showFeedback('Hay un item inválido en tu carrito. Actualiza e intenta de nuevo.', 'error');
    console.error('❌ Items inválidos para create_order:', normalizedItems);
    return;
  }

  rpcPayload = {
    customer: {
      name: customerName,
      phone: telefonoLimpio,
      modalidad: normalizedModalidad,
      address: addressRaw || null,
      referencia: referenciaRaw || null,
      for_other: orderForOther,
      provincia: normalizedModalidad === 'Delivery' ? (totals.provincia || null) : null,
      distrito: normalizedModalidad === 'Delivery' ? (totals.distrito || null) : null,
      email: emailRaw || null
    },
    comment: comentarioRaw || null,
    items: normalizedItems.map((item) => ({
      plato_id: item.plato_id,
      nombre: item.nombre,
      precio: item.precio,
      qty: item.qty
    })),
    totals: {
      subtotal: totals.subtotal,
      delivery_fee: normalizedModalidad === 'Delivery' ? totals.deliveryFee : 0,
      total: totals.totalFinal
    }
  };

  let shortId = '';
  let shortCode = '';
  let createdAt = null;

    submitBtn.textContent = 'Creando pedido...';

    debugLog('📦 Payload RPC create_order:', getSafeOrderPayloadForLogs(rpcPayload));

    const rpcStartedAt = performance.now();

    const callCreateOrder = async (client) => withTimeout(
      client.rpc('create_order', { payload: rpcPayload }),
      15000,
      'La creación del pedido tardó demasiado. Intenta de nuevo.'
    );

    const { data: orderSessionData } = await supabaseClient.auth.getSession();
    const orderUser = orderSessionData?.session?.user || null;
    const isGoogleSession = orderUser?.app_metadata?.provider === 'google';

    let rpcResult = await callCreateOrder(supabaseClient);
    let rpcData = rpcResult?.data;
    let rpcError = rpcResult?.error;

    if (rpcError) {
      const msg = String(rpcError?.message || '');

      if (isGoogleSession && !msg.includes('PHONE_ALREADY_LINKED')) {
        // Reintento para sesiones OAuth que pueden tener latencia de token al volver del proveedor.
        const retryResult = await callCreateOrder(supabaseClient);
        rpcData = retryResult?.data;
        rpcError = retryResult?.error;
      }

      const finalMsg = String(rpcError?.message || '');
      if (finalMsg.includes('PHONE_ALREADY_LINKED')) {
        const guestResult = await callCreateOrder(guestSupabaseClient);
        rpcData = guestResult?.data;
        rpcError = guestResult?.error;
      }
    }

    const rpcMs = Math.round(performance.now() - rpcStartedAt);

    reportOperationalMetric('checkout_rpc_result', {
      success: !rpcError,
      rpc_ms: rpcMs,
      modalidad: normalizedModalidad
    }).catch((metricError) => {
      logSupabaseError('⚠️ No se pudo reportar métrica checkout_rpc_result:', metricError);
    });

    if (rpcError) throw rpcError;

    orderId = rpcData?.order_id || null;
    shortId = String(rpcData?.short_id || '');
    shortCode = String(rpcData?.short_code || shortId || '');
    createdAt = rpcData?.created_at || null;

    if (!orderId) throw new Error('No se pudo obtener order_id desde create_order.');

    const receiptEmail = emailRaw || normalizeEmail(appRuntime.lastAuthEmail || '');
    const receiptToken = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    if (receiptEmail) {
      const { error: receiptDataError } = await withTimeout(
        supabaseClient.rpc('set_order_receipt_data', {
          p_order_id: orderId,
          p_email: receiptEmail,
          p_token: receiptToken
        }),
        8000,
        'No se pudo guardar token de comprobante a tiempo.'
      );
      if (receiptDataError) throw receiptDataError;
    }

    lastOrderData = {
      id: orderId,
      short_id: shortId || getShortOrderId(orderId),
      short_code: shortCode || shortId || getShortOrderId(orderId),
      nombre_cliente: customerName,
      telefono: telefonoLimpio,
      modalidad: normalizedModalidad,
      direccion: addressRaw,
      referencia: referenciaRaw,
      comentario: comentarioRaw,
      email: emailRaw || appRuntime.lastAuthEmail || '',
      receipt_token: receiptEmail ? receiptToken : '',
      total: totals.totalFinal,
      created_at: createdAt,
      subtotal: totals.subtotal,
      delivery_fee: totals.deliveryFee,
      provincia: totals.provincia,
      distrito: totals.distrito,
      items: normalizedItems.map(i => ({
        nombre: i.nombre,
        precio: i.precio,
        cantidad: i.qty,
        subtotal: i.subtotal
      }))
    };

    lastOrderCode = lastOrderData.short_code || lastOrderData.short_id;
    saveLastTrackingCode(lastOrderCode);

    if (receiptEmail) {
      showFeedback(`✅ Pedido creado (#${lastOrderData.short_id}). Enviaremos boleta/factura al correo ${receiptEmail}.`, 'success');
    } else {
      showFeedback(`✅ Pedido creado (#${lastOrderData.short_id}). Tu comprobante está listo.`, 'success');
    }
    showCartToast('Pedido enviado', 2400);
    renderReceipt(lastOrderData);
    closeCartModal();
    openReceiptModal();

    if (whatsappBtn && lastOrderData) {
      whatsappBtn.href = buildWhatsAppMessage(lastOrderData);
      whatsappBtn.style.display = 'inline-flex';
    }

    clearCartAndForm();
  } catch (error) {
    reportCriticalError('checkout_error', 'submitOrder', error, {
      cart_items: cart.length
    }).catch((reportError) => {
      logSupabaseError('⚠️ No se pudo reportar checkout_error:', reportError);
    });

    console.error('❌ Error creando pedido vía RPC:', error, {
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
      orderId,
      payload: getSafeOrderPayloadForLogs(rpcPayload)
    });
    const errorMessage = String(error?.message || '');
    if (errorMessage.includes('PHONE_ALREADY_LINKED')) {
      showFeedback('No se pudo procesar con ese teléfono. Si compras para otra persona, marca la opción correspondiente.', 'error');
    } else if (errorMessage.includes('OUT_OF_STOCK') || errorMessage.includes('NOT_AVAILABLE')) {
      showFeedback('Algunos productos ya no están disponibles, elimínalos del carrito.', 'error');
      await cargarMenu();
    } else {
      showFeedback('No se pudo crear el pedido por red/servidor. Reintenta: tu carrito se mantiene y no se duplicará el envío.', 'error');
    }
  } finally {
    orderSubmitBusy = false;
    window.__dpasoSubmitting = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirmar pedido';
    updateCartTotalsAndAvailability();
  }
}

// ===============================
// CARGAR MENÚ Y NAVBAR
// ===============================
async function cargarMenu() {
  const menu = document.getElementById('menu');
  const nav = document.querySelector('.nav');
  const searchInput = document.getElementById('menu-search');
  if (!menu || !nav) return;

  try {
    const { data: platosData, error: platosError } = await supabaseClient
      .from('platos')
      .select('id,nombre,descripcion,precio,imagen,categoria_id,orden,is_available,track_stock,stock')
      .order('orden', { ascending: true });

    if (platosError) throw platosError;

    const { data: categoriasData, error: categoriasError } = await supabaseClient
      .from('categorias')
      .select('*')
      .order('orden', { ascending: true });

    if (categoriasError) throw categoriasError;

    platosState = new Map((platosData || []).map((p) => [p.id, p]));

    Array.from(document.querySelectorAll('.category-row')).forEach((row) => row.__destroyCarousel?.());
    menu.innerHTML = '';
    nav.innerHTML = '';

    const query = String(searchInput?.value || '').trim().toLowerCase();

    categoriasData.forEach((cat) => {
      const items = (platosData || []).filter((p) => p.categoria_id === cat.id)
        .filter((p) => !query || String(p.nombre || '').toLowerCase().includes(query) || String(p.descripcion || '').toLowerCase().includes(query));

      if (!items.length && query) return;

      const navLink = document.createElement('a');
      navLink.href = `#${cat.id}`;
      navLink.textContent = cat.nombre;
      nav.appendChild(navLink);

      const sectionWrap = document.createElement('section');
      sectionWrap.className = 'category-section fade-up';
      sectionWrap.id = cat.id;

      const h2 = document.createElement('h2');
      h2.className = 'section-title';
      h2.textContent = cat.nombre;
      sectionWrap.appendChild(h2);

      if (!items.length) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'plato';
        emptyDiv.innerHTML = '<p>No hay platos en esta categoría.</p>';
        sectionWrap.appendChild(emptyDiv);
        menu.appendChild(sectionWrap);
        return;
      }

      const row = document.createElement('div');
      row.className = 'category-row';
      row.innerHTML = `<div class="carousel-viewport"><div class="carousel-track"></div></div>`;

      const track = row.querySelector('.carousel-track');

      items.forEach((item) => {
        const soldOut = isPlatoSoldOut(item);
        const availabilityMessage = item?.is_available === false ? 'No disponible por el momento' : 'Agotado por stock';
        const imageUrl = item.imagen
          ? `${SUPABASE_URL}/storage/v1/object/public/platos/${item.imagen}`
          : 'images/Logos/logo.jpg';

        const card = document.createElement('article');
        card.className = 'plato';
        card.innerHTML = `
          <img src="${imageUrl}" alt="${item.nombre}">
          <h3>${item.nombre}</h3>
          <p>${item.descripcion || ''}</p>
          <span>${formatCurrency(item.precio)}</span>
          <div class="plato-action">${soldOut ? `<div class="plato-unavailable" aria-live="polite">${availabilityMessage}</div>` : `<button type="button" class="add-cart-btn" data-item-id="${item.id}">+ Agregar</button>`}</div>
        `;
        track.appendChild(card);
      });

      track.addEventListener('click', (event) => {
        const btn = event.target.closest('.add-cart-btn');
        if (!btn) return;
        const itemId = btn.dataset.itemId;
        const item = items.find((it) => String(it.id) === String(itemId));
        if (!item || isPlatoSoldOut(item)) return;

        const imageUrl = item.imagen
          ? `${SUPABASE_URL}/storage/v1/object/public/platos/${item.imagen}`
          : 'images/Logos/logo.jpg';

        addToCart({ id: item.id, nombre: item.nombre, precio: item.precio, imagen: imageUrl });
        showCartToast(`✅ ${item.nombre} agregado al carrito`);
      });

      initInfiniteCarousel(row);
      sectionWrap.appendChild(row);
      menu.appendChild(sectionWrap);
    });

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('show');
        observer.unobserve(e.target);
      });
    }, { threshold: 0.15 });

    const renderedSections = menu.querySelectorAll('.category-section').length;
    if (query && renderedSections === 0) {
      menu.innerHTML = '<p style="padding:12px;color:#475569;">No encontramos platos para esa búsqueda.</p>';
      nav.innerHTML = '';
      return;
    }

    document.querySelectorAll('.fade-up').forEach((el) => observer.observe(el));
    setupCategoryActiveNav();

    if (searchInput && !searchInput.dataset.boundInput) {
      searchInput.addEventListener('input', () => cargarMenu());
      searchInput.dataset.boundInput = '1';
    }
  } catch (err) {
    console.error('❌ Error cargando menú:', err);
    menu.innerHTML = '<p>Error cargando el menú. Revisa la consola.</p>';
  }
}

function setupCategoryActiveNav() {
  if (categoryObserver) {
    categoryObserver.disconnect();
    categoryObserver = null;
  }

  const links = Array.from(document.querySelectorAll('.nav a'));
  if (!links.length) return;

  const linkMap = new Map();
  links.forEach((link) => {
    const id = String(link.getAttribute('href') || '').replace('#', '');
    if (id) linkMap.set(id, link);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      activeNavLockUntil = Date.now() + 1400;
      links.forEach((l) => l.classList.remove('active-category'));
      link.classList.add('active-category');

      const target = document.getElementById(id);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  const sections = Array.from(document.querySelectorAll('.category-section'));
  const io = new IntersectionObserver((entries) => {
    if (Date.now() < activeNavLockUntil) return;
    const visible = entries
      .filter((e) => e.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

    if (!visible) return;
    const id = visible.target.id;
    if (!id) return;

    links.forEach((l) => l.classList.remove('active-category'));
    linkMap.get(id)?.classList.add('active-category');
  }, {
    root: null,
    threshold: [0.25, 0.5, 0.75],
    rootMargin: '-80px 0px -55% 0px'
  });

  sections.forEach((section) => io.observe(section));
  links[0]?.classList.add('active-category');
  categoryObserver = io;
}

function initInfiniteCarousel(row) {
  const track = row.querySelector('.carousel-track');
  const viewport = row.querySelector('.carousel-viewport');
  if (!track || !viewport) return;

  const originals = Array.from(track.children);
  if (originals.length <= 1) return;

  let baseWidth = 0;
  let enabled = false;
  let paused = false;
  let dragging = false;
  let moved = false;
  let rafId = 0;
  let lastTs = 0;
  let resumeTimer = 0;
  let visible = true;
  const speedPxPerMs = 0.045;

  let startX = 0;
  let startY = 0;
  let startScroll = 0;

  const setPause = (value, withDelay = false) => {
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      resumeTimer = 0;
    }

    if (value) {
      paused = true;
      return;
    }

    if (!withDelay) {
      paused = false;
      return;
    }

    resumeTimer = window.setTimeout(() => {
      paused = false;
      resumeTimer = 0;
    }, 550);
  };

  const resetToLoop = () => {
    if (!enabled || baseWidth <= 0) return;
    if (viewport.scrollLeft >= baseWidth) viewport.scrollLeft -= baseWidth;
    if (viewport.scrollLeft < 0) viewport.scrollLeft += baseWidth;
  };

  const frame = (ts) => {
    if (!lastTs) lastTs = ts;
    const dt = ts - lastTs;
    lastTs = ts;

    if (enabled && visible && !paused && !dragging) {
      viewport.scrollLeft += speedPxPerMs * dt;
      resetToLoop();
    }

    rafId = requestAnimationFrame(frame);
  };

  const recalc = () => {
    // cleanup duplicated children then re-clone if needed
    while (track.children.length > originals.length) track.removeChild(track.lastChild);

    const widths = originals.reduce((acc, node) => acc + node.getBoundingClientRect().width, 0);
    baseWidth = widths + (originals.length - 1) * 14;

    const hasOverflow = baseWidth > viewport.clientWidth + 6;
    enabled = hasOverflow;

    if (enabled) {
      originals.forEach((node) => track.appendChild(node.cloneNode(true)));
      if (viewport.scrollLeft >= baseWidth || viewport.scrollLeft <= 0) {
        viewport.scrollLeft = Math.max(1, viewport.scrollLeft % baseWidth);
      }
    } else {
      viewport.scrollLeft = 0;
    }
  };

  const ro = new ResizeObserver(() => {
    recalc();
  });
  ro.observe(viewport);

  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
  }, { threshold: 0.1 });
  io.observe(row);

  const dragThreshold = 10;

  viewport.addEventListener('pointerdown', (event) => {
    if (!enabled || event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button, a, input, textarea, select, label')) return;
    dragging = true;
    moved = false;
    setPause(true);
    startX = event.clientX;
    startY = event.clientY;
    startScroll = viewport.scrollLeft;
    viewport.setPointerCapture?.(event.pointerId);
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!dragging || !enabled) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!moved && (Math.abs(dx) < dragThreshold || Math.abs(dx) <= Math.abs(dy))) return;

    moved = true;
    viewport.scrollLeft = startScroll - dx;
    resetToLoop();
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    setPause(false, true);
  };

  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
  viewport.addEventListener('pointerleave', endDrag);

  viewport.addEventListener('click', (event) => {
    if (!moved) return;
    event.preventDefault();
    event.stopPropagation();
    moved = false;
  }, true);

  row.addEventListener('mouseenter', () => setPause(true));
  row.addEventListener('mouseleave', () => setPause(false, true));

  recalc();
  rafId = requestAnimationFrame(frame);

  row.__destroyCarousel = () => {
    if (resumeTimer) clearTimeout(resumeTimer);
    cancelAnimationFrame(rafId);
    ro.disconnect();
    io.disconnect();
  };
}

// ===============================
// REFRESH MANUAL PARA FRONT
// ===============================
window.refreshMenu = async function () {
  await cargarMenu();
};

function setupCheckoutSubmitDelegation() {
  const scope = getOrCreateListenerScope('checkout-submit');

  bindScopedListener(scope, document, 'click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const submitBtn = target.closest('[data-action="submit-order"]');
    if (!submitBtn) return;

    event.preventDefault();
    const form = document.getElementById('checkout-form');
    if (!form) return;
    submitOrder(form);
  }, {}, 'checkout:submit-click');

  bindScopedListener(scope, document.getElementById('checkout-form'), 'submit', (event) => {
    event.preventDefault();
    submitOrder(event.currentTarget);
  }, {}, 'checkout:submit-form');

  logListenerStats('checkout-submit');
}


function showAuthFeedback(message = '', type = 'info') {
  const feedback = document.getElementById('auth-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `checkout-feedback ${type}`;
}

function showProfileFeedback(message = '', type = 'info') {
  const feedback = document.getElementById('profile-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `checkout-feedback ${type}`;
}


function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

const EMAIL_ACTION_COOLDOWN_MS = 60000;

function getEmailCooldownRemainingMs(action = '') {
  const until = Number(appRuntime.emailCooldownUntil?.[action] || 0);
  return Math.max(0, until - Date.now());
}

function isEmailActionCoolingDown(action = '') {
  return getEmailCooldownRemainingMs(action) > 0;
}

function getFriendlyCooldownSeconds(action = '') {
  return Math.max(1, Math.ceil(getEmailCooldownRemainingMs(action) / 1000));
}

function renderEmailActionCooldown(action = '') {
  if (action === 'register') {
    const submitBtn = document.getElementById('auth-submit-btn');
    if (!submitBtn || appRuntime.authMode !== 'register') return;
    const coolingDown = isEmailActionCoolingDown('register');
    if (coolingDown) {
      submitBtn.disabled = true;
      submitBtn.textContent = `Reintenta en ${getFriendlyCooldownSeconds('register')}s`;
      return;
    }
    if (!appRuntime.authBusy) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Crear cuenta';
    }
    return;
  }

  if (action === 'forgot') {
    const input = document.getElementById('password-email');
    const submitBtn = document.getElementById('password-submit-btn');
    if (!submitBtn) return;
    const email = normalizeEmail(input?.value || '');
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const coolingDown = isEmailActionCoolingDown('forgot');
    if (coolingDown) {
      submitBtn.disabled = true;
      submitBtn.textContent = `Reintenta en ${getFriendlyCooldownSeconds('forgot')}s`;
      return;
    }
    submitBtn.disabled = !validEmail || Boolean(appRuntime.recoveryBusy);
    if (!appRuntime.recoveryBusy) submitBtn.textContent = 'Enviar enlace';
  }
}

function startEmailActionCooldown(action = '', durationMs = EMAIL_ACTION_COOLDOWN_MS) {
  if (!action) return;
  appRuntime.emailCooldownUntil[action] = Date.now() + durationMs;
  if (appRuntime.emailCooldownTimers[action]) clearInterval(appRuntime.emailCooldownTimers[action]);
  renderEmailActionCooldown(action);
  appRuntime.emailCooldownTimers[action] = setInterval(() => {
    const remaining = getEmailCooldownRemainingMs(action);
    if (remaining <= 0) {
      clearInterval(appRuntime.emailCooldownTimers[action]);
      delete appRuntime.emailCooldownTimers[action];
      renderEmailActionCooldown(action);
      return;
    }
    renderEmailActionCooldown(action);
  }, 1000);
}

function isRateLimitAuthError(error) {
  const message = String(error?.message || '').toLowerCase();
  const status = Number(error?.status || 0);
  return status === 429 || message.includes('email rate limit exceeded') || message.includes('rate limit');
}

function getFriendlyAuthError(error, context = 'login') {
  const message = String(error?.message || '').toLowerCase();
  const description = String(error?.error_description || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  const status = Number(error?.status || 0);

  if (context === 'register') {
    if (
      message.includes('user already registered')
      || message.includes('already registered')
      || message.includes('already exists')
      || description.includes('already registered')
      || code === 'user_already_exists'
      || status === 422
    ) {
      return 'Este correo ya está registrado.';
    }
  }

  if (context === 'login') {
    if (message.includes('user not found') || message.includes('not found')) {
      return 'Credenciales inválidas.';
    }
    if (status === 400 && message.includes('invalid login credentials')) {
      return 'Credenciales inválidas.';
    }
    if (message.includes('invalid password')) {
      return 'Credenciales inválidas.';
    }
    if (message.includes('email not confirmed')) {
      return 'Debes confirmar tu correo antes de iniciar sesión.';
    }
  }

  if (context === 'register') return 'No se pudo crear la cuenta. Intenta nuevamente.';
  if (context === 'login') return 'No se pudo iniciar sesión. Intenta nuevamente.';
  return 'No se pudo procesar la autenticación.';
}

function setAuthEmailValue(email = '', { force = false } = {}) {
  const normalizedEmail = normalizeEmail(email);
  const loginEmailInput = document.getElementById('auth-email-login');
  const registerEmailInput = document.getElementById('auth-email-register');
  const targetInput = appRuntime.authMode === 'register' ? registerEmailInput : loginEmailInput;

  if (!targetInput) return;
  if (!force && targetInput.dataset.userEdited === '1') return;
  if (!force && document.activeElement === targetInput) return;
  if (!force && targetInput.value.trim()) return;
  targetInput.value = normalizedEmail;
}


function collapseSpaces(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeCustomerIdentityPayload(payload = {}) {
  const firstName = collapseSpaces(payload.firstName || '');
  const lastName = collapseSpaces(payload.lastName || '');
  const phone = String(payload.phone || '').replace(/\D+/g, '').slice(0, 9);
  const dni = String(payload.dni || '').replace(/\D+/g, '').slice(0, 8);
  const email = normalizeEmail(payload.email || '');
  return { firstName, lastName, phone, dni, email };
}

const PERSON_NAME_REGEX = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü' -]{2,}$/;

function ensureAuthFieldErrorNodes() {
  const ids = [
    'auth-first-name',
    'auth-last-name',
    'auth-phone',
    'auth-dni',
    'auth-email-login',
    'auth-password-login',
    'auth-email-register',
    'auth-password-register',
    'auth-confirm-password'
  ];

  ids.forEach((id) => {
    const input = document.getElementById(id);
    if (!input || !input.parentElement) return;
    const existing = input.parentElement.querySelector(`.auth-field-error[data-for="${id}"]`);
    if (existing) return;
    const node = document.createElement('small');
    node.className = 'auth-field-error';
    node.dataset.for = id;
    input.insertAdjacentElement('afterend', node);
  });
}

function setAuthFieldError(fieldId, message = '') {
  const input = document.getElementById(fieldId);
  const container = input?.parentElement;
  const node = container?.querySelector(`.auth-field-error[data-for="${fieldId}"]`);
  if (node) node.textContent = message;
  if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function clearAuthFieldErrors() {
  document.querySelectorAll('.auth-field-error').forEach((node) => { node.textContent = ''; });
  document.querySelectorAll('#auth-form [aria-invalid="true"]').forEach((node) => node.setAttribute('aria-invalid', 'false'));
}

function ensureProfileFieldErrorNodes() {
  const ids = ['profile-first-name', 'profile-last-name', 'profile-phone', 'profile-dni'];
  ids.forEach((id) => {
    const input = document.getElementById(id);
    if (!input || !input.parentElement) return;
    const existing = input.parentElement.querySelector(`.auth-field-error[data-for="${id}"]`);
    if (existing) return;
    const node = document.createElement('small');
    node.className = 'auth-field-error';
    node.dataset.for = id;
    input.insertAdjacentElement('afterend', node);
  });
}

function setProfileFieldError(fieldId, message = '') {
  const input = document.getElementById(fieldId);
  const container = input?.parentElement;
  const node = container?.querySelector(`.auth-field-error[data-for="${fieldId}"]`);
  if (node) node.textContent = message;
  if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function clearProfileFieldErrors() {
  document.querySelectorAll('#profile-form .auth-field-error').forEach((node) => { node.textContent = ''; });
  document.querySelectorAll('#profile-form [aria-invalid="true"]').forEach((node) => node.setAttribute('aria-invalid', 'false'));
}

function validateProfileForm({ firstName, lastName, phone, dni }) {
  const errors = {};
  if (!firstName) errors.firstName = 'Ingresa tus nombres.';
  else if (!PERSON_NAME_REGEX.test(firstName)) errors.firstName = 'Nombres inválidos.';

  if (!lastName) errors.lastName = 'Ingresa tus apellidos.';
  else if (!PERSON_NAME_REGEX.test(lastName)) errors.lastName = 'Apellidos inválidos.';

  if (!phone) errors.phone = 'Ingresa tu teléfono.';
  else if (!/^\d{9}$/.test(phone)) errors.phone = 'El teléfono debe tener 9 dígitos.';

  if (!dni) errors.dni = 'Ingresa tu DNI.';
  else if (!/^\d{8}$/.test(dni)) errors.dni = 'El DNI debe tener 8 dígitos.';
  else if (dni === '00000000') errors.dni = 'El DNI ingresado no es válido.';

  return errors;
}

function validateLoginForm({ email, password }) {
  const errors = {};
  if (!email) errors.email = 'Ingresa tu correo.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Correo inválido.';

  if (!password) errors.password = 'Ingresa tu contraseña.';
  return errors;
}

function validateRegisterForm({ firstName, lastName, phone, dni, email, password, confirmPassword }) {
  const errors = {};

  if (!firstName) errors.firstName = 'Ingresa tus nombres.';
  else if (!PERSON_NAME_REGEX.test(firstName)) errors.firstName = 'Nombres inválidos.';

  if (!lastName) errors.lastName = 'Ingresa tus apellidos.';
  else if (!PERSON_NAME_REGEX.test(lastName)) errors.lastName = 'Apellidos inválidos.';

  if (!phone) errors.phone = 'Ingresa tu teléfono.';
  else if (!/^\d{9}$/.test(phone)) errors.phone = 'El teléfono debe tener 9 dígitos.';

  if (!dni) errors.dni = 'Ingresa tu DNI.';
  else if (!/^\d{8}$/.test(dni)) errors.dni = 'El DNI debe tener 8 dígitos.';
  else if (dni === '00000000') errors.dni = 'El DNI ingresado no es válido.';

  if (!email) errors.email = 'Ingresa tu correo.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Correo inválido.';

  if (!password) errors.password = 'Ingresa una contraseña.';
  else if (password.length < 8) errors.password = 'La contraseña debe tener mínimo 8 caracteres.';
  else if (!/[A-Z]/.test(password)) errors.password = 'La contraseña debe incluir al menos 1 mayúscula.';
  else if (!/[a-z]/.test(password)) errors.password = 'La contraseña debe incluir al menos 1 minúscula.';
  else if (!/[0-9]/.test(password)) errors.password = 'La contraseña debe incluir al menos 1 número.';
  else if (!/[\W_]/.test(password)) errors.password = 'La contraseña debe incluir al menos 1 carácter especial.';

  if (!confirmPassword) errors.confirmPassword = 'Confirma tu contraseña.';
  else if (confirmPassword !== password) errors.confirmPassword = 'Las contraseñas no coinciden.';

  return errors;
}

function renderAuthValidationErrors(errors = {}, mode = 'login') {
  clearAuthFieldErrors();
  if (mode === 'login') {
    setAuthFieldError('auth-email-login', errors.email || '');
    setAuthFieldError('auth-password-login', errors.password || '');
    return;
  }

  setAuthFieldError('auth-first-name', errors.firstName || '');
  setAuthFieldError('auth-last-name', errors.lastName || '');
  setAuthFieldError('auth-phone', errors.phone || '');
  setAuthFieldError('auth-dni', errors.dni || '');
  setAuthFieldError('auth-email-register', errors.email || '');
  setAuthFieldError('auth-password-register', errors.password || '');
  setAuthFieldError('auth-confirm-password', errors.confirmPassword || '');
}


function updateRegisterPasswordRules(password = '') {
  const rules = {
    len: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[\W_]/.test(password)
  };

  const list = document.getElementById('auth-password-rules');
  const status = document.getElementById('auth-password-status');
  if (list) {
    list.querySelectorAll('li[data-rule]').forEach((li) => {
      const key = li.getAttribute('data-rule') || '';
      li.classList.toggle('ok', Boolean(rules[key]));
    });
  }

  if (status) {
    const complete = Object.values(rules).every(Boolean);
    status.textContent = complete ? 'Contraseña válida.' : 'Validando contraseña...';
    status.style.color = complete ? '#15803d' : '#64748b';
  }
}


function withTimeout(promise, ms = 12000, timeoutMessage = 'Tiempo de espera agotado') {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function logSupabaseError(prefix, error) {
  console.error(prefix, {
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
    code: error?.code
  });
}

function getFriendlyCustomerSyncError(error) {
  const message = String(error?.message || '').toUpperCase();
  if (message.includes('PHONE_ALREADY_USED')) return 'El teléfono ya está asociado a otra cuenta.';
  if (message.includes('DNI_ALREADY_USED')) return 'El DNI ya está asociado a otra cuenta.';
  if (message.includes('EMAIL_ALREADY_USED')) return 'El correo ya está asociado a otra cuenta.';
  return 'No se pudo sincronizar tu perfil en este momento.';
}

function setAuthMode(mode = 'login') {
  const normalized = mode === 'register' ? 'register' : 'login';
  appRuntime.authMode = normalized;

  const title = document.getElementById('auth-modal-title');
  const subtitle = document.getElementById('auth-modal-subtitle');
  const submitBtn = document.getElementById('auth-submit-btn');
  const tabLogin = document.getElementById('auth-tab-login');
  const tabRegister = document.getElementById('auth-tab-register');
  const forgotBtn = document.getElementById('auth-forgot-btn');
  const registerNote = document.getElementById('auth-register-note');

  const firstNameInput = document.getElementById('auth-first-name');
  const lastNameInput = document.getElementById('auth-last-name');
  const phoneInput = document.getElementById('auth-phone');
  const dniInput = document.getElementById('auth-dni');
  const confirmPasswordInput = document.getElementById('auth-confirm-password');
  const loginPasswordInput = document.getElementById('auth-password-login');
  const registerPasswordInput = document.getElementById('auth-password-register');
  const loginEmailInput = document.getElementById('auth-email-login');
  const registerEmailInput = document.getElementById('auth-email-register');

  const registerFields = document.querySelectorAll('.auth-only-register');
  const loginFields = document.querySelectorAll('.auth-only-login');

  if (title) title.textContent = 'Mi cuenta';
  if (subtitle) subtitle.textContent = 'Compra como invitado o ingresa para ver tu historial.';
  if (submitBtn) submitBtn.textContent = normalized === 'register' ? 'Crear cuenta' : 'Ingresar';

  if (tabLogin) tabLogin.classList.toggle('active', normalized === 'login');
  if (tabRegister) tabRegister.classList.toggle('active', normalized === 'register');

  registerFields.forEach((el) => el.classList.toggle('hidden', normalized !== 'register'));
  loginFields.forEach((el) => el.classList.toggle('hidden', normalized !== 'login'));

  if (firstNameInput) firstNameInput.required = normalized === 'register';
  if (lastNameInput) lastNameInput.required = normalized === 'register';
  if (phoneInput) phoneInput.required = normalized === 'register';
  if (dniInput) dniInput.required = normalized === 'register';
  if (confirmPasswordInput) confirmPasswordInput.required = normalized === 'register';
  if (loginEmailInput) loginEmailInput.required = normalized === 'login';
  if (registerEmailInput) registerEmailInput.required = normalized === 'register';
  if (loginPasswordInput) loginPasswordInput.required = normalized === 'login';
  if (registerPasswordInput) registerPasswordInput.required = normalized === 'register';

  if (loginPasswordInput) loginPasswordInput.setAttribute('autocomplete', 'current-password');
  if (registerPasswordInput) registerPasswordInput.setAttribute('autocomplete', 'new-password');
  if (confirmPasswordInput) confirmPasswordInput.setAttribute('autocomplete', normalized === 'register' ? 'new-password' : 'off');

  if (normalized !== 'register' && confirmPasswordInput) confirmPasswordInput.value = '';

  if (forgotBtn) forgotBtn.style.display = normalized === 'login' ? 'inline-block' : 'none';
  if (registerNote) registerNote.style.display = normalized === 'register' ? 'block' : 'none';

  ensureAuthFieldErrorNodes();
  updateRegisterPasswordRules(String(document.getElementById('auth-password-register')?.value || ''));
  renderEmailActionCooldown('register');
  showAuthFeedback('');
}

function openAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  const emailFromSession = normalizeEmail(appRuntime.lastAuthEmail || '');
  if (emailFromSession) setAuthEmailValue(emailFromSession);
  const focusId = appRuntime.authMode === 'register' ? 'auth-first-name' : 'auth-email-login';
  openModalSafe(modal, document.getElementById(focusId));
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  closeModalSafe(modal, getFallbackFocusElement('auth-account-btn', 'cart-float-btn'));
}

function openProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (!modal) return;
  openModalSafe(modal, document.getElementById('profile-first-name'));
}

function closeProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (!modal) return;
  closeModalSafe(modal, getFallbackFocusElement('auth-account-btn'));
}

function closeAccountDropdownMenu() {
  const dropdown = document.getElementById('auth-account-dropdown');
  const accountBtn = document.getElementById('auth-account-btn');
  if (!dropdown) return;
  dropdown.classList.remove('open');
  dropdown.setAttribute('aria-hidden', 'true');
  accountBtn?.setAttribute('aria-expanded', 'false');
}

async function getMyCustomerProfile() {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return null;

  try {
    const { data, error } = await withTimeout(
      supabaseClient.rpc('get_my_customer_profile'),
      8000,
      'Tiempo de espera agotado al consultar perfil.'
    );

    if (error) {
      const message = String(error?.message || '').toLowerCase();
      const missingRpc = message.includes('get_my_customer_profile') || String(error?.code || '') === 'PGRST202';
      if (!missingRpc) throw error;

      const fallback = await withTimeout(
        supabaseClient
          .from('customers')
          .select('id,name,phone,dni,email,avatar_path,user_id,auth_user_id,created_at,updated_at')
          .or(`user_id.eq.${userId},auth_user_id.eq.${userId}`)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        8000,
        'Tiempo de espera agotado al consultar customers.'
      );

      if (fallback.error) throw fallback.error;
      return fallback.data || null;
    }

    if (Array.isArray(data)) return data[0] || null;
    return data || null;
  } catch (error) {
    logSupabaseError('⚠️ No se pudo cargar get_my_customer_profile:', error);
    return null;
  }
}

async function syncCustomerProfileToCustomers(payload = {}) {
  try {
    const { error } = await withTimeout(
      supabaseClient.rpc('upsert_my_customer_profile', {
        p_name: payload.name || null,
        p_phone: payload.phone || null,
        p_dni: payload.dni || null,
        p_email: payload.email || null,
        p_avatar_path: payload.avatar_path || null
      }),
      9000,
      'La sincronización de customers tardó demasiado.'
    );

    if (error) throw error;
    return true;
  } catch (error) {
    logSupabaseError('⚠️ No se pudo sincronizar customers:', error);
    appRuntime.lastCustomerSyncError = getFriendlyCustomerSyncError(error);
    return false;
  }
}

async function cancelMyOrderByCode(shortCode = '') {
  const code = normalizeTrackingCode(shortCode);
  if (!code || appRuntime.orderCancelBusy) return false;

  appRuntime.orderCancelBusy = true;
  try {
    const { error } = await withTimeout(
      supabaseClient.rpc('cancel_my_order', { p_short_code: code }),
      9000,
      'No se pudo cancelar el pedido a tiempo.'
    );
    if (error) throw error;
    showCartToast(`Pedido ${code} cancelado`, 2500);
    return true;
  } catch (error) {
    logSupabaseError('⚠️ No se pudo cancelar pedido cliente:', error);
    showProfileFeedback('No se pudo cancelar el pedido. Intenta nuevamente.', 'error');
    return false;
  } finally {
    appRuntime.orderCancelBusy = false;
  }
}

async function loadProfileOrderDetail(shortCode = '') {
  const detail = document.getElementById('profile-order-detail');
  const code = normalizeTrackingCode(shortCode);
  if (!detail) return;
  if (!code) {
    detail.innerHTML = '<p class="tracking-muted">Selecciona un pedido para ver su detalle y estado.</p>';
    return;
  }

  detail.innerHTML = '<p class="tracking-muted">Cargando detalle...</p>';
  try {
    const { data, error } = await withTimeout(
      supabaseClient.rpc('get_order_status', { short_code: code }),
      9000,
      'No se pudo cargar el detalle del pedido a tiempo.'
    );
    if (error) throw error;

    const normalizedStatus = normalizeOrderStatus(data?.status);
    const canCancel = canCustomerCancelOrder(normalizedStatus);
    detail.innerHTML = `
      <div class="tracking-order-meta">
        <p><strong>Código:</strong> ${data?.short_code || code}</p>
        <p><strong>Estado:</strong> ${humanTrackingStatus(normalizedStatus)}</p>
        <p><strong>Modalidad:</strong> ${data?.modalidad || '-'}</p>
        <p><strong>Total:</strong> ${formatCurrency(data?.total || 0)}</p>
        <p><strong>Creado:</strong> ${formatTrackingDate(data?.created_at)}</p>
        <p><strong>Actualizado:</strong> ${formatTrackingDate(data?.updated_at)}</p>
      </div>
      ${canCancel ? `<button type="button" id="profile-cancel-order-btn" class="tracking-btn tracking-danger tracking-full">Cancelar pedido</button>` : ''}
      ${buildTrackingTimeline(normalizedStatus, data?.modalidad)}
    `;

    const cancelBtn = document.getElementById('profile-cancel-order-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', async () => {
        if (appRuntime.orderCancelBusy) return;
        const previousText = cancelBtn.textContent;
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Cancelando...';
        const ok = await cancelMyOrderByCode(code);
        cancelBtn.disabled = false;
        cancelBtn.textContent = previousText;
        if (ok) {
          await loadOrderHistory('profile-orders-list');
          await loadProfileOrderDetail(code);
        }
      }, { once: true });
    }
  } catch (error) {
    logSupabaseError('⚠️ No se pudo cargar detalle del pedido:', error);
    detail.innerHTML = '<p class="tracking-muted">No se pudo cargar el detalle del pedido.</p>';
  }
}

async function loadOrderHistory(targetId = 'profile-orders-list') {
  const list = document.getElementById(targetId);
  if (!list) return;
  list.innerHTML = '<p class="tracking-muted">Cargando historial...</p>';

  const { data: sessionData } = await supabaseClient.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) {
    list.innerHTML = '<p class="tracking-muted">Inicia sesión para ver tu historial.</p>';
    return;
  }

  try {
    let data = null;
    const { data: rpcData, error: rpcError } = await supabaseClient.rpc('get_my_orders');

    if (rpcError) {
      const isMissingRpc = String(rpcError?.message || '').includes('get_my_orders')
        || String(rpcError?.code || '') === 'PGRST202';

      if (!isMissingRpc) throw rpcError;

      const { data: fallbackData, error: fallbackError } = await supabaseClient
        .from('orders')
        .select('id,created_at,total,estado,short_code,modalidad')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (fallbackError) throw fallbackError;
      data = fallbackData;
    } else {
      data = rpcData;
    }

    if (!data || data.length === 0) {
      list.innerHTML = '<p class="tracking-muted">Aún no tienes pedidos.</p>';
      await loadProfileOrderDetail('');
      return;
    }

    list.innerHTML = data.map((order) => {
      const code = order.short_code || getShortOrderId(order.id);
      return `
      <article class="history-item">
        <button type="button" class="history-item-btn" data-order-code="${code}">
          <p><strong>${code}</strong> · ${humanTrackingStatus(order.estado ?? order.status)}</p>
          <p>${formatTrackingDate(order.created_at)} · ${order.modalidad || '-'}</p>
          <p><strong>${formatCurrency(order.total || 0)}</strong></p>
        </button>
      </article>
    `;
    }).join('');

    const firstCode = data[0]?.short_code || getShortOrderId(data[0]?.id);
    if (firstCode) {
      const firstBtn = list.querySelector('[data-order-code]');
      if (firstBtn) firstBtn.classList.add('active');
      await loadProfileOrderDetail(firstCode);
    }
  } catch (error) {
    await reportCriticalError('history_error', 'loadOrderHistory', error);
    list.innerHTML = '<p class="tracking-muted">No se pudo cargar el historial.</p>';
    await loadProfileOrderDetail('');
  }
}

function applyAuthUi(user = null, customerProfile = null) {
  const accountBtn = document.getElementById('auth-account-btn');
  const checkoutName = document.getElementById('checkout-nombre');
  const checkoutPhone = document.getElementById('checkout-telefono');
  const checkoutEmail = document.getElementById('checkout-email');

  if (accountBtn) accountBtn.textContent = user ? 'Mi cuenta' : 'Iniciar sesión / Registrarse';
  updateCheckoutIdentityControlsVisibility(user);

  appRuntime.lastAuthEmail = user?.email || '';

  const profileEmail = document.getElementById('profile-email');
  const profileEmailStatus = document.getElementById('profile-email-status');

  if (user) {
    const trustedCustomerProfile = customerProfile?.auth_user_id && customerProfile.auth_user_id === user.id
      ? customerProfile
      : null;
    const profileName = trustedCustomerProfile?.name || user.user_metadata?.name || '';
    const profilePhone = trustedCustomerProfile?.phone || user.user_metadata?.phone || '';
    if (profileEmail) profileEmail.value = user.email || '';
    if (profileEmailStatus) {
      profileEmailStatus.style.display = 'inline-flex';
      profileEmailStatus.textContent = user.email_confirmed_at ? 'Correo verificado' : 'Correo pendiente';
      profileEmailStatus.classList.toggle('pending', !user.email_confirmed_at);
    }
    appRuntime.checkoutProfileName = profileName || '';
    appRuntime.checkoutProfilePhone = profilePhone || '';
    if (checkoutEmail && user.email) checkoutEmail.value = normalizeEmail(user.email);
    const forOtherCheckbox = document.getElementById('checkout-for-other');
    if (!forOtherCheckbox?.checked) {
      if (checkoutName && profileName) checkoutName.value = profileName;
      if (checkoutPhone && profilePhone) checkoutPhone.value = profilePhone;
    }

    const [first = '', ...rest] = String(profileName).split(' ');
    const last = rest.join(' ');
    const profileFirst = trustedCustomerProfile?.name ? String(trustedCustomerProfile.name).split(' ')[0] : '';
    const profileLast = trustedCustomerProfile?.name ? String(trustedCustomerProfile.name).split(' ').slice(1).join(' ') : '';
    const setVal = (id, value) => {
      const node = document.getElementById(id);
      if (node) node.value = value || '';
    };
    setVal('profile-first-name', profileFirst || user.user_metadata?.first_name || first);
    setVal('profile-last-name', profileLast || user.user_metadata?.last_name || last);
    setVal('profile-phone', trustedCustomerProfile?.phone || profilePhone);
    setVal('profile-dni', trustedCustomerProfile?.dni || user.user_metadata?.dni || '');

    const avatarPreview = document.getElementById('profile-avatar-preview');
    const avatarPath = trustedCustomerProfile?.avatar_path || user.user_metadata?.avatar_path;
    if (avatarPreview && avatarPath) {
      const { data } = supabaseClient.storage.from('avatars').getPublicUrl(avatarPath);
      const avatarTs = Number(user.user_metadata?.avatar_updated_at || 0);
      if (data?.publicUrl) {
        const sep = data.publicUrl.includes('?') ? '&' : '?';
        avatarPreview.src = `${data.publicUrl}${sep}t=${avatarTs || Date.now()}`;
        avatarPreview.style.display = 'block';
      }
    }
  } else {
    appRuntime.checkoutProfileName = '';
    appRuntime.checkoutProfilePhone = '';
    if (checkoutEmail) checkoutEmail.value = '';
    if (profileEmail) profileEmail.value = '';
    if (profileEmailStatus) profileEmailStatus.style.display = 'none';
    const avatarPreview = document.getElementById('profile-avatar-preview');
    if (avatarPreview) {
      avatarPreview.removeAttribute('src');
      avatarPreview.style.display = 'none';
    }
  }
}

async function refreshAuthUi() {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  let user = sessionData?.session?.user || null;

  if (!user) {
    const { data } = await supabaseClient.auth.getUser();
    user = data?.user || null;
  }

  const customerProfile = user ? await getMyCustomerProfile() : null;
  applyAuthUi(user, customerProfile);
}

async function refreshAuthUiSafe(timeoutMs = 9000) {
  try {
    await withTimeout(
      refreshAuthUi(),
      timeoutMs,
      'No se pudo refrescar la sesión de perfil a tiempo.'
    );
  } catch (refreshError) {
    logSupabaseError('⚠️ No se pudo refrescar UI de auth a tiempo:', refreshError);
  }
}

function setupAuthEvents() {
  const scope = getOrCreateListenerScope('auth');

  const accountBtn = document.getElementById('auth-account-btn');
  const closeBtn = document.getElementById('auth-close-btn');
  const closeProfileBtn = document.getElementById('profile-close-btn');
  const tabLogin = document.getElementById('auth-tab-login');
  const tabRegister = document.getElementById('auth-tab-register');
  const forgotBtn = document.getElementById('auth-forgot-btn');
  const googleBtn = document.getElementById('auth-google-btn');
  const authForm = document.getElementById('auth-form');
  const authEmailLoginInput = document.getElementById('auth-email-login');
  const authEmailRegisterInput = document.getElementById('auth-email-register');
  const accountDropdown = document.getElementById('auth-account-dropdown');
  const accountOpenProfile = document.getElementById('account-open-profile');
  const accountOpenPassword = document.getElementById('account-open-password');
  const accountOpenOrders = document.getElementById('account-open-orders');
  const accountLogoutBtn = document.getElementById('account-logout-btn');
  const passwordModal = document.getElementById('password-modal');
  const passwordCloseBtn = document.getElementById('password-close-btn');
  const passwordForm = document.getElementById('password-form');
  const passwordEmailInput = document.getElementById('password-email');
  const passwordSubmitBtn = document.getElementById('password-submit-btn');
  const ordersModal = document.getElementById('orders-modal');
  const ordersCloseBtn = document.getElementById('orders-close-btn');

  const markEmailEdited = (input) => { if (input) input.dataset.userEdited = '1'; };
  bindScopedListener(scope, authEmailLoginInput, 'input', () => markEmailEdited(authEmailLoginInput), {}, 'auth:email-login-edited');
  bindScopedListener(scope, authEmailRegisterInput, 'input', () => markEmailEdited(authEmailRegisterInput), {}, 'auth:email-register-edited');

  bindScopedListener(scope, document.getElementById('auth-phone'), 'input', (event) => {
    const input = event.currentTarget;
    if (!input) return;
    input.value = String(input.value || '').replace(/\D+/g, '').slice(0, 9);
  }, {}, 'auth:register-phone-numeric');

  bindScopedListener(scope, document.getElementById('auth-dni'), 'input', (event) => {
    const input = event.currentTarget;
    if (!input) return;
    input.value = String(input.value || '').replace(/\D+/g, '').slice(0, 8);
  }, {}, 'auth:register-dni-numeric');

  bindScopedListener(scope, document.getElementById('auth-password-register'), 'input', (event) => {
    const input = event.currentTarget;
    updateRegisterPasswordRules(String(input?.value || ''));
  }, {}, 'auth:register-password-rules-live');

  const validateRecoveryEmail = () => {
    const email = normalizeEmail(passwordEmailInput?.value || '');
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (passwordSubmitBtn) {
      const coolingDown = isEmailActionCoolingDown('forgot');
      passwordSubmitBtn.disabled = !ok || Boolean(appRuntime.recoveryBusy) || coolingDown;
      if (coolingDown) passwordSubmitBtn.textContent = `Reintenta en ${getFriendlyCooldownSeconds('forgot')}s`;
      else if (!appRuntime.recoveryBusy) passwordSubmitBtn.textContent = 'Enviar enlace';
    }
    return { email, ok };
  };

  bindScopedListener(scope, passwordEmailInput, 'input', () => {
    if (passwordEmailInput) passwordEmailInput.value = normalizeEmail(passwordEmailInput.value || '');
    validateRecoveryEmail();
  }, {}, 'auth:password-email-input');

  function openAccountDropdown() {
    if (!accountDropdown) return;
    accountDropdown.classList.add('open');
    accountDropdown.setAttribute('aria-hidden', 'false');
    accountBtn?.setAttribute('aria-expanded', 'true');
  }

  function closeAccountDropdown() {
    closeAccountDropdownMenu();
  }

  function openPasswordModal() {
    closeAccountDropdown();
    openModalSafe(passwordModal, document.getElementById('password-email'));
  }

  function closePasswordModal() {
    closeModalSafe(passwordModal, getFallbackFocusElement('auth-account-btn'));
  }

  function openOrdersModal() {
    closeAccountDropdown();
    openModalSafe(ordersModal, ordersCloseBtn);
  }

  function closeOrdersModal() {
    closeModalSafe(ordersModal, getFallbackFocusElement('auth-account-btn'));
  }

  bindScopedListener(scope, accountBtn, 'click', async () => {
    const { data } = await supabaseClient.auth.getSession();
    const user = data?.session?.user || null;
    if (!user) {
      setAuthMode('login');
      openAuthModal();
      return;
    }
    if (accountDropdown?.classList.contains('open')) {
      closeAccountDropdownMenu();
    } else {
      openAccountDropdown();
    }
  }, {}, 'auth:account-btn');



  bindScopedListener(scope, accountOpenProfile, 'click', async () => {
    closeAccountDropdown();
    refreshAuthUiSafe(9000);
    openProfileModal();
  }, {}, 'auth:menu-profile');
  bindScopedListener(scope, accountOpenPassword, 'click', openPasswordModal, {}, 'auth:menu-password');
  bindScopedListener(scope, accountOpenOrders, 'click', async () => {
    openOrdersModal();
    await loadOrderHistory('profile-orders-list');
  }, {}, 'auth:menu-orders');

  bindScopedListener(scope, document.getElementById('profile-orders-list'), 'click', async (event) => {
    const btn = event.target instanceof Element ? event.target.closest('[data-order-code]') : null;
    if (!btn) return;

    const list = document.getElementById('profile-orders-list');
    list?.querySelectorAll('[data-order-code]').forEach((node) => node.classList.remove('active'));
    btn.classList.add('active');
    await loadProfileOrderDetail(btn.getAttribute('data-order-code') || '');
  }, {}, 'auth:orders-select-detail');

  bindScopedListener(scope, accountLogoutBtn, 'click', async () => {
    closeAccountDropdown();
    try {
      const { error } = await supabaseClient.auth.signOut({ scope: 'local' });
      if (error) throw error;
      appRuntime.lastAuthEvent = 'SIGNED_OUT';
      appRuntime.lastAuthUserId = null;
      appRuntime.profileSaveBusy = false;
      switchCartOwner('guest');
      applyAuthUi(null);
      showCartToast('Sesión cerrada', 2400);
      closeAccountDropdownMenu();
      closeAuthModal();
      closeProfileModal();
      closePasswordModal();
      closeOrdersModal();
    } catch (error) {
      showAuthFeedback(String(error?.message || 'No se pudo cerrar sesión.'), 'error');
    }
  }, {}, 'auth:menu-logout');

  bindScopedListener(scope, passwordCloseBtn, 'click', closePasswordModal, {}, 'auth:password-close');
  bindScopedListener(scope, ordersCloseBtn, 'click', closeOrdersModal, {}, 'auth:orders-close');


  bindScopedListener(scope, document, 'click', (event) => {
    if (!accountDropdown?.classList.contains('open')) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (accountDropdown.contains(target) || accountBtn?.contains(target)) return;
    closeAccountDropdown();
  }, {}, 'auth:dropdown-outside');

  bindScopedListener(scope, document, 'keydown', (event) => {
    if (event.key === 'Escape' && accountDropdown?.classList.contains('open')) {
      closeAccountDropdownMenu();
      accountBtn?.focus();
    }
  }, {}, 'auth:dropdown-esc');

  bindScopedListener(scope, passwordForm, 'submit', async (event) => {
    event.preventDefault();
    if (appRuntime.recoveryBusy) return;
    if (isEmailActionCoolingDown('forgot')) {
      const waitSec = getFriendlyCooldownSeconds('forgot');
      const feedback = document.getElementById('password-feedback');
      if (feedback) {
        feedback.textContent = `Espera ${waitSec}s para volver a enviar el enlace.`;
        feedback.className = 'checkout-feedback info';
      }
      return;
    }

    const feedback = document.getElementById('password-feedback');
    const { email, ok } = validateRecoveryEmail();
    if (!ok) {
      if (feedback) {
        feedback.textContent = 'Ingresa un correo válido.';
        feedback.className = 'checkout-feedback error';
      }
      return;
    }

    appRuntime.recoveryBusy = true;
    if (passwordSubmitBtn) {
      passwordSubmitBtn.disabled = true;
      passwordSubmitBtn.textContent = 'Enviando...';
    }
    startEmailActionCooldown('forgot');

    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: new URL('reset-password/index.html', window.location.href).toString()
      });
      if (error) throw error;
      if (feedback) {
        feedback.textContent = 'Si el correo está registrado, te enviaremos un enlace para cambiar tu contraseña. Revisa spam/promociones.';
        feedback.className = 'checkout-feedback success';
      }
    } catch (error) {
      console.error('Error enviando recovery email:', {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        status: error?.status,
        code: error?.code
      });
      if (feedback) {
        feedback.textContent = isRateLimitAuthError(error)
          ? 'Se realizaron demasiadas solicitudes. Intenta nuevamente en unos minutos.'
          : 'Ocurrió un error, intenta nuevamente.';
        feedback.className = 'checkout-feedback error';
      }
    } finally {
      appRuntime.recoveryBusy = false;
      renderEmailActionCooldown('forgot');
    }
  }, {}, 'auth:password-submit');

  bindScopedListener(scope, tabLogin, 'click', () => setAuthMode('login'), {}, 'auth:tab-login');
  bindScopedListener(scope, tabRegister, 'click', () => setAuthMode('register'), {}, 'auth:tab-register');

  bindScopedListener(scope, forgotBtn, 'click', (event) => {
    event.preventDefault();
    openPasswordModal();
    showAuthFeedback('');
  }, {}, 'auth:forgot');

  bindScopedListener(scope, googleBtn, 'click', async () => {
    try {
      showAuthFeedback('Redirigiendo a Google...', 'info');
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + window.location.pathname
        }
      });
      if (error) throw error;
    } catch (error) {
      logSupabaseError('⚠️ Error iniciando OAuth Google:', error);
      showAuthFeedback('No se pudo iniciar con Google. Intenta nuevamente o usa correo y contraseña.', 'error');
    }
  }, {}, 'auth:google');

  bindScopedListener(scope, closeBtn, 'click', closeAuthModal, {}, 'auth:close-modal');
  bindScopedListener(scope, closeProfileBtn, 'click', closeProfileModal, {}, 'auth:close-profile');

  bindScopedListener(scope, authForm, 'submit', async (event) => {
    event.preventDefault();
    if (appRuntime.authBusy) return;

    const now = Date.now();
    if (appRuntime.authMode === 'login' && appRuntime.loginCooldownUntil > now) {
      const waitSec = Math.max(1, Math.ceil((appRuntime.loginCooldownUntil - now) / 1000));
      showAuthFeedback(`Demasiados intentos. Espera ${waitSec}s para volver a intentar.`, 'error');
      return;
    }
    if (appRuntime.authMode === 'register' && isEmailActionCoolingDown('register')) {
      const waitSec = getFriendlyCooldownSeconds('register');
      showAuthFeedback(`Espera ${waitSec}s antes de volver a crear cuenta.`, 'error');
      renderEmailActionCooldown('register');
      return;
    }

    const submitBtn = document.getElementById('auth-submit-btn');
    const identity = normalizeCustomerIdentityPayload({
      firstName: document.getElementById('auth-first-name')?.value || '',
      lastName: document.getElementById('auth-last-name')?.value || '',
      phone: document.getElementById('auth-phone')?.value || '',
      dni: document.getElementById('auth-dni')?.value || '',
      email: document.getElementById(appRuntime.authMode === 'register' ? 'auth-email-register' : 'auth-email-login')?.value || ''
    });
    const firstName = identity.firstName;
    const lastName = identity.lastName;
    const phone = identity.phone;
    const dni = identity.dni;
    const email = identity.email;
    const password = String(document.getElementById(appRuntime.authMode === 'register' ? 'auth-password-register' : 'auth-password-login')?.value || '').trim();
    const confirmPassword = String(document.getElementById('auth-confirm-password')?.value || '').trim();

    const errors = appRuntime.authMode === 'register'
      ? validateRegisterForm({ firstName, lastName, phone, dni, email, password, confirmPassword })
      : validateLoginForm({ email, password });

    if (Object.keys(errors).length) {
      renderAuthValidationErrors(errors, appRuntime.authMode);
      showAuthFeedback('Corrige los campos marcados para continuar.', 'error');
      return;
    }

    renderAuthValidationErrors({}, appRuntime.authMode);

    try {
      appRuntime.authBusy = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = appRuntime.authMode === 'register' ? 'Creando...' : 'Ingresando...';
      }
      showAuthFeedback(appRuntime.authMode === 'register' ? 'Creando cuenta...' : 'Ingresando...', 'info');

      if (appRuntime.authMode === 'register') {
        const fullName = `${firstName} ${lastName}`.trim();
        startEmailActionCooldown('register');
        const { error } = await supabaseClient.auth.signUp({
          email,
          password,
          options: {
            data: {
              name: fullName,
              first_name: firstName,
              last_name: lastName,
              phone,
              dni
            }
          }
        });
        if (error) throw error;
        appRuntime.loginFailureCount = 0;
        appRuntime.loginCooldownUntil = 0;
        setAuthMode('login');
        showAuthFeedback('Usuario creado con éxito. Revisa tu correo para confirmar y luego inicia sesión.', 'success');
      } else {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        appRuntime.loginFailureCount = 0;
        appRuntime.loginCooldownUntil = 0;
        showAuthFeedback('Sesión iniciada.', 'success');
        showCartToast('Sesión iniciada', 2400);
        closeAuthModal();
        refreshAuthUiSafe(9000);
      }
    } catch (error) {
      await reportCriticalError('auth_error', 'setupAuthEvents:authFormSubmit', error);
      logSupabaseError('❌ Error auth submit:', error);

      if (appRuntime.authMode === 'login') {
        appRuntime.loginFailureCount += 1;
        if (appRuntime.loginFailureCount >= 3) {
          appRuntime.loginCooldownUntil = Date.now() + 15000;
        }
      }

      const isRateLimit = isRateLimitAuthError(error);
      if (isRateLimit && appRuntime.authMode === 'register') {
        startEmailActionCooldown('register');
      }
      const errorMessage = isRateLimit
        ? 'Se realizaron demasiadas solicitudes. Intenta nuevamente en unos minutos.'
        : getFriendlyAuthError(error, appRuntime.authMode);
      showAuthFeedback(String(errorMessage || 'Ocurrió un error, intenta nuevamente.'), 'error');
    } finally {
      appRuntime.authBusy = false;
      if (submitBtn) {
        if (appRuntime.authMode === 'register') {
          renderEmailActionCooldown('register');
        } else {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Ingresar';
        }
      }
    }
  }, {}, 'auth:submit');


  bindScopedListener(scope, document.getElementById('profile-avatar'), 'change', (event) => {
    const input = event.currentTarget;
    const file = input?.files?.[0];
    const avatarPreview = document.getElementById('profile-avatar-preview');
    if (!avatarPreview || !file) return;
    const tempUrl = URL.createObjectURL(file);
    avatarPreview.src = tempUrl;
    avatarPreview.style.display = 'block';
    avatarPreview.dataset.tempPreview = tempUrl;
  }, {}, 'auth:avatar-preview-change');


  bindScopedListener(scope, document.getElementById('profile-phone'), 'input', (event) => {
    const node = event.currentTarget;
    if (!node) return;
    node.value = String(node.value || '').replace(/\D+/g, '').slice(0, 9);
  }, {}, 'auth:profile-phone-numeric-only');

  bindScopedListener(scope, document.getElementById('profile-dni'), 'input', (event) => {
    const node = event.currentTarget;
    if (!node) return;
    node.value = String(node.value || '').replace(/\D+/g, '').slice(0, 8);
  }, {}, 'auth:profile-dni-numeric-only');

  bindScopedListener(scope, document.getElementById('checkout-telefono'), 'input', (event) => {
    const node = event.currentTarget;
    if (!node) return;
    node.value = String(node.value || '').replace(/\D+/g, '').slice(0, 9);
  }, {}, 'checkout:phone-numeric-only');


  bindScopedListener(scope, document.getElementById('profile-form'), 'submit', async (event) => {
    event.preventDefault();
    if (appRuntime.profileSaveBusy) return;

    const saveBtn = document.getElementById('profile-save-btn');
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) {
      showProfileFeedback('Inicia sesión para actualizar tu perfil.', 'error');
      return;
    }

    ensureProfileFieldErrorNodes();
    clearProfileFieldErrors();

    const first_name = collapseSpaces(document.getElementById('profile-first-name')?.value || '');
    const last_name = collapseSpaces(document.getElementById('profile-last-name')?.value || '');
    const phone = String(document.getElementById('profile-phone')?.value || '').replace(/\D+/g, '');
    const dni = String(document.getElementById('profile-dni')?.value || '').replace(/\D+/g, '');
    const avatarInput = document.getElementById('profile-avatar');

    const profileErrors = validateProfileForm({
      firstName: first_name,
      lastName: last_name,
      phone,
      dni
    });

    if (Object.keys(profileErrors).length) {
      setProfileFieldError('profile-first-name', profileErrors.firstName || '');
      setProfileFieldError('profile-last-name', profileErrors.lastName || '');
      setProfileFieldError('profile-phone', profileErrors.phone || '');
      setProfileFieldError('profile-dni', profileErrors.dni || '');
      showProfileFeedback('Corrige los campos marcados para continuar.', 'error');
      return;
    }

    appRuntime.profileSaveBusy = true;
    if (saveBtn) saveBtn.disabled = true;
    const previousText = saveBtn?.textContent || 'Guardar perfil';
    if (saveBtn) saveBtn.textContent = 'Guardando...';

    try {
      showProfileFeedback('Guardando perfil...', 'info');

      let avatar_path = user.user_metadata?.avatar_path || '';
      let avatar_updated_at = Number(user.user_metadata?.avatar_updated_at || 0);
      const file = avatarInput?.files?.[0];
      if (file) {
        const ext = file.name.split('.').pop() || 'jpg';
        avatar_path = `${user.id}/avatar-${Date.now()}.${ext}`;
        try {
          const uploadResult = await withTimeout(
            supabaseClient.storage.from('avatars').upload(avatar_path, file, { upsert: true }),
            25000,
            'La subida de la imagen tardó demasiado.'
          );
          const upErr = uploadResult?.error;
          if (upErr) throw upErr;
          avatar_updated_at = Date.now();
        } catch (upErr) {
          logSupabaseError('⚠️ Error subiendo avatar (continuamos sin bloquear perfil):', upErr);
          avatar_path = user.user_metadata?.avatar_path || '';
        }
      }

      const payload = {
        name: `${first_name} ${last_name}`.trim(),
        first_name,
        last_name,
        phone,
        dni,
        avatar_path,
        avatar_updated_at
      };

      let authMetadataUpdated = false;
      try {
        const updateResult = await withTimeout(
          supabaseClient.auth.updateUser({ data: payload }),
          25000,
          'La actualización de metadatos del perfil tardó demasiado.'
        );
        const error = updateResult?.error;
        if (error) throw error;
        authMetadataUpdated = true;
      } catch (updateError) {
        logSupabaseError('⚠️ Reintentando updateUser por fallo inicial:', updateError);
        try {
          const retryResult = await withTimeout(
            supabaseClient.auth.updateUser({ data: payload }),
            25000,
            'La actualización de metadatos del perfil tardó demasiado.'
          );
          const retryError = retryResult?.error;
          if (retryError) throw retryError;
          authMetadataUpdated = true;
        } catch (retryError) {
          logSupabaseError('⚠️ No se pudo actualizar auth.user_metadata (continuamos con customers):', retryError);
        }
      }

      appRuntime.lastCustomerSyncError = '';

      const customerPayload = {
        name: `${first_name} ${last_name}`.trim(),
        phone,
        dni,
        email: user.email || '',
        avatar_path
      };

      const customerProfileSynced = await syncCustomerProfileToCustomers(customerPayload);
      if (!authMetadataUpdated && !customerProfileSynced) {
        throw new Error(appRuntime.lastCustomerSyncError || 'No se pudo guardar el perfil en este momento. Intenta nuevamente.');
      }

      if (!customerProfileSynced && authMetadataUpdated) {
        logSupabaseError('⚠️ Perfil actualizado en auth.user_metadata pero falló sync customers:', appRuntime.lastCustomerSyncError || 'SYNC_CUSTOMERS_FAILED');
      }

      const updatedMessage = customerProfileSynced || !authMetadataUpdated
        ? 'Perfil actualizado correctamente.'
        : 'Perfil actualizado. Algunos datos secundarios tardarán en sincronizarse.';
      showProfileFeedback(updatedMessage, 'success');
      showCartToast('Perfil actualizado', 2400);

      const checkoutName = document.getElementById('checkout-nombre');
      const checkoutPhone = document.getElementById('checkout-telefono');
      if (checkoutName) checkoutName.value = `${first_name} ${last_name}`.trim();
      if (checkoutPhone) checkoutPhone.value = phone;
      if (avatarInput) avatarInput.value = '';

      const avatarPreview = document.getElementById('profile-avatar-preview');
      if (avatarPreview && avatar_path) {
        const { data } = supabaseClient.storage.from('avatars').getPublicUrl(avatar_path);
        if (data?.publicUrl) {
          const sep = data.publicUrl.includes('?') ? '&' : '?';
          avatarPreview.src = `${data.publicUrl}${sep}t=${avatar_updated_at || Date.now()}`;
          avatarPreview.style.display = 'block';
        }
      }
      if (avatarPreview?.dataset?.tempPreview) {
        URL.revokeObjectURL(avatarPreview.dataset.tempPreview);
        delete avatarPreview.dataset.tempPreview;
      }

      if (!authMetadataUpdated && customerProfileSynced) {
        applyAuthUi(user, {
          name: `${first_name} ${last_name}`.trim(),
          phone,
          dni,
          avatar_path
        });
        setTimeout(() => refreshAuthUiSafe(9000), 1800);
      } else {
        refreshAuthUiSafe(9000);
      }
    } catch (error) {
      logSupabaseError('❌ Error guardando perfil cliente:', error);
      showProfileFeedback('No se pudo guardar, intenta otra vez.', 'error');
    } finally {
      appRuntime.profileSaveBusy = false;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = previousText;
      }
    }
  }, {}, 'auth:profile-save');

  setAuthMode('login');
  ensureProfileFieldErrorNodes();
  validateRecoveryEmail();
  renderEmailActionCooldown('register');
  renderEmailActionCooldown('forgot');
  logListenerStats('auth');
}


function ensureSingleAuthSubscription() {
  if (typeof appRuntime.authUnsubscribe === 'function') {
    appRuntime.authUnsubscribe();
    appRuntime.authUnsubscribe = null;
  }

  const { data } = supabaseClient.auth.onAuthStateChange(async (event, session) => {
    const userId = session?.user?.id || null;

    const isDuplicateSignedIn = event === 'SIGNED_IN'
      && userId
      && appRuntime.lastAuthUserId === userId
      && ['SIGNED_IN', 'TOKEN_REFRESHED', 'INITIAL_SESSION'].includes(appRuntime.lastAuthEvent);

    if (isDuplicateSignedIn) {
      return;
    }

    if (event !== 'TOKEN_REFRESHED') {
      debugLog('🔐 onAuthStateChange recibido:', event);
    }

    if (event === 'TOKEN_REFRESHED') {
      appRuntime.lastAuthEvent = event;
      appRuntime.lastAuthUserId = userId;
      refreshAuthUiSafe(7000);
      return;
    }

    appRuntime.lastAuthEvent = event;
    appRuntime.lastAuthUserId = userId;

    if (event === 'SIGNED_OUT') {
      appRuntime.profileSaveBusy = false;
      switchCartOwner('guest');
      applyAuthUi(null);
      closeAuthModal();
      closeProfileModal();
      closeAccountDropdownMenu();
      return;
    }

    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      switchCartOwner(userId || 'guest', { preserveGuestOnLogin: true });

      const provider = session?.user?.app_metadata?.provider || '';
      const metadataPhone = String(session?.user?.user_metadata?.phone || '').replace(/\D+/g, '');
      const metadataDni = String(session?.user?.user_metadata?.dni || '').replace(/\D+/g, '');
      const incompleteGoogleProfile = provider === 'google' && (!/^\d{9}$/.test(metadataPhone) || !/^\d{8}$/.test(metadataDni));
      if (incompleteGoogleProfile && appRuntime.googleProfilePromptedFor !== (userId || '')) {
        appRuntime.googleProfilePromptedFor = userId || '';
        showCartToast('Completa tu perfil (teléfono y DNI) para comprar más rápido.', 3200);
        openProfileModal();
      }
    }

    refreshAuthUiSafe(9000);
  });

  appRuntime.authSubscription = data?.subscription || null;
  appRuntime.authUnsubscribe = () => {
    data?.subscription?.unsubscribe?.();
    appRuntime.authSubscription = null;
  };

  debugLog('🧷 Auth subscription registrada (única)');
}


async function initApp() {
  if (appRuntime.inited) return;
  appRuntime.inited = true;
  appRuntime.initCounter += 1;
  debugLog(`🚀 initApp corrida #${appRuntime.initCounter}`);

  const { data: sessionData } = await supabaseClient.auth.getSession();
  const initUserId = sessionData?.session?.user?.id || 'guest';
  switchCartOwner(initUserId, { preserveGuestOnLogin: false });
  resetGlobalEventWiring();
  setupCartModalEvents();
  setupTrackingEvents();
  setupAuthEvents();
  setupCheckoutSubmitDelegation();
  updateDireccionRequired();
  updateCartBadge();
  renderCartModal();

  await getStoreSettings();
  await getDeliveryZones();
  await cargarMenu();
  await refreshAuthUiSafe(9000);

  ensureSingleAuthSubscription();

  const loader = document.getElementById('loader');
  if (loader) setTimeout(() => loader.classList.add('hide'), 1500);
}

// ===============================
// INIT
// ===============================
window.addEventListener('load', initApp);
