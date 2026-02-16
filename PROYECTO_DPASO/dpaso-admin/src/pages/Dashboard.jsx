import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";

function money(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function dateLabel(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function statusLabel(status) {
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
  return map[String(status || "").toLowerCase()] || status || "-";
}

function statusTone(status) {
  const map = {
    pending: { bg: "#f5eed6", color: "#8a6d1f" },
    accepted: { bg: "#e0ecff", color: "#1e4fa3" },
    preparing: { bg: "#efe4ff", color: "#6f3db7" },
    ready: { bg: "#ffe9d8", color: "#bb5f12" },
    dispatched: { bg: "#e3f3ff", color: "#1f5f8a" },
    delivered: { bg: "#dff5e8", color: "#1f7a43" },
    completed: { bg: "#d9fbe6", color: "#12633a" },
    cancelled: { bg: "#ffe0e0", color: "#b3261e" },
  };
  return map[String(status || "").toLowerCase()] || { bg: "#f2f4f7", color: "#475467" };
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { toast, showToast } = useToast(2600);
  const [loading, setLoading] = useState(true);
  const [ordersToday, setOrdersToday] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [topItems, setTopItems] = useState([]);
  const [statusCounts, setStatusCounts] = useState([]);

  async function loadDashboard() {
    setLoading(true);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);

    const [todayRes, recentRes, topItemsRes] = await Promise.all([
      supabase
        .from("orders")
        .select("id,total,estado,modalidad,payment_method,created_at,nombre_cliente,telefono,short_code")
        .gte("created_at", startOfDay.toISOString())
        .order("created_at", { ascending: false }),
      supabase
        .from("orders")
        .select("id,total,estado,modalidad,payment_method,created_at,nombre_cliente,telefono,short_code")
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("order_items")
        .select("nombre_snapshot,cantidad,subtotal,created_at")
        .gte("created_at", weekAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(300),
    ]);

    if (todayRes.error || recentRes.error || topItemsRes.error) {
      showToast(
        todayRes.error?.message || recentRes.error?.message || topItemsRes.error?.message || "No se pudo cargar dashboard",
        "error"
      );
      setLoading(false);
      return;
    }

    const todayOrders = todayRes.data || [];
    setOrdersToday(todayOrders);
    setRecentOrders(recentRes.data || []);

    const grouped = new Map();
    for (const item of topItemsRes.data || []) {
      const key = String(item.nombre_snapshot || "Sin nombre");
      const prev = grouped.get(key) || { name: key, qty: 0, sales: 0 };
      grouped.set(key, {
        ...prev,
        qty: prev.qty + Number(item.cantidad || 0),
        sales: prev.sales + Number(item.subtotal || 0),
      });
    }

    const top = Array.from(grouped.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 6);
    setTopItems(top);

    const statusMap = new Map();
    for (const row of todayOrders) {
      const key = String(row.estado || "pending").toLowerCase();
      statusMap.set(key, (statusMap.get(key) || 0) + 1);
    }
    setStatusCounts(
      Array.from(statusMap.entries()).map(([status, count]) => ({ status, count }))
    );

    setLoading(false);
  }


  const kpis = useMemo(() => {
    const totalOrders = ordersToday.length;
    const totalSales = ordersToday
      .filter((o) => String(o.estado || "") !== "cancelled")
      .reduce((acc, o) => acc + Number(o.total || 0), 0);
    const activeOrders = ordersToday.filter((o) => !["completed", "cancelled"].includes(String(o.estado || "").toLowerCase())).length;
    const avgTicket = totalOrders ? totalSales / totalOrders : 0;
    return { totalOrders, totalSales, activeOrders, avgTicket };
  }, [ordersToday]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Toast toast={toast} />

      <section style={heroCard}>
        <div>
          <h2 style={{ margin: "0 0 6px" }}>Dashboard operativo · Sprint 20</h2>
          <p style={{ margin: 0, color: "#667085" }}>
            Vista rápida del negocio: ventas, pedidos activos, top productos y actividad reciente.
            Usa <strong>Actualizar dashboard</strong> para traer data en tiempo real.
          </p>
        </div>
        <button type="button" style={btnPrimary} onClick={loadDashboard} disabled={loading}>
          {loading ? "Actualizando..." : "Actualizar dashboard"}
        </button>
      </section>

      <section style={kpiGrid}>
        <article style={kpiCard}><span>Pedidos hoy</span><strong>{kpis.totalOrders}</strong></article>
        <article style={kpiCard}><span>Ventas hoy</span><strong>{money(kpis.totalSales)}</strong></article>
        <article style={kpiCard}><span>Pedidos activos</span><strong>{kpis.activeOrders}</strong></article>
        <article style={kpiCard}><span>Ticket promedio</span><strong>{money(kpis.avgTicket)}</strong></article>
      </section>

      <section style={layoutGrid}>
        <article style={cardStyle}>
          <div style={sectionHeader}>
            <h3 style={{ margin: 0 }}>Top productos (7 días)</h3>
            <button type="button" style={linkBtn} onClick={() => navigate("/reportes")}>Ver reportes</button>
          </div>

          {topItems.length === 0 ? (
            <p style={emptyText}>Sin datos aún.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {topItems.map((item, index) => (
                <div key={item.name} style={topItemRow}>
                  <div style={topItemRank}>{index + 1}</div>
                  <div style={{ flex: 1 }}>
                    <strong>{item.name}</strong>
                    <div style={{ color: "#667085", fontSize: 13 }}>{item.qty} und · {money(item.sales)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article style={cardStyle}>
          <div style={sectionHeader}>
            <h3 style={{ margin: 0 }}>Estado de pedidos (hoy)</h3>
            <button type="button" style={linkBtn} onClick={() => navigate("/pedidos")}>Ir a pedidos</button>
          </div>

          {statusCounts.length === 0 ? (
            <p style={emptyText}>Aún no hay pedidos hoy.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {statusCounts.map((item) => {
                const tone = statusTone(item.status);
                return (
                  <div key={item.status} style={{ ...statusRow, background: tone.bg, color: tone.color }}>
                    <span>{statusLabel(item.status)}</span>
                    <strong>{item.count}</strong>
                  </div>
                );
              })}
            </div>
          )}
        </article>
      </section>

      <section style={cardStyle}>
        <div style={sectionHeader}>
          <h3 style={{ margin: 0 }}>Pedidos recientes</h3>
          <button type="button" style={linkBtn} onClick={() => navigate("/pedidos")}>Gestionar</button>
        </div>

        {recentOrders.length === 0 ? (
          <p style={emptyText}>No hay pedidos registrados.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Código</th>
                  <th style={thStyle}>Cliente</th>
                  <th style={thStyle}>Fecha</th>
                  <th style={thStyle}>Estado</th>
                  <th style={thStyle}>Modalidad</th>
                  <th style={thStyle}>Pago</th>
                  <th style={thStyle}>Total</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((o) => {
                  const tone = statusTone(o.estado);
                  return (
                    <tr key={o.id}>
                      <td style={tdStyle}><strong>{o.short_code || o.id.slice(-8).toUpperCase()}</strong></td>
                      <td style={tdStyle}>{o.nombre_cliente || "-"}</td>
                      <td style={tdStyle}>{dateLabel(o.created_at)}</td>
                      <td style={tdStyle}>
                        <span style={{ ...badgeStyle, background: tone.bg, color: tone.color }}>{statusLabel(o.estado)}</span>
                      </td>
                      <td style={tdStyle}>{o.modalidad || "-"}</td>
                      <td style={tdStyle}>{o.payment_method || "-"}</td>
                      <td style={tdStyle}>{money(o.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const heroCard = {
  background: "linear-gradient(135deg, #eef4ff 0%, #f6ecff 100%)",
  borderRadius: 14,
  padding: 14,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
};

const btnPrimary = {
  background: "#4f46e5",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "10px 14px",
  cursor: "pointer",
};

const cardStyle = {
  background: "#fff",
  borderRadius: 12,
  padding: 12,
  boxShadow: "0 4px 14px rgba(0,0,0,.06)",
};

const kpiGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 10,
};

const kpiCard = {
  ...cardStyle,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const layoutGrid = {
  display: "grid",
  gridTemplateColumns: "1.2fr 1fr",
  gap: 10,
};

const sectionHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 10,
  gap: 10,
};

const linkBtn = {
  background: "#fff",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  padding: "6px 9px",
  cursor: "pointer",
  color: "#344054",
};

const topItemRow = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  border: "1px solid #eef2f6",
  borderRadius: 10,
  padding: "8px 10px",
};

const topItemRank = {
  width: 28,
  height: 28,
  borderRadius: 999,
  background: "#efeaff",
  color: "#4f46e5",
  display: "grid",
  placeItems: "center",
  fontWeight: 700,
  fontSize: 13,
};

const statusRow = {
  display: "flex",
  justifyContent: "space-between",
  borderRadius: 8,
  padding: "8px 10px",
  fontWeight: 600,
};

const emptyText = {
  margin: 0,
  color: "#667085",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 760,
};

const thStyle = {
  textAlign: "left",
  borderBottom: "1px solid #e5e7eb",
  color: "#6b7280",
  fontSize: 13,
  padding: "8px 6px",
  whiteSpace: "nowrap",
};

const tdStyle = {
  borderBottom: "1px solid #f1f5f9",
  padding: "10px 6px",
  fontSize: 14,
};

const badgeStyle = {
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 700,
};
