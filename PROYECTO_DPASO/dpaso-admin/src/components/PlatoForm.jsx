import { useEffect, useState } from "react"
import { supabase } from "../lib/supabaseClient"

export default function PlatoForm({ platoEdit, onFinish }) {
  const [form, setForm] = useState({
    nombre: "",
    descripcion: "",
    precio: "",
    categoria: "picar",
    orden: 1
  })

  useEffect(() => {
    if (platoEdit) setForm(platoEdit)
  }, [platoEdit])

  const handleChange = e => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const guardar = async () => {
    if (!form.nombre || !form.precio) {
      alert("Nombre y precio son obligatorios")
      return
    }

    if (platoEdit) {
      await supabase.from("platos").update(form).eq("id", platoEdit.id)
    } else {
      await supabase.from("platos").insert([form])
    }

    setForm({
      nombre: "",
      descripcion: "",
      precio: "",
      categoria: "picar",
      orden: 1
    })

    onFinish()
  }

  return (
    <div>
      <h2>{platoEdit ? "Editar Plato" : "Nuevo Plato"}</h2>

      <input name="nombre" placeholder="Nombre" value={form.nombre} onChange={handleChange} />
      <br />

      <textarea name="descripcion" placeholder="Descripción" value={form.descripcion} onChange={handleChange} />
      <br />

      <input name="precio" type="number" placeholder="Precio" value={form.precio} onChange={handleChange} />
      <br />

      <select name="categoria" value={form.categoria} onChange={handleChange}>
        <option value="picar">Pa’ Picar</option>
        <option value="comer">Pa’ Comer</option>
        <option value="combos">Combos</option>
        <option value="calientes">Calientes</option>
        <option value="bebidas">Bebidas</option>
        <option value="extras">Extras</option>
      </select>
      <br />

      <input name="orden" type="number" value={form.orden} onChange={handleChange} />
      <br />

      <button onClick={guardar}>
        {platoEdit ? "Actualizar" : "Guardar"}
      </button>
    </div>
  )
}
