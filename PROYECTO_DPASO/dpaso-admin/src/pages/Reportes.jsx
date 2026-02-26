import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import { exportRowsToCsv } from "../utils/csv";
import useAdminPreferences from "../hooks/useAdminPreferences";
import { OPERATION_MESSAGES, resolveErrorMessage } from "../utils/operationMessages";

const REPORT_TYPES = [
  { value: "day", label: "Ventas por día" },
  { value: "status", label: "Ventas por estado" },
  { value: "modalidad", label: "Ventas por modalidad" },
  { value: "payment_method", label: "Ventas por método de pago" },
  { value: "zone", label: "Ventas por zona" },
  { value: "top_products", label: "Top productos" },
];

function toDateInput(value) {
  const d = new Date(value);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function money(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

const DEFAULT_DATE_TO = toDateInput(new Date());
const DEFAULT_DATE_FROM = toDateInput(new Date(new Date(DEFAULT_DATE_TO).getTime() - 6 * 24 * 60 * 60 * 1000));

export default function Reportes() {
  const { toast, showToast } = useToast(2500);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState([]);
  const [kpis, setKpis] = useState({ totalSales: 0, totalOrders: 0, ticketPromedio: 0, cancelPct: 0 });
  const [opMetrics, setOpMetrics] = useState({ conversion_rate: 0, dropped_orders: 0, avg_rpc_ms: 0 });
  const [channelMetrics, setChannelMetrics] = useState({ web: { sales: 0, orders: 0, avg: 0 }, local: { sales: 0, orders: 0, avg: 0 } });

  const [preferences, setPreferences] = useAdminPreferences("dpaso_admin_reportes_filters", {
    dateFrom: DEFAULT_DATE_FROM,
    dateTo: DEFAULT_DATE_TO,
    groupBy: "day",
    orderBy: "sales_desc",
  });
  const { dateFrom, dateTo, groupBy, orderBy } = preferences;

  async function loadReport({ silent = false } = {}) {
    if (silent) setRefreshing(true);
    else setLoading(true);
    const fromIso = new Date(`${dateFrom}T00:00:00`).toISOString();
    const toIso = new Date(`${dateTo}T23:59:59`).toISOString();

    const { data, error } = await supabase.rpc("rpc_sales_report", {
      date_from: fromIso,
      date_to: toIso,
      group_by: groupBy,
    });

    if (error) {
      showToast(resolveErrorMessage(error, OPERATION_MESSAGES.loadError), "error");
      setRows([]);
      setLoading(false);
      setRefreshing(false);
      return false;
    }

    const orderedRows = [...(data || [])].sort((a, b) => {
      if (orderBy === "sales_asc") return Number(a.total_sales || 0) - Number(b.total_sales || 0);
      if (orderBy === "orders_desc") return Number(b.orders_count || 0) - Number(a.orders_count || 0);
      return Number(b.total_sales || 0) - Number(a.total_sales || 0);
    });
    setRows(orderedRows);

    const { data: kpiOrders, error: kpiError } = await supabase
      .from("orders")
      .select("id,total,estado", { count: "exact" })
      .gte("created_at", fromIso)
      .lte("created_at", toIso);

    if (kpiError) {
      showToast(resolveErrorMessage(kpiError, "No se pudieron calcular KPIs."), "warning");
    } else {
      const safeOrders = kpiOrders || [];
      const totalOrders = safeOrders.length;
      const nonCancelled = safeOrders.filter((o) => String(o.estado || "") !== "cancelled");
      const totalSales = nonCancelled.reduce((acc, o) => acc + Number(o.total || 0), 0);
      const cancelledCount = safeOrders.filter((o) => String(o.estado || "") === "cancelled").length;
      setKpis({
        totalSales,
        totalOrders,
        ticketPromedio: totalOrders ? totalSales / Math.max(nonCancelled.length, 1) : 0,
        cancelPct: totalOrders ? (cancelledCount * 100) / totalOrders : 0,
      });
    }


    const { data: opData, error: opError } = await supabase.rpc("rpc_operational_metrics", {
      date_from: fromIso,
      date_to: toIso,
    });

    if (!opError && opData) {
      setOpMetrics({
        conversion_rate: Number(opData.conversion_rate || 0),
        dropped_orders: Number(opData.dropped_orders || 0),
        avg_rpc_ms: Number(opData.avg_rpc_ms || 0),
      });
    }

    const { data: channelRows } = await supabase.rpc("rpc_sales_channel_summary", {
      date_from: fromIso,
      date_to: toIso,
    });
    if (channelRows) {
      const web = channelRows.find((r) => String(r.channel) === "web") || {};
      const local = channelRows.find((r) => String(r.channel) === "local") || {};
      setChannelMetrics({
        web: { sales: Number(web.total_sales || 0), orders: Number(web.orders_count || 0), avg: Number(web.avg_ticket || 0) },
        local: { sales: Number(local.total_sales || 0), orders: Number(local.orders_count || 0), avg: Number(local.avg_ticket || 0) },
      });
    }

    setLoading(false);
    setRefreshing(false);
    return true;
  }

  useEffect(() => {
    loadReport();
  }, []);

  const csvRows = useMemo(() => {
    return rows.map((r) => [r.label, Number(r.total_sales || 0), Number(r.orders_count || 0), Number(r.total_qty || 0)]);
  }, [rows]);

  function onExportCsv() {
    exportRowsToCsv(
      `reporte_${groupBy}_${dateFrom}_${dateTo}.csv`,
      ["Label", "Total ventas", "Pedidos", "Cantidad"],
      csvRows
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Toast toast={toast} />
      <h2 style={{ margin: 0 }}>Reportes</h2>

      <section style={cardStyle}>
        <div style={filtersGrid}>
          <input type="date" value={dateFrom} onChange={(e) => setPreferences((prev) => ({ ...prev, dateFrom: e.target.value }))} style={inputStyle} />
          <input type="date" value={dateTo} onChange={(e) => setPreferences((prev) => ({ ...prev, dateTo: e.target.value }))} style={inputStyle} />
          <select value={groupBy} onChange={(e) => setPreferences((prev) => ({ ...prev, groupBy: e.target.value }))} style={inputStyle}>
            {REPORT_TYPES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>

          <select value={orderBy} onChange={(e) => setPreferences((prev) => ({ ...prev, orderBy: e.target.value }))} style={inputStyle}>
            <option value="sales_desc">Orden: mayor venta</option>
            <option value="sales_asc">Orden: menor venta</option>
            <option value="orders_desc">Orden: más pedidos</option>
          </select>
          <button type="button" onClick={async () => { const ok = await loadReport({ silent: true }); if (ok) showToast(OPERATION_MESSAGES.loadSuccess, "success"); }} style={btnPrimary} disabled={loading || refreshing}>
            {loading || refreshing ? "Cargando..." : "Aplicar"}
          </button>
          <button type="button" onClick={onExportCsv} style={btnSecondary}>
            Exportar CSV
          </button>
        </div>
      </section>

      <section style={kpiGrid}>
        <article style={kpiCard}><span>Ventas totales</span><strong>{money(kpis.totalSales)}</strong></article>
        <article style={kpiCard}><span>Pedidos</span><strong>{kpis.totalOrders}</strong></article>
        <article style={kpiCard}><span>Ticket promedio</span><strong>{money(kpis.ticketPromedio)}</strong></article>
        <article style={kpiCard}><span>% cancelados</span><strong>{kpis.cancelPct.toFixed(2)}%</strong></article>
      </section>

      <section style={kpiGrid}>
        <article style={kpiCard}><span>Conversión operativa</span><strong>{opMetrics.conversion_rate.toFixed(2)}%</strong></article>
        <article style={kpiCard}><span>Pedidos caídos</span><strong>{opMetrics.dropped_orders}</strong></article>
        <article style={kpiCard}><span>RPC promedio checkout</span><strong>{opMetrics.avg_rpc_ms.toFixed(0)} ms</strong></article>
      </section>

      <section style={cardStyle}>
        {refreshing && <p style={{ marginTop: 0, color: "#64748b" }}>Actualizando reporte sin bloquear la vista...</p>}
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Label</th>
                <th style={thStyle}>Total ventas</th>
                <th style={thStyle}>Pedidos</th>
                <th style={thStyle}>Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td style={tdStyle} colSpan={4}>Sin resultados</td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={`${r.label}-${i}`}>
                    <td style={tdStyle}>{r.label}</td>
                    <td style={tdStyle}>{money(r.total_sales)}</td>
                    <td style={tdStyle}>{Number(r.orders_count || 0)}</td>
                    <td style={tdStyle}>{Number(r.total_qty || 0)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const cardStyle = {
  background: "#fff",
  borderRadius: 12,
  padding: 12,
  boxShadow: "0 8px 24px rgba(17,24,39,.04)",
};

const filtersGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 10,
};

const inputStyle = {
  border: "1px solid #dce7e2",
  borderRadius: 8,
  padding: "9px 10px",
  fontSize: 14,
  background: "#fff",
};

const btnPrimary = {
  background: "#2fa67f",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 12px",
  cursor: "pointer",
};

const btnSecondary = {
  background: "#fff",
  color: "#2fa67f",
  border: "1px solid #2fa67f",
  borderRadius: 8,
  padding: "10px 12px",
  cursor: "pointer",
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

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 560,
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
