import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";

const TABLES = Array.from({ length: 20 }, (_, idx) => String(idx + 1));

function money(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function normalizeStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "completed") return "delivered";
  return s;
}

export default function Salon() {
  const { toast, showToast } = useToast(2500);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [orders, setOrders] = useState([]);
  const [platos, setPlatos] = useState([]);
  const [selectedTable, setSelectedTable] = useState(TABLES[0]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  const [selectedPlato, setSelectedPlato] = useState("");
  const [qty, setQty] = useState("1");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [paymentReference, setPaymentReference] = useState("");

  async function loadSalonData() {
    setLoading(true);
    const [{ data: ordersData, error: ordersError }, { data: platosData, error: platosError }] = await Promise.all([
      supabase
        .from("orders")
        .select("id,short_code,modalidad,estado,total,table_number,table_ticket_open,paid,payment_method,created_at")
        .eq("modalidad", "salon")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("platos")
        .select("id,nombre,precio,disponible")
        .eq("disponible", true)
        .order("nombre", { ascending: true }),
    ]);

    if (ordersError || platosError) {
      showToast("No se pudo cargar Salón", "error");
      setLoading(false);
      return;
    }

    setOrders(ordersData || []);
    setPlatos(platosData || []);
    setLoading(false);
  }

  async function loadOrderItems(orderId) {
    if (!orderId) {
      setOrderItems([]);
      return;
    }

    const { data, error } = await supabase
      .from("order_items")
      .select("id,plato_id,nombre_snapshot,precio_snapshot,cantidad,subtotal")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    if (error) {
      showToast("No se pudo cargar items del ticket", "error");
      setOrderItems([]);
      return;
    }

    setOrderItems(data || []);
  }

  useEffect(() => {
    loadSalonData();
  }, []);

  useEffect(() => {
    loadOrderItems(selectedOrder?.id);
  }, [selectedOrder?.id]);

  const openTickets = useMemo(() => {
    return orders.filter((o) => {
      const status = normalizeStatus(o.estado);
      return o.table_ticket_open && !["cancelled", "delivered"].includes(status);
    });
  }, [orders]);

  const occupiedTables = useMemo(() => new Set(openTickets.map((o) => String(o.table_number || "")).filter(Boolean)), [openTickets]);

  const tableTicket = useMemo(() => openTickets.find((o) => String(o.table_number || "") === String(selectedTable)), [openTickets, selectedTable]);

  const ticketTotal = useMemo(() => orderItems.reduce((acc, item) => acc + Number(item.subtotal || 0), 0), [orderItems]);

  async function openTicket() {
    if (tableTicket) {
      setSelectedOrder(tableTicket);
      showToast(`La mesa ${selectedTable} ya tiene un ticket abierto`, "warning");
      return;
    }

    setBusy(true);
    const payload = {
      nombre_cliente: `Mesa ${selectedTable}`,
      telefono: "000000000",
      modalidad: "salon",
      direccion: null,
      referencia: null,
      comentario: null,
      estado: "pending",
      subtotal: 0,
      delivery_fee: 0,
      total: 0,
      paid: false,
      table_number: String(selectedTable),
      table_ticket_open: true,
    };

    const { data, error } = await supabase.from("orders").insert([payload]).select("*").single();
    if (error) {
      showToast("No se pudo abrir ticket de mesa", "error");
      setBusy(false);
      return;
    }

    setOrders((prev) => [data, ...prev]);
    setSelectedOrder(data);
    setOrderItems([]);
    setBusy(false);
    showToast(`Ticket abierto en mesa ${selectedTable}`, "success");
  }

  async function addItem() {
    if (!selectedOrder?.id) {
      showToast("Primero abre o selecciona un ticket", "warning");
      return;
    }

    const status = normalizeStatus(selectedOrder.estado);
    if (["cancelled", "delivered"].includes(status) || !selectedOrder.table_ticket_open) {
      showToast("No se puede agregar items a un ticket cerrado", "error");
      return;
    }

    const plato = platos.find((p) => String(p.id) === String(selectedPlato));
    const amount = Number(qty);
    if (!plato || !Number.isFinite(amount) || amount <= 0) {
      showToast("Selecciona producto y cantidad válida", "error");
      return;
    }

    const subtotal = Number(plato.precio || 0) * amount;

    setBusy(true);
    const { data, error } = await supabase
      .from("order_items")
      .insert([
        {
          order_id: selectedOrder.id,
          plato_id: plato.id,
          nombre_snapshot: plato.nombre,
          precio_snapshot: Number(plato.precio || 0),
          cantidad: amount,
          subtotal,
        },
      ])
      .select("*")
      .single();

    if (error) {
      showToast("No se pudo agregar item", "error");
      setBusy(false);
      return;
    }

    const nextItems = [...orderItems, data];
    const nextTotal = nextItems.reduce((acc, it) => acc + Number(it.subtotal || 0), 0);

    const { error: orderError, data: updatedOrder } = await supabase
      .from("orders")
      .update({ subtotal: nextTotal, total: nextTotal, updated_at: new Date().toISOString() })
      .eq("id", selectedOrder.id)
      .select("*")
      .single();

    if (orderError) {
      showToast("Item agregado, pero falló actualización de total", "warning");
    }

    setOrderItems(nextItems);
    if (updatedOrder) {
      setSelectedOrder(updatedOrder);
      setOrders((prev) => prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o)));
    }

    setQty("1");
    setBusy(false);
  }

  async function removeItem(itemId) {
    if (!selectedOrder?.id) return;

    setBusy(true);
    const { error } = await supabase.from("order_items").delete().eq("id", itemId);
    if (error) {
      showToast("No se pudo quitar item", "error");
      setBusy(false);
      return;
    }

    const nextItems = orderItems.filter((it) => it.id !== itemId);
    const nextTotal = nextItems.reduce((acc, it) => acc + Number(it.subtotal || 0), 0);

    const { data: updatedOrder } = await supabase
      .from("orders")
      .update({ subtotal: nextTotal, total: nextTotal, updated_at: new Date().toISOString() })
      .eq("id", selectedOrder.id)
      .select("*")
      .single();

    setOrderItems(nextItems);
    if (updatedOrder) {
      setSelectedOrder(updatedOrder);
      setOrders((prev) => prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o)));
    }

    setBusy(false);
  }

  async function closeTicketAndPay() {
    if (!selectedOrder?.id) {
      showToast("Selecciona un ticket", "warning");
      return;
    }

    const status = normalizeStatus(selectedOrder.estado);
    if (["cancelled", "delivered"].includes(status) || !selectedOrder.table_ticket_open) {
      showToast("Este ticket ya está cerrado", "warning");
      return;
    }

    if (ticketTotal <= 0) {
      showToast("No puedes cobrar un ticket sin items", "error");
      return;
    }

    setBusy(true);

    const payload = {
      p_order_id: selectedOrder.id,
      p_method: paymentMethod,
      p_cash_received: paymentMethod === "cash" ? Number(cashReceived || 0) : null,
      p_reference: ["card", "yape", "plin", "transfer"].includes(paymentMethod) ? String(paymentReference || "").trim() || null : null,
      p_mark_paid: true,
      p_allow_update: false,
    };

    const { error: payError } = await supabase.rpc("rpc_register_order_payment", payload);
    if (payError) {
      const message = String(payError?.message || "");
      if (message.includes("CASH_SESSION_REQUIRED")) showToast("Para cobrar en efectivo debes abrir caja", "error");
      else if (message.includes("REFERENCE_REQUIRED")) showToast("Para método digital ingresa referencia", "error");
      else showToast("No se pudo registrar el pago", "error");
      setBusy(false);
      return;
    }

    const { data: closedOrder, error: closeError } = await supabase
      .from("orders")
      .update({ estado: "delivered", table_ticket_open: false, updated_at: new Date().toISOString() })
      .eq("id", selectedOrder.id)
      .select("*")
      .single();

    if (closeError) {
      showToast("Pago guardado, pero no se pudo cerrar ticket", "warning");
      setBusy(false);
      return;
    }

    setOrders((prev) => prev.map((o) => (o.id === closedOrder.id ? closedOrder : o)));
    setSelectedOrder(closedOrder);
    showToast("Ticket cerrado y cobrado ✅", "success");
    setBusy(false);
  }

  if (loading) return <p>Cargando módulo Salón...</p>;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Toast toast={toast} />
      <h2 style={{ margin: 0 }}>Salón (Mesas)</h2>

      <section style={{ background: "#fff", borderRadius: 12, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Mesas</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 8 }}>
          {TABLES.map((table) => {
            const occupied = occupiedTables.has(String(table));
            return (
              <button
                type="button"
                key={table}
                onClick={() => {
                  setSelectedTable(table);
                  const ticket = openTickets.find((o) => String(o.table_number) === String(table));
                  setSelectedOrder(ticket || null);
                }}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: selectedTable === table ? "2px solid #2fa67f" : "1px solid #e5e7eb",
                  background: occupied ? "#fff7ed" : "#ecfdf3",
                  color: "#111827",
                  cursor: "pointer",
                }}
              >
                Mesa {table} · {occupied ? "Ocupada" : "Libre"}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <button type="button" onClick={openTicket} disabled={busy} style={btnPrimary}>Abrir ticket mesa {selectedTable}</button>
          {tableTicket ? <span style={{ alignSelf: "center", color: "#6b7280" }}>Ticket: {tableTicket.short_code || String(tableTicket.id).slice(-8)}</span> : null}
        </div>
      </section>

      <section style={{ background: "#fff", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
        <h3 style={{ marginTop: 0 }}>Ticket mesa {selectedTable}</h3>
        {!selectedOrder ? <p>Selecciona una mesa y abre ticket para empezar.</p> : (
          <>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 1fr auto" }}>
              <select value={selectedPlato} onChange={(e) => setSelectedPlato(e.target.value)} style={inputStyle}>
                <option value="">Selecciona plato</option>
                {platos.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {money(p.precio)}</option>)}
              </select>
              <input type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} style={inputStyle} />
              <button type="button" onClick={addItem} disabled={busy} style={btnPrimary}>Agregar</button>
            </div>

            {orderItems.length === 0 ? <p>Sin items</p> : (
              <div style={{ display: "grid", gap: 6 }}>
                {orderItems.map((item) => (
                  <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px" }}>
                    <div>
                      <strong>{item.nombre_snapshot}</strong>
                      <div style={{ fontSize: 13, color: "#6b7280" }}>{item.cantidad} x {money(item.precio_snapshot)}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <strong>{money(item.subtotal)}</strong>
                      <button type="button" onClick={() => removeItem(item.id)} disabled={busy} style={btnGhost}>Quitar</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
              <strong>Total ticket</strong>
              <strong>{money(ticketTotal)}</strong>
            </div>

            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} style={inputStyle}>
                <option value="cash">Efectivo</option>
                <option value="card">Tarjeta</option>
                <option value="yape">Yape</option>
                <option value="plin">Plin</option>
                <option value="transfer">Transferencia</option>
                <option value="other">Otro</option>
              </select>
              {paymentMethod === "cash" ? (
                <input type="number" min="0" step="0.01" value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} style={inputStyle} placeholder="Monto recibido" />
              ) : (
                <input type="text" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} style={inputStyle} placeholder="Referencia / voucher" />
              )}
              <button type="button" onClick={closeTicketAndPay} disabled={busy} style={btnDanger}>Cobrar y cerrar ticket</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const inputStyle = {
  border: "1px solid #dce7e2",
  borderRadius: 8,
  padding: "9px 10px",
  fontSize: 14,
};

const btnPrimary = {
  background: "#2fa67f",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 12px",
  cursor: "pointer",
};

const btnGhost = {
  background: "#fff",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: "6px 8px",
  cursor: "pointer",
};

const btnDanger = {
  background: "#b3261e",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 12px",
  cursor: "pointer",
};
