import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import { readAdminPreference, saveAdminPreference } from "../utils/adminPreferences";

function money(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function daysSince(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const ms = Date.now() - new Date(value).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

const whatsappTemplates = {
  confirmacion: ({ name }) => `Hola ${name || "cliente"}, gracias por tu compra en DPASO ✅\n\nTu pedido fue recibido correctamente. Cualquier consulta estamos atentos por este medio.`,
  seguimiento: ({ name, lastOrderLabel }) => `Hola ${name || "cliente"}, te escribimos de DPASO 👋\n\nVimos tu último pedido (${lastOrderLabel || "reciente"}) y queremos saber cómo te fue. Tu feedback nos ayuda mucho.`,
  reactivacion: ({ name }) => `Hola ${name || "cliente"}, te saluda DPASO 🍔\n\nTe extrañamos y queremos invitarte a volver. Si deseas, te ayudamos a armar tu próximo pedido por aquí.`,
};

function getClientSegments(client, inactiveDays) {
  const totalOrders = Number(client?.total_orders || 0);
  const totalSpent = Number(client?.total_spent || 0);
  const avgTicket = totalOrders > 0 ? totalSpent / totalOrders : 0;
  const inactive = daysSince(client?.last_order_at) >= Number(inactiveDays || 30);

  return {
    frequent: totalOrders >= 5,
    inactive,
    high_ticket: totalOrders >= 2 && avgTicket >= 65,
    avgTicket,
  };
}

export default function Clientes() {
  const navigate = useNavigate();
  const { toast, showToast } = useToast(2600);
  const initialPrefs = readAdminPreference("clientes_filters", {
    search: "",
    sortBy: "last_order_at",
    accountFilter: "all",
    segmentFilter: "all",
    waTemplate: "confirmacion",
    inactiveDays: "30",
  });

  const [loading, setLoading] = useState(true);
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState(initialPrefs.search || "");
  const [sortBy, setSortBy] = useState(initialPrefs.sortBy || "last_order_at");
  const [accountFilter, setAccountFilter] = useState(initialPrefs.accountFilter || "all");
  const [segmentFilter, setSegmentFilter] = useState(initialPrefs.segmentFilter || "all");
  const [waTemplate, setWaTemplate] = useState(initialPrefs.waTemplate || "confirmacion");
  const [inactiveDays, setInactiveDays] = useState(initialPrefs.inactiveDays || "30");

  const loadClients = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from("customers")
      .select("id,name,phone,email,dni,account_type,total_orders,total_spent,last_order_at,created_at")
      .limit(300);

    if (search.trim()) {
      const term = search.trim();
      query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%,dni.ilike.%${term}%`);
    }

    if (accountFilter === "registered") {
      query = query.eq("account_type", "registered");
    } else if (accountFilter === "guest") {
      query = query.eq("account_type", "guest");
    }

    if (sortBy === "total_spent") {
      query = query.order("total_spent", { ascending: false, nullsFirst: false });
    } else {
      query = query.order("last_order_at", { ascending: false, nullsFirst: false });
    }

    const { data, error } = await query;

    if (error) {
      showToast(error.message || "No se pudo cargar clientes. Intenta nuevamente.", "error");
      setLoading(false);
      setFirstLoadDone(true);
      return;
    }

    const rows = data || [];
    setClients(rows);
    setSelectedClient((prev) => {
      if (!prev?.id) return rows[0] || null;
      return rows.find((r) => r.id === prev.id) || rows[0] || null;
    });
    setLoading(false);
    setFirstLoadDone(true);
  }, [accountFilter, search, showToast, sortBy]);

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
      showToast(error.message || "No se pudo cargar historial del cliente. Intenta nuevamente.", "error");
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

  useEffect(() => {
    saveAdminPreference("clientes_filters", {
      search,
      sortBy,
      accountFilter,
      segmentFilter,
      waTemplate,
      inactiveDays,
    });
  }, [accountFilter, inactiveDays, search, segmentFilter, sortBy, waTemplate]);

  const ticketPromedio = useMemo(() => {
    const totalOrders = Number(selectedClient?.total_orders || 0);
    const totalSpent = Number(selectedClient?.total_spent || 0);
    if (!totalOrders) return 0;
    return totalSpent / totalOrders;
  }, [selectedClient?.total_orders, selectedClient?.total_spent]);

  const clientsWithSegments = useMemo(() => {
    return clients.map((client) => ({
      ...client,
      segments: getClientSegments(client, inactiveDays),
    }));
  }, [clients, inactiveDays]);

  const filteredClients = useMemo(() => {
    if (segmentFilter === "all") return clientsWithSegments;
    return clientsWithSegments.filter((c) => c.segments?.[segmentFilter]);
  }, [clientsWithSegments, segmentFilter]);

  const reminderTargets = useMemo(() => {
    return clientsWithSegments
      .filter((c) => c.segments.inactive)
      .sort((a, b) => daysSince(b.last_order_at) - daysSince(a.last_order_at))
      .slice(0, 8);
  }, [clientsWithSegments]);

  async function runBackfill() {
    setSyncing(true);
    const { data, error } = await supabase.rpc("rpc_backfill_customers_from_orders");
    if (error) {
      showToast(error.message || "No se pudo sincronizar clientes. Intenta nuevamente.", "error");
      setSyncing(false);
      return;
    }
    showToast(`Sincronización OK (${data?.processed_phones || 0} teléfonos) ✅`, "success");
    await loadClients();
    setSyncing(false);
  }

  function openWhatsApp(client = selectedClient, template = waTemplate) {
    if (!client?.phone) {
      showToast("Cliente sin teléfono", "error");
      return;
    }
    const digits = String(client.phone).replace(/\D/g, "");
    const phone = digits.startsWith("51") ? digits : `51${digits}`;
    const factory = whatsappTemplates[template] || whatsappTemplates.confirmacion;
    const msg = factory({
      name: client.name,
      lastOrderLabel: formatDate(client.last_order_at),
    });
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Toast toast={toast} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Clientes {loading && firstLoadDone ? "· Actualizando..." : ""}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={secondaryBtn} onClick={() => loadClients()} disabled={loading}>Recargar</button>
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
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, teléfono o DNI"
        />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={inputStyle}>
          <option value="last_order_at">Ordenar por última compra</option>
          <option value="total_spent">Ordenar por total gastado</option>
        </select>
        <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} style={inputStyle}>
          <option value="all">Todos</option>
          <option value="registered">Registrados</option>
          <option value="guest">Invitados</option>
        </select>
        <select value={segmentFilter} onChange={(e) => setSegmentFilter(e.target.value)} style={inputStyle}>
          <option value="all">Todos los segmentos</option>
          <option value="frequent">Frecuentes</option>
          <option value="high_ticket">Ticket alto</option>
          <option value="inactive">Inactivos</option>
        </select>
        <select value={inactiveDays} onChange={(e) => setInactiveDays(e.target.value)} style={inputStyle}>
          <option value="15">Inactivos desde 15 días</option>
          <option value="30">Inactivos desde 30 días</option>
          <option value="45">Inactivos desde 45 días</option>
          <option value="60">Inactivos desde 60 días</option>
        </select>
      </div>

      <div style={hintCard}>
        <strong>Sprint 21 · Automatización comercial</strong>
        <p style={{ margin: "6px 0 0", color: "#475467", fontSize: 13 }}>
          Usa plantillas WhatsApp para postventa, filtra clientes por segmento y ejecuta recordatorios de recompra para inactivos.
        </p>
      </div>

      <div style={hintCard}>
        <strong>¿Por qué ves menos clientes que pedidos?</strong>
        <p style={{ margin: "6px 0 0", color: "#475467", fontSize: 13 }}>
          La gestión de clientes agrupa pedidos por teléfono para evitar duplicados de invitados.
          Si un mismo número hace varios pedidos, cuenta como 1 cliente con historial acumulado.
        </p>
      </div>

      <div className="clientes-grid" style={layoutGrid}>
        <section style={cardStyle}>
          {loading && !firstLoadDone ? (
            <p>Cargando clientes...</p>
          ) : filteredClients.length === 0 ? (
            <p>No hay clientes con los filtros actuales.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Nombre</th>
                    <th style={thStyle}>Teléfono</th>
                    <th style={thStyle}>Tipo</th>
                    <th style={thStyle}>DNI</th>
                    <th style={thStyle}>Correo</th>
                    <th style={thStyle}>Pedidos</th>
                    <th style={thStyle}>Total gastado</th>
                    <th style={thStyle}>Segmentos</th>
                    <th style={thStyle}>Última compra</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClients.map((c) => {
                    const isSelected = selectedClient?.id === c.id;
                    const segments = c.segments || {};
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedClient(c)}
                        style={{ ...trStyle, ...(isSelected ? trSelectedStyle : {}) }}
                      >
                        <td style={tdStyle}><strong>{c.name || "-"}</strong></td>
                        <td style={tdStyle}>{c.phone || "-"}</td>
                        <td style={tdStyle}>{c.account_type === "registered" ? "Registrado" : "Invitado"}</td>
                        <td style={tdStyle}>{c.dni || "-"}</td>
                        <td style={tdStyle}>{c.email || "-"}</td>
                        <td style={tdStyle}>{Number(c.total_orders || 0)}</td>
                        <td style={tdStyle}>{money(c.total_spent)}</td>
                        <td style={tdStyle}>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {segments.frequent ? <span style={{ ...tagStyle, ...tagFrequent }}>Frecuente</span> : null}
                            {segments.high_ticket ? <span style={{ ...tagStyle, ...tagHighTicket }}>Ticket alto</span> : null}
                            {segments.inactive ? <span style={{ ...tagStyle, ...tagInactive }}>Inactivo</span> : null}
                          </div>
                        </td>
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
              <p style={line}><strong>Tipo:</strong> {selectedClient.account_type === "registered" ? "Registrado" : "Invitado"}</p>
              <p style={line}><strong>Email:</strong> {selectedClient.email || "-"}</p>
              <p style={line}><strong>DNI:</strong> {selectedClient.dni || "-"}</p>
              <p style={line}><strong>Total pedidos:</strong> {Number(selectedClient.total_orders || 0)}</p>
              <p style={line}><strong>Total gastado:</strong> {money(selectedClient.total_spent)}</p>
              <p style={line}><strong>Ticket promedio:</strong> {money(ticketPromedio)}</p>
              <p style={line}><strong>Última compra:</strong> {formatDate(selectedClient.last_order_at)}</p>

              <label style={{ fontSize: 13, color: "#475467" }}>
                Plantilla WhatsApp
                <select value={waTemplate} onChange={(e) => setWaTemplate(e.target.value)} style={{ ...inputStyle, width: "100%", marginTop: 5 }}>
                  <option value="confirmacion">Confirmación postventa</option>
                  <option value="seguimiento">Seguimiento de experiencia</option>
                  <option value="reactivacion">Reactivación comercial</option>
                </select>
              </label>

              <button type="button" style={waBtn} onClick={() => openWhatsApp(selectedClient, waTemplate)}>Enviar por WhatsApp</button>

              <div style={automationCard}>
                <strong>Recordatorios de recompra</strong>
                <p style={{ margin: "4px 0 8px", color: "#475467", fontSize: 13 }}>
                  {reminderTargets.length} clientes sin compra hace {inactiveDays}+ días.
                </p>
                {reminderTargets.length === 0 ? (
                  <small style={{ color: "#667085" }}>No hay clientes inactivos para recordar en este rango.</small>
                ) : (
                  <div style={{ display: "grid", gap: 6 }}>
                    {reminderTargets.slice(0, 4).map((client) => (
                      <div key={client.id} style={reminderRow}>
                        <span style={{ fontSize: 13 }}>{client.name || client.phone} · {daysSince(client.last_order_at)} días</span>
                        <button type="button" style={secondaryBtn} onClick={() => openWhatsApp(client, "reactivacion")}>Recordar</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

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

const hintCard = {
  border: "1px solid #e4e7ec",
  borderRadius: 12,
  padding: "10px 12px",
  background: "#f8fafc",
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


const tagStyle = {
  borderRadius: 999,
  padding: "2px 8px",
  fontSize: 11,
  fontWeight: 700,
};

const tagFrequent = {
  background: "#e0f2fe",
  color: "#075985",
};

const tagHighTicket = {
  background: "#f3e8ff",
  color: "#6b21a8",
};

const tagInactive = {
  background: "#fff1f2",
  color: "#be123c",
};

const automationCard = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: "8px 10px",
  background: "#f9fafb",
  display: "grid",
  gap: 4,
};

const reminderRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
};
