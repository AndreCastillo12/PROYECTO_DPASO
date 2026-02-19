// ===============================
// SUPABASE CONFIG
// ===============================
const SUPABASE_URL = 'https://gtczpfxdkiajprnluokq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0Y3pwZnhka2lhanBybmx1b2txIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzOTc5MTAsImV4cCI6MjA4NTk3MzkxMH0.UrV46fOq-YFQWykvR-eqPmlr-33w1aC7ynmywu_nsQ8';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CART_STORAGE_KEY = 'dpaso_cart_v1';
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

const STATUS_ORDER = ['pending', 'accepted', 'preparing', 'ready', 'dispatched', 'delivered', 'completed', 'cancelled'];

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

function isPlatoSoldOut(plato) {
  if (!plato) return true;
  if (plato.is_available === false) return true;
  if (plato.track_stock === true && (plato.stock == null || Number(plato.stock) <= 0)) return true;
  return false;
}

function getPlatoAvailabilityMessage(plato) {
  if (!plato) return 'No disponible';
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
    preparing: 'Preparando',
    ready: 'Listo',
    dispatched: 'En camino',
    delivered: 'Entregado',
    completed: 'Completado',
    cancelled: 'Cancelado'
  };
  return map[status] || status || '-';
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
  closeModalSafe(modal, getFallbackFocusElement('tracking-float-btn', 'btnTracking', 'cart-float-btn'));
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

function buildTrackingTimeline(status) {
  if (status === 'cancelled') {
    return `<div class="tracking-timeline">
      <div class="tracking-step cancelled">
        <span class="tracking-step-dot"></span>
        <span>Pedido cancelado</span>
      </div>
    </div>`;
  }

  const idx = STATUS_ORDER.indexOf(status);
  const safeIndex = idx === -1 ? 0 : idx;

  const steps = STATUS_ORDER.filter((s) => s !== 'cancelled').map((step, index) => {
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
    ${buildTrackingTimeline(data.status)}
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
  const floatBtn = document.getElementById('tracking-float-btn');
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

  bindScopedListener(scope, floatBtn, 'click', () => {
    openTrackingModal();
  }, {}, 'tracking:open-float');

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

  bindScopedListener(scope, modal, 'click', (event) => {
    if (event.target === modal) closeTrackingModal();
  }, {}, 'tracking:backdrop-close');

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
  if (!receiptBox || !receiptContent || !orderData) return;

  const shortId = orderData.short_id || getShortOrderId(orderData.id);
  const trackingCode = orderData.short_code || shortId;
  const lines = orderData.items.map((it) => `${it.nombre} · Cantidad: ${it.cantidad} · Precio: ${formatCurrency(it.precio)}`);

  receiptContent.innerHTML = `
    <p><strong>Pedido:</strong> #${shortId}</p>
    <p><strong>Código de rastreo:</strong> ${trackingCode}</p>
    <p><strong>Cliente:</strong> ${orderData.nombre_cliente}</p>
    <p><strong>Teléfono:</strong> ${orderData.telefono}</p>
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

  receiptBox.style.display = 'block';
}

function hideReceipt() {
  const receiptBox = document.getElementById('order-receipt');
  const receiptContent = document.getElementById('order-receipt-content');
  const receiptWhatsAppBtn = document.getElementById('receipt-whatsapp-btn');
  const receiptTrackBtn = document.getElementById('btnVerEstadoPedido');

  if (receiptBox) receiptBox.style.display = 'none';
  if (receiptContent) receiptContent.innerHTML = '';
  if (receiptTrackBtn) receiptTrackBtn.style.display = 'none';
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

async function refreshCartAvailability() {
  const ids = [...new Set(cart.map((item) => item.id).filter(Boolean))];
  if (!ids.length) return;

  try {
    const { data, error } = await supabaseClient
      .from('platos')
      .select('id,is_available,track_stock,stock,precio')
      .in('id', ids);

    if (error) throw error;

    (data || []).forEach((row) => {
      const prev = platosState.get(row.id) || {};
      platosState.set(row.id, { ...prev, ...row });
    });

    cart = cart.map((item) => {
      const latest = (data || []).find((row) => row.id === item.id);
      if (!latest) return item;
      return { ...item, precio: Number(latest.precio ?? item.precio) };
    });
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

  if (!isDelivery) {
    direccion.value = '';
    const referenciaInput = document.getElementById('checkout-referencia');
    if (referenciaInput) referenciaInput.value = '';
    if (provincia) provincia.value = '';
    if (distrito) distrito.value = '';
  }

  updateCartTotalsAndAvailability();
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

  bindScopedListener(scope, cartButton, 'click', openCartModal, {}, 'cart:open');
  bindScopedListener(scope, closeButton, 'click', closeCartModal, {}, 'cart:close');

  bindScopedListener(scope, modal, 'click', (e) => {
    if (e.target === modal) closeCartModal();
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
    updateDireccionRequired();
  }, {}, 'checkout:open-step');

  bindScopedListener(scope, backToCartBtn, 'click', () => {
    checkoutStepOpen = false;
    toggleCheckoutSection(false);
    clearFeedback();
    renderCartModal();
  }, {}, 'checkout:back-step');

  bindScopedListener(scope, document.getElementById('download-receipt-btn'), 'click', () => downloadReceiptPdf(lastOrderData), {}, 'receipt:download');

  logListenerStats('cart');
}


// ===============================
// CHECKOUT + SUPABASE
// ===============================
async function submitOrder(eventOrForm) {
  if (eventOrForm?.preventDefault) eventOrForm.preventDefault();

  if (orderSubmitBusy || window.__dpasoSubmitting) return;

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

    await refreshCartAvailability();

  const formData = new FormData(form);
  const unavailableItems = getUnavailableCartItems();
  if (unavailableItems.length > 0) {
    showFeedback('Algunos productos ya no están disponibles, elimínalos del carrito.', 'error');
    renderCartModal();
    return;
  }

  const normalizedModalidad = normalizeModalidad(formData.get('modalidad'));
  const totals = getCheckoutTotals(normalizedModalidad);

  const customerName = String(formData.get('nombre') || '').trim();
  const phoneRaw = String(formData.get('telefono') || '').trim();
  const addressRaw = String(formData.get('direccion') || '').trim();
  const referenciaRaw = String(formData.get('referencia') || '').trim();
  const comentarioRaw = String(formData.get('comentario') || '').trim();


  if (!customerName || !phoneRaw) {
    showFeedback('Nombre y teléfono son obligatorios.', 'error');
    return;
  }

  const telefonoLimpio = phoneRaw.replace(/\D/g, '');
  if (!/^\d{9}$/.test(telefonoLimpio)) {
    showFeedback('El teléfono debe tener exactamente 9 dígitos numéricos.', 'error');
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
      provincia: normalizedModalidad === 'Delivery' ? (totals.provincia || null) : null,
      distrito: normalizedModalidad === 'Delivery' ? (totals.distrito || null) : null
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
    const { data: rpcData, error: rpcError } = await supabaseClient
      .rpc('create_order', { payload: rpcPayload });
    const rpcMs = Math.round(performance.now() - rpcStartedAt);

    await reportOperationalMetric('checkout_rpc_result', {
      success: !rpcError,
      rpc_ms: rpcMs,
      modalidad: normalizedModalidad
    });

    if (rpcError) throw rpcError;

    orderId = rpcData?.order_id || null;
    shortId = String(rpcData?.short_id || '');
    shortCode = String(rpcData?.short_code || shortId || '');
    createdAt = rpcData?.created_at || null;

    if (!orderId) throw new Error('No se pudo obtener order_id desde create_order.');

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

    showFeedback(`✅ Pedido creado (#${lastOrderData.short_id}). Tu comprobante está listo.`, 'success');
    renderReceipt(lastOrderData);
    closeCartModal();
    openReceiptModal();

    if (whatsappBtn && lastOrderData) {
      whatsappBtn.href = buildWhatsAppMessage(lastOrderData);
      whatsappBtn.style.display = 'inline-flex';
    }

    clearCartAndForm();
  } catch (error) {
    await reportCriticalError('checkout_error', 'submitOrder', error, {
      cart_items: cart.length
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
      showFeedback('Este teléfono ya está vinculado a otra cuenta. Usa otro teléfono o inicia sesión con la cuenta correcta.', 'error');
    } else if (errorMessage.includes('OUT_OF_STOCK') || errorMessage.includes('NOT_AVAILABLE')) {
      showFeedback('Algunos productos ya no están disponibles, elimínalos del carrito.', 'error');
      await cargarMenu();
    } else {
      showFeedback('No se pudo crear el pedido. Revisa tu conexión o intenta de nuevo.', 'error');
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

    menu.innerHTML = '';
    nav.innerHTML = '';

    const query = String(searchInput?.value || '').trim().toLowerCase();

    categoriasData.forEach((cat) => {
      const items = (platosData || []).filter((p) => p.categoria_id === cat.id)
        .filter((p) => !query || String(p.nombre || '').toLowerCase().includes(query) || String(p.descripcion || '').toLowerCase().includes(query));

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
      row.innerHTML = `
        <button type="button" class="carousel-arrow" data-action="prev">‹</button>
        <div class="carousel-viewport"><div class="carousel-track"></div></div>
        <button type="button" class="carousel-arrow" data-action="next">›</button>
      `;

      const track = row.querySelector('.carousel-track');

      items.forEach((item) => {
        const soldOut = isPlatoSoldOut(item);
        const stockText = soldOut ? '<span class="sold-out-badge">Agotado</span>' : '';
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
          ${stockText}
          <button type="button" class="add-cart-btn" data-item-id="${item.id}" ${soldOut ? 'disabled title="Producto agotado"' : ''}>+ Agregar</button>
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

    document.querySelectorAll('.fade-up').forEach((el) => observer.observe(el));

    if (searchInput && !searchInput.dataset.boundInput) {
      searchInput.addEventListener('input', () => cargarMenu());
      searchInput.dataset.boundInput = '1';
    }
  } catch (err) {
    console.error('❌ Error cargando menú:', err);
    menu.innerHTML = '<p>Error cargando el menú. Revisa la consola.</p>';
  }
}

function initInfiniteCarousel(row) {
  const track = row.querySelector('.carousel-track');
  const prev = row.querySelector('[data-action="prev"]');
  const next = row.querySelector('[data-action="next"]');
  if (!track || !prev || !next) return;

  const original = Array.from(track.children);
  if (original.length <= 1) return;

  const cloneCount = Math.min(3, original.length);
  const headClones = original.slice(0, cloneCount).map((n) => n.cloneNode(true));
  const tailClones = original.slice(-cloneCount).map((n) => n.cloneNode(true));

  tailClones.forEach((node) => track.insertBefore(node, track.firstChild));
  headClones.forEach((node) => track.appendChild(node));

  let index = cloneCount;
  const gap = 14;

  function cardWidth() {
    const card = track.children[0];
    if (!card) return 220;
    return card.getBoundingClientRect().width + gap;
  }

  function jump(animate = true) {
    track.style.transition = animate ? 'transform .42s ease' : 'none';
    track.style.transform = `translateX(${-index * cardWidth()}px)`;
  }

  function move(delta) {
    index += delta;
    jump(true);
  }

  prev.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));

  track.addEventListener('transitionend', () => {
    const maxIndex = original.length + cloneCount;
    if (index >= maxIndex) {
      index = cloneCount;
      jump(false);
    } else if (index < cloneCount) {
      index = original.length + cloneCount - 1;
      jump(false);
    }
  });

  window.addEventListener('resize', () => jump(false));

  let autoplay = setInterval(() => move(1), 3200);
  row.addEventListener('mouseenter', () => clearInterval(autoplay));
  row.addEventListener('mouseleave', () => {
    clearInterval(autoplay);
    autoplay = setInterval(() => move(1), 3200);
  });

  jump(false);
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

function setAuthMode(mode = 'login') {
  const normalized = mode === 'register' ? 'register' : 'login';
  appRuntime.authMode = normalized;
  const title = document.getElementById('auth-modal-title');
  const submitBtn = document.getElementById('auth-submit-btn');
  const toggleBtn = document.getElementById('auth-toggle-btn');
  const nameInput = document.getElementById('auth-name');
  const phoneInput = document.getElementById('auth-phone');

  if (title) title.textContent = normalized === 'register' ? 'Crear cuenta' : 'Iniciar sesión';
  if (submitBtn) submitBtn.textContent = normalized === 'register' ? 'Registrarme' : 'Entrar';
  if (toggleBtn) toggleBtn.textContent = normalized === 'register' ? 'Ya tengo cuenta' : 'Crear cuenta';
  if (nameInput) nameInput.required = normalized === 'register';
  if (phoneInput) phoneInput.required = normalized === 'register';
  showAuthFeedback('');
}

function openAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  openModalSafe(modal, document.getElementById('auth-email'));
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  closeModalSafe(modal, getFallbackFocusElement('auth-account-btn', 'cart-float-btn'));
}

function openHistoryModal() {
  const modal = document.getElementById('history-modal');
  if (!modal) return;
  openModalSafe(modal, document.getElementById('history-close-btn'));
}

function closeHistoryModal() {
  const modal = document.getElementById('history-modal');
  if (!modal) return;
  closeModalSafe(modal, getFallbackFocusElement('auth-history-btn', 'auth-account-btn'));
}

async function loadOrderHistory() {
  const list = document.getElementById('history-list');
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

      console.warn('⚠️ get_my_orders no disponible, usando fallback por tabla orders');
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
      return;
    }

    list.innerHTML = data.map((order) => `
      <article class="history-item">
        <p><strong>${order.short_code || getShortOrderId(order.id)}</strong> · ${humanTrackingStatus(order.estado)}</p>
        <p>${formatTrackingDate(order.created_at)} · ${order.modalidad || '-'}</p>
        <p><strong>${formatCurrency(order.total || 0)}</strong></p>
      </article>
    `).join('');
  } catch (error) {
    await reportCriticalError('history_error', 'loadOrderHistory', error);
    console.error('❌ Error cargando historial:', error);
    list.innerHTML = '<p class="tracking-muted">No se pudo cargar el historial.</p>';
  }
}

function applyAuthUi(user = null) {
  const accountBtn = document.getElementById('auth-account-btn');
  const historyBtn = document.getElementById('auth-history-btn');
  const checkoutName = document.getElementById('checkout-nombre');
  const checkoutPhone = document.getElementById('checkout-telefono');

  if (accountBtn) accountBtn.textContent = user ? 'Cerrar sesión' : 'Iniciar sesión';
  if (historyBtn) historyBtn.style.display = user ? 'inline-flex' : 'none';

  if (user) {
    const profileName = user.user_metadata?.name || '';
    const profilePhone = user.user_metadata?.phone || '';
    if (checkoutName && profileName) checkoutName.value = profileName;
    if (checkoutPhone && profilePhone) checkoutPhone.value = profilePhone;
  }
}

async function refreshAuthUi() {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  let user = sessionData?.session?.user || null;

  if (!user) {
    const { data } = await supabaseClient.auth.getUser();
    user = data?.user || null;
  }

  applyAuthUi(user);
}

function setupAuthEvents() {
  const scope = getOrCreateListenerScope('auth');

  const accountBtn = document.getElementById('auth-account-btn');
  const historyBtn = document.getElementById('auth-history-btn');
  const authModal = document.getElementById('auth-modal');
  const historyModal = document.getElementById('history-modal');
  const closeBtn = document.getElementById('auth-close-btn');
  const closeHistoryBtn = document.getElementById('history-close-btn');
  const toggleBtn = document.getElementById('auth-toggle-btn');
  const authForm = document.getElementById('auth-form');

  bindScopedListener(scope, accountBtn, 'click', async () => {
    const { data } = await supabaseClient.auth.getSession();
    const user = data?.session?.user || null;
    if (!user) {
      setAuthMode('login');
      openAuthModal();
      return;
    }

    if (accountBtn) accountBtn.disabled = true;

    try {
      const { error } = await supabaseClient.auth.signOut({ scope: 'local' });
      if (error) throw error;
      appRuntime.lastAuthEvent = 'SIGNED_OUT';
      appRuntime.lastAuthUserId = null;
      applyAuthUi(null);
      closeAuthModal();
      closeHistoryModal();
    } catch (error) {
      await reportCriticalError('auth_error', 'setupAuthEvents:signOut', error);
      console.error('❌ Error cerrando sesión:', error);
      await refreshAuthUi();
    } finally {
      if (accountBtn) accountBtn.disabled = false;
    }
  }, {}, 'auth:account-btn');

  bindScopedListener(scope, historyBtn, 'click', async () => {
    openHistoryModal();
    await loadOrderHistory();
  }, {}, 'auth:history-open');

  bindScopedListener(scope, toggleBtn, 'click', () => {
    setAuthMode(appRuntime.authMode === 'login' ? 'register' : 'login');
  }, {}, 'auth:toggle-mode');

  bindScopedListener(scope, closeBtn, 'click', closeAuthModal, {}, 'auth:close-modal');
  bindScopedListener(scope, closeHistoryBtn, 'click', closeHistoryModal, {}, 'auth:close-history');

  bindScopedListener(scope, authModal, 'click', (event) => {
    if (event.target === authModal) closeAuthModal();
  }, {}, 'auth:backdrop-close');

  bindScopedListener(scope, historyModal, 'click', (event) => {
    if (event.target === historyModal) closeHistoryModal();
  }, {}, 'auth:history-backdrop-close');

  bindScopedListener(scope, authForm, 'submit', async (event) => {
    event.preventDefault();
    if (appRuntime.authBusy) return;

    const submitBtn = document.getElementById('auth-submit-btn');
    const name = String(document.getElementById('auth-name')?.value || '').trim();
    const phone = String(document.getElementById('auth-phone')?.value || '').replace(/\D+/g, '');
    const email = String(document.getElementById('auth-email')?.value || '').trim();
    const password = String(document.getElementById('auth-password')?.value || '');

    try {
      appRuntime.authBusy = true;
      if (submitBtn) submitBtn.disabled = true;
      showAuthFeedback('Procesando...', 'info');

      if (appRuntime.authMode === 'register') {
        const { error } = await supabaseClient.auth.signUp({
          email,
          password,
          options: {
            data: { name, phone }
          }
        });
        if (error) throw error;
        showAuthFeedback('Cuenta creada. Ya puedes iniciar sesión.', 'success');
        setAuthMode('login');
      } else {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        showAuthFeedback('Sesión iniciada.', 'success');
        closeAuthModal();
        await refreshAuthUi();
      }
    } catch (error) {
      await reportCriticalError('auth_error', 'setupAuthEvents:authFormSubmit', error);
      console.error('❌ Error auth:', error);
      showAuthFeedback(String(error?.message || 'No se pudo procesar la autenticación.'), 'error');
    } finally {
      appRuntime.authBusy = false;
      if (submitBtn) submitBtn.disabled = false;
    }
  }, {}, 'auth:submit');

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
      await refreshAuthUi();
      return;
    }

    appRuntime.lastAuthEvent = event;
    appRuntime.lastAuthUserId = userId;

    if (event === 'SIGNED_OUT') {
      applyAuthUi(null);
      closeAuthModal();
      closeHistoryModal();
      return;
    }

    await refreshAuthUi();
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

  loadCart();
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
  await refreshAuthUi();

  ensureSingleAuthSubscription();

  const loader = document.getElementById('loader');
  if (loader) setTimeout(() => loader.classList.add('hide'), 1500);
}

// ===============================
// INIT
// ===============================
window.addEventListener('load', initApp);
