import { supabase } from "../lib/supabaseClient";

export async function fetchCategorias() {
  return supabase.from("categorias").select("*").order("orden", { ascending: true });
}

export async function createCategoria(payload) {
  return supabase.from("categorias").insert([payload]).select();
}

export async function updateCategoria(id, payload) {
  return supabase.from("categorias").update(payload).eq("id", id);
}

export async function deleteCategoria(id) {
  return supabase.from("categorias").delete().eq("id", id);
}

export async function updateCategoriasOrder(orderedIds) {
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("categorias")
      .update({ orden: i + 1 })
      .eq("id", orderedIds[i]);

    if (error) throw error;
  }
}