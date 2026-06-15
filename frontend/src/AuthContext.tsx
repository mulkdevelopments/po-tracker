import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setToken, canAccessPage, canWrite, canManageUsers } from "./api";
import type { AuthUser } from "./types";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  canPage: (page: string) => boolean;
  canEdit: () => boolean;
  isSuperAdmin: () => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const { user: u } = await api.me();
      setUser(u);
    } catch {
      setUser(null);
      setToken(null);
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const { token, user: u } = await api.login(email, password);
    setToken(token);
    setUser(u);
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setToken(null);
      setUser(null);
    }
  };

  const value: AuthContextValue = {
    user,
    loading,
    login,
    logout,
    refresh,
    canPage: (page) => (user ? canAccessPage(user, page) : false),
    canEdit: () => (user ? canWrite(user) : false),
    isSuperAdmin: () => (user ? canManageUsers(user) : false),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
