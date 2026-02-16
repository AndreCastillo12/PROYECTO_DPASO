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

function getAuthRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
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
  const openBtn = document.getElementById('btnTracking');
  const floatBtn = document.getElementById('tracking-float-btn');
  const closeBtn = document.getElementById('trackingCloseBtn');
  const searchBtn = document.getElementById('trackingSearchBtn');
  const refreshBtn = document.getElementById('trackingRefreshBtn');
  const lastBtn = document.getElementById('trackingLastBtn');
  const input = document.getElementById('trackingCode');
  const modal = document.getElementById('trackingModal');

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
  feedback.textContent = message;
  feedback.className = `checkout-feedback ${type}`;
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
  const profileName = document.getElementById('authProfileName');
  const profilePhone = document.getElementById('authProfilePhone');

  const isLogged = Boolean(authSession?.user);
  const forceLoggedOutUi = authRecoveryMode === true;

  if (loggedOut) loggedOut.style.display = (!isLogged || forceLoggedOutUi) ? 'block' : 'none';
  if (loggedIn) loggedIn.style.display = (isLogged && !forceLoggedOutUi) ? 'block' : 'none';

  if (isLogged && !forceLoggedOutUi) {
    const email = authSession?.user?.email || authProfile?.email || '-';
    const name = authProfile?.name || 'Cliente';
    if (authUserInfo) authUserInfo.textContent = `${name} · ${email}`;
    if (authWelcome) authWelcome.textContent = 'Tu sesión está activa. Puedes comprar, editar tu perfil y revisar historial.';
    if (authFloatLabel) authFloatLabel.textContent = 'Mi cuenta';
    if (profileName) profileName.value = authProfile?.name || '';
    if (profilePhone) profilePhone.value = normalizePhoneInput(authProfile?.phone || '');
    fillCheckoutFromAuth();
  } else {
    if (authUserInfo) authUserInfo.textContent = '';
    if (authWelcome) {
      authWelcome.textContent = authRecoveryMode
        ? 'Estás en recuperación de contraseña. Define tu nueva clave.'
        : 'Compra como invitado o ingresa para ver tu historial.';
    }
    if (authFloatLabel) authFloatLabel.textContent = 'Ingresar';
  }
}

function openAuthModal() {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function closeMyOrdersModal() {
  const modal = document.getElementById('myOrdersModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

async function openMyOrdersModal() {
  const modal = document.getElementById('myOrdersModal');
  const result = document.getElementById('myOrdersResult');
  if (!modal || !result) return;

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  result.innerHTML = '<p>Cargando tus pedidos...</p>';

  const { data, error } = await supabaseClient.rpc('rpc_my_orders');
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
  setAuthFeedback('Contraseña actualizada ✅. Ya puedes iniciar sesión.', 'success');
}

async function handleSaveProfile() {
  if (!authSession?.user?.id) return;

  const name = String(document.getElementById('authProfileName')?.value || '').trim();
  const phone = normalizePhoneInput(document.getElementById('authProfilePhone')?.value || '');

  if (!name || !phone || phone.length !== 9) {
    setAuthFeedback('Completa nombre y teléfono válido (9 dígitos).', 'error');
    return;
  }

  const { data, error } = await supabaseClient.rpc('rpc_upsert_my_customer_profile', {
    p_name: name,
    p_phone: phone,
  });

  if (error) {
    setAuthFeedback(error.message || 'No se pudo guardar perfil.', 'error');
    return;
  }

  authProfile = data || authProfile;
  updateAuthUi();
  setAuthFeedback('Perfil actualizado ✅', 'success');
}

async function handleRegister() {
  const name = String(document.getElementById('authRegisterName')?.value || '').trim();
  const phone = normalizePhoneInput(document.getElementById('authRegisterPhone')?.value || '');
  const email = String(document.getElementById('authRegisterEmail')?.value || '').trim().toLowerCase();
  const password = String(document.getElementById('authRegisterPassword')?.value || '').trim();

  if (!name || !email || !password) {
    setAuthFeedback('Nombre, correo y contraseña son obligatorios.', 'error');
    return;
  }

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getAuthRedirectUrl(),
      data: { name, phone }
    }
  });

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
}

async function handleLogin() {
  const email = String(document.getElementById('authLoginEmail')?.value || '').trim().toLowerCase();
  const password = String(document.getElementById('authLoginPassword')?.value || '').trim();
  if (!email || !password) {
    setAuthFeedback('Ingresa correo y contraseña.', 'error');
    return;
  }

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    setAuthFeedback(friendlyAuthError(error), 'error');
    return;
  }
  authRecoveryMode = false;
  setAuthFeedback('Sesión iniciada ✅', 'success');
  closeAuthModal();
}

async function handleResetPassword() {
  const email = String(document.getElementById('authLoginEmail')?.value || '').trim().toLowerCase();
  if (!email) {
    setAuthFeedback('Ingresa tu correo para recuperar contraseña.', 'error');
    return;
  }
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: getAuthRedirectUrl()
  });
  if (error) {
    setAuthFeedback(friendlyAuthError(error), 'error');
    return;
  }
  setAuthFeedback('Correo de recuperación enviado ✅', 'success');
}

async function handleGoogleLogin() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: getAuthRedirectUrl() }
  });
  if (error) setAuthFeedback(friendlyAuthError(error), 'error');
}

async function handleLogout() {
  const { error } = await supabaseClient.auth.signOut({ scope: 'global' });
  if (error) {
    setAuthFeedback(friendlyAuthError(error), 'error');
    return;
  }

  authRecoveryMode = false;
  authSession = null;
  authProfile = null;
  setAuthMode('login');
  updateAuthUi();
  closeMyOrdersModal();
  closeAuthModal();
}

async function initAuth() {
  const authBtn = document.getElementById('auth-float-btn');
  const authClose = document.getElementById('authCloseBtn');
  const authModal = document.getElementById('authModal');
  const myOrdersModal = document.getElementById('myOrdersModal');

  authBtn?.addEventListener('click', openAuthModal);
  authClose?.addEventListener('click', closeAuthModal);
  authModal?.addEventListener('click', (e) => { if (e.target === authModal) closeAuthModal(); });
  myOrdersModal?.addEventListener('click', (e) => { if (e.target === myOrdersModal) closeMyOrdersModal(); });

  document.getElementById('authTabLogin')?.addEventListener('click', () => setAuthMode('login'));
  document.getElementById('authTabRegister')?.addEventListener('click', () => setAuthMode('register'));
  document.getElementById('authRegisterBtn')?.addEventListener('click', handleRegister);
  document.getElementById('authLoginBtn')?.addEventListener('click', handleLogin);
  document.getElementById('authGoogleBtn')?.addEventListener('click', handleGoogleLogin);
  document.getElementById('authResetLink')?.addEventListener('click', handleResetPassword);
  document.getElementById('authResetSaveBtn')?.addEventListener('click', handleResetPasswordUpdate);
  document.getElementById('authLogoutBtn')?.addEventListener('click', handleLogout);
  document.getElementById('authMyOrdersBtn')?.addEventListener('click', openMyOrdersModal);
  document.getElementById('authEditProfileBtn')?.addEventListener('click', () => {
    const card = document.getElementById('authProfileView');
    if (!card) return;
    const show = card.style.display === 'none' || !card.style.display;
    card.style.display = show ? 'block' : 'none';
  });
  document.getElementById('authProfileSaveBtn')?.addEventListener('click', handleSaveProfile);
  document.getElementById('myOrdersCloseBtn')?.addEventListener('click', closeMyOrdersModal);

  setAuthMode('login');

  const hash = String(window.location.hash || '');
  const isRecoveryLink = hash.includes('type=recovery');
  if (hash.includes('access_token=')) {
    window.history.replaceState({}, document.title, getAuthRedirectUrl());
  }

  const { data } = await supabaseClient.auth.getSession();
  authSession = data?.session || null;
  await getCustomerProfileByAuth();

  if (isRecoveryLink) {
    authRecoveryMode = true;
    setAuthMode('reset');
    openAuthModal();
  }

  updateAuthUi();

  if (hash.includes('access_token=') && authSession?.user && !isRecoveryLink) {
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
      setAuthMode('login');
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

  if (orderSubmitBusy) return;

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

  try {
    orderSubmitBusy = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creando pedido...';

    console.log('📦 Payload RPC create_order:', getSafeOrderPayloadForLogs(rpcPayload));

    const { data: rpcData, error: rpcError } = await supabaseClient
      .rpc('create_order', { payload: rpcPayload });

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
      showFeedback('No se pudo crear el pedido. Revisa tu conexión o intenta de nuevo.', 'error');
    }
  } finally {
    orderSubmitBusy = false;
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
            ${stockText}
            <button type="button" class="add-cart-btn" ${soldOut ? 'disabled title="Producto agotado"' : ''}>Agregar al carrito</button>
          `;

          div.querySelector('.add-cart-btn')?.addEventListener('click', () => {
            if (soldOut) return;
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
  setupTrackingEvents();
  await initAuth();
  updateDireccionRequired();
  updateCartBadge();
  renderCartModal();

  await getStoreSettings();
  await getDeliveryZones();
  await cargarMenu();

  const loader = document.getElementById('loader');
  if (loader) setTimeout(() => loader.classList.add('hide'), 1500);
});
