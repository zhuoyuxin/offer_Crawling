import { getVisitorId } from "@/lib/fingerprint";
import { loadStoredToken } from "@/auth/storage";
import type {
  AdminUserListItem,
  ApiErrorShape,
  ApplicationPayload,
  ApplicationRecord,
  AuthUser,
  JobListItem,
  LoginPayload,
  LoginResponse,
  PaginatedResponse,
  RegisterPayload,
  StatusType,
  UserRole,
} from "@/types";

type TokenProvider = () => string | null;

let tokenProvider: TokenProvider = () => null;
let unauthorizedHandler: (() => void) | null = null;

export function setAuthTokenProvider(provider: TokenProvider | null): void {
  tokenProvider = provider ?? (() => null);
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
  preventAutoLogout?: boolean;
}

function buildQuery(input: Record<string, string | number | undefined | null>) {
  const query = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    query.set(key, String(value));
  });
  const output = query.toString();
  return output ? `?${output}` : "";
}

async function parseError(response: Response): Promise<ApiErrorShape> {
  try {
    const parsed = (await response.json()) as Partial<ApiErrorShape>;
    return {
      code: parsed.code ?? "UNKNOWN_ERROR",
      message: parsed.message ?? `请求失败（${response.status}）`,
    };
  } catch {
    return {
      code: "UNKNOWN_ERROR",
      message: `请求失败（${response.status}）`,
    };
  }
}

async function request<T>(url: string, options?: RequestOptions): Promise<T> {
  const headers = new Headers(options?.headers ?? {});
  const token = options?.skipAuth ? null : tokenProvider() ?? loadStoredToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  headers.set("X-Device-Fingerprint", await getVisitorId());
  if (options?.body && !headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401 && token && !options?.preventAutoLogout) {
      unauthorizedHandler?.();
    }
    const error = await parseError(response);
    const thrown = new Error(error.message);
    (thrown as Error & { code?: string }).code = error.code;
    throw thrown;
  }

  return (await response.json()) as T;
}

export async function register(payload: RegisterPayload): Promise<AuthUser> {
  return request<AuthUser>("/api/auth/register", {
    method: "POST",
    skipAuth: true,
    body: JSON.stringify(payload),
  });
}

export async function login(payload: LoginPayload): Promise<LoginResponse> {
  return request<LoginResponse>("/api/auth/login", {
    method: "POST",
    skipAuth: true,
    body: JSON.stringify(payload),
  });
}

export async function logout(): Promise<{ success: boolean }> {
  return request<{ success: boolean }>("/api/auth/logout", {
    method: "POST",
  });
}

export async function fetchMe(): Promise<AuthUser> {
  return request<AuthUser>("/api/auth/me");
}

export async function fetchJobs(params: {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedResponse<JobListItem>> {
  return request(`/api/jobs${buildQuery(params)}`);
}

export async function applyJob(postId: string): Promise<{ created: boolean; record: ApplicationRecord | null }> {
  return request(`/api/jobs/${encodeURIComponent(postId)}/apply`, {
    method: "POST",
  });
}

export async function fetchApplications(params: {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  focusId?: number;
}): Promise<PaginatedResponse<ApplicationRecord>> {
  return request(`/api/applications${buildQuery(params)}`);
}

export async function createApplication(payload: ApplicationPayload): Promise<ApplicationRecord> {
  return request("/api/applications", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateApplication(id: number, payload: ApplicationPayload): Promise<ApplicationRecord> {
  return request(`/api/applications/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteApplication(id: number): Promise<{ success: boolean }> {
  return request(`/api/applications/${id}`, {
    method: "DELETE",
  });
}

export async function fetchAdminUsers(params: {
  q?: string;
  role?: string;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedResponse<AdminUserListItem>> {
  return request(`/api/admin/users${buildQuery(params)}`);
}

export async function updateAdminUserRole(
  id: number,
  role: Extract<UserRole, "user" | "vip">
): Promise<AdminUserListItem> {
  return request(`/api/admin/users/${id}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export async function forceLogoutUser(id: number): Promise<{ success: boolean; revoked: number }> {
  return request(`/api/admin/users/${id}/force-logout`, {
    method: "POST",
  });
}

export function getStatusColor(status: StatusType) {
  const map: Record<StatusType, string> = {
    未投递: "bg-slate-100 text-slate-700",
    已投递: "bg-blue-100 text-blue-700",
    已笔试: "bg-cyan-100 text-cyan-700",
    已面试: "bg-indigo-100 text-indigo-700",
    已挂: "bg-rose-100 text-rose-700",
    面试通过: "bg-emerald-100 text-emerald-700",
    暂不投递: "bg-zinc-200 text-zinc-700",
    正在面试: "bg-amber-100 text-amber-800",
  };
  return map[status];
}
