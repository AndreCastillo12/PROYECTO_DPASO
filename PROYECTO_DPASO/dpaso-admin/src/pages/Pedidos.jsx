import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiExternalLink, FiMoreHorizontal } from "react-icons/fi";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import useAdminPreferences from "../hooks/useAdminPreferences";
import { OPERATION_MESSAGES, resolveErrorMessage } from "../utils/operationMessages";
import "../styles/pedidos-sedap.css";

const ORDER_STATUS = ["pending", "accepted", "preparing", "ready", "dispatched", "delivered", "completed", "cancelled"];

const STATUS_META = {
  pending: { label: "New Order", className: "new" },
  accepted: { label: "Accepted", className: "blue" },
  preparing: { label: "Preparing", className: "purple" },
  ready: { label: "Ready", className: "orange" },
  dispatched: { label: "On Delivery", className: "blue" },
  delivered: { label: "Delivered", className: "green" },
  completed: { label: "Completed", className: "green" },
  cancelled: { label: "Cancelled", className: "red" },
};

function formatCurrency(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function humanStatus(status) {
  return STATUS_META[String(status || "")]?.label || "Sin estado";
}

function shortCode(order) {
  return String(order?.short_code || order?.id || "").slice(-8).toUpperCase();
}

function normalizePhoneForWa(phoneValue) {
  const digits = String(phoneValue || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("51") ? digits : `51${digits}`;
}

function matchesFilter(order, term) {
  if (!term) return true;
  const q = term.toLowerCase();
  return [order.nombre_cliente, order.telefono, shortCode(order)].some((v) => String(v || "").toLowerCase().includes(q));
}

export default function Pedidos() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyOrderId, setBusyOrderId] = useState(null);
  const [openMenuOrderId, setOpenMenuOrderId] = useState(null);
  const ordersChannelRef = useRef(null);

  const [preferences, setPreferences] = useAdminPreferences("dpaso_admin_pedidos_filters", {
    statusFilter: "all",
    search: "",
    autoRefresh: false,
    dateFrom: "",
    dateTo: "",
  });

  const { statusFilter, search, autoRefresh, dateFrom, dateTo } = preferences;

  const updatePreference = useCallback((field, value) => {
    setPreferences((prev) => ({ ...prev, [field]: value }));
  }, [setPreferences]);

  const { toast, showToast } = useToast(2600);
  const navigate = useNavigate();

  const loadOrders = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(60);

    if (error) {
      showToast(OPERATION_MESSAGES.loadError, "error");
      setLoading(false);
      return;
    }

    setOrders(data || []);
    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const intervalId = setInterval(() => loadOrders({ silent: true }), 20000);
    return () => clearInterval(intervalId);
  }, [autoRefresh, loadOrders]);

  useEffect(() => {
    const channel = supabase
      .channel("admin-orders-list-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, async () => {
        await loadOrders({ silent: true });
      })
      .subscribe();

    ordersChannelRef.current = channel;
    return () => {
      if (ordersChannelRef.current) {
        supabase.removeChannel(ordersChannelRef.current);
        ordersChannelRef.current = null;
      }
    };
  }, [loadOrders]);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      if (statusFilter !== "all" && order.estado !== statusFilter) return false;
      if (!matchesFilter(order, search.trim())) return false;

      const createdAt = order.created_at ? new Date(order.created_at) : null;
      if (dateFrom) {
        const start = new Date(`${dateFrom}T00:00:00`);
        if (!createdAt || createdAt < start) return false;
      }
      if (dateTo) {
        const end = new Date(`${dateTo}T23:59:59`);
        if (!createdAt || createdAt > end) return false;
      }

      return true;
    });
  }, [dateFrom, dateTo, orders, search, statusFilter]);

  const onChangeStatus = async (order, newStatus) => {
    if (!order?.id || !ORDER_STATUS.includes(newStatus)) return;

    setBusyOrderId(order.id);
    const { error } = await supabase
      .from("orders")
      .update({ estado: newStatus })
      .eq("id", order.id);

    if (error) {
      showToast(OPERATION_MESSAGES.saveError, "error");
      setBusyOrderId(null);
      return;
    }

    setOrders((prev) => prev.map((item) => (item.id === order.id ? { ...item, estado: newStatus } : item)));
    showToast(OPERATION_MESSAGES.saveSuccess, "success");
    setBusyOrderId(null);
  };

  const openWhatsApp = (order) => {
    const waPhone = normalizePhoneForWa(order.telefono);
    if (!waPhone) {
      showToast(resolveErrorMessage(null, "No hay teléfono válido para WhatsApp."), "error");
      return;
    }

    const msg = [
      `Hola ${order.nombre_cliente || "cliente"},`,
      `tu pedido ${shortCode(order)} está ${humanStatus(order.estado).toLowerCase()}.`,
      `Total ${formatCurrency(order.total)}.`,
      "Gracias por tu compra en Dpaso.",
    ].join("\n");

    window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  };

  if (loading) return <p>Cargando pedidos...</p>;

  return (
    <div className="pedidos-list-page">
      <Toast toast={toast} />

      <section className="pedidos-head-card">
        <div>
          <h3>Your Orders</h3>
          <p>This is your order list data</p>
        </div>

        <div className="pedidos-filters">
          <input
            type="search"
            placeholder="Buscar cliente, teléfono o código"
            value={search}
            onChange={(e) => updatePreference("search", e.target.value)}
          />
          <select value={statusFilter} onChange={(e) => updatePreference("statusFilter", e.target.value)}>
            <option value="all">All Status</option>
            {ORDER_STATUS.map((status) => <option key={status} value={status}>{humanStatus(status)}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={(e) => updatePreference("dateFrom", e.target.value)} />
          <input type="date" value={dateTo} onChange={(e) => updatePreference("dateTo", e.target.value)} />
        </div>
      </section>

      <section className="pedidos-table-card">
        <table>
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Date</th>
              <th>Customer Name</th>
              <th>Location</th>
              <th>Amount</th>
              <th>Status Order</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map((order) => {
              const meta = STATUS_META[order.estado] || STATUS_META.pending;
              return (
                <tr key={order.id}>
                  <td>#{shortCode(order)}</td>
                  <td>{new Date(order.created_at).toLocaleString()}</td>
                  <td>{order.nombre_cliente || "Cliente"}</td>
                  <td>{order.direccion || order.referencia || "-"}</td>
                  <td>{formatCurrency(order.total)}</td>
                  <td>
                    <div className="status-cell">
                      <span className={`status-badge ${meta.className}`}>{meta.label}</span>
                      <select
                        value={order.estado || "pending"}
                        disabled={busyOrderId === order.id}
                        onChange={(e) => onChangeStatus(order, e.target.value)}
                      >
                        {ORDER_STATUS.map((status) => <option key={status} value={status}>{humanStatus(status)}</option>)}
                      </select>
                    </div>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setOpenMenuOrderId((prev) => (prev === order.id ? null : order.id))}
                      >
                        <FiMoreHorizontal size={16} />
                      </button>

                      {openMenuOrderId === order.id ? (
                        <div className="row-menu">
                          <button type="button" onClick={() => onChangeStatus(order, "accepted")}>Accept Order</button>
                          <button type="button" onClick={() => onChangeStatus(order, "cancelled")}>Reject Order</button>
                          <button type="button" onClick={() => openWhatsApp(order)}>WhatsApp</button>
                          <button type="button" onClick={() => navigate(`/pedido-detalle?order_id=${order.id}`)}>
                            Ver detalle <FiExternalLink size={13} />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <p className="table-foot">Showing {filteredOrders.length} from {orders.length} data</p>
    </div>
  );
}
