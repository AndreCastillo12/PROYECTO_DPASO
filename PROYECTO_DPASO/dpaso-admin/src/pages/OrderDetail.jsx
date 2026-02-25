import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FiMapPin, FiPhone, FiTruck } from "react-icons/fi";
import { supabase } from "../lib/supabaseClient";
import "../styles/order-detail-sedap.css";

const ORDER_STATUS = ["pending", "accepted", "preparing", "ready", "dispatched", "delivered", "cancelled"];

const NORMALIZED_STATUS = {
  completed: "delivered",
};

function normalizeStatus(status) {
  const key = String(status || "").toLowerCase();
  return NORMALIZED_STATUS[key] || key || "pending";
}

function isPickupOrder(order) {
  const text = String(order?.modalidad || "").toLowerCase();
  return ["recojo", "recoger", "pickup", "pick-up", "tienda", "local"].some((token) => text.includes(token));
}

function getStatusFlow(order) {
  return isPickupOrder(order)
    ? ["pending", "accepted", "preparing", "ready", "delivered"]
    : ["pending", "accepted", "preparing", "dispatched", "delivered"];
}

function getAllowedStatusChanges(order) {
  const current = normalizeStatus(order?.estado);
  if (["delivered", "cancelled"].includes(current)) return [];

  const flow = getStatusFlow(order);
  const currentIndex = flow.indexOf(current);
  const next = currentIndex >= 0 && currentIndex < flow.length - 1 ? [flow[currentIndex + 1]] : [];
  if (current !== "cancelled") next.push("cancelled");
  return next;
}

const PAYMENT_METHODS = ["cash", "yape", "plin", "card", "transfer", "other"];

function humanStatus(status) {
  const map = {
    pending: "Pendiente",
    accepted: "Aceptado",
    preparing: "Preparando",
    ready: "Listo",
    dispatched: "En reparto",
    delivered: "Entregado",
    cancelled: "Cancelado",
  };
  return map[normalizeStatus(status)] || "Sin estado";
}

function humanPayment(method) {
  const map = { cash: "Efectivo", yape: "Yape", plin: "Plin", card: "Tarjeta", transfer: "Transferencia", other: "Otro" };
  return map[String(method || "").toLowerCase()] || "Sin definir";
}

function currency(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function normalizePhoneForWa(phoneValue) {
  const digits = String(phoneValue || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("51") ? digits : `51${digits}`;
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function OrderDetail() {
  const [searchParams] = useSearchParams();
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function run() {
      setLoading(true);
      const orderId = searchParams.get("order_id");

      const { data: orderRows } = orderId
        ? await supabase.from("orders").select("*").eq("id", orderId).limit(1)
        : await supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(1);

      const current = orderRows?.[0] || null;
      if (!mounted) return;

      setSelectedOrder(current);

      if (!current?.id) {
        setOrderItems([]);
        setLoading(false);
        return;
      }

      const { data: itemsRows } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", current.id)
        .order("created_at", { ascending: true });

      if (!mounted) return;
      setOrderItems(itemsRows || []);
      setLoading(false);
    }

    run();
    return () => {
      mounted = false;
    };
  }, [searchParams]);

  const subtotal = useMemo(() => orderItems.reduce((acc, item) => acc + Number(item.subtotal || 0), 0), [orderItems]);

  const historyRows = useMemo(() => {
    if (!selectedOrder) return [];
    const rows = [
      { key: "creado", label: "Pedido creado", at: selectedOrder.created_at, tone: "done" },
      { key: "pagado", label: selectedOrder.paid ? "Pago registrado" : "Pago pendiente", at: selectedOrder.paid_at || selectedOrder.created_at, tone: selectedOrder.paid ? "done" : "muted" },
      { key: "estado", label: `Estado actual: ${humanStatus(selectedOrder.estado)}`, at: selectedOrder.updated_at || selectedOrder.created_at, tone: "current" },
    ];

    if (["delivered", "cancelled"].includes(normalizeStatus(selectedOrder.estado))) {
      rows.push({ key: "cierre", label: `Cierre: ${humanStatus(selectedOrder.estado)}`, at: selectedOrder.updated_at || selectedOrder.created_at, tone: "done" });
    }

    return rows;
  }, [selectedOrder]);

  const updateStatus = async (nextStatus) => {
    if (!selectedOrder?.id || !ORDER_STATUS.includes(nextStatus)) return;
    if (!getAllowedStatusChanges(selectedOrder).includes(nextStatus)) return;
    setUpdating(true);
    const { error } = await supabase.from("orders").update({ estado: nextStatus }).eq("id", selectedOrder.id);
    if (!error) setSelectedOrder((prev) => ({ ...prev, estado: nextStatus }));
    setUpdating(false);
  };

  const savePayment = async () => {
    if (!selectedOrder?.id) return;
    setUpdating(true);

    const isPaid = Boolean(selectedOrder.paid);
    const method = selectedOrder.payment_method || null;
    const total = safeNumber(selectedOrder.total);
    const received = safeNumber(selectedOrder.cash_received);
    const change = isPaid && method === "cash" ? received - total : 0;

    const { error } = await supabase
      .from("orders")
      .update({
        paid: isPaid,
        payment_method: method,
        paid_at: isPaid ? new Date().toISOString() : null,
        cash_received: isPaid && method === "cash" ? received : null,
        cash_change: isPaid && method === "cash" ? change : null,
      })
      .eq("id", selectedOrder.id);

    if (!error) {
      setSelectedOrder((prev) => ({
        ...prev,
        paid: isPaid,
        payment_method: method,
        paid_at: isPaid ? (prev.paid_at || new Date().toISOString()) : null,
        cash_received: isPaid && method === "cash" ? received : null,
        cash_change: isPaid && method === "cash" ? change : null,
      }));
    }

    setUpdating(false);
  };

  const notifyWhatsApp = () => {
    if (!selectedOrder) return;
    const waPhone = normalizePhoneForWa(selectedOrder.telefono);
    if (!waPhone) return;

    const msg = [
      `Hola ${selectedOrder.nombre_cliente || "cliente"},`,
      `tu pedido está ${humanStatus(selectedOrder.estado).toLowerCase()}.`,
      `Total ${currency(selectedOrder.total)}.`,
      "Gracias por tu compra en Dpaso.",
    ].join("\n");

    window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  };

  if (loading) return <p>Cargando detalle...</p>;
  if (!selectedOrder) return <p>Sin pedidos para mostrar.</p>;

  const availableStatusChanges = getAllowedStatusChanges(selectedOrder);
  const canCancel = availableStatusChanges.includes("cancelled");

  return (
    <div className="order-detail-sedap-page">
      <header className="order-detail-header">
        <div>
          <h3>Pedido #{String(selectedOrder.short_code || selectedOrder.id).slice(-8).toUpperCase()}</h3>
          <p><span>Pedidos</span> / Detalle</p>
        </div>

        <div className="order-detail-header-actions">
          <button type="button" className="btn-outline-red" onClick={() => updateStatus("cancelled")} disabled={updating || !canCancel}>Cancelar pedido</button>
          <select value={normalizeStatus(selectedOrder.estado)} onChange={(e) => updateStatus(e.target.value)} disabled={updating || availableStatusChanges.length === 0}>
            {[normalizeStatus(selectedOrder.estado), ...availableStatusChanges]
              .filter((status, index, arr) => arr.indexOf(status) === index)
              .map((status) => <option key={status} value={status}>{humanStatus(status)}</option>)}
          </select>
        </div>
      </header>

      <div className="order-detail-grid">
        <aside className="order-left-col">
          <article className="customer-card">
            <div className="avatar">{String(selectedOrder.nombre_cliente || "C").charAt(0).toUpperCase()}</div>
            <h4>{selectedOrder.nombre_cliente || "Cliente"}</h4>
            <span className="mini-badge">Cliente</span>
          </article>

          <article className="note-card">
            <h5>Nota del pedido</h5>
            <p>{selectedOrder.comentario || "Sin nota registrada por ahora."}</p>
            <div className="address-chip"><FiMapPin size={14} /> {selectedOrder.direccion || selectedOrder.referencia || "Sin dirección"}</div>
          </article>

          <article className="history-card">
            <h5>Historial</h5>
            <ul>
              {historyRows.map((row) => (
                <li key={row.key}>
                  <span className={`dot ${row.tone}`} />
                  <div>
                    <strong>{row.label}</strong>
                    <small>{formatDate(row.at)}</small>
                  </div>
                </li>
              ))}
            </ul>
          </article>
        </aside>

        <section className="order-main-col">
          <article className="items-card">
            <div className="items-head">
              <strong>Ítems</strong>
              <span>Cant.</span>
              <span>Precio</span>
              <span>Total</span>
            </div>

            {orderItems.length === 0 ? (
              <p className="empty">Sin datos</p>
            ) : (
              orderItems.map((item) => (
                <div key={item.id} className="item-row">
                  <div>
                    <h6>{item.nombre_snapshot || "Producto"}</h6>
                    <p>{item.cantidad || 0} unidad(es)</p>
                  </div>
                  <span>{item.cantidad || 0}x</span>
                  <span>{currency((Number(item.precio_unitario_snapshot) > 0 ? item.precio_unitario_snapshot : (safeNumber(item.subtotal) / Math.max(safeNumber(item.cantidad), 1))))}</span>
                  <span>{currency(item.subtotal || 0)}</span>
                </div>
              ))
            )}
          </article>

          <article className="payment-card">
            <h5>Pago</h5>
            <div className="payment-grid">
              <label className="payment-field">
                Método de pago
                <select value={selectedOrder.payment_method || ""} onChange={(e) => setSelectedOrder((prev) => ({ ...prev, payment_method: e.target.value }))}>
                  <option value="">Sin definir</option>
                  {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{humanPayment(method)}</option>)}
                </select>
              </label>
              <label className="paid-toggle">
                <input type="checkbox" checked={Boolean(selectedOrder.paid)} onChange={(e) => setSelectedOrder((prev) => ({ ...prev, paid: e.target.checked }))} />
                <span>Pedido pagado</span>
              </label>
            </div>
            {Boolean(selectedOrder.paid) && selectedOrder.payment_method === "cash" ? (
              <label className="payment-field payment-cash-row">
                Efectivo recibido
                <input type="number" min="0" step="0.01" value={selectedOrder.cash_received ?? ""} onChange={(e) => {
                  const received = safeNumber(e.target.value);
                  const total = safeNumber(selectedOrder.total);
                  setSelectedOrder((prev) => ({ ...prev, cash_received: e.target.value, cash_change: received - total }));
                }} />
              </label>
            ) : null}
            <div className="payment-foot">
              <span>Total: <strong>{currency(selectedOrder.total)}</strong></span>
              <span>Vuelto: <strong>{currency(selectedOrder.cash_change || 0)}</strong></span>
              <button type="button" onClick={savePayment} disabled={updating}>Guardar pago</button>
            </div>
          </article>

          <article className="track-card">
            <div className="track-map-placeholder">
              <div className="track-title">Rastreo del pedido</div>
              <div className="route-line" />
            </div>

            <div className="delivery-footer">
              <div>
                <small>Reparto</small>
                <h6>{selectedOrder.delivery_person || "Repartidor asignado"}</h6>
              </div>

              <div className="delivery-contact-actions">
                <button type="button" onClick={notifyWhatsApp}><FiPhone size={14} /> Contactar</button>
                <button type="button"><FiTruck size={14} /> {selectedOrder.modalidad || "Delivery"}</button>
              </div>
            </div>

            <div className="totals-row">
              <span>Subtotal</span>
              <strong>{currency(subtotal)}</strong>
            </div>
            <div className="totals-row">
              <span>Total</span>
              <strong>{currency(selectedOrder.total)}</strong>
            </div>
          </article>
        </section>
      </div>
    </div>
  );
}
