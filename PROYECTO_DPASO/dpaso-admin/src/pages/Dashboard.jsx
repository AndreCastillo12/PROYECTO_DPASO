import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import { readAdminPreference, saveAdminPreference } from "../utils/adminPreferences";

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
    pending: { bg: "#fff3db", color: "#9a5b00" },
    accepted: { bg: "#e8f0ff", color: "#1e4fa3" },
    preparing: { bg: "#efe8ff", color: "#6443ba" },
    ready: { bg: "#ffecd9", color: "#b45a0b" },
    dispatched: { bg: "#e8f5ff", color: "#176389" },
    delivered: { bg: "#e6f8ee", color: "#157145" },
    completed: { bg: "#dff8ea", color: "#0f6a3a" },
    cancelled: { bg: "#ffe9e9", color: "#b42318" },
  };
  return map[String(status || "").toLowerCase()] || { bg: "#f2f4f7", color: "#475467" };
}

function DashboardSkeleton() {
  return (
    <>
      <section style={kpiGrid}>
        {[1, 2, 3, 4].map((item) => (
          <article key={item} style={kpiCardBase}>
            <div style={{ ...skeletonBlock, width: "48%", height: 12 }} />
            <div style={{ ...skeletonBlock, width: "35%", height: 30 }} />
          </article>
        ))}
      </section>
      <section style={layoutGrid}>
        <article style={panelCard}>
          <div style={{ ...skeletonBlock, height: 18, width: "45%", marginBottom: 12 }} />
          <div style={{ display: "grid", gap: 10 }}>
            {[1, 2, 3, 4].map((item) => <div key={item} style={{ ...skeletonBlock, height: 50 }} />)}
          </div>
        </article>
        <article style={panelCard}>
          <div style={{ ...skeletonBlock, height: 18, width: "45%", marginBottom: 12 }} />
          <div style={{ display: "grid", gap: 10 }}>
            {[1, 2, 3, 4].map((item) => <div key={item} style={{ ...skeletonBlock, height: 40 }} />)}
          </div>
        </article>
      </section>
    </>
  );
}

function SalesSparkline({ rows }) {
  if (!rows || rows.length === 0) return <p style={emptyText}>Sin datos de tendencia.</p>;

  const safe = rows.map((r, i) => ({
    x: i,
    y: Number(r.total_sales || 0),
    label: r.label || `Punto ${i + 1}`,
  }));

  const width = 600;
  const height = 190;
  const pad = 30;
  const maxY = Math.max(...safe.map((p) => p.y), 1);
  const minY = Math.min(...safe.map((p) => p.y), 0);
  const range = Math.max(maxY - minY, 1);
  const step = safe.length > 1 ? (width - pad * 2) / (safe.length - 1) : 0;

  const points = safe.map((p, idx) => {
    const x = pad + idx * step;
    const y = height - pad - ((p.y - minY) / range) * (height - pad * 2);
    return { ...p, x, y };
  });

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L ${width - pad} ${height - pad} L ${pad} ${height - pad} Z`;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", maxWidth: 700, height: 210 }}>
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={width} height={height} rx="16" fill="#f8faff" />
        <path d={area} fill="url(#areaGrad)" />
        <path d={line} fill="none" stroke="url(#lineGrad)" strokeWidth="3.5" strokeLinecap="round" />
        {points.map((p) => <circle key={`${p.label}-${p.x}`} cx={p.x} cy={p.y} r="3.8" fill="#4f46e5" />)}
      </svg>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", color: "#667085", fontSize: 12 }}>
        {safe.map((item) => <span key={item.label}>{item.label}: {money(item.y)}</span>)}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { toast, showToast } = useToast(2600);

  const prefs = readAdminPreference("dashboard_filters", { rangeDays: "7", recentLimit: "8" });
  const [rangeDays, setRangeDays] = useState(String(prefs.rangeDays || "7"));
  const [recentLimit, setRecentLimit] = useState(String(prefs.recentLimit || "8"));

  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [profileRole, setProfileRole] = useState("admin");

  const [ordersToday, setOrdersToday] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [topItems, setTopItems] = useState([]);
  const [statusCounts, setStatusCounts] = useState([]);
  const [salesSeries, setSalesSeries] = useState([]);

  const kpis = useMemo(() => {
    const totalOrders = ordersToday.length;
    const totalSales = ordersToday
      .filter((o) => String(o.estado || "") !== "cancelled")
      .reduce((acc, o) => acc + Number(o.total || 0), 0);
    const activeOrders = ordersToday.filter((o) => !["completed", "cancelled"].includes(String(o.estado || "").toLowerCase())).length;
    const cancelled = ordersToday.filter((o) => String(o.estado || "").toLowerCase() === "cancelled").length;
    const cancelPct = totalOrders ? (cancelled * 100) / totalOrders : 0;
    const avgTicket = totalOrders ? totalSales / totalOrders : 0;
    return { totalOrders, totalSales, activeOrders, avgTicket, cancelPct };
  }, [ordersToday]);

  const alerts = useMemo(() => {
    const list = [];
    if (kpis.activeOrders >= 8) list.push({ tone: "warning", text: `Hay ${kpis.activeOrders} pedidos activos: refuerza cocina/reparto.` });
    if (kpis.cancelPct >= 20) list.push({ tone: "danger", text: `Cancelaciones altas (${kpis.cancelPct.toFixed(1)}%). Revisa tiempos y stock.` });
    if (kpis.totalOrders > 0 && kpis.totalSales === 0) list.push({ tone: "warning", text: "Hay pedidos pero ventas netas en cero. Verifica estados y pagos." });
    if (kpis.totalOrders === 0) list.push({ tone: "info", text: "Aún no hay pedidos hoy." });
    if (list.length === 0) list.push({ tone: "success", text: "Operación saludable por ahora. Mantén el monitoreo." });
    return list;
  }, [kpis.activeOrders, kpis.cancelPct, kpis.totalOrders, kpis.totalSales]);

  async function loadDashboard() {
    saveAdminPreference("dashboard_filters", { rangeDays, recentLimit });
    setLoading(true);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const days = Number(rangeDays || 7);
    const fromDate = new Date(Date.now() - (Math.max(1, days) - 1) * 24 * 60 * 60 * 1000);
    const limit = Math.max(5, Math.min(30, Number(recentLimit || 8)));

    const [authRes, todayRes, recentRes, topItemsRes, salesRes] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("orders").select("id,total,estado,modalidad,payment_method,created_at,nombre_cliente,telefono,short_code").gte("created_at", startOfDay.toISOString()).order("created_at", { ascending: false }),
      supabase.from("orders").select("id,total,estado,modalidad,payment_method,created_at,nombre_cliente,telefono,short_code").order("created_at", { ascending: false }).limit(limit),
      supabase.from("order_items").select("nombre_snapshot,cantidad,subtotal,created_at").gte("created_at", fromDate.toISOString()).order("created_at", { ascending: false }).limit(400),
      supabase.rpc("rpc_sales_report", {
        date_from: new Date(`${fromDate.toISOString().slice(0, 10)}T00:00:00`).toISOString(),
        date_to: new Date().toISOString(),
        group_by: "day",
      }),
    ]);

    const userId = authRes.data?.user?.id;
    if (userId) {
      const { data: profileData } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
      setProfileRole(profileData?.role || "admin");
    } else {
      setProfileRole("admin");
    }

    if (todayRes.error || recentRes.error || topItemsRes.error || salesRes.error) {
      showToast(todayRes.error?.message || recentRes.error?.message || topItemsRes.error?.message || salesRes.error?.message || "No se pudo cargar dashboard. Intenta nuevamente.", "error");
      setLoading(false);
      setHasLoadedOnce(true);
      return;
    }

    const todayOrders = todayRes.data || [];
    setOrdersToday(todayOrders);
    setRecentOrders(recentRes.data || []);
    setSalesSeries((salesRes.data || []).slice(-7));

    const grouped = new Map();
    for (const item of topItemsRes.data || []) {
      const key = String(item.nombre_snapshot || "Sin nombre");
      const prev = grouped.get(key) || { name: key, qty: 0, sales: 0 };
      grouped.set(key, { ...prev, qty: prev.qty + Number(item.cantidad || 0), sales: prev.sales + Number(item.subtotal || 0) });
    }

    const top = Array.from(grouped.values()).sort((a, b) => b.qty - a.qty).slice(0, 6);
    setTopItems(top);

    const statusMap = new Map();
    for (const row of todayOrders) {
      const key = String(row.estado || "pending").toLowerCase();
      statusMap.set(key, (statusMap.get(key) || 0) + 1);
    }
    setStatusCounts(Array.from(statusMap.entries()).map(([status, count]) => ({ status, count })));

    setLoading(false);
    setHasLoadedOnce(true);
  }

  const kpiDecor = [
    { bg: "linear-gradient(135deg, #31a2ff 0%, #0b7edb 100%)", icon: "💵" },
    { bg: "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)", icon: "🧾" },
    { bg: "linear-gradient(135deg, #14b8a6 0%, #0f9f8f 100%)", icon: "🚚" },
    { bg: "linear-gradient(135deg, #fb923c 0%, #f97316 100%)", icon: "📊" },
  ];

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Toast toast={toast} />
      <style>{`@keyframes dash-skeleton {0%{background-position:100% 50%}100%{background-position:0 50%}}`}</style>

      <section style={heroCard}>
        <div>
          <h2 style={{ margin: "0 0 6px", fontSize: 32, color: "#0f172a" }}>
            Dashboard operativo {loading && hasLoadedOnce ? "· Actualizando..." : ""}
          </h2>
          <p style={{ margin: 0, color: "#475467", fontSize: 15 }}>
            Bienvenido, rol <strong>{String(profileRole || "admin")}</strong>. Este es el resumen visual del negocio hoy.
          </p>
        </div>
        <button type="button" style={btnPrimary} onClick={loadDashboard} disabled={loading}>
          {loading ? "Actualizando..." : "Actualizar dashboard"}
        </button>
      </section>

      <section style={filterRow}>
        <label style={filterLabel}>
          Ventana top productos
          <select value={rangeDays} onChange={(e) => setRangeDays(e.target.value)} style={inputStyle}>
            <option value="1">Hoy</option>
            <option value="7">Últimos 7 días</option>
            <option value="14">Últimos 14 días</option>
            <option value="30">Últimos 30 días</option>
          </select>
        </label>

        <label style={filterLabel}>
          Pedidos recientes
          <select value={recentLimit} onChange={(e) => setRecentLimit(e.target.value)} style={inputStyle}>
            <option value="8">8 pedidos</option>
            <option value="12">12 pedidos</option>
            <option value="20">20 pedidos</option>
            <option value="30">30 pedidos</option>
          </select>
        </label>
      </section>

      {!hasLoadedOnce && loading ? (
        <DashboardSkeleton />
      ) : (
        <>
          {!hasLoadedOnce && !loading ? (
            <section style={panelCard}>
              <p style={{ margin: 0, color: "#667085" }}>
                Haz clic en <strong>Actualizar dashboard</strong> para cargar los datos del día.
              </p>
            </section>
          ) : null}

          <section style={kpiGrid}>
            {[{ label: "Pedidos hoy", value: kpis.totalOrders }, { label: "Ventas hoy", value: money(kpis.totalSales) }, { label: "Pedidos activos", value: kpis.activeOrders }, { label: "Ticket promedio", value: money(kpis.avgTicket) }].map((kpi, idx) => (
              <article key={kpi.label} style={{ ...kpiCardBase, background: kpiDecor[idx].bg }}>
                <span style={{ color: "rgba(255,255,255,.85)", fontSize: 13 }}>{kpiDecor[idx].icon} {kpi.label}</span>
                <strong style={{ color: "#fff", fontSize: 34, lineHeight: 1.1 }}>{kpi.value}</strong>
              </article>
            ))}
          </section>

          <section style={panelCard}>
            <div style={sectionHeader}>
              <h3 style={{ margin: 0 }}>Alertas del negocio</h3>
              <button type="button" style={linkBtn} onClick={() => navigate("/observabilidad")}>Ver observabilidad</button>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {alerts.map((a, idx) => <div key={`${a.tone}-${idx}`} style={{ ...alertRow, ...(alertTone[a.tone] || alertTone.info) }}>{a.text}</div>)}
            </div>
          </section>

          <section style={layoutGrid}>
            <article style={panelCard}>
              <div style={sectionHeader}>
                <h3 style={{ margin: 0 }}>Top productos ({rangeDays} días)</h3>
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

            <article style={panelCard}>
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

          <section style={panelCard}>
            <div style={sectionHeader}>
              <h3 style={{ margin: 0 }}>Tendencia de ventas</h3>
              <button type="button" style={linkBtn} onClick={() => navigate("/reportes")}>Abrir reportes</button>
            </div>
            <SalesSparkline rows={salesSeries} />
          </section>

          <section style={panelCard}>
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
                          <td style={tdStyle}><span style={{ ...badgeStyle, background: tone.bg, color: tone.color }}>{statusLabel(o.estado)}</span></td>
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
        </>
      )}
    </div>
  );
}

const heroCard = {
  background: "linear-gradient(135deg, #f0f6ff 0%, #f7efff 100%)",
  border: "1px solid #dbe7ff",
  borderRadius: 16,
  padding: 16,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
};

const filterRow = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 10,
};

const panelCard = {
  background: "#fff",
  borderRadius: 14,
  padding: 12,
  border: "1px solid #edf1f6",
  boxShadow: "0 6px 18px rgba(17, 24, 39, 0.06)",
};

const filterLabel = {
  ...panelCard,
  display: "grid",
  gap: 7,
  fontSize: 13,
  color: "#475467",
};

const inputStyle = {
  border: "1px solid #d0d5dd",
  borderRadius: 9,
  padding: "8px 10px",
  fontSize: 14,
  background: "#fff",
};

const btnPrimary = {
  background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "10px 14px",
  cursor: "pointer",
  boxShadow: "0 8px 18px rgba(79,70,229,.35)",
};

const kpiGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 10,
};

const kpiCardBase = {
  borderRadius: 14,
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 9,
  minHeight: 130,
  boxShadow: "0 12px 20px rgba(15, 23, 42, 0.16)",
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
  border: "1px solid #edf1f7",
  borderRadius: 10,
  padding: "8px 10px",
  background: "#fcfdff",
};

const topItemRank = {
  width: 28,
  height: 28,
  borderRadius: 999,
  background: "linear-gradient(135deg, #e0e7ff 0%, #ede9fe 100%)",
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

const skeletonBlock = {
  borderRadius: 8,
  background: "linear-gradient(90deg, #edf1f5 20%, #f7f9fb 37%, #edf1f5 63%)",
  backgroundSize: "400% 100%",
  animation: "dash-skeleton 1.4s ease infinite",
};

const alertRow = {
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid transparent",
};

const alertTone = {
  info: { background: "#eef4ff", color: "#1d4ed8", borderColor: "#c7d9ff" },
  warning: { background: "#fff7e6", color: "#a15c07", borderColor: "#f3d19e" },
  danger: { background: "#ffecec", color: "#b42318", borderColor: "#f5b5b2" },
  success: { background: "#e9f9ef", color: "#0f7a39", borderColor: "#a9e3bd" },
};
