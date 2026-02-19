import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

const QUICK_ACTIONS = [
  { label: "Ver pedidos", to: "/pedidos" },
  { label: "Abrir caja", to: "/caja" },
  { label: "Ir a reportes", to: "/reportes" },
  { label: "Gestionar clientes", to: "/clientes" },
];

function currency(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function formatDate(dateValue) {
  if (!dateValue) return "-";
  return new Date(dateValue).toLocaleString();
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({
    sales: 0,
    orders: 0,
    averageTicket: 0,
    cancelPct: 0,
  });
  const [opMetrics, setOpMetrics] = useState({ conversion_rate: 0, dropped_orders: 0 });
  const [topProducts, setTopProducts] = useState([]);
  const [latestOrders, setLatestOrders] = useState([]);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      setLoading(true);

      const now = new Date();
      const from = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
      const to = now.toISOString();

      const [{ data: ordersData }, { data: opData }] = await Promise.all([
        supabase
          .from("orders")
          .select("id,total,estado,nombre_cliente,created_at")
          .gte("created_at", from)
          .lte("created_at", to)
          .order("created_at", { ascending: false })
          .limit(120),
        supabase.rpc("rpc_operational_metrics", { date_from: from, date_to: to }),
      ]);

      if (!active) return;

      const safeOrders = ordersData || [];
      const validOrders = safeOrders.filter((row) => String(row.estado || "") !== "cancelled");
      const cancelledCount = safeOrders.filter((row) => String(row.estado || "") === "cancelled").length;
      const sales = validOrders.reduce((acc, row) => acc + Number(row.total || 0), 0);

      setSummary({
        sales,
        orders: safeOrders.length,
        averageTicket: validOrders.length ? sales / validOrders.length : 0,
        cancelPct: safeOrders.length ? (cancelledCount * 100) / safeOrders.length : 0,
      });

      setLatestOrders(safeOrders.slice(0, 6));

      const orderIds = safeOrders.slice(0, 40).map((order) => order.id);
      if (orderIds.length > 0) {
        const { data: itemRows } = await supabase
          .from("order_items")
          .select("order_id,nombre_snapshot,cantidad")
          .in("order_id", orderIds);

        if (active) {
          const grouped = (itemRows || []).reduce((acc, row) => {
            const key = row.nombre_snapshot || "Producto";
            acc[key] = (acc[key] || 0) + Number(row.cantidad || 0);
            return acc;
          }, {});

          const sortedProducts = Object.entries(grouped)
            .map(([name, qty]) => ({ name, qty }))
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 5);

          setTopProducts(sortedProducts);
        }
      } else {
        setTopProducts([]);
      }

      setOpMetrics({
        conversion_rate: Number(opData?.conversion_rate || 0),
        dropped_orders: Number(opData?.dropped_orders || 0),
      });

      if (active) setLoading(false);
    }

    loadDashboard();
    return () => {
      active = false;
    };
  }, []);

  const kpis = useMemo(
    () => [
      { label: "Ventas (7 días)", value: currency(summary.sales) },
      { label: "Pedidos", value: summary.orders },
      { label: "Ticket promedio", value: currency(summary.averageTicket) },
      { label: "% cancelados", value: `${summary.cancelPct.toFixed(2)}%` },
      { label: "Conversión operativa", value: `${opMetrics.conversion_rate.toFixed(2)}%` },
      { label: "Pedidos caídos", value: opMetrics.dropped_orders },
    ],
    [summary, opMetrics]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ margin: 0 }}>Dashboard</h2>

      <section style={kpiGrid}>
        {kpis.map((kpi) => (
          <article key={kpi.label} style={kpiCard}>
            <span style={{ color: "#6b7280", fontSize: 13 }}>{kpi.label}</span>
            <strong style={{ fontSize: 24 }}>{loading ? "..." : kpi.value}</strong>
          </article>
        ))}
      </section>

      <section style={splitGrid}>
        <article style={cardStyle}>
          <h3 style={h3Style}>Accesos rápidos</h3>
          <div style={actionsGrid}>
            {QUICK_ACTIONS.map((item) => (
              <Link key={item.to} to={item.to} style={actionLink}>
                {item.label}
              </Link>
            ))}
          </div>
        </article>

        <article style={cardStyle}>
          <h3 style={h3Style}>Top productos recientes</h3>
          {topProducts.length === 0 ? (
            <p style={emptyText}>Sin datos disponibles.</p>
          ) : (
            topProducts.map((item) => (
              <div key={item.name} style={listRow}>
                <span>{item.name}</span>
                <strong>{item.qty}</strong>
              </div>
            ))
          )}
        </article>
      </section>

      <article style={cardStyle}>
        <h3 style={h3Style}>Últimas órdenes</h3>
        {latestOrders.length === 0 ? (
          <p style={emptyText}>No hay órdenes recientes.</p>
        ) : (
          latestOrders.map((order) => (
            <div key={order.id} style={listRow}>
              <div>
                <strong>{order.nombre_cliente || "Cliente"}</strong>
                <div style={{ fontSize: 12, color: "#6b7280" }}>{formatDate(order.created_at)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 700 }}>{currency(order.total)}</div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>{order.estado || "-"}</div>
              </div>
            </div>
          ))
        )}
      </article>
    </div>
  );
}

const cardStyle = {
  background: "#fff",
  borderRadius: 14,
  padding: 14,
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.08)",
};

const kpiGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
};

const kpiCard = {
  ...cardStyle,
  background: "linear-gradient(145deg, #162447, #1f3b70)",
  color: "#f8fafc",
};

const splitGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: 12,
};

const actionsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: 8,
};

const actionLink = {
  background: "#eff6ff",
  border: "1px solid #dbeafe",
  borderRadius: 10,
  padding: "10px 12px",
  color: "#1e3a8a",
  textDecoration: "none",
  fontWeight: 600,
};

const h3Style = {
  margin: "0 0 10px",
  fontSize: 17,
};

const listRow = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  padding: "9px 0",
  borderBottom: "1px solid #f1f5f9",
};

const emptyText = {
  margin: 0,
  color: "#6b7280",
};
