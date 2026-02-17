import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import { exportRowsToCsv } from "../utils/csv";
import { logTelemetryEvent } from "../utils/telemetry";
import { readAdminPreference, saveAdminPreference } from "../utils/adminPreferences";

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

export default function Reportes() {
  const { toast, showToast } = useToast(2500);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [kpis, setKpis] = useState({ totalSales: 0, totalOrders: 0, ticketPromedio: 0, cancelPct: 0 });

  const defaultPrefs = readAdminPreference("reportes_filters", null);
  const defaultTo = toDateInput(new Date());
  const defaultFrom = toDateInput(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));
  const [dateFrom, setDateFrom] = useState(defaultPrefs?.dateFrom || defaultFrom);
  const [dateTo, setDateTo] = useState(defaultPrefs?.dateTo || defaultTo);
  const [groupBy, setGroupBy] = useState(defaultPrefs?.groupBy || "day");

  async function loadReport() {
    setLoading(true);
    const fromIso = new Date(`${dateFrom}T00:00:00`).toISOString();
    const toIso = new Date(`${dateTo}T23:59:59`).toISOString();

    const { data, error } = await supabase.rpc("rpc_sales_report", {
      date_from: fromIso,
      date_to: toIso,
      group_by: groupBy,
    });

    if (error) {
      logTelemetryEvent({ level: "error", area: "reportes", event: "rpc_sales_report_failed", message: error.message || "No se pudo cargar reporte", meta: { code: error.code, groupBy } });
      showToast(error.message || "No se pudo cargar reporte. Intenta nuevamente.", "error");
      setRows([]);
      setLoading(false);
      return;
    }

    setRows(data || []);

    const { data: kpiOrders, error: kpiError } = await supabase
      .from("orders")
      .select("id,total,estado", { count: "exact" })
      .gte("created_at", fromIso)
      .lte("created_at", toIso);

    if (kpiError) {
      logTelemetryEvent({ level: "warning", area: "reportes", event: "load_kpis_failed", message: kpiError.message || "No se pudieron calcular KPIs", meta: { code: kpiError.code } });
      showToast("No se pudieron calcular KPIs. Revisa la conexión e intenta nuevamente.", "warning");
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

    setLoading(false);
  }

  useEffect(() => {
    loadReport();
  }, []);

  useEffect(() => {
    saveAdminPreference("reportes_filters", { dateFrom, dateTo, groupBy });
  }, [dateFrom, dateTo, groupBy]);

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
      <h2 style={{ margin: 0 }}>Reportes {loading && rows.length > 0 ? "· Actualizando..." : ""}</h2>

      <section style={cardStyle}>
        <div style={filtersGrid}>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} style={inputStyle}>
            {REPORT_TYPES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <button type="button" onClick={loadReport} style={btnPrimary} disabled={loading}>
            {loading ? "Cargando..." : "Aplicar"}
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

      <section style={cardStyle}>
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
  boxShadow: "0 4px 14px rgba(0,0,0,.06)",
};

const filtersGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 10,
};

const inputStyle = {
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: "9px 10px",
  fontSize: 14,
  background: "#fff",
};

const btnPrimary = {
  background: "#162447",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 12px",
  cursor: "pointer",
};

const btnSecondary = {
  background: "#fff",
  color: "#162447",
  border: "1px solid #162447",
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
