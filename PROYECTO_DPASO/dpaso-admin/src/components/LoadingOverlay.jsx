import React from "react";

export default function LoadingOverlay({ open, text = "Procesando..." }) {
  if (!open) return null;

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={spinner} />
        <p style={{ margin: 0, color: "#fff", fontWeight: 600 }}>{text}</p>
        <p style={{ margin: 0, marginTop: 6, color: "#cbd5e1", fontSize: 13 }}>
          Un toque de paciencia y queda 🔥
        </p>
      </div>
    </div>
  );
}

const overlay = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
  padding: 16
};

const card = {
  backgroundColor: "#162447",
  borderRadius: 12,
  padding: 18,
  boxShadow: "0 10px 30px rgba(0,0,0,.35)",
  border: "1px solid rgba(255,255,255,.08)",
  width: "100%",
  maxWidth: 360,
  textAlign: "center"
};

const spinner = {
  width: 28,
  height: 28,
  borderRadius: "50%",
  border: "3px solid rgba(255,255,255,.25)",
  borderTopColor: "#fca311",
  margin: "0 auto 12px auto",
  animation: "spin 0.9s linear infinite"
};

// Inyecta keyframes (simple y sin CSS externo)
const styleTag = document.createElement("style");
styleTag.innerHTML = `@keyframes spin{to{transform:rotate(360deg)}}`;
document.head.appendChild(styleTag);
