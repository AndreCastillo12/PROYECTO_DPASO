import { useMemo, useState } from "react";

const STORAGE_KEY = "dpaso_estado_operativo_v1";

const MODULE_TEMPLATES = {
  carta: {
    label: "Carta",
    status: "pending",
    checklist: [
      { id: "checkout", label: "Checkout crea pedidos correctamente", done: false },
      { id: "auth", label: "Login/registro/recuperación operativos", done: false },
      { id: "tracking", label: "Seguimiento de pedido visible para cliente", done: false },
    ],
  },
  admin: {
    label: "Admin",
    status: "in_progress",
    checklist: [
      { id: "pedidos", label: "Pedidos con actualización de estado", done: false },
      { id: "clientes", label: "Clientes con historial y búsqueda", done: false },
      { id: "caja", label: "Caja con apertura/cierre y movimientos", done: false },
    ],
  },
  base_datos: {
    label: "Base de datos",
    status: "in_progress",
    checklist: [
      { id: "rls", label: "RLS validado en tablas sensibles", done: false },
      { id: "rpc", label: "RPC críticas validadas (create_order/reportes)", done: false },
      { id: "indices", label: "Índices de rendimiento revisados", done: false },
    ],
  },
  deploy: {
    label: "Deploy",
    status: "pending",
    checklist: [
      { id: "env", label: "Variables de entorno verificadas", done: false },
      { id: "health", label: "Smoke test post-deploy ejecutado", done: false },
      { id: "rollback", label: "Plan de rollback confirmado", done: false },
    ],
  },
};

const STATUS_META = {
  ready: { label: "Listo", color: "#1f7a43", bg: "#dff5e8", emoji: "🟢" },
  in_progress: { label: "En progreso", color: "#9a6700", bg: "#fff4cc", emoji: "🟡" },
  pending: { label: "Falta", color: "#b3261e", bg: "#ffe0e0", emoji: "🔴" },
};

function loadInitialState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { modules: MODULE_TEMPLATES, weeklySummary: "" };
    const parsed = JSON.parse(raw);
    if (!parsed?.modules) return { modules: MODULE_TEMPLATES, weeklySummary: "" };
    return {
      modules: { ...MODULE_TEMPLATES, ...parsed.modules },
      weeklySummary: parsed.weeklySummary || "",
    };
  } catch {
    return { modules: MODULE_TEMPLATES, weeklySummary: "" };
  }
}

export default function EstadoOperativo() {
  const initial = useMemo(() => loadInitialState(), []);
  const [modules, setModules] = useState(initial.modules);
  const [weeklySummary, setWeeklySummary] = useState(initial.weeklySummary);
  const [savedAt, setSavedAt] = useState(null);

  function persist(nextModules, nextSummary) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ modules: nextModules, weeklySummary: nextSummary })
    );
    setSavedAt(new Date().toISOString());
  }

  function updateModuleStatus(moduleKey, status) {
    const nextModules = {
      ...modules,
      [moduleKey]: {
        ...modules[moduleKey],
        status,
      },
    };
    setModules(nextModules);
    persist(nextModules, weeklySummary);
  }

  function toggleChecklist(moduleKey, itemId) {
    const module = modules[moduleKey];
    const nextChecklist = module.checklist.map((item) =>
      item.id === itemId ? { ...item, done: !item.done } : item
    );

    const total = nextChecklist.length;
    const completed = nextChecklist.filter((item) => item.done).length;

    let autoStatus = "pending";
    if (completed === total && total > 0) autoStatus = "ready";
    else if (completed > 0) autoStatus = "in_progress";

    const nextModules = {
      ...modules,
      [moduleKey]: {
        ...module,
        checklist: nextChecklist,
        status: autoStatus,
      },
    };

    setModules(nextModules);
    persist(nextModules, weeklySummary);
  }

  function updateWeeklySummary(value) {
    setWeeklySummary(value);
    persist(modules, value);
  }

  const stats = useMemo(() => {
    const values = Object.values(modules);
    return {
      ready: values.filter((m) => m.status === "ready").length,
      inProgress: values.filter((m) => m.status === "in_progress").length,
      pending: values.filter((m) => m.status === "pending").length,
    };
  }, [modules]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Estado operativo (Semáforo)</h2>
        <small style={{ color: "#667085" }}>
          {savedAt ? `Último guardado: ${new Date(savedAt).toLocaleString()}` : "Sin cambios guardados aún"}
        </small>
      </div>

      <section style={statsGrid}>
        <article style={{ ...statCard, background: "#dff5e8" }}>🟢 Listo: <strong>{stats.ready}</strong></article>
        <article style={{ ...statCard, background: "#fff4cc" }}>🟡 En progreso: <strong>{stats.inProgress}</strong></article>
        <article style={{ ...statCard, background: "#ffe0e0" }}>🔴 Falta: <strong>{stats.pending}</strong></article>
      </section>

      <section style={modulesGrid}>
        {Object.entries(modules).map(([moduleKey, module]) => {
          const meta = STATUS_META[module.status] || STATUS_META.pending;
          return (
            <article key={moduleKey} style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <h3 style={{ margin: 0 }}>{module.label}</h3>
                <span style={{ ...badgeStyle, color: meta.color, background: meta.bg }}>
                  {meta.emoji} {meta.label}
                </span>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {Object.entries(STATUS_META).map(([value, itemMeta]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => updateModuleStatus(moduleKey, value)}
                    style={{
                      ...statusBtn,
                      borderColor: module.status === value ? itemMeta.color : "#d0d5dd",
                      color: module.status === value ? itemMeta.color : "#344054",
                    }}
                  >
                    {itemMeta.emoji} {itemMeta.label}
                  </button>
                ))}
              </div>

              <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                {module.checklist.map((item) => (
                  <label key={item.id} style={checkItem}>
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => toggleChecklist(moduleKey, item.id)}
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </article>
          );
        })}
      </section>

      <section style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Resumen semanal</h3>
        <p style={{ margin: "0 0 8px", color: "#667085", fontSize: 13 }}>
          Escribe aquí el estado de la semana (bloqueos, logros y siguientes pasos).
        </p>
        <textarea
          style={textareaStyle}
          value={weeklySummary}
          onChange={(e) => updateWeeklySummary(e.target.value)}
          placeholder="Ejemplo: Se cerró caja/reportes en producción, faltan pruebas de smoke en deploy..."
        />
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

const statsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 10,
};

const statCard = {
  ...cardStyle,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const modulesGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: 10,
};

const badgeStyle = {
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
  padding: "4px 10px",
};

const statusBtn = {
  background: "#fff",
  border: "1px solid #d0d5dd",
  borderRadius: 8,
  padding: "6px 9px",
  cursor: "pointer",
  fontSize: 13,
};

const checkItem = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  fontSize: 14,
};

const textareaStyle = {
  width: "100%",
  minHeight: 120,
  borderRadius: 10,
  border: "1px solid #d0d5dd",
  padding: 10,
  fontSize: 14,
};
