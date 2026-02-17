const KEY = "dpaso_admin_prefs_v1";

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(next) {
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function readAdminPreference(scope, fallback) {
  const all = readAll();
  return all[scope] ?? fallback;
}

export function saveAdminPreference(scope, value) {
  const all = readAll();
  writeAll({ ...all, [scope]: value });
}
