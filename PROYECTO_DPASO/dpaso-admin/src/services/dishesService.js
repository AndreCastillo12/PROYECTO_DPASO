import { supabase } from "../lib/supabaseClient";

export async function fetchPlatos() {
  return supabase.from("platos").select("*").order("orden", { ascending: true });
}

export async function fetchCategoriasForPlatos() {
  return supabase.from("categorias").select("*").order("orden", { ascending: true });
}

export async function uploadPlatoImage(fileName, file) {
  return supabase.storage.from("platos").upload(fileName, file);
}

export async function updatePlato(id, payload) {
  return supabase.from("platos").update(payload).eq("id", id);
}

export async function createPlato(payload) {
  return supabase.from("platos").insert([payload]).select();
}

export async function deletePlato(id) {
  return supabase.from("platos").delete().eq("id", id);
}

export async function removePlatoImage(path) {
  return supabase.storage.from("platos").remove([path]);
}

export async function updatePlatosOrder(orderedIds) {
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("platos")
      .update({ orden: i + 1 })
      .eq("id", orderedIds[i]);

    if (error) throw error;
  }
}