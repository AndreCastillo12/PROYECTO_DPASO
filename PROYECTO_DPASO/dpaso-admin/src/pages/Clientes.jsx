import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import useAdminPreferences from "../hooks/useAdminPreferences";
import { OPERATION_MESSAGES, resolveErrorMessage } from "../utils/operationMessages";
import "../styles/clientes-sedap.css";

function money(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function getDaysSince(dateValue) {
  if (!dateValue) return 9999;
  const now = Date.now();
  const d = new Date(dateValue).getTime();
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}



function aggregateClients(rows) {
  const map = new Map();

  rows.forEach((row) => {
    const registeredId = row.auth_user_id || row.user_id;
    const guestName = String(row.name || "").trim().toLowerCase();
    const guestPhone = String(row.phone || "").replace(/\D/g, "");
    const key = registeredId ? `registered:${registeredId}` : `guest:${guestName}:${guestPhone}`;

    if (!map.has(key)) {
      map.set(key, {
        ...row,
        customer_ids: [row.id],
      });
      return;
    }

    const current = map.get(key);
    const currentLast = current.last_order_at ? new Date(current.last_order_at).getTime() : 0;
    const rowLast = row.last_order_at ? new Date(row.last_order_at).getTime() : 0;

    map.set(key, {
      ...current,
      total_orders: Number(current.total_orders || 0) + Number(row.total_orders || 0),
      total_spent: Number(current.total_spent || 0) + Number(row.total_spent || 0),
      last_order_at: rowLast > currentLast ? row.last_order_at : current.last_order_at,
      customer_ids: [...current.customer_ids, row.id],
    });
  });

  return Array.from(map.values());
}

function getClientSegment(client) {
  const orders = Number(client?.total_orders || 0);
  const spent = Number(client?.total_spent || 0);
  const days = getDaysSince(client?.last_order_at);
  if (orders >= 6) return "Frecuente";
  if (spent >= 220) return "Ticket alto";
  if (days > 30) return "Inactivo";
  return "Regular";
}

export default function Clientes() {
  const navigate = useNavigate();
  const { toast, showToast } = useToast(2600);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [orders, setOrders] = useState([]);

  const [preferences, setPreferences] = useAdminPreferences("dpaso_admin_clientes_filters", {
    search: "",
    sortBy: "last_order_at",
    dateFrom: "",
    dateTo: "",
  });
  const { search, sortBy, dateFrom, dateTo } = preferences;

  const loadClients = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    let query = supabase.from("customers").select("id,name,phone,total_orders,total_spent,last_order_at,created_at,user_id,auth_user_id").limit(300);

    if (search.trim()) {
      const term = search.trim();
      query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
    }

    query = sortBy === "total_spent"
      ? query.order("total_spent", { ascending: false, nullsFirst: false })
      : query.order("last_order_at", { ascending: false, nullsFirst: false });

    const { data, error } = await query;

    if (error) {
      showToast(resolveErrorMessage(error, OPERATION_MESSAGES.loadError), "error");
      setLoading(false);
      setRefreshing(false);
      return false;
    }

    const filteredRows = (data || []).filter((row) => {
      const d = row.last_order_at ? new Date(row.last_order_at) : null;
      if (dateFrom) {
        const start = new Date(`${dateFrom}T00:00:00`);
        if (!d || d < start) return false;
      }
      if (dateTo) {
        const end = new Date(`${dateTo}T23:59:59`);
        if (!d || d > end) return false;
      }
      return true;
    });

    const rows = aggregateClients(filteredRows);

    setClients(rows);
    setSelectedClient((prev) => {
      if (!prev?.id) return rows[0] || null;
      return rows.find((r) => r.id === prev.id) || rows[0] || null;
    });
    setLoading(false);
    setRefreshing(false);
    return true;
  }, [dateFrom, dateTo, search, showToast, sortBy]);

  const loadClientOrders = useCallback(async (customerIds = []) => {
    if (!customerIds.length) {
      setOrders([]);
      return;
    }

    setDetailLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("id,created_at,total,estado,modalidad,paid,payment_method,short_code,nombre_cliente,telefono")
            .in("customer_id", customerIds)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      showToast(resolveErrorMessage(error, OPERATION_MESSAGES.loadError), "error");
      setOrders([]);
      setDetailLoading(false);
      return;
    }

    setOrders(data || []);
    setDetailLoading(false);
  }, [showToast]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  useEffect(() => {
    loadClientOrders(selectedClient?.customer_ids || []);
  }, [loadClientOrders, selectedClient?.id]);

  const ticketPromedio = useMemo(() => {
    const totalOrders = Number(selectedClient?.total_orders || 0);
    const totalSpent = Number(selectedClient?.total_spent || 0);
    if (!totalOrders) return 0;
    return totalSpent / totalOrders;
  }, [selectedClient?.total_orders, selectedClient?.total_spent]);

  async function runBackfill() {
    setSyncing(true);
    const { data, error } = await supabase.rpc("rpc_backfill_customers_from_orders");
    if (error) {
      showToast(resolveErrorMessage(error, OPERATION_MESSAGES.saveError), "error");
      setSyncing(false);
      return;
    }
    showToast(`Sincronización OK (${data?.processed_phones || 0} teléfonos).`, "success");
    await loadClients();
    setSyncing(false);
  }

  function openWhatsApp() {
    if (!selectedClient?.phone) {
      showToast("Cliente sin teléfono", "error");
      return;
    }
    const digits = String(selectedClient.phone).replace(/\D/g, "");
    const phone = digits.startsWith("51") ? digits : `51${digits}`;
    const msg = `Hola ${selectedClient.name || "cliente"}, te saluda DPASO 👋`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  }

  function sendTemplate(type) {
    if (!selectedClient?.phone) {
      showToast("Cliente sin teléfono", "error");
      return;
    }
    const digits = String(selectedClient.phone).replace(/\D/g, "");
    const phone = digits.startsWith("51") ? digits : `51${digits}`;

    const templates = {
      confirmation: `Hola ${selectedClient.name || "cliente"}, gracias por tu compra en DPASO. Tu pedido fue confirmado ✅`,
      followup: `Hola ${selectedClient.name || "cliente"}, ¿cómo estuvo tu experiencia con DPASO? Te leemos 🙌`,
      reactivation: `Hola ${selectedClient.name || "cliente"}, te extrañamos en DPASO 😄. Tenemos novedades para ti.`,
    };

    const msg = templates[type] || templates.followup;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  }

  const noRepurchaseClients = useMemo(() => clients.filter((client) => getDaysSince(client.last_order_at) > 30).slice(0, 8), [clients]);

  return (
    <div className="clientes-page">
      <Toast toast={toast} />

      <section className="clientes-toolbar">
        <div>
          <h3>Clientes</h3>
          <p>Detalle de clientes y comportamiento de compra.</p>
        </div>
        <div className="clientes-toolbar-actions">
          <button type="button" onClick={async () => { const ok = await loadClients({ silent: true }); if (ok) showToast(OPERATION_MESSAGES.loadSuccess, "success"); }} disabled={loading || refreshing}>Recargar</button>
          <button type="button" className="primary" onClick={runBackfill} disabled={syncing}>{syncing ? "Sincronizando..." : "Sincronizar"}</button>
        </div>
      </section>

      <section className="clientes-filters">
        <input type="text" value={search} onChange={(e) => setPreferences((prev) => ({ ...prev, search: e.target.value }))} placeholder="Buscar por nombre o teléfono" />
        <input type="date" value={dateFrom} onChange={(e) => setPreferences((prev) => ({ ...prev, dateFrom: e.target.value }))} />
        <input type="date" value={dateTo} onChange={(e) => setPreferences((prev) => ({ ...prev, dateTo: e.target.value }))} />
        <select value={sortBy} onChange={(e) => setPreferences((prev) => ({ ...prev, sortBy: e.target.value }))}>
          <option value="last_order_at">Por última compra</option>
          <option value="total_spent">Por total gastado</option>
        </select>
      </section>

      <section className="clientes-main-grid">
        <article className="clientes-table-card">
          {loading ? <p>Cargando clientes...</p> : refreshing ? <p>Actualizando resultados...</p> : clients.length === 0 ? <p>No hay clientes con los filtros actuales.</p> : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Nombre</th><th>Cuenta</th><th>Teléfono</th><th>Pedidos</th><th>Total gastado</th><th>Última compra</th></tr>
                </thead>
                <tbody>
                  {clients.map((c) => (
                    <tr key={c.id} onClick={() => setSelectedClient(c)} className={selectedClient?.id === c.id ? "is-active" : ""}>
                      <td><strong>{c.name || "-"}</strong></td>
                      <td><span className={`account-badge ${(c.auth_user_id || c.user_id) ? "registered" : "guest"}`}>{(c.auth_user_id || c.user_id) ? "Registrado" : "Invitado"}</span></td>
                      <td>{c.phone || "-"}</td>
                      <td>{Number(c.total_orders || 0)}</td>
                      <td>{money(c.total_spent)}</td>
                      <td>{formatDate(c.last_order_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <aside className="cliente-detail-sedap">
          {!selectedClient ? (
            <p>Selecciona un cliente para ver su detalle.</p>
          ) : (
            <>
              <div className="detail-top-grid">
                <article className="profile-card">
                  <div className="avatar">{String(selectedClient.name || "C").charAt(0).toUpperCase()}</div>
                  <div>
                    <h4>{selectedClient.name || "Cliente"}</h4>
                    <p>{selectedClient.phone || "Sin teléfono"}</p>
                    <small>Segmento: {getClientSegment(selectedClient)}</small>
                  </div>
                </article>

                <article className="balance-card">
                  <small>Total gastado</small>
                  <strong>{money(selectedClient.total_spent)}</strong>
                  <p>Pedidos: {Number(selectedClient.total_orders || 0)} · Ticket prom: {money(ticketPromedio)}</p>
                </article>
              </div>

              <div className="detail-actions">
                <button type="button" className="wa" onClick={openWhatsApp}>WhatsApp</button>
                <button type="button" onClick={() => sendTemplate("confirmation")}>Confirmación</button>
                <button type="button" onClick={() => sendTemplate("followup")}>Seguimiento</button>
                <button type="button" onClick={() => sendTemplate("reactivation")}>Reactivación</button>
              </div>

              <article className="detail-orders-card">
                <h5>Historial de pedidos</h5>
                {detailLoading ? <p>Cargando pedidos...</p> : orders.length === 0 ? <p>Este cliente aún no tiene pedidos vinculados.</p> : (
                  <div className="order-list">
                    {orders.map((o) => (
                      <div key={o.id} className="order-line">
                        <div>
                          <strong>{o.short_code || o.id.slice(-8).toUpperCase()}</strong>
                          <small>{formatDate(o.created_at)}</small>
                          <small>{o.estado || "-"} · {o.modalidad || "-"}</small>
                        </div>
                        <div>
                          <strong>{money(o.total)}</strong>
                          <button type="button" onClick={() => navigate(`/pedido-detalle?order_id=${o.id}`)}>Detalle</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            </>
          )}
        </aside>
      </section>

      <section className="clientes-reminders">
        <h5>Recordatorios automáticos (sin recompra &gt; 30 días)</h5>
        {noRepurchaseClients.length === 0 ? (
          <p>No hay clientes pendientes de reactivación.</p>
        ) : (
          <div className="reminder-list">
            {noRepurchaseClients.map((client) => (
              <div key={client.id} className="reminder-line">
                <div>
                  <strong>{client.name || "Cliente"}</strong>
                  <small>{client.phone || "Sin teléfono"}</small>
                </div>
                <small>{getDaysSince(client.last_order_at)} días sin recompra</small>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
