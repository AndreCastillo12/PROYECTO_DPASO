import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import useAdminPreferences from "../hooks/useAdminPreferences";
import { OPERATION_MESSAGES, resolveErrorMessage } from "../utils/operationMessages";

function money(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
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

  const loadClients = useCallback(async ({silent = false} = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    let query = supabase
      .from("customers")
      .select("id,name,phone,total_orders,total_spent,last_order_at,created_at")
      .limit(300);

    if (search.trim()) {
      const term = search.trim();
      query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
    }

    if (sortBy === "total_spent") {
      query = query.order("total_spent", { ascending: false, nullsFirst: false });
    } else {
      query = query.order("last_order_at", { ascending: false, nullsFirst: false });
    }

    const { data, error } = await query;

    if (error) {
      showToast(resolveErrorMessage(error, OPERATION_MESSAGES.loadError), "error");
      setLoading(false);
      setRefreshing(false);
      return false;
    }

    const rows = (data || []).filter((row) => {
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
    setClients(rows);
    setSelectedClient((prev) => {
      if (!prev?.id) return rows[0] || null;
      return rows.find((r) => r.id === prev.id) || rows[0] || null;
    });
    setLoading(false);
    setRefreshing(false);
    return true;
  }, [dateFrom, dateTo, search, showToast, sortBy]);

  const loadClientOrders = useCallback(async (customerId) => {
    if (!customerId) {
      setOrders([]);
      return;
    }

    setDetailLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("id,created_at,total,estado,modalidad,paid,payment_method,short_code,nombre_cliente,telefono")
      .eq("customer_id", customerId)
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
    loadClientOrders(selectedClient?.id);
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

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Toast toast={toast} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Clientes</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={secondaryBtn} onClick={async () => { const ok = await loadClients({ silent: true }); if (ok) showToast(OPERATION_MESSAGES.loadSuccess, "success"); }} disabled={loading || refreshing}>Recargar</button>
          <button type="button" style={primaryBtn} onClick={runBackfill} disabled={syncing}>
            {syncing ? "Sincronizando..." : "Sincronizar desde pedidos"}
          </button>
        </div>
      </div>

      <div style={filterCard}>
        <input
          type="text"
          style={inputStyle}
          value={search}
          onChange={(e) => setPreferences((prev) => ({ ...prev, search: e.target.value }))}
          placeholder="Buscar por nombre o teléfono"
        />

        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setPreferences((prev) => ({ ...prev, dateFrom: e.target.value }))}
          style={inputStyle}
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setPreferences((prev) => ({ ...prev, dateTo: e.target.value }))}
          style={inputStyle}
        />
        <select value={sortBy} onChange={(e) => setPreferences((prev) => ({ ...prev, sortBy: e.target.value }))} style={inputStyle}>
          <option value="last_order_at">Ordenar por última compra</option>
          <option value="total_spent">Ordenar por total gastado</option>
        </select>
      </div>

      <div className="clientes-grid" style={layoutGrid}>
        <section style={cardStyle}>
          {loading ? (
            <p>Cargando clientes...</p>
          ) : refreshing ? (
            <p>Actualizando resultados...</p>
          ) : clients.length === 0 ? (
            <p>No hay clientes con los filtros actuales.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Nombre</th>
                    <th style={thStyle}>Teléfono</th>
                    <th style={thStyle}>Pedidos</th>
                    <th style={thStyle}>Total gastado</th>
                    <th style={thStyle}>Última compra</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => {
                    const isSelected = selectedClient?.id === c.id;
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedClient(c)}
                        style={{ ...trStyle, ...(isSelected ? trSelectedStyle : {}) }}
                      >
                        <td style={tdStyle}><strong>{c.name || "-"}</strong></td>
                        <td style={tdStyle}>{c.phone || "-"}</td>
                        <td style={tdStyle}>{Number(c.total_orders || 0)}</td>
                        <td style={tdStyle}>{money(c.total_spent)}</td>
                        <td style={tdStyle}>{formatDate(c.last_order_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside style={cardStyle}>
          {!selectedClient ? (
            <p>Selecciona un cliente para ver su detalle.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              <h3 style={{ margin: 0 }}>{selectedClient.name || "Cliente"}</h3>
              <p style={line}><strong>Teléfono:</strong> {selectedClient.phone || "-"}</p>
              <p style={line}><strong>Total pedidos:</strong> {Number(selectedClient.total_orders || 0)}</p>
              <p style={line}><strong>Total gastado:</strong> {money(selectedClient.total_spent)}</p>
              <p style={line}><strong>Ticket promedio:</strong> {money(ticketPromedio)}</p>
              <p style={line}><strong>Última compra:</strong> {formatDate(selectedClient.last_order_at)}</p>

              <button type="button" style={waBtn} onClick={openWhatsApp}>WhatsApp cliente</button>

              <hr style={{ border: 0, borderTop: "1px solid #e5e7eb", margin: "4px 0" }} />
              <strong>Historial de pedidos</strong>

              {detailLoading ? (
                <p>Cargando pedidos...</p>
              ) : orders.length === 0 ? (
                <p>Este cliente aún no tiene pedidos vinculados.</p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {orders.map((o) => (
                    <div key={o.id} style={orderRow}>
                      <div style={{ display: "grid", gap: 2 }}>
                        <strong>{o.short_code || o.id.slice(-8).toUpperCase()}</strong>
                        <small>{formatDate(o.created_at)}</small>
                        <small>{o.estado || "-"} · {o.modalidad || "-"}</small>
                        <small>Pago: {o.paid ? "Sí" : "No"} ({o.payment_method || "sin definir"})</small>
                      </div>
                      <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                        <strong>{money(o.total)}</strong>
                        <button
                          type="button"
                          style={secondaryBtn}
                          onClick={() => navigate(`/pedidos?order_id=${o.id}`)}
                        >
                          Ver pedido
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      <style>{`
        @media (max-width: 1080px) {
          .clientes-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

const layoutGrid = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.5fr) minmax(330px, 1fr)",
  gap: 14,
};

const cardStyle = {
  background: "#fff",
  borderRadius: 12,
  padding: 12,
  boxShadow: "0 4px 14px rgba(0,0,0,.06)",
};

const filterCard = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  background: "#fff",
  borderRadius: 12,
  padding: 12,
  boxShadow: "0 4px 14px rgba(0,0,0,.06)",
};

const inputStyle = {
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: "9px 10px",
  fontSize: 14,
  background: "#fff",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 760,
};

const thStyle = {
  textAlign: "left",
  fontSize: 13,
  fontWeight: 700,
  color: "#374151",
  borderBottom: "1px solid #e5e7eb",
  padding: "9px 8px",
};

const tdStyle = {
  borderBottom: "1px solid #eef2f7",
  padding: "9px 8px",
  fontSize: 14,
  color: "#111827",
};

const trStyle = {
  cursor: "pointer",
};

const trSelectedStyle = {
  background: "#eff6ff",
};

const primaryBtn = {
  backgroundColor: "#162447",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 12px",
  cursor: "pointer",
};

const secondaryBtn = {
  backgroundColor: "#1f4068",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 12px",
  cursor: "pointer",
};

const waBtn = {
  backgroundColor: "#25d366",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 12px",
  cursor: "pointer",
  fontWeight: 600,
};

const line = {
  margin: 0,
  color: "#111827",
};

const orderRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "8px 10px",
};
