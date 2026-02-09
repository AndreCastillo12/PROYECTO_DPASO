import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Toast from "../components/Toast";
import useToast from "../hooks/useToast";
import ConfirmModal from "../components/ConfirmModal";
import LoadingOverlay from "../components/LoadingOverlay";

export default function Platos() {
  const [platos, setPlatos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [loading, setLoading] = useState(true);

  const { toast, showToast } = useToast(2500);

  const [busy, setBusy] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [platoToDelete, setPlatoToDelete] = useState(null);

  const fileInputRef = useRef(null);

  const [form, setForm] = useState({
    id: null,
    nombre: "",
    descripcion: "",
    precio: "",
    categoria_id: "",
    imagen: null,
    imagenUrl: ""
  });

  const resetForm = () => {
    setForm({
      id: null,
      nombre: "",
      descripcion: "",
      precio: "",
      categoria_id: "",
      imagen: null,
      imagenUrl: ""
    });

    // 🔥 Esto es lo que quita el "nombre del archivo" del input file
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

  function abrirEditar(p) {
    setForm({
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion || "",
      precio: p.precio,
      categoria_id: p.categoria_id,
      imagen: null,
      imagenUrl: p.imagen
        ? supabase.storage.from("platos").getPublicUrl(p.imagen).data.publicUrl
        : ""
    });

    // si vienes de haber seleccionado algo antes, resetea el file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function cancelarCambios() {
    if (busy) return; // si está guardando, no permitir
    resetForm();
    showToast("Formulario limpio ✅");
  }

  async function guardarPlato() {
    if (busy) return; // evita doble click
    if (!form.nombre || !form.precio || !form.categoria_id) {
      return showToast("Completa todos los campos", "error");
    }

    try {
      setBusy(true);

      let imagenNombre = null;

      // Subir imagen si viene una nueva
      if (form.imagen) {
        imagenNombre = `${Date.now()}-${form.imagen.name}`;
        const { error: uploadError } = await supabase
          .storage
          .from("platos")
          .upload(imagenNombre, form.imagen);

        if (uploadError) throw uploadError;
      }

      if (form.id) {
        const payload = {
          nombre: form.nombre,
          descripcion: form.descripcion,
          precio: Number(form.precio),
          categoria_id: form.categoria_id,
          ...(imagenNombre && { imagen: imagenNombre })
        };

        const { error } = await supabase
          .from("platos")
          .update(payload)
          .eq("id", form.id);

        if (error) throw error;

        setPlatos(prev =>
          prev.map(p =>
            p.id === form.id
              ? { ...p, ...payload, imagen: imagenNombre || p.imagen }
              : p
          )
        );

        showToast("Plato actualizado con éxito ✅");
      } else {
        const insertPayload = {
          nombre: form.nombre,
          descripcion: form.descripcion,
          precio: Number(form.precio),
          categoria_id: form.categoria_id,
          imagen: imagenNombre
        };

        const { data, error } = await supabase
          .from("platos")
          .insert([insertPayload])
          .select();

        if (error) throw error;

        setPlatos(prev => [...prev, ...(data || [])]);
        showToast("Plato agregado con éxito ✅");
      }

      // ✅ Limpia TODO al final
      resetForm();
    } catch (err) {
      console.error(err);
      showToast(err.message || "Error guardando plato", "error");
    } finally {
      setBusy(false);
    }
  }

  function pedirEliminarPlato(p) {
    if (busy) return;
    setPlatoToDelete(p);
    setConfirmOpen(true);
  }

  // ✅ BONUS: también eliminar imagen del Storage si existe
  async function confirmarEliminar() {
    if (!platoToDelete) return;

    try {
      setBusy(true);

      // 1) borrar registro
      const { error } = await supabase.from("platos").delete().eq("id", platoToDelete.id);
      if (error) throw error;

      // 2) borrar imagen del storage (si tiene)
      if (platoToDelete.imagen) {
        const { error: storageError } = await supabase.storage
          .from("platos")
          .remove([platoToDelete.imagen]);

        // si falla, no detengas todo; solo log
        if (storageError) console.warn("No se pudo borrar imagen:", storageError.message);
      }

      setPlatos(prev => prev.filter(x => x.id !== platoToDelete.id));
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
        onCancel={() => { setConfirmOpen(false); setPlatoToDelete(null); }}
        danger
      />

      <h2>Gestión de Platos</h2>

      {/* Formulario */}
      <div style={formCard}>
        <input
          type="text"
          placeholder="Nombre"
          value={form.nombre}
          onChange={e => setForm({ ...form, nombre: e.target.value })}
          style={inputStyle}
          disabled={busy}
        />

        <input
          type="text"
          placeholder="Descripción"
          value={form.descripcion}
          onChange={e => setForm({ ...form, descripcion: e.target.value })}
          style={inputStyle}
          disabled={busy}
        />

        <input
          type="number"
          placeholder="Precio"
          value={form.precio}
          onChange={e => setForm({ ...form, precio: e.target.value })}
          style={{ ...inputStyle, maxWidth: "180px" }}
          disabled={busy}
        />

        <select
          value={form.categoria_id}
          onChange={e => setForm({ ...form, categoria_id: e.target.value })}
          style={inputStyle}
          disabled={busy}
        >
          <option value="">Selecciona categoría</option>
          {categorias.map(c => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>

        <input
          ref={fileInputRef}
          type="file"
          disabled={busy}
          onChange={e => {
            const file = e.target.files?.[0];
            if (!file) return;
            setForm({ ...form, imagen: file, imagenUrl: URL.createObjectURL(file) });
          }}
        />

        {form.imagenUrl && (
          <img
            src={form.imagenUrl}
            alt="Preview"
            style={previewImg}
          />
        )}

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button onClick={guardarPlato} style={btnGreen} disabled={busy}>
            {busy ? "Procesando..." : (form.id ? "Guardar Cambios" : "Agregar")}
          </button>

          <button onClick={cancelarCambios} style={btnGray} disabled={busy}>
            Cancelar
          </button>
        </div>
      </div>

      {/* Platos agrupados por categoría */}
      {categorias.map(cat => (
        <div key={cat.id} style={{ marginBottom: "30px" }}>
          <h3 style={{ marginBottom: "10px" }}>{cat.nombre}</h3>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
            {platos.filter(p => p.categoria_id === cat.id).map(p => (
              <div key={p.id} className="card" style={cardStyle}>
                {p.imagen && (
                  <img
                    src={supabase.storage.from("platos").getPublicUrl(p.imagen).data.publicUrl}
                    alt={p.nombre}
                    style={cardImgStyle}
                  />
                )}

                <h4 style={{ margin: "6px 0" }}>{p.nombre}</h4>
                <p style={{ margin: "4px 0" }}>{p.descripcion}</p>
                <p style={{ fontWeight: "bold", marginTop: "4px" }}>
                  S/ {Number(p.precio).toFixed(2)}
                </p>

                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px" }}>
                  <button
                    onClick={() => abrirEditar(p)}
                    style={{ ...btnSmall, backgroundColor: "#f0ad4e" }}
                    disabled={busy}
                  >
                    Editar
                  </button>

                  <button
                    onClick={() => pedirEliminarPlato(p)}
                    style={{ ...btnSmall, backgroundColor: "#d9534f" }}
                    disabled={busy}
                  >
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

/* ================== STYLES ================== */
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
  width: "100%"
};

const previewImg = {
  width: "200px",
  borderRadius: "6px",
  objectFit: "cover"
};

const btnGreen = {
  backgroundColor: "#178d42",
  color: "#fff",
  border: "none",
  padding: "10px 14px",
  borderRadius: "6px",
  cursor: "pointer",
  fontWeight: 600
};

const btnGray = {
  backgroundColor: "#6c757d",
  color: "#fff",
  border: "none",
  padding: "10px 14px",
  borderRadius: "6px",
  cursor: "pointer",
  fontWeight: 600
};

const btnSmall = {
  color: "#fff",
  border: "none",
  padding: "6px 10px",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "0.9rem",
  fontWeight: 600
};

const cardStyle = {
  borderRadius: "10px",
  boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
  padding: "12px",
  width: "220px",
  backgroundColor: "#fff",
  display: "flex",
  flexDirection: "column"
};

const cardImgStyle = {
  width: "100%",
  height: "140px",
  objectFit: "cover",
  borderRadius: "6px",
  marginBottom: "8px"
};
