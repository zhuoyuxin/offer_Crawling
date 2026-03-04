import cors from "cors";
import express, { type Request } from "express";
import { z } from "zod";
import {
  APPLICATION_STATUSES,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type ApplicationStatus,
} from "./constants";
import { getDb, initDb } from "./db";
import type { ApplicationRecord, JobListItem, PaginatedResponse } from "./types";

function isStatus(value: string): value is ApplicationStatus {
  return APPLICATION_STATUSES.includes(value as ApplicationStatus);
}

function parsePositiveInt(input: unknown, fallback: number): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parsePage(req: Request): { page: number; pageSize: number } {
  const page = parsePositiveInt(req.query.page, DEFAULT_PAGE);
  const pageSize = Math.min(parsePositiveInt(req.query.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  return { page, pageSize };
}

function normalizeText(input: unknown): string {
  if (input === undefined || input === null) {
    return "";
  }
  return String(input).trim();
}

function normalizeNullableText(input: unknown): string | null {
  const value = normalizeText(input);
  return value ? value : null;
}

function mapJobRow(row: Record<string, unknown>): JobListItem {
  const applicationStatusRaw = normalizeText(row.application_status);
  const applicationStatus = isStatus(applicationStatusRaw) ? applicationStatusRaw : "未投递";
  return {
    postId: normalizeText(row.post_id),
    dataId: normalizeText(row.data_id),
    title: normalizeText(row.title),
    companyName: normalizeText(row.company_name),
    location: normalizeText(row.location),
    recruitmentType: normalizeText(row.recruitment_type),
    targetCandidates: normalizeText(row.target_candidates),
    position: normalizeText(row.position),
    progressStatus: normalizeText(row.progress_status),
    deadline: normalizeText(row.deadline),
    updateTime: normalizeText(row.update_time),
    detailUrl: normalizeText(row.detail_url),
    sourcePage: normalizeText(row.source_page),
    crawledAt: normalizeText(row.crawled_at),
    applicationId: row.application_id ? Number(row.application_id) : null,
    applicationStatus,
  };
}

function mapApplicationRow(row: Record<string, unknown>): ApplicationRecord {
  return {
    id: Number(row.id),
    postId: normalizeNullableText(row.post_id),
    companyName: normalizeText(row.company_name),
    position: normalizeText(row.position),
    location: normalizeText(row.location),
    detailUrl: normalizeText(row.detail_url),
    status: normalizeText(row.status) as ApplicationStatus,
    appliedAt: normalizeText(row.applied_at),
    followUpAt: normalizeNullableText(row.follow_up_at),
    channel: normalizeText(row.channel),
    contact: normalizeText(row.contact),
    notes: normalizeText(row.notes),
    createdAt: normalizeText(row.created_at),
    updatedAt: normalizeText(row.updated_at),
  };
}

function buildPagination<T>(
  items: T[],
  page: number,
  pageSize: number,
  total: number
): PaginatedResponse<T> {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items,
    page,
    pageSize,
    total,
    totalPages,
  };
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const emptyToUndefined = (input: unknown): unknown => {
  if (typeof input === "string" && input.trim() === "") {
    return undefined;
  }
  return input;
};

const applicationInputSchema = z.object({
  postId: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
  companyName: z.string().trim().min(1, "公司名称不能为空"),
  position: z.string().trim().min(1, "岗位名称不能为空"),
  location: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  detailUrl: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  status: z.enum(APPLICATION_STATUSES),
  appliedAt: z.string().trim().min(1, "投递日期不能为空"),
  followUpAt: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  channel: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  contact: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  notes: z.preprocess(emptyToUndefined, z.string().trim().optional()),
});

initDb();
const db = getDb();
const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/statuses", (_req, res) => {
  res.json({ statuses: APPLICATION_STATUSES });
});

app.get("/api/jobs", (req, res) => {
  const { page, pageSize } = parsePage(req);
  const q = normalizeText(req.query.q);
  const status = normalizeText(req.query.status);

  if (status && status !== "全部" && !isStatus(status)) {
    return res.status(400).json({ message: "无效状态筛选" });
  }

  const filters: string[] = [];
  const params: Record<string, unknown> = {};

  if (q) {
    filters.push(
      "(j.company_name LIKE @kw OR j.position LIKE @kw OR j.location LIKE @kw OR j.title LIKE @kw)"
    );
    params.kw = `%${q}%`;
  }

  if (status && status !== "全部") {
    if (status === "未投递") {
      filters.push("a.id IS NULL");
    } else {
      filters.push("a.status = @status");
      params.status = status;
    }
  }

  const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;

  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM jobs j
      LEFT JOIN applications a ON a.post_id = j.post_id
      ${whereSql}
      `
    )
    .get(params) as { total: number };

  const rows = db
    .prepare(
      `
      SELECT
        j.*,
        a.id AS application_id,
        COALESCE(a.status, '未投递') AS application_status
      FROM jobs j
      LEFT JOIN applications a ON a.post_id = j.post_id
      ${whereSql}
      ORDER BY j.update_time DESC, j.post_id DESC
      LIMIT @limit OFFSET @offset
      `
    )
    .all({ ...params, limit: pageSize, offset }) as Record<string, unknown>[];

  const items = rows.map(mapJobRow);
  return res.json(buildPagination(items, page, pageSize, Number(totalRow.total)));
});

app.post("/api/jobs/:postId/apply", (req, res) => {
  const postId = normalizeText(req.params.postId);
  if (!postId) {
    return res.status(400).json({ message: "postId 不能为空" });
  }

  const job = db
    .prepare("SELECT * FROM jobs WHERE post_id = ?")
    .get(postId) as Record<string, unknown> | undefined;
  if (!job) {
    return res.status(404).json({ message: "岗位不存在" });
  }

  const existing = db
    .prepare("SELECT * FROM applications WHERE post_id = ?")
    .get(postId) as Record<string, unknown> | undefined;
  if (existing) {
    return res.json({ created: false, record: mapApplicationRow(existing) });
  }

  const insertResult = db
    .prepare(
      `
      INSERT INTO applications (
        post_id,
        company_name,
        position,
        location,
        detail_url,
        status,
        applied_at,
        follow_up_at,
        channel,
        contact,
        notes,
        created_at,
        updated_at
      )
      VALUES (
        @post_id,
        @company_name,
        @position,
        @location,
        @detail_url,
        @status,
        @applied_at,
        NULL,
        '',
        '',
        '',
        datetime('now'),
        datetime('now')
      )
      `
    )
    .run({
      post_id: postId,
      company_name: normalizeText(job.company_name),
      position: normalizeText(job.position) || normalizeText(job.title),
      location: normalizeText(job.location),
      detail_url: normalizeText(job.detail_url),
      status: "已投递",
      applied_at: todayDate(),
    });

  const created = db
    .prepare("SELECT * FROM applications WHERE id = ?")
    .get(insertResult.lastInsertRowid) as Record<string, unknown> | undefined;
  return res.status(201).json({ created: true, record: created ? mapApplicationRow(created) : null });
});

app.get("/api/applications", (req, res) => {
  const requestedStatus = normalizeText(req.query.status);
  if (requestedStatus && requestedStatus !== "全部" && !isStatus(requestedStatus)) {
    return res.status(400).json({ message: "无效状态筛选" });
  }

  const q = normalizeText(req.query.q);
  let { page, pageSize } = parsePage(req);
  const focusId = parsePositiveInt(req.query.focusId, 0);

  const filters: string[] = [];
  const params: Record<string, unknown> = {};

  if (q) {
    filters.push(
      "(a.company_name LIKE @kw OR a.position LIKE @kw OR a.location LIKE @kw OR a.channel LIKE @kw OR a.contact LIKE @kw OR a.notes LIKE @kw)"
    );
    params.kw = `%${q}%`;
  }
  if (requestedStatus && requestedStatus !== "全部") {
    filters.push("a.status = @status");
    params.status = requestedStatus;
  }

  const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  if (focusId > 0) {
    const rankRow = db
      .prepare(
        `
        WITH ordered AS (
          SELECT a.id, ROW_NUMBER() OVER (ORDER BY a.updated_at DESC, a.id DESC) AS rn
          FROM applications a
          ${whereSql}
        )
        SELECT rn FROM ordered WHERE id = @focusId
        `
      )
      .get({ ...params, focusId }) as { rn?: number } | undefined;
    if (rankRow?.rn && rankRow.rn > 0) {
      page = Math.ceil(rankRow.rn / pageSize);
    }
  }

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS total FROM applications a ${whereSql}`)
    .get(params) as { total: number };
  const total = Number(totalRow.total);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (page > totalPages) {
    page = totalPages;
  }

  const offset = (page - 1) * pageSize;
  const rows = db
    .prepare(
      `
      SELECT *
      FROM applications a
      ${whereSql}
      ORDER BY a.updated_at DESC, a.id DESC
      LIMIT @limit OFFSET @offset
      `
    )
    .all({ ...params, limit: pageSize, offset }) as Record<string, unknown>[];

  const items = rows.map(mapApplicationRow);
  return res.json(buildPagination(items, page, pageSize, total));
});

app.get("/api/applications/:id", (req, res) => {
  const id = parsePositiveInt(req.params.id, 0);
  if (id <= 0) {
    return res.status(400).json({ message: "id 非法" });
  }

  const row = db.prepare("SELECT * FROM applications WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    return res.status(404).json({ message: "记录不存在" });
  }
  return res.json(mapApplicationRow(row));
});

app.post("/api/applications", (req, res) => {
  const parsed = applicationInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "参数校验失败", errors: parsed.error.flatten() });
  }
  const payload = parsed.data;

  try {
    const result = db
      .prepare(
        `
        INSERT INTO applications (
          post_id,
          company_name,
          position,
          location,
          detail_url,
          status,
          applied_at,
          follow_up_at,
          channel,
          contact,
          notes,
          created_at,
          updated_at
        )
        VALUES (
          @post_id,
          @company_name,
          @position,
          @location,
          @detail_url,
          @status,
          @applied_at,
          @follow_up_at,
          @channel,
          @contact,
          @notes,
          datetime('now'),
          datetime('now')
        )
        `
      )
      .run({
        post_id: payload.postId ?? null,
        company_name: payload.companyName,
        position: payload.position,
        location: payload.location ?? "",
        detail_url: payload.detailUrl ?? "",
        status: payload.status,
        applied_at: payload.appliedAt,
        follow_up_at: payload.followUpAt ?? null,
        channel: payload.channel ?? "",
        contact: payload.contact ?? "",
        notes: payload.notes ?? "",
      });

    const row = db
      .prepare("SELECT * FROM applications WHERE id = ?")
      .get(result.lastInsertRowid) as Record<string, unknown> | undefined;
    return res.status(201).json(row ? mapApplicationRow(row) : null);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: applications.post_id")) {
      return res.status(409).json({ message: "该岗位已存在投递记录，不能重复新增" });
    }
    return res.status(500).json({ message: "新增失败", error: String(error) });
  }
});

app.put("/api/applications/:id", (req, res) => {
  const id = parsePositiveInt(req.params.id, 0);
  if (id <= 0) {
    return res.status(400).json({ message: "id 非法" });
  }

  const parsed = applicationInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "参数校验失败", errors: parsed.error.flatten() });
  }
  const payload = parsed.data;

  try {
    const result = db
      .prepare(
        `
        UPDATE applications
        SET
          post_id = @post_id,
          company_name = @company_name,
          position = @position,
          location = @location,
          detail_url = @detail_url,
          status = @status,
          applied_at = @applied_at,
          follow_up_at = @follow_up_at,
          channel = @channel,
          contact = @contact,
          notes = @notes,
          updated_at = datetime('now')
        WHERE id = @id
        `
      )
      .run({
        id,
        post_id: payload.postId ?? null,
        company_name: payload.companyName,
        position: payload.position,
        location: payload.location ?? "",
        detail_url: payload.detailUrl ?? "",
        status: payload.status,
        applied_at: payload.appliedAt,
        follow_up_at: payload.followUpAt ?? null,
        channel: payload.channel ?? "",
        contact: payload.contact ?? "",
        notes: payload.notes ?? "",
      });

    if (result.changes === 0) {
      return res.status(404).json({ message: "记录不存在" });
    }

    const row = db
      .prepare("SELECT * FROM applications WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return res.json(row ? mapApplicationRow(row) : null);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: applications.post_id")) {
      return res.status(409).json({ message: "该岗位已存在投递记录，不能重复新增" });
    }
    return res.status(500).json({ message: "更新失败", error: String(error) });
  }
});

app.delete("/api/applications/:id", (req, res) => {
  const id = parsePositiveInt(req.params.id, 0);
  if (id <= 0) {
    return res.status(400).json({ message: "id 非法" });
  }

  const result = db.prepare("DELETE FROM applications WHERE id = ?").run(id);
  if (result.changes === 0) {
    return res.status(404).json({ message: "记录不存在" });
  }
  return res.json({ success: true });
});

const port = parsePositiveInt(process.env.PORT, 3001);
app.listen(port, () => {
  console.log(`[info] Backend listening on http://localhost:${port}`);
});
