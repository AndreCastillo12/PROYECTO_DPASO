import React from "react";

export default function Toast({ toast }) {
  if (!toast) return null;

  const bg = toast.type === "error" ? "#dc3545" : "#28a745";

  return (
    <div
      style={{
        position: "fixed",
        top: 18,
        right: 18,
        padding: "12px 16px",
        borderRadius: "10px",
        backgroundColor: bg,
        color: "#fff",
        boxShadow: "0 8px 20px rgba(0,0,0,.18)",
        zIndex: 9999,
        fontSize: "0.95rem",
        maxWidth: "320px",
        lineHeight: 1.25
      }}
    >
      {toast.msg}
    </div>
  );
}
