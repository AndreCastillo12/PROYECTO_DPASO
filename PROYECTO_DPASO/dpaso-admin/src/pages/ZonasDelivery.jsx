import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";

const ZONE_CATALOG = [
  { provincia: "Lima", distrito: "Ate" },
  { provincia: "Lima", distrito: "Santa Anita" },
  { provincia: "Lima", distrito: "El Agustino" },
  { provincia: "Lima", distrito: "San Juan de Lurigancho" },
  { provincia: "Lima", distrito: "La Molina" },
  { provincia: "Lima", distrito: "San Luis" },
  { provincia: "Lima", distrito: "Cercado de Lima" },
  { provincia: "Lima", distrito: "Chosica" },
  { provincia: "Lima", distrito: "Chaclacayo" },
  { provincia: "Callao", distrito: "Callao" },
  { provincia: "Callao", distrito: "Bellavista" },
  { provincia: "Callao", distrito: "La Perla" },
  { provincia: "Callao", distrito: "La Punta" },
  { provincia: "Callao", distrito: "Carmen de la Legua" },
  { provincia: "Huaral", distrito: "Huaral" },
  { provincia: "Huaral", distrito: "Chancay" },
  { provincia: "Cañete", distrito: "San Vicente de Cañete" },
  { provincia: "Cañete", distrito: "Asia" },
  { provincia: "Huaura", distrito: "Huacho" },
  { provincia: "Huaura", distrito: "Vegueta" },
];

const EMPTY_FORM = {
  id: null,
  provincia: "",
  distrito: "",
  tarifa: "0",
  minimo: "0",
  activo: true,
};

function normalizeText(v) {
  return String(v || "").trim();
}

export default function ZonasDelivery() {
  const [zones, setZones] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast, showToast } = useToast(2400);

  const districts = useMemo(
    () => [...new Set(ZONE_CATALOG.map((z) => z.distrito))].sort((a, b) => a.localeCompare(b)),
    []
  );

  const provincesByDistrict = useMemo(() => {
    return ZONE_CATALOG
      .filter((z) => z.distrito === form.distrito)
      .map((z) => z.provincia)
      .sort((a, b) => a.localeCompare(b));
  }, [form.distrito]);

  useEffect(() => {
    loadZones();
  }, []);

  async function loadZones() {
    setLoading(true);
    const { data, error } = await supabase
      .from("delivery_zones")
      .select("*")
      .order("distrito", { ascending: true })
      .order("provincia", { ascending: true });

    if (error) {
      console.error("Error cargando delivery_zones:", error);
      showToast("No se pudo cargar zonas", "error");
      setLoading(false);
      return;
    }

    setZones(data || []);
    setLoading(false);
  }

  function resetForm() {
    setForm(EMPTY_FORM);
  }

  function validateForm() {
    const provincia = normalizeText(form.provincia);
    const distrito = normalizeText(form.distrito);
    const tarifa = Number(form.tarifa);
    const minimo = Number(form.minimo);

    if (!distrito || !provincia) {
      showToast("Distrito y provincia son obligatorios", "error");
      return null;
    }

    if (!ZONE_CATALOG.some((z) => z.distrito === distrito && z.provincia === provincia)) {
      showToast("La combinación distrito/provincia no es válida", "error");
      return null;
    }

    if (!Number.isFinite(tarifa) || tarifa < 0) {
      showToast("La tarifa debe ser >= 0", "error");
      return null;
    }

    if (!Number.isFinite(minimo) || minimo < 0) {
      showToast("El mínimo debe ser >= 0", "error");
      return null;
    }

    return {
      provincia,
      distrito,
      tarifa,
      minimo,
      activo: Boolean(form.activo),
    };
  }

  async function onSave() {
    const payload = validateForm();
    if (!payload) return;

    setSaving(true);

    if (form.id) {
      const { error } = await supabase
        .from("delivery_zones")
        .update(payload)
        .eq("id", form.id);

      if (error) {
        console.error("Error actualizando zona:", error);
        showToast(error.code === "23505" ? "Ya existe esa provincia/distrito" : "No se pudo actualizar", "error");
        setSaving(false);
        return;
      }

      showToast("Zona actualizada ✅", "success");
      await loadZones();
      resetForm();
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("delivery_zones").insert(payload);

    if (error) {
      console.error("Error creando zona:", error);
      showToast(error.code === "23505" ? "Ya existe esa provincia/distrito" : "No se pudo crear zona", "error");
      setSaving(false);
      return;
    }

    showToast("Zona creada ✅", "success");
    await loadZones();
    resetForm();
    setSaving(false);
  }

  function onEdit(zone) {
    setForm({
      id: zone.id,
      provincia: zone.provincia || "",
      distrito: zone.distrito || "",
      tarifa: String(zone.tarifa ?? 0),
      minimo: String(zone.minimo ?? 0),
      activo: Boolean(zone.activo),
    });
  }

  async function onDelete(id) {
    if (!confirm("¿Eliminar esta zona de delivery?")) return;
    const { error } = await supabase.from("delivery_zones").delete().eq("id", id);

    if (error) {
      console.error("Error eliminando zona:", error);
      showToast("No se pudo eliminar", "error");
      return;
    }

    showToast("Zona eliminada ✅", "success");
    await loadZones();
    if (form.id === id) resetForm();
  }

  async function onToggleActivo(zone) {
    const { error } = await supabase
      .from("delivery_zones")
      .update({ activo: !zone.activo })
      .eq("id", zone.id);

    if (error) {
      console.error("Error cambiando estado de zona:", error);
      showToast("No se pudo cambiar estado", "error");
      return;
    }

    showToast("Estado actualizado ✅", "success");
    await loadZones();
  }

  if (loading) return <p>Cargando zonas de delivery...</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Toast toast={toast} />
      <h2 style={{ margin: 0 }}>Zonas delivery</h2>

      <div style={cardStyle}>
        <div style={grid2}>
          <label style={fieldWrap}>
            <span>Distrito</span>
            <select
              value={form.distrito}
              onChange={(e) => setForm((p) => ({ ...p, distrito: e.target.value, provincia: "" }))}
              style={inputStyle}
            >
              <option value="">Selecciona distrito</option>
              {districts.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>

          <label style={fieldWrap}>
            <span>Provincia</span>
            <select
              value={form.provincia}
              onChange={(e) => setForm((p) => ({ ...p, provincia: e.target.value }))}
              style={inputStyle}
            >
              <option value="">Selecciona provincia</option>
              {provincesByDistrict.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={grid2}>
          <label style={fieldWrap}>
            <span>Tarifa (S/)</span>
            <input type="number" min="0" step="0.01" value={form.tarifa} onChange={(e) => setForm((p) => ({ ...p, tarifa: e.target.value }))} style={inputStyle} />
          </label>

          <label style={fieldWrap}>
            <span>Mínimo (S/)</span>
            <input type="number" min="0" step="0.01" value={form.minimo} onChange={(e) => setForm((p) => ({ ...p, minimo: e.target.value }))} style={inputStyle} />
          </label>
        </div>

        <label style={switchRow}>
          <span>Zona activa</span>
          <input type="checkbox" checked={Boolean(form.activo)} onChange={(e) => setForm((p) => ({ ...p, activo: e.target.checked }))} />
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={onSave} disabled={saving} style={saveBtn}>{saving ? "Guardando..." : form.id ? "Actualizar zona" : "Crear zona"}</button>
          <button type="button" onClick={resetForm} style={ghostBtn}>Limpiar</button>
        </div>
      </div>

      <div style={cardStyle}>
        <strong>Zonas registradas</strong>
        {zones.length === 0 ? (
          <p style={{ color: "#6b7280" }}>Aún no hay zonas.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Distrito</th>
                  <th style={thStyle}>Provincia</th>
                  <th style={thStyle}>Tarifa</th>
                  <th style={thStyle}>Mínimo</th>
                  <th style={thStyle}>Activo</th>
                  <th style={thStyle}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((zone) => (
                  <tr key={zone.id}>
                    <td style={tdStyle}>{zone.distrito}</td>
                    <td style={tdStyle}>{zone.provincia}</td>
                    <td style={tdStyle}>S/ {Number(zone.tarifa || 0).toFixed(2)}</td>
                    <td style={tdStyle}>S/ {Number(zone.minimo || 0).toFixed(2)}</td>
                    <td style={tdStyle}>{zone.activo ? "Sí" : "No"}</td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" onClick={() => onEdit(zone)} style={smallBtn}>Editar</button>
                        <button type="button" onClick={() => onToggleActivo(zone)} style={smallBtn}>{zone.activo ? "Desactivar" : "Activar"}</button>
                        <button type="button" onClick={() => onDelete(zone.id)} style={dangerBtn}>Eliminar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const cardStyle = { background: "#fff", borderRadius: 12, padding: 16, display: "grid", gap: 12, boxShadow: "0 4px 14px rgba(0,0,0,.06)" };
const grid2 = { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" };
const fieldWrap = { display: "grid", gap: 6, color: "#1f2937", fontSize: 14 };
const switchRow = { display: "flex", justifyContent: "space-between", alignItems: "center" };
const inputStyle = { border: "1px solid #d1d5db", borderRadius: 8, padding: "9px 10px", fontSize: 14 };
const saveBtn = { border: "none", borderRadius: 8, background: "#1f4068", color: "#fff", padding: "10px 12px", cursor: "pointer", fontWeight: 600 };
const ghostBtn = { border: "1px solid #cfd8e3", borderRadius: 8, background: "#fff", color: "#1f4068", padding: "10px 12px", cursor: "pointer" };
const smallBtn = { border: "1px solid #cfd8e3", borderRadius: 7, background: "#fff", color: "#1f4068", padding: "6px 8px", cursor: "pointer", fontSize: 12 };
const dangerBtn = { border: "1px solid #efb0ad", borderRadius: 7, background: "#fff0ef", color: "#b3261e", padding: "6px 8px", cursor: "pointer", fontSize: 12 };
const tableStyle = { width: "100%", borderCollapse: "collapse", minWidth: 740 };
const thStyle = { textAlign: "left", borderBottom: "1px solid #e5e7eb", color: "#6b7280", fontSize: 13, padding: "8px 6px" };
const tdStyle = { borderBottom: "1px solid #f1f5f9", padding: "10px 6px", fontSize: 14 };
