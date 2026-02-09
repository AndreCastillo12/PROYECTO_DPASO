import React from "react";

export default function ConfirmModal({
  open,
  title = "Confirmar",
  message = "¿Estás seguro?",
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  onConfirm,
  onCancel,
  danger = true
}) {
  if (!open) return null;

  return (
    <div style={backdrop} onClick={onCancel}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0, marginBottom: 8, color: "#fff" }}>{title}</h3>
        <p style={{ margin: 0, marginBottom: 18, color: "#cbd5e1", lineHeight: 1.35 }}>
          {message}
        </p>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={btnSecondary}>
            {cancelText}
          </button>

          <button
            onClick={onConfirm}
            style={{
              ...btnPrimary,
              backgroundColor: danger ? "#d9534f" : "#fca311",
              color: "#fff"
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

const backdrop = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9998,
  padding: 16
};

const modal = {
  width: "100%",
  maxWidth: 420,
  backgroundColor: "#162447",
  borderRadius: 12,
  padding: 18,
  boxShadow: "0 10px 30px rgba(0,0,0,.35)",
  border: "1px solid rgba(255,255,255,.08)"
};

const btnPrimary = {
  border: "none",
  padding: "10px 14px",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: 600
};

const btnSecondary = {
  border: "1px solid rgba(255,255,255,.18)",
  backgroundColor: "transparent",
  color: "#fff",
  padding: "10px 14px",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: 600
};
