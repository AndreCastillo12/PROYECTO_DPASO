const ERROR_MAP = {
  COMMAND_ALREADY_OPEN: "Ya existe una comanda abierta para esta mesa.",
  NOTHING_TO_SEND: "No hay platos nuevos pendientes por enviar a cocina.",
  TICKET_KITCHEN_PENDING: "No puedes cobrar este ticket porque aún hay platos pendientes en cocina o por enviar.",
  CASH_RECEIVED_LT_TOTAL: "El monto recibido es menor al total a pagar.",
  CASH_RECEIVED_REQUIRED: "Ingresa el monto recibido para pagos en efectivo.",
  CASH_SESSION_REQUIRED: "Para pagos en efectivo debes abrir caja.",
  REFERENCE_REQUIRED: "Ingresa la referencia o voucher del pago.",
  PAYMENT_NOT_COMPLETED: "No se pudo completar el pago del ticket.",
};

export function getUserErrorMessage(error, fallback) {
  const raw = String(error?.message || "").trim();
  const knownKey = Object.keys(ERROR_MAP).find((key) => raw.includes(key));
  if (knownKey) return ERROR_MAP[knownKey];
  return fallback;
}
