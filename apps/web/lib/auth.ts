"use client";

import { useCallback, useEffect, useState } from "react";
import type { Role } from "./types";

const TOKEN_KEY = "kobo.token";
const ROLE_KEY = "kobo.role";
const EMAIL_KEY = "kobo.email";

export interface Session {
  token: string;
  role: Role;
  email: string;
}

const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem(TOKEN_KEY);
  const role = window.localStorage.getItem(ROLE_KEY) as Role | null;
  const email = window.localStorage.getItem(EMAIL_KEY);
  if (!token || !role || !email) return null;
  return { token, role, email };
}

export function setSession(session: Session): void {
  window.localStorage.setItem(TOKEN_KEY, session.token);
  window.localStorage.setItem(ROLE_KEY, session.role);
  window.localStorage.setItem(EMAIL_KEY, session.email);
  notify();
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(ROLE_KEY);
  window.localStorage.removeItem(EMAIL_KEY);
  notify();
}

/**
 * Reactive auth hook. Returns the current session (or null) and helpers.
 * `ready` flips true after the first client read so SSR/hydration is safe.
 */
export function useAuth() {
  const [session, setSessionState] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setSessionState(getSession());
    sync();
    setReady(true);
    listeners.add(sync);
    window.addEventListener("storage", sync);
    return () => {
      listeners.delete(sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const logout = useCallback(() => {
    clearSession();
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
  }, []);

  return { session, ready, logout };
}
