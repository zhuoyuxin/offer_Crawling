import type {
  ApplicationPayload,
  ApplicationRecord,
  JobListItem,
  PaginatedResponse,
  StatusType,
} from "@/types";

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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `请求失败：${response.status}`;
    try {
      const parsed = (await response.json()) as { message?: string };
      if (parsed?.message) {
        message = parsed.message;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
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
