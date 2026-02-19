import fs from 'node:fs';
import path from 'node:path';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const adminMain = fs.readFileSync(path.resolve('src/main.jsx'), 'utf8');
const adminRoutes = [
  'path: "/login"',
  'path: "/reset-password"',
  'path: "pedidos"',
  'path: "caja"',
  'path: "reportes"',
  'path: "clientes"'
];

for (const token of adminRoutes) {
  assert(adminMain.includes(token), `Ruta admin faltante: ${token}`);
}

const cartaIndex = fs.readFileSync(path.resolve('../Carta-Dpaso-main/public/index.html'), 'utf8');
const cartaRequiredIds = [
  'id="checkout-form"',
  'id="confirm-order-btn"',
  'id="trackingModal"',
  'id="auth-modal"',
  'id="history-modal"'
];

for (const token of cartaRequiredIds) {
  assert(cartaIndex.includes(token), `Elemento crítico carta faltante: ${token}`);
}

const cartaScript = fs.readFileSync(path.resolve('../Carta-Dpaso-main/public/js/script.js'), 'utf8');
const cartaRequiredFns = [
  'async function submitOrder',
  'function ensureSingleAuthSubscription()',
  'function setupCheckoutSubmitDelegation()',
  'function closeCartModal()'
];

for (const token of cartaRequiredFns) {
  assert(cartaScript.includes(token), `Función crítica carta faltante: ${token}`);
}

console.log('Smoke crítico OK: rutas admin y flujos carta presentes.');
