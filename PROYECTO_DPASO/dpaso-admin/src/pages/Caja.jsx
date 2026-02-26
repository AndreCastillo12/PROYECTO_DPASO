import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import { logCriticalEvent, logOperationalMetric } from "../lib/observability";

const MAX_MANUAL_MOVEMENT = 5000;
const MONEY_2DP_REGEX = /^\d+(?:\.\d{1,2})?$/;

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

function hasValidDecimals(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  return MONEY_2DP_REGEX.test(raw);
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

function movementMethod(movement) {
  if (movement.movement_source === "order_sale") return "cash";
  return "manual";
}

function movementLabel(movement) {
  const base = movement.type === "in" ? "Ingreso" : "Egreso";
  const source = movement.movement_source === "order_sale" ? "Pedido" : "Manual";
  return `${base} · ${source}`;
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

function SummaryCard({ title, value, hint, tone = "default" }) {
  return (
    <article style={{ ...summaryCardStyle, borderColor: tone === "ok" ? "#b7e6cb" : tone === "warn" ? "#f2d39b" : "#e5e7eb" }}>
      <small style={{ color: "#6b7280" }}>{title}</small>
      <strong style={{ fontSize: 24, color: "#111827" }}>{value}</strong>
      {hint ? <small style={{ color: "#6b7280" }}>{hint}</small> : null}
    </article>
  );
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
  const [inconsistency, setInconsistency] = useState({ missing_order_sale_count: 0, order_ids: [] });

  const [openingAmount, setOpeningAmount] = useState("0");
  const [openingNotes, setOpeningNotes] = useState("");
  const [movementType, setMovementType] = useState("in");
  const [movementReason, setMovementReason] = useState("");
  const [movementAmount, setMovementAmount] = useState("");
  const [closingAmount, setClosingAmount] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [lastCloseResult, setLastCloseResult] = useState(null);

  const [movementFilterType, setMovementFilterType] = useState("all");
  const [movementFilterSource, setMovementFilterSource] = useState("all");
  const [movementFilterMethod, setMovementFilterMethod] = useState("all");
  const [movementFilterFrom, setMovementFilterFrom] = useState("");
  const [movementFilterTo, setMovementFilterTo] = useState("");

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
    if (sessions.length > 1) showToast("Advertencia: se detectaron múltiples cajas abiertas", "warning");
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

  async function loadInconsistency(sessionId) {
    if (!sessionId) {
      setInconsistency({ missing_order_sale_count: 0, order_ids: [] });
      return;
    }
    const { data, error } = await supabase.rpc("rpc_cash_detect_inconsistencies", { session_id: sessionId });
    if (error) {
      await handleError("loadInconsistency", error, "No se pudo validar inconsistencias de caja", { sessionId });
      return;
    }
    setInconsistency(data || { missing_order_sale_count: 0, order_ids: [] });
  }

  useEffect(() => {
    loadOpenSession();
    loadHistory();
  }, []);

  useEffect(() => {
    if (!openSession?.id) {
      setMovements([]);
      setSummary(null);
      setInconsistency({ missing_order_sale_count: 0, order_ids: [] });
      return;
    }
    loadMovements(openSession.id);
    loadSummary(openSession.id);
    loadInconsistency(openSession.id);
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
      await loadInconsistency(data);
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

    if (!hasValidDecimals(movementAmount)) {
      showToast("El monto permite máximo 2 decimales", "error");
      return;
    }

    if (parsed.value > MAX_MANUAL_MOVEMENT) {
      showToast(`Monto excede el máximo permitido (${money(MAX_MANUAL_MOVEMENT)})`, "error");
      return;
    }

    if (movementReason.trim().length < 5) {
      showToast("Motivo requerido (mínimo 5 caracteres)", "error");
      return;
    }

    if (movementType === "out") {
      const expectedCash = roundMoney(summary?.expected_cash_amount ?? summary?.expected_amount) ?? 0;
      if (parsed.value > expectedCash) {
        const proceed = window.confirm(
          `⚠️ El egreso (${money(parsed.value)}) puede dejar efectivo esperado negativo.\nEsperado actual: ${money(expectedCash)}\n\n¿Deseas continuar?`
        );
        if (!proceed) return;
      }
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
    await loadInconsistency(openSession.id);
    setAction(null);
  }

  async function reconciliarCaja() {
    if (!openSession?.id) return;
    setAction("reconcile");
    const { data, error } = await supabase.rpc("rpc_cash_reconcile_missing_order_sales", { session_id: openSession.id });
    if (error) {
      await handleError("reconciliarCaja", error, error.message || "No se pudo reconciliar caja", { sessionId: openSession.id });
      setAction(null);
      return;
    }

    showToast(`Reconciliación OK (${data?.inserted || 0} movimientos creados).`, "success");
    await loadMovements(openSession.id);
    await loadSummary(openSession.id);
    await loadInconsistency(openSession.id);
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

    if ((inconsistency?.missing_order_sale_count || 0) > 0) {
      showToast("Hay pagos en efectivo sin movimiento de caja. Reconciliar antes de cerrar.", "error");
      return;
    }

    setAction("closing");

    const { data: previewData, error: previewError } = await supabase.rpc("rpc_cash_summary", { session_id: openSession.id });
    if (previewError) {
      await handleError("cerrarCaja.preview", previewError, "No se pudo validar resumen antes del cierre", { sessionId: openSession.id });
      setAction(null);
      return;
    }

    const expected = roundMoney(previewData?.expected_cash_amount ?? previewData?.expected_amount) ?? 0;
    const diff = roundMoney(parsed.value - expected) ?? 0;

    if (Math.abs(diff) > 0.009) {
      const proceed = window.confirm(
        `⚠️ Diferencia detectada\nEsperado: ${money(expected)}\nContado: ${money(parsed.value)}\nDiferencia: ${money(diff)}\n\n¿Cerrar caja de todas formas?`
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

  const expectedCash = roundMoney(summary?.expected_cash_amount ?? summary?.expected_amount);
  const countedInput = parseMoneyInput(closingAmount, { allowZero: true });

  const differencePreview = useMemo(() => {
    if (!countedInput.ok || expectedCash === null) return null;
    return roundMoney(countedInput.value - expectedCash);
  }, [countedInput.ok, countedInput.value, expectedCash]);

  const differenceTone = useMemo(() => {
    if (differencePreview === null) return "neutral";
    if (Math.abs(differencePreview) < 0.009) return "ok";
    return Math.abs(differencePreview) >= 20 ? "danger" : "warn";
  }, [differencePreview]);

  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      if (movementFilterType !== "all" && m.type !== movementFilterType) return false;
      if (movementFilterSource !== "all" && (m.movement_source || "manual") !== movementFilterSource) return false;
      const method = movementMethod(m);
      if (movementFilterMethod !== "all" && method !== movementFilterMethod) return false;

      const ts = new Date(m.created_at).getTime();
      if (movementFilterFrom) {
        const fromTs = new Date(movementFilterFrom).getTime();
        if (!Number.isNaN(fromTs) && ts < fromTs) return false;
      }
      if (movementFilterTo) {
        const toTs = new Date(movementFilterTo).getTime();
        if (!Number.isNaN(toTs) && ts > toTs) return false;
      }
      return true;
    });
  }, [movements, movementFilterMethod, movementFilterSource, movementFilterTo, movementFilterFrom, movementFilterType]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Toast toast={toast} />
      <h2 style={{ margin: 0 }}>Caja</h2>

      {loading ? <p>Cargando...</p> : (
        <>
          <section style={cardStyle}>
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>A) Estado de caja</h3>
            {!openSession ? (
              <div style={{ display: "grid", gap: 10 }}>
                <span style={chipClosed}>CERRADA</span>
                <p style={{ margin: 0, color: "#6b7280" }}>Abre una nueva sesión para empezar el turno.</p>
                <div style={formGridCompact}>
                  <input type="number" min="0" step="0.01" value={openingAmount} onChange={(e) => setOpeningAmount(e.target.value)} style={inputStyle} placeholder="Monto inicial" disabled={busy} />
                  <textarea value={openingNotes} onChange={(e) => setOpeningNotes(e.target.value)} style={inputStyle} placeholder="Notas de apertura" disabled={busy} />
                  <button type="button" onClick={abrirCaja} style={btnPrimary} disabled={busy}>{action === "opening" ? "Abriendo..." : "Abrir caja"}</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <span style={chipOpen}>ABIERTA</span>
                <p style={{ margin: 0 }}><strong>Hora apertura:</strong> {formatDate(openSession.opened_at)}</p>
                <p style={{ margin: 0 }}><strong>Usuario apertura:</strong> {openSession.opened_by || "-"}</p>
                <p style={{ margin: 0 }}><strong>Monto inicial:</strong> {money(openSession.opening_amount)}</p>
              </div>
            )}
          </section>

          {openSession ? (
            <>
              <section style={cardStyle}>
                <h3 style={{ marginTop: 0, marginBottom: 8 }}>B) Resumen del turno</h3>
                {!summary ? <p>Sin datos</p> : (
                  <div style={summaryGrid}>
                    <SummaryCard title="Efectivo esperado" value={money(expectedCash)} hint="Solo cash" />
                    <SummaryCard title="Efectivo contado" value={countedInput.ok ? money(countedInput.value) : "-"} hint="Input de cierre" />
                    <SummaryCard title="Diferencia" value={differencePreview === null ? "-" : money(differencePreview)} hint={differenceTone === "neutral" ? "Ingresa el efectivo contado para calcular diferencia" : differenceTone === "ok" ? "Cuadre correcto" : "Revisar faltante/sobrante"} tone={differenceTone === "ok" ? "ok" : differenceTone === "neutral" ? "default" : "warn"} />
                    <SummaryCard title="Ventas totales (pagadas)" value={money(summary.total_sales)} />
                    <SummaryCard title="Ventas en efectivo" value={money(summary.cash_sales)} />
                    <SummaryCard title="Ventas no-efectivo" value={money(summary.non_cash_sales)} hint="Tarjeta/Yape/Plin/etc" />
                    <SummaryCard title="Ingresos manuales" value={money(summary.movements_in)} />
                    <SummaryCard title="Egresos manuales" value={money(summary.movements_out)} />
                  </div>
                )}
              </section>

              <section style={cardStyle}>
                <h3 style={{ marginTop: 0, marginBottom: 8 }}>C) Movimientos</h3>

                <div style={filterGrid}>
                  <select value={movementFilterType} onChange={(e) => setMovementFilterType(e.target.value)} style={inputStyle}>
                    <option value="all">Tipo: Todos</option>
                    <option value="in">Ingreso</option>
                    <option value="out">Egreso</option>
                  </select>
                  <select value={movementFilterSource} onChange={(e) => setMovementFilterSource(e.target.value)} style={inputStyle}>
                    <option value="all">Origen: Todos</option>
                    <option value="manual">Manual</option>
                    <option value="order_sale">Pedido</option>
                  </select>
                  <select value={movementFilterMethod} onChange={(e) => setMovementFilterMethod(e.target.value)} style={inputStyle}>
                    <option value="all">Método: Todos</option>
                    <option value="cash">Cash</option>
                    <option value="manual">N/A manual</option>
                  </select>
                  <input type="datetime-local" value={movementFilterFrom} onChange={(e) => setMovementFilterFrom(e.target.value)} style={inputStyle} />
                  <input type="datetime-local" value={movementFilterTo} onChange={(e) => setMovementFilterTo(e.target.value)} style={inputStyle} />
                </div>

                <div style={{ marginTop: 10, marginBottom: 12 }}>
                  <h4 style={{ margin: "0 0 8px" }}>Registrar movimiento manual</h4>
                  <div style={formGridCompact}>
                    <select value={movementType} onChange={(e) => setMovementType(e.target.value)} style={inputStyle} disabled={busy}>
                      <option value="in">Ingreso</option>
                      <option value="out">Egreso</option>
                    </select>
                    <input type="text" value={movementReason} onChange={(e) => setMovementReason(e.target.value)} style={inputStyle} placeholder="Motivo (mínimo 5 caracteres)" disabled={busy} />
                    <input type="number" min="0" step="0.01" max={MAX_MANUAL_MOVEMENT} value={movementAmount} onChange={(e) => setMovementAmount(e.target.value)} style={inputStyle} placeholder={`Monto (max ${money(MAX_MANUAL_MOVEMENT)})`} disabled={busy} />
                    <button type="button" onClick={registrarMovimiento} style={btnPrimary} disabled={busy}>{action === "movement" ? "Registrando..." : "Registrar"}</button>
                  </div>
                </div>

                {filteredMovements.length === 0 ? <p>No hay movimientos con los filtros actuales.</p> : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Fecha</th>
                          <th style={thStyle}>Tipo</th>
                          <th style={thStyle}>Origen</th>
                          <th style={thStyle}>Método</th>
                          <th style={thStyle}>Motivo</th>
                          <th style={{ ...thStyle, textAlign: "right" }}>Monto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMovements.map((m) => (
                          <tr key={m.id}>
                            <td style={tdStyle}>{formatDate(m.created_at)}</td>
                            <td style={tdStyle}>{m.type === "in" ? "Ingreso" : "Egreso"}</td>
                            <td style={tdStyle}>{m.movement_source === "order_sale" ? "Pedido" : "Manual"}</td>
                            <td style={tdStyle}>{movementMethod(m)}</td>
                            <td style={tdStyle}>{m.reason || "-"}</td>
                            <td style={{ ...tdStyle, textAlign: "right", color: m.type === "out" ? "#b3261e" : "#1f7a43", fontWeight: 700 }}>
                              {m.type === "out" ? "-" : "+"}{money(m.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section style={cardStyle}>
                <h3 style={{ marginTop: 0, marginBottom: 8 }}>D) Cierre de caja</h3>
                <div style={formGridCompact}>
                  <input type="number" min="0" step="0.01" value={closingAmount} onChange={(e) => setClosingAmount(e.target.value)} style={inputStyle} placeholder="Monto final contado" disabled={busy} />
                  <textarea value={closingNotes} onChange={(e) => setClosingNotes(e.target.value)} style={inputStyle} placeholder="Notas de cierre" disabled={busy} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" onClick={cerrarCaja} style={btnDanger} disabled={busy || !countedInput.ok}>{action === "closing" ? "Cerrando..." : "Cerrar caja"}</button>
                    <button type="button" onClick={reconciliarCaja} style={btnSecondary} disabled={busy || (inconsistency?.missing_order_sale_count || 0) === 0}>{action === "reconcile" ? "Reconciliando..." : "Reconciliar"}</button>
                  </div>
                </div>

                <p style={{ margin: "8px 0 0", color: differenceTone === "neutral" ? "#6b7280" : differenceTone === "ok" ? "#1f7a43" : differenceTone === "warn" ? "#a16207" : "#b3261e" }}>
                  {differenceTone === "neutral"
                    ? "Ingresa el efectivo contado para calcular diferencia"
                    : differenceTone === "ok"
                      ? "Cuadre OK (diferencia 0.00)"
                      : `Diferencia detectada: ${money(differencePreview)} (${differencePreview > 0 ? "sobrante" : "faltante"})`}
                </p>

                {(inconsistency?.missing_order_sale_count || 0) > 0 ? (
                  <p style={{ margin: "8px 0 0", color: "#b3261e" }}>
                    Inconsistencia detectada: {inconsistency.missing_order_sale_count} pago(s) en efectivo sin movimiento de caja. Reconciliar antes de cerrar.
                  </p>
                ) : null}
              </section>
            </>
          ) : null}

          {lastCloseResult ? (
            <section style={cardStyle}>
              <h3 style={{ marginTop: 0 }}>Último cierre</h3>
              <p>Esperado: <strong>{money(lastCloseResult.expected_cash_amount || lastCloseResult.expected_amount)}</strong></p>
              <p>Declarado: <strong>{money(lastCloseResult.closing_amount)}</strong></p>
              <p style={{ color: Number(lastCloseResult.difference || 0) < 0 ? "#b3261e" : "#1f7a43" }}>
                Diferencia: {money(lastCloseResult.difference)}
              </p>
              <button type="button" style={btnSecondary} onClick={() => exportCloseReport(lastCloseResult, paymentEntries)}>Descargar cierre (CSV)</button>
            </section>
          ) : null}

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

            {historySummary ? (
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
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}

const cardStyle = {
  background: "#fff",
  borderRadius: 12,
  padding: 14,
  boxShadow: "0 8px 24px rgba(17,24,39,.04)",
};

const summaryGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 10,
};

const summaryCardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 10,
  display: "grid",
  gap: 4,
};

const formGridCompact = {
  display: "grid",
  gap: 10,
};

const filterGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: 8,
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

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 760,
};

const thStyle = {
  textAlign: "left",
  fontSize: 12,
  color: "#6b7280",
  fontWeight: 700,
  borderBottom: "1px solid #e5e7eb",
  padding: "8px 10px",
};

const tdStyle = {
  fontSize: 14,
  color: "#111827",
  borderBottom: "1px solid #f3f4f6",
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

const chipOpen = {
  display: "inline-block",
  width: "fit-content",
  background: "#e8faee",
  color: "#1f7a43",
  borderRadius: 999,
  padding: "3px 9px",
  fontWeight: 700,
  fontSize: 12,
};

const chipClosed = {
  display: "inline-block",
  width: "fit-content",
  background: "#f3f4f6",
  color: "#374151",
  borderRadius: 999,
  padding: "3px 9px",
  fontWeight: 700,
  fontSize: 12,
};
