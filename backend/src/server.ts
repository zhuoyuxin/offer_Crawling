import cors from "cors";
import express, { type Request } from "express";
import { z } from "zod";
import { hashFingerprint } from "./auth/fingerprint";
import { hashPassword, verifyPassword } from "./auth/password";
import { generateAccessToken, hashAccessToken } from "./auth/token";
import {
  APPLICATION_STATUSES,
  CORS_ORIGINS,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  ERROR_CODES,
  MAX_PAGE_SIZE,
  MAX_USER_APPLICATIONS,
  MAX_USER_JOB_RESULTS,
  SESSION_TTL_SECONDS,
  USER_ROLES,
  validatePeppers,
  type ApplicationStatus,
  type UserRole,
} from "./constants";
import { getDb, initDb } from "./db";
import { sendError } from "./http";
import { requireAuth } from "./middleware/auth";
import { requireRole } from "./middleware/requireRole";
import { loginLimiter, registerLimiter } from "./middleware/rateLimit";
import { addSeconds, toSqliteDateTime } from "./time";
import type {
  AdminUserListItem,
  ApplicationRecord,
  JobListItem,
  PaginatedResponse,
  PublicUser,
} from "./types";

interface LoginUserRow {
  id: number;
  email: string;
  password_hash: string;
  role: UserRole;
  status: "active" | "disabled";
}

function isStatus(value: string): value is ApplicationStatus {
  return APPLICATION_STATUSES.includes(value as ApplicationStatus);
}

function isRole(value: string): value is UserRole {
  return USER_ROLES.includes(value as UserRole);
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

function toPublicUser(input: Pick<LoginUserRow, "id" | "email" | "role">): PublicUser {
  return {
    id: Number(input.id),
    email: normalizeText(input.email),
    role: input.role,
  };
}

function mapJobRow(row: Record<string, unknown>): JobListItem {
  const applicationStatusRaw = normalizeText(row.application_status);
  const applicationStatus = isStatus(applicationStatusRaw) ? applicationStatusRaw : "未投递";
  return {
    postId: normalizeText(row.post_id),
    dataId: normalizeText(row.data_id),
    title: normalizeText(row.title),
    companyName: normalizeText(row.company_name),
    companyType: normalizeText(row.company_type),
    location: normalizeText(row.location),
    recruitmentType: normalizeText(row.recruitment_type),
    targetCandidates: normalizeText(row.target_candidates),
    position: normalizeText(row.position),
    progressStatus: normalizeText(row.progress_status),
    deadline: normalizeText(row.deadline),
    updateTime: normalizeText(row.update_time),
    detailUrl: normalizeText(row.detail_url),
    noticeUrl: normalizeText(row.notice_url),
    companySize: normalizeText(row.company_size),
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

function mapAdminUserRow(row: Record<string, unknown>): AdminUserListItem {
  return {
    id: Number(row.id),
    email: normalizeText(row.email),
    role: normalizeText(row.role) as UserRole,
    status: normalizeText(row.status) as "active" | "disabled",
    createdAt: normalizeText(row.created_at),
    updatedAt: normalizeText(row.updated_at),
    lastLoginAt: normalizeNullableText(row.last_login_at),
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

const registerSchema = z.object({
  email: z.string().trim().email("邮箱格式不正确"),
  password: z.string().min(8, "密码最少 8 位"),
});

const loginSchema = z.object({
  email: z.string().trim().email("邮箱格式不正确"),
  password: z.string().min(1, "密码不能为空"),
});

const adminRoleSchema = z.object({
  role: z.enum(["user", "vip"]),
});

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

function assertUserCanCreateApplication(userId: number, role: UserRole): boolean {
  if (role !== "user") {
    return true;
  }
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) AS total FROM applications WHERE user_id = @user_id")
    .get({ user_id: userId }) as { total: number };
  return Number(row.total) < MAX_USER_APPLICATIONS;
}

initDb();
validatePeppers();
const db = getDb();
const app = express();

if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/statuses", (_req, res) => {
  res.json({ statuses: APPLICATION_STATUSES });
});

app.post("/api/auth/register", registerLimiter, (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, parsed.error.issues[0]?.message ?? "参数不合法");
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;

  const exists = db
    .prepare("SELECT id FROM users WHERE email = @email")
    .get({ email }) as { id: number } | undefined;
  if (exists) {
    sendError(res, 409, ERROR_CODES.EMAIL_EXISTS, "邮箱已注册");
    return;
  }

  const now = toSqliteDateTime(new Date());
  const result = db
    .prepare(
      `
      INSERT INTO users (email, password_hash, role, status, created_at, updated_at)
      VALUES (@email, @password_hash, 'user', 'active', @created_at, @updated_at)
      `
    )
    .run({
      email,
      password_hash: hashPassword(password),
      created_at: now,
      updated_at: now,
    });

  const created = db
    .prepare("SELECT id, email, role FROM users WHERE id = @id")
    .get({ id: result.lastInsertRowid }) as LoginUserRow | undefined;

  res.status(201).json(created ? toPublicUser(created) : null);
});

app.post("/api/auth/login", loginLimiter, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, parsed.error.issues[0]?.message ?? "参数不合法");
    return;
  }

  const fingerprint = req.header("x-device-fingerprint")?.trim();
  if (!fingerprint) {
    sendError(res, 401, ERROR_CODES.UNAUTHORIZED, "缺少设备指纹");
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;

  const user = db
    .prepare("SELECT id, email, password_hash, role, status FROM users WHERE email = @email")
    .get({ email }) as LoginUserRow | undefined;
  if (!user || !verifyPassword(password, user.password_hash)) {
    sendError(res, 401, ERROR_CODES.UNAUTHORIZED, "邮箱或密码错误");
    return;
  }
  if (user.status !== "active") {
    sendError(res, 403, ERROR_CODES.FORBIDDEN, "账号不可用");
    return;
  }

  const now = new Date();
  const nowText = toSqliteDateTime(now);
  const expiresAt = toSqliteDateTime(addSeconds(now, SESSION_TTL_SECONDS));
  const accessToken = generateAccessToken();
  const tokenHash = hashAccessToken(accessToken);
  const fingerprintHash = hashFingerprint(fingerprint);

  const tx = db.transaction(() => {
    db.prepare(
      `
      UPDATE user_sessions
      SET revoked_at = @revoked_at, revoked_reason = 'NEW_LOGIN'
      WHERE user_id = @user_id AND revoked_at IS NULL
      `
    ).run({
      user_id: user.id,
      revoked_at: nowText,
    });

    db.prepare(
      `
      INSERT INTO user_sessions (
        user_id,
        token_hash,
        fingerprint_hash,
        expires_at,
        last_seen_at
      ) VALUES (
        @user_id,
        @token_hash,
        @fingerprint_hash,
        @expires_at,
        @last_seen_at
      )
      `
    ).run({
      user_id: user.id,
      token_hash: tokenHash,
      fingerprint_hash: fingerprintHash,
      expires_at: expiresAt,
      last_seen_at: nowText,
    });

    db.prepare(
      `
      UPDATE users
      SET last_login_at = @last_login_at, updated_at = @updated_at
      WHERE id = @id
      `
    ).run({
      id: user.id,
      last_login_at: nowText,
      updated_at: nowText,
    });
  });

  tx();

  res.json({
    accessToken,
    expiresAt,
    user: toPublicUser(user),
  });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  db.prepare(
    `
    UPDATE user_sessions
    SET revoked_at = @revoked_at, revoked_reason = 'LOGOUT'
    WHERE id = @id AND revoked_at IS NULL
    `
  ).run({
    id: req.auth!.sessionId,
    revoked_at: toSqliteDateTime(new Date()),
  });

  res.json({ success: true });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json(toPublicUser(req.auth!.user));
});

app.get("/api/jobs", requireAuth, (req, res) => {
  const user = req.auth!.user;
  const { page, pageSize } = parsePage(req);
  const q = normalizeText(req.query.q);
  const status = normalizeText(req.query.status);

  if (status && status !== "全部" && !isStatus(status)) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, "无效状态筛选");
    return;
  }

  const filters: string[] = [];
  const params: Record<string, unknown> = {
    user_id: user.id,
  };

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
  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM jobs j
      LEFT JOIN applications a ON a.post_id = j.post_id AND a.user_id = @user_id
      ${whereSql}
      `
    )
    .get(params) as { total: number };

  const total = Number(totalRow.total);
  if (user.role === "user") {
    const rows = db
      .prepare(
        `
        SELECT
          j.*,
          a.id AS application_id,
          COALESCE(a.status, '未投递') AS application_status
        FROM jobs j
        LEFT JOIN applications a ON a.post_id = j.post_id AND a.user_id = @user_id
        ${whereSql}
        ORDER BY j.update_time DESC, j.post_id DESC
        LIMIT @limit
        `
      )
      .all({ ...params, limit: MAX_USER_JOB_RESULTS }) as Record<string, unknown>[];

    res.json({
      items: rows.map(mapJobRow),
      page: 1,
      pageSize: MAX_USER_JOB_RESULTS,
      total: Math.min(total, MAX_USER_JOB_RESULTS),
      totalPages: 1,
    });
    return;
  }

  const offset = (page - 1) * pageSize;
  const rows = db
    .prepare(
      `
      SELECT
        j.*,
        a.id AS application_id,
        COALESCE(a.status, '未投递') AS application_status
      FROM jobs j
      LEFT JOIN applications a ON a.post_id = j.post_id AND a.user_id = @user_id
      ${whereSql}
      ORDER BY j.update_time DESC, j.post_id DESC
      LIMIT @limit OFFSET @offset
      `
    )
    .all({ ...params, limit: pageSize, offset }) as Record<string, unknown>[];

  res.json(buildPagination(rows.map(mapJobRow), page, pageSize, total));
});

app.post("/api/jobs/:postId/apply", requireAuth, (req, res) => {
  const user = req.auth!.user;
  const postId = normalizeText(req.params.postId);
  if (!postId) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, "postId 不能为空");
    return;
  }

  const job = db
    .prepare("SELECT * FROM jobs WHERE post_id = @post_id")
    .get({ post_id: postId }) as Record<string, unknown> | undefined;
  if (!job) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, "岗位不存在");
    return;
  }

  const existing = db
    .prepare("SELECT * FROM applications WHERE user_id = @user_id AND post_id = @post_id")
    .get({ user_id: user.id, post_id: postId }) as Record<string, unknown> | undefined;
  if (existing) {
    res.json({ created: false, record: mapApplicationRow(existing) });
    return;
  }

  if (!assertUserCanCreateApplication(user.id, user.role)) {
    sendError(
      res,
      400,
      ERROR_CODES.APP_LIMIT_REACHED,
      `普通用户最多保留 ${MAX_USER_APPLICATIONS} 条投递记录，请删除后再试`
    );
    return;
  }

  const result = db
    .prepare(
      `
      INSERT INTO applications (
        user_id,
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
        @user_id,
        @post_id,
        @company_name,
        @position,
        @location,
        @detail_url,
        '已投递',
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
      user_id: user.id,
      post_id: postId,
      company_name: normalizeText(job.company_name),
      position: normalizeText(job.position) || normalizeText(job.title),
      location: normalizeText(job.location),
      detail_url: normalizeText(job.detail_url),
      applied_at: todayDate(),
    });

  const created = db
    .prepare("SELECT * FROM applications WHERE id = @id")
    .get({ id: result.lastInsertRowid }) as Record<string, unknown> | undefined;
  res.status(201).json({ created: true, record: created ? mapApplicationRow(created) : null });
});

app.get("/api/applications", requireAuth, (req, res) => {
  const user = req.auth!.user;
  const requestedStatus = normalizeText(req.query.status);
  if (requestedStatus && requestedStatus !== "全部" && !isStatus(requestedStatus)) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, "无效状态筛选");
    return;
  }

  const q = normalizeText(req.query.q);
  let { page, pageSize } = parsePage(req);
  const focusId = parsePositiveInt(req.query.focusId, 0);

  const filters: string[] = ["a.user_id = @user_id"];
  const params: Record<string, unknown> = {
    user_id: user.id,
  };

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

  const whereSql = `WHERE ${filters.join(" AND ")}`;

  if (focusId > 0) {
    const rankRow = db
      .prepare(
        `
        WITH ordered AS (
          SELECT a.id, ROW_NUMBER() OVER (ORDER BY a.updated_at DESC, a.id DESC) AS rn
          FROM applications a
          ${whereSql}
        )
        SELECT rn FROM ordered WHERE id = @focus_id
        `
      )
      .get({ ...params, focus_id: focusId }) as { rn?: number } | undefined;
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

  res.json(buildPagination(rows.map(mapApplicationRow), page, pageSize, total));
});

app.get("/api/applications/:id", requireAuth, (req, res) => {
  const user = req.auth!.user;
  const id = parsePositiveInt(req.params.id, 0);
  if (id <= 0) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, "id 非法");
    return;
  }

  const row = db
    .prepare("SELECT * FROM applications WHERE id = @id AND user_id = @user_id")
    .get({ id, user_id: user.id }) as Record<string, unknown> | undefined;
  if (!row) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, "记录不存在");
    return;
  }

  res.json(mapApplicationRow(row));
});

app.post("/api/applications", requireAuth, (req, res) => {
  const user = req.auth!.user;
  if (!assertUserCanCreateApplication(user.id, user.role)) {
    sendError(
      res,
      400,
      ERROR_CODES.APP_LIMIT_REACHED,
      `普通用户最多保留 ${MAX_USER_APPLICATIONS} 条投递记录，请删除后再试`
    );
    return;
  }

  const parsed = applicationInputSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, parsed.error.issues[0]?.message ?? "参数不合法");
    return;
  }
  const payload = parsed.data;

  try {
    const result = db
      .prepare(
        `
        INSERT INTO applications (
          user_id,
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
          @user_id,
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
        user_id: user.id,
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
      .prepare("SELECT * FROM applications WHERE id = @id")
      .get({ id: result.lastInsertRowid }) as Record<string, unknown> | undefined;
    res.status(201).json(row ? mapApplicationRow(row) : null);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: applications.user_id, applications.post_id")) {
      sendError(res, 409, ERROR_CODES.BAD_REQUEST, "该岗位已存在投递记录，不能重复创建");
      return;
    }
    sendError(res, 500, ERROR_CODES.INTERNAL_ERROR, "创建失败");
  }
});

app.put("/api/applications/:id", requireAuth, (req, res) => {
  const user = req.auth!.user;
  const id = parsePositiveInt(req.params.id, 0);
  if (id <= 0) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, "id 非法");
    return;
  }

  const parsed = applicationInputSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, parsed.error.issues[0]?.message ?? "参数不合法");
    return;
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
        WHERE id = @id AND user_id = @user_id
        `
      )
      .run({
        id,
        user_id: user.id,
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
      sendError(res, 404, ERROR_CODES.NOT_FOUND, "记录不存在");
      return;
    }

    const row = db
      .prepare("SELECT * FROM applications WHERE id = @id")
      .get({ id }) as Record<string, unknown> | undefined;
    res.json(row ? mapApplicationRow(row) : null);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: applications.user_id, applications.post_id")) {
      sendError(res, 409, ERROR_CODES.BAD_REQUEST, "该岗位已存在投递记录，不能重复绑定");
      return;
    }
    sendError(res, 500, ERROR_CODES.INTERNAL_ERROR, "更新失败");
  }
});

app.delete("/api/applications/:id", requireAuth, (req, res) => {
  const user = req.auth!.user;
  const id = parsePositiveInt(req.params.id, 0);
  if (id <= 0) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, "id 非法");
    return;
  }

  const result = db.prepare("DELETE FROM applications WHERE id = @id AND user_id = @user_id").run({
    id,
    user_id: user.id,
  });
  if (result.changes === 0) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, "记录不存在");
    return;
  }
  res.json({ success: true });
});

app.get("/api/admin/users", requireAuth, requireRole(["admin"]), (req, res) => {
  const { page, pageSize } = parsePage(req);
  const q = normalizeText(req.query.q);
  const role = normalizeText(req.query.role);

  if (role && role !== "all" && !isRole(role)) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, "无效角色筛选");
    return;
  }

  const filters: string[] = [];
  const params: Record<string, unknown> = {};
  if (q) {
    filters.push("email LIKE @kw");
    params.kw = `%${q}%`;
  }
  if (role && role !== "all") {
    filters.push("role = @role");
    params.role = role;
  }

  const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS total FROM users ${whereSql}`)
    .get(params) as { total: number };
  const total = Number(totalRow.total);
  const offset = (page - 1) * pageSize;

  const rows = db
    .prepare(
      `
      SELECT id, email, role, status, created_at, updated_at, last_login_at
      FROM users
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT @limit OFFSET @offset
      `
    )
    .all({ ...params, limit: pageSize, offset }) as Record<string, unknown>[];

  res.json(buildPagination(rows.map(mapAdminUserRow), page, pageSize, total));
});

app.patch("/api/admin/users/:id/role", requireAuth, requireRole(["admin"]), (req, res) => {
  const id = parsePositiveInt(req.params.id, 0);
  if (id <= 0) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, "id 非法");
    return;
  }

  const parsed = adminRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, parsed.error.issues[0]?.message ?? "参数不合法");
    return;
  }

  const target = db
    .prepare("SELECT id, email, role, status, created_at, updated_at, last_login_at FROM users WHERE id = @id")
    .get({ id }) as Record<string, unknown> | undefined;
  if (!target) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, "用户不存在");
    return;
  }

  const currentRole = normalizeText(target.role);
  if (currentRole === "admin") {
    const adminCount = db
      .prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'")
      .get() as { total: number };
    if (Number(adminCount.total) <= 1) {
      sendError(res, 400, ERROR_CODES.FORBIDDEN, "不能降级最后一个 admin");
      return;
    }
  }

  db.prepare(
    `
    UPDATE users
    SET role = @role, updated_at = @updated_at
    WHERE id = @id
    `
  ).run({
    id,
    role: parsed.data.role,
    updated_at: toSqliteDateTime(new Date()),
  });

  const updated = db
    .prepare("SELECT id, email, role, status, created_at, updated_at, last_login_at FROM users WHERE id = @id")
    .get({ id }) as Record<string, unknown> | undefined;
  res.json(updated ? mapAdminUserRow(updated) : null);
});

app.post("/api/admin/users/:id/force-logout", requireAuth, requireRole(["admin"]), (req, res) => {
  const id = parsePositiveInt(req.params.id, 0);
  if (id <= 0) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, "id 非法");
    return;
  }

  const userExists = db.prepare("SELECT id FROM users WHERE id = @id").get({ id }) as { id: number } | undefined;
  if (!userExists) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, "用户不存在");
    return;
  }

  const result = db
    .prepare(
      `
      UPDATE user_sessions
      SET revoked_at = @revoked_at, revoked_reason = 'ADMIN_FORCE_LOGOUT'
      WHERE user_id = @user_id AND revoked_at IS NULL
      `
    )
    .run({
      user_id: id,
      revoked_at: toSqliteDateTime(new Date()),
    });

  res.json({ success: true, revoked: result.changes });
});

const port = parsePositiveInt(process.env.PORT, 3001);
app.listen(port, () => {
  console.log(`[info] Backend listening on http://localhost:${port}`);
});
