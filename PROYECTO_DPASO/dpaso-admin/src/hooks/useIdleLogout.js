import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const IDLE_LOGOUT_FLAG = "idle_logout";

export default function useIdleLogout({
  enabled = true,
  timeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  onIdleLogout = () => {}
} = {}) {
  const timerRef = useRef(null);
  const logoutBusyRef = useRef(false);

  useEffect(() => {
    if (!enabled || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return;

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const performIdleLogout = async () => {
      if (logoutBusyRef.current) return;
      logoutBusyRef.current = true;
      try {
        sessionStorage.setItem(IDLE_LOGOUT_FLAG, "1");
        await supabase.auth.signOut();
      } catch (error) {
        console.error("⚠️ Error cerrando sesión por inactividad:", error);
      } finally {
        onIdleLogout();
      }
    };

    const resetTimer = () => {
      clearTimer();
      timerRef.current = setTimeout(() => {
        performIdleLogout();
      }, timeoutMs);
    };

    const activityEvents = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, resetTimer, { passive: true });
    });

    resetTimer();

    return () => {
      clearTimer();
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, resetTimer);
      });
    };
  }, [enabled, onIdleLogout, timeoutMs]);
}

export const IDLE_LOGOUT_SESSION_FLAG = IDLE_LOGOUT_FLAG;
export const IDLE_LOGOUT_DEFAULT_MS = DEFAULT_IDLE_TIMEOUT_MS;
