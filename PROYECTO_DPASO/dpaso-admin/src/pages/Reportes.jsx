import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import { exportRowsToCsv } from "../utils/csv";
import useAdminPreferences from "../hooks/useAdminPreferences";
import { OPERATION_MESSAGES, resolveErrorMessage } from "../utils/operationMessages";

function toDateInput(value) {
  const d = new Date(value);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function money(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function normalizeStatus(raw) {
  const value = String(raw || "").toLowerCase();
  if (["cancelled", "cancelado"].includes(value)) return "cancelled";
  if (["paid", "delivered", "completed", "closed"].includes(value)) return "paid";
  return "in_progress";
}

function formatStatusLabel(raw) {
  const normalized = normalizeStatus(raw);
  if (normalized === "cancelled") return "Cancelado";
  if (normalized === "paid") return "Pagado";
  return "En proceso";
}

const DEFAULT_DATE_TO = toDateInput(new Date());
const DEFAULT_DATE_FROM = toDateInput(new Date(new Date(DEFAULT_DATE_TO).getTime() - 6 * 24 * 60 * 60 * 1000));

const MODALIDAD_OPTIONS = ["all", "Delivery", "Recojo"];
const STATUS_OPTIONS = ["all", "paid", "cancelled", "in_progress"];

export default function Reportes() {
  const { toast, showToast } = useToast(2500);

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [orders, setOrders] = useState([]);
  const [advancedEnabled, setAdvancedEnabled] = useState(false);
  const [advancedLoading, setAdvancedLoading] = useState(false);
  const [opMetrics, setOpMetrics] = useState({ conversion_rate: 0, dropped_orders: 0, avg_rpc_ms: 0 });

  const [preferences, setPreferences] = useAdminPreferences("dpaso_admin_reportes_filters_v2", {
    dateFrom: DEFAULT_DATE_FROM,
    dateTo: DEFAULT_DATE_TO,
    modalidad: "all",
    status: "all"
  });

  const { dateFrom, dateTo, modalidad, status } = preferences;

  async function loadOrders({ silent = false } = {}) {
    if (silent) setRefreshing(true);
    else setLoading(true);

    setErrorMessage("");

    const fromIso = new Date(`${dateFrom}T00:00:00`).toISOString();
    const toIso = new Date(`${dateTo}T23:59:59`).toISOString();

    const { data, error } = await supabase
      .from("orders")
      .select("id,total,estado,modalidad,provincia,distrito,created_at,order_items(nombre_snapshot,cantidad,subtotal)")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: true });

    if (error) {
      const msg = resolveErrorMessage(error, OPERATION_MESSAGES.loadError);
      showToast(msg, "error");
      setErrorMessage(msg);
      setOrders([]);
      setLoading(false);
      setRefreshing(false);
      return false;
    }

    setOrders(Array.isArray(data) ? data : []);
    setLoading(false);
    setRefreshing(false);
    return true;
  }

  async function loadAdvancedMetrics() {
    if (!advancedEnabled) return;

    setAdvancedLoading(true);
    const fromIso = new Date(`${dateFrom}T00:00:00`).toISOString();
    const toIso = new Date(`${dateTo}T23:59:59`).toISOString();

    const { data, error } = await supabase.rpc("rpc_operational_metrics", {
      date_from: fromIso,
      date_to: toIso
    });

    if (error) {
      showToast(resolveErrorMessage(error, "No se pudieron cargar métricas avanzadas."), "warning");
      setAdvancedLoading(false);
      return;
    }

    setOpMetrics({
      conversion_rate: Number(data?.conversion_rate || 0),
      dropped_orders: Number(data?.dropped_orders || 0),
      avg_rpc_ms: Number(data?.avg_rpc_ms || 0)
    });
    setAdvancedLoading(false);
  }

  useEffect(() => {
    loadOrders();
  }, []);

  useEffect(() => {
    loadAdvancedMetrics();
  }, [advancedEnabled]);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      if (modalidad !== "all" && String(order.modalidad || "") !== modalidad) return false;
      if (status !== "all" && normalizeStatus(order.estado) !== status) return false;
      return true;
    });
  }, [orders, modalidad, status]);

  const kpis = useMemo(() => {
    const totalOrders = filteredOrders.length;
    const cancelledCount = filteredOrders.filter((order) => normalizeStatus(order.estado) === "cancelled").length;
    const paidOrActiveOrders = filteredOrders.filter((order) => normalizeStatus(order.estado) !== "cancelled");
    const totalSales = paidOrActiveOrders.reduce((acc, order) => acc + Number(order.total || 0), 0);

    return {
      totalSales,
      totalOrders,
      avgTicket: totalOrders ? totalSales / totalOrders : 0,
      cancelPct: totalOrders ? (cancelledCount * 100) / totalOrders : 0
    };
  }, [filteredOrders]);

  const salesByDay = useMemo(() => {
    const bucket = new Map();

    filteredOrders.forEach((order) => {
      const key = toDateInput(order.created_at || new Date());
      const prev = bucket.get(key) || { date: key, sales: 0, orders: 0 };
      const normalized = normalizeStatus(order.estado);
      const amount = normalized === "cancelled" ? 0 : Number(order.total || 0);
      bucket.set(key, {
        date: key,
        sales: prev.sales + amount,
        orders: prev.orders + 1
      });
    });

    return [...bucket.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [filteredOrders]);

  const topPlatos = useMemo(() => {
    const bucket = new Map();

    filteredOrders.forEach((order) => {
      const items = Array.isArray(order.order_items) ? order.order_items : [];
      items.forEach((item) => {
        const name = String(item.nombre_snapshot || "Sin nombre");
        const prev = bucket.get(name) || { name, qty: 0, total: 0 };
        bucket.set(name, {
          name,
          qty: prev.qty + Number(item.cantidad || 0),
          total: prev.total + Number(item.subtotal || 0)
        });
      });
    });

    return [...bucket.values()].sort((a, b) => b.qty - a.qty || b.total - a.total).slice(0, 10);
  }, [filteredOrders]);

  const topZonas = useMemo(() => {
    const bucket = new Map();

    filteredOrders
      .filter((order) => String(order.modalidad || "") === "Delivery")
      .forEach((order) => {
        const label = `${order.provincia || "-"} / ${order.distrito || "-"}`;
        const prev = bucket.get(label) || { zone: label, qty: 0, total: 0 };
        bucket.set(label, {
          zone: label,
          qty: prev.qty + 1,
          total: prev.total + (normalizeStatus(order.estado) === "cancelled" ? 0 : Number(order.total || 0))
        });
      });

    return [...bucket.values()].sort((a, b) => b.qty - a.qty || b.total - a.total).slice(0, 10);
  }, [filteredOrders]);

  const chartMax = useMemo(() => {
    const max = salesByDay.reduce((acc, row) => Math.max(acc, Number(row.sales || 0)), 0);
    return max > 0 ? max : 1;
  }, [salesByDay]);

  const csvRows = useMemo(() => {
    return filteredOrders.map((order) => [
      order.id,
      toDateInput(order.created_at),
      String(order.modalidad || ""),
      formatStatusLabel(order.estado),
      Number(order.total || 0)
    ]);
  }, [filteredOrders]);

  function onExportCsv() {
    exportRowsToCsv(
      `reporte_resumen_${dateFrom}_${dateTo}.csv`,
      ["Pedido", "Fecha", "Modalidad", "Estado", "Total"],
      csvRows
    );
  }

  async function applyFilters() {
    const ok = await loadOrders({ silent: true });
    if (!ok) return;
    if (advancedEnabled) await loadAdvancedMetrics();
    showToast(OPERATION_MESSAGES.loadSuccess, "success");
  }

  const hasData = filteredOrders.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Toast toast={toast} />
      <h2 style={{ margin: 0 }}>Reportes</h2>

      <section style={cardStyle}>
        <div style={filtersGrid}>
          <label style={fieldStyle}>Desde
            <input type="date" value={dateFrom} onChange={(e) => setPreferences((prev) => ({ ...prev, dateFrom: e.target.value }))} style={inputStyle} />
          </label>

          <label style={fieldStyle}>Hasta
            <input type="date" value={dateTo} onChange={(e) => setPreferences((prev) => ({ ...prev, dateTo: e.target.value }))} style={inputStyle} />
          </label>

          <label style={fieldStyle}>Modalidad
            <select value={modalidad} onChange={(e) => setPreferences((prev) => ({ ...prev, modalidad: e.target.value }))} style={inputStyle}>
              <option value="all">Todos</option>
              {MODALIDAD_OPTIONS.filter((value) => value !== "all").map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>

          <label style={fieldStyle}>Estado
            <select value={status} onChange={(e) => setPreferences((prev) => ({ ...prev, status: e.target.value }))} style={inputStyle}>
              <option value="all">Todos</option>
              {STATUS_OPTIONS.filter((value) => value !== "all").map((value) => (
                <option key={value} value={value}>{formatStatusLabel(value)}</option>
              ))}
            </select>
          </label>

          <button type="button" onClick={applyFilters} style={btnPrimary} disabled={loading || refreshing}>
            {loading || refreshing ? "Cargando..." : "Aplicar"}
          </button>
          <button type="button" onClick={onExportCsv} style={btnSecondary} disabled={!hasData}>
            Exportar CSV
          </button>
        </div>
      </section>

      <section style={kpiGrid}>
        <article style={kpiCard}><span>Ventas totales</span><strong>{money(kpis.totalSales)}</strong></article>
        <article style={kpiCard}><span># pedidos</span><strong>{kpis.totalOrders}</strong></article>
        <article style={kpiCard}><span>Ticket promedio</span><strong>{money(kpis.avgTicket)}</strong></article>
        <article style={kpiCard}><span>% cancelados</span><strong>{kpis.cancelPct.toFixed(2)}%</strong></article>
      </section>

      <section style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>Ventas por día</h3>
          {refreshing ? <small style={{ color: "#64748b" }}>Actualizando...</small> : null}
        </div>

        {loading ? <p style={stateText}>Cargando datos...</p> : null}
        {!loading && errorMessage ? <p style={{ ...stateText, color: "#b91c1c" }}>{errorMessage}</p> : null}
        {!loading && !errorMessage && salesByDay.length === 0 ? <p style={stateText}>Sin resultados para los filtros seleccionados.</p> : null}

        {!loading && !errorMessage && salesByDay.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <svg viewBox={`0 0 ${Math.max(500, salesByDay.length * 90)} 260`} style={{ width: "100%", minWidth: 500, height: 260, display: "block" }}>
              <polyline
                fill="none"
                stroke="#2fa67f"
                strokeWidth="3"
                points={salesByDay.map((row, index) => {
                  const x = 55 + index * 90;
                  const y = 220 - (Number(row.sales || 0) / chartMax) * 170;
                  return `${x},${y}`;
                }).join(" ")}
              />
              {salesByDay.map((row, index) => {
                const x = 55 + index * 90;
                const y = 220 - (Number(row.sales || 0) / chartMax) * 170;
                return (
                  <g key={row.date}>
                    <circle cx={x} cy={y} r="4" fill="#2fa67f" />
                    <text x={x} y="242" textAnchor="middle" fontSize="11" fill="#64748b">{row.date.slice(5)}</text>
                    <text x={x} y={Math.max(16, y - 8)} textAnchor="middle" fontSize="11" fill="#0f172a">{Number(row.sales).toFixed(0)}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        ) : null}
      </section>

      <section style={tablesGrid}>
        <article style={cardStyle}>
          <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 17 }}>Top platos</h3>
          <ReportTable
            rows={topPlatos}
            emptyLabel="Sin platos para este rango"
            firstHeader="Plato"
            renderRow={(row) => (
              <tr key={row.name}>
                <td style={tdStyle}>{row.name}</td>
                <td style={tdStyle}>{row.qty}</td>
                <td style={tdStyle}>{money(row.total)}</td>
              </tr>
            )}
          />
        </article>

        <article style={cardStyle}>
          <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 17 }}>Top zonas (Delivery)</h3>
          <ReportTable
            rows={topZonas}
            emptyLabel="Sin datos de zonas para este rango"
            firstHeader="Zona"
            renderRow={(row) => (
              <tr key={row.zone}>
                <td style={tdStyle}>{row.zone}</td>
                <td style={tdStyle}>{row.qty}</td>
                <td style={tdStyle}>{money(row.total)}</td>
              </tr>
            )}
          />
        </article>
      </section>

      <section style={cardStyle}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 600 }}>
          <input type="checkbox" checked={advancedEnabled} onChange={(e) => setAdvancedEnabled(e.target.checked)} />
          Modo avanzado
        </label>

        {advancedEnabled ? (
          <div style={{ marginTop: 12 }}>
            {advancedLoading ? <p style={stateText}>Cargando métricas operativas...</p> : (
              <div style={kpiGrid}>
                <article style={kpiCard}><span>Conversión operativa</span><strong>{opMetrics.conversion_rate.toFixed(2)}%</strong></article>
                <article style={kpiCard}><span>Pedidos caídos</span><strong>{opMetrics.dropped_orders}</strong></article>
                <article style={kpiCard}><span>RPC promedio checkout</span><strong>{opMetrics.avg_rpc_ms.toFixed(0)} ms</strong></article>
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ReportTable({ rows, renderRow, emptyLabel, firstHeader }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>{firstHeader}</th>
            <th style={thStyle}>Cantidad</th>
            <th style={thStyle}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td style={tdStyle} colSpan={3}>{emptyLabel}</td>
            </tr>
          ) : rows.map(renderRow)}
        </tbody>
      </table>
    </div>
  );
}

const cardStyle = {
  background: "#fff",
  borderRadius: 12,
  padding: 12,
  boxShadow: "0 8px 24px rgba(17,24,39,.04)"
};

const filtersGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  gap: 10
};

const fieldStyle = {
  display: "grid",
  gap: 6,
  color: "#334155",
  fontWeight: 600,
  fontSize: 13
};

const inputStyle = {
  border: "1px solid #dce7e2",
  borderRadius: 8,
  padding: "9px 10px",
  fontSize: 14,
  background: "#fff"
};

const btnPrimary = {
  background: "#2fa67f",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 12px",
  cursor: "pointer",
  alignSelf: "end"
};

const btnSecondary = {
  background: "#fff",
  color: "#2fa67f",
  border: "1px solid #2fa67f",
  borderRadius: 8,
  padding: "10px 12px",
  cursor: "pointer",
  alignSelf: "end"
};

const kpiGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 10
};

const kpiCard = {
  ...cardStyle,
  display: "flex",
  flexDirection: "column",
  gap: 8
};

const tablesGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
  gap: 12
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 350
};

const thStyle = {
  textAlign: "left",
  borderBottom: "1px solid #e5e7eb",
  color: "#6b7280",
  fontSize: 13,
  padding: "8px 6px",
  whiteSpace: "nowrap"
};

const tdStyle = {
  borderBottom: "1px solid #f1f5f9",
  padding: "10px 6px",
  fontSize: 14
};

const stateText = {
  margin: 0,
  color: "#64748b"
};
