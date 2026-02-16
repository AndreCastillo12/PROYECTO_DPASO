import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
function money(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
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
    ["Esperado", Number(sessionResult.expected_amount || 0).toFixed(2)],
    ["Declarado", Number(sessionResult.closing_amount || 0).toFixed(2)],
    ["Diferencia", Number(sessionResult.difference || 0).toFixed(2)],
    ["Cerrado en", sessionResult.closed_at || ""],
    [],
    ["Metodo de pago", "Monto"],
    ...paymentEntries.map(([key, value]) => [key, Number(value || 0).toFixed(2)]),
  ];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadCsv(`cierre-caja-${stamp}.csv`, rows);
}
function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
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
  const [busy, setBusy] = useState(false);
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
  async function loadOpenSession() {
    setLoading(true);
    const { data, error } = await supabase
      .from("cash_sessions")
      .select("*")
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      showToast("No se pudo cargar caja", "error");
      setLoading(false);
      return;
    }
    setOpenSession(data || null);
    setLoading(false);
  }
  async function loadHistory() {
    const { data, error } = await supabase
      .from("cash_sessions")
      .select("id, status, opened_at, closed_at, opening_amount, closing_amount, expected_amount, difference")
      .order("opened_at", { ascending: false })
      .limit(20);
    if (error) {
      showToast("No se pudo cargar historial", "error");
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
      showToast("No se pudo cargar movimientos", "error");
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
      showToast("No se pudo cargar resumen", "error");
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
    const amount = Number(openingAmount || 0);
    if (!Number.isFinite(amount) || amount < 0) {
      showToast("Monto inicial inválido", "error");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("rpc_open_cash_session", {
      opening_amount: amount,
      notes: openingNotes || null,
    });
    if (error) {
      showToast(error.message || "No se pudo abrir caja", "error");
      setBusy(false);
      return;
    }
    showToast("Caja abierta ✅");
    setOpeningAmount("0");
    setOpeningNotes("");
    setLastCloseResult(null);
    await loadOpenSession();
    await loadHistory();
    if (data) {
      await loadMovements(data);
      await loadSummary(data);
    }
    setBusy(false);
  }
  async function registrarMovimiento() {
    if (!openSession?.id) return;
    const amount = Number(movementAmount || 0);
    if (!movementReason.trim()) {
      showToast("Motivo requerido", "error");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Monto inválido", "error");
      return;
    }
    setBusy(true);
    const { data: authData } = await supabase.auth.getUser();
    const { error } = await supabase.from("cash_movements").insert([
      {
        cash_session_id: openSession.id,
        type: movementType,
        reason: movementReason.trim(),
        amount,
        movement_source: "manual",
        created_by: authData?.user?.id || null,
      },
    ]);
    if (error) {
      showToast(error.message || "No se pudo registrar", "error");
      setBusy(false);
      return;
    }
    showToast("Movimiento registrado ✅");
    setMovementReason("");
    setMovementAmount("");
    await loadMovements(openSession.id);
    await loadSummary(openSession.id);
    setBusy(false);
  }
  async function cerrarCaja() {
    if (!openSession?.id) return;
    const hasManualAmount = String(closingAmount).trim() !== "";
    const amount = hasManualAmount
      ? Number(closingAmount || 0)
      : Number(summary?.expected_amount || 0);
    if (!Number.isFinite(amount) || amount < 0) {
      showToast("Monto cierre inválido", "error");
      return;
    }
    setBusy(true);
    let previewExpected = Number(summary?.expected_amount || 0);
    const { data: previewData, error: previewError } = await supabase.rpc("rpc_cash_summary", {
      session_id: openSession.id,
    });
    if (!previewError && previewData) {
      previewExpected = Number(previewData.expected_amount || 0);
      setSummary(previewData);
    }
    const previewDiff = amount - previewExpected;
    if (hasManualAmount && Math.abs(previewDiff) > 0.009) {
      const proceed = window.confirm(
        `⚠️ La caja no cuadra.\nEsperado: ${money(previewExpected)}\nContado: ${money(amount)}\nDiferencia: ${money(previewDiff)}\n\n¿Deseas cerrar caja de todas formas?`
      );
      if (!proceed) {
        setBusy(false);
        return;
      }
    }
    const { data, error } = await supabase.rpc("rpc_close_cash_session", {
      session_id: openSession.id,
      p_closing_amount: amount,
      p_notes: closingNotes || null,
    });
    if (error) {
      showToast(error.message || "No se pudo cerrar caja", "error");
      setBusy(false);
      return;
    }
    setLastCloseResult(data || null);
    setClosingAmount("");
    setClosingNotes("");
    showToast("Caja cerrada ✅");
    await loadOpenSession();
    await loadHistory();
    setBusy(false);
  }
  async function verResumenHistorial(sessionId) {
    if (!sessionId) return;
    setHistoryBusyId(sessionId);
    const { data, error } = await supabase.rpc("rpc_cash_summary", { session_id: sessionId });
    if (error) {
      showToast(error.message || "No se pudo cargar resumen de caja", "error");
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
              <input
                type="number"
                min="0"
                step="0.01"
                value={openingAmount}
                onChange={(e) => setOpeningAmount(e.target.value)}
                style={inputStyle}
                placeholder="Monto inicial"
                disabled={busy}
              />
              <textarea
                value={openingNotes}
                onChange={(e) => setOpeningNotes(e.target.value)}
                style={inputStyle}
                placeholder="Notas de apertura"
                disabled={busy}
              />
              <button type="button" onClick={abrirCaja} style={btnPrimary} disabled={busy}>
                Abrir caja
              </button>
            </div>
          </section>
          {lastCloseResult && (
            <section style={cardStyle}>
              <h3 style={{ marginTop: 0 }}>Último cierre</h3>
              <p>Esperado: <strong>{money(lastCloseResult.expected_amount)}</strong></p>
              <p>Declarado: <strong>{money(lastCloseResult.closing_amount)}</strong></p>
              <p style={{ color: Number(lastCloseResult.difference || 0) < 0 ? "#b3261e" : "#1f7a43" }}>
                Diferencia: {money(lastCloseResult.difference)}
              </p>
              <button
                type="button"
                style={btnSecondary}
                onClick={() => exportCloseReport(lastCloseResult, paymentEntries)}
              >
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
            <h3 style={{ marginTop: 0 }}>Registrar movimiento</h3>
            <div style={formGrid}>
              <select value={movementType} onChange={(e) => setMovementType(e.target.value)} style={inputStyle} disabled={busy}>
                <option value="in">Ingreso</option>
                <option value="out">Egreso</option>
              </select>
              <input
                type="text"
                value={movementReason}
                onChange={(e) => setMovementReason(e.target.value)}
                style={inputStyle}
                placeholder="Motivo"
                disabled={busy}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={movementAmount}
                onChange={(e) => setMovementAmount(e.target.value)}
                style={inputStyle}
                placeholder="Monto"
                disabled={busy}
              />
              <button type="button" onClick={registrarMovimiento} style={btnPrimary} disabled={busy}>
                Registrar
              </button>
            </div>
          </section>
          <section style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Movimientos</h3>
            {movements.length === 0 ? (
              <p>No hay movimientos.</p>
            ) : (
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
            {!summary ? (
              <p>Sin datos</p>
            ) : (
              <div style={summaryBox}>
                <p>Total ventas: <strong>{money(summary.total_sales)}</strong></p>
                <p>Total pedidos: <strong>{summary.total_orders || 0}</strong></p>
                <p>Total delivery: <strong>{money(summary.total_delivery)}</strong></p>
                <p>Total recojo: <strong>{money(summary.total_pickup)}</strong></p>
                <p>Ingresos manuales: <strong>{money(summary.movements_in)}</strong></p>
                <p>Egresos manuales: <strong>{money(summary.movements_out)}</strong></p>
                <p>Esperado al cierre: <strong>{money(summary.expected_amount)}</strong></p>
                <p>Métodos de pago:</p>
                {paymentEntries.length === 0 ? (
                  <p>-</p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {paymentEntries.map(([key, val]) => (
                      <li key={key}>{key}: {money(val)}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
          <section style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Cerrar caja</h3>
            <div style={formGrid}>
              <input
                type="number"
                min="0"
                step="0.01"
                value={closingAmount}
                onChange={(e) => setClosingAmount(e.target.value)}
                style={inputStyle}
                placeholder="Monto final contado"
                disabled={busy}
              />
              <textarea
                value={closingNotes}
                onChange={(e) => setClosingNotes(e.target.value)}
                style={inputStyle}
                placeholder="Notas de cierre"
                disabled={busy}
              />
              <button type="button" onClick={cerrarCaja} style={btnDanger} disabled={busy}>
                Cerrar caja
              </button>
            </div>
          </section>
        </>
      )}
      <section style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Historial de caja (últimas 20)</h3>
        {history.length === 0 ? (
          <p>Sin sesiones registradas.</p>
        ) : (
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
                  <strong style={{ color: Number(item.difference || 0) < 0 ? "#b3261e" : "#1f7a43" }}>
                    Dif: {money(item.difference)}
                  </strong>
                  <button
                    type="button"
                    style={btnSecondary}
                    disabled={historyBusyId === item.id}
                    onClick={() => verResumenHistorial(item.id)}
                  >
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
            <p style={{ margin: 0 }}>Ventas: <strong>{money(historySummary.total_sales)}</strong></p>
            <p style={{ margin: 0 }}>Pedidos: <strong>{historySummary.total_orders || 0}</strong></p>
            <p style={{ margin: 0 }}>Esperado: <strong>{money(historySummary.expected_amount)}</strong></p>
            <p style={{ margin: 0 }}>Declarado: <strong>{money(historySummary.closing_amount)}</strong></p>
            <p style={{ margin: 0, color: Number(historySummary.difference || 0) < 0 ? "#b3261e" : "#1f7a43" }}>
              Diferencia: <strong>{money(historySummary.difference)}</strong>
            </p>
            <p style={{ margin: 0 }}>Por método:</p>
            {historyPaymentEntries.length === 0 ? (
              <p style={{ margin: 0 }}>-</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {historyPaymentEntries.map(([key, val]) => (
                  <li key={key}>{key}: {money(val)}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              style={btnSecondary}
              onClick={() => exportCloseReport(historySummary, historyPaymentEntries)}
            >
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
  boxShadow: "0 4px 14px rgba(0,0,0,.06)",
};
const formGrid = {
  display: "grid",
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
  background: "#f3f4f6",
  color: "#111827",
  border: "1px solid #d1d5db",
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
