import { useEffect, useRef, useState } from "react";

export default function useToast(duration = 2500) {
  const [toast, setToast] = useState(null); // { msg, type }
  const timerRef = useRef(null);

  const showToast = (msg, type = "success") => {
    if (timerRef.current) clearTimeout(timerRef.current);

    setToast({ msg, type });
    timerRef.current = setTimeout(() => setToast(null), duration);
  };

  const clearToast = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  };

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { toast, showToast, clearToast };
}
