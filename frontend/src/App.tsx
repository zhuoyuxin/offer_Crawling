import { type ReactNode } from "react";
import { ClipboardList, ListChecks, ShieldCheck, UserRound } from "lucide-react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ApplicationsPage } from "@/pages/ApplicationsPage";
import { JobsPage } from "@/pages/JobsPage";
import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { UserManagementPage } from "@/pages/UserManagementPage";

function NavItem(props: { to: string; label: string; icon: ReactNode }) {
  const location = useLocation();
  const active = location.pathname === props.to;
  return (
    <Link
      to={props.to}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-lg shadow-orange-600/20"
          : "border-border bg-white/70 text-foreground hover:border-primary/30 hover:bg-white"
      )}
    >
      {props.icon}
      <span>{props.label}</span>
    </Link>
  );
}

function FullPageCenter(props: { children: ReactNode }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center rounded-2xl border border-black/5 bg-white/70 p-10 text-center backdrop-blur">
      {props.children}
    </div>
  );
}

function RequireAuthRoute(props: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (!auth.ready) {
    return <FullPageCenter>加载中...</FullPageCenter>;
  }
  if (!auth.isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{props.children}</>;
}

function PublicOnlyRoute(props: { children: ReactNode }) {
  const auth = useAuth();
  if (!auth.ready) {
    return <FullPageCenter>加载中...</FullPageCenter>;
  }
  if (auth.isAuthenticated) {
    return <Navigate to="/jobs" replace />;
  }
  return <>{props.children}</>;
}

function RequireAdminRoute(props: { children: ReactNode }) {
  const auth = useAuth();
  if (!auth.ready) {
    return <FullPageCenter>加载中...</FullPageCenter>;
  }
  if (!auth.isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (auth.user?.role !== "admin") {
    return <FullPageCenter>403：你没有访问用户管理页的权限</FullPageCenter>;
  }
  return <>{props.children}</>;
}

export default function App() {
  const location = useLocation();
  const auth = useAuth();
  const isAuthPage = location.pathname === "/login" || location.pathname === "/register";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_0%_0%,rgba(248,210,160,.45),transparent_42%),radial-gradient(circle_at_100%_0%,rgba(255,240,221,.8),transparent_35%),linear-gradient(120deg,#fff8f0,#f6f2ec)]">
      <header className="border-b border-black/5 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-6 py-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Job Tracker</p>
            <h1 className="text-xl font-semibold tracking-tight text-[#211b14]">职位与投递管理台</h1>
          </div>

          {auth.isAuthenticated ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <nav className="flex items-center gap-2">
                <NavItem to="/jobs" label="职位信息" icon={<ListChecks className="h-4 w-4" />} />
                <NavItem to="/applications" label="投递记录" icon={<ClipboardList className="h-4 w-4" />} />
                {auth.user?.role === "admin" ? (
                  <NavItem to="/users" label="用户管理" icon={<ShieldCheck className="h-4 w-4" />} />
                ) : null}
              </nav>
              <div className="ml-2 flex items-center gap-2 rounded-full border border-border bg-white/75 px-3 py-2 text-xs text-muted-foreground">
                <UserRound className="h-3.5 w-3.5" />
                <span>{auth.user?.email}</span>
                <span className="rounded bg-secondary px-2 py-0.5 uppercase">{auth.user?.role}</span>
              </div>
              <Button size="sm" variant="outline" onClick={() => void auth.logout()}>
                退出登录
              </Button>
            </div>
          ) : !isAuthPage ? (
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/login">登录</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/register">注册</Link>
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-6 py-6">
        <Routes>
          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <LoginPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/register"
            element={
              <PublicOnlyRoute>
                <RegisterPage />
              </PublicOnlyRoute>
            }
          />

          <Route
            path="/jobs"
            element={
              <RequireAuthRoute>
                <JobsPage />
              </RequireAuthRoute>
            }
          />
          <Route
            path="/applications"
            element={
              <RequireAuthRoute>
                <ApplicationsPage />
              </RequireAuthRoute>
            }
          />
          <Route
            path="/users"
            element={
              <RequireAdminRoute>
                <UserManagementPage />
              </RequireAdminRoute>
            }
          />

          <Route path="/" element={<Navigate to={auth.isAuthenticated ? "/jobs" : "/login"} replace />} />
          <Route path="*" element={<Navigate to={auth.isAuthenticated ? "/jobs" : "/login"} replace />} />
        </Routes>
      </main>
    </div>
  );
}
