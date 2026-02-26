import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import useAdminRole from "../hooks/useAdminRole";

const STATUS_FLOW = ["pending", "preparing", "ready"];
const STATUS_LABEL = {
  pending: "Pendiente",
  preparing: "En preparación",
  ready: "Listo",
};

function statusBadge(status) {
  if (status === "ready") return { background: "#dcfce7", color: "#166534" };
  if (status === "preparing") return { background: "#e0e7ff", color: "#3730a3" };
  return { background: "#fff7ed", color: "#9a3412" };
}

function nextStatus(status) {
  const index = STATUS_FLOW.indexOf(String(status || "").toLowerCase());
  if (index < 0 || index >= STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[index + 1];
}

function fmtHour(value) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function errMsg(error, fallback) {
  const msg = String(error?.message || "").trim();
  return msg ? `${fallback}: ${msg}` : fallback;
}

export default function Cocina() {
  const { toast, showToast } = useToast(3000);
  const { canAccess } = useAdminRole();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [commands, setCommands] = useState([]);
  const [commandItems, setCommandItems] = useState([]);

  const loadData = async () => {
    setLoading(true);
    const [cmdResp, itemsResp] = await Promise.all([
      supabase
        .from("kitchen_commands")
        .select("id,ticket_id,table_id,table_name_snapshot,ticket_code_snapshot,note,status,created_at")
        .order("created_at", { ascending: true })
        .in("status", ["pending", "preparing", "ready"]),
      supabase
        .from("kitchen_command_items")
        .select("id,command_id,name_snapshot,qty")
        .order("created_at", { ascending: true }),
    ]);

    if (cmdResp.error) showToast(errMsg(cmdResp.error, "Error cargando comandas"), "error");
    if (itemsResp.error) showToast(errMsg(itemsResp.error, "Error cargando items de comanda"), "error");

    setCommands(cmdResp.data || []);
    setCommandItems(itemsResp.data || []);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const itemsByCommand = useMemo(() => {
    const map = new Map();
    commandItems.forEach((item) => {
      const list = map.get(item.command_id) || [];
      list.push(item);
      map.set(item.command_id, list);
    });
    return map;
  }, [commandItems]);

  const onAdvance = async (command) => {
    const to = nextStatus(command.status);
    if (!to) return;

    setBusyId(command.id);
    const { error } = await supabase.rpc("rpc_kitchen_update_command_status", {
      p_command_id: command.id,
      p_next_status: to,
    });

    if (error) {
      showToast(errMsg(error, "No se pudo actualizar la comanda"), "error");
      setBusyId(null);
      return;
    }

    await loadData();
    setBusyId(null);
    showToast(`Comanda en estado ${STATUS_LABEL[to]}`, "success");
  };

  if (!canAccess("cocina")) return <p>No tienes permisos para Cocina.</p>;
  if (loading) return <p>Cargando cocina...</p>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Toast toast={toast} />
      <h2 style={{ margin: 0 }}>Cocina (Comandas)</h2>
      <section style={{ background: "#fff", borderRadius: 12, padding: 12 }}>
        {commands.length === 0 ? <p>No hay comandas activas.</p> : (
          <div style={{ display: "grid", gap: 10 }}>
            {commands.map((command) => {
              const next = nextStatus(command.status);
              const badge = statusBadge(command.status);
              const items = itemsByCommand.get(command.id) || [];

              return (
                <article key={command.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <strong>{command.table_name_snapshot || "Mesa"} · Ticket {String(command.ticket_code_snapshot || command.ticket_id || "").slice(0, 8).toUpperCase()}</strong>
                      <div style={{ color: "#6b7280", marginTop: 4 }}>Hora: {fmtHour(command.created_at)}</div>
                    </div>
                    <span style={{ borderRadius: 999, padding: "5px 10px", fontSize: 12, ...badge }}>{STATUS_LABEL[command.status] || command.status}</span>
                  </div>

                  <ul style={{ margin: "10px 0", paddingLeft: 18 }}>
                    {items.map((item) => <li key={item.id}>{item.qty} × {item.name_snapshot}</li>)}
                  </ul>

                  {command.note ? <p style={{ margin: "0 0 10px" }}><strong>Nota:</strong> {command.note}</p> : null}

                  {next ? (
                    <button
                      type="button"
                      style={{ background: "#2fa67f", color: "#fff", border: "none", borderRadius: 8, padding: "8px 10px" }}
                      disabled={busyId === command.id}
                      onClick={() => onAdvance(command)}
                    >
                      Pasar a {STATUS_LABEL[next]}
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
