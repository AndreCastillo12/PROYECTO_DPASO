import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";

const DEFAULT_SETTINGS = {
  id: null,
  is_open: true,
  open_time: "",
  close_time: "",
  closed_message: "Estamos cerrados. Vuelve en nuestro horario de atención.",
};

function normalizeTime(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, 5);
}

function isValidTime(value) {
  if (!value) return true;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export default function Tienda() {
  const [form, setForm] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast, showToast } = useToast(2400);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    const { data, error } = await supabase
      .from("store_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Error cargando store_settings:", error);
      showToast("No se pudo cargar horarios", "error");
      setLoading(false);
      return;
    }

    const row = data || DEFAULT_SETTINGS;
    setForm({
      ...DEFAULT_SETTINGS,
      ...row,
      open_time: normalizeTime(row.open_time),
      close_time: normalizeTime(row.close_time),
    });
    setLoading(false);
  }

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function onSave() {
    if (!isValidTime(form.open_time) || !isValidTime(form.close_time)) {
      showToast("Formato de hora inválido (HH:MM)", "error");
      return;
    }

    const payload = {
      is_open: Boolean(form.is_open),
      open_time: form.open_time || null,
      close_time: form.close_time || null,
      closed_message: String(form.closed_message || "").trim() || DEFAULT_SETTINGS.closed_message,
      timezone: "America/Lima",
    };

    setSaving(true);

    if (form.id) {
      const { error } = await supabase.from("store_settings").update(payload).eq("id", form.id);
      if (error) {
        console.error("Error actualizando store_settings:", error);
        showToast("No se pudo guardar", "error");
        setSaving(false);
        return;
      }

      showToast("Guardado ✅", "success");
      setSaving(false);
      return;
    }

    const { data, error } = await supabase.from("store_settings").insert(payload).select("id").single();
    if (error) {
      console.error("Error creando store_settings:", error);
      showToast("No se pudo guardar", "error");
      setSaving(false);
      return;
    }

    setForm((prev) => ({ ...prev, id: data?.id || prev.id }));
    showToast("Guardado ✅", "success");
    setSaving(false);
  }

  if (loading) return <p>Cargando horarios de atención...</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
      <Toast toast={toast} />

      <h2 style={{ margin: 0 }}>Horarios de atención</h2>

      <div style={cardStyle}>
        <label style={switchRow}>
          <span style={{ fontWeight: 600, color: "#2fa67f" }}>Tienda abierta</span>
          <input type="checkbox" checked={Boolean(form.is_open)} onChange={(e) => updateField("is_open", e.target.checked)} />
        </label>

        <div style={grid2}>
          <label style={fieldWrap}>
            <span>Hora de apertura</span>
            <input type="time" value={form.open_time || ""} onChange={(e) => updateField("open_time", e.target.value)} style={inputStyle} />
          </label>

          <label style={fieldWrap}>
            <span>Hora de cierre</span>
            <input type="time" value={form.close_time || ""} onChange={(e) => updateField("close_time", e.target.value)} style={inputStyle} />
          </label>
        </div>

        <label style={fieldWrap}>
          <span>Mensaje de cerrado</span>
          <textarea value={form.closed_message || ""} onChange={(e) => updateField("closed_message", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
        </label>

        <button type="button" onClick={onSave} disabled={saving} style={saveBtn}>
          {saving ? "Guardando..." : "Guardar"}
        </button>
      </div>
    </div>
  );
}

const cardStyle = { background: "#fff", borderRadius: 12, padding: 16, display: "grid", gap: 12, boxShadow: "0 8px 24px rgba(17,24,39,.04)" };
const fieldWrap = { display: "grid", gap: 6, color: "#1f2937", fontSize: 14 };
const grid2 = { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" };
const switchRow = { display: "flex", justifyContent: "space-between", alignItems: "center" };
const inputStyle = { border: "1px solid #dce7e2", borderRadius: 8, padding: "9px 10px", fontSize: 14 };
const saveBtn = { border: "none", borderRadius: 8, background: "#2fa67f", color: "#fff", padding: "10px 12px", cursor: "pointer", fontWeight: 600 };
