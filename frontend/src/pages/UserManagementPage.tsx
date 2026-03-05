import { useEffect, useState } from "react";
import { fetchAdminUsers, forceLogoutUser, updateAdminUserRole } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AdminUserListItem, UserRole } from "@/types";

const PAGE_SIZE = 20;

type EditableRole = Extract<UserRole, "user" | "vip">;

export function UserManagementPage() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState<"all" | UserRole>("all");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AdminUserListItem[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const [error, setError] = useState("");

  const [roleDrafts, setRoleDrafts] = useState<Record<number, EditableRole>>({});
  const [savingRoleUserId, setSavingRoleUserId] = useState<number>(0);
  const [forcingLogoutUserId, setForcingLogoutUserId] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError("");
      try {
        const data = await fetchAdminUsers({
          q,
          role,
          page,
          pageSize: PAGE_SIZE,
        });
        if (cancelled) {
          return;
        }
        setRows(data.items);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        if (data.page !== page) {
          setPage(data.page);
        }
        setRoleDrafts(() => {
          const next: Record<number, EditableRole> = {};
          for (const item of data.items) {
            if (item.role === "user" || item.role === "vip") {
              next[item.id] = item.role;
            }
          }
          return next;
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载用户列表失败");
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
  }, [q, role, page, refreshToken]);

  async function handleSaveRole(row: AdminUserListItem) {
    const nextRole = roleDrafts[row.id];
    if (!nextRole || nextRole === row.role) {
      return;
    }
    setSavingRoleUserId(row.id);
    setError("");
    try {
      await updateAdminUserRole(row.id, nextRole);
      setRefreshToken((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改角色失败");
    } finally {
      setSavingRoleUserId(0);
    }
  }

  async function handleForceLogout(row: AdminUserListItem) {
    if (!window.confirm(`确认强制用户 ${row.email} 下线吗？`)) {
      return;
    }
    setForcingLogoutUserId(row.id);
    setError("");
    try {
      await forceLogoutUser(row.id);
      setRefreshToken((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "强制下线失败");
    } finally {
      setForcingLogoutUserId(0);
    }
  }

  return (
    <section className="animate-fade-in rounded-2xl border border-black/5 bg-white/75 p-5 shadow-sm backdrop-blur-sm">
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs text-muted-foreground">搜索（邮箱）</label>
          <Input
            value={q}
            onChange={(event) => {
              setPage(1);
              setQ(event.target.value);
            }}
            placeholder="输入邮箱关键词"
          />
        </div>
        <div className="w-[180px]">
          <label className="mb-1 block text-xs text-muted-foreground">角色</label>
          <Select
            value={role}
            onChange={(event) => {
              setPage(1);
              setRole(event.target.value as "all" | UserRole);
            }}
          >
            <option value="all">全部</option>
            <option value="user">user</option>
            <option value="vip">vip</option>
            <option value="admin">admin</option>
          </Select>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[#1f1a15]">用户管理</h2>
        <span className="text-sm text-muted-foreground">共 {total} 位用户</span>
      </div>

      {error ? <p className="mb-3 rounded-md bg-rose-100 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <Table className="rounded-md border bg-white">
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>邮箱</TableHead>
            <TableHead>当前角色</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>最近登录</TableHead>
            <TableHead className="w-[320px]">操作</TableHead>
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
          {!loading && rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                暂无用户
              </TableCell>
            </TableRow>
          ) : null}
          {!loading
            ? rows.map((row) => {
                const editable = row.role === "user" || row.role === "vip";
                const roleDraft = roleDrafts[row.id] ?? "user";
                return (
                  <TableRow key={row.id}>
                    <TableCell>{row.id}</TableCell>
                    <TableCell className="font-medium">{row.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="uppercase">
                        {row.role}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.status}</TableCell>
                    <TableCell>{row.lastLoginAt ?? "-"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        {editable ? (
                          <>
                            <Select
                              className="w-[120px]"
                              value={roleDraft}
                              onChange={(event) =>
                                setRoleDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: event.target.value as EditableRole,
                                }))
                              }
                            >
                              <option value="user">user</option>
                              <option value="vip">vip</option>
                            </Select>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={savingRoleUserId === row.id || roleDraft === row.role}
                              onClick={() => void handleSaveRole(row)}
                            >
                              {savingRoleUserId === row.id ? "保存中..." : "保存角色"}
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">admin 角色不可在此直接设置</span>
                        )}
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={forcingLogoutUserId === row.id}
                          onClick={() => void handleForceLogout(row)}
                        >
                          {forcingLogoutUserId === row.id ? "处理中..." : "强制下线"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            : null}
        </TableBody>
      </Table>

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </section>
  );
}
