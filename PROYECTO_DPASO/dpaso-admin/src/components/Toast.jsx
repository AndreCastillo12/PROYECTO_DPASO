import React from "react";

const TOAST_STYLE = {
  success: { bg: "#e6f6ec", color: "#1f7a43", border: "#b7e4c7" },
  error: { bg: "#fdeaea", color: "#b3261e", border: "#f5c2c0" },
  info: { bg: "#e8f0fe", color: "#1e4fa3", border: "#c8dafc" },
  warning: { bg: "#fff7e6", color: "#9a6700", border: "#f4ddb2" },
};

export default function Toast({ toast }) {
  if (!toast) return null;

  const variant = TOAST_STYLE[toast.type] || TOAST_STYLE.info;

  return (
    <div
      style={{
        position: "fixed",
        top: 18,
        right: 18,
        padding: "10px 14px",
        borderRadius: "10px",
        border: `1px solid ${variant.border}`,
        backgroundColor: variant.bg,
        color: variant.color,
        boxShadow: "0 8px 20px rgba(0,0,0,.12)",
        zIndex: 9999,
        fontSize: "0.92rem",
        maxWidth: "340px",
        lineHeight: 1.3,
      }}
    >
      {toast.msg}
    </div>
  );
}
