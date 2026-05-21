import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useLocation } from "wouter";

const PORTAL_TOKEN_KEY = "portal_auth_token";

interface PortalAuthContextValue {
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const PortalAuthContext = createContext<PortalAuthContextValue | null>(null);

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(PORTAL_TOKEN_KEY));
  const [, setLocation] = useLocation();

  const login = useCallback((t: string) => {
    localStorage.setItem(PORTAL_TOKEN_KEY, t);
    setToken(t);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(PORTAL_TOKEN_KEY);
    setToken(null);
    setLocation("/portal/login");
  }, [setLocation]);

  return (
    <PortalAuthContext.Provider value={{ token, isAuthenticated: !!token, login, logout }}>
      {children}
    </PortalAuthContext.Provider>
  );
}

export function usePortalAuth() {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error("usePortalAuth must be used within PortalAuthProvider");
  return ctx;
}

export function portalFetch(path: string, token: string | null, options: RequestInit = {}) {
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
}
