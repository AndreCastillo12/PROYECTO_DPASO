import { useEffect, useRef, useState } from "react";
import Sortable from "sortablejs";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import ConfirmModal from "../components/ConfirmModal";
import LoadingOverlay from "../components/LoadingOverlay";
import "../styles/categorias-sedap.css";

export default function Categorias() {
  const [categorias, setCategorias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ id: null, nombre: "", descripcion: "" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [categoriaToDelete, setCategoriaToDelete] = useState(null);

  const listRef = useRef(null);
  const { toast, showToast } = useToast(2500);

  async function cargarCategorias() {
    setLoading(true);
    const { data, error } = await supabase.from("categorias").select("*").order("orden", { ascending: true });

    if (error) {
      console.error(error);
      showToast("Error cargando categorías", "error");
    } else {
      setCategorias(data || []);
    }

    setLoading(false);
  }

  function abrirEditar(cat) {
    setForm({ id: cat.id, nombre: cat.nombre, descripcion: cat.descripcion || "" });
  }

  async function guardarCategoria() {
    if (!form.nombre.trim()) return showToast("Debes colocar un nombre", "error");

    try {
      setBusy(true);

      if (form.id) {
        const { error } = await supabase
          .from("categorias")
          .update({ nombre: form.nombre, descripcion: form.descripcion })
          .eq("id", form.id);

        if (error) throw error;

        setCategorias((prev) => prev.map((c) => (c.id === form.id ? { ...c, nombre: form.nombre, descripcion: form.descripcion } : c)));
        showToast("Categoría actualizada con éxito ✅");
      } else {
        const { data, error } = await supabase.from("categorias").insert([{ nombre: form.nombre, descripcion: form.descripcion }]).select();
        if (error) throw error;

        setCategorias((prev) => [...prev, ...(data || [])]);
        showToast("Categoría agregada con éxito ✅");
      }

      setForm({ id: null, nombre: "", descripcion: "" });
    } catch (err) {
      console.error(err);
      showToast(err.message || "Error guardando categoría", "error");
    } finally {
      setBusy(false);
    }
  }

  function pedirEliminarCategoria(cat) {
    setCategoriaToDelete(cat);
    setConfirmOpen(true);
  }

  async function confirmarEliminar() {
    if (!categoriaToDelete) return;

    try {
      setBusy(true);
      const { error } = await supabase.from("categorias").delete().eq("id", categoriaToDelete.id);
      if (error) throw error;

      setCategorias((prev) => prev.filter((c) => c.id !== categoriaToDelete.id));
      showToast("Categoría eliminada 🗑️");
    } catch (err) {
      console.error(err);
      showToast(err.message || "Error eliminando categoría", "error");
    } finally {
      setBusy(false);
      setConfirmOpen(false);
      setCategoriaToDelete(null);
    }
  }

  useEffect(() => {
    cargarCategorias();
  }, []);

  useEffect(() => {
    if (!listRef.current) return;

    const sortable = Sortable.create(listRef.current, {
      animation: 150,
      onEnd: async (evt) => {
        try {
          setBusy(true);

          const movedItem = categorias[evt.oldIndex];
          const next = [...categorias];
          next.splice(evt.oldIndex, 1);
          next.splice(evt.newIndex, 0, movedItem);

          setCategorias(next);

          for (let i = 0; i < next.length; i += 1) {
            const { error } = await supabase.from("categorias").update({ orden: i + 1 }).eq("id", next[i].id);
            if (error) throw error;
          }

          showToast("Orden actualizado ✅");
        } catch (err) {
          console.error(err);
          showToast(err.message || "Error actualizando orden", "error");
          cargarCategorias();
        } finally {
          setBusy(false);
        }
      },
    });

    return () => sortable?.destroy();
  }, [categorias, showToast]);

  if (loading) return <p>Cargando categorías...</p>;

  return (
    <div className="categorias-page">
      <Toast toast={toast} />
      <LoadingOverlay open={busy} text="Aplicando cambios..." />

      <ConfirmModal
        open={confirmOpen}
        title="Eliminar categoría"
        message={`¿Seguro que deseas eliminar "${categoriaToDelete?.nombre || ""}"?`}
        confirmText="Sí, eliminar"
        cancelText="Cancelar"
        onConfirm={confirmarEliminar}
        onCancel={() => {
          setConfirmOpen(false);
          setCategoriaToDelete(null);
        }}
        danger
      />

      <section className="categorias-toolbar">
        <h3>Gestión de categorías</h3>
        <p>Organiza las categorías con una vista limpia y ordenable.</p>
      </section>

      <section className="categorias-form-card">
        <input type="text" placeholder="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        <input type="text" placeholder="Descripción" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
        <button type="button" className="btn-save" onClick={guardarCategoria} disabled={busy}>{form.id ? "Guardar" : "Agregar"}</button>
      </section>

      <section className="categorias-grid" ref={listRef}>
        {categorias.map((cat) => (
          <article key={cat.id} className="categoria-card">
            <h4>{cat.nombre}</h4>
            <p>{cat.descripcion || "Sin descripción"}</p>
            <div className="categoria-actions">
              <button type="button" onClick={() => abrirEditar(cat)}>Editar</button>
              <button type="button" className="danger" onClick={() => pedirEliminarCategoria(cat)}>Eliminar</button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
