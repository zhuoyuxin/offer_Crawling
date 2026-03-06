import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { applyJob, createApplication, fetchJobs, getStatusColor } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { STATUS_OPTIONS, type JobListItem, type PaginatedResponse } from "@/types";

const PAGE_SIZE = 20;
const FILTER_OPTIONS = ["全部", ...STATUS_OPTIONS] as const;
const UNAPPLIED_STATUS = STATUS_OPTIONS[0];
const NOT_SUITABLE_STATUS = STATUS_OPTIONS[6];

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function JobsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNormalUser = user?.role === "user";

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof FILTER_OPTIONS)[number]>("全部");
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

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError("");
      try {
        const data = await fetchJobs({
          q,
          status,
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
  }, [q, status, page, isNormalUser, refreshToken]);

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
    <section className="animate-fade-in rounded-2xl border border-black/5 bg-white/75 p-5 shadow-sm backdrop-blur-sm">
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs text-muted-foreground">搜索（公司 / 岗位 / 地点）</label>
          <Input
            value={q}
            onChange={(event) => {
              setPage(1);
              setQ(event.target.value);
            }}
            placeholder="输入关键词"
          />
        </div>
        <div className="w-[220px]">
          <label className="mb-1 block text-xs text-muted-foreground">状态筛选</label>
          <Select
            value={status}
            onChange={(event) => {
              setPage(1);
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
      </div>

      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-[#1f1a15]">职位信息</h2>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">共 {result.total} 条</p>
          {isNormalUser ? <p className="text-xs text-amber-700">普通用户仅显示符合筛选条件的最新 10 条</p> : null}
        </div>
      </div>

      {error ? <p className="mb-3 rounded-md bg-rose-100 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <Table className="rounded-md border bg-white">
        <TableHeader>
          <TableRow>
            <TableHead>公司</TableHead>
            <TableHead>岗位</TableHead>
            <TableHead>地点</TableHead>
            <TableHead>更新时间</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="w-[300px]">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                加载中...
              </TableCell>
            </TableRow>
          ) : null}
          {!loading && result.items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                暂无职位数据
              </TableCell>
            </TableRow>
          ) : null}
          {!loading
            ? result.items.map((item) => {
                const rowBusy = activeAction.postId === item.postId;
                const canMarkNotSuitable = item.applicationStatus === UNAPPLIED_STATUS;
                return (
                  <TableRow key={item.postId}>
                    <TableCell className="font-medium">{item.companyName || "-"}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p>{item.position || item.title || "-"}</p>
                        {item.detailUrl ? (
                          <a
                            href={item.detailUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary hover:underline"
                          >
                            查看原链接
                          </a>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>{item.location || "-"}</TableCell>
                    <TableCell>{item.updateTime || "-"}</TableCell>
                    <TableCell>
                      <Badge className={cn("border-0", getStatusColor(item.applicationStatus))}>
                        {item.applicationStatus}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant={item.applicationId ? "outline" : "default"}
                          disabled={rowBusy}
                          onClick={() => void handleApply(item)}
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
                        >
                          {rowBusy && activeAction.type === "notSuitable" ? "处理中..." : "已看不合适"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            : null}
        </TableBody>
      </Table>

      {!isNormalUser ? <Pagination page={result.page} totalPages={result.totalPages} onChange={setPage} /> : null}
    </section>
  );
}
