import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import { logCriticalEvent, logOperationalMetric } from "../lib/observability";

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(2));
}

function parseMoneyInput(value, { allowZero = true } = {}) {
  const normalized = roundMoney(value);
  if (normalized === null) return { ok: false, message: "Monto inválido" };
  if (normalized < 0) return { ok: false, message: "El monto no puede ser negativo" };
  if (!allowZero && normalized <= 0) return { ok: false, message: "El monto debe ser mayor a 0" };
  return { ok: true, value: normalized };
}

function money(value) {
  const safe = roundMoney(value);
  return `S/ ${(safe ?? 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function dbErrorMeta(error) {
  return {
    code: error?.code || null,
    message: error?.message || "",
    details: error?.details || null,
    hint: error?.hint || null,
  };
}

function downloadCsv(filename, rows) {
  const csv = rows
    .map((row) => row.map((cell) => {
      const raw = cell == null ? "" : String(cell);
      const escaped = raw.replace(/"/g, '""');
      return `"${escaped}"`;
    }).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportCloseReport(sessionResult, paymentEntries = []) {
  if (!sessionResult) return;
  const rows = [
    ["Campo", "Valor"],
    ["Session ID", sessionResult.session_id || ""],
    ["Apertura", Number(sessionResult.opening_amount || 0).toFixed(2)],
    ["Ventas efectivo", Number(sessionResult.cash_sales || 0).toFixed(2)],
    ["Ingresos manuales", Number(sessionResult.movements_in || 0).toFixed(2)],
    ["Egresos manuales", Number(sessionResult.movements_out || 0).toFixed(2)],
    ["Esperado (efectivo)", Number(sessionResult.expected_cash_amount || sessionResult.expected_amount || 0).toFixed(2)],
    ["Contado", Number(sessionResult.closing_amount || 0).toFixed(2)],
    ["Diferencia", Number(sessionResult.difference || 0).toFixed(2)],
    ["Cerrado en", sessionResult.closed_at || ""],
    [],
    ["Metodo de pago", "Monto"],
    ...paymentEntries.map(([key, value]) => [key, Number(value || 0).toFixed(2)]),
  ];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadCsv(`cierre-caja-${stamp}.csv`, rows);
}

function movementLabel(movement) {
  const isIn = movement.type === "in";
  const base = isIn ? "Ingreso" : "Egreso";
  if (movement.movement_source === "order_sale") {
    return `${base} automático · ${movement.reason}`;
  }
  return `${base} manual · ${movement.reason}`;
}

export default function Caja() {
  const { toast, showToast } = useToast(2800);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState(null);
  const [openSession, setOpenSession] = useState(null);
  const [movements, setMovements] = useState([]);
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [historySummary, setHistorySummary] = useState(null);
  const [historyBusyId, setHistoryBusyId] = useState(null);

  const [openingAmount, setOpeningAmount] = useState("0");
  const [openingNotes, setOpeningNotes] = useState("");
  const [movementType, setMovementType] = useState("in");
  const [movementReason, setMovementReason] = useState("");
  const [movementAmount, setMovementAmount] = useState("");
  const [closingAmount, setClosingAmount] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [lastCloseResult, setLastCloseResult] = useState(null);

  const busy = action !== null;

  async function handleError(context, error, fallbackMessage, extra = {}) {
    const meta = dbErrorMeta(error);
    console.error(`[Caja] ${context}`, meta, extra);
    await logCriticalEvent("admin_cash_error", `Caja:${context}`, error, extra);
    showToast(fallbackMessage, "error");
  }

  async function loadOpenSession() {
    setLoading(true);
    const { data, error } = await supabase
      .from("cash_sessions")
      .select("*")
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(2);

    if (error) {
      await handleError("loadOpenSession", error, "No se pudo cargar caja");
      setLoading(false);
      return;
    }

    const sessions = data || [];
    if (sessions.length > 1) {
      showToast("Advertencia: se detectaron múltiples cajas abiertas", "warning");
    }

    setOpenSession(sessions[0] || null);
    setLoading(false);
  }

  async function loadHistory() {
    const { data, error } = await supabase
      .from("cash_sessions")
      .select("id, status, opened_at, closed_at, opening_amount, closing_amount, expected_amount, difference")
      .order("opened_at", { ascending: false })
      .limit(20);

    if (error) {
      await handleError("loadHistory", error, "No se pudo cargar historial");
      return;
    }

    setHistory(data || []);
  }

  async function loadMovements(sessionId) {
    if (!sessionId) {
      setMovements([]);
      return;
    }

    const { data, error } = await supabase
      .from("cash_movements")
      .select("*")
      .eq("cash_session_id", sessionId)
      .order("created_at", { ascending: false });

    if (error) {
      await handleError("loadMovements", error, "No se pudo cargar movimientos", { sessionId });
      return;
    }

    setMovements(data || []);
  }

  async function loadSummary(sessionId) {
    if (!sessionId) {
      setSummary(null);
      return;
    }

    const { data, error } = await supabase.rpc("rpc_cash_summary", { session_id: sessionId });
    if (error) {
      await handleError("loadSummary", error, "No se pudo cargar resumen", { sessionId });
      return;
    }

    setSummary(data || null);
  }

  useEffect(() => {
    loadOpenSession();
    loadHistory();
  }, []);

  useEffect(() => {
    if (!openSession?.id) {
      setMovements([]);
      setSummary(null);
      return;
    }
    loadMovements(openSession.id);
    loadSummary(openSession.id);
  }, [openSession?.id]);

  async function abrirCaja() {
    const parsed = parseMoneyInput(openingAmount, { allowZero: true });
    if (!parsed.ok) {
      showToast(parsed.message, "error");
      return;
    }

    setAction("opening");
    const { data, error } = await supabase.rpc("rpc_open_cash_session", {
      opening_amount: parsed.value,
      notes: openingNotes || null,
    });

    if (error) {
      await handleError("abrirCaja", error, error.message || "No se pudo abrir caja", { openingAmount });
      setAction(null);
      return;
    }

    await logOperationalMetric("cash_session_opened", { session_id: data || null });
    showToast("Caja abierta ✅", "success");
    setOpeningAmount("0");
    setOpeningNotes("");
    setLastCloseResult(null);
    await loadOpenSession();
    await loadHistory();
    if (data) {
      await loadMovements(data);
      await loadSummary(data);
    }
    setAction(null);
  }

  async function registrarMovimiento() {
    if (!openSession?.id) {
      showToast("No hay una caja abierta", "error");
      return;
    }

    const parsed = parseMoneyInput(movementAmount, { allowZero: false });
    if (!parsed.ok) {
      showToast(parsed.message, "error");
      return;
    }

    if (!movementReason.trim()) {
      showToast("Motivo requerido", "error");
      return;
    }

    setAction("movement");

    const { error } = await supabase.rpc("rpc_register_cash_movement", {
      p_session_id: openSession.id,
      p_type: movementType,
      p_amount: parsed.value,
      p_reason: movementReason.trim(),
    });

    if (error) {
      await handleError("registrarMovimiento", error, error.message || "No se pudo registrar movimiento", {
        sessionId: openSession.id,
        movementType,
      });
      setAction(null);
      return;
    }

    showToast("Movimiento registrado ✅", "success");
    setMovementReason("");
    setMovementAmount("");
    await loadMovements(openSession.id);
    await loadSummary(openSession.id);
    setAction(null);
  }

  async function cerrarCaja() {
    if (!openSession?.id) {
      showToast("No hay caja abierta", "error");
      return;
    }

    const parsed = parseMoneyInput(closingAmount, { allowZero: true });
    if (!parsed.ok) {
      showToast(parsed.message, "error");
      return;
    }

    setAction("closing");

    const { data: previewData, error: previewError } = await supabase.rpc("rpc_cash_summary", {
      session_id: openSession.id,
    });

    if (previewError) {
      await handleError("cerrarCaja.preview", previewError, "No se pudo validar resumen antes del cierre", { sessionId: openSession.id });
      setAction(null);
      return;
    }

    const expected = roundMoney(previewData?.expected_cash_amount ?? previewData?.expected_amount) ?? 0;
    const diff = roundMoney(parsed.value - expected) ?? 0;

    if (Math.abs(diff) > 0.009) {
      const proceed = window.confirm(
        `⚠️ La caja no cuadra.\nEsperado: ${money(expected)}\nContado: ${money(parsed.value)}\nDiferencia: ${money(diff)}\n\n¿Deseas cerrar caja de todas formas?`
      );
      if (!proceed) {
        setAction(null);
        return;
      }
    }

    const { data, error } = await supabase.rpc("rpc_close_cash_session", {
      session_id: openSession.id,
      p_closing_amount: parsed.value,
      p_notes: closingNotes || null,
    });

    if (error) {
      await handleError("cerrarCaja", error, error.message || "No se pudo cerrar caja", { sessionId: openSession.id });
      setAction(null);
      return;
    }

    setLastCloseResult(data || null);
    setClosingAmount("");
    setClosingNotes("");
    await logOperationalMetric("cash_session_closed", { session_id: openSession.id });
    showToast("Caja cerrada ✅", "success");
    await loadOpenSession();
    await loadHistory();
    setAction(null);
  }

  async function verResumenHistorial(sessionId) {
    if (!sessionId) return;
    setHistoryBusyId(sessionId);
    const { data, error } = await supabase.rpc("rpc_cash_summary", { session_id: sessionId });

    if (error) {
      await handleError("verResumenHistorial", error, error.message || "No se pudo cargar resumen", { sessionId });
      setHistoryBusyId(null);
      return;
    }

    setHistorySummary({ sessionId, ...(data || {}) });
    setHistoryBusyId(null);
  }

  const paymentEntries = useMemo(() => {
    const map = summary?.totals_by_payment_method || {};
    return Object.entries(map);
  }, [summary?.totals_by_payment_method]);

  const historyPaymentEntries = useMemo(() => {
    const map = historySummary?.totals_by_payment_method || {};
    return Object.entries(map);
  }, [historySummary?.totals_by_payment_method]);

  const previewDifference = useMemo(() => {
    const parsed = parseMoneyInput(closingAmount, { allowZero: true });
    const expected = roundMoney(summary?.expected_cash_amount ?? summary?.expected_amount);
    if (!parsed.ok || expected === null) return null;
    return roundMoney(parsed.value - expected);
  }, [closingAmount, summary?.expected_cash_amount, summary?.expected_amount]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Toast toast={toast} />
      <h2 style={{ margin: 0 }}>Caja</h2>

      {loading ? (
        <p>Cargando...</p>
      ) : !openSession ? (
        <>
          <section style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Caja cerrada</h3>
            <p>Abre una nueva sesión para empezar el control diario.</p>
            <div style={formGrid}>
              <input type="number" min="0" step="0.01" value={openingAmount} onChange={(e) => setOpeningAmount(e.target.value)} style={inputStyle} placeholder="Monto inicial" disabled={busy} />
              <textarea value={openingNotes} onChange={(e) => setOpeningNotes(e.target.value)} style={inputStyle} placeholder="Notas de apertura" disabled={busy} />
              <button type="button" onClick={abrirCaja} style={btnPrimary} disabled={busy}>{action === "opening" ? "Abriendo..." : "Abrir caja"}</button>
            </div>
          </section>

          {lastCloseResult && (
            <section style={cardStyle}>
              <h3 style={{ marginTop: 0 }}>Último cierre</h3>
              <p>Esperado: <strong>{money(lastCloseResult.expected_cash_amount || lastCloseResult.expected_amount)}</strong></p>
              <p>Declarado: <strong>{money(lastCloseResult.closing_amount)}</strong></p>
              <p style={{ color: Number(lastCloseResult.difference || 0) < 0 ? "#b3261e" : "#1f7a43" }}>
                Diferencia: {money(lastCloseResult.difference)}
              </p>
              <button type="button" style={btnSecondary} onClick={() => exportCloseReport(lastCloseResult, paymentEntries)}>
                Descargar cierre (CSV)
              </button>
            </section>
          )}
        </>
      ) : (
        <>
          <section style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Caja abierta</h3>
            <p><strong>Abierta:</strong> {formatDate(openSession.opened_at)}</p>
            <p><strong>Monto inicial:</strong> {money(openSession.opening_amount)}</p>
          </section>

          <section style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Registrar movimiento manual</h3>
            <div style={formGrid}>
              <select value={movementType} onChange={(e) => setMovementType(e.target.value)} style={inputStyle} disabled={busy}>
                <option value="in">Ingreso</option>
                <option value="out">Egreso</option>
              </select>
              <input type="text" value={movementReason} onChange={(e) => setMovementReason(e.target.value)} style={inputStyle} placeholder="Motivo" disabled={busy} />
              <input type="number" min="0" step="0.01" value={movementAmount} onChange={(e) => setMovementAmount(e.target.value)} style={inputStyle} placeholder="Monto" disabled={busy} />
              <button type="button" onClick={registrarMovimiento} style={btnPrimary} disabled={busy}>{action === "movement" ? "Registrando..." : "Registrar"}</button>
            </div>
          </section>

          <section style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Movimientos</h3>
            {movements.length === 0 ? <p>No hay movimientos.</p> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {movements.map((m) => (
                  <div key={m.id} style={movementRow}>
                    <div style={{ display: "grid", gap: 2 }}>
                      <span>{movementLabel(m)}</span>
                      <small style={{ color: "#6b7280" }}>{formatDate(m.created_at)}</small>
                    </div>
                    <strong style={{ color: m.type === "out" ? "#b3261e" : "#1f7a43" }}>
                      {m.type === "out" ? "-" : "+"}{money(m.amount)}
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Resumen en vivo</h3>
            {!summary ? <p>Sin datos</p> : (
              <div style={summaryBox}>
                <p>Ventas pagadas (total): <strong>{money(summary.total_sales)}</strong></p>
                <p>Ventas en efectivo: <strong>{money(summary.cash_sales)}</strong></p>
                <p>Ventas no-efectivo: <strong>{money(summary.non_cash_sales)}</strong></p>
                <p>Total pedidos pagados: <strong>{summary.total_paid_orders || 0}</strong></p>
                <p>Total delivery: <strong>{money(summary.total_delivery)}</strong></p>
                <p>Total recojo: <strong>{money(summary.total_pickup)}</strong></p>
                <p>Ingresos manuales: <strong>{money(summary.movements_in)}</strong></p>
                <p>Egresos manuales: <strong>{money(summary.movements_out)}</strong></p>
                <p>Esperado al cierre (efectivo): <strong>{money(summary.expected_cash_amount || summary.expected_amount)}</strong></p>
                <p>Métodos de pago:</p>
                {paymentEntries.length === 0 ? <p>-</p> : (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {paymentEntries.map(([key, val]) => (<li key={key}>{key}: {money(val)}</li>))}
                  </ul>
                )}
              </div>
            )}
          </section>

          <section style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Cerrar caja</h3>
            <div style={formGrid}>
              <input type="number" min="0" step="0.01" value={closingAmount} onChange={(e) => setClosingAmount(e.target.value)} style={inputStyle} placeholder="Monto final contado" disabled={busy} />
              {previewDifference !== null && Math.abs(previewDifference) > 0.009 && (
                <p style={{ margin: 0, color: "#b3261e" }}>
                  Advertencia: no cuadra. Diferencia actual: <strong>{money(previewDifference)}</strong>
                </p>
              )}
              <textarea value={closingNotes} onChange={(e) => setClosingNotes(e.target.value)} style={inputStyle} placeholder="Notas de cierre" disabled={busy} />
              <button type="button" onClick={cerrarCaja} style={btnDanger} disabled={busy}>{action === "closing" ? "Cerrando..." : "Cerrar caja"}</button>
            </div>
          </section>
        </>
      )}

      <section style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Historial de caja (últimas 20)</h3>
        {history.length === 0 ? <p>Sin sesiones registradas.</p> : (
          <div style={{ display: "grid", gap: 8 }}>
            {history.map((item) => (
              <div key={item.id} style={historyRow}>
                <div style={{ display: "grid", gap: 2 }}>
                  <strong>{item.status === "open" ? "Abierta" : "Cerrada"}</strong>
                  <small>Desde: {formatDate(item.opened_at)}</small>
                  <small>Hasta: {formatDate(item.closed_at)}</small>
                  <small>Inicial: {money(item.opening_amount)} · Cierre: {money(item.closing_amount)}</small>
                </div>
                <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
                  <strong style={{ color: Number(item.difference || 0) < 0 ? "#b3261e" : "#1f7a43" }}>Dif: {money(item.difference)}</strong>
                  <button type="button" style={btnSecondary} disabled={historyBusyId === item.id} onClick={() => verResumenHistorial(item.id)}>
                    {historyBusyId === item.id ? "Cargando..." : "Ver resumen"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {historySummary && (
          <div style={{ ...summaryBox, marginTop: 12, paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
            <p style={{ margin: 0 }}><strong>Resumen sesión:</strong> {historySummary.sessionId}</p>
            <p style={{ margin: 0 }}>Ventas total: <strong>{money(historySummary.total_sales)}</strong></p>
            <p style={{ margin: 0 }}>Ventas efectivo: <strong>{money(historySummary.cash_sales)}</strong></p>
            <p style={{ margin: 0 }}>Ventas no-efectivo: <strong>{money(historySummary.non_cash_sales)}</strong></p>
            <p style={{ margin: 0 }}>Esperado: <strong>{money(historySummary.expected_cash_amount || historySummary.expected_amount)}</strong></p>
            <p style={{ margin: 0 }}>Declarado: <strong>{money(historySummary.closing_amount)}</strong></p>
            <p style={{ margin: 0, color: Number(historySummary.difference || 0) < 0 ? "#b3261e" : "#1f7a43" }}>
              Diferencia: <strong>{money(historySummary.difference)}</strong>
            </p>
            <p style={{ margin: 0 }}>Por método:</p>
            {historyPaymentEntries.length === 0 ? <p style={{ margin: 0 }}>-</p> : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {historyPaymentEntries.map(([key, val]) => (<li key={key}>{key}: {money(val)}</li>))}
              </ul>
            )}
            <button type="button" style={btnSecondary} onClick={() => exportCloseReport(historySummary, historyPaymentEntries)}>
              Descargar resumen (CSV)
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

const cardStyle = {
  background: "#fff",
  borderRadius: 12,
  padding: 14,
  boxShadow: "0 8px 24px rgba(17,24,39,.04)",
};
const formGrid = {
  display: "grid",
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
  background: "#f3faf7",
  color: "#111827",
  border: "1px solid #dce7e2",
  borderRadius: 8,
  padding: "8px 10px",
  cursor: "pointer",
};
const btnDanger = {
  background: "#b3261e",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 12px",
  cursor: "pointer",
};
const movementRow = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "8px 10px",
};
const historyRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "10px 12px",
  flexWrap: "wrap",
};
const summaryBox = {
  display: "grid",
  gap: 4,
};
