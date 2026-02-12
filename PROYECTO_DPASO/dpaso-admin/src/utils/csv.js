export function exportRowsToCsv(filename, headers = [], rows = []) {
  const safe = (value) => {
    const str = String(value ?? "");
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const lines = [];
  if (headers.length) lines.push(headers.map((h) => safe(h)).join(","));
  rows.forEach((row) => lines.push(row.map((cell) => safe(cell)).join(",")));

  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename || "reporte.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
