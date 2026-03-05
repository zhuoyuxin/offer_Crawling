import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { fetchMe, login as loginApi, logout as logoutApi, setAuthTokenProvider, setUnauthorizedHandler } from "@/api/client";
import { clearAuthSession, loadStoredToken, loadStoredUser, saveAuthSession } from "@/auth/storage";
import type { AuthUser, LoginPayload } from "@/types";

interface AuthContextValue {
  ready: boolean;
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => Promise<void>;
  clearSession: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider(props: { children: ReactNode }) {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  const clearSessionState = useCallback(() => {
    setToken(null);
    setUser(null);
    clearAuthSession();
  }, []);

  useEffect(() => {
    const storedToken = loadStoredToken();
    const storedUser = loadStoredUser();
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(storedUser);
    } else {
      clearSessionState();
    }
    setReady(true);
  }, [clearSessionState]);

  useEffect(() => {
    setAuthTokenProvider(() => token);
  }, [token]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSessionState();
      navigate("/login", { replace: true });
    });
    return () => {
      setUnauthorizedHandler(null);
    };
  }, [clearSessionState, navigate]);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const currentUser = await fetchMe();
        if (!cancelled) {
          setUser(currentUser);
          saveAuthSession(token, currentUser);
        }
      } catch {
        if (!cancelled) {
          clearSessionState();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, clearSessionState]);

  const login = useCallback(async (payload: LoginPayload) => {
    const result = await loginApi(payload);
    setToken(result.accessToken);
    setUser(result.user);
    saveAuthSession(result.accessToken, result.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      if (token) {
        await logoutApi();
      }
    } finally {
      clearSessionState();
      navigate("/login", { replace: true });
    }
  }, [token, clearSessionState, navigate]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      token,
      user,
      isAuthenticated: Boolean(token && user),
      login,
      logout,
      clearSession: clearSessionState,
    }),
    [ready, token, user, login, logout, clearSessionState]
  );

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth 必须在 AuthProvider 内使用");
  }
  return context;
}
