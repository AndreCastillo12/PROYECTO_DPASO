import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FiBarChart2, FiClipboard, FiDollarSign, FiShoppingBag } from "react-icons/fi";
import { supabase } from "../lib/supabaseClient";
import "../styles/dashboard-sedap.css";

const TOP_WINDOWS = [
  { label: "Hoy", days: 1 },
  { label: "7 días", days: 7 },
  { label: "30 días", days: 30 },
];

const RECENT_LIMITS = [10, 20, 30, 50];

const ORDER_STATUS = ["pending", "accepted", "preparing", "ready", "dispatched", "delivered", "cancelled"];
const NORMALIZED_STATUS = { completed: "delivered" };

function normalizeStatus(status) {
  const key = String(status || "").toLowerCase();
  return NORMALIZED_STATUS[key] || key || "pending";
}

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
    preparing: "En preparación",
    ready: "Listo",
    dispatched: "En reparto",
    delivered: "Entregado",
    cancelled: "Cancelado",
  };
  return map[normalizeStatus(status)] || "Sin estado";
}

function isoDay(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortDayLabel(dayIso) {
  const d = new Date(`${dayIso}T00:00:00`);
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit" });
}

function buildPeriodDays(fromDate, days) {
  const rows = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(fromDate);
    d.setDate(fromDate.getDate() + i);
    rows.push(isoDay(d));
  }
  return rows;
}

export default function Dashboard() {
  const [loading, setLoading] = useState(false);
  const [didLoad, setDidLoad] = useState(false);
  const [topWindowDays, setTopWindowDays] = useState(7);
  const [recentLimit, setRecentLimit] = useState(30);

  const [summary, setSummary] = useState({
    ordersPeriod: 0,
    salesPeriod: 0,
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

    const periodFrom = new Date(now);
    periodFrom.setHours(0, 0, 0, 0);
    periodFrom.setDate(periodFrom.getDate() - (topWindowDays - 1));

    const { data: periodOrders, error: ordersError } = await supabase
      .from("orders")
      .select("id,total,estado,nombre_cliente,created_at,short_code,modalidad,payment_method,paid")
      .gte("created_at", periodFrom.toISOString())
      .lte("created_at", now.toISOString())
      .order("created_at", { ascending: false })
      .limit(Math.max(recentLimit, 200));

    if (ordersError) {
      setLoading(false);
      return;
    }

    const periodRows = periodOrders || [];
    const validPeriod = periodRows.filter((row) => normalizeStatus(row.estado) !== "cancelled");
    const activeRows = periodRows.filter((row) => ["pending", "accepted", "preparing", "ready", "dispatched"].includes(normalizeStatus(row.estado)));
    const salesPeriod = validPeriod.reduce((acc, row) => acc + Number(row.total || 0), 0);

    setSummary({
      ordersPeriod: periodRows.length,
      salesPeriod,
      activeOrders: activeRows.length,
      averageTicket: validPeriod.length ? salesPeriod / validPeriod.length : 0,
    });

    setLatestOrders(periodRows.slice(0, recentLimit));

    const statusMap = periodRows.reduce((acc, row) => {
      const key = humanStatus(normalizeStatus(row.estado));
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    setStatusRows(Object.entries(statusMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count));

    let topItems = [];
    if (periodRows.length > 0) {
      const orderIds = periodRows.map((row) => row.id);
      const { data } = await supabase.from("order_items").select("nombre_snapshot,cantidad,order_id").in("order_id", orderIds);
      topItems = data || [];
    }

    const itemMap = topItems.reduce((acc, row) => {
      const key = row.nombre_snapshot || "Producto";
      acc[key] = (acc[key] || 0) + Number(row.cantidad || 0);
      return acc;
    }, {});

    setTopProducts(Object.entries(itemMap).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 5));

    const trendMap = periodRows.reduce((acc, row) => {
      if (normalizeStatus(row.estado) === "cancelled") return acc;
      const key = isoDay(row.created_at);
      acc[key] = (acc[key] || 0) + Number(row.total || 0);
      return acc;
    }, {});

    const periodDays = buildPeriodDays(periodFrom, topWindowDays);
    setSalesTrend(periodDays.map((day) => ({ day, total: Number(trendMap[day] || 0) })));

    setDidLoad(true);
    setLoading(false);
  }

  useEffect(() => {
    loadDashboard();
  }, [topWindowDays, recentLimit]);

  const chartRows = useMemo(() => salesTrend, [salesTrend]);
  const maxTrend = useMemo(() => Math.max(...chartRows.map((r) => r.total), 1), [chartRows]);

  const donutData = useMemo(() => {
    const total = Math.max(latestOrders.length, 1);
    const baseColors = {
      pending: "#6eb7ff",
      accepted: "#7b8cff",
      preparing: "#9c6dff",
      ready: "#ffbf66",
      dispatched: "#4ec0c1",
      delivered: "#2ab079",
      cancelled: "#ff6f78",
    };

    return ORDER_STATUS.map((status) => {
      const count = latestOrders.filter((order) => normalizeStatus(order.estado) === status).length;
      return {
        label: humanStatus(status),
        pct: Math.round((count / total) * 100),
        color: baseColors[status],
      };
    });
  }, [latestOrders]);

  return (
    <div className="sedap-dashboard v2">
      <section className="sedap-dash-head">
        <div>
          <h3>Dashboard</h3>
          <p>{didLoad ? "Resumen actualizado en base a tus datos actuales." : "Haz clic en actualizar para cargar datos reales del día."}</p>
        </div>
        <div className="sedap-toolbar-actions">
          <select value={topWindowDays} onChange={(e) => setTopWindowDays(Number(e.target.value))}>{TOP_WINDOWS.map((item) => <option key={item.days} value={item.days}>{item.label}</option>)}</select>
          <select value={recentLimit} onChange={(e) => setRecentLimit(Number(e.target.value))}>{RECENT_LIMITS.map((item) => <option key={item} value={item}>{item} pedidos</option>)}</select>
          <button type="button" onClick={loadDashboard} disabled={loading}>{loading ? "Actualizando..." : "Actualizar"}</button>
        </div>
      </section>

      <section className="sedap-kpis-grid">
        <article><span className="kpi-icon"><FiClipboard /></span><small>Pedidos (periodo)</small><strong>{summary.ordersPeriod}</strong></article>
        <article><span className="kpi-icon"><FiShoppingBag /></span><small>Activos</small><strong>{summary.activeOrders}</strong></article>
        <article><span className="kpi-icon"><FiDollarSign /></span><small>Ventas (periodo)</small><strong>{currency(summary.salesPeriod)}</strong></article>
        <article><span className="kpi-icon"><FiBarChart2 /></span><small>Ticket promedio</small><strong>{currency(summary.averageTicket)}</strong></article>
      </section>

      <section className="sedap-analytics-grid">
        <article className="sedap-card pie-card">
          <div className="sedap-card-head"><h4>Estados de pedidos</h4></div>
          <div className="pie-list">
            {donutData.map((item) => (
              <div key={item.label} className="pie-item">
                <div className="donut" style={{ background: `conic-gradient(${item.color} ${item.pct}%, #e9eef7 0)` }}><span>{item.pct}%</span></div>
                <small>{item.label}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="sedap-card line-card">
          <div className="sedap-card-head">
            <h4>Tendencia de ventas ({dayLabel(topWindowDays)})</h4>
          </div>
          <div className="line-wrap">
            {chartRows.length === 0 ? <p className="sedap-empty">Sin datos</p> : (
              <svg viewBox="0 0 780 220">
                <polyline
                  fill="none"
                  stroke="#54c6a8"
                  strokeWidth="4"
                  points={chartRows.map((row, i) => `${20 + i * (740 / Math.max(chartRows.length - 1, 1))},${190 - ((row.total || 0) / maxTrend) * 160}`).join(" ")}
                />
                {chartRows.map((row, i) => (
                  <text key={row.day} x={20 + i * (740 / Math.max(chartRows.length - 1, 1))} y={210} textAnchor="middle" fontSize="10" fill="#64748b">
                    {shortDayLabel(row.day)}
                  </text>
                ))}
              </svg>
            )}
          </div>
        </article>
      </section>

      <section className="sedap-main-grid">
        <article className="sedap-card">
          <div className="sedap-card-head"><h4>Top productos ({dayLabel(topWindowDays)})</h4><Link to="/reportes">Ver más</Link></div>
          {topProducts.length === 0 ? <p className="sedap-empty">Sin datos</p> : topProducts.map((item) => <div className="sedap-row" key={item.name}><span>{item.name}</span><strong>{item.qty}</strong></div>)}
        </article>

        <article className="sedap-card">
          <div className="sedap-card-head"><h4>Estado pedidos</h4><Link to="/pedidos">Ir pedidos</Link></div>
          {statusRows.length === 0 ? <p className="sedap-empty">Sin datos</p> : statusRows.map((item) => <div className="sedap-row" key={item.name}><span>{item.name}</span><strong>{item.count}</strong></div>)}
        </article>
      </section>

      <section className="sedap-card">
        <div className="sedap-card-head"><h4>Pedidos recientes</h4><Link to="/pedidos">Gestionar</Link></div>
        {latestOrders.length === 0 ? <p className="sedap-empty">Sin datos</p> : (
          <div className="sedap-table-scroll">
            <table className="sedap-table">
              <thead>
                <tr><th>Código</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th>Modalidad</th><th>Pago</th><th>Total</th></tr>
              </thead>
              <tbody>
                {latestOrders.slice(0, 10).map((order) => (
                  <tr key={order.id}>
                    <td>{order.short_code || String(order.id).slice(-8).toUpperCase()}</td>
                    <td>{order.nombre_cliente || "Cliente"}</td>
                    <td>{new Date(order.created_at).toLocaleString()}</td>
                    <td><span className="sedap-badge">{humanStatus(normalizeStatus(order.estado))}</span></td>
                    <td>{order.modalidad || "-"}</td>
                    <td>{order.paid ? (order.payment_method || "Pagado") : "-"}</td>
                    <td>{currency(order.total)}</td>
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
