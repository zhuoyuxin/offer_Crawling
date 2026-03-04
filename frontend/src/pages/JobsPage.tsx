import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { applyJob, fetchJobs, getStatusColor } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STATUS_OPTIONS, type JobListItem, type PaginatedResponse } from "@/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const FILTER_OPTIONS = ["全部", ...STATUS_OPTIONS] as const;

export function JobsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof FILTER_OPTIONS)[number]>("全部");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionPostId, setActionPostId] = useState<string>("");
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
          page,
          pageSize: PAGE_SIZE,
        });
        if (!cancelled) {
          setResult(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载岗位失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [q, status, page]);

  async function handleApply(item: JobListItem) {
    setActionPostId(item.postId);
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
      setActionPostId("");
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

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[#1f1a15]">岗位信息</h2>
        <span className="text-sm text-muted-foreground">共 {result.total} 条</span>
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
            <TableHead className="w-[190px]">操作</TableHead>
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
                暂无岗位数据
              </TableCell>
            </TableRow>
          ) : null}
          {!loading
            ? result.items.map((item) => (
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
                    <Button
                      size="sm"
                      variant={item.applicationId ? "outline" : "default"}
                      disabled={actionPostId === item.postId}
                      onClick={() => void handleApply(item)}
                    >
                      {actionPostId === item.postId ? "处理中..." : item.applicationId ? "查看记录" : "投递"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            : null}
        </TableBody>
      </Table>

      <Pagination page={result.page} totalPages={result.totalPages} onChange={setPage} />
    </section>
  );
}
