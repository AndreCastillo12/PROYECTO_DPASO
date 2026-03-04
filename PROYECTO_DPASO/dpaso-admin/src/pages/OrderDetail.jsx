import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FiMapPin, FiPhone, FiTruck } from "react-icons/fi";
import { supabase } from "../lib/supabaseClient";
import "../styles/order-detail.css";

const ORDER_STATUS = ["pending", "accepted", "preparing", "ready", "dispatched", "delivered", "cancelled"];
const PAYMENT_METHODS = ["cash", "yape", "plin", "card", "transfer", "other"];
const DOCUMENT_TYPES = ["boleta", "factura"];
const CUSTOMER_DOC_TYPES = ["DNI", "RUC", "CE", "PASSPORT"];

const NORMALIZED_STATUS = {
  completed: "delivered",
};

function normalizeStatus(status) {
  const key = String(status || "").toLowerCase();
  return NORMALIZED_STATUS[key] || key || "pending";
}

function isPickupOrder(order) {
  const text = String(order?.modalidad || "").toLowerCase();
  return ["recojo", "recoger", "pickup", "pick-up", "tienda", "local"].some((token) => text.includes(token));
}

function getStatusFlow(order) {
  return isPickupOrder(order)
    ? ["pending", "accepted", "preparing", "ready", "delivered"]
    : ["pending", "accepted", "preparing", "dispatched", "delivered"];
}

function getAllowedStatusChanges(order) {
  const current = normalizeStatus(order?.estado);
  if (["delivered", "cancelled"].includes(current)) return [];

  const flow = getStatusFlow(order);
  const currentIndex = flow.indexOf(current);
  const next = currentIndex >= 0 && currentIndex < flow.length - 1 ? [flow[currentIndex + 1]] : [];
  if (current !== "cancelled") next.push("cancelled");
  return next;
}

function humanStatus(status) {
  const map = {
    pending: "Pendiente",
    accepted: "Aceptado",
    preparing: "Preparando",
    ready: "Listo",
    dispatched: "En reparto",
    delivered: "Entregado",
    cancelled: "Cancelado",
  };
  return map[normalizeStatus(status)] || "Sin estado";
}

function humanPayment(method) {
  const map = { cash: "Efectivo", yape: "Yape", plin: "Plin", card: "Tarjeta", transfer: "Transferencia", other: "Otro" };
  return map[String(method || "").toLowerCase()] || "Sin definir";
}

function currency(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function normalizePhoneForWa(phoneValue) {
  const digits = String(phoneValue || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("51") ? digits : `51${digits}`;
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function needsPaymentReference(method) {
  return ["yape", "plin", "card", "transfer"].includes(String(method || "").toLowerCase());
}

function normalizePaymentMethod(method) {
  const value = String(method || "").trim().toLowerCase();
  return PAYMENT_METHODS.includes(value) ? value : "";
}

function getDeliveryAddressLabel(order) {
  if (isPickupOrder(order)) return "Recojo en tienda";
  return order?.delivery_address || order?.direccion || order?.referencia || "Sin dirección";
}

function invoiceDocTypeLabel(documentType) {
  return String(documentType || "").toLowerCase() === "factura" ? "FACTURA" : "BOLETA";
}

function getIssueErrorMessage(status, errorCodeOrDetail) {
  const text = String(errorCodeOrDetail || "");
  const upper = text.toUpperCase();

  if (status === 401 || upper.includes("UNAUTHORIZED")) return "Sesión no válida, vuelve a iniciar sesión.";
  if (status === 403 || upper.includes("FORBIDDEN")) return "No tienes permisos para emitir comprobantes.";
  if (status === 400 || upper.includes("ORDER_ID_REQUIRED")) return "Faltan datos obligatorios para emitir el comprobante.";
  if (upper.includes("FACTURA_REQUIRES_VALID_RUC")) return "Para factura debes ingresar RUC válido (11 dígitos).";
  if (upper.includes("ORDER_ITEMS_EMPTY")) return "El pedido no tiene ítems, no se puede emitir comprobante.";
  if (upper.includes("CORRELATIVE_ASSIGN_FAILED")) return "No se pudo asignar serie/correlativo. Revisa la tabla de series SUNAT.";
  if (status >= 500) return "Error interno al emitir. Intenta nuevamente o reintenta en unos minutos.";

  return text || "No se pudo emitir el comprobante.";
}

function getInvoiceStatusTone(status) {
  const key = String(status || "").toLowerCase();
  if (["issued", "accepted", "already_issued"].includes(key)) return "success";
  if (["error", "rejected"].includes(key)) return "error";
  return "info";
}

function buildFullNumber(series, correlativo) {
  if (!series || !Number.isFinite(Number(correlativo))) return "-";
  return `${series}-${String(Number(correlativo)).padStart(8, "0")}`;
}

function mapOrderToInvoiceForm(order) {
  const documentType = DOCUMENT_TYPES.includes(String(order?.document_type || "").toLowerCase())
    ? String(order.document_type).toLowerCase()
    : "boleta";

  const customerDocType = CUSTOMER_DOC_TYPES.includes(String(order?.customer_doc_type || "").toUpperCase())
    ? String(order.customer_doc_type).toUpperCase()
    : documentType === "factura"
      ? "RUC"
      : "DNI";

  return {
    document_type: documentType,
    customer_doc_type: customerDocType,
    customer_doc_number: String(order?.customer_doc_number || "").trim(),
    customer_name: String(order?.customer_name || order?.nombre_cliente || "").trim(),
  };
}

export default function OrderDetail() {
  const [searchParams] = useSearchParams();
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [paymentError, setPaymentError] = useState("");

  const [invoiceForm, setInvoiceForm] = useState({
    document_type: "boleta",
    customer_doc_type: "DNI",
    customer_doc_number: "",
    customer_name: "",
  });
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [invoiceFeedback, setInvoiceFeedback] = useState({ type: "", text: "" });
  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  const [adminRole, setAdminRole] = useState("");
  const [adminRoleLoading, setAdminRoleLoading] = useState(true);

  const fetchOrderAndItems = useCallback(async () => {
    setLoading(true);
    const orderId = searchParams.get("order_id");

    const { data: orderRows } = orderId
      ? await supabase.from("orders").select("*").eq("id", orderId).limit(1)
      : await supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(1);

    const current = orderRows?.[0] || null;

    setSelectedOrder(current ? {
      ...current,
      payment_method: normalizePaymentMethod(current.payment_method),
    } : null);

    if (!current?.id) {
      setOrderItems([]);
      setLoading(false);
      return;
    }

    const { data: itemsRows } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", current.id)
      .order("created_at", { ascending: true });

    setOrderItems(itemsRows || []);
    setLoading(false);
  }, [searchParams]);

  useEffect(() => {
    fetchOrderAndItems();
  }, [fetchOrderAndItems]);

  useEffect(() => {
    if (!selectedOrder) return;
    setInvoiceForm(mapOrderToInvoiceForm(selectedOrder));
  }, [selectedOrder]);

  useEffect(() => {
    let alive = true;

    async function loadAdminRole() {
      setAdminRoleLoading(true);
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (!alive) return;

      if (authError || !authData?.user?.id) {
        setAdminRole("");
        setAdminRoleLoading(false);
        return;
      }

      const { data: roleRow, error: roleError } = await supabase
        .from("admin_panel_user_roles")
        .select("role")
        .eq("user_id", authData.user.id)
        .maybeSingle();

      if (!alive) return;
      if (roleError) {
        const { data: rpcRole } = await supabase.rpc("get_admin_panel_role");
        if (!alive) return;
        setAdminRole(String(rpcRole || "").toLowerCase());
      } else {
        setAdminRole(String(roleRow?.role || "").toLowerCase());
      }
      setAdminRoleLoading(false);
    }

    loadAdminRole();
    return () => {
      alive = false;
    };
  }, []);

  const subtotal = useMemo(() => orderItems.reduce((acc, item) => acc + Number(item.subtotal || 0), 0), [orderItems]);

  const historyRows = useMemo(() => {
    if (!selectedOrder) return [];
    const rows = [
      { key: "creado", label: "Pedido creado", at: selectedOrder.created_at, tone: "done" },
      { key: "pagado", label: selectedOrder.paid ? "Pago registrado" : "Pago pendiente", at: selectedOrder.paid_at || selectedOrder.created_at, tone: selectedOrder.paid ? "done" : "muted" },
      { key: "estado", label: `Estado actual: ${humanStatus(selectedOrder.estado)}`, at: selectedOrder.updated_at || selectedOrder.created_at, tone: "current" },
    ];

    if (["delivered", "cancelled"].includes(normalizeStatus(selectedOrder.estado))) {
      rows.push({ key: "cierre", label: `Cierre: ${humanStatus(selectedOrder.estado)}`, at: selectedOrder.updated_at || selectedOrder.created_at, tone: "done" });
    }

    return rows;
  }, [selectedOrder]);

  const updateStatus = async (nextStatus) => {
    if (!selectedOrder?.id || !ORDER_STATUS.includes(nextStatus)) return;
    if (!getAllowedStatusChanges(selectedOrder).includes(nextStatus)) return;

    if (nextStatus === "cancelled") {
      const confirmCancel = window.confirm("¿Seguro que deseas cancelar este pedido? Esta acción cambia el estado a cancelado.");
      if (!confirmCancel) return;
    }

    setUpdating(true);
    const { error } = await supabase.from("orders").update({ estado: nextStatus }).eq("id", selectedOrder.id);
    if (!error) setSelectedOrder((prev) => ({ ...prev, estado: nextStatus }));
    setUpdating(false);
  };

  const savePayment = async () => {
    if (!selectedOrder?.id) return;

    const method = normalizePaymentMethod(selectedOrder.payment_method);
    const total = safeNumber(selectedOrder.total);
    const received = safeNumber(selectedOrder.cash_received);
    const reference = String(selectedOrder.payment_reference || "").trim();

    if (!method) {
      setPaymentError("Selecciona un método de pago.");
      return;
    }

    if (method === "cash" && received < total) {
      setPaymentError("En efectivo, el monto recibido debe ser mayor o igual al total.");
      return;
    }

    if (needsPaymentReference(method) && !reference) {
      setPaymentError("Ingresa referencia/voucher para el método seleccionado.");
      return;
    }

    setPaymentError("");
    setUpdating(true);

    const payload = {
      p_order_id: selectedOrder.id,
      p_method: method,
      p_cash_received: method === "cash" ? received : null,
      p_reference: needsPaymentReference(method) ? reference : null,
      p_note: String(selectedOrder.payment_note || "").trim() || null,
      p_mark_paid: true,
      p_allow_update: false,
    };

    const { data, error } = await supabase.rpc("rpc_register_order_payment", payload);

    if (error) {
      const message = String(error?.message || "");
      if (message.includes("ALREADY_PAID")) setPaymentError("Este pedido ya tiene pago registrado.");
      else if (message.includes("REFERENCE_REQUIRED")) setPaymentError("La referencia/voucher es obligatoria para ese método.");
      else if (message.includes("CASH_RECEIVED_REQUIRED") || message.includes("CASH_RECEIVED_LT_TOTAL")) setPaymentError("Monto recibido inválido para pago en efectivo.");
      else if (message.includes("CASH_SESSION_REQUIRED")) setPaymentError("Para registrar pago en efectivo debes tener una caja abierta.");
      else if (message.includes("FORBIDDEN")) setPaymentError("No tienes permisos para registrar pagos.");
      else setPaymentError("No se pudo guardar el pago. Intenta nuevamente.");
      setUpdating(false);
      return;
    }

    const paidAt = data?.paid_at || new Date().toISOString();
    const change = safeNumber(data?.cash_change);

    setSelectedOrder((prev) => ({
      ...prev,
      paid: true,
      payment_method: method,
      paid_at: paidAt,
      cash_received: method === "cash" ? received : null,
      cash_change: method === "cash" ? change : 0,
      payment_reference: needsPaymentReference(method) ? reference : null,
      payment_note: String(selectedOrder.payment_note || "").trim() || null,
      updated_at: paidAt,
    }));

    setUpdating(false);
  };

  const notifyWhatsApp = () => {
    if (!selectedOrder) return;
    const waPhone = normalizePhoneForWa(selectedOrder.telefono);
    if (!waPhone) return;

    const msg = [
      `Hola ${selectedOrder.nombre_cliente || "cliente"},`,
      `tu pedido está ${humanStatus(selectedOrder.estado).toLowerCase()}.`,
      `Total ${currency(selectedOrder.total)}.`,
      "Gracias por tu compra en Dpaso.",
    ].join("\n");

    window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  };

  const runQueueInvoice = async () => {
    if (!selectedOrder?.id) return null;

    const idempotencyKey = `${selectedOrder.id}-${Date.now()}`;
    const payload = {
      p_order_id: selectedOrder.id,
      p_document_type: invoiceForm.document_type,
      p_customer_doc_type: invoiceForm.customer_doc_type,
      p_customer_doc_number: invoiceForm.customer_doc_number || null,
      p_customer_name: invoiceForm.customer_name || null,
      p_idempotency_key: idempotencyKey,
    };

    const { data, error } = await supabase.rpc("rpc_queue_invoice_issue", payload);
    if (error) throw new Error(error.message || "QUEUE_FAILED");

    setSelectedOrder((prev) => ({ ...prev, ...data }));
    return { idempotencyKey, row: data };
  };

  const enqueueInvoice = async () => {
    if (!selectedOrder?.id) return;
    setQueueBusy(true);
    setInvoiceFeedback({ type: "", text: "" });

    try {
      await runQueueInvoice();
      setInvoiceFeedback({ type: "success", text: "Comprobante encolado. Ahora puedes emitirlo." });
      await fetchOrderAndItems();
    } catch (error) {
      setInvoiceFeedback({ type: "error", text: getIssueErrorMessage(400, error.message) });
    } finally {
      setQueueBusy(false);
    }
  };

  const emitInvoice = async ({ forceRetry = false } = {}) => {
    if (!selectedOrder?.id) return;

    if (!["admin", "superadmin"].includes(adminRole)) {
      setInvoiceFeedback({ type: "error", text: "No tienes permisos admin para emitir comprobantes." });
      return;
    }

    setInvoiceBusy(true);
    setInvoiceFeedback({ type: "", text: "" });

    try {
      const queued = await runQueueInvoice();
      const { data: { session } } = await supabase.auth.getSession();

      if (import.meta.env.DEV) {
        console.debug("[invoice-debug] session exists:", Boolean(session));
        console.debug("[invoice-debug] token length:", Number(session?.access_token?.length || 0));
      }

      if (!session?.access_token) {
        setInvoiceFeedback({ type: "error", text: "Sesión no válida, vuelve a iniciar sesión." });
        return;
      }

      const payloadBody = {
        order_id: selectedOrder.id,
        document_type: invoiceForm.document_type,
        customer_doc_type: invoiceForm.customer_doc_type,
        customer_doc_number: invoiceForm.customer_doc_number,
        customer_name: invoiceForm.customer_name,
        idempotency_key: queued?.idempotencyKey,
        force_retry: Boolean(forceRetry),
      };

      const { data: payload, error: invokeError } = await supabase.functions.invoke("issue-invoice", {
        body: payloadBody,
      });

      if (import.meta.env.DEV) {
        console.debug("[invoice-debug] function invoke ok:", !invokeError);
      }

      if (invokeError) {
        const status = Number(invokeError?.context?.status || 500);
        const responseData = invokeError?.context ? await invokeError.context.json().catch(() => ({})) : {};
        const errorText = responseData?.error || responseData?.detail || invokeError.message || "EMIT_FAILED";

        if (status === 401) {
          setInvoiceFeedback({ type: "error", text: "Sesión no válida, vuelve a iniciar sesión." });
        } else if (status === 403) {
          setInvoiceFeedback({ type: "error", text: "No tienes permisos admin." });
        } else if (status === 400) {
          setInvoiceFeedback({ type: "error", text: getIssueErrorMessage(status, errorText) });
        } else {
            console.error("[issue-invoice] error interno invoke", { status, errorText, responseData });
          setInvoiceFeedback({ type: "error", text: "Error interno al emitir." });
        }
        return;
      }

      if (payload?.ok === false) {
        const errorText = payload?.error || payload?.detail || payload?.message || "EMIT_FAILED";
        setInvoiceFeedback({ type: "error", text: getIssueErrorMessage(400, errorText) });
        return;
      }

      setInvoiceFeedback({
        type: getInvoiceStatusTone(payload?.status),
        text: `Comprobante ${String(payload?.status || "emitido").toUpperCase()}: ${payload?.full_number || buildFullNumber(payload?.series, payload?.correlativo)}`,
      });

      setSelectedOrder((prev) => ({
        ...prev,
        sunat_status: payload?.status || prev.sunat_status,
        series: payload?.series || prev.series,
        correlativo: payload?.correlativo || prev.correlativo,
        hash: payload?.hash || prev.hash,
        qr_text: payload?.qr_text || prev.qr_text,
        ticket_html: payload?.ticket_html || prev.ticket_html,
        ticket_pdf_base64: payload?.ticket_pdf_base64 || prev.ticket_pdf_base64,
      }));

      await fetchOrderAndItems();
    } catch (error) {
      console.error("[issue-invoice] unexpected error", error);
      setInvoiceFeedback({ type: "error", text: "Error interno al emitir." });
    } finally {
      setInvoiceBusy(false);
    }
  };

  const downloadTicketPdf = () => {
    const b64 = String(selectedOrder?.ticket_pdf_base64 || "");
    if (!b64) {
      setInvoiceFeedback({ type: "error", text: "No hay PDF generado para este comprobante." });
      return;
    }

    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const fullNumber = buildFullNumber(selectedOrder.series, selectedOrder.correlativo).replace(/\s+/g, "_");
      anchor.href = url;
      anchor.download = `${invoiceDocTypeLabel(selectedOrder.document_type).toLowerCase()}_${fullNumber || selectedOrder.id}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setInvoiceFeedback({ type: "error", text: "No se pudo descargar el PDF. Verifica la data del comprobante." });
    }
  };

  if (loading) return <p>Cargando detalle...</p>;
  if (!selectedOrder) return <p>Sin pedidos para mostrar.</p>;

  const availableStatusChanges = getAllowedStatusChanges(selectedOrder);
  const canCancel = availableStatusChanges.includes("cancelled");
  const fullNumber = buildFullNumber(selectedOrder.series, selectedOrder.correlativo);
  const canEmitInvoice = ["admin", "superadmin"].includes(adminRole);
  const emitDisabledReason = adminRoleLoading ? "Validando permisos..." : "Solo admin/superadmin puede emitir";

  return (
    <div className="order-detail-sedap-page">
      <header className="order-detail-header">
        <div>
          <h3>Pedido #{String(selectedOrder.short_code || selectedOrder.id).slice(-8).toUpperCase()}</h3>
          <p><span>Pedidos</span> / Detalle</p>
        </div>

        <div className="order-detail-header-actions">
          <button type="button" className="btn-outline-red" onClick={() => updateStatus("cancelled")} disabled={updating || !canCancel}>Cancelar pedido</button>
          <select value={normalizeStatus(selectedOrder.estado)} onChange={(e) => updateStatus(e.target.value)} disabled={updating || availableStatusChanges.length === 0}>
            {[normalizeStatus(selectedOrder.estado), ...availableStatusChanges]
              .filter((status, index, arr) => arr.indexOf(status) === index)
              .map((status) => <option key={status} value={status}>{humanStatus(status)}</option>)}
          </select>
        </div>
      </header>

      <div className="order-detail-grid">
        <aside className="order-left-col">
          <article className="customer-card">
            <div className="avatar">{String(selectedOrder.nombre_cliente || "C").charAt(0).toUpperCase()}</div>
            <h4>{selectedOrder.nombre_cliente || "Cliente"}</h4>
            <span className="mini-badge">Cliente</span>
          </article>

          <article className="note-card">
            <h5>Nota del pedido</h5>
            <p>{selectedOrder.comentario || "Sin nota registrada por ahora."}</p>
            <div className="address-chip"><FiMapPin size={14} /> {getDeliveryAddressLabel(selectedOrder)}</div>
          </article>

          <article className="history-card">
            <h5>Historial</h5>
            <ul>
              {historyRows.map((row) => (
                <li key={row.key}>
                  <span className={`dot ${row.tone}`} />
                  <div>
                    <strong>{row.label}</strong>
                    <small>{formatDate(row.at)}</small>
                  </div>
                </li>
              ))}
            </ul>
          </article>
        </aside>

        <section className="order-main-col">
          <article className="items-card">
            <div className="items-head">
              <strong>Ítems</strong>
              <span>Cant.</span>
              <span>Precio</span>
              <span>Total</span>
            </div>

            {orderItems.length === 0 ? (
              <p className="empty">Sin datos</p>
            ) : (
              orderItems.map((item) => (
                <div key={item.id} className="item-row">
                  <div>
                    <h6>{item.nombre_snapshot || "Producto"}</h6>
                    <p>{item.cantidad || 0} unidad(es)</p>
                  </div>
                  <span>{item.cantidad || 0}x</span>
                  <span>{currency((Number(item.precio_unitario_snapshot) > 0 ? item.precio_unitario_snapshot : (safeNumber(item.subtotal) / Math.max(safeNumber(item.cantidad), 1))))}</span>
                  <span>{currency(item.subtotal || 0)}</span>
                </div>
              ))
            )}
          </article>

          <article className="payment-card">
            <h5>Pago</h5>
            <div className="payment-grid">
              <label className="payment-field">
                Método de pago
                <select value={selectedOrder.payment_method || ""} onChange={(e) => {
                  const nextMethod = normalizePaymentMethod(e.target.value);
                  setPaymentError("");
                  setSelectedOrder((prev) => ({ ...prev, payment_method: nextMethod, cash_received: nextMethod === "cash" ? prev.cash_received : null, cash_change: nextMethod === "cash" ? prev.cash_change : 0 }));
                }}>
                  <option value="">Sin definir</option>
                  {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{humanPayment(method)}</option>)}
                </select>
              </label>
              <label className="paid-toggle">
                <input type="checkbox" checked={Boolean(selectedOrder.paid)} readOnly disabled />
                <span>Pedido pagado</span>
              </label>
            </div>
            {selectedOrder.payment_method === "cash" ? (
              <label className="payment-field payment-cash-row">
                Efectivo recibido
                <input type="number" min="0" step="0.01" value={selectedOrder.cash_received ?? ""} onChange={(e) => {
                  const received = safeNumber(e.target.value);
                  const total = safeNumber(selectedOrder.total);
                  setPaymentError("");
                  setSelectedOrder((prev) => ({ ...prev, cash_received: e.target.value, cash_change: received - total }));
                }} />
              </label>
            ) : null}
            {needsPaymentReference(selectedOrder.payment_method) ? (
              <label className="payment-field payment-cash-row">
                Referencia / voucher
                <input type="text" value={selectedOrder.payment_reference || ""} onChange={(e) => { setPaymentError(""); setSelectedOrder((prev) => ({ ...prev, payment_reference: e.target.value })); }} placeholder="Ej. Operación, voucher o código" />
              </label>
            ) : null}
            {paymentError ? <p className="payment-error">{paymentError}</p> : null}
            <div className="payment-foot">
              <span>Total: <strong>{currency(selectedOrder.total)}</strong></span>
              <span>Vuelto: <strong>{currency(selectedOrder.cash_change || 0)}</strong></span>
              <button type="button" onClick={savePayment} disabled={updating || Boolean(selectedOrder.paid)}>{selectedOrder.paid ? "Pago registrado" : "Guardar pago"}</button>
            </div>
          </article>

          <article className="invoice-card">
            <h5>Comprobante (MVP simulado)</h5>
            <div className="invoice-form-grid">
              <label>
                Tipo de documento
                <select
                  value={invoiceForm.document_type}
                  onChange={(e) => setInvoiceForm((prev) => ({
                    ...prev,
                    document_type: e.target.value,
                    customer_doc_type: e.target.value === "factura" ? "RUC" : prev.customer_doc_type,
                  }))}
                >
                  {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{invoiceDocTypeLabel(type)}</option>)}
                </select>
              </label>

              <label>
                Tipo doc. cliente
                <select
                  value={invoiceForm.customer_doc_type}
                  onChange={(e) => setInvoiceForm((prev) => ({ ...prev, customer_doc_type: e.target.value }))}
                >
                  {CUSTOMER_DOC_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>

              <label>
                N° documento
                <input
                  type="text"
                  value={invoiceForm.customer_doc_number}
                  onChange={(e) => setInvoiceForm((prev) => ({ ...prev, customer_doc_number: e.target.value.trim() }))}
                  placeholder={invoiceForm.customer_doc_type === "RUC" ? "11 dígitos" : "Documento"}
                />
              </label>

              <label>
                Nombre / Razón social
                <input
                  type="text"
                  value={invoiceForm.customer_name}
                  onChange={(e) => setInvoiceForm((prev) => ({ ...prev, customer_name: e.target.value }))}
                  placeholder="Nombre del cliente"
                />
              </label>
            </div>

            <div className="invoice-actions">
              <button type="button" className="btn-soft" onClick={enqueueInvoice} disabled={queueBusy || invoiceBusy}>Encolar</button>
              <button
                type="button"
                onClick={() => emitInvoice({ forceRetry: false })}
                disabled={invoiceBusy || queueBusy || !canEmitInvoice}
                title={canEmitInvoice ? "Emitir comprobante" : emitDisabledReason}
              >
                Emitir
              </button>
              <button
                type="button"
                className="btn-soft"
                onClick={() => emitInvoice({ forceRetry: true })}
                disabled={invoiceBusy || queueBusy || !canEmitInvoice}
                title={canEmitInvoice ? "Reintentar emisión" : emitDisabledReason}
              >
                Reintentar
              </button>
              <button type="button" className="btn-soft" onClick={() => setTicketModalOpen(true)} disabled={!selectedOrder.ticket_html}>Ver ticket</button>
              <button type="button" className="btn-soft" onClick={downloadTicketPdf} disabled={!selectedOrder.ticket_pdf_base64}>Descargar PDF</button>
            </div>

            {invoiceFeedback.text ? <p className={`invoice-feedback ${invoiceFeedback.type}`}>{invoiceFeedback.text}</p> : null}

            <div className="invoice-result-grid">
              <div><span>Estado</span><strong>{selectedOrder.sunat_status || "not_requested"}</strong></div>
              <div><span>Serie</span><strong>{selectedOrder.series || "-"}</strong></div>
              <div><span>Correlativo</span><strong>{selectedOrder.correlativo || "-"}</strong></div>
              <div><span>Número</span><strong>{fullNumber}</strong></div>
              <div><span>Hash</span><strong>{selectedOrder.hash || "-"}</strong></div>
              <div className="full"><span>QR text</span><strong>{selectedOrder.qr_text || "-"}</strong></div>
            </div>
          </article>

          <article className="track-card">
            <div className="track-map-placeholder">
              <div className="track-title">Rastreo del pedido</div>
              <div className="route-line" />
            </div>

            <div className="delivery-footer">
              <div>
                <small>Reparto</small>
                <h6>{selectedOrder.delivery_person || "Repartidor asignado"}</h6>
              </div>

              <div className="delivery-contact-actions">
                <button type="button" onClick={notifyWhatsApp}><FiPhone size={14} /> Contactar</button>
                <button type="button"><FiTruck size={14} /> {selectedOrder.modalidad || "Delivery"}</button>
              </div>
            </div>

            <div className="totals-row">
              <span>Subtotal</span>
              <strong>{currency(subtotal)}</strong>
            </div>
            <div className="totals-row">
              <span>Total</span>
              <strong>{currency(selectedOrder.total)}</strong>
            </div>
          </article>
        </section>
      </div>

      {ticketModalOpen ? (
        <div className="ticket-modal-backdrop" role="dialog" aria-modal="true">
          <div className="ticket-modal-card">
            <div className="ticket-modal-head">
              <h4>Ticket generado (simulado)</h4>
              <button type="button" onClick={() => setTicketModalOpen(false)}>Cerrar</button>
            </div>
            <div className="ticket-modal-body" dangerouslySetInnerHTML={{ __html: String(selectedOrder.ticket_html || "<p>Sin ticket disponible.</p>") }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
