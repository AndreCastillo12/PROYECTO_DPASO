import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Sortable from "sortablejs";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import ConfirmModal from "../components/ConfirmModal";
import LoadingOverlay from "../components/LoadingOverlay";

function normalizeStockValue(value) {
  if (value === "" || value == null) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

export default function Platos() {
  const [platos, setPlatos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [loading, setLoading] = useState(true);

  const { toast, showToast } = useToast(2500);

  const [busy, setBusy] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [platoToDelete, setPlatoToDelete] = useState(null);

  const fileInputRef = useRef(null);
  const listRefs = useRef({});

  const [form, setForm] = useState({
    id: null,
    nombre: "",
    descripcion: "",
    precio: "",
    categoria_id: "",
    imagen: null,
    imagenUrl: "",
    is_available: true,
    track_stock: false,
    stock: 0,
  });

  const resetForm = () => {
    setForm({
      id: null,
      nombre: "",
      descripcion: "",
      precio: "",
      categoria_id: "",
      imagen: null,
      imagenUrl: "",
      is_available: true,
      track_stock: false,
      stock: 0,
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  async function cargarDatos() {
    setLoading(true);

    const { data: platosData, error: platosError } = await supabase
      .from("platos")
      .select("*")
      .order("orden", { ascending: true });

    const { data: categoriasData, error: categoriasError } = await supabase
      .from("categorias")
      .select("*")
      .order("orden", { ascending: true });

    if (platosError) console.error(platosError);
    if (categoriasError) console.error(categoriasError);

    setPlatos(platosData || []);
    setCategorias(categoriasData || []);
    setLoading(false);
  }

  useEffect(() => {
    cargarDatos();
  }, []);

  useEffect(() => {
    if (!categorias.length) return undefined;

    const sortables = categorias
      .map((cat) => {
        const listElement = listRefs.current[cat.id];
        if (!listElement) return null;

        return Sortable.create(listElement, {
          animation: 150,
          onMove: () => !busy,
          onEnd: async () => {
            if (busy) return;

            try {
              setBusy(true);

              const orderedIds = Array.from(listElement.querySelectorAll("[data-plato-id]")).map(
                (node) => node.dataset.platoId
              );

              const updatedPlatos = platos.map((plato) => {
                if (plato.categoria_id !== cat.id) return plato;
                const index = orderedIds.indexOf(plato.id);
                return index === -1 ? plato : { ...plato, orden: index + 1 };
              });

              setPlatos(updatedPlatos);

              for (let i = 0; i < orderedIds.length; i++) {
                const { error } = await supabase.from("platos").update({ orden: i + 1 }).eq("id", orderedIds[i]);

                if (error) throw error;
              }

              showToast("Orden de platos actualizado ✅");
            } catch (err) {
              console.error(err);
              showToast(err.message || "Error actualizando orden", "error");
              cargarDatos();
            } finally {
              setBusy(false);
            }
          },
        });
      })
      .filter(Boolean);

    return () => {
      sortables.forEach((sortable) => sortable?.destroy());
    };
  }, [categorias, platos, busy]);

  function abrirEditar(p) {
    setForm({
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion || "",
      precio: p.precio,
      categoria_id: p.categoria_id,
      imagen: null,
      imagenUrl: p.imagen ? supabase.storage.from("platos").getPublicUrl(p.imagen).data.publicUrl : "",
      is_available: p.is_available ?? true,
      track_stock: p.track_stock ?? false,
      stock: p.stock ?? 0,
    });

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function cancelarCambios() {
    if (busy) return;
    resetForm();
    showToast("Formulario limpio ✅");
  }

  async function guardarPlato() {
    if (busy) return;
    if (!form.nombre || !form.precio || !form.categoria_id) {
      return showToast("Completa todos los campos", "error");
    }

    try {
      setBusy(true);

      let imagenNombre = null;

      if (form.imagen) {
        imagenNombre = `${Date.now()}-${form.imagen.name}`;
        const { error: uploadError } = await supabase.storage.from("platos").upload(imagenNombre, form.imagen);

        if (uploadError) throw uploadError;
      }

      const normalizedStock = form.track_stock ? normalizeStockValue(form.stock) : null;

      if (form.id) {
        const payload = {
          nombre: form.nombre,
          descripcion: form.descripcion,
          precio: Number(form.precio),
          categoria_id: form.categoria_id,
          is_available: Boolean(form.is_available),
          track_stock: Boolean(form.track_stock),
          stock: normalizedStock,
          ...(imagenNombre && { imagen: imagenNombre }),
        };

        const { error } = await supabase.from("platos").update(payload).eq("id", form.id);

        if (error) throw error;

        setPlatos((prev) => prev.map((p) => (p.id === form.id ? { ...p, ...payload, imagen: imagenNombre || p.imagen } : p)));

        showToast("Actualizado ✅");
      } else {
        const insertPayload = {
          nombre: form.nombre,
          descripcion: form.descripcion,
          precio: Number(form.precio),
          categoria_id: form.categoria_id,
          imagen: imagenNombre,
          is_available: Boolean(form.is_available),
          track_stock: Boolean(form.track_stock),
          stock: normalizedStock,
        };

        const { data, error } = await supabase.from("platos").insert([insertPayload]).select();

        if (error) throw error;

        setPlatos((prev) => [...prev, ...(data || [])]);
        showToast("Plato agregado con éxito ✅");
      }

      resetForm();
    } catch (err) {
      console.error(err);
      showToast("Error al guardar ❌", "error");
    } finally {
      setBusy(false);
    }
  }

  async function actualizarInventarioRapido(platoId, changes) {
    if (busy) return;

    const target = platos.find((p) => p.id === platoId);
    if (!target) return;

    const payload = {
      is_available: changes.is_available ?? target.is_available ?? true,
      track_stock: changes.track_stock ?? target.track_stock ?? false,
      stock:
        changes.track_stock === false
          ? null
          : normalizeStockValue(changes.stock ?? target.stock),
    };

    try {
      setBusy(true);
      const { error } = await supabase.from("platos").update(payload).eq("id", platoId);
      if (error) throw error;

      setPlatos((prev) => prev.map((item) => (item.id === platoId ? { ...item, ...payload } : item)));
      showToast("Actualizado ✅");
    } catch (err) {
      console.error(err);
      showToast("Error al guardar ❌", "error");
    } finally {
      setBusy(false);
    }
  }

  function pedirEliminarPlato(p) {
    if (busy) return;
    setPlatoToDelete(p);
    setConfirmOpen(true);
  }

  async function confirmarEliminar() {
    if (!platoToDelete) return;

    try {
      setBusy(true);

      const { error } = await supabase.from("platos").delete().eq("id", platoToDelete.id);
      if (error) throw error;

      if (platoToDelete.imagen) {
        const { error: storageError } = await supabase.storage.from("platos").remove([platoToDelete.imagen]);
        if (storageError) console.warn("No se pudo borrar imagen:", storageError.message);
      }

      setPlatos((prev) => prev.filter((x) => x.id !== platoToDelete.id));
      showToast("Plato eliminado 🗑️");
    } catch (err) {
      console.error(err);
      showToast(err.message || "Error eliminando plato", "error");
    } finally {
      setBusy(false);
      setConfirmOpen(false);
      setPlatoToDelete(null);
    }
  }

  if (loading) return <p>Cargando...</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <Toast toast={toast} />
      <LoadingOverlay open={busy} text="Procesando..." />

      <ConfirmModal
        open={confirmOpen}
        title="Eliminar plato"
        message={`¿Seguro que deseas eliminar "${platoToDelete?.nombre || ""}"? Esta acción no se puede deshacer.`}
        confirmText="Sí, eliminar"
        cancelText="Cancelar"
        onConfirm={confirmarEliminar}
        onCancel={() => {
          setConfirmOpen(false);
          setPlatoToDelete(null);
        }}
        danger
      />

      <h2>Gestión de Platos</h2>

      <div style={formCard}>
        <input
          type="text"
          placeholder="Nombre"
          value={form.nombre}
          onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          style={inputStyle}
          disabled={busy}
        />

        <input
          type="text"
          placeholder="Descripción"
          value={form.descripcion}
          onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
          style={inputStyle}
          disabled={busy}
        />

        <input
          type="number"
          placeholder="Precio"
          value={form.precio}
          onChange={(e) => setForm({ ...form, precio: e.target.value })}
          style={{ ...inputStyle, maxWidth: "180px" }}
          disabled={busy}
        />

        <select
          value={form.categoria_id}
          onChange={(e) => setForm({ ...form, categoria_id: e.target.value })}
          style={inputStyle}
          disabled={busy}
        >
          <option value="">Selecciona categoría</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>

        <label style={checkboxRow}>
          <input
            type="checkbox"
            checked={form.is_available}
            onChange={(e) => setForm({ ...form, is_available: e.target.checked })}
            disabled={busy}
          />
          Disponible
        </label>

        <label style={checkboxRow}>
          <input
            type="checkbox"
            checked={form.track_stock}
            onChange={(e) =>
              setForm({
                ...form,
                track_stock: e.target.checked,
                stock: e.target.checked ? normalizeStockValue(form.stock) : 0,
              })
            }
            disabled={busy}
          />
          Controlar stock
        </label>

        {form.track_stock && (
          <input
            type="number"
            min="0"
            placeholder="Stock"
            value={form.stock}
            onChange={(e) => setForm({ ...form, stock: e.target.value })}
            style={{ ...inputStyle, maxWidth: "180px" }}
            disabled={busy}
          />
        )}

        <input
          ref={fileInputRef}
          type="file"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setForm({ ...form, imagen: file, imagenUrl: URL.createObjectURL(file) });
          }}
        />

        {form.imagenUrl && <img src={form.imagenUrl} alt="Preview" style={previewImg} />}

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button onClick={guardarPlato} style={btnGreen} disabled={busy}>
            {busy ? "Procesando..." : form.id ? "Guardar Cambios" : "Agregar"}
          </button>

          <button onClick={cancelarCambios} style={btnGray} disabled={busy}>
            Cancelar
          </button>
        </div>
      </div>

      {categorias.map((cat) => (
        <div key={cat.id} style={{ marginBottom: "30px" }}>
          <h3 style={{ marginBottom: "10px" }}>{cat.nombre}</h3>

          <div
            ref={(el) => {
              if (el) listRefs.current[cat.id] = el;
            }}
            data-categoria-id={cat.id}
            style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}
          >
            {platos
              .filter((p) => p.categoria_id === cat.id)
              .map((p) => (
                <div key={p.id} data-plato-id={p.id} className="card" style={cardStyle}>
                  {p.imagen && (
                    <img src={supabase.storage.from("platos").getPublicUrl(p.imagen).data.publicUrl} alt={p.nombre} style={cardImgStyle} />
                  )}

                  <h4 style={{ margin: "6px 0" }}>{p.nombre}</h4>
                  <p style={{ margin: "4px 0" }}>{p.descripcion}</p>
                  <p style={{ fontWeight: "bold", marginTop: "4px" }}>S/ {Number(p.precio).toFixed(2)}</p>

                  <p style={{ margin: "4px 0", fontWeight: 600 }}>
                    {p.is_available ? "Disponible" : "No disponible"}
                  </p>
                  <p style={{ margin: "4px 0", color: "#475467" }}>
                    {p.track_stock ? `Stock: ${p.stock ?? 0}` : "Stock: ∞ (Ilimitado)"}
                  </p>

                  <div style={quickInventoryRow}>
                    <label style={checkboxSmall}>
                      <input
                        type="checkbox"
                        checked={p.is_available ?? true}
                        disabled={busy}
                        onChange={(e) =>
                          actualizarInventarioRapido(p.id, {
                            is_available: e.target.checked,
                          })
                        }
                      />
                      Disponible
                    </label>

                    <label style={checkboxSmall}>
                      <input
                        type="checkbox"
                        checked={p.track_stock ?? false}
                        disabled={busy}
                        onChange={(e) =>
                          actualizarInventarioRapido(p.id, {
                            track_stock: e.target.checked,
                            stock: e.target.checked ? p.stock ?? 0 : null,
                          })
                        }
                      />
                      Controlar stock
                    </label>

                    {p.track_stock && (
                      <input
                        type="number"
                        min="0"
                        value={p.stock ?? 0}
                        disabled={busy}
                        style={{ ...inputStyle, padding: "8px", fontSize: "0.85rem" }}
                        onChange={(e) =>
                          setPlatos((prev) =>
                            prev.map((item) =>
                              item.id === p.id ? { ...item, stock: normalizeStockValue(e.target.value) } : item
                            )
                          )
                        }
                        onBlur={() =>
                          actualizarInventarioRapido(p.id, {
                            stock: p.stock ?? 0,
                            track_stock: true,
                          })
                        }
                      />
                    )}
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px" }}>
                    <button onClick={() => abrirEditar(p)} style={{ ...btnSmall, backgroundColor: "#f0ad4e" }} disabled={busy}>
                      Editar
                    </button>

                    <button onClick={() => pedirEliminarPlato(p)} style={{ ...btnSmall, backgroundColor: "#d9534f" }} disabled={busy}>
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const formCard = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  padding: "35px",
  borderRadius: "12px",
  backgroundColor: "#fff",
  boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
  maxWidth: "700px",
  width: "100%",
};

const inputStyle = {
  padding: "10px",
  borderRadius: "6px",
  border: "1px solid #ccc",
  width: "100%",
};

const checkboxRow = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontWeight: 600,
};

const checkboxSmall = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  fontSize: "0.85rem",
};

const previewImg = {
  width: "200px",
  borderRadius: "6px",
  objectFit: "cover",
};

const btnGreen = {
  backgroundColor: "#178d42",
  color: "#fff",
  border: "none",
  padding: "10px 14px",
  borderRadius: "6px",
  cursor: "pointer",
  fontWeight: 600,
};

const btnGray = {
  backgroundColor: "#6c757d",
  color: "#fff",
  border: "none",
  padding: "10px 14px",
  borderRadius: "6px",
  cursor: "pointer",
  fontWeight: 600,
};

const btnSmall = {
  color: "#fff",
  border: "none",
  padding: "6px 10px",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "0.9rem",
  fontWeight: 600,
};

const cardStyle = {
  borderRadius: "10px",
  boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
  padding: "12px",
  width: "260px",
  backgroundColor: "#fff",
  display: "flex",
  flexDirection: "column",
  cursor: "grab",
};

const cardImgStyle = {
  width: "100%",
  height: "140px",
  objectFit: "cover",
  borderRadius: "6px",
  marginBottom: "8px",
};

const quickInventoryRow = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  marginTop: "8px",
};
