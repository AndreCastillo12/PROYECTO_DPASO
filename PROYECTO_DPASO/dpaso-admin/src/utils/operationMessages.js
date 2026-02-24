export const OPERATION_MESSAGES = {
  loadSuccess: "Datos actualizados correctamente.",
  loadError: "No se pudo cargar la información. Intenta de nuevo.",
  saveSuccess: "Cambios guardados correctamente.",
  saveError: "No se pudo guardar los cambios. Intenta de nuevo.",
  authError: "Tu sesión expiró. Inicia sesión nuevamente.",
};

export function resolveErrorMessage(error, fallback = OPERATION_MESSAGES.loadError) {
  const message = String(error?.message || "").trim();
  return message || fallback;
}
