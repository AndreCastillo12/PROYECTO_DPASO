import { supabase } from '../lib/supabaseClient'

export async function fetchMenu(search = '') {
  const [{ data: platos, error: platosError }, { data: categorias, error: categoriasError }] = await Promise.all([
    supabase.from('platos').select('id,nombre,descripcion,precio,imagen,categoria_id,orden,is_available,track_stock,stock').order('orden', { ascending: true }),
    supabase.from('categorias').select('*').order('orden', { ascending: true })
  ])

  if (platosError) throw platosError
  if (categoriasError) throw categoriasError

  const term = search.trim().toLowerCase()
  const filteredPlatos = term
    ? (platos || []).filter((p) => `${p.nombre || ''} ${p.descripcion || ''}`.toLowerCase().includes(term))
    : (platos || [])

  return { platos: filteredPlatos, categorias: categorias || [] }
}
