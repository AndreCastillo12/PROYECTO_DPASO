// ===============================
// SUPABASE CONFIG
// ===============================
const SUPABASE_URL = 'https://gtczpfxdkiajprnluokq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0Y3pwZnhka2lhanBybmx1b2txIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzOTc5MTAsImV4cCI6MjA4NTk3MzkxMH0.UrV46fOq-YFQWykvR-eqPmlr-33w1aC7ynmywu_nsQ8';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce'
  }
});

const CART_STORAGE_KEY = 'dpaso_cart_v1';
const TRACKING_LAST_CODE_STORAGE_KEY = 'dpaso_last_tracking_code';
const RESET_PASSWORD_LAST_SENT_KEY = 'dpaso_reset_sent_';
const RESET_PASSWORD_THROTTLE_MS = 120000;
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
let authSession = null;
let authProfile = null;
let authSubscription = null;
let authMode = 'login';
let authRecoveryMode = false;
let authFeedbackTimer = null;
let authActiveSection = 'profile';
let menuDataCache = { platos: [], categorias: [] };
let categoryCursor = -1;
const menuRowControllers = new Set();
const uiBusyOps = new Set();
let topbarShortcutsReady = false;
let authInitReady = false;
let trackingEventsReady = false;
let cartModalEventsReady = false;
let menuSearchReady = false;
let keepAliveIntervalId = null;
let menuLoadInFlight = null;
let menuLoadQueued = false;
let menuSearchDebounceId = null;
let avatarPreviewUrl = '';
let runtimeGuardsReady = false;
const appUtils = window.DPASO_UTILS || null;
const diagnostics = { listenerBindings: new Map(), setupCalls: new Map(), requestCounts: new Map(), lastLogAt: 0 };

function getAuthRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

function getRecoveryRedirectUrl() {
  return `${getAuthRedirectUrl()}?mode=recovery`;
}

function isTransientRequestError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('network')
    || message.includes('fetch')
    || message.includes('timed out')
    || message.includes('timeout')
    || message.includes('connection')
  );
}

async function runRequestWithPolicy(task, {
  timeoutMs = 12000,
  timeoutMessage = 'La operación tardó demasiado. Intenta nuevamente.',
  retries = 0
} = {}) {
  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    try {
      let timerId;
      const timeoutPromise = new Promise((_, reject) => {
        timerId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      });
      const result = await Promise.race([Promise.resolve().then(task), timeoutPromise]);
      clearTimeout(timerId);
      return result;
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isTransientRequestError(error)) break;
      await new Promise((r) => setTimeout(r, 350));
    }
    attempt += 1;
  }

  throw lastError || new Error(timeoutMessage);
}

function withTimeout(promise, timeoutMs = 12000, timeoutMessage = 'La operación tardó demasiado. Intenta nuevamente.') {
  return runRequestWithPolicy(() => promise, {
    timeoutMs,
    timeoutMessage,
    retries: 1
  });
}

function markSetupCall(name = '') {
  if (!name) return;
  diagnostics.setupCalls.set(name, (diagnostics.setupCalls.get(name) || 0) + 1);
  appUtils?.diag?.markSetup?.(name);
}

function markBinding(name = '') {
  if (!name) return;
  diagnostics.listenerBindings.set(name, (diagnostics.listenerBindings.get(name) || 0) + 1);
  appUtils?.diag?.markBinding?.(name);
}

function markRequest(name = '') {
  if (!name) return;
  diagnostics.requestCounts.set(name, (diagnostics.requestCounts.get(name) || 0) + 1);
  appUtils?.diag?.markRequest?.(name);
}

function logDiagnostics(reason = '') {
  const now = Date.now();
  if ((now - diagnostics.lastLogAt) < 5000) return;
  diagnostics.lastLogAt = now;

  const setupSummary = Object.fromEntries(diagnostics.setupCalls.entries());
  const bindingSummary = Object.fromEntries(diagnostics.listenerBindings.entries());
  const requestSummary = Object.fromEntries(diagnostics.requestCounts.entries());

  console.info('🧭 diagnostics', {
    reason,
    setups: setupSummary,
    bindings: bindingSummary,
    requests: requestSummary,
    activeMenuCarousels: menuRowControllers.size,
    trackingIntervalActive: Boolean(trackingIntervalId),
    keepAliveIntervalActive: Boolean(keepAliveIntervalId),
    busyOps: Array.from(uiBusyOps.values())
  });
}

async function runCriticalUiAction(opKey, action, { onError, timeoutMs = 15000, timeoutMessage = 'La operación tardó demasiado.' } = {}) {
  if (appUtils?.runCriticalAction) {
    return appUtils.runCriticalAction(opKey, async ({ signal }) => {
      return runRequestWithPolicy(() => action({ signal }), { timeoutMs, timeoutMessage, retries: 0 });
    }, {
      busySet: uiBusyOps,
      timeoutMs,
      onError
    });
  }

  if (!beginUiOp(opKey)) return { skipped: true };
  try {
    return await runRequestWithPolicy(() => action({ signal: null }), { timeoutMs, timeoutMessage, retries: 0 });
  } catch (error) {
    if (typeof onError === 'function') onError(error);
    else throw error;
    return null;
  } finally {
    endUiOp(opKey);
  }
}


function splitFullName(raw = '') {
  const clean = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!clean) return { firstName: '', lastName: '' };
  const parts = clean.split(' ');
  const firstName = parts.shift() || '';
  return { firstName, lastName: parts.join(' ') };
}

function buildFullName(firstName = '', lastName = '') {
  return `${String(firstName || '').trim()} ${String(lastName || '').trim()}`.trim();
}

async function refreshAuthSession() {
  const { data } = await withTimeout(
    supabaseClient.auth.getSession(),
    9000,
    'No se pudo validar la sesión. Revisa tu conexión.'
  );
  authSession = data?.session || null;
  return authSession;
}

function isAuthSessionError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('jwt')
    || message.includes('expired')
    || message.includes('token')
    || code === 'PGRST301'
    || code === 'PGRST302'
    || code === '42501'
  );
}

function recoverInteractiveUiState() {
  const confirmBtn = document.getElementById('confirm-order-btn');
  const trackingRefreshBtn = document.getElementById('trackingRefreshBtn');
  const trackingCodeInput = document.getElementById('trackingCode');
  const loader = document.getElementById('loader');

  if (loader?.classList && !loader.classList.contains('hide')) {
    loader.classList.add('hide');
  }

  if (confirmBtn && !orderSubmitBusy) {
    confirmBtn.disabled = false;
    if (!String(confirmBtn.textContent || '').includes('Confirmar')) {
      confirmBtn.textContent = 'Confirmar pedido';
    }
  }

  if (trackingRefreshBtn) {
    const hasCode = String(trackingCodeInput?.value || '').trim().length >= 6;
    trackingRefreshBtn.disabled = !hasCode;
  }

  if (typeof updateCartTotalsAndAvailability === 'function') {
    try {
      updateCartTotalsAndAvailability();
    } catch (_e) {
      // noop: no romper la UI por una recuperación preventiva
    }
  }
}

function friendlyRuntimeError(error, fallback = 'No se pudo completar la acción.') {
  const msg = String(error?.message || '').trim();
  if (!msg) return fallback;
  if (msg.toLowerCase().includes('timed out') || msg.toLowerCase().includes('tardó demasiado')) {
    return 'La solicitud tardó demasiado. Verifica tu conexión e intenta otra vez.';
  }
  return msg;
}

function friendlyAuthError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('unsupported provider') || message.includes('provider is not enabled')) {
    return 'Google no está habilitado en Supabase para este proyecto. Actívalo en Authentication > Providers > Google.';
  }
  if (message.includes('email not confirmed')) {
    return 'Tu correo aún no está verificado. Revisa tu bandeja (y spam) y confirma tu cuenta.';
  }
  if (message.includes('invalid login credentials')) {
    return 'Correo o contraseña incorrectos.';
  }
  if (message.includes('already registered') || message.includes('already been registered')) {
    return 'Ese correo ya está registrado. Inicia sesión o recupera tu clave.';
  }
  if (message.includes('rate limit') || message.includes('security purposes')) {
    return 'Ya enviamos un correo recientemente. Espera un momento antes de volver a intentarlo.';
  }
  return error?.message || 'No se pudo completar la acción de autenticación.';
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

function normalizeSearchText(text = '') {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
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

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  if (codeToUse) input.value = codeToUse;
  input.focus();
  refreshTrackingLastButton();

  if (codeToUse && prefillCode) {
    fetchOrderStatus(codeToUse);
  }
}

function closeTrackingModal() {
  const modal = document.getElementById('trackingModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
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
  markRequest('tracking:get_order_status');
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
  markSetupCall('tracking');
  if (trackingEventsReady) { logDiagnostics('setupTrackingEvents:skip-duplicate'); return; }
  trackingEventsReady = true;
  const openBtn = document.getElementById('btnTracking');
  const floatBtn = document.getElementById('tracking-float-btn');
  const closeBtn = document.getElementById('trackingCloseBtn');
  const searchBtn = document.getElementById('trackingSearchBtn');
  const refreshBtn = document.getElementById('trackingRefreshBtn');
  const lastBtn = document.getElementById('trackingLastBtn');
  const input = document.getElementById('trackingCode');
  const modal = document.getElementById('trackingModal');

  markBinding('tracking:open');
  openBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    openTrackingModal();
  });

  floatBtn?.addEventListener('click', () => {
    openTrackingModal();
  });

  closeBtn?.addEventListener('click', closeTrackingModal);

  searchBtn?.addEventListener('click', () => {
    fetchOrderStatus(input?.value || '');
  });

  refreshBtn?.addEventListener('click', () => {
    if (!trackingLastCode) return;
    fetchOrderStatus(trackingLastCode);
  });

  lastBtn?.addEventListener('click', () => {
    const lastCode = getLastTrackingCode();
    if (!lastCode) return;
    if (input) input.value = lastCode;
    fetchOrderStatus(lastCode);
  });

  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      fetchOrderStatus(input.value);
    }
  });

  modal?.addEventListener('click', (event) => {
    if (event.target === modal) closeTrackingModal();
  });

  refreshTrackingLastButton();

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal?.classList.contains('open')) {
      closeTrackingModal();
    }
  });
}


function getEffectiveStoreSettings() {
  return { ...DEFAULT_STORE_SETTINGS, ...(storeSettings || {}) };
}

async function getStoreSettings() {
  markRequest('store_settings');
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
  markRequest('delivery_zones');
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
  const count = getCartCount();
  const badge = document.getElementById('cart-badge');
  const navBadge = document.getElementById('nav-cart-badge');
  if (badge) badge.textContent = count;
  if (navBadge) navBadge.textContent = count;
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
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  getStoreSettings();
  getDeliveryZones();
  refreshCartAvailability().then(() => renderCartModal());
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
  markSetupCall('cartModal');
  if (cartModalEventsReady) { logDiagnostics('setupCartModalEvents:skip-duplicate'); return; }
  cartModalEventsReady = true;
  const cartButton = document.getElementById('cart-float-btn') || document.getElementById('nav-cart-btn');
  const closeButton = document.getElementById('cart-close-btn');
  const modal = document.getElementById('cart-modal');
  const itemsContainer = document.getElementById('cart-items');
  const modalidad = document.getElementById('checkout-modalidad');
  const goCheckoutBtn = document.getElementById('go-checkout-btn');
  const backToCartBtn = document.getElementById('back-to-cart-btn');
  const receiptModal = document.getElementById('receipt-modal');
  const receiptCloseBtn = document.getElementById('receipt-close-btn');
  const trackOrderBtn = document.getElementById('btnVerEstadoPedido');

  cartButton?.addEventListener('click', openCartModal);
  closeButton?.addEventListener('click', closeCartModal);

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeCartModal();
  });

  receiptModal?.addEventListener('click', (e) => {
    if (e.target === receiptModal) closeReceiptModal();
  });

  receiptCloseBtn?.addEventListener('click', closeReceiptModal);
  trackOrderBtn?.addEventListener('click', () => {
    const code = lastOrderCode || lastOrderData?.short_id || '';
    closeReceiptModal();
    openTrackingModal(code);
  });

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

  const provincia = document.getElementById('checkout-provincia');
  const distrito = document.getElementById('checkout-distrito');

  provincia?.addEventListener('change', () => {
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
  });

  distrito?.addEventListener('change', updateCartTotalsAndAvailability);


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



async function getCustomerProfileByAuth() {
  const uid = authSession?.user?.id;
  if (!uid) {
    authProfile = null;
    return null;
  }

  const { data, error } = await supabaseClient.rpc('rpc_get_my_customer_profile');
  if (error) {
    console.warn('⚠️ No se pudo cargar perfil de cliente:', error?.message || error);
    authProfile = null;
    return null;
  }

  authProfile = data || null;
  return authProfile;
}

function setAuthFeedback(message = '', type = 'info') {
  const feedback = document.getElementById('authFeedback');
  if (!feedback) return;

  if (authFeedbackTimer) {
    clearTimeout(authFeedbackTimer);
    authFeedbackTimer = null;
  }

  feedback.textContent = message;
  feedback.className = `checkout-feedback ${type}`;

  if (message && (type === 'success' || type === 'info')) {
    authFeedbackTimer = setTimeout(() => {
      const currentFeedback = document.getElementById('authFeedback');
      if (!currentFeedback) return;
      currentFeedback.textContent = '';
      currentFeedback.className = 'checkout-feedback';
      authFeedbackTimer = null;
    }, 3200);
  }
}

function setAuthMode(mode = 'login') {
  authMode = ['login', 'register', 'reset'].includes(mode) ? mode : 'login';

  const loginView = document.getElementById('authLoginView');
  const registerView = document.getElementById('authRegisterView');
  const resetView = document.getElementById('authResetView');
  const tabLogin = document.getElementById('authTabLogin');
  const tabRegister = document.getElementById('authTabRegister');

  if (loginView) loginView.style.display = authMode === 'login' ? 'block' : 'none';
  if (registerView) registerView.style.display = authMode === 'register' ? 'block' : 'none';
  if (resetView) resetView.style.display = authMode === 'reset' ? 'block' : 'none';

  const showTabs = authMode !== 'reset';
  tabLogin?.classList.toggle('active', authMode === 'login');
  tabRegister?.classList.toggle('active', authMode === 'register');
  if (tabLogin) tabLogin.style.display = showTabs ? 'block' : 'none';
  if (tabRegister) tabRegister.style.display = showTabs ? 'block' : 'none';

  setAuthFeedback('');
}

function normalizePhoneInput(raw = '') {
  return String(raw || '').replace(/\D/g, '').slice(0, 9);
}

function normalizeDniInput(raw = '') {
  return String(raw || '').replace(/\D/g, '').slice(0, 8);
}

function getProfileAvatarUrl() {
  return String(
    authProfile?.avatar_url
    || authSession?.user?.user_metadata?.avatar_url
    || ''
  ).trim();
}

function applyProfileAvatar(profileAvatar, label = '👤', avatarUrl = '') {
  if (!profileAvatar) return;
  if (avatarUrl) {
    profileAvatar.textContent = '';
    profileAvatar.style.backgroundImage = `url(${avatarUrl})`;
    profileAvatar.style.backgroundSize = 'cover';
    profileAvatar.style.backgroundPosition = 'center';
    return;
  }
  profileAvatar.style.backgroundImage = 'none';
  profileAvatar.textContent = label || '👤';
}

function clearAvatarPreview() {
  if (avatarPreviewUrl) {
    URL.revokeObjectURL(avatarPreviewUrl);
    avatarPreviewUrl = '';
  }
}

function handleProfilePhotoPreview() {
  const profileAvatar = document.getElementById('authProfileAvatar');
  const photoInput = document.getElementById('authProfilePhoto');
  if (!profileAvatar || !photoInput) return;

  clearAvatarPreview();
  const file = photoInput.files?.[0];
  if (!file) {
    updateAuthUi();
    return;
  }

  if (!String(file.type || '').startsWith('image/')) {
    setAuthFeedback('El archivo debe ser una imagen válida.', 'error');
    photoInput.value = '';
    updateAuthUi();
    return;
  }

  avatarPreviewUrl = URL.createObjectURL(file);
  applyProfileAvatar(profileAvatar, '', avatarPreviewUrl);
}


function setAccountSection(section = 'profile') {
  const safeSection = section === 'orders' ? 'orders' : 'profile';
  authActiveSection = safeSection;

  const myOrdersBtn = document.getElementById('authMyOrdersBtn');
  const editProfileBtn = document.getElementById('authEditProfileBtn');
  myOrdersBtn?.classList.toggle('active', safeSection === 'orders');
  editProfileBtn?.classList.toggle('active', safeSection === 'profile');

  myOrdersBtn?.classList.toggle('tracking-primary', safeSection === 'orders');
  myOrdersBtn?.classList.toggle('tracking-ghost', safeSection !== 'orders');
  editProfileBtn?.classList.toggle('tracking-primary', safeSection === 'profile');
  editProfileBtn?.classList.toggle('tracking-ghost', safeSection !== 'profile');

  const profileView = document.getElementById('authProfileView');
  const ordersView = document.getElementById('authOrdersView');
  if (profileView) {
    profileView.style.display = safeSection === 'profile' ? 'block' : 'none';
  }
  if (ordersView) {
    ordersView.style.display = safeSection === 'orders' ? 'block' : 'none';
  }
}

function fillCheckoutFromAuth() {
  const nameInput = document.getElementById('checkout-nombre');
  const phoneInput = document.getElementById('checkout-telefono');
  if (!nameInput || !phoneInput) return;

  if (authProfile?.name) nameInput.value = authProfile.name;
  if (authProfile?.phone) phoneInput.value = normalizePhoneInput(authProfile.phone);
}

function updateAuthUi() {
  const loggedOut = document.getElementById('authLoggedOutView');
  const loggedIn = document.getElementById('authLoggedInView');
  const authUserInfo = document.getElementById('authUserInfo');
  const authWelcome = document.getElementById('authWelcome');
  const authFloatLabel = document.getElementById('auth-float-label');
  const topbarAccountLabel = document.getElementById('topbar-account-label');
  const profileFirstName = document.getElementById('authProfileFirstName');
  const profileLastName = document.getElementById('authProfileLastName');
  const profilePhone = document.getElementById('authProfilePhone');
  const profileDni = document.getElementById('authProfileDni');
  const profileEmail = document.getElementById('authProfileEmail');
  const profileAvatar = document.getElementById('authProfileAvatar');
  const profileEmailStatus = document.getElementById('authProfileEmailStatus');

  const isLogged = Boolean(authSession?.user);
  const forceLoggedOutUi = authRecoveryMode === true;

  if (loggedOut) loggedOut.style.display = (!isLogged || forceLoggedOutUi) ? 'block' : 'none';
  if (loggedIn) loggedIn.style.display = (isLogged && !forceLoggedOutUi) ? 'block' : 'none';

  if (isLogged && !forceLoggedOutUi) {
    const email = authSession?.user?.email || authProfile?.email || '-';
    const fullName = authProfile?.name || authSession?.user?.user_metadata?.name || 'Cliente';
    const { firstName, lastName } = splitFullName(fullName);
    if (authUserInfo) authUserInfo.textContent = '';
    if (authWelcome) authWelcome.textContent = '';
    if (authFloatLabel) authFloatLabel.textContent = 'Mi cuenta';
    if (topbarAccountLabel) topbarAccountLabel.textContent = 'Mi cuenta';
    if (profileFirstName) profileFirstName.value = firstName;
    if (profileLastName) profileLastName.value = lastName;
    if (profilePhone) profilePhone.value = normalizePhoneInput(authProfile?.phone || authSession?.user?.user_metadata?.phone || '');
    if (profileDni) profileDni.value = normalizeDniInput(authProfile?.dni || authSession?.user?.user_metadata?.dni || '');
    if (profileEmail) profileEmail.value = email === '-' ? '' : email;
    if (profileAvatar) {
      const initials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.trim().toUpperCase();
      applyProfileAvatar(profileAvatar, initials || '👤', getProfileAvatarUrl());
    }
    if (profileEmailStatus) {
      const verified = Boolean(authSession?.user?.email_confirmed_at);
      profileEmailStatus.textContent = verified ? 'Correo verificado' : 'Correo pendiente';
      profileEmailStatus.classList.toggle('pending', !verified);
    }
    setAccountSection(authActiveSection || 'profile');
    fillCheckoutFromAuth();
  } else {
    if (authUserInfo) authUserInfo.textContent = '';
    if (authWelcome) {
      authWelcome.textContent = authRecoveryMode
        ? 'Estás en recuperación de contraseña. Define tu nueva clave.'
        : 'Compra como invitado o ingresa para ver tu historial.';
    }
    if (profileAvatar) applyProfileAvatar(profileAvatar, '👤', '');
    if (profileEmailStatus) {
      profileEmailStatus.textContent = 'Correo verificado';
      profileEmailStatus.classList.remove('pending');
    }
    if (authFloatLabel) authFloatLabel.textContent = 'Ingresar';
    if (topbarAccountLabel) topbarAccountLabel.textContent = 'Iniciar sesión';
  }

  renderTopbarAccountMenu();
}

function openAuthModal() {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function openAuthModalInMode(mode = 'login') {
  setAuthMode(mode === 'register' ? 'register' : 'login');
  openAuthModal();
}

function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  setAuthFeedback('');
}

function closeMyOrdersModal() {
  setAccountSection('profile');
}

async function openMyOrdersModal() {
  const result = document.getElementById('myOrdersResult');
  if (!result) return;

  setAccountSection('orders');
  result.innerHTML = '<p>Cargando tus pedidos...</p>';

  try {
    const session = await refreshAuthSession();
    if (!session?.user?.id) {
      result.innerHTML = '<p class="tracking-error">Tu sesión expiró. Inicia sesión nuevamente.</p>';
      return;
    }

    const { data, error } = await withTimeout(
      supabaseClient.rpc('rpc_my_orders'),
      12000,
      'No se pudo cargar tu historial. Intenta de nuevo.'
    );

    if (error) {
      result.innerHTML = `<p class="tracking-error">${error.message || 'No se pudo cargar historial.'}</p>`;
      return;
    }

    if (!Array.isArray(data) || data.length === 0) {
      result.innerHTML = '<p>No tienes pedidos registrados todavía.</p>';
      return;
    }

    result.innerHTML = data.map((o) => `
      <div class="tracking-order-meta" style="padding:8px 0;border-bottom:1px solid #e4e7ec;">
        <p><strong>${o.short_code || (o.id || '').slice(-8).toUpperCase()}</strong> · ${humanTrackingStatus(o.estado)}</p>
        <p>${formatTrackingDate(o.created_at)} · ${o.modalidad || '-'} · ${formatCurrency(o.total || 0)}</p>
        <p>Pago: ${o.paid ? 'Sí' : 'No'} (${o.payment_method || 'sin definir'})</p>
      </div>
    `).join('');
  } catch (error) {
    result.innerHTML = `<p class="tracking-error">${friendlyRuntimeError(error, 'No se pudo cargar historial.')}</p>`;
  }
}

async function handleResetPasswordUpdate() {
  const password = String(document.getElementById('authResetPassword')?.value || '').trim();
  const confirm = String(document.getElementById('authResetPasswordConfirm')?.value || '').trim();

  if (!password || password.length < 6) {
    setAuthFeedback('La nueva contraseña debe tener al menos 6 caracteres.', 'error');
    return;
  }
  if (password !== confirm) {
    setAuthFeedback('La confirmación no coincide.', 'error');
    return;
  }

  const { error } = await supabaseClient.auth.updateUser({ password });
  if (error) {
    setAuthFeedback(friendlyAuthError(error), 'error');
    return;
  }

  authRecoveryMode = false;
  setAuthMode('login');
  setAccountSection('profile');
  setAuthFeedback('Contraseña actualizada ✅. Ya puedes iniciar sesión.', 'success');
}

async function handleSaveProfile() {
  if (!beginUiOp('save-profile')) return;
  const saveBtn = document.getElementById('authProfileSaveBtn');

  try {
    const session = await refreshAuthSession();
    if (!session?.user?.id) {
      setAuthFeedback('Tu sesión expiró. Inicia sesión nuevamente.', 'error');
      return;
    }

    const firstName = String(document.getElementById('authProfileFirstName')?.value || '').trim();
    const lastName = String(document.getElementById('authProfileLastName')?.value || '').trim();
    const phone = normalizePhoneInput(document.getElementById('authProfilePhone')?.value || '');
    const dni = normalizeDniInput(document.getElementById('authProfileDni')?.value || '');
    const fullName = buildFullName(firstName, lastName);
    const photoFile = document.getElementById('authProfilePhoto')?.files?.[0] || null;

    if (!firstName || !lastName || !phone || phone.length !== 9 || dni.length !== 8) {
      setAuthFeedback('Completa nombres, apellidos, teléfono (9) y DNI (8) válidos.', 'error');
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Guardando...';
    }

    const previousAvatarUrl = getProfileAvatarUrl();
    let avatarUrl = previousAvatarUrl;
    if (photoFile) {
      if (!String(photoFile.type || '').startsWith('image/')) {
        setAuthFeedback('El archivo debe ser una imagen válida.', 'error');
        return;
      }
      if (Number(photoFile.size || 0) > 2 * 1024 * 1024) {
        setAuthFeedback('La imagen no debe superar 2MB.', 'error');
        return;
      }

      const safeName = String(photoFile.name || 'avatar.jpg').replace(/[^a-zA-Z0-9_.-]/g, '_');
      const avatarPath = `${session.user.id}/${Date.now()}_${safeName}`;

      const { error: uploadError } = await withTimeout(
        supabaseClient.storage.from('avatars').upload(avatarPath, photoFile, {
          cacheControl: '3600',
          upsert: true
        }),
        20000,
        'La subida de la foto tardó demasiado.'
      );
      if (uploadError) {
        clearAvatarPreview();
        updateAuthUi();
        setAuthFeedback(`No se pudo subir foto: ${uploadError.message || 'error de storage'}`, 'error');
        return;
      }

      const { data: publicData } = supabaseClient.storage.from('avatars').getPublicUrl(avatarPath);
      avatarUrl = String(publicData?.publicUrl || '').trim();

      const { error: userMetaError } = await withTimeout(
        supabaseClient.auth.updateUser({
          data: {
            avatar_url: avatarUrl,
            avatar_path: avatarPath
          }
        }),
        12000,
        'No se pudo guardar metadata de avatar.'
      );
      if (userMetaError) {
        authProfile = { ...(authProfile || {}), avatar_url: previousAvatarUrl };
        clearAvatarPreview();
        updateAuthUi();
        setAuthFeedback(`La foto subió pero no se pudo vincular al perfil: ${userMetaError.message || 'error de metadata'}`, 'error');
        return;
      }
    }

    const { data, error } = await withTimeout(
      supabaseClient.rpc('rpc_upsert_my_customer_profile', {
        p_name: fullName,
        p_phone: phone,
        p_dni: dni,
      }),
      12000,
      'No se pudo guardar perfil. Intenta nuevamente.'
    );

    if (error) {
      setAuthFeedback(error.message || 'No se pudo guardar perfil.', 'error');
      return;
    }

    authProfile = data || authProfile;
    if (avatarUrl) {
      authProfile = {
        ...(authProfile || {}),
        avatar_url: avatarUrl
      };
    }

    await refreshAuthSession();
    clearAvatarPreview();
    const photoInput = document.getElementById('authProfilePhoto');
    if (photoInput) photoInput.value = '';
    updateAuthUi();
    setAuthFeedback('Perfil actualizado ✅', 'success');
  } catch (error) {
    setAuthFeedback(friendlyRuntimeError(error, 'No se pudo guardar perfil.'), 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar perfil';
    }
    endUiOp('save-profile');
  }
}


function beginUiOp(opKey = '') {
  if (!opKey) return true;
  if (uiBusyOps.has(opKey)) return false;
  uiBusyOps.add(opKey);
  return true;
}

function endUiOp(opKey = '') {
  if (!opKey) return;
  uiBusyOps.delete(opKey);
}

async function handleRegister() {
  if (!beginUiOp('register')) return;
  try {
    const firstName = String(document.getElementById('authRegisterFirstName')?.value || '').trim();
  const lastName = String(document.getElementById('authRegisterLastName')?.value || '').trim();
  const phone = normalizePhoneInput(document.getElementById('authRegisterPhone')?.value || '');
  const dni = normalizeDniInput(document.getElementById('authRegisterDni')?.value || '');
  const email = String(document.getElementById('authRegisterEmail')?.value || '').trim().toLowerCase();
  const password = String(document.getElementById('authRegisterPassword')?.value || '').trim();
  const name = buildFullName(firstName, lastName);

  if (!firstName || !lastName || !email || !password || phone.length !== 9 || dni.length !== 8) {
    setAuthFeedback('Completa nombres, apellidos, teléfono (9), DNI (8), correo y contraseña.', 'error');
    return;
  }

  const { data, error } = await withTimeout(
    supabaseClient.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: getAuthRedirectUrl(),
        data: { name, first_name: firstName, last_name: lastName, phone, dni }
      }
    }),
    12000,
    'El registro tardó demasiado. Intenta nuevamente.'
  );

  if (error) {
    setAuthFeedback(friendlyAuthError(error), 'error');
    return;
  }

  const existingAccount = Array.isArray(data?.user?.identities) && data.user.identities.length === 0;
  if (existingAccount) {
    setAuthFeedback('Ese correo ya está registrado. Inicia sesión o recupera tu clave.', 'error');
    setAuthMode('login');
    return;
  }

  setAuthFeedback('Te enviamos un correo de verificación. Revisa tu bandeja.', 'success');
  } catch (error) {
    setAuthFeedback(friendlyRuntimeError(error, 'No se pudo crear la cuenta.'), 'error');
  } finally {
    endUiOp('register');
  }
}

async function handleLogin() {
  const loginBtn = document.getElementById('authLoginBtn');
  if (loginBtn) loginBtn.disabled = true;

  await runCriticalUiAction('login', async () => {
    const email = String(document.getElementById('authLoginEmail')?.value || '').trim().toLowerCase();
    const password = String(document.getElementById('authLoginPassword')?.value || '').trim();
    if (!email || !password) {
      setAuthFeedback('Ingresa correo y contraseña.', 'error');
      return;
    }

    const { error } = await withTimeout(
      supabaseClient.auth.signInWithPassword({ email, password }),
      12000,
      'El inicio de sesión tardó demasiado. Intenta nuevamente.'
    );
    if (error) throw error;

    authRecoveryMode = false;
    setAuthFeedback('Sesión iniciada ✅', 'success');
    closeAuthModal();
  }, {
    timeoutMs: 15000,
    timeoutMessage: 'El inicio de sesión tardó demasiado. Intenta nuevamente.',
    onError: (error) => setAuthFeedback(friendlyRuntimeError(error, friendlyAuthError(error)), 'error')
  });

  if (loginBtn) loginBtn.disabled = false;
}

async function handleResetPassword() {
  try {
    const email = String(document.getElementById('authLoginEmail')?.value || '').trim().toLowerCase();
    if (!email) {
      setAuthFeedback('Ingresa tu correo para recuperar contraseña.', 'error');
      return;
    }

    const sentKey = `${RESET_PASSWORD_LAST_SENT_KEY}${email}`;
    const lastSentAt = Number(localStorage.getItem(sentKey) || 0);
    const remainingMs = RESET_PASSWORD_THROTTLE_MS - (Date.now() - lastSentAt);
    if (remainingMs > 0) {
      const remainingSec = Math.ceil(remainingMs / 1000);
      setAuthFeedback(`Ya enviamos un correo de restablecimiento. Revisa tu bandeja y espera ${remainingSec}s para reenviar.`, 'info');
      return;
    }

    const { error } = await withTimeout(
      supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: getRecoveryRedirectUrl()
      }),
      12000,
      'No se pudo enviar el correo de recuperación.'
    );
    if (error) {
      setAuthFeedback(friendlyAuthError(error), 'error');
      return;
    }

    localStorage.setItem(sentKey, String(Date.now()));
    setAuthFeedback('Correo de recuperación enviado ✅. Abre el link del correo para cambiar tu contraseña.', 'success');
  } catch (error) {
    setAuthFeedback(friendlyRuntimeError(error, 'No se pudo enviar el correo de recuperación.'), 'error');
  }
}

async function handleGoogleLogin() {
  try {
    const { error } = await withTimeout(
    supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: getAuthRedirectUrl() }
    }),
    12000,
    'No se pudo iniciar con Google.'
  );
    if (error) setAuthFeedback(friendlyAuthError(error), 'error');
  } catch (error) {
    setAuthFeedback(friendlyRuntimeError(error, 'No se pudo iniciar con Google.'), 'error');
  }
}

async function handleLogout() {
  if (!beginUiOp('logout')) return;
  const logoutBtn = document.getElementById('authLogoutBtn');
  if (logoutBtn) logoutBtn.disabled = true;
  let signOutError = null;

  try {
    const { error: globalError } = await withTimeout(
      supabaseClient.auth.signOut({ scope: 'global' }),
      12000,
      'No se pudo cerrar sesión en este momento.'
    );

    if (globalError) {
      const { error: localError } = await withTimeout(
        supabaseClient.auth.signOut({ scope: 'local' }),
        8000,
        'No se pudo cerrar sesión local.'
      );
      signOutError = localError || globalError;
    }
  } catch (error) {
    signOutError = error;
  } finally {
    authRecoveryMode = false;
    authSession = null;
    authProfile = null;
    setAuthMode('login');
    updateAuthUi();
    closeMyOrdersModal();

    if (signOutError) {
      setAuthFeedback(`Sesión local cerrada. ${friendlyRuntimeError(signOutError, friendlyAuthError(signOutError))}`, 'info');
    } else {
      setAuthMode('login');
      setAuthFeedback('Sesión cerrada ✅', 'success');
    }

    if (logoutBtn) logoutBtn.disabled = false;
    endUiOp('logout');
  }
}



function registerGlobalEvents(refreshSessionOnWake) {
  const onVisibility = () => {
    if (!document.hidden) refreshSessionOnWake();
  };

  const onFocus = () => refreshSessionOnWake();

  if (appUtils?.addGlobalListener) {
    appUtils.addGlobalListener(document, 'document:visibilitychange', onVisibility);
    appUtils.addGlobalListener(window, 'window:focus', onFocus);
  } else {
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
  }

  if (keepAliveIntervalId) {
    clearInterval(keepAliveIntervalId);
    appUtils?.diag?.markTimer?.(-1);
  }

  keepAliveIntervalId = setInterval(() => {
    if (document.hidden) return;
    recoverInteractiveUiState();
  }, 30000);
  appUtils?.diag?.markTimer?.(1);
}

async function initAuth() {
  if (authInitReady) return;
  authInitReady = true;

  const authBtn = document.getElementById('auth-float-btn');
  const authClose = document.getElementById('authCloseBtn');
  const authModal = document.getElementById('authModal');
  const menuToggleBtn = document.getElementById('menu-toggle-btn');

  menuToggleBtn?.addEventListener('click', () => {
    const links = Array.from(document.querySelectorAll('.nav a'));
    if (!links.length) return;
    categoryCursor = (categoryCursor + 1) % links.length;
    const link = links[categoryCursor];
    const targetId = String(link.getAttribute('href') || '').replace('#', '');
    const target = targetId ? document.getElementById(targetId) : null;
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      links.forEach((l) => l.classList.toggle('active', l === link));
    }
  });

  authBtn?.addEventListener('click', openAuthModal);
  authClose?.addEventListener('click', closeAuthModal);
  authModal?.addEventListener('click', (e) => { if (e.target === authModal) closeAuthModal(); });

  document.getElementById('authTabLogin')?.addEventListener('click', () => setAuthMode('login'));
  document.getElementById('authTabRegister')?.addEventListener('click', () => setAuthMode('register'));
  document.getElementById('authRegisterBtn')?.addEventListener('click', handleRegister);
  document.getElementById('authLoginBtn')?.addEventListener('click', handleLogin);
  document.getElementById('authGoogleBtn')?.addEventListener('click', handleGoogleLogin);
  document.getElementById('authGoogleRegisterBtn')?.addEventListener('click', handleGoogleLogin);
  document.getElementById('authResetLink')?.addEventListener('click', handleResetPassword);
  document.getElementById('authResetSaveBtn')?.addEventListener('click', handleResetPasswordUpdate);
  document.getElementById('authLogoutBtn')?.addEventListener('click', handleLogout);
  document.getElementById('authMyOrdersBtn')?.addEventListener('click', openMyOrdersModal);
  document.getElementById('authEditProfileBtn')?.addEventListener('click', () => {
    setAccountSection('profile');
  });
  document.getElementById('authProfileSaveBtn')?.addEventListener('click', handleSaveProfile);
  document.getElementById('authProfilePhoto')?.addEventListener('change', handleProfilePhotoPreview);

  setAuthMode('login');
  setAccountSection('profile');

  const hash = String(window.location.hash || '');
  const urlParams = new URLSearchParams(window.location.search);
  const queryType = String(urlParams.get('type') || '').toLowerCase();
  const recoveryModeParam = String(urlParams.get('mode') || '').toLowerCase();
  const isRecoveryLink = hash.includes('type=recovery') || queryType === 'recovery' || recoveryModeParam === 'recovery';
  const hasHashAccessToken = hash.includes('access_token=');
  const hasQueryAuthCode = urlParams.has('code') || urlParams.has('token_hash');

  let recoveryValidationError = null;
  if (isRecoveryLink) {
    try {
      if (urlParams.has('code')) {
        await withTimeout(
          supabaseClient.auth.exchangeCodeForSession(window.location.href),
          12000,
          'No se pudo validar el enlace de recuperación.'
        );
      } else if (urlParams.has('token_hash')) {
        const tokenHash = String(urlParams.get('token_hash') || '').trim();
        if (tokenHash) {
          const { error } = await withTimeout(
            supabaseClient.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash }),
            12000,
            'No se pudo validar el enlace de recuperación.'
          );
          if (error) throw error;
        }
      }
    } catch (error) {
      recoveryValidationError = error;
      console.warn('⚠️ No se pudo validar enlace de recovery:', error?.message || error);
    }
  }

  await refreshAuthSession();
  await getCustomerProfileByAuth();

  if (isRecoveryLink) {
    authRecoveryMode = true;
    setAuthMode('reset');
    openAuthModal();

    if (authSession?.user) {
      setAuthFeedback('Define tu nueva contraseña para completar la recuperación.', 'info');
    } else if (recoveryValidationError) {
      setAuthFeedback('No se pudo validar el enlace de recuperación (puede estar vencido o ya usado). Solicita uno nuevo.', 'error');
    } else {
      setAuthFeedback('No se detectó una sesión de recuperación válida. Solicita un nuevo correo.', 'error');
    }
  }

  if (hasHashAccessToken || hasQueryAuthCode || urlParams.has('type') || recoveryModeParam === 'recovery') {
    window.history.replaceState({}, document.title, getAuthRedirectUrl());
  }

  updateAuthUi();

  const refreshSessionOnWake = async () => {
    try {
      await refreshAuthSession();
    } catch (error) {
      console.warn('⚠️ No se pudo refrescar sesión al volver de inactividad:', error?.message || error);
    } finally {
      recoverInteractiveUiState();
    }
  };

  registerGlobalEvents(refreshSessionOnWake);

  if ((hasHashAccessToken || hasQueryAuthCode) && authSession?.user && !isRecoveryLink) {
    setAuthMode('login');
    setAuthFeedback('Sesión iniciada correctamente ✅', 'success');
    openAuthModal();
  }

  authSubscription?.subscription?.unsubscribe?.();
  authSubscription = supabaseClient.auth.onAuthStateChange(async (event, session) => {
    authSession = session || null;
    await getCustomerProfileByAuth();

    if (event === 'PASSWORD_RECOVERY') {
      authRecoveryMode = true;
      setAuthMode('reset');
      openAuthModal();
    }

    if (event === 'SIGNED_OUT') {
      authRecoveryMode = false;
      closeMyOrdersModal();
    }

    updateAuthUi();
  });
}

// ===============================
// CHECKOUT + SUPABASE
// ===============================
async function submitOrder(event) {
  event.preventDefault();

  if (orderSubmitBusy || uiBusyOps.has('submit-order')) return;

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

  const customerName = String(formData.get('nombre') || '').trim() || String(authProfile?.name || '').trim();
  const phoneRaw = String(formData.get('telefono') || '').trim() || String(authProfile?.phone || '').trim();
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

  if (authSession?.user) {
    try {
      await refreshAuthSession();
    } catch (error) {
      showFeedback(friendlyRuntimeError(error, 'No se pudo validar tu sesión. Inicia sesión nuevamente.'), 'error');
      return;
    }
  }

  const rpcPayload = {
    customer: {
      name: customerName,
      phone: telefonoLimpio,
      modalidad: normalizedModalidad,
      address: addressRaw || null,
      referencia: referenciaRaw || null,
      provincia: normalizedModalidad === 'Delivery' ? (totals.provincia || null) : null,
      distrito: normalizedModalidad === 'Delivery' ? (totals.distrito || null) : null,
      email: authSession?.user?.email || null
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

  let orderId = null;
  let shortId = '';
  let shortCode = '';
  let createdAt = null;

  if (!beginUiOp('submit-order')) return;

  try {
    orderSubmitBusy = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creando pedido...';

    console.log('📦 Payload RPC create_order:', getSafeOrderPayloadForLogs(rpcPayload));

    let rpcResult = await withTimeout(
      supabaseClient.rpc('create_order', { payload: rpcPayload }),
      15000,
      'No se pudo crear el pedido por tiempo de espera.'
    );

    if (rpcResult.error && isAuthSessionError(rpcResult.error) && authSession?.user) {
      const { data: refreshed, error: refreshError } = await supabaseClient.auth.refreshSession();
      if (refreshError || !refreshed?.session) {
        throw rpcResult.error;
      }
      authSession = refreshed.session;
      rpcResult = await withTimeout(
        supabaseClient.rpc('create_order', { payload: rpcPayload }),
        15000,
        'No se pudo crear el pedido por tiempo de espera.'
      );
    }

    const { data: rpcData, error: rpcError } = rpcResult;
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
    console.error('❌ Error creando pedido vía RPC:', {
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
      orderId,
      payload: getSafeOrderPayloadForLogs(rpcPayload)
    });
    const errorMessage = String(error?.message || '');
    if (errorMessage.includes('OUT_OF_STOCK') || errorMessage.includes('NOT_AVAILABLE')) {
      showFeedback('Algunos productos ya no están disponibles, elimínalos del carrito.', 'error');
      await cargarMenu();
    } else {
      const backendMessage = String(error?.message || '').trim();
      showFeedback(backendMessage ? `No se pudo crear el pedido: ${backendMessage}` : 'No se pudo crear el pedido. Revisa tu conexión o intenta de nuevo.', 'error');
    }
  } finally {
    orderSubmitBusy = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirmar pedido';
    updateCartTotalsAndAvailability();
    endUiOp('submit-order');
  }
}

function setupMenuActiveNav(nav, sections = []) {
  const links = Array.from(nav.querySelectorAll('a'));
  if (!links.length) return;

  const activateLink = (id) => {
    links.forEach((link) => {
      const isActive = link.getAttribute('href') === `#${id}`;
      link.classList.toggle('active', isActive);
    });
  };

  links.forEach((link) => {
    link.addEventListener('click', () => {
      const id = String(link.getAttribute('href') || '').replace('#', '');
      if (id) activateLink(id);
    });
  });

  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

    if (visible.length > 0) {
      const id = visible[0].target.id;
      if (id) activateLink(id);
    }
  }, { rootMargin: '-25% 0px -60% 0px', threshold: [0.1, 0.25, 0.5] });

  sections.forEach((section) => observer.observe(section));

  const firstId = sections[0]?.id;
  if (firstId) activateLink(firstId);
}



function destroyMenuRowControllers() {
  menuRowControllers.forEach((controller) => {
    try { controller.destroy(); } catch (_err) { /* noop */ }
  });
  menuRowControllers.clear();
}



function initMenuRowCarousel(row) {
  if (!row) return null;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let originals = Array.from(row.children).filter((el) => !el.hasAttribute('data-carousel-clone'));
  if (!originals.length) return null;

  let isPointerDown = false;
  let lastPointerX = 0;
  let pauseAutoUntil = 0;
  let rafId = 0;
  let isHovering = false;
  let lastFrameAt = 0;
  let resizeRafId = 0;
  let autoEnabled = false;
  let originalWidth = 0;

  const cleanupClones = () => {
    Array.from(row.querySelectorAll('[data-carousel-clone="true"]')).forEach((clone) => clone.remove());
  };

  const normalizeCircularScroll = () => {
    if (!autoEnabled || originalWidth <= 1) return;
    if (row.scrollLeft >= originalWidth) row.scrollLeft -= originalWidth;
    if (row.scrollLeft < 0) row.scrollLeft += originalWidth;
  };

  const pauseAuto = (ms = 1800) => {
    pauseAutoUntil = Date.now() + ms;
  };

  const rebuild = () => {
    cleanupClones();
    originals = Array.from(row.children).filter((el) => !el.hasAttribute('data-carousel-clone'));
    originalWidth = row.scrollWidth;
    const hasOverflow = originalWidth > (row.clientWidth + 2);

    autoEnabled = hasOverflow && !reducedMotion;

    if (autoEnabled) {
      const frag = document.createDocumentFragment();
      originals.forEach((card) => {
        const clone = card.cloneNode(true);
        clone.setAttribute('data-carousel-clone', 'true');
        clone.setAttribute('aria-hidden', 'true');
        clone.querySelectorAll('button, a, input, select, textarea').forEach((el) => {
          el.tabIndex = -1;
          el.setAttribute('aria-hidden', 'true');
        });
        frag.appendChild(clone);
      });
      row.appendChild(frag);
    }

    row.classList.toggle('auto-carousel', autoEnabled);
    row.scrollLeft = 0;

    // Recalcular una vez que cargan imágenes para no errar overflow inicial.
    row.querySelectorAll('img').forEach((img) => {
      if (img.complete) return;
      img.addEventListener('load', handleResize, { once: true });
      img.addEventListener('error', handleResize, { once: true });
    });

    row.querySelectorAll('.plato-add-mini').forEach((btn) => {
      if (btn.dataset.quickAddBound === 'true') return;
      btn.dataset.quickAddBound = 'true';
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (btn.hasAttribute('disabled')) return;
        const card = btn.closest('.plato');
        if (!card) return;
        addToCart({
          id: card.dataset.platoId,
          nombre: card.dataset.platoNombre,
          precio: Number(card.dataset.platoPrecio || 0),
          imagen: card.dataset.platoImagen || 'images/Logos/logo.jpg'
        });
        showCartToast(`✅ ${card.dataset.platoNombre || 'Plato'} agregado al carrito`);
      });
    });
  };

  const runAutoScroll = (time) => {
    if (!lastFrameAt) lastFrameAt = time;
    const deltaMs = Math.min(32, Math.max(0, time - lastFrameAt));
    lastFrameAt = time;

    if (autoEnabled && !isPointerDown && !isHovering && Date.now() >= pauseAutoUntil) {
      const pxPerSecond = 34;
      row.scrollLeft += (pxPerSecond * deltaMs) / 1000;
      normalizeCircularScroll();
    }

    rafId = window.requestAnimationFrame(runAutoScroll);
  };

  const handlePointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea')) return;
    isPointerDown = true;
    pauseAuto(2400);
    row.dataset.dragging = 'false';
    lastPointerX = event.clientX;
    row.classList.add('dragging');
    row.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event) => {
    if (!isPointerDown) return;
    const deltaX = event.clientX - lastPointerX;
    if (Math.abs(deltaX) > 2) row.dataset.dragging = 'true';
    row.scrollLeft -= deltaX * 1.35;
    normalizeCircularScroll();
    lastPointerX = event.clientX;
  };

  const releaseDrag = () => {
    if (!isPointerDown) return;
    isPointerDown = false;
    row.classList.remove('dragging');
    pauseAuto(1800);
    window.setTimeout(() => { delete row.dataset.dragging; }, 80);
  };

  const handleWheel = (event) => {
    const absX = Math.abs(event.deltaX);
    const absY = Math.abs(event.deltaY);

    if (!event.shiftKey && absY >= (absX * 1.2)) {
      pauseAuto(1200);
      return; // respetar scroll vertical de página
    }

    const horizontalDelta = absX > 0 ? event.deltaX : event.deltaY;
    row.scrollLeft += horizontalDelta * 1.1;
    normalizeCircularScroll();
    pauseAuto(1600);
    event.preventDefault();
  };

  const handleClickCapture = (event) => {
    if (row.dataset.dragging === 'true') {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const handleRowClick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const addBtn = target.closest('.plato-add-mini');
    const platoCard = target.closest('.plato');
    if (!platoCard || !row.contains(platoCard)) return;

    if (addBtn) return;

    if (target.closest('button, a, input, select, textarea')) return;

    // En card evitamos abrir modal; el agregado es directo por botón sutil.
    return;
  };

  const handleResize = () => {
    if (resizeRafId) window.cancelAnimationFrame(resizeRafId);
    resizeRafId = window.requestAnimationFrame(() => {
      rebuild();
      pauseAuto(900);
    });
  };

  row.addEventListener('pointerdown', handlePointerDown);
  row.addEventListener('pointermove', handlePointerMove);
  row.addEventListener('pointerup', releaseDrag);
  row.addEventListener('pointercancel', releaseDrag);
  row.addEventListener('pointerleave', releaseDrag);
  row.addEventListener('click', handleClickCapture, true);
  row.addEventListener('click', handleRowClick);
  row.addEventListener('wheel', handleWheel, { passive: false });
  row.addEventListener('mouseenter', () => { isHovering = true; });
  row.addEventListener('mouseleave', () => { isHovering = false; pauseAuto(900); });
  row.addEventListener('touchstart', () => pauseAuto(1700), { passive: true });
  window.addEventListener('resize', handleResize);

  rebuild();
  rafId = window.requestAnimationFrame(runAutoScroll);
  appUtils?.diag?.markRaf?.(1);

  return {
    destroy() {
      if (rafId) { window.cancelAnimationFrame(rafId); appUtils?.diag?.markRaf?.(-1); }
      if (resizeRafId) window.cancelAnimationFrame(resizeRafId);
      window.removeEventListener('resize', handleResize);
      row.removeEventListener('pointerdown', handlePointerDown);
      row.removeEventListener('pointermove', handlePointerMove);
      row.removeEventListener('pointerup', releaseDrag);
      row.removeEventListener('pointercancel', releaseDrag);
      row.removeEventListener('pointerleave', releaseDrag);
      row.removeEventListener('click', handleClickCapture, true);
      row.removeEventListener('click', handleRowClick);
      row.removeEventListener('wheel', handleWheel);
      row.classList.remove('dragging', 'auto-carousel');
      cleanupClones();
      delete row.dataset.dragging;
      row.scrollLeft = 0;
    }
  };
}

function setupMenuRowDragScroll(rows = []) {
  destroyMenuRowControllers();
  rows.forEach((row) => {
    const controller = initMenuRowCarousel(row);
    if (controller) menuRowControllers.add(controller);
  });
}


function openPlatoModal(item, imageUrl, soldOut = false) {
  const modal = document.getElementById('platoModal');
  const name = document.getElementById('platoModalName');
  const desc = document.getElementById('platoModalDesc');
  const price = document.getElementById('platoModalPrice');
  const image = document.getElementById('platoModalImage');
  const addBtn = document.getElementById('platoModalAddBtn');

  if (!modal || !name || !desc || !price || !image || !addBtn) return;

  name.textContent = item.nombre || 'Plato';
  desc.textContent = item.descripcion || 'Sin descripción';
  price.textContent = formatCurrency(item.precio);
  image.src = imageUrl || 'images/Logos/logo.jpg';
  image.alt = item.nombre || 'Detalle plato';

  addBtn.disabled = soldOut;
  addBtn.textContent = soldOut ? 'Agotado' : '+ Agregar';
  addBtn.onclick = () => {
    if (soldOut) return;
    addToCart({
      id: item.id,
      nombre: item.nombre,
      precio: item.precio,
      imagen: imageUrl
    });
    showCartToast(`✅ ${item.nombre} agregado al carrito`);
    closePlatoModal();
  };

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closePlatoModal() {
  const modal = document.getElementById('platoModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function setupMenuSearch() {
  markSetupCall('menuSearch');
  if (menuSearchReady) { logDiagnostics('setupMenuSearch:skip-duplicate'); return; }
  menuSearchReady = true;

  const input = document.getElementById('menuSearchInput');
  if (!input) return;

  input.addEventListener('input', () => {
    if (menuSearchDebounceId) clearTimeout(menuSearchDebounceId);
    menuSearchDebounceId = setTimeout(() => {
      cargarMenu();
      menuSearchDebounceId = null;
    }, 180);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    cargarMenu();
    document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}


function renderTopbarAccountMenu() {
  const topbarAccountLabel = document.getElementById('topbar-account-label');
  const menu = document.getElementById('nav-account-menu');
  const isLogged = Boolean(authSession?.user) && !authRecoveryMode;

  if (topbarAccountLabel) {
    topbarAccountLabel.textContent = isLogged ? 'Mi cuenta' : 'Iniciar sesión';
  }

  if (!menu) return;

  menu.innerHTML = isLogged
    ? `
      <button id="nav-profile-direct" type="button">Mi perfil</button>
      <button id="nav-orders-direct" type="button">Historial de pedidos</button>
      <button id="nav-logout-direct" type="button">Cerrar sesión</button>
    `
    : `
      <button id="nav-login-direct" type="button">Iniciar sesión</button>
      <button id="nav-register-direct" type="button">Registrarse</button>
    `;
}

function setupTopbarShortcuts() {
  if (topbarShortcutsReady) return;
  topbarShortcutsReady = true;

  const navCartBtn = document.getElementById('nav-cart-btn');
  const navAccountBtn = document.getElementById('nav-account-btn');
  const navTrackingBtn = document.getElementById('nav-tracking-btn');
  const menu = document.getElementById('nav-account-menu');

  renderTopbarAccountMenu();
  navCartBtn?.addEventListener('click', openCartModal);
  navTrackingBtn?.addEventListener('click', () => openTrackingModal());

  navAccountBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    menu?.classList.toggle('open');
    if (menu) menu.setAttribute('aria-hidden', menu.classList.contains('open') ? 'false' : 'true');
  });

  menu?.addEventListener('click', async (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.id === 'nav-login-direct') {
      menu.classList.remove('open');
      openAuthModalInMode('login');
      return;
    }

    if (target.id === 'nav-register-direct') {
      menu.classList.remove('open');
      openAuthModalInMode('register');
      return;
    }

    if (target.id === 'nav-profile-direct') {
      menu.classList.remove('open');
      setAccountSection('profile');
      openAuthModal();
      return;
    }

    if (target.id === 'nav-orders-direct') {
      menu.classList.remove('open');
      openAuthModal();
      await openMyOrdersModal();
      return;
    }

    if (target.id === 'nav-logout-direct') {
      menu.classList.remove('open');
      await handleLogout();
    }
  });

  document.addEventListener('click', (e) => {
    if (!menu || !navAccountBtn) return;
    if (navAccountBtn.contains(e.target)) return;
    if (menu.contains(e.target)) return;
    menu.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true');
  });
}

// ===============================
// CARGAR MENÚ Y NAVBAR
// ===============================
async function cargarMenu() {
  if (menuLoadInFlight) {
    menuLoadQueued = true;
    logDiagnostics('cargarMenu:queued');
    return menuLoadInFlight;
  }

  markRequest('menu:cargar');
  const menu = document.getElementById('menu');
  const nav = document.querySelector('.nav');
  if (!menu || !nav) return null;

  menuLoadInFlight = (async () => {
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

    menuDataCache = { platos: platosData || [], categorias: categoriasData || [] };
    platosState = new Map((menuDataCache.platos || []).map((p) => [p.id, p]));

    const searchTerm = normalizeSearchText(document.getElementById('menuSearchInput')?.value || '');

    destroyMenuRowControllers();
    menu.innerHTML = '';
    nav.innerHTML = '';

    menuDataCache.categorias.forEach(cat => {
      const items = menuDataCache.platos.filter((p) => {
        if (p.categoria_id !== cat.id) return false;
        if (!searchTerm) return true;
        const text = normalizeSearchText(`${p.nombre || ''} ${p.descripcion || ''} ${cat.nombre || ''}`);
        return text.includes(searchTerm);
      });
      if (!items.length) return;

      const navLink = document.createElement('a');
      navLink.href = `#${cat.id}`;
      navLink.textContent = cat.nombre;
      nav.appendChild(navLink);

      const categorySection = document.createElement('section');
      categorySection.className = 'menu-category';

      const h2 = document.createElement('h2');
      h2.className = 'section-title fade-up';
      h2.id = cat.id;
      h2.textContent = cat.nombre;
      categorySection.appendChild(h2);

      const row = document.createElement('div');
      row.className = 'menu-row';

      if (items.length > 0) {
        items.forEach(item => {
          const div = document.createElement('article');
          div.className = 'plato fade-up';
          const soldOut = isPlatoSoldOut(item);
          const stockText = soldOut ? '<span class="sold-out-badge">Agotado</span>' : '';

          const imageUrl = item.imagen
            ? `${SUPABASE_URL}/storage/v1/object/public/platos/${item.imagen}`
            : 'images/Logos/logo.jpg';

          div.innerHTML = `
            <img src="${imageUrl}" alt="${item.nombre}">
            <h3>${item.nombre}</h3>
            <p>${item.descripcion || ''}</p>
            <span>${formatCurrency(item.precio)}</span>
            <button class="plato-add-mini" type="button" aria-label="Agregar ${item.nombre} al pedido" ${soldOut ? 'disabled' : ''}>＋ Agregar</button>
            ${stockText}
          `;

          div.dataset.platoId = item.id || '';
          div.dataset.platoNombre = item.nombre || 'Plato';
          div.dataset.platoDesc = item.descripcion || '';
          div.dataset.platoPrecio = String(Number(item.precio || 0));
          div.dataset.platoImagen = imageUrl;
          div.dataset.platoSoldout = soldOut ? 'true' : 'false';

          row.appendChild(div);
        });
      }

      categorySection.appendChild(row);
      menu.appendChild(categorySection);
    });

    if (!menu.querySelector('.section-title')) {
      destroyMenuRowControllers();
      menu.innerHTML = '<p>No hay resultados para tu búsqueda. Prueba con otro término.</p>';
      return;
    }

    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('show');
          observer.unobserve(e.target);
        }
      });
    }, { threshold: 0.15 });

    const sectionTitles = Array.from(menu.querySelectorAll('.section-title'));
    setupMenuActiveNav(nav, sectionTitles);

    const menuRows = Array.from(menu.querySelectorAll('.menu-row'));
    setupMenuRowDragScroll(menuRows);

    document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));
  } catch (err) {
    console.error('❌ Error cargando menú:', err);
    destroyMenuRowControllers();
    menu.innerHTML = '<p>Error cargando el menú. Revisa la consola.</p>';
  } finally {
    menuLoadInFlight = null;
    if (menuLoadQueued) {
      menuLoadQueued = false;
      void cargarMenu();
    }
    logDiagnostics('cargarMenu:done');
  }
  })();

  return menuLoadInFlight;
}

// ===============================
// REFRESH MANUAL PARA FRONT
// ===============================
window.refreshMenu = async function () {
  await cargarMenu();
};

// ===============================
// BOOTSTRAP API
// ===============================

function setupRuntimeGuards() {
  if (runtimeGuardsReady) return;
  runtimeGuardsReady = true;

  const onUnhandled = (event) => {
    console.error('❌ unhandled promise rejection', event.reason || event);
    logDiagnostics('unhandledrejection');
  };

  const onError = (event) => {
    console.error('❌ runtime error', event.error || event.message || event);
    logDiagnostics('runtime-error');
  };

  if (appUtils?.addGlobalListener) {
    appUtils.addGlobalListener(window, 'window:unhandledrejection', onUnhandled);
    appUtils.addGlobalListener(window, 'window:error', onError);
    return;
  }

  window.addEventListener('unhandledrejection', onUnhandled);
  window.addEventListener('error', onError);
}

async function bootstrapAppCore() {
  setupRuntimeGuards();
  loadCart();
  updateDireccionRequired();
  updateCartBadge();
  renderCartModal();

  await getStoreSettings();
  await getDeliveryZones();
  await cargarMenu();

  const loader = document.getElementById('loader');
  if (loader) setTimeout(() => loader.classList.add('hide'), 1500);
  logDiagnostics('bootstrap:core-ready');
}

window.DPASO_APP = Object.assign(window.DPASO_APP || {}, {
  bootstrapAppCore,
  initAuth,
  setupCartModalEvents,
  setupTrackingEvents,
  setupTopbarShortcuts,
  setupMenuSearch,
  closePlatoModal,
  getDebugSnapshot: () => ({
    initCount: appUtils?.state?.initCount || 0,
    listenerCount: appUtils?.state?.listenerCount || 0,
    activeTimersCount: appUtils?.state?.timerCount || 0,
    activeRafCount: appUtils?.state?.rafCount || 0
  })
});
