import { useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import Sortable from "sortablejs";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import ConfirmModal from "../components/ConfirmModal";
import LoadingOverlay from "../components/LoadingOverlay";

export default function Categorias() {
  const [categorias, setCategorias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ id: null, nombre: "", descripcion: "" });
  const listRef = useRef(null);

  const { toast, showToast } = useToast(2500);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [categoriaToDelete, setCategoriaToDelete] = useState(null);

  async function cargarCategorias() {
    setLoading(true);
    const { data, error } = await supabase
      .from("categorias")
      .select("*")
      .order("orden", { ascending: true });

    if (error) {
      console.error(error);
      showToast("Error cargando categorías", "error");
    } else {
      setCategorias(data || []);
    }
    setLoading(false);
  }

  function abrirAgregar() {
    setForm({ id: null, nombre: "", descripcion: "" });
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

        setCategorias(prev =>
          prev.map(c =>
            c.id === form.id ? { ...c, nombre: form.nombre, descripcion: form.descripcion } : c
          )
        );
        setForm({ id: null, nombre: "", descripcion: "" });
        showToast("Categoría actualizada con éxito ✅");
      } else {
        const { data, error } = await supabase
          .from("categorias")
          .insert([{ nombre: form.nombre, descripcion: form.descripcion }])
          .select();

        if (error) throw error;

        setCategorias(prev => [...prev, ...(data || [])]);
        setForm({ id: null, nombre: "", descripcion: "" });
        showToast("Categoría agregada con éxito ✅");
      }
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
      const { error } = await supabase
        .from("categorias")
        .delete()
        .eq("id", categoriaToDelete.id);

      if (error) throw error;

      setCategorias(prev => prev.filter(c => c.id !== categoriaToDelete.id));
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
      onEnd: async evt => {
        try {
          setBusy(true);

          const movedItem = categorias[evt.oldIndex];
          const newCategorias = [...categorias];
          newCategorias.splice(evt.oldIndex, 1);
          newCategorias.splice(evt.newIndex, 0, movedItem);

          setCategorias(newCategorias);

          for (let i = 0; i < newCategorias.length; i++) {
            const { error } = await supabase
              .from("categorias")
              .update({ orden: i + 1 })
              .eq("id", newCategorias[i].id);

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
      }
    });

    return () => sortable?.destroy();
  }, [categorias]);

  return (
    <div>
      <Toast toast={toast} />
      <LoadingOverlay open={busy} text="Aplicando cambios..." />

      <ConfirmModal
        open={confirmOpen}
        title="Eliminar categoría"
        message={`¿Seguro que deseas eliminar "${categoriaToDelete?.nombre || ""}"?`}
        confirmText="Sí, eliminar"
        cancelText="Cancelar"
        onConfirm={confirmarEliminar}
        onCancel={() => { setConfirmOpen(false); setCategoriaToDelete(null); }}
        danger
      />

      <h2>Gestión de Categorías</h2>

      <div
        className="card-form"
        style={{
          marginBottom: "20px",
          padding: "16px",
          borderRadius: "8px",
          backgroundColor: "#fff",
          boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
          display: "flex",
          flexWrap: "wrap",
          gap: "10px",
          alignItems: "center"
        }}
      >
        <input
          type="text"
          placeholder="Nombre"
          value={form.nombre}
          onChange={e => setForm({ ...form, nombre: e.target.value })}
          style={inputStyle}
        />
        <input
          type="text"
          placeholder="Descripción"
          value={form.descripcion}
          onChange={e => setForm({ ...form, descripcion: e.target.value })}
          style={inputStyle}
        />

        <button onClick={guardarCategoria} style={btnGreen}>
          {form.id ? "Guardar Cambios" : "Agregar"}
        </button>

        {form.id && (
          <button onClick={abrirAgregar} style={btnGray}>
            Cancelar
          </button>
        )}
      </div>

      {loading ? (
        <p>Cargando...</p>
      ) : (
        <div ref={listRef} style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
          {categorias.map(cat => (
            <div
              key={cat.id}
              className="card"
              style={{
                borderRadius: "10px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                padding: "14px",
                width: "220px",
                backgroundColor: "#fff",
                position: "relative"
              }}
            >
              <h3 style={{ margin: "0 0 6px 0" }}>{cat.nombre}</h3>
              <p style={{ margin: "0 0 10px 0" }}>{cat.descripcion}</p>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "12px" }}>
                <button onClick={() => abrirEditar(cat)} style={btnOrange}>
                  Editar
                </button>
                <button onClick={() => pedirEliminarCategoria(cat)} style={btnRed}>
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================== STYLES ================== */
const inputStyle = {
  padding: "8px",
  borderRadius: "6px",
  border: "1px solid #ccc",
  minWidth: "220px",
  flex: "1"
};

const btnGreen = {
  backgroundColor: "#178d42",
  color: "#fff",
  border: "none",
  padding: "8px 14px",
  borderRadius: "6px",
  cursor: "pointer",
  fontWeight: 600
};

const btnGray = {
  backgroundColor: "#6c757d",
  color: "#fff",
  border: "none",
  padding: "8px 14px",
  borderRadius: "6px",
  cursor: "pointer",
  fontWeight: 600
};

const btnOrange = {
  backgroundColor: "#f0ad4e",
  color: "#fff",
  border: "none",
  padding: "6px 12px",
  borderRadius: "6px",
  cursor: "pointer",
  fontWeight: 600
};

const btnRed = {
  backgroundColor: "#d9534f",
  color: "#fff",
  border: "none",
  padding: "6px 12px",
  borderRadius: "6px",
  cursor: "pointer",
  fontWeight: 600
};
