export function groupPlatosByCategoria(platos, categorias) {
  const grouped = new Map();
  categorias.forEach(cat => grouped.set(String(cat.id), []));

  platos.forEach(plato => {
    const key = String(plato.categoria_id);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(plato);
  });

  return grouped;
}

export function applyOrderedIdsToCategoria(platos, categoriaId, orderedIds) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return platos;

  return platos.map(plato => {
    if (String(plato.categoria_id) !== String(categoriaId)) return plato;
    const index = orderedIds.indexOf(String(plato.id));
    return index === -1 ? plato : { ...plato, orden: index + 1 };
  });
}

export function shouldSkipDragUpdate({ busy, oldIndex, newIndex, orderedIds }) {
  if (busy) return true;
  if (typeof oldIndex === "number" && typeof newIndex === "number" && oldIndex === newIndex) return true;
  if (!orderedIds || orderedIds.length === 0) return true;
  return false;
}
