import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FiMapPin, FiPhone, FiTruck } from "react-icons/fi";
import { supabase } from "../lib/supabaseClient";
import "../styles/order-detail-sedap.css";

const ORDER_STATUS = ["pending", "accepted", "preparing", "ready", "dispatched", "delivered", "completed", "cancelled"];

function humanStatus(status) {
  const map = {
    pending: "Nuevo pedido",
    accepted: "Aceptado",
    preparing: "Preparando",
    ready: "Listo",
    dispatched: "En reparto",
    delivered: "Entregado",
    completed: "Completado",
    cancelled: "Cancelado",
  };
  return map[String(status || "")] || "Sin estado";
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

export default function OrderDetail() {
  const [searchParams] = useSearchParams();
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderÍtems, setOrderÍtems] = useState([]);
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
        setOrderÍtems([]);
        setLoading(false);
        return;
      }

      const { data: itemsRows } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", current.id)
        .order("created_at", { ascending: true });

      if (!mounted) return;

      setOrderÍtems(itemsRows || []);
      setLoading(false);
    }

    run();
    return () => {
      mounted = false;
    };
  }, [searchParams]);

  const subtotal = useMemo(() => orderÍtems.reduce((acc, item) => acc + Number(item.subtotal || 0), 0), [orderÍtems]);

  const historyRows = useMemo(() => {
    if (!selectedOrder) return [];
    const rows = [
      { key: "creado", label: "Pedido creado", at: selectedOrder.created_at, tone: "done" },
      { key: "pagado", label: selectedOrder.paid ? "Pago registrado" : "Pago pendiente", at: selectedOrder.paid_at || selectedOrder.created_at, tone: selectedOrder.paid ? "done" : "muted" },
      { key: "estado", label: `Estado actual: ${humanStatus(selectedOrder.estado)}`, at: selectedOrder.updated_at || selectedOrder.created_at, tone: "current" },
    ];

    if (["delivered", "completed", "cancelled"].includes(String(selectedOrder.estado || ""))) {
      rows.push({ key: "cierre", label: `Cierre: ${humanStatus(selectedOrder.estado)}`, at: selectedOrder.updated_at || selectedOrder.created_at, tone: "done" });
    }

    return rows;
  }, [selectedOrder]);

  const updateStatus = async (nextStatus) => {
    if (!selectedOrder?.id || !ORDER_STATUS.includes(nextStatus)) return;
    setUpdating(true);
    const { error } = await supabase.from("orders").update({ estado: nextStatus }).eq("id", selectedOrder.id);
    if (!error) setSelectedOrder((prev) => ({ ...prev, estado: nextStatus }));
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

  return (
    <div className="order-detail-sedap-page">
      <header className="order-detail-header">
        <div>
          <h3>Pedido #{String(selectedOrder.short_code || selectedOrder.id).slice(-8).toUpperCase()}</h3>
          <p><span>Pedidos</span> / Detalle</p>
        </div>

        <div className="order-detail-header-actions">
          <button type="button" className="btn-outline-red" onClick={() => updateStatus("cancelled")} disabled={updating}>Cancelar pedido</button>
          <select value={selectedOrder.estado || "pending"} onChange={(e) => updateStatus(e.target.value)} disabled={updating}>
            {ORDER_STATUS.map((status) => <option key={status} value={status}>{humanStatus(status)}</option>)}
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
              <span>Qty</span>
              <span>Price</span>
              <span>Total Price</span>
            </div>

            {orderÍtems.length === 0 ? (
              <p className="empty">Sin datos</p>
            ) : (
              orderÍtems.map((item) => (
                <div key={item.id} className="item-row">
                  <div>
                    <h6>{item.nombre_snapshot || "Producto"}</h6>
                    <p>({item.cantidad || 0} reviews)</p>
                  </div>
                  <span>{item.cantidad || 0}x</span>
                  <span>{currency(item.precio_unitario_snapshot || 0)}</span>
                  <span>{currency(item.subtotal || 0)}</span>
                </div>
              ))
            )}
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
