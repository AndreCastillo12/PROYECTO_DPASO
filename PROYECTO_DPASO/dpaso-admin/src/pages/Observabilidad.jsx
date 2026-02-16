import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import {
  clearTelemetryEvents,
  logTelemetryEvent,
  readTelemetryEvents,
  summarizeTelemetry,
} from "../utils/telemetry";

function toDateInput(value) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function money(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function getDefaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return { from: toDateInput(from), to: toDateInput(to) };
}

export default function Observabilidad() {
  const { toast, showToast } = useToast(2400);
  const [loading, setLoading] = useState(false);
  const [telemetry, setTelemetry] = useState(() => readTelemetryEvents());
  const defaultRange = useMemo(() => getDefaultDateRange(), []);
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [kpis, setKpis] = useState({
    totalOrders: 0,
    completedOrders: 0,
    cancelledOrders: 0,
    conversionPct: 0,
    totalSales: 0,
    rpcMs: 0,
  });

  const telemetryStats = useMemo(() => summarizeTelemetry(telemetry), [telemetry]);

  async function loadDashboard() {
    setLoading(true);
    const start = Date.now();
    const fromIso = new Date(`${dateFrom}T00:00:00`).toISOString();
    const toIso = new Date(`${dateTo}T23:59:59`).toISOString();

    const { data, error } = await supabase
      .from("orders")
      .select("id,total,estado,created_at")
      .gte("created_at", fromIso)
      .lte("created_at", toIso);

    if (error) {
      logTelemetryEvent({
        level: "error",
        area: "observabilidad",
        event: "load_orders_failed",
        message: error.message || "No se pudo cargar órdenes",
        meta: { code: error.code, fromIso, toIso },
      });
      setTelemetry(readTelemetryEvents());
      showToast(error.message || "No se pudo cargar métricas", "error");
      setLoading(false);
      return;
    }

    const orders = data || [];
    const totalOrders = orders.length;
    const completedOrders = orders.filter((o) => String(o.estado || "") === "completed").length;
    const cancelledOrders = orders.filter((o) => String(o.estado || "") === "cancelled").length;
    const totalSales = orders
      .filter((o) => String(o.estado || "") !== "cancelled")
      .reduce((acc, o) => acc + Number(o.total || 0), 0);

    const conversionPct = totalOrders ? (completedOrders * 100) / totalOrders : 0;

    const rpcStart = Date.now();
    const { error: rpcError } = await supabase.rpc("rpc_sales_report", {
      date_from: fromIso,
      date_to: toIso,
      group_by: "day",
    });
    const rpcMs = Date.now() - rpcStart;

    if (rpcError) {
      logTelemetryEvent({
        level: "warning",
        area: "observabilidad",
        event: "rpc_sales_report_failed",
        message: rpcError.message || "rpc_sales_report falló",
        meta: { code: rpcError.code },
        durationMs: rpcMs,
      });
      showToast("No se pudo medir rpc_sales_report", "warning");
    } else {
      logTelemetryEvent({
        level: "info",
        area: "observabilidad",
        event: "rpc_sales_report_latency",
        message: "rpc_sales_report medido",
        durationMs: rpcMs,
      });
    }

    setKpis({
      totalOrders,
      completedOrders,
      cancelledOrders,
      conversionPct,
      totalSales,
      rpcMs,
    });

    logTelemetryEvent({
      level: "info",
      area: "observabilidad",
      event: "dashboard_loaded",
      message: "Tablero de observabilidad actualizado",
      durationMs: Date.now() - start,
      meta: { totalOrders, completedOrders, cancelledOrders },
    });

    setTelemetry(readTelemetryEvents());
    setLoading(false);
  }

  function onClearTelemetry() {
    clearTelemetryEvents();
    setTelemetry([]);
    showToast("Eventos de telemetry limpiados", "success");
  }


  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Toast toast={toast} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Observabilidad y calidad</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={btnSecondary} onClick={onClearTelemetry}>Limpiar eventos</button>
          <button type="button" style={btnPrimary} onClick={loadDashboard} disabled={loading}>
            {loading ? "Actualizando..." : "Actualizar métricas"}
          </button>
        </div>
      </div>

      <section style={cardStyle}>
        <div style={filterGrid}>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
        </div>
      </section>

      <section style={kpiGrid}>
        <article style={kpiCard}><span>Pedidos totales</span><strong>{kpis.totalOrders}</strong></article>
        <article style={kpiCard}><span>Completados</span><strong>{kpis.completedOrders}</strong></article>
        <article style={kpiCard}><span>Cancelados</span><strong>{kpis.cancelledOrders}</strong></article>
        <article style={kpiCard}><span>Conversión</span><strong>{kpis.conversionPct.toFixed(2)}%</strong></article>
        <article style={kpiCard}><span>Ventas (sin cancelados)</span><strong>{money(kpis.totalSales)}</strong></article>
        <article style={kpiCard}><span>Latencia rpc_sales_report</span><strong>{kpis.rpcMs} ms</strong></article>
      </section>

      <section style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Resumen de telemetry local</h3>
        <div style={kpiGrid}>
          <article style={kpiCard}><span>Eventos</span><strong>{telemetryStats.total}</strong></article>
          <article style={kpiCard}><span>Errores</span><strong>{telemetryStats.errors}</strong></article>
          <article style={kpiCard}><span>Warnings</span><strong>{telemetryStats.warnings}</strong></article>
          <article style={kpiCard}><span>Promedio ms</span><strong>{telemetryStats.avgRpcMs.toFixed(1)}</strong></article>
        </div>
      </section>

      <section style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Eventos recientes</h3>
        {telemetry.length === 0 ? (
          <p style={{ margin: 0 }}>Sin eventos aún.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Fecha</th>
                  <th style={thStyle}>Nivel</th>
                  <th style={thStyle}>Área</th>
                  <th style={thStyle}>Evento</th>
                  <th style={thStyle}>Mensaje</th>
                  <th style={thStyle}>ms</th>
                </tr>
              </thead>
              <tbody>
                {telemetry.slice(0, 30).map((row) => (
                  <tr key={row.id}>
                    <td style={tdStyle}>{new Date(row.at).toLocaleString()}</td>
                    <td style={tdStyle}>{row.level}</td>
                    <td style={tdStyle}>{row.area}</td>
                    <td style={tdStyle}>{row.event}</td>
                    <td style={tdStyle}>{row.message || "-"}</td>
                    <td style={tdStyle}>{row.durationMs ?? "-"}</td>
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

const cardStyle = {
  background: "#fff",
  borderRadius: 12,
  padding: 12,
  boxShadow: "0 4px 14px rgba(0,0,0,.06)",
};

const filterGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 10,
};

const inputStyle = {
  border: "1px solid #d0d5dd",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 14,
};

const btnPrimary = {
  background: "#162447",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "9px 12px",
  cursor: "pointer",
};

const btnSecondary = {
  background: "#fff",
  color: "#162447",
  border: "1px solid #162447",
  borderRadius: 8,
  padding: "9px 12px",
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
  gap: 6,
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 720,
};

const thStyle = {
  textAlign: "left",
  borderBottom: "1px solid #e5e7eb",
  color: "#6b7280",
  fontSize: 13,
  padding: "8px 6px",
};

const tdStyle = {
  borderBottom: "1px solid #f1f5f9",
  padding: "9px 6px",
  fontSize: 13,
};
