import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";

function money(v) {
  return `S/ ${Number(v || 0).toFixed(2)}`;
}

function errMsg(error, fallback) {
  const msg = String(error?.message || "").trim();
  return msg ? `${fallback}: ${msg}` : fallback;
}

async function loadPlatosCompatible() {
  const selects = [
    "id,nombre,precio,categoria_id,orden,imagen",
    "id,nombre,precio,categoria_id,orden",
    "id,nombre,precio,categoria_id",
    "id,nombre,precio",
  ];

  for (const sel of selects) {
    const { data, error } = await supabase.from("platos").select(sel).order("nombre", { ascending: true });
    if (!error) return { data: data || [], error: null };
  }

  const fallback = await supabase.from("platos").select("id,nombre,precio");
  return { data: fallback.data || [], error: fallback.error || null };
}

function printPrecuenta({ tableName, ticketId, items, total }) {
  const rows = items
    .map((item) => `<tr><td>${item.name_snapshot}</td><td style="text-align:right">${item.qty}</td><td style="text-align:right">${Number(item.price_snapshot).toFixed(2)}</td><td style="text-align:right">${(Number(item.qty) * Number(item.price_snapshot)).toFixed(2)}</td></tr>`)
    .join("");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>Precuenta</title>
<style>
body{font-family:Arial,sans-serif;padding:20px;color:#111}
h2{margin:0 0 8px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:6px 4px;border-bottom:1px solid #ddd}small{color:#555}.total{font-size:18px;font-weight:700;text-align:right;margin-top:12px}
</style></head><body>
<h2>Precuenta</h2>
<p><small>Mesa: ${tableName} · Ticket: ${String(ticketId).slice(0, 8).toUpperCase()} · ${new Date().toLocaleString()}</small></p>
<table><thead><tr><th style="text-align:left">Item</th><th style="text-align:right">Cant.</th><th style="text-align:right">Precio</th><th style="text-align:right">Subt.</th></tr></thead><tbody>${rows}</tbody></table>
<p class="total">Total: S/ ${Number(total || 0).toFixed(2)}</p>
<script>window.onload = () => window.print();</script>
</body></html>`;

  const w = window.open("", "_blank", "width=720,height=900");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export default function Salon() {
  const { toast, showToast } = useToast(2800);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [tables, setTables] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [items, setItems] = useState([]);
  const [platos, setPlatos] = useState([]);
  const [categorias, setCategorias] = useState([]);

  const [selectedTable, setSelectedTable] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);

  const [newTableName, setNewTableName] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [hasOpenCashSession, setHasOpenCashSession] = useState(false);

  async function refreshAll() {
    setLoading(true);

    const [tablesResp, ticketsResp, platosResp, categoriesResp, cashResp] = await Promise.all([
      supabase.from("restaurant_tables").select("id,table_name,active").order("table_name", { ascending: true }),
      supabase.from("table_tickets").select("id,table_id,status,payment_status,opened_at,generated_order_id").order("opened_at", { ascending: false }),
      loadPlatosCompatible(),
      supabase.from("categorias").select("id,nombre").order("nombre", { ascending: true }),
      supabase.from("cash_sessions").select("id").eq("status", "open").limit(1),
    ]);

    if (tablesResp.error) showToast(errMsg(tablesResp.error, "Error cargando mesas"), "warning");
    if (ticketsResp.error) showToast(errMsg(ticketsResp.error, "Error cargando tickets"), "warning");
    if (platosResp.error) showToast(errMsg(platosResp.error, "Error cargando carta"), "warning");
    if (categoriesResp.error) showToast(errMsg(categoriesResp.error, "Error cargando categorías"), "warning");

    setTables(tablesResp.data || []);
    setTickets(ticketsResp.data || []);
    setPlatos((platosResp.data || []).filter((p) => Number(p.precio || 0) >= 0));
    setCategorias(categoriesResp.data || []);
    setHasOpenCashSession((cashResp.data || []).length > 0);

    if (!selectedTable && (tablesResp.data || []).length > 0) {
      setSelectedTable(tablesResp.data[0]);
    }

    setLoading(false);
  }

  async function refreshTicketItems(ticketId) {
    if (!ticketId) {
      setItems([]);
      return;
    }
    const { data, error } = await supabase
      .from("table_ticket_items")
      .select("id,ticket_id,plato_id,qty,price_snapshot,notes,status,name_snapshot")
      .eq("ticket_id", ticketId)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (error) {
      showToast(errMsg(error, "Error cargando items"), "error");
      setItems([]);
      return;
    }

    setItems(data || []);
  }

  useEffect(() => {
    refreshAll();
  }, []);

  useEffect(() => {
    refreshTicketItems(selectedTicket?.id);
  }, [selectedTicket?.id]);

  const openTicketByTable = useMemo(() => {
    const map = new Map();
    tickets.forEach((t) => {
      if (t.status !== "closed" && t.status !== "cancelled") map.set(t.table_id, t);
    });
    return map;
  }, [tickets]);

  const activeTables = useMemo(() => tables.filter((t) => t.active), [tables]);

  const tableStatus = useMemo(() => {
    return new Map(activeTables.map((t) => {
      const tk = openTicketByTable.get(t.id);
      if (!tk) return [t.id, "Libre"];
      if (tk.status === "closing") return [t.id, "En cobro"];
      return [t.id, "Ocupada"];
    }));
  }, [activeTables, openTicketByTable]);

  const total = useMemo(() => items.reduce((acc, it) => acc + (Number(it.qty || 0) * Number(it.price_snapshot || 0)), 0), [items]);

  const filteredPlatos = useMemo(() => {
    const q = search.trim().toLowerCase();
    return platos.filter((p) => {
      if (categoryFilter !== "all" && String(p.categoria_id || "") !== categoryFilter) return false;
      if (!q) return true;
      return String(p.nombre || "").toLowerCase().includes(q);
    });
  }, [platos, search, categoryFilter]);

  function selectTable(table) {
    setSelectedTable(table);
    setSelectedTicket(openTicketByTable.get(table.id) || null);
  }

  async function createTable() {
    const name = String(newTableName || "").trim();
    if (!name) {
      showToast("Ingresa nombre de mesa", "warning");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.from("restaurant_tables").insert([{ table_name: name, active: true }]).select("id,table_name,active").single();
    if (error) {
      showToast(errMsg(error, "No se pudo crear mesa"), "error");
      setBusy(false);
      return;
    }
    setTables((prev) => [...prev, data].sort((a, b) => String(a.table_name).localeCompare(String(b.table_name))));
    setNewTableName("");
    setBusy(false);
  }

  async function updateTable(table, patch) {
    setBusy(true);
    const { data, error } = await supabase.from("restaurant_tables").update(patch).eq("id", table.id).select("id,table_name,active").single();
    if (error) {
      showToast(errMsg(error, "No se pudo actualizar mesa"), "error");
      setBusy(false);
      return;
    }
    setTables((prev) => prev.map((t) => (t.id === data.id ? data : t)));
    setBusy(false);
  }

  async function removeTable(table) {
    if (openTicketByTable.has(table.id)) {
      showToast("No puedes eliminar mesa con ticket abierto", "warning");
      return;
    }
    if (!window.confirm(`¿Eliminar ${table.table_name}?`)) return;
    setBusy(true);
    const { error } = await supabase.from("restaurant_tables").delete().eq("id", table.id);
    if (error) {
      showToast(errMsg(error, "No se pudo eliminar mesa"), "error");
      setBusy(false);
      return;
    }
    setTables((prev) => prev.filter((t) => t.id !== table.id));
    if (selectedTable?.id === table.id) {
      setSelectedTable(null);
      setSelectedTicket(null);
    }
    setBusy(false);
  }

  async function openTicket() {
    if (!selectedTable) {
      showToast("Selecciona una mesa", "warning");
      return;
    }
    if (openTicketByTable.has(selectedTable.id)) {
      setSelectedTicket(openTicketByTable.get(selectedTable.id));
      showToast("Esta mesa ya tiene ticket abierto", "warning");
      return;
    }

    setBusy(true);
    const { data, error } = await supabase.rpc("rpc_salon_open_ticket", { p_table_id: selectedTable.id, p_notes: null });
    if (error) {
      showToast(errMsg(error, "No se pudo abrir ticket"), "error");
      setBusy(false);
      return;
    }

    const ticket = data;
    setTickets((prev) => [ticket, ...prev]);
    setSelectedTicket(ticket);
    setItems([]);
    setBusy(false);
    showToast("Ticket abierto", "success");
  }

  async function setTicketStatus(nextStatus) {
    if (!selectedTicket?.id) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("table_tickets")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", selectedTicket.id)
      .select("id,table_id,status,payment_status,opened_at,generated_order_id")
      .single();
    if (error) {
      showToast(errMsg(error, "No se pudo actualizar estado"), "error");
      setBusy(false);
      return;
    }
    setTickets((prev) => prev.map((t) => (t.id === data.id ? data : t)));
    setSelectedTicket(data);
    setBusy(false);
  }

  async function addItem(plato) {
    if (!selectedTicket?.id || selectedTicket.status === "closed") {
      showToast("Abre un ticket primero", "warning");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase
      .from("table_ticket_items")
      .insert([{ ticket_id: selectedTicket.id, plato_id: plato.id, qty: 1, price_snapshot: Number(plato.precio || 0), notes: null, status: "active", name_snapshot: plato.nombre || "Producto" }])
      .select("id,ticket_id,plato_id,qty,price_snapshot,notes,status,name_snapshot")
      .single();
    if (error) {
      showToast(errMsg(error, "No se pudo agregar item"), "error");
      setBusy(false);
      return;
    }
    setItems((prev) => [...prev, data]);
    setBusy(false);
  }

  async function changeQty(item, delta) {
    const next = Number(item.qty || 0) + delta;
    if (next <= 0) {
      await removeItem(item.id);
      return;
    }
    setBusy(true);
    const { data, error } = await supabase
      .from("table_ticket_items")
      .update({ qty: next })
      .eq("id", item.id)
      .select("id,ticket_id,plato_id,qty,price_snapshot,notes,status,name_snapshot")
      .single();
    if (error) {
      showToast(errMsg(error, "No se pudo editar item"), "error");
      setBusy(false);
      return;
    }
    setItems((prev) => prev.map((it) => (it.id === data.id ? data : it)));
    setBusy(false);
  }

  async function removeItem(itemId) {
    setBusy(true);
    const { error } = await supabase.from("table_ticket_items").delete().eq("id", itemId);
    if (error) {
      showToast(errMsg(error, "No se pudo quitar item"), "error");
      setBusy(false);
      return;
    }
    setItems((prev) => prev.filter((it) => it.id !== itemId));
    setBusy(false);
  }

  async function finalizeTicketPayment() {
    if (!selectedTicket?.id) {
      showToast("Selecciona ticket", "warning");
      return;
    }

    if (paymentMethod === "cash" && !hasOpenCashSession) {
      showToast("Para pago en efectivo debes abrir caja", "error");
      return;
    }

    setBusy(true);
    const { data, error } = await supabase.rpc("rpc_salon_finalize_ticket_payment", {
      p_ticket_id: selectedTicket.id,
      p_method: paymentMethod,
      p_cash_received: paymentMethod === "cash" ? Number(cashReceived || 0) : null,
      p_reference: ["card", "yape", "plin", "transfer"].includes(paymentMethod) ? String(paymentReference || "").trim() || null : null,
      p_note: null,
    });

    if (error) {
      showToast(errMsg(error, "No se pudo cerrar/cobrar ticket"), "error");
      setBusy(false);
      return;
    }

    await refreshAll();
    setSelectedTicket(null);
    setItems([]);
    setBusy(false);
    showToast(`Ticket cerrado. Pedido generado: ${data?.order_id || "-"}`, "success");
  }

  if (loading) return <p>Cargando módulo Salón...</p>;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Toast toast={toast} />
      <h2 style={{ margin: 0 }}>Salón POS</h2>

      <section style={card}>
        <h3 style={{ margin: 0 }}>Mesas (CRUD)</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input style={inputStyle} value={newTableName} onChange={(e) => setNewTableName(e.target.value)} placeholder="Nombre/Número de mesa" />
          <button type="button" style={btnPrimary} onClick={createTable} disabled={busy}>Crear</button>
        </div>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {tables.map((table) => (
            <div key={table.id} style={row}>
              <strong>{table.table_name}</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" style={btnGhost} disabled={busy} onClick={() => {
                  const next = window.prompt("Nuevo nombre de mesa", table.table_name);
                  if (next && next.trim()) updateTable(table, { table_name: next.trim() });
                }}>Editar</button>
                <button type="button" style={btnGhost} disabled={busy} onClick={() => updateTable(table, { active: !table.active })}>{table.active ? "Desactivar" : "Activar"}</button>
                <button type="button" style={btnDangerGhost} disabled={busy} onClick={() => removeTable(table)}>Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={card}>
        <h3 style={{ margin: 0 }}>Mesas operativas</h3>
        {activeTables.length === 0 ? <p>No hay mesas activas</p> : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8, marginTop: 8 }}>
              {activeTables.map((table) => {
                const status = tableStatus.get(table.id) || "Libre";
                const isSelected = selectedTable?.id === table.id;
                return (
                  <button key={table.id} type="button" style={{ ...tableBtn, border: isSelected ? "2px solid #2fa67f" : "1px solid #e5e7eb", background: status === "Libre" ? "#ecfdf3" : status === "En cobro" ? "#fff3e0" : "#fff7ed" }} onClick={() => selectTable(table)}>
                    {table.table_name} · {status}
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={btnPrimary} onClick={openTicket} disabled={busy || !selectedTable}>Abrir ticket</button>
              {selectedTable ? <small>Mesa: <strong>{selectedTable.table_name}</strong></small> : null}
              {selectedTicket ? <small>Ticket: <strong>{selectedTicket.id.slice(0, 8).toUpperCase()}</strong> · {selectedTicket.status}</small> : null}
            </div>
          </>
        )}
      </section>

      <section style={card}>
        <h3 style={{ margin: 0 }}>Ticket por mesa</h3>
        {!selectedTicket || selectedTicket.status === "closed" ? <p>Selecciona mesa y abre ticket.</p> : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <button type="button" style={btnGhost} disabled={busy} onClick={() => setTicketStatus("sent_to_kitchen")}>Enviar cocina</button>
              <button type="button" style={btnGhost} disabled={busy} onClick={() => setTicketStatus("ready")}>Listo</button>
              <button type="button" style={btnGhost} disabled={busy} onClick={() => setTicketStatus("served")}>Servido</button>
              <button type="button" style={btnGhost} disabled={busy} onClick={() => setTicketStatus("closing")}>En cobro</button>
              <button type="button" style={btnGhost} disabled={!items.length} onClick={() => printPrecuenta({ tableName: selectedTable?.table_name || "Mesa", ticketId: selectedTicket.id, items, total })}>Precuenta</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
              <div>
                <div style={{ display: "grid", gap: 8 }}>
                  <input style={inputStyle} placeholder="Buscar plato" value={search} onChange={(e) => setSearch(e.target.value)} />
                  <select style={inputStyle} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                    <option value="all">Todas las categorías</option>
                    {categorias.map((c) => <option key={c.id} value={String(c.id)}>{c.nombre}</option>)}
                  </select>
                </div>
                <div style={{ display: "grid", gap: 6, marginTop: 8, maxHeight: 360, overflow: "auto" }}>
                  {filteredPlatos.map((plato) => (
                    <div key={plato.id} style={row}>
                      <span>{plato.nombre}</span>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <strong>{money(plato.precio)}</strong>
                        <button type="button" style={btnPrimaryMini} disabled={busy} onClick={() => addItem(plato)}>Agregar</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ display: "grid", gap: 6, maxHeight: 360, overflow: "auto" }}>
                  {items.length === 0 ? <p>Sin items</p> : items.map((item) => (
                    <div key={item.id} style={row}>
                      <div>
                        <strong>{item.name_snapshot}</strong>
                        <small style={{ display: "block", color: "#6b7280" }}>{money(item.price_snapshot)} c/u</small>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button type="button" style={btnGhost} disabled={busy} onClick={() => changeQty(item, -1)}>-</button>
                        <strong>{item.qty}</strong>
                        <button type="button" style={btnGhost} disabled={busy} onClick={() => changeQty(item, 1)}>+</button>
                        <strong>{money(Number(item.qty) * Number(item.price_snapshot))}</strong>
                        <button type="button" style={btnDangerGhost} disabled={busy} onClick={() => removeItem(item.id)}>Quitar</button>
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ marginTop: 10 }}><strong>Total: {money(total)}</strong></p>

                <div style={{ display: "grid", gap: 8 }}>
                  <select style={inputStyle} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    <option value="cash">Efectivo</option>
                    <option value="yape">Yape</option>
                    <option value="plin">Plin</option>
                    <option value="card">Tarjeta</option>
                    <option value="transfer">Transferencia</option>
                    <option value="other">Otro</option>
                  </select>
                  {paymentMethod === "cash" ? (
                    <input style={inputStyle} type="number" min="0" step="0.01" value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} placeholder="Paga con" />
                  ) : (
                    <input style={inputStyle} type="text" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="Referencia" />
                  )}
                  {!hasOpenCashSession && paymentMethod !== "cash" ? <small style={{ color: "#a16207" }}>Aviso: caja cerrada. Pago no-efectivo permitido.</small> : null}
                  <button type="button" style={btnDanger} disabled={busy} onClick={finalizeTicketPayment}>Cerrar ticket / Cobrar</button>
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const card = { background: "#fff", borderRadius: 12, padding: 12 };
const row = { display: "flex", justifyContent: "space-between", gap: 8, border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px", alignItems: "center" };
const inputStyle = { border: "1px solid #dce7e2", borderRadius: 8, padding: "9px 10px", fontSize: 14 };
const tableBtn = { padding: "10px 12px", borderRadius: 10, color: "#111827", cursor: "pointer" };
const btnPrimary = { background: "#2fa67f", color: "#fff", border: "none", borderRadius: 8, padding: "10px 12px", cursor: "pointer" };
const btnPrimaryMini = { background: "#2fa67f", color: "#fff", border: "none", borderRadius: 8, padding: "6px 8px", cursor: "pointer" };
const btnGhost = { background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 8, padding: "6px 8px", cursor: "pointer" };
const btnDanger = { background: "#b3261e", color: "#fff", border: "none", borderRadius: 8, padding: "10px 12px", cursor: "pointer" };
const btnDangerGhost = { background: "#fff", color: "#b3261e", border: "1px solid #f1b7b3", borderRadius: 8, padding: "6px 8px", cursor: "pointer" };
