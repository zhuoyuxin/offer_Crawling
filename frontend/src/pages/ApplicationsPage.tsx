import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { createApplication, deleteApplication, fetchApplications, getStatusColor, updateApplication } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { STATUS_OPTIONS, type ApplicationRecord, type StatusType } from "@/types";

const PAGE_SIZE = 20;
const FILTER_OPTIONS = ["全部", ...STATUS_OPTIONS] as const;
const MAX_USER_APPLICATIONS = 30;

interface FormState {
  postId: string;
  companyName: string;
  position: string;
  location: string;
  detailUrl: string;
  status: StatusType;
  appliedAt: string;
  followUpAt: string;
  channel: string;
  contact: string;
  notes: string;
}

function today() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function toFormState(record?: ApplicationRecord): FormState {
  if (!record) {
    return {
      postId: "",
      companyName: "",
      position: "",
      location: "",
      detailUrl: "",
      status: "已投递",
      appliedAt: today(),
      followUpAt: "",
      channel: "",
      contact: "",
      notes: "",
    };
  }
  return {
    postId: record.postId ?? "",
    companyName: record.companyName,
    position: record.position,
    location: record.location,
    detailUrl: record.detailUrl,
    status: record.status,
    appliedAt: record.appliedAt,
    followUpAt: record.followUpAt ?? "",
    channel: record.channel,
    contact: record.contact,
    notes: record.notes,
  };
}

function parseFocusId(search: string): number {
  const query = new URLSearchParams(search);
  const raw = Number(query.get("focusId"));
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  return Math.floor(raw);
}

export function ApplicationsPage() {
  const location = useLocation();
  const { user } = useAuth();
  const isNormalUser = user?.role === "user";

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof FILTER_OPTIONS)[number]>("全部");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [rows, setRows] = useState<ApplicationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const [error, setError] = useState("");
  const [activeFocusId, setActiveFocusId] = useState<number>(() => parseFocusId(location.search));
  const [highlightId, setHighlightId] = useState<number>(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(toFormState());

  const limitReached = isNormalUser && total >= MAX_USER_APPLICATIONS;
  const dialogTitle = useMemo(() => (editingId ? "编辑投递记录" : "手动新增投递记录"), [editingId]);

  useEffect(() => {
    const nextFocus = parseFocusId(location.search);
    if (nextFocus > 0) {
      setActiveFocusId(nextFocus);
    }
  }, [location.search]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError("");
      try {
        const response = await fetchApplications({
          q,
          status,
          page,
          pageSize: PAGE_SIZE,
          focusId: activeFocusId || undefined,
        });
        if (cancelled) {
          return;
        }
        setRows(response.items);
        setTotal(response.total);
        setTotalPages(response.totalPages);
        if (response.page !== page) {
          setPage(response.page);
        }
        if (activeFocusId > 0) {
          const exists = response.items.some((item) => item.id === activeFocusId);
          if (exists) {
            setHighlightId(activeFocusId);
            window.setTimeout(() => setHighlightId(0), 2800);
          }
          setActiveFocusId(0);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载投递记录失败");
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
  }, [q, status, page, refreshToken, activeFocusId]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreate() {
    if (limitReached) {
      setError(`普通用户最多保留 ${MAX_USER_APPLICATIONS} 条投递记录，请先删除后再新增`);
      return;
    }
    setEditingId(null);
    setForm(toFormState());
    setDialogOpen(true);
  }

  function openEdit(record: ApplicationRecord) {
    setEditingId(record.id);
    setForm(toFormState(record));
    setDialogOpen(true);
  }

  async function submitForm() {
    if (!form.companyName.trim() || !form.position.trim() || !form.appliedAt.trim()) {
      setError("公司、岗位、投递日期为必填项");
      return;
    }
    if (!editingId && limitReached) {
      setError(`普通用户最多保留 ${MAX_USER_APPLICATIONS} 条投递记录，请先删除后再新增`);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const payload = {
        postId: form.postId.trim() || undefined,
        companyName: form.companyName.trim(),
        position: form.position.trim(),
        location: form.location.trim() || undefined,
        detailUrl: form.detailUrl.trim() || undefined,
        status: form.status,
        appliedAt: form.appliedAt,
        followUpAt: form.followUpAt.trim() || undefined,
        channel: form.channel.trim() || undefined,
        contact: form.contact.trim() || undefined,
        notes: form.notes.trim() || undefined,
      };

      let saved: ApplicationRecord;
      if (editingId) {
        saved = await updateApplication(editingId, payload);
      } else {
        saved = await createApplication(payload);
        setPage(1);
      }
      setHighlightId(saved.id);
      window.setTimeout(() => setHighlightId(0), 2800);
      setDialogOpen(false);
      setRefreshToken((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: ApplicationRecord) {
    if (!window.confirm(`确认删除「${row.companyName} - ${row.position}」吗？`)) {
      return;
    }
    setError("");
    try {
      await deleteApplication(row.id);
      setRefreshToken((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  return (
    <section className="animate-fade-in rounded-2xl border border-black/5 bg-white/75 p-5 shadow-sm backdrop-blur-sm">
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs text-muted-foreground">搜索（公司 / 岗位 / 联系人 / 备注）</label>
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
        <Button onClick={openCreate} disabled={limitReached}>
          手动新增
        </Button>
      </div>

      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-[#1f1a15]">投递记录</h2>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">共 {total} 条</p>
          {isNormalUser ? (
            <p className={cn("text-xs", limitReached ? "text-rose-700" : "text-muted-foreground")}>
              {limitReached
                ? `已达到普通用户上限 ${MAX_USER_APPLICATIONS} 条，请删除后继续新增或一键投递`
                : `普通用户上限 ${MAX_USER_APPLICATIONS} 条`}
            </p>
          ) : null}
        </div>
      </div>

      {error ? <p className="mb-3 rounded-md bg-rose-100 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <Table className="rounded-md border bg-white">
        <TableHeader>
          <TableRow>
            <TableHead>公司</TableHead>
            <TableHead>岗位</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>投递日期</TableHead>
            <TableHead>跟进日期</TableHead>
            <TableHead>渠道</TableHead>
            <TableHead>联系人</TableHead>
            <TableHead className="w-[180px]">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground">
                加载中...
              </TableCell>
            </TableRow>
          ) : null}
          {!loading && rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground">
                还没有投递记录
              </TableCell>
            </TableRow>
          ) : null}
          {!loading
            ? rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(
                    row.id === highlightId &&
                      "bg-amber-100/70 shadow-[inset_4px_0_0_0_rgb(251_146_60)] transition-colors duration-500"
                  )}
                >
                  <TableCell className="font-medium">{row.companyName}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <p>{row.position}</p>
                      {row.notes ? <p className="text-xs text-muted-foreground">{row.notes}</p> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={cn("border-0", getStatusColor(row.status))}>{row.status}</Badge>
                  </TableCell>
                  <TableCell>{row.appliedAt || "-"}</TableCell>
                  <TableCell>{row.followUpAt || "-"}</TableCell>
                  <TableCell>{row.channel || "-"}</TableCell>
                  <TableCell>{row.contact || "-"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
                        编辑
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => void handleDelete(row)}>
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            : null}
        </TableBody>
      </Table>

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>支持手动新增，并可通过 postId 关联已有岗位。</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">postId（可选）</label>
              <Input value={form.postId} onChange={(e) => updateField("postId", e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">状态</label>
              <Select value={form.status} onChange={(e) => updateField("status", e.target.value as StatusType)}>
                {STATUS_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">公司名称*</label>
              <Input value={form.companyName} onChange={(e) => updateField("companyName", e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">岗位名称*</label>
              <Input value={form.position} onChange={(e) => updateField("position", e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">地点</label>
              <Input value={form.location} onChange={(e) => updateField("location", e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">链接</label>
              <Input value={form.detailUrl} onChange={(e) => updateField("detailUrl", e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">投递日期*</label>
              <Input type="date" value={form.appliedAt} onChange={(e) => updateField("appliedAt", e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">跟进日期</label>
              <Input
                type="date"
                value={form.followUpAt}
                onChange={(e) => updateField("followUpAt", e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">渠道</label>
              <Input value={form.channel} onChange={(e) => updateField("channel", e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">联系人</label>
              <Input value={form.contact} onChange={(e) => updateField("contact", e.target.value)} />
            </div>
          </div>

          <div className="mt-3">
            <label className="mb-1 block text-xs text-muted-foreground">备注</label>
            <Textarea value={form.notes} onChange={(e) => updateField("notes", e.target.value)} />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => void submitForm()} disabled={saving}>
              {saving ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
