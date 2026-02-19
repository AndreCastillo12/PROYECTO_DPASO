import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

const TOP_WINDOWS = [
  { label: "Hoy", days: 1 },
  { label: "7 días", days: 7 },
  { label: "30 días", days: 30 },
];

const RECENT_LIMITS = [10, 20, 30, 50];

function currency(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function dayLabel(value) {
  return value === 1 ? "1 día" : `${value} días`;
}

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

export default function Dashboard() {
  const [loading, setLoading] = useState(false);
  const [didLoad, setDidLoad] = useState(false);
  const [topWindowDays, setTopWindowDays] = useState(1);
  const [recentLimit, setRecentLimit] = useState(30);

  const [summary, setSummary] = useState({
    ordersToday: 0,
    salesToday: 0,
    activeOrders: 0,
    averageTicket: 0,
  });
  const [topProducts, setTopProducts] = useState([]);
  const [latestOrders, setLatestOrders] = useState([]);
  const [statusRows, setStatusRows] = useState([]);
  const [salesTrend, setSalesTrend] = useState([]);

  async function loadDashboard() {
    setLoading(true);
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const topFrom = new Date(now);
    topFrom.setHours(0, 0, 0, 0);
    topFrom.setDate(topFrom.getDate() - (topWindowDays - 1));

    const [{ data: todayOrders }, { data: recentOrders }, { data: topItems }] = await Promise.all([
      supabase
        .from("orders")
        .select("id,total,estado")
        .gte("created_at", todayStart.toISOString())
        .lte("created_at", now.toISOString())
        .order("created_at", { ascending: false }),
      supabase
        .from("orders")
        .select("id,total,estado,nombre_cliente,created_at,short_code,modalidad,payment_method,paid")
        .order("created_at", { ascending: false })
        .limit(recentLimit),
      supabase
        .from("order_items")
        .select("nombre_snapshot,cantidad,created_at")
        .gte("created_at", topFrom.toISOString())
        .lte("created_at", now.toISOString()),
    ]);

    const todayRows = todayOrders || [];
    const validToday = todayRows.filter((row) => String(row.estado || "") !== "cancelled");
    const activeRows = todayRows.filter((row) => ["pending", "accepted", "preparing", "ready", "dispatched"].includes(String(row.estado || "")));
    const salesToday = validToday.reduce((acc, row) => acc + Number(row.total || 0), 0);

    setSummary({
      ordersToday: todayRows.length,
      salesToday,
      activeOrders: activeRows.length,
      averageTicket: validToday.length ? salesToday / validToday.length : 0,
    });

    const recentRows = recentOrders || [];
    setLatestOrders(recentRows);

    const statusMap = recentRows.reduce((acc, row) => {
      const key = humanStatus(row.estado);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    setStatusRows(
      Object.entries(statusMap)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
    );

    const itemMap = (topItems || []).reduce((acc, row) => {
      const key = row.nombre_snapshot || "Producto";
      acc[key] = (acc[key] || 0) + Number(row.cantidad || 0);
      return acc;
    }, {});

    setTopProducts(
      Object.entries(itemMap)
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5)
    );

    const trendMap = recentRows.reduce((acc, row) => {
      const date = new Date(row.created_at);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      acc[key] = (acc[key] || 0) + Number(row.total || 0);
      return acc;
    }, {});

    setSalesTrend(Object.entries(trendMap).sort((a, b) => a[0].localeCompare(b[0])));
    setDidLoad(true);
    setLoading(false);
  }

  const businessAlert = useMemo(() => {
    if (!didLoad) return "Haz clic en Actualizar dashboard para cargar los datos del día.";
    if (summary.ordersToday === 0) return "Aún no hay pedidos hoy.";
    if (summary.activeOrders > 10) return `Hay ${summary.activeOrders} pedidos activos. Revisa cola de cocina y despacho.`;
    return "Operación estable: sin alertas críticas por el momento.";
  }, [didLoad, summary.activeOrders, summary.ordersToday]);

  const topSalesChart = useMemo(() => {
    const last = salesTrend.slice(-12);
    return last.map(([day, total]) => {
      const numericTotal = Number(total || 0);
      return {
        day,
        label: new Date(`${day}T00:00:00`).toLocaleDateString("es-PE", { day: "2-digit", month: "short" }),
        sales: numericTotal,
      };
    });
  }, [salesTrend]);

  const chartMax = useMemo(() => {
    if (!topSalesChart.length) return 1;
    return Math.max(...topSalesChart.map((item) => item.sales), 1);
  }, [topSalesChart]);

  return (
    <div style={pageWrap}>
      <section style={heroCard}>
        <div>
          <h1 style={heroTitle}>Dashboard operativo</h1>
          <p style={heroSubtitle}>Bienvenido, rol admin. Este es el resumen visual del negocio hoy.</p>
        </div>
        <button type="button" style={primaryBtn} onClick={loadDashboard} disabled={loading}>
          {loading ? "Actualizando..." : "Actualizar dashboard"}
        </button>
      </section>

      <section style={filtersGrid}>
        <article style={cardStyle}>
          <label style={fieldLabel}>Ventana top productos</label>
          <select value={topWindowDays} onChange={(e) => setTopWindowDays(Number(e.target.value))} style={selectStyle}>
            {TOP_WINDOWS.map((item) => (
              <option key={item.days} value={item.days}>
                {item.label}
              </option>
            ))}
          </select>
        </article>

        <article style={cardStyle}>
          <label style={fieldLabel}>Pedidos recientes</label>
          <select value={recentLimit} onChange={(e) => setRecentLimit(Number(e.target.value))} style={selectStyle}>
            {RECENT_LIMITS.map((item) => (
              <option key={item} value={item}>
                {item} pedidos
              </option>
            ))}
          </select>
        </article>
      </section>

      <section style={hintCard}>{businessAlert}</section>

      <section style={kpiGrid}>
        <article style={{ ...kpiCard, background: "linear-gradient(135deg, #4ea0f2, #347ad0)" }}>
          <span style={kpiLabel}>🧩 Pedidos hoy</span>
          <strong style={kpiValue}>{summary.ordersToday}</strong>
        </article>
        <article style={{ ...kpiCard, background: "linear-gradient(135deg, #8b5cf6, #6d28d9)" }}>
          <span style={kpiLabel}>🧾 Ventas hoy</span>
          <strong style={kpiValue}>{currency(summary.salesToday)}</strong>
        </article>
        <article style={{ ...kpiCard, background: "linear-gradient(135deg, #49b9a9, #2e9e8f)" }}>
          <span style={kpiLabel}>🚚 Pedidos activos</span>
          <strong style={kpiValue}>{summary.activeOrders}</strong>
        </article>
        <article style={{ ...kpiCard, background: "linear-gradient(135deg, #f59e42, #f57f20)" }}>
          <span style={kpiLabel}>📊 Ticket promedio</span>
          <strong style={kpiValue}>{currency(summary.averageTicket)}</strong>
        </article>
      </section>

      <section style={cardStyle}>
        <div style={sectionHeader}>
          <h3 style={sectionTitle}>Alertas del negocio</h3>
          <Link to="/reportes" style={ghostBtn}>Ver reportes</Link>
        </div>
        <div style={alertBox}>{didLoad ? businessAlert : "Aún no hay alertas cargadas."}</div>
      </section>

      <section style={doubleGrid}>
        <article style={cardStyle}>
          <div style={sectionHeader}>
            <h3 style={sectionTitle}>Top productos ({dayLabel(topWindowDays)})</h3>
            <Link to="/reportes" style={ghostBtn}>Ver reportes</Link>
          </div>
          {topProducts.length === 0 ? (
            <p style={emptyText}>Sin datos aún.</p>
          ) : (
            topProducts.map((item) => (
              <div key={item.name} style={rowStyle}>
                <span>{item.name}</span>
                <strong>{item.qty}</strong>
              </div>
            ))
          )}
        </article>

        <article style={cardStyle}>
          <div style={sectionHeader}>
            <h3 style={sectionTitle}>Estado de pedidos (hoy)</h3>
            <Link to="/pedidos" style={ghostBtn}>Ir a pedidos</Link>
          </div>
          {statusRows.length === 0 ? (
            <p style={emptyText}>Aún no hay pedidos hoy.</p>
          ) : (
            statusRows.map((item) => (
              <div key={item.name} style={rowStyle}>
                <span>{item.name}</span>
                <strong>{item.count}</strong>
              </div>
            ))
          )}
        </article>
      </section>

      <section style={cardStyle}>
        <div style={sectionHeader}>
          <h3 style={sectionTitle}>Top ventas</h3>
          <Link to="/reportes" style={ghostBtn}>Abrir reportes</Link>
        </div>
        {topSalesChart.length === 0 ? (
          <p style={emptyText}>Sin datos de tendencia.</p>
        ) : (
          <>
            <div style={chartWrap}>
              {topSalesChart.map((item) => (
                <div key={item.day} style={chartCol}>
                  <div style={chartSlot}>
                    <div style={{ ...chartBar, height: `${(item.sales / chartMax) * 100}%` }} />
                  </div>
                  <small style={chartLabel}>{item.label}</small>
                </div>
              ))}
            </div>

            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table style={ordersTable}>
                <thead>
                  <tr>
                    <th style={thStyle}>Fecha</th>
                    <th style={thStyle}>Total ventas</th>
                  </tr>
                </thead>
                <tbody>
                  {topSalesChart.map((row) => (
                    <tr key={`trend-${row.day}`}>
                      <td style={tdStyle}>{row.day}</td>
                      <td style={tdStyle}>{currency(row.sales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section style={cardStyle}>
        <div style={sectionHeader}>
          <h3 style={sectionTitle}>Pedidos recientes</h3>
          <Link to="/pedidos" style={ghostBtn}>Gestionar</Link>
        </div>
        {latestOrders.length === 0 ? (
          <p style={emptyText}>No hay pedidos registrados.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={ordersTable}>
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
                {latestOrders.slice(0, 10).map((order) => (
                  <tr key={order.id}>
                    <td style={tdStyle}><strong>{order.short_code || String(order.id).slice(-8).toUpperCase()}</strong></td>
                    <td style={tdStyle}>{order.nombre_cliente || "Cliente"}</td>
                    <td style={tdStyle}>{new Date(order.created_at).toLocaleString()}</td>
                    <td style={tdStyle}>{humanStatus(order.estado)}</td>
                    <td style={tdStyle}>{order.modalidad || "-"}</td>
                    <td style={tdStyle}>{order.paid ? (order.payment_method || "Pagado") : "-"}</td>
                    <td style={tdStyle}>{currency(order.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const pageWrap = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const cardStyle = {
  background: "#ffffff",
  borderRadius: 18,
  border: "1px solid #e5e7eb",
  padding: 16,
};

const heroCard = {
  ...cardStyle,
  background: "linear-gradient(180deg, #eeebff, #e9e7f5)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
};

const heroTitle = {
  margin: 0,
  fontSize: 34,
  lineHeight: 1.05,
  color: "#0f1f4a",
};

const heroSubtitle = {
  margin: "8px 0 0",
  color: "#2f4069",
  fontSize: 16,
};

const primaryBtn = {
  background: "linear-gradient(135deg, #6d5dfc, #5438e8)",
  color: "#fff",
  border: "none",
  borderRadius: 14,
  padding: "12px 18px",
  fontWeight: 700,
  cursor: "pointer",
};

const filtersGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
  gap: 12,
};

const fieldLabel = {
  display: "block",
  marginBottom: 8,
  color: "#374151",
  fontSize: 14,
};

const selectStyle = {
  width: "100%",
  border: "1px solid #cbd5e1",
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 14,
  background: "#fff",
};

const hintCard = {
  ...cardStyle,
  color: "#4b638b",
  fontSize: 14,
};

const kpiGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(200px, 1fr))",
  gap: 12,
};

const kpiCard = {
  borderRadius: 18,
  padding: 18,
  color: "#fff",
  minHeight: 120,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const kpiLabel = {
  fontSize: 16,
  opacity: 0.95,
};

const kpiValue = {
  fontSize: 34,
  lineHeight: 1.05,
};

const sectionHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  marginBottom: 10,
};

const sectionTitle = {
  margin: 0,
  color: "#0f172a",
  fontSize: 28,
};

const ghostBtn = {
  textDecoration: "none",
  color: "#1e3a8a",
  border: "1px solid #cbd5e1",
  borderRadius: 12,
  padding: "8px 12px",
  background: "#f8fafc",
  fontWeight: 600,
  fontSize: 13,
};

const alertBox = {
  border: "1px solid #c7d2fe",
  background: "#eef2ff",
  borderRadius: 12,
  padding: "12px 14px",
  color: "#41537a",
  fontSize: 14,
};

const doubleGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
  gap: 12,
};

const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 0",
  borderBottom: "1px solid #f1f5f9",
  color: "#334155",
  fontSize: 14,
};

const emptyText = {
  color: "#64748b",
  margin: 0,
  fontSize: 14,
};

const chartWrap = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(44px, 1fr))",
  gap: 8,
  alignItems: "end",
};

const chartCol = {
  display: "grid",
  gap: 6,
  justifyItems: "center",
};

const chartSlot = {
  height: 170,
  width: "100%",
  minWidth: 38,
  borderRadius: 10,
  background: "#f8fafc",
  position: "relative",
  display: "flex",
  alignItems: "end",
  padding: "0 6px",
};

const chartBar = {
  width: "100%",
  borderRadius: "8px 8px 0 0",
  background: "linear-gradient(180deg, #24c6b0, #1ea6bf)",
};

const chartLabel = {
  color: "#64748b",
  fontSize: 12,
};

const ordersTable = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 780,
};

const thStyle = {
  textAlign: "left",
  fontSize: 13,
  color: "#475569",
  borderBottom: "1px solid #e5e7eb",
  padding: "8px 6px",
};

const tdStyle = {
  fontSize: 14,
  color: "#0f172a",
  borderBottom: "1px solid #f1f5f9",
  padding: "9px 6px",
};
