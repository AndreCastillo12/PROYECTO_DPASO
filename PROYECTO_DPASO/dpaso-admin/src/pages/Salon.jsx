import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";

function money(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function normalizeStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "completed") return "delivered";
  return s;
}

function mapErrorMessage(message, fallback) {
  const m = String(message || "").toLowerCase();
  if (m.includes("orders_modalidad_check") || m.includes("modalidad")) return "Falta migración de Salón (modalidad). Ejecuta sprint35 en Supabase.";
  if (m.includes("table_number") || m.includes("table_ticket_open")) return "Falta migración de columnas de Salón en orders. Ejecuta sprint34/sprint35.";
  if (m.includes("restaurant_tables") || m.includes("does not exist")) return "Falta migración de mesas administrables. Ejecuta sprint35.";
  return fallback;
}

export default function Salon() {
  const { toast, showToast } = useToast(2800);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [tables, setTables] = useState([]);
  const [newTableName, setNewTableName] = useState("");

  const [orders, setOrders] = useState([]);
  const [platos, setPlatos] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderItems, setOrderItems] = useState([]);

  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [paymentReference, setPaymentReference] = useState("");

  async function loadSalonData() {
    setLoading(true);

    const [{ data: tableRows, error: tableError }, { data: ordersData, error: ordersError }, { data: platosData, error: platosError }] = await Promise.all([
      supabase.from("restaurant_tables").select("id,table_name,active").order("table_name", { ascending: true }),
      supabase
        .from("orders")
        .select("id,short_code,modalidad,estado,total,table_number,table_ticket_open,paid,payment_method,created_at")
        .eq("modalidad", "salon")
        .order("created_at", { ascending: false })
        .limit(300),
      supabase.from("platos").select("id,nombre,precio,disponible").eq("disponible", true).order("nombre", { ascending: true }),
    ]);

    if (tableError || ordersError || platosError) {
      const message = tableError?.message || ordersError?.message || platosError?.message;
      showToast(mapErrorMessage(message, "No se pudo cargar Salón"), "error");
      setLoading(false);
      return;
    }

    const safeTables = tableRows || [];
    setTables(safeTables);
    setOrders(ordersData || []);
    setPlatos(platosData || []);

    if (!selectedTable && safeTables.length > 0) {
      setSelectedTable(safeTables[0]);
    }

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

  const activeTables = useMemo(() => tables.filter((t) => t.active), [tables]);

  const openTickets = useMemo(() => {
    return orders.filter((o) => {
      const status = normalizeStatus(o.estado);
      return o.table_ticket_open && !["cancelled", "delivered"].includes(status);
    });
  }, [orders]);

  const occupiedTableNames = useMemo(() => new Set(openTickets.map((o) => String(o.table_number || "")).filter(Boolean)), [openTickets]);

  const selectedTableTicket = useMemo(() => {
    if (!selectedTable) return null;
    return openTickets.find((o) => String(o.table_number || "") === String(selectedTable.table_name));
  }, [openTickets, selectedTable]);

  const ticketTotal = useMemo(() => orderItems.reduce((acc, item) => acc + Number(item.subtotal || 0), 0), [orderItems]);

  function selectTable(table) {
    setSelectedTable(table);
    const ticket = openTickets.find((o) => String(o.table_number || "") === String(table.table_name));
    setSelectedOrder(ticket || null);
  }

  async function createTable() {
    const name = String(newTableName || "").trim();
    if (!name) {
      showToast("Ingresa un nombre de mesa", "warning");
      return;
    }

    setBusy(true);
    const { data, error } = await supabase.from("restaurant_tables").insert([{ table_name: name, active: true }]).select("id,table_name,active").single();
    if (error) {
      showToast(mapErrorMessage(error.message, "No se pudo crear mesa"), "error");
      setBusy(false);
      return;
    }

    setTables((prev) => [...prev, data].sort((a, b) => String(a.table_name).localeCompare(String(b.table_name))));
    setNewTableName("");
    setBusy(false);
    showToast("Mesa creada", "success");
  }

  async function toggleTable(table) {
    setBusy(true);
    const { data, error } = await supabase
      .from("restaurant_tables")
      .update({ active: !table.active })
      .eq("id", table.id)
      .select("id,table_name,active")
      .single();

    if (error) {
      showToast(mapErrorMessage(error.message, "No se pudo actualizar mesa"), "error");
      setBusy(false);
      return;
    }

    setTables((prev) => prev.map((t) => (t.id === data.id ? data : t)));
    setBusy(false);
  }

  async function deleteTable(table) {
    const isOccupied = occupiedTableNames.has(String(table.table_name));
    if (isOccupied) {
      showToast("No puedes eliminar una mesa ocupada", "warning");
      return;
    }

    const ok = window.confirm(`¿Eliminar ${table.table_name}?`);
    if (!ok) return;

    setBusy(true);
    const { error } = await supabase.from("restaurant_tables").delete().eq("id", table.id);
    if (error) {
      showToast(mapErrorMessage(error.message, "No se pudo eliminar mesa"), "error");
      setBusy(false);
      return;
    }

    setTables((prev) => prev.filter((t) => t.id !== table.id));
    if (selectedTable?.id === table.id) {
      setSelectedTable(null);
      setSelectedOrder(null);
      setOrderItems([]);
    }
    setBusy(false);
  }

  async function openTicket() {
    if (!selectedTable) {
      showToast("Selecciona una mesa", "warning");
      return;
    }

    if (selectedTableTicket) {
      setSelectedOrder(selectedTableTicket);
      showToast(`La ${selectedTable.table_name} ya tiene un ticket abierto`, "warning");
      return;
    }

    setBusy(true);
    const payload = {
      nombre_cliente: selectedTable.table_name,
      telefono: "000000000",
      modalidad: "salon",
      direccion: selectedTable.table_name,
      referencia: "Mesa salón",
      comentario: null,
      estado: "pending",
      subtotal: 0,
      delivery_fee: 0,
      total: 0,
      paid: false,
      table_number: selectedTable.table_name,
      table_ticket_open: true,
    };

    const { data, error } = await supabase.from("orders").insert([payload]).select("*").single();
    if (error) {
      showToast(mapErrorMessage(error.message, "No se pudo abrir ticket de mesa"), "error");
      setBusy(false);
      return;
    }

    setOrders((prev) => [data, ...prev]);
    setSelectedOrder(data);
    setOrderItems([]);
    setBusy(false);
    showToast(`Ticket abierto en ${selectedTable.table_name}`, "success");
  }

  async function syncOrderTotal(nextItems) {
    if (!selectedOrder?.id) return null;
    const nextTotal = nextItems.reduce((acc, it) => acc + Number(it.subtotal || 0), 0);
    const { data: updatedOrder, error } = await supabase
      .from("orders")
      .update({ subtotal: nextTotal, total: nextTotal, updated_at: new Date().toISOString() })
      .eq("id", selectedOrder.id)
      .select("*")
      .single();

    if (error) {
      showToast("Se actualizó item, pero no el total del ticket", "warning");
      return null;
    }

    setSelectedOrder(updatedOrder);
    setOrders((prev) => prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o)));
    return updatedOrder;
  }

  async function addItem(plato, qty = 1) {
    if (!selectedOrder?.id) {
      showToast("Primero abre un ticket", "warning");
      return;
    }

    const status = normalizeStatus(selectedOrder.estado);
    if (["cancelled", "delivered"].includes(status) || !selectedOrder.table_ticket_open) {
      showToast("No se puede editar un ticket cerrado", "error");
      return;
    }

    const amount = Number(qty);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Cantidad inválida", "error");
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
    setOrderItems(nextItems);
    await syncOrderTotal(nextItems);
    setBusy(false);
  }

  async function updateItemQuantity(item, nextQty) {
    if (!selectedOrder?.id) return;

    if (nextQty <= 0) {
      await removeItem(item.id);
      return;
    }

    setBusy(true);
    const subtotal = Number(item.precio_snapshot || 0) * nextQty;
    const { data, error } = await supabase
      .from("order_items")
      .update({ cantidad: nextQty, subtotal })
      .eq("id", item.id)
      .select("*")
      .single();

    if (error) {
      showToast("No se pudo actualizar cantidad", "error");
      setBusy(false);
      return;
    }

    const nextItems = orderItems.map((it) => (it.id === data.id ? data : it));
    setOrderItems(nextItems);
    await syncOrderTotal(nextItems);
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
    setOrderItems(nextItems);
    await syncOrderTotal(nextItems);
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
      else if (message.includes("CASH_RECEIVED")) showToast("Monto recibido inválido", "error");
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

      <section style={{ background: "#fff", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
        <h3 style={{ margin: 0 }}>Gestión de mesas</h3>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={newTableName} onChange={(e) => setNewTableName(e.target.value)} placeholder="Ej. Mesa 1 / Terraza 2" style={inputStyle} />
          <button type="button" onClick={createTable} disabled={busy} style={btnPrimary}>Crear mesa</button>
        </div>

        {tables.length === 0 ? <p style={{ margin: 0, color: "#6b7280" }}>No hay mesas configuradas. Crea la primera.</p> : (
          <div style={{ display: "grid", gap: 8 }}>
            {tables.map((table) => (
              <div key={table.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px" }}>
                <div>
                  <strong>{table.table_name}</strong>
                  <small style={{ display: "block", color: "#6b7280" }}>{table.active ? "Activa" : "Inactiva"}</small>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={() => toggleTable(table)} disabled={busy} style={btnGhost}>{table.active ? "Desactivar" : "Activar"}</button>
                  <button type="button" onClick={() => deleteTable(table)} disabled={busy} style={btnDangerGhost}>Eliminar</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ background: "#fff", borderRadius: 12, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Mesas operativas</h3>
        {activeTables.length === 0 ? <p>No hay mesas activas.</p> : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
              {activeTables.map((table) => {
                const occupied = occupiedTableNames.has(String(table.table_name));
                const isSelected = selectedTable?.id === table.id;
                return (
                  <button
                    type="button"
                    key={table.id}
                    onClick={() => selectTable(table)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: isSelected ? "2px solid #2fa67f" : "1px solid #e5e7eb",
                      background: occupied ? "#fff7ed" : "#ecfdf3",
                      color: "#111827",
                      cursor: "pointer",
                    }}
                  >
                    {table.table_name} · {occupied ? "Ocupada" : "Libre"}
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button type="button" onClick={openTicket} disabled={busy || !selectedTable} style={btnPrimary}>
                {selectedTable ? `Abrir ticket ${selectedTable.table_name}` : "Selecciona mesa"}
              </button>
              {selectedTableTicket ? <span style={{ alignSelf: "center", color: "#6b7280" }}>Ticket: {selectedTableTicket.short_code || String(selectedTableTicket.id).slice(-8)}</span> : null}
            </div>
          </>
        )}
      </section>

      <section style={{ background: "#fff", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
        <h3 style={{ marginTop: 0 }}>Ticket {selectedTable?.table_name || "-"}</h3>
        {!selectedOrder ? <p>Selecciona una mesa y abre ticket para empezar.</p> : (
          <>
            <div style={{ display: "grid", gap: 8 }}>
              <strong>Carta (sin imágenes)</strong>
              {platos.length === 0 ? <p>Sin platos disponibles.</p> : (
                <div style={{ display: "grid", gap: 6 }}>
                  {platos.map((plato) => (
                    <div key={plato.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px" }}>
                      <span>{plato.nombre}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <strong>{money(plato.precio)}</strong>
                        <button type="button" onClick={() => addItem(plato, 1)} disabled={busy} style={btnPrimaryMini}>Agregar</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {orderItems.length === 0 ? <p>Sin items</p> : (
              <div style={{ display: "grid", gap: 6 }}>
                {orderItems.map((item) => (
                  <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px" }}>
                    <div>
                      <strong>{item.nombre_snapshot}</strong>
                      <div style={{ fontSize: 13, color: "#6b7280" }}>{money(item.precio_snapshot)} c/u</div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button type="button" onClick={() => updateItemQuantity(item, Number(item.cantidad) - 1)} disabled={busy} style={btnGhost}>-</button>
                      <strong>{item.cantidad}</strong>
                      <button type="button" onClick={() => updateItemQuantity(item, Number(item.cantidad) + 1)} disabled={busy} style={btnGhost}>+</button>
                      <strong>{money(item.subtotal)}</strong>
                      <button type="button" onClick={() => removeItem(item.id)} disabled={busy} style={btnDangerGhost}>Quitar</button>
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

const btnPrimaryMini = {
  background: "#2fa67f",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "6px 8px",
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

const btnDangerGhost = {
  background: "#fff",
  color: "#b3261e",
  border: "1px solid #f1b7b3",
  borderRadius: 8,
  padding: "6px 8px",
  cursor: "pointer",
};
