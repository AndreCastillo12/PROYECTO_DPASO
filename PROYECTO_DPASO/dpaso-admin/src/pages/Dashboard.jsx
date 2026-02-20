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

function isoDay(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Dashboard() {
  const [loading, setLoading] = useState(false);
  const [didLoad, setDidLoad] = useState(false);
  const [topWindowDays, setTopWindowDays] = useState(1);
  const [recentLimit, setRecentLimit] = useState(30);
  const [salesMonth, setSalesMonth] = useState("all");

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

    const trendFrom = new Date(now);
    trendFrom.setHours(0, 0, 0, 0);
    trendFrom.setDate(trendFrom.getDate() - 365);

    const [{ data: todayOrders }, { data: recentOrders }, { data: topItems }, { data: trendOrders }] = await Promise.all([
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
      supabase
        .from("orders")
        .select("created_at,total,estado")
        .gte("created_at", trendFrom.toISOString())
        .lte("created_at", now.toISOString())
        .order("created_at", { ascending: true }),
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

    const trendMap = (trendOrders || []).reduce((acc, row) => {
      if (String(row.estado || "") === "cancelled") return acc;
      const key = isoDay(row.created_at);
      acc[key] = (acc[key] || 0) + Number(row.total || 0);
      return acc;
    }, {});

    setSalesTrend(
      Object.entries(trendMap)
        .map(([day, total]) => ({ day, total: Number(total || 0) }))
        .sort((a, b) => a.day.localeCompare(b.day))
    );

    setDidLoad(true);
    setLoading(false);
  }

  const businessAlert = useMemo(() => {
    if (!didLoad) return "Haz clic en Actualizar dashboard para cargar los datos del día.";
    if (summary.ordersToday === 0) return "Aún no hay pedidos hoy.";
    if (summary.activeOrders > 10) return `Hay ${summary.activeOrders} pedidos activos. Revisa cola de cocina y despacho.`;
    return "Operación estable: sin alertas críticas por el momento.";
  }, [didLoad, summary.activeOrders, summary.ordersToday]);

  const monthOptions = useMemo(() => {
    const set = new Set(salesTrend.map((r) => r.day.slice(0, 7)));
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({
        value,
        label: new Date(`${value}-01T00:00:00`).toLocaleDateString("es-PE", { month: "long", year: "numeric" }),
      }));
  }, [salesTrend]);

  const chartRows = useMemo(() => {
    const base = salesMonth === "all" ? salesTrend : salesTrend.filter((r) => r.day.startsWith(salesMonth));
    return base.slice(-31);
  }, [salesMonth, salesTrend]);

  const svgChart = useMemo(() => {
    if (!chartRows.length) return { paths: [], bars: [], labels: [], yTicks: [] };
    const width = 860;
    const height = 260;
    const pad = { left: 72, right: 16, top: 12, bottom: 34 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const maxY = Math.max(...chartRows.map((r) => r.total), 1);
    const step = plotW / chartRows.length;
    const barW = Math.max(8, step * 0.62);

    const bars = chartRows.map((row, i) => {
      const x = pad.left + i * step + (step - barW) / 2;
      const h = (row.total / maxY) * plotH;
      const y = pad.top + plotH - h;
      return { x, y, w: barW, h, day: row.day, total: row.total, label: row.day.slice(8, 10) };
    });

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((pct) => {
      const y = pad.top + plotH - plotH * pct;
      return { y, value: maxY * pct };
    });

    return { width, height, bars, yTicks, pad };
  }, [chartRows]);

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
              <option key={item.days} value={item.days}>{item.label}</option>
            ))}
          </select>
        </article>

        <article style={cardStyle}>
          <label style={fieldLabel}>Pedidos recientes</label>
          <select value={recentLimit} onChange={(e) => setRecentLimit(Number(e.target.value))} style={selectStyle}>
            {RECENT_LIMITS.map((item) => (
              <option key={item} value={item}>{item} pedidos</option>
            ))}
          </select>
        </article>
      </section>

      <section style={hintCard}>{businessAlert}</section>

      <section style={kpiGrid}>
        <article style={{ ...kpiCard, background: "linear-gradient(135deg, #4ea0f2, #347ad0)" }}><span style={kpiLabel}>🧩 Pedidos hoy</span><strong style={kpiValue}>{summary.ordersToday}</strong></article>
        <article style={{ ...kpiCard, background: "linear-gradient(135deg, #8b5cf6, #6d28d9)" }}><span style={kpiLabel}>🧾 Ventas hoy</span><strong style={kpiValue}>{currency(summary.salesToday)}</strong></article>
        <article style={{ ...kpiCard, background: "linear-gradient(135deg, #49b9a9, #2e9e8f)" }}><span style={kpiLabel}>🚚 Pedidos activos</span><strong style={kpiValue}>{summary.activeOrders}</strong></article>
        <article style={{ ...kpiCard, background: "linear-gradient(135deg, #f59e42, #f57f20)" }}><span style={kpiLabel}>📊 Ticket promedio</span><strong style={kpiValue}>{currency(summary.averageTicket)}</strong></article>
      </section>

      <section style={doubleGrid}>
        <article style={cardStyle}>
          <div style={sectionHeader}><h3 style={sectionTitle}>Top productos ({dayLabel(topWindowDays)})</h3><Link to="/reportes" style={ghostBtn}>Ver reportes</Link></div>
          {topProducts.length === 0 ? <p style={emptyText}>Sin datos aún.</p> : topProducts.map((item) => (<div key={item.name} style={rowStyle}><span>{item.name}</span><strong>{item.qty}</strong></div>))}
        </article>

        <article style={cardStyle}>
          <div style={sectionHeader}><h3 style={sectionTitle}>Estado de pedidos (hoy)</h3><Link to="/pedidos" style={ghostBtn}>Ir a pedidos</Link></div>
          {statusRows.length === 0 ? <p style={emptyText}>Aún no hay pedidos hoy.</p> : statusRows.map((item) => (<div key={item.name} style={rowStyle}><span>{item.name}</span><strong>{item.count}</strong></div>))}
        </article>
      </section>

      <section style={cardStyle}>
        <div style={sectionHeader}>
          <h3 style={sectionTitle}>Top ventas</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={salesMonth} onChange={(e) => setSalesMonth(e.target.value)} style={selectStyleCompact}>
              <option value="all">Todos los meses</option>
              {monthOptions.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
            </select>
            <Link to="/reportes" style={ghostBtn}>Abrir reportes</Link>
          </div>
        </div>

        {chartRows.length === 0 ? (
          <p style={emptyText}>Sin datos de tendencia.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <svg viewBox={`0 0 ${svgChart.width} ${svgChart.height}`} style={{ width: "100%", minWidth: 760, display: "block", background: "#f8fafc", borderRadius: 12 }}>
              {svgChart.yTicks.map((tick, i) => (
                <g key={`tick-${i}`}>
                  <line x1={svgChart.pad.left} x2={svgChart.width - svgChart.pad.right} y1={tick.y} y2={tick.y} stroke="#d9e2ec" strokeWidth="1" />
                  <text x={svgChart.pad.left - 8} y={tick.y + 4} textAnchor="end" fontSize="11" fill="#475569">{currency(tick.value).replace("S/ ", "")}</text>
                </g>
              ))}
              <line x1={svgChart.pad.left} x2={svgChart.pad.left} y1={svgChart.pad.top} y2={svgChart.height - svgChart.pad.bottom} stroke="#64748b" strokeWidth="1.2" />
              <line x1={svgChart.pad.left} x2={svgChart.width - svgChart.pad.right} y1={svgChart.height - svgChart.pad.bottom} y2={svgChart.height - svgChart.pad.bottom} stroke="#64748b" strokeWidth="1.2" />

              {svgChart.bars.map((bar) => (
                <g key={`bar-${bar.day}`}>
                  <rect x={bar.x} y={bar.y} width={bar.w} height={bar.h} fill="#0db14b" rx="3" />
                  <text x={bar.x + bar.w / 2} y={svgChart.height - 12} textAnchor="middle" fontSize="11" fill="#334155">{bar.label}</text>
                </g>
              ))}
            </svg>
          </div>
        )}
      </section>

      <section style={cardStyle}>
        <div style={sectionHeader}><h3 style={sectionTitle}>Pedidos recientes</h3><Link to="/pedidos" style={ghostBtn}>Gestionar</Link></div>
        {latestOrders.length === 0 ? (
          <p style={emptyText}>No hay pedidos registrados.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={ordersTable}>
              <thead>
                <tr><th style={thStyle}>Código</th><th style={thStyle}>Cliente</th><th style={thStyle}>Fecha</th><th style={thStyle}>Estado</th><th style={thStyle}>Modalidad</th><th style={thStyle}>Pago</th><th style={thStyle}>Total</th></tr>
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

const pageWrap = { display: "flex", flexDirection: "column", gap: 12 };
const cardStyle = { background: "#ffffff", borderRadius: 18, border: "1px solid #e5e7eb", padding: 16 };
const heroCard = { ...cardStyle, background: "linear-gradient(180deg, #eeebff, #e9e7f5)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 };
const heroTitle = { margin: 0, fontSize: 34, lineHeight: 1.05, color: "#0f1f4a" };
const heroSubtitle = { margin: "8px 0 0", color: "#2f4069", fontSize: 16 };
const primaryBtn = { background: "linear-gradient(135deg, #6d5dfc, #5438e8)", color: "#fff", border: "none", borderRadius: 14, padding: "12px 18px", fontWeight: 700, cursor: "pointer" };
const filtersGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 };
const fieldLabel = { display: "block", marginBottom: 8, color: "#374151", fontSize: 14 };
const selectStyle = { width: "100%", border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 12px", fontSize: 14, background: "#fff" };
const selectStyleCompact = { ...selectStyle, width: 220, padding: "8px 10px" };
const hintCard = { ...cardStyle, color: "#4b638b", fontSize: 14 };
const kpiGrid = { display: "grid", gridTemplateColumns: "repeat(4, minmax(200px, 1fr))", gap: 12 };
const kpiCard = { borderRadius: 18, padding: 18, color: "#fff", minHeight: 120, display: "flex", flexDirection: "column", gap: 6 };
const kpiLabel = { fontSize: 16, opacity: 0.95 };
const kpiValue = { fontSize: 34, lineHeight: 1.05 };
const sectionHeader = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 };
const sectionTitle = { margin: 0, color: "#0f172a", fontSize: 28 };
const ghostBtn = { textDecoration: "none", color: "#1e3a8a", border: "1px solid #cbd5e1", borderRadius: 12, padding: "8px 12px", background: "#f8fafc", fontWeight: 600, fontSize: 13 };
const doubleGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 12 };
const rowStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f1f5f9", color: "#334155", fontSize: 14 };
const emptyText = { color: "#64748b", margin: 0, fontSize: 14 };
const ordersTable = { width: "100%", borderCollapse: "collapse", minWidth: 780 };
const thStyle = { textAlign: "left", fontSize: 13, color: "#475569", borderBottom: "1px solid #e5e7eb", padding: "8px 6px" };
const tdStyle = { fontSize: 14, color: "#0f172a", borderBottom: "1px solid #f1f5f9", padding: "9px 6px" };
