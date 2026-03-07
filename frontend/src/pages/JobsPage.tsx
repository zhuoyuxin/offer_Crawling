import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { applyJob, createApplication, fetchJobs, getStatusColor } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { STATUS_OPTIONS, type JobListItem, type PaginatedResponse } from "@/types";

const PAGE_SIZE = 20;
const FILTER_OPTIONS = ["全部", ...STATUS_OPTIONS] as const;
const UNAPPLIED_STATUS = STATUS_OPTIONS[0];
const NOT_SUITABLE_STATUS = STATUS_OPTIONS[6];

const STORAGE_KEY = "jobs-visible-columns";

interface ColumnDef {
  key: string;
  label: string;
  minWidth: number;
  defaultVisible: boolean;
  render: (item: JobListItem) => React.ReactNode;
}

const ALL_COLUMNS: ColumnDef[] = [
  {
    key: "companyName",
    label: "公司名称",
    minWidth: 160,
    defaultVisible: true,
    render: (item) => <span className="font-semibold text-[#2a2116]">{item.companyName || "-"}</span>,
  },
  {
    key: "companyType",
    label: "公司类型",
    minWidth: 90,
    defaultVisible: true,
    render: (item) =>
      item.companyType ? (
        <span className="inline-block rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
          {item.companyType}
        </span>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
  },
  {
    key: "recruitmentType",
    label: "招聘类型",
    minWidth: 80,
    defaultVisible: true,
    render: (item) =>
      item.recruitmentType ? (
        <span className="inline-block rounded-md bg-sky-50 px-2 py-0.5 text-xs text-sky-800">
          {item.recruitmentType}
        </span>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
  },
  {
    key: "targetCandidates",
    label: "招聘对象",
    minWidth: 80,
    defaultVisible: true,
    render: (item) =>
      item.targetCandidates ? (
        <span className="inline-block rounded-md bg-violet-50 px-2 py-0.5 text-xs text-violet-800">
          {item.targetCandidates}
        </span>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
  },
  {
    key: "location",
    label: "工作地点",
    minWidth: 90,
    defaultVisible: true,
    render: (item) => item.location || <span className="text-muted-foreground">-</span>,
  },
  {
    key: "position",
    label: "岗位",
    minWidth: 180,
    defaultVisible: true,
    render: (item) => (
      <div className="space-y-1">
        <p className="leading-snug">{item.position || item.title || "-"}</p>
        {item.detailUrl ? (
          <a href={item.detailUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
            查看原链接 &rarr;
          </a>
        ) : null}
      </div>
    ),
  },
  {
    key: "updateTime",
    label: "更新时间",
    minWidth: 100,
    defaultVisible: true,
    render: (item) => (
      <span className="tabular-nums text-muted-foreground">{item.updateTime || "-"}</span>
    ),
  },
  {
    key: "deadline",
    label: "投递截止",
    minWidth: 100,
    defaultVisible: true,
    render: (item) => (
      <span className="tabular-nums text-muted-foreground">{item.deadline || "-"}</span>
    ),
  },
  {
    key: "noticeUrl",
    label: "招聘公告",
    minWidth: 90,
    defaultVisible: true,
    render: (item) =>
      item.noticeUrl ? (
        <a
          href={item.noticeUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 transition hover:bg-emerald-100"
        >
          查看公告 &rarr;
        </a>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
  },
  {
    key: "companySize",
    label: "公司规模",
    minWidth: 130,
    defaultVisible: false,
    render: (item) => (
      <span className="text-xs leading-relaxed text-muted-foreground">{item.companySize || "-"}</span>
    ),
  },
  {
    key: "applicationStatus",
    label: "状态",
    minWidth: 90,
    defaultVisible: true,
    render: (item) => (
      <Badge className={cn("border-0 whitespace-nowrap", getStatusColor(item.applicationStatus))}>
        {item.applicationStatus}
      </Badge>
    ),
  },
];

function loadVisibleColumns(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) {
        return new Set(parsed);
      }
    }
  } catch {
    /* ignore */
  }
  return new Set(ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key));
}

function saveVisibleColumns(keys: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function JobsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNormalUser = user?.role === "user";

  const [filters, setFilters] = useState({
    companyName: "",
    companyType: "",
    recruitmentType: "",
    targetCandidates: "",
    location: "",
  });
  const [appliedFilters, setAppliedFilters] = useState({
    companyName: "",
    companyType: "",
    recruitmentType: "",
    targetCandidates: "",
    location: "",
  });
  const [status, setStatus] = useState<(typeof FILTER_OPTIONS)[number]>("全部");
  const [appliedStatus, setAppliedStatus] = useState<(typeof FILTER_OPTIONS)[number]>("全部");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [activeAction, setActiveAction] = useState<{
    postId: string;
    type: "apply" | "notSuitable" | null;
  }>({ postId: "", type: null });
  const [result, setResult] = useState<PaginatedResponse<JobListItem>>({
    items: [],
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 1,
  });

  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(loadVisibleColumns);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowColumnPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggleColumn(key: string) {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      saveVisibleColumns(next);
      return next;
    });
  }

  const visibleColumns = ALL_COLUMNS.filter((c) => visibleKeys.has(c.key));
  const colSpan = visibleColumns.length + 1;

  function handleSearch() {
    setPage(1);
    setAppliedFilters({ ...filters });
    setAppliedStatus(status);
  }

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError("");
      try {
        const data = await fetchJobs({
          companyName: appliedFilters.companyName,
          companyType: appliedFilters.companyType,
          recruitmentType: appliedFilters.recruitmentType,
          targetCandidates: appliedFilters.targetCandidates,
          location: appliedFilters.location,
          status: appliedStatus,
          page: isNormalUser ? 1 : page,
          pageSize: PAGE_SIZE,
        });
        if (!cancelled) {
          if (!isNormalUser && page > data.totalPages) {
            setPage(data.totalPages);
            return;
          }
          setResult(data);
          if (isNormalUser && page !== 1) {
            setPage(1);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载职位失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [appliedFilters, appliedStatus, page, isNormalUser, refreshToken]);

  async function handleApply(item: JobListItem) {
    setActiveAction({ postId: item.postId, type: "apply" });
    setError("");
    try {
      if (item.applicationId) {
        navigate(`/applications?focusId=${item.applicationId}`);
        return;
      }
      const response = await applyJob(item.postId);
      if (response.record) {
        navigate(`/applications?focusId=${response.record.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "投递失败");
    } finally {
      setActiveAction({ postId: "", type: null });
    }
  }

  async function handleMarkNotSuitable(item: JobListItem) {
    if (item.applicationStatus !== UNAPPLIED_STATUS) {
      return;
    }
    setActiveAction({ postId: item.postId, type: "notSuitable" });
    setError("");
    try {
      await createApplication({
        postId: item.postId,
        companyName: item.companyName || "未知公司",
        position: item.position || item.title || "未知岗位",
        location: item.location || undefined,
        detailUrl: item.detailUrl || undefined,
        status: NOT_SUITABLE_STATUS,
        appliedAt: today(),
        notes: "已查看，暂不合适",
      });
      setRefreshToken((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "标记失败");
    } finally {
      setActiveAction({ postId: "", type: null });
    }
  }

  return (
    <section className="animate-fade-in space-y-4">
      {/* toolbar */}
      <div className="rounded-2xl border border-black/5 bg-white/75 p-5 shadow-sm backdrop-blur-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[150px] flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">公司名称</label>
            <Input
              value={filters.companyName}
              onChange={(e) => { setFilters((f) => ({ ...f, companyName: e.target.value })); }}
              placeholder="搜索公司"
            />
          </div>
          <div className="w-[120px]">
            <label className="mb-1 block text-xs text-muted-foreground">公司类型</label>
            <Input
              value={filters.companyType}
              onChange={(e) => { setFilters((f) => ({ ...f, companyType: e.target.value })); }}
              placeholder="如 银行"
            />
          </div>
          <div className="w-[120px]">
            <label className="mb-1 block text-xs text-muted-foreground">招聘类型</label>
            <Input
              value={filters.recruitmentType}
              onChange={(e) => { setFilters((f) => ({ ...f, recruitmentType: e.target.value })); }}
              placeholder="如 春招"
            />
          </div>
          <div className="w-[120px]">
            <label className="mb-1 block text-xs text-muted-foreground">招聘对象</label>
            <Input
              value={filters.targetCandidates}
              onChange={(e) => { setFilters((f) => ({ ...f, targetCandidates: e.target.value })); }}
              placeholder="如 2026届"
            />
          </div>
          <div className="w-[120px]">
            <label className="mb-1 block text-xs text-muted-foreground">工作地点</label>
            <Input
              value={filters.location}
              onChange={(e) => { setFilters((f) => ({ ...f, location: e.target.value })); }}
              placeholder="如 杭州"
            />
          </div>
          <div className="w-[140px]">
            <label className="mb-1 block text-xs text-muted-foreground">状态筛选</label>
            <Select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as (typeof FILTER_OPTIONS)[number]);
              }}
            >
              {FILTER_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-[96px]">
            <label className="mb-1 block text-xs text-transparent">搜索</label>
            <Button type="button" className="w-full" onClick={handleSearch}>
              搜索
            </Button>
          </div>
        </div>
      </div>

      {/* table card */}
      <div className="rounded-2xl border border-black/5 bg-white/75 shadow-sm backdrop-blur-sm">
        {/* header bar */}
        <div className="flex items-center justify-between gap-4 border-b border-black/5 px-5 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-[#1f1a15]">职位信息</h2>
            <div className="relative" ref={pickerRef}>
              <button
                onClick={() => setShowColumnPicker((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition",
                  showColumnPicker
                    ? "border-primary/40 bg-primary/5 text-primary"
                    : "border-border bg-white text-muted-foreground hover:border-primary/30 hover:text-foreground"
                )}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                </svg>
                列设置
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] tabular-nums">{visibleKeys.size}/{ALL_COLUMNS.length}</span>
              </button>
              {showColumnPicker ? (
                <div className="absolute left-0 top-full z-50 mt-1.5 w-48 rounded-xl border bg-white p-1.5 shadow-xl shadow-black/8">
                  <p className="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">显示列</p>
                  {ALL_COLUMNS.map((col) => {
                    const checked = visibleKeys.has(col.key);
                    return (
                      <label
                        key={col.key}
                        className={cn(
                          "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition",
                          checked ? "text-foreground" : "text-muted-foreground",
                          "hover:bg-accent/60"
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition",
                            checked ? "border-primary bg-primary text-white" : "border-border bg-white"
                          )}
                        >
                          {checked ? (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : null}
                        </span>
                        <input type="checkbox" checked={checked} onChange={() => toggleColumn(col.key)} className="sr-only" />
                        {col.label}
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-3 text-right">
            <p className="text-sm text-muted-foreground">共 <span className="tabular-nums font-medium text-foreground">{result.total}</span> 条</p>
            {isNormalUser ? <p className="text-xs text-amber-700">普通用户仅显示最新 10 条</p> : null}
          </div>
        </div>

        {error ? <p className="mx-5 mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        {/* scrollable table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/5 bg-[#faf8f5]">
                {visibleColumns.map((col) => (
                  <th
                    key={col.key}
                    className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                    style={{ minWidth: col.minWidth }}
                  >
                    {col.label}
                  </th>
                ))}
                <th
                  className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                  style={{ minWidth: 180 }}
                >
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={colSpan} className="py-16 text-center text-muted-foreground">
                    <div className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      加载中...
                    </div>
                  </td>
                </tr>
              ) : null}
              {!loading && result.items.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="py-16 text-center text-muted-foreground">
                    暂无职位数据
                  </td>
                </tr>
              ) : null}
              {!loading
                ? result.items.map((item, idx) => {
                    const rowBusy = activeAction.postId === item.postId;
                    const canMarkNotSuitable = item.applicationStatus === UNAPPLIED_STATUS;
                    return (
                      <tr
                        key={item.postId}
                        className={cn(
                          "border-b border-black/[0.03] transition-colors hover:bg-amber-50/40",
                          idx % 2 === 1 && "bg-[#fdfcfa]"
                        )}
                      >
                        {visibleColumns.map((col) => (
                          <td key={col.key} className="px-4 py-3 align-middle">
                            {col.render(item)}
                          </td>
                        ))}
                        <td className="px-4 py-3 align-middle">
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant={item.applicationId ? "outline" : "default"}
                              disabled={rowBusy}
                              onClick={() => void handleApply(item)}
                              className="h-7 px-2.5 text-xs"
                            >
                              {rowBusy && activeAction.type === "apply"
                                ? "处理中..."
                                : item.applicationId
                                  ? "查看记录"
                                  : "一键投递"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={rowBusy || !canMarkNotSuitable}
                              onClick={() => void handleMarkNotSuitable(item)}
                              className="h-7 px-2.5 text-xs"
                            >
                              {rowBusy && activeAction.type === "notSuitable" ? "处理中..." : "不合适"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                : null}
            </tbody>
          </table>
        </div>

        {/* pagination inside the card */}
        {!isNormalUser ? (
          <div className="border-t border-black/5 px-5 py-3">
            <Pagination page={result.page} totalPages={result.totalPages} onChange={setPage} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
