import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";

function money(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function toErrorMessage(error, fallback) {
  const msg = String(error?.message || "");
  return msg ? `${fallback}: ${msg}` : fallback;
}

function normalizeTableLabel(name) {
  return String(name || "").trim();
}

async function loadPlatosCompatible() {
  const attempts = [
    "id,nombre,precio,categoria_id,orden,imagen",
    "id,nombre,precio,categoria_id,orden",
    "id,nombre,precio,categoria_id",
    "id,nombre,precio",
  ];

  for (const selectCols of attempts) {
    const { data, error } = await supabase
      .from("platos")
      .select(selectCols)
      .order("nombre", { ascending: true });

    if (!error) return { data: data || [], error: null };
  }

  const last = await supabase.from("platos").select("id,nombre,precio");
  return { data: last.data || [], error: last.error || null };
}

export default function Salon() {
  const { toast, showToast } = useToast(3000);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [tables, setTables] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [platos, setPlatos] = useState([]);

  const [selectedTable, setSelectedTable] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketItems, setTicketItems] = useState([]);

  const [newTableName, setNewTableName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [paymentReference, setPaymentReference] = useState("");

  async function loadBaseData() {
    setLoading(true);

    const [tablesResp, ticketsResp, platosResp] = await Promise.all([
      supabase.from("restaurant_tables").select("id,table_name,active").order("table_name", { ascending: true }),
      supabase
        .from("table_tickets")
        .select("id,table_id,status,opened_by,closed_by,generated_order_id,opened_at,closed_at")
        .order("opened_at", { ascending: false }),
      loadPlatosCompatible(),
    ]);

    if (tablesResp.error) showToast(toErrorMessage(tablesResp.error, "Error cargando mesas"), "warning");
    if (ticketsResp.error) showToast(toErrorMessage(ticketsResp.error, "Error cargando tickets"), "warning");
    if (platosResp.error) showToast(toErrorMessage(platosResp.error, "Error cargando carta"), "warning");

    const tableRows = tablesResp.data || [];
    const ticketRows = ticketsResp.data || [];
    const platosRows = (platosResp.data || []).filter((p) => Number(p.precio || 0) >= 0);

    setTables(tableRows);
    setTickets(ticketRows);
    setPlatos(platosRows);

    if (!selectedTable && tableRows.length > 0) {
      setSelectedTable(tableRows[0]);
    }

    setLoading(false);
  }

  async function loadTicketItems(ticketId) {
    if (!ticketId) {
      setTicketItems([]);
      return;
    }

    const { data, error } = await supabase
      .from("table_ticket_items")
      .select("id,ticket_id,plato_id,qty,price_snapshot,notes,status,name_snapshot")
      .eq("ticket_id", ticketId)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (error) {
      showToast(toErrorMessage(error, "Error cargando items del ticket"), "error");
      setTicketItems([]);
      return;
    }

    setTicketItems(data || []);
  }

  useEffect(() => {
    loadBaseData();
  }, []);

  useEffect(() => {
    loadTicketItems(selectedTicket?.id);
  }, [selectedTicket?.id]);

  const activeTables = useMemo(() => tables.filter((t) => t.active), [tables]);

  const openTicketsByTableId = useMemo(() => {
    const map = new Map();
    (tickets || []).forEach((t) => {
      if (t.status === "open") map.set(t.table_id, t);
    });
    return map;
  }, [tickets]);

  const ticketTotal = useMemo(() => {
    return ticketItems.reduce((acc, item) => acc + Number(item.price_snapshot || 0) * Number(item.qty || 0), 0);
  }, [ticketItems]);

  function selectTable(table) {
    setSelectedTable(table);
    const openTicket = openTicketsByTableId.get(table.id) || null;
    setSelectedTicket(openTicket);
  }

  async function createTable() {
    const name = normalizeTableLabel(newTableName);
    if (!name) {
      showToast("Ingresa nombre de mesa", "warning");
      return;
    }

    setBusy(true);
    const { data, error } = await supabase
      .from("restaurant_tables")
      .insert([{ table_name: name, active: true }])
      .select("id,table_name,active")
      .single();

    if (error) {
      showToast(toErrorMessage(error, "No se pudo crear mesa"), "error");
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
      showToast(toErrorMessage(error, "No se pudo actualizar mesa"), "error");
      setBusy(false);
      return;
    }

    setTables((prev) => prev.map((t) => (t.id === data.id ? data : t)));
    setBusy(false);
  }

  async function deleteTable(table) {
    if (openTicketsByTableId.has(table.id)) {
      showToast("No puedes eliminar una mesa con ticket abierto", "warning");
      return;
    }

    const ok = window.confirm(`¿Eliminar ${table.table_name}?`);
    if (!ok) return;

    setBusy(true);
    const { error } = await supabase.from("restaurant_tables").delete().eq("id", table.id);
    if (error) {
      showToast(toErrorMessage(error, "No se pudo eliminar mesa"), "error");
      setBusy(false);
      return;
    }

    setTables((prev) => prev.filter((t) => t.id !== table.id));
    if (selectedTable?.id === table.id) {
      setSelectedTable(null);
      setSelectedTicket(null);
      setTicketItems([]);
    }
    setBusy(false);
  }

  async function openTicket() {
    if (!selectedTable) {
      showToast("Selecciona una mesa", "warning");
      return;
    }

    if (openTicketsByTableId.has(selectedTable.id)) {
      const current = openTicketsByTableId.get(selectedTable.id);
      setSelectedTicket(current);
      showToast("Esa mesa ya tiene ticket abierto", "warning");
      return;
    }

    setBusy(true);
    const { data, error } = await supabase
      .from("table_tickets")
      .insert([{ table_id: selectedTable.id, status: "open" }])
      .select("id,table_id,status,opened_by,closed_by,generated_order_id,opened_at,closed_at")
      .single();

    if (error) {
      showToast(toErrorMessage(error, "No se pudo abrir ticket"), "error");
      setBusy(false);
      return;
    }

    setTickets((prev) => [data, ...prev]);
    setSelectedTicket(data);
    setTicketItems([]);
    setBusy(false);
    showToast("Ticket abierto", "success");
  }

  async function addItem(plato) {
    if (!selectedTicket?.id) {
      showToast("Abre o selecciona ticket", "warning");
      return;
    }

    if (selectedTicket.status !== "open") {
      showToast("El ticket está cerrado", "warning");
      return;
    }

    setBusy(true);
    const { data, error } = await supabase
      .from("table_ticket_items")
      .insert([
        {
          ticket_id: selectedTicket.id,
          plato_id: plato.id,
          qty: 1,
          price_snapshot: Number(plato.precio || 0),
          notes: null,
          status: "active",
          name_snapshot: plato.nombre || "Producto",
        },
      ])
      .select("id,ticket_id,plato_id,qty,price_snapshot,notes,status,name_snapshot")
      .single();

    if (error) {
      showToast(toErrorMessage(error, "No se pudo agregar item"), "error");
      setBusy(false);
      return;
    }

    setTicketItems((prev) => [...prev, data]);
    setBusy(false);
  }

  async function updateQty(item, nextQty) {
    if (!selectedTicket?.id) return;

    if (nextQty <= 0) {
      await removeItem(item.id);
      return;
    }

    setBusy(true);
    const { data, error } = await supabase
      .from("table_ticket_items")
      .update({ qty: nextQty })
      .eq("id", item.id)
      .select("id,ticket_id,plato_id,qty,price_snapshot,notes,status,name_snapshot")
      .single();

    if (error) {
      showToast(toErrorMessage(error, "No se pudo actualizar item"), "error");
      setBusy(false);
      return;
    }

    setTicketItems((prev) => prev.map((it) => (it.id === data.id ? data : it)));
    setBusy(false);
  }

  async function removeItem(itemId) {
    setBusy(true);
    const { error } = await supabase.from("table_ticket_items").delete().eq("id", itemId);
    if (error) {
      showToast(toErrorMessage(error, "No se pudo quitar item"), "error");
      setBusy(false);
      return;
    }

    setTicketItems((prev) => prev.filter((it) => it.id !== itemId));
    setBusy(false);
  }

  async function closeTicketGenerateOrder() {
    if (!selectedTicket?.id || !selectedTable?.id) {
      showToast("Selecciona ticket", "warning");
      return;
    }

    if (selectedTicket.status !== "open") {
      showToast("El ticket ya está cerrado", "warning");
      return;
    }

    if (ticketItems.length === 0) {
      showToast("Agrega items antes de generar pedido", "warning");
      return;
    }

    setBusy(true);

    const subtotal = ticketItems.reduce((acc, item) => acc + (Number(item.price_snapshot || 0) * Number(item.qty || 0)), 0);

    const orderPayload = {
      nombre_cliente: selectedTable.table_name,
      telefono: "000000000",
      modalidad: "salon",
      direccion: selectedTable.table_name,
      referencia: "Ticket salón",
      comentario: null,
      subtotal,
      delivery_fee: 0,
      total: subtotal,
      estado: "pending",
      paid: false,
      table_number: selectedTable.table_name,
      table_ticket_open: false,
      table_id: selectedTable.id,
      ticket_id: selectedTicket.id,
    };

    const { data: orderData, error: orderError } = await supabase
      .from("orders")
      .insert([orderPayload])
      .select("id,short_code")
      .single();

    if (orderError) {
      showToast(toErrorMessage(orderError, "No se pudo generar pedido final"), "error");
      setBusy(false);
      return;
    }

    const itemsPayload = ticketItems.map((item) => ({
      order_id: orderData.id,
      plato_id: item.plato_id,
      nombre_snapshot: item.name_snapshot,
      precio_snapshot: Number(item.price_snapshot || 0),
      cantidad: Number(item.qty || 0),
      subtotal: Number(item.price_snapshot || 0) * Number(item.qty || 0),
    }));

    const { error: itemsError } = await supabase.from("order_items").insert(itemsPayload);
    if (itemsError) {
      showToast(toErrorMessage(itemsError, "Pedido creado, pero falló copiar items"), "warning");
    }

    const { data: closedTicket, error: closeError } = await supabase
      .from("table_tickets")
      .update({ status: "closed", closed_at: new Date().toISOString(), generated_order_id: orderData.id })
      .eq("id", selectedTicket.id)
      .select("id,table_id,status,opened_by,closed_by,generated_order_id,opened_at,closed_at")
      .single();

    if (closeError) {
      showToast(toErrorMessage(closeError, "Pedido generado, pero ticket no se cerró"), "warning");
      setBusy(false);
      return;
    }

    setTickets((prev) => prev.map((t) => (t.id === closedTicket.id ? closedTicket : t)));
    setSelectedTicket(closedTicket);
    setTicketItems([]);
    setBusy(false);
    showToast(`Pedido ${orderData.short_code || String(orderData.id).slice(-8)} generado. Ahora registra pago en Pedidos/Caja.`, "success");
  }

  if (loading) return <p>Cargando módulo Salón...</p>;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Toast toast={toast} />
      <h2 style={{ margin: 0 }}>Salón (Mesas)</h2>

      <section style={{ background: "#fff", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
        <h3 style={{ margin: 0 }}>Gestión de mesas</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={newTableName} onChange={(e) => setNewTableName(e.target.value)} placeholder="Ej. Mesa 1 / Terraza" style={inputStyle} />
          <button type="button" onClick={createTable} disabled={busy} style={btnPrimary}>Crear mesa</button>
        </div>

        {tables.length === 0 ? <p style={{ margin: 0 }}>No hay mesas configuradas. Crea la primera.</p> : (
          <div style={{ display: "grid", gap: 8 }}>
            {tables.map((table) => (
              <div key={table.id} style={{ ...rowBox, justifyContent: "space-between" }}>
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8 }}>
              {activeTables.map((table) => {
                const open = openTicketsByTableId.get(table.id);
                const selected = selectedTable?.id === table.id;
                return (
                  <button key={table.id} type="button" onClick={() => selectTable(table)} style={{ ...tableBtn, border: selected ? "2px solid #2fa67f" : "1px solid #e5e7eb", background: open ? "#fff7ed" : "#ecfdf3" }}>
                    {table.table_name} · {open ? "Ocupada" : "Libre"}
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" onClick={openTicket} disabled={busy || !selectedTable} style={btnPrimary}>Abrir ticket</button>
              {selectedTable ? <small>Mesa seleccionada: <strong>{selectedTable.table_name}</strong></small> : null}
              {selectedTicket ? <small>Ticket: <strong>{selectedTicket.id.slice(0, 8).toUpperCase()}</strong> ({selectedTicket.status})</small> : null}
            </div>
          </>
        )}
      </section>

      <section style={{ background: "#fff", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
        <h3 style={{ marginTop: 0 }}>Ticket {selectedTable?.table_name || "-"}</h3>
        {!selectedTicket || selectedTicket.status !== "open" ? <p>Selecciona mesa y abre ticket para empezar.</p> : (
          <>
            <div style={{ display: "grid", gap: 8 }}>
              <strong>Carta compacta (sin imágenes)</strong>
              {platos.length === 0 ? <p>Sin platos disponibles.</p> : (
                <div style={{ display: "grid", gap: 6 }}>
                  {platos.map((plato) => (
                    <div key={plato.id} style={{ ...rowBox, justifyContent: "space-between" }}>
                      <span>{plato.nombre}</span>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <strong>{money(plato.precio)}</strong>
                        <button type="button" onClick={() => addItem(plato)} disabled={busy} style={btnPrimaryMini}>Agregar</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {ticketItems.length === 0 ? <p>Sin items</p> : (
              <div style={{ display: "grid", gap: 6 }}>
                {ticketItems.map((item) => (
                  <div key={item.id} style={{ ...rowBox, justifyContent: "space-between" }}>
                    <div>
                      <strong>{item.name_snapshot}</strong>
                      <small style={{ display: "block", color: "#6b7280" }}>{money(item.price_snapshot)} c/u</small>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button type="button" onClick={() => updateQty(item, Number(item.qty) - 1)} disabled={busy} style={btnGhost}>-</button>
                      <strong>{item.qty}</strong>
                      <button type="button" onClick={() => updateQty(item, Number(item.qty) + 1)} disabled={busy} style={btnGhost}>+</button>
                      <strong>{money(Number(item.price_snapshot || 0) * Number(item.qty || 0))}</strong>
                      <button type="button" onClick={() => removeItem(item.id)} disabled={busy} style={btnDangerGhost}>Quitar</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Total ticket</strong>
              <strong>{money(ticketTotal)}</strong>
            </div>

            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} style={inputStyle}>
                <option value="cash">Efectivo</option>
                <option value="card">Tarjeta</option>
                <option value="yape">Yape</option>
                <option value="plin">Plin</option>
                <option value="transfer">Transferencia</option>
                <option value="other">Otro</option>
              </select>
              {paymentMethod === "cash" ? (
                <input type="number" min="0" step="0.01" value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} style={inputStyle} placeholder="Monto recibido (referencial)" />
              ) : (
                <input type="text" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} style={inputStyle} placeholder="Referencia (referencial)" />
              )}
              <button type="button" onClick={closeTicketGenerateOrder} disabled={busy} style={btnDanger}>Cerrar ticket / Generar pedido</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const rowBox = {
  display: "flex",
  gap: 8,
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "8px 10px",
  alignItems: "center",
};

const inputStyle = {
  border: "1px solid #dce7e2",
  borderRadius: 8,
  padding: "9px 10px",
  fontSize: 14,
};

const tableBtn = {
  padding: "10px 12px",
  borderRadius: 10,
  color: "#111827",
  cursor: "pointer",
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
