import { useEffect, useState } from "react";

function readInitialValue(key, fallbackValue) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallbackValue;
    return { ...fallbackValue, ...JSON.parse(raw) };
  } catch {
    return fallbackValue;
  }
}

export default function useAdminPreferences(key, fallbackValue) {
  const [value, setValue] = useState(() => readInitialValue(key, fallbackValue));

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // noop
    }
  }, [key, value]);

  return [value, setValue];
}
