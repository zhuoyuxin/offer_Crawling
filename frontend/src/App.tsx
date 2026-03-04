import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ClipboardList, ListChecks } from "lucide-react";
import { JobsPage } from "./pages/JobsPage";
import { ApplicationsPage } from "./pages/ApplicationsPage";
import { cn } from "./lib/utils";

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

export default function App() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_0%_0%,rgba(248,210,160,.45),transparent_42%),radial-gradient(circle_at_100%_0%,rgba(255,240,221,.8),transparent_35%),linear-gradient(120deg,#fff8f0,#f6f2ec)]">
      <header className="border-b border-black/5 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Job Tracker</p>
            <h1 className="text-xl font-semibold tracking-tight text-[#211b14]">岗位与投递管理台</h1>
          </div>
          <nav className="flex items-center gap-2">
            <NavItem to="/jobs" label="岗位信息" icon={<ListChecks className="h-4 w-4" />} />
            <NavItem to="/applications" label="投递记录" icon={<ClipboardList className="h-4 w-4" />} />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1200px] px-6 py-6">
        <Routes>
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="*" element={<Navigate to="/jobs" replace />} />
        </Routes>
      </main>
    </div>
  );
}
