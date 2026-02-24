import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "../styles/order-detail-sedap.css";

const ORDER_STATUS = ["pending", "accepted", "preparing", "ready", "dispatched", "delivered", "completed", "cancelled"];

function humanStatus(status) {
  const map = {
    pending: "Pendiente",
    accepted: "Aceptado",
    preparing: "Preparando",
    ready: "Listo",
    dispatched: "En camino",
    delivered: "Entregado",
    completed: "Completado",
    cancelled: "Cancelado",
  };
  return map[String(status || "")] || "Sin estado";
}

function currency(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function normalizePhoneForWa(phoneValue) {
  const digits = String(phoneValue || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("51") ? digits : `51${digits}`;
}

export default function OrderDetail() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function run() {
      setLoading(true);
      const { data } = await supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(40);
      if (!mounted) return;

      const rows = data || [];
      const requested = searchParams.get("order_id");
      const current = rows.find((row) => row.id === requested) || rows[0] || null;

      setOrders(rows);
      setSelectedOrder(current);
      setLoading(false);
    }

    run();
    return () => {
      mounted = false;
    };
  }, [searchParams]);

  useEffect(() => {
    let mounted = true;

    async function run() {
      if (!selectedOrder?.id) {
        if (mounted) setOrderItems([]);
        return;
      }
      const { data } = await supabase.from("order_items").select("*").eq("order_id", selectedOrder.id).order("created_at", { ascending: true });
      if (!mounted) return;
      setOrderItems(data || []);
    }

    run();
    return () => {
      mounted = false;
    };
  }, [selectedOrder?.id]);

  const selectOrder = (order) => {
    setSelectedOrder(order);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("order_id", order.id);
      return next;
    });
  };

  const subtotal = useMemo(() => orderItems.reduce((acc, item) => acc + Number(item.subtotal || 0), 0), [orderItems]);

  const updateStatus = async (nextStatus) => {
    if (!selectedOrder?.id || !ORDER_STATUS.includes(nextStatus)) return;
    setUpdating(true);
    const { error } = await supabase.from("orders").update({ estado: nextStatus }).eq("id", selectedOrder.id);
    if (!error) {
      const updated = { ...selectedOrder, estado: nextStatus };
      setSelectedOrder(updated);
      setOrders((prev) => prev.map((item) => (item.id === selectedOrder.id ? updated : item)));
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

  if (loading) return <p>Cargando pedidos...</p>;

  return (
    <div className="order-detail-page">
      <aside className="order-list-panel">
        <div className="order-list-head">
          <h3>Order List</h3>
          <small>{orders.length} pedidos</small>
        </div>

        <div className="order-list-scroll">
          {orders.map((order) => (
            <button key={order.id} type="button" className={`order-list-item ${selectedOrder?.id === order.id ? "is-active" : ""}`} onClick={() => selectOrder(order)}>
              <strong>#{String(order.short_code || order.id).slice(-8).toUpperCase()}</strong>
              <span>{order.nombre_cliente || "Cliente"}</span>
              <span>{new Date(order.created_at).toLocaleString()}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="order-detail-card">
        {!selectedOrder ? (
          <p className="empty">Sin datos</p>
        ) : (
          <>
            <header className="order-detail-head">
              <div>
                <h3>Order ID #{String(selectedOrder.short_code || selectedOrder.id).slice(-8).toUpperCase()}</h3>
                <p>{selectedOrder.nombre_cliente || "Cliente"} · {selectedOrder.telefono || "Sin teléfono"}</p>
              </div>
              <div className="order-detail-actions">
                <button type="button" className="btn-outline" onClick={notifyWhatsApp}>WhatsApp</button>
                <select value={selectedOrder.estado || "pending"} onChange={(e) => updateStatus(e.target.value)} disabled={updating}>
                  {ORDER_STATUS.map((status) => <option key={status} value={status}>{humanStatus(status)}</option>)}
                </select>
              </div>
            </header>

            <div className="order-meta-grid">
              <article><small>Modalidad</small><strong>{selectedOrder.modalidad || "-"}</strong></article>
              <article><small>Dirección</small><strong>{selectedOrder.direccion || "-"}</strong></article>
              <article><small>Estado</small><strong>{humanStatus(selectedOrder.estado)}</strong></article>
              <article><small>Total</small><strong>{currency(selectedOrder.total)}</strong></article>
            </div>

            <article className="order-items-card">
              <h4>Items</h4>
              {orderItems.length === 0 ? <p className="empty">Sin datos</p> : (
                <table>
                  <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
                  <tbody>
                    {orderItems.map((item) => (
                      <tr key={item.id}>
                        <td>{item.nombre_snapshot || "Producto"}</td>
                        <td>{item.cantidad || 0}</td>
                        <td>{currency(item.precio_unitario_snapshot || 0)}</td>
                        <td>{currency(item.subtotal || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="order-total-row">
                <span>Subtotal items</span>
                <strong>{currency(subtotal)}</strong>
              </div>
            </article>
          </>
        )}
      </section>
    </div>
  );
}
