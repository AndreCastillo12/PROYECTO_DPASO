import { useEffect, useRef, useState } from "react";
import { FiEdit2, FiPlus, FiTrash2 } from "react-icons/fi";
import { supabase } from "../lib/supabaseClient";
import Sortable from "sortablejs";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import ConfirmModal from "../components/ConfirmModal";
import LoadingOverlay from "../components/LoadingOverlay";
import "../styles/platos-sedap.css";

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
  const editorCardRef = useRef(null);
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

    editorCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    <div className="platos-sedap-page">
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

      <section className="platos-sedap-toolbar">
        <div>
          <h3>Gestión de platos</h3>
          <p>Edición, eliminación, alta y control de stock.</p>
        </div>
        <button type="button" className="btn-green" onClick={guardarPlato} disabled={busy}>
          <FiPlus size={15} /> {form.id ? "Guardar cambios" : "Nuevo menú"}
        </button>
      </section>

      <section className="platos-editor-card" ref={editorCardRef}>
        <h4>{form.id ? "Editar plato" : "Crear plato"}</h4>
        <div className="platos-editor-grid">
          <input type="text" placeholder="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} disabled={busy} />
          <input type="number" placeholder="Precio" value={form.precio} onChange={(e) => setForm({ ...form, precio: e.target.value })} disabled={busy} />
          <select value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: e.target.value })} disabled={busy}>
            <option value="">Selecciona categoría</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <input type="text" placeholder="Descripción" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} disabled={busy} />
          <label className="check-row"><input type="checkbox" checked={form.is_available} onChange={(e) => setForm({ ...form, is_available: e.target.checked })} disabled={busy} /> Disponible</label>
          <label className="check-row"><input type="checkbox" checked={form.track_stock} onChange={(e) => setForm({ ...form, track_stock: e.target.checked, stock: e.target.checked ? normalizeStockValue(form.stock) : 0 })} disabled={busy} /> Controlar stock</label>
          {form.track_stock ? <input type="number" min="0" placeholder="Stock" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} disabled={busy} /> : null}
          <input ref={fileInputRef} type="file" disabled={busy} onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setForm({ ...form, imagen: file, imagenUrl: URL.createObjectURL(file) });
          }} />
          {form.imagenUrl ? <img src={form.imagenUrl} alt="Preview" className="img-preview" /> : null}
        </div>
        <div className="editor-actions">
          <button type="button" className="btn-green" onClick={guardarPlato} disabled={busy}>{busy ? "Procesando..." : form.id ? "Guardar cambios" : "Agregar"}</button>
          <button type="button" className="btn-gray" onClick={cancelarCambios} disabled={busy}>Cancelar</button>
        </div>
      </section>

      {categorias.map((cat) => (
        <section key={cat.id} className="platos-category-block">
          <div className="category-head">
            <h4>{cat.nombre}</h4>
            <small>Arrastra para reordenar</small>
          </div>

          <div
            ref={(el) => {
              if (el) listRefs.current[cat.id] = el;
            }}
            data-categoria-id={cat.id}
            className="platos-grid-sedap"
          >
            {platos
              .filter((p) => p.categoria_id === cat.id)
              .map((p) => (
                <article key={p.id} data-plato-id={p.id} className="plato-card-sedap">
                  {p.imagen ? <img src={supabase.storage.from("platos").getPublicUrl(p.imagen).data.publicUrl} alt={p.nombre} className="plato-cover" /> : <div className="plato-cover placeholder">Sin imagen</div>}
                  <h5>{p.nombre}</h5>
                  <p className="description">{p.descripcion || "Sin descripción"}</p>
                  <p className="price">S/ {Number(p.precio).toFixed(2)}</p>
                  <div className="status-row">
                    <span className={`badge ${p.is_available ? "ok" : "off"}`}>{p.is_available ? "Disponible" : "No disponible"}</span>
                    <span className="badge neutral">{p.track_stock ? `Stock ${p.stock ?? 0}` : "Stock ilimitado"}</span>
                  </div>

                  <div className="quick-stock">
                    <label><input type="checkbox" checked={p.is_available ?? true} disabled={busy} onChange={(e) => actualizarInventarioRapido(p.id, { is_available: e.target.checked })} /> Disponible</label>
                    <label><input type="checkbox" checked={p.track_stock ?? false} disabled={busy} onChange={(e) => actualizarInventarioRapido(p.id, { track_stock: e.target.checked, stock: e.target.checked ? p.stock ?? 0 : null })} /> Controlar stock</label>
                    {p.track_stock ? (
                      <input
                        type="number"
                        min="0"
                        value={p.stock ?? 0}
                        disabled={busy}
                        onChange={(e) =>
                          setPlatos((prev) =>
                            prev.map((item) => (item.id === p.id ? { ...item, stock: normalizeStockValue(e.target.value) } : item))
                          )
                        }
                        onBlur={() => actualizarInventarioRapido(p.id, { stock: p.stock ?? 0, track_stock: true })}
                      />
                    ) : null}
                  </div>

                  <div className="card-actions">
                    <button type="button" onClick={() => abrirEditar(p)} disabled={busy}><FiEdit2 size={14} /> Editar</button>
                    <button type="button" onClick={() => pedirEliminarPlato(p)} disabled={busy}><FiTrash2 size={14} /> Eliminar</button>
                  </div>
                </article>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
