import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";

const ORDER_STATUS = ["pending", "accepted", "preparing", "ready", "dispatched", "delivered", "completed", "cancelled"];
const PAYMENT_METHODS = ["cash", "yape", "plin", "card", "transfer", "other"];

const STATUS_STYLES = {
  pending: { bg: "#f5eed6", color: "#8a6d1f" },
  accepted: { bg: "#e0ecff", color: "#1e4fa3" },
  preparing: { bg: "#efe4ff", color: "#6f3db7" },
  ready: { bg: "#ffe9d8", color: "#bb5f12" },
  dispatched: { bg: "#e3f3ff", color: "#1f5f8a" },
  delivered: { bg: "#dff5e8", color: "#1f7a43" },
  completed: { bg: "#d9fbe6", color: "#12633a" },
  cancelled: { bg: "#ffe0e0", color: "#b3261e" },
};

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `S/ ${amount.toFixed(2)}`;
}

function shortOrderId(id = "") {
  return String(id).slice(-8).toUpperCase();
}

function getClientCode(order) {
  return String(order?.short_code || '').trim().toUpperCase();
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function isAuthError(error) {
  if (!error) return false;
  return (
    error.status === 401 ||
    error.status === 403 ||
    error.code === "42501" ||
    error.code === "PGRST301" ||
    error.code === "PGRST302"
  );
}

function normalizePhoneForWa(phoneValue) {
  const digits = String(phoneValue || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("51") ? digits : `51${digits}`;
}

function humanPayment(method) {
  const map = { cash: "Efectivo", yape: "Yape", plin: "Plin", card: "Tarjeta", transfer: "Transferencia", other: "Otro" };
  return map[String(method || "").toLowerCase()] || (method || "No definido");
}


function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function humanStatus(status) {
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

  return map[status] || status;
}

export default function Pedidos() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ordersError, setOrdersError] = useState("");

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [busyOrderId, setBusyOrderId] = useState(null);

  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);

  const { toast, showToast } = useToast(2600);
  const navigate = useNavigate();

  const handleAuthError = useCallback(
    async (error) => {
      if (!isAuthError(error)) return false;
      showToast("No autorizado. Inicia sesión nuevamente.", "error");
      await supabase.auth.signOut();
      navigate("/login", { replace: true });
      return true;
    },
    [navigate, showToast]
  );

  const loadOrders = useCallback(
    async ({ silent = false, notifyOnError = false } = {}) => {
      if (!silent) setLoading(true);

      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);

      if (error) {
        console.error("Error cargando pedidos:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });

        const handled = await handleAuthError(error);
        if (!handled && notifyOnError) {
          showToast("No se pudo cargar pedidos", "error");
        }

        setOrdersError("No se pudo cargar pedidos.");
        setLoading(false);
        return;
      }

      const rows = data || [];
      setOrders(rows);
      setOrdersError("");
      setSelectedOrder((prev) => {
        if (!prev?.id) return prev;
        return rows.find((item) => item.id === prev.id) || null;
      });

      setLoading(false);
    },
    [handleAuthError, showToast]
  );

  const loadOrderItems = useCallback(
    async (orderId, { notifyOnError = false } = {}) => {
      if (!orderId) return;

      setDetailLoading(true);
      const { data, error } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Error cargando items de pedido:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          orderId,
        });

        const handled = await handleAuthError(error);
        if (!handled && notifyOnError) {
          showToast("No se pudo cargar el detalle del pedido", "error");
        }

        setDetailError("No se pudo cargar los items del pedido.");
        setOrderItems([]);
        setDetailLoading(false);
        return;
      }

      setOrderItems(data || []);
      setDetailError("");
      setDetailLoading(false);
    },
    [handleAuthError, showToast]
  );

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (!selectedOrder?.id) {
      setOrderItems([]);
      setDetailError("");
      return;
    }

    loadOrderItems(selectedOrder.id);
  }, [selectedOrder?.id, loadOrderItems]);

  useEffect(() => {
    if (!autoRefresh) return undefined;

    const intervalId = setInterval(() => {
      loadOrders({ silent: true });
      if (selectedOrder?.id) {
        loadOrderItems(selectedOrder.id);
      }
    }, 20000);

    return () => clearInterval(intervalId);
  }, [autoRefresh, loadOrderItems, loadOrders, selectedOrder?.id]);


  const itemsSubtotal = useMemo(() => {
    return orderItems.reduce((acc, item) => acc + Number(item.subtotal || 0), 0);
  }, [orderItems]);

  const deliveryAmount = useMemo(() => {
    if (!selectedOrder || selectedOrder.modalidad !== "Delivery") return 0;
    const diff = Number(selectedOrder.total || 0) - itemsSubtotal;
    return diff > 0 ? diff : 0;
  }, [itemsSubtotal, selectedOrder]);

  const filteredOrders = useMemo(() => {
    const term = search.trim().toLowerCase();

    return orders.filter((order) => {
      const byStatus = statusFilter === "all" || order.estado === statusFilter;
      if (!byStatus) return false;
      if (!term) return true;

      const customerName = String(order.nombre_cliente || "").toLowerCase();
      const customerPhone = String(order.telefono || "").toLowerCase();
      const clientCode = getClientCode(order).toLowerCase();
      const internalCode = shortOrderId(order.id).toLowerCase();
      return customerName.includes(term) || customerPhone.includes(term) || clientCode.includes(term) || internalCode.includes(term);
    });
  }, [orders, search, statusFilter]);

  const onChangeStatus = async (newStatus) => {
    if (!selectedOrder?.id || !ORDER_STATUS.includes(newStatus)) return;

    const orderId = selectedOrder.id;
    setBusyOrderId(orderId);

    const { error } = await supabase
      .from("orders")
      .update({ estado: newStatus })
      .eq("id", orderId);

    if (error) {
      console.error("Error actualizando estado:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        orderId,
        newStatus,
      });

      const handled = await handleAuthError(error);
      if (!handled) showToast("No se pudo actualizar el estado", "error");
      setBusyOrderId(null);
      return;
    }

    setOrders((prev) => prev.map((item) => (item.id === orderId ? { ...item, estado: newStatus } : item)));
    setSelectedOrder((prev) => (prev?.id === orderId ? { ...prev, estado: newStatus } : prev));

    showToast("Estado actualizado ✅", "success");
    setBusyOrderId(null);
  };


  const onSavePayment = async () => {
    if (!selectedOrder?.id) return;

    const isPaid = Boolean(selectedOrder.paid);
    const method = selectedOrder.payment_method || null;
    const total = safeNumber(selectedOrder.total);
    const received = safeNumber(selectedOrder.cash_received);
    const computedChange = method === "cash" && isPaid ? received - total : 0;

    if (isPaid && !method) {
      showToast("Selecciona método de pago", "error");
      return;
    }

    if (isPaid && method === "cash" && received < total) {
      showToast("El monto recibido no puede ser menor al total", "error");
      return;
    }

    setBusyOrderId(selectedOrder.id);

    const { error } = await supabase
      .from("orders")
      .update({
        paid: isPaid,
        payment_method: method,
        paid_at: isPaid ? new Date().toISOString() : null,
        cash_received: isPaid && method === "cash" ? received : null,
        cash_change: isPaid && method === "cash" ? computedChange : null,
      })
      .eq("id", selectedOrder.id);

    if (error) {
      console.error("Error actualizando pago:", error);
      const handled = await handleAuthError(error);
      if (!handled) showToast("No se pudo actualizar pago", "error");
      setBusyOrderId(null);
      return;
    }

    setOrders((prev) => prev.map((item) => (
      item.id === selectedOrder.id
        ? {
            ...item,
            paid: isPaid,
            payment_method: method,
            paid_at: isPaid ? (item.paid_at || new Date().toISOString()) : null,
            cash_received: isPaid && method === "cash" ? received : null,
            cash_change: isPaid && method === "cash" ? computedChange : null,
          }
        : item
    )));

    setSelectedOrder((prev) => prev ? ({
      ...prev,
      paid: isPaid,
      payment_method: method,
      paid_at: isPaid ? (prev.paid_at || new Date().toISOString()) : null,
      cash_received: isPaid && method === "cash" ? received : null,
      cash_change: isPaid && method === "cash" ? computedChange : null,
    }) : prev);

    showToast("Pago actualizado ✅", "success");
    setBusyOrderId(null);
  };

  const openWhatsApp = () => {
    if (!selectedOrder) return;

    const waPhone = normalizePhoneForWa(selectedOrder.telefono);
    if (!waPhone) {
      showToast("No hay teléfono válido para WhatsApp", "error");
      return;
    }

    const publicCode = getClientCode(selectedOrder) || shortOrderId(selectedOrder.id);

    const message = [
      `Hola ${selectedOrder.nombre_cliente || "cliente"},`,
      `tu pedido ${publicCode} está ${humanStatus(selectedOrder.estado).toLowerCase()}.`,
      `Total ${formatCurrency(selectedOrder.total)}.`,
      "¡Gracias por comprar en DPASO!",
    ].join(" ");

    const url = `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Toast toast={toast} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Pedidos</h2>
        <button
          type="button"
          onClick={() => loadOrders({ notifyOnError: true })}
          style={secondaryBtn}
        >
          Recargar
        </button>
      </div>

      <div style={filterCard}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle}>
          <option value="all">Todos los estados</option>
          {ORDER_STATUS.map((status) => (
            <option key={status} value={status}>
              {humanStatus(status)}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, minWidth: 220 }}
          placeholder="Buscar por cliente, teléfono, código cliente o ID interno"
        />

        <label style={toggleLabel}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Auto-actualizar (20s)
        </label>
      </div>

      <div className="orders-grid" style={layoutGrid}>
        <section style={listCard}>
          <div style={sectionHeader}>
            <strong>Últimos pedidos</strong>
            <span style={{ color: "#6b7280", fontSize: 13 }}>{filteredOrders.length} resultado(s)</span>
          </div>

          {loading ? (
            <p style={mutedText}>Cargando pedidos...</p>
          ) : ordersError ? (
            <p style={errorText}>{ordersError}</p>
          ) : filteredOrders.length === 0 ? (
            <p style={mutedText}>No hay pedidos con los filtros actuales.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Código cliente</th>
                    <th style={thStyle}>ID interno</th>
                    <th style={thStyle}>Fecha</th>
                    <th style={thStyle}>Cliente</th>
                    <th style={thStyle}>Teléfono</th>
                    <th style={thStyle}>Modalidad</th>
                    <th style={thStyle}>Total</th>
                    <th style={thStyle}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => {
                    const isSelected = selectedOrder?.id === order.id;
                    return (
                      <tr
                        key={order.id}
                        onClick={() => setSelectedOrder(order)}
                        style={{ ...trStyle, ...(isSelected ? trSelectedStyle : {}) }}
                      >
                        <td style={tdStyle}><strong>{getClientCode(order) || "-"}</strong></td>
                        <td style={tdStyle}>#{shortOrderId(order.id)}</td>
                        <td style={tdStyle}>{formatDate(order.created_at)}</td>
                        <td style={tdStyle}>{order.nombre_cliente || "-"}</td>
                        <td style={tdStyle}>{order.telefono || "-"}</td>
                        <td style={tdStyle}>{order.modalidad || "-"}</td>
                        <td style={tdStyle}>{formatCurrency(order.total)}</td>
                        <td style={tdStyle}>
                          <span style={{ ...badgeStyle, ...getStatusStyle(order.estado) }}>{humanStatus(order.estado)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside style={detailCard}>
          {!selectedOrder ? (
            <p style={mutedText}>Selecciona un pedido para ver su detalle.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ margin: 0 }}>Pedido {getClientCode(selectedOrder) || `#${shortOrderId(selectedOrder.id)}`}</h3>
                <span style={{ ...badgeStyle, ...getStatusStyle(selectedOrder.estado) }}>
                  {humanStatus(selectedOrder.estado)}
                </span>
              </div>

              <p style={labelLine}><strong>Código cliente:</strong> {getClientCode(selectedOrder) || "-"}</p>
              <p style={labelLine}><strong>ID interno:</strong> #{shortOrderId(selectedOrder.id)}</p>
              <p style={labelLine}><strong>Fecha:</strong> {formatDate(selectedOrder.created_at)}</p>
              <p style={labelLine}><strong>Cliente:</strong> {selectedOrder.nombre_cliente || "-"}</p>
              <p style={labelLine}><strong>Teléfono:</strong> {selectedOrder.telefono || "-"}</p>
              <p style={labelLine}><strong>Modalidad:</strong> {selectedOrder.modalidad || "-"}</p>
              <p style={labelLine}><strong>Método pago:</strong> {humanPayment(selectedOrder.payment_method)}</p>
              <p style={labelLine}><strong>Pagado:</strong> {selectedOrder.paid ? "Sí" : "No"}</p>

              <div style={statusControlWrap}>
                <label htmlFor="payment-method-order" style={{ fontWeight: 600, color: "#162447" }}>
                  Método de pago
                </label>
                <select
                  id="payment-method-order"
                  style={inputStyle}
                  value={selectedOrder.payment_method || ""}
                  disabled={busyOrderId === selectedOrder.id}
                  onChange={(e) => setSelectedOrder((prev) => ({ ...prev, payment_method: e.target.value }))}
                >
                  <option value="">Sin definir</option>
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>{humanPayment(method)}</option>
                  ))}
                </select>
              </div>

              <label style={toggleLabel}>
                <input
                  type="checkbox"
                  checked={Boolean(selectedOrder.paid)}
                  disabled={busyOrderId === selectedOrder.id}
                  onChange={(e) => setSelectedOrder((prev) => ({ ...prev, paid: e.target.checked }))}
                />
                Pedido pagado
              </label>

              {Boolean(selectedOrder.paid) && selectedOrder.payment_method === "cash" && (
                <>
                  <div style={statusControlWrap}>
                    <label htmlFor="cash-received-order" style={{ fontWeight: 600, color: "#162447" }}>
                      Efectivo recibido
                    </label>
                    <input
                      id="cash-received-order"
                      type="number"
                      min="0"
                      step="0.01"
                      style={inputStyle}
                      value={selectedOrder.cash_received ?? ""}
                      disabled={busyOrderId === selectedOrder.id}
                      onChange={(e) => {
                        const received = safeNumber(e.target.value);
                        const total = safeNumber(selectedOrder.total);
                        setSelectedOrder((prev) => ({
                          ...prev,
                          cash_received: e.target.value,
                          cash_change: received - total,
                        }));
                      }}
                    />
                  </div>
                  <p style={labelLine}><strong>Vuelto:</strong> {formatCurrency(safeNumber(selectedOrder.cash_change))}</p>
                </>
              )}

              <button type="button" style={secondaryBtn} onClick={onSavePayment} disabled={busyOrderId === selectedOrder.id}>
                Guardar pago
              </button>

              {selectedOrder.modalidad === "Delivery" && (
                <>
                  <p style={labelLine}><strong>Dirección:</strong> {selectedOrder.direccion || "-"}</p>
                  <p style={labelLine}><strong>Referencia:</strong> {selectedOrder.referencia || "-"}</p>
                </>
              )}

              <p style={labelLine}><strong>Comentario:</strong> {selectedOrder.comentario || "-"}</p>

              <div style={statusControlWrap}>
                <label htmlFor="estado-order" style={{ fontWeight: 600, color: "#162447" }}>
                  Cambiar estado
                </label>
                <select
                  id="estado-order"
                  style={inputStyle}
                  value={selectedOrder.estado || "pending"}
                  disabled={busyOrderId === selectedOrder.id}
                  onChange={(e) => onChangeStatus(e.target.value)}
                >
                  {ORDER_STATUS.map((status) => (
                    <option key={status} value={status}>
                      {humanStatus(status)}
                    </option>
                  ))}
                </select>
              </div>

              <button type="button" style={whatsappBtn} onClick={openWhatsApp}>
                WhatsApp cliente
              </button>

              <hr style={{ border: 0, borderTop: "1px solid #e5e7eb", margin: "4px 0" }} />

              <strong>Items del pedido</strong>
              {detailLoading ? (
                <p style={mutedText}>Cargando items...</p>
              ) : detailError ? (
                <p style={errorText}>{detailError}</p>
              ) : orderItems.length === 0 ? (
                <p style={mutedText}>Este pedido no tiene items registrados.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {orderItems.map((item) => (
                    <div key={item.id} style={itemRow}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{item.nombre_snapshot}</div>
                        <div style={{ fontSize: 13, color: "#6b7280" }}>Cantidad: {item.cantidad}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 13, color: "#6b7280" }}>Precio: {formatCurrency(item.precio_snapshot)}</div>
                        <div style={{ fontWeight: 600 }}>Subtotal: {formatCurrency(item.subtotal)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                <span>Subtotal items</span>
                <span>{formatCurrency(itemsSubtotal)}</span>
              </div>

              {selectedOrder.modalidad === "Delivery" && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Delivery</span>
                  <span>{formatCurrency(deliveryAmount)}</span>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                <strong>Total final</strong>
                <strong>{formatCurrency(selectedOrder.total)}</strong>
              </div>
            </div>
          )}
        </aside>
      </div>

      <style>{`
        @media (max-width: 1080px) {
          .orders-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

function getStatusStyle(status) {
  return STATUS_STYLES[status] || { bg: "#e5e7eb", color: "#374151" };
}

const filterCard = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  background: "#fff",
  borderRadius: 12,
  padding: 12,
  boxShadow: "0 4px 14px rgba(0,0,0,.06)",
};

const layoutGrid = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.6fr) minmax(320px, 1fr)",
  gap: 14,
};

const listCard = {
  background: "#fff",
  borderRadius: 12,
  padding: 12,
  boxShadow: "0 4px 14px rgba(0,0,0,.06)",
};

const detailCard = {
  background: "#fff",
  borderRadius: 12,
  padding: 12,
  boxShadow: "0 4px 14px rgba(0,0,0,.06)",
  minHeight: 220,
};

const sectionHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 10,
};

const inputStyle = {
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: "9px 10px",
  fontSize: 14,
  background: "#fff",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 920,
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
  verticalAlign: "middle",
};

const trStyle = {
  cursor: "pointer",
};

const trSelectedStyle = {
  backgroundColor: "#f3f8ff",
};

const badgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 700,
};

const mutedText = {
  color: "#6b7280",
};

const errorText = {
  color: "#b3261e",
};

const labelLine = {
  margin: 0,
  color: "#111827",
};

const itemRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "8px 10px",
};

const secondaryBtn = {
  backgroundColor: "#1f4068",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 12px",
  cursor: "pointer",
};

const whatsappBtn = {
  backgroundColor: "#25d366",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 12px",
  cursor: "pointer",
  fontWeight: 600,
};

const toggleLabel = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  fontSize: 14,
  color: "#374151",
};

const statusControlWrap = {
  display: "grid",
  gap: 6,
};
