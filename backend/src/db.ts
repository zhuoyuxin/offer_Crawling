import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { hashPassword } from "./auth/password";
import { APPLICATION_STATUSES, USER_ROLES } from "./constants";
import { nowSqliteDateTime } from "./time";

const BACKEND_ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(BACKEND_ROOT, "..");
const DEFAULT_DB_PATH = path.resolve(PROJECT_ROOT, "data", "jobs.db");
const DEFAULT_JSON_PATH = path.resolve(PROJECT_ROOT, "jobs.json");

const JOB_COLUMNS = [
  "post_id",
  "data_id",
  "title",
  "company_name",
  "company_type",
  "location",
  "recruitment_type",
  "target_candidates",
  "position",
  "progress_status",
  "deadline",
  "update_time",
  "detail_url",
  "notice_url",
  "company_size",
  "source_page",
  "crawled_at",
] as const;

type JobColumn = (typeof JOB_COLUMNS)[number];

let dbInstance: Database.Database | null = null;

function getDbPath(): string {
  return process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : DEFAULT_DB_PATH;
}

function normalizeText(input: unknown): string {
  if (input === undefined || input === null) {
    return "";
  }
  return String(input).trim();
}

function toRecordValue(item: unknown, key: JobColumn): string {
  if (!item || typeof item !== "object") {
    return "";
  }
  const raw = (item as Record<string, unknown>)[key];
  return normalizeText(raw);
}

function escapeSqlText(value: string): string {
  return value.replace(/'/g, "''");
}

function hasTable(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(name) as { name: string } | undefined;
  return Boolean(row?.name);
}

function ensureJobsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      post_id TEXT PRIMARY KEY,
      data_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      company_type TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      recruitment_type TEXT NOT NULL DEFAULT '',
      target_candidates TEXT NOT NULL DEFAULT '',
      position TEXT NOT NULL DEFAULT '',
      progress_status TEXT NOT NULL DEFAULT '',
      deadline TEXT NOT NULL DEFAULT '',
      update_time TEXT NOT NULL DEFAULT '',
      detail_url TEXT NOT NULL DEFAULT '',
      notice_url TEXT NOT NULL DEFAULT '',
      company_size TEXT NOT NULL DEFAULT '',
      source_page TEXT NOT NULL DEFAULT '',
      crawled_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_company_position ON jobs(company_name, position);
    CREATE INDEX IF NOT EXISTS idx_jobs_update_time ON jobs(update_time);
  `);

  const newColumns: Array<[string, string]> = [
    ["company_type", "TEXT NOT NULL DEFAULT ''"],
    ["notice_url", "TEXT NOT NULL DEFAULT ''"],
    ["company_size", "TEXT NOT NULL DEFAULT ''"],
  ];
  const existingCols = new Set(
    (db.pragma("table_info('jobs')") as Array<{ name: string }>).map((c) => c.name)
  );
  for (const [colName, colDef] of newColumns) {
    if (!existingCols.has(colName)) {
      db.exec(`ALTER TABLE jobs ADD COLUMN ${colName} ${colDef}`);
      console.log(`[info] 已为 jobs 表新增列: ${colName}`);
    }
  }

  const duplicate = db
    .prepare(
      `
      SELECT data_id AS data_id, COUNT(*) AS total
      FROM jobs
      GROUP BY data_id
      HAVING COUNT(*) > 1
      LIMIT 1
      `
    )
    .get() as { data_id: string; total: number } | undefined;

  if (duplicate) {
    throw new Error(
      `jobs 表存在重复 data_id（示例：${duplicate.data_id}，数量：${duplicate.total}），请先清理后再启动服务`
    );
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_data_id_unique
    ON jobs(data_id);
  `);
}

function ensureUsersSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN (${USER_ROLES.map((role) => `'${escapeSqlText(role)}'`).join(", ")})) DEFAULT 'user',
      status TEXT NOT NULL CHECK(status IN ('active', 'disabled')) DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);
  `);
}

function ensureSessionsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      fingerprint_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT NULL,
      revoked_reason TEXT NULL CHECK(revoked_reason IN ('NEW_LOGIN', 'LOGOUT', 'FINGERPRINT_MISMATCH', 'ADMIN_FORCE_LOGOUT', 'EXPIRED')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active ON user_sessions(user_id, revoked_at, expires_at);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
  `);
}

function createApplicationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      post_id TEXT NULL,
      company_name TEXT NOT NULL,
      position TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      detail_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN (${APPLICATION_STATUSES.map((status) => `'${escapeSqlText(status)}'`).join(", ")})),
      applied_at TEXT NOT NULL,
      follow_up_at TEXT NULL,
      channel TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_applications_user_updated ON applications(user_id, updated_at DESC);
    CREATE UNIQUE INDEX idx_applications_user_post_unique ON applications(user_id, post_id) WHERE post_id IS NOT NULL;
  `);
}

function ensureApplicationsSchema(db: Database.Database): void {
  const rebuild = (() => {
    if (!hasTable(db, "applications")) {
      return false;
    }
    const columns = db.pragma("table_info('applications')") as Array<{ name: string }>;
    return !columns.some((item) => item.name === "user_id");
  })();

  if (rebuild) {
    db.exec("DROP TABLE IF EXISTS applications;");
  }

  if (!hasTable(db, "applications")) {
    createApplicationsTable(db);
    return;
  }

  db.exec(`
    DROP INDEX IF EXISTS idx_applications_post_id_unique;
    CREATE INDEX IF NOT EXISTS idx_applications_user_updated ON applications(user_id, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_user_post_unique ON applications(user_id, post_id) WHERE post_id IS NOT NULL;
  `);
}

function ensureSchema(db: Database.Database): void {
  ensureJobsSchema(db);
  ensureUsersSchema(db);
  ensureSessionsSchema(db);
  ensureApplicationsSchema(db);
}

function importJobsFromJsonIfNeeded(db: Database.Database): void {
  const row = db.prepare("SELECT COUNT(*) AS total FROM jobs").get() as { total: number };
  if (row.total > 0 || !fs.existsSync(DEFAULT_JSON_PATH)) {
    return;
  }

  let parsed: unknown;
  try {
    const raw = fs.readFileSync(DEFAULT_JSON_PATH, "utf-8");
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn("[warn] 读取 jobs.json 失败，跳过自动导入:", error);
    return;
  }

  if (!Array.isArray(parsed)) {
    console.warn("[warn] jobs.json 不是数组，跳过自动导入");
    return;
  }

  const insert = db.prepare(`
    INSERT INTO jobs (
      post_id,
      data_id,
      title,
      company_name,
      company_type,
      location,
      recruitment_type,
      target_candidates,
      position,
      progress_status,
      deadline,
      update_time,
      detail_url,
      notice_url,
      company_size,
      source_page,
      crawled_at,
      updated_at
    )
    VALUES (
      @post_id,
      @data_id,
      @title,
      @company_name,
      @company_type,
      @location,
      @recruitment_type,
      @target_candidates,
      @position,
      @progress_status,
      @deadline,
      @update_time,
      @detail_url,
      @notice_url,
      @company_size,
      @source_page,
      @crawled_at,
      datetime('now')
    )
    ON CONFLICT(data_id) DO UPDATE SET
      post_id=excluded.post_id,
      data_id=excluded.data_id,
      title=excluded.title,
      company_name=excluded.company_name,
      company_type=excluded.company_type,
      location=excluded.location,
      recruitment_type=excluded.recruitment_type,
      target_candidates=excluded.target_candidates,
      position=excluded.position,
      progress_status=excluded.progress_status,
      deadline=excluded.deadline,
      update_time=excluded.update_time,
      detail_url=excluded.detail_url,
      notice_url=excluded.notice_url,
      company_size=excluded.company_size,
      source_page=excluded.source_page,
      crawled_at=excluded.crawled_at,
      updated_at=datetime('now')
  `);

  let imported = 0;
  const tx = db.transaction((items: unknown[]) => {
    for (const item of items) {
      const rawPostId = toRecordValue(item, "post_id");
      if (!rawPostId) {
        continue;
      }
      const dataId = toRecordValue(item, "data_id") || rawPostId;
      const payload: Record<JobColumn, string> = {
        post_id: rawPostId,
        data_id: dataId,
        title: toRecordValue(item, "title"),
        company_name: toRecordValue(item, "company_name"),
        company_type: toRecordValue(item, "company_type"),
        location: toRecordValue(item, "location"),
        recruitment_type: toRecordValue(item, "recruitment_type"),
        target_candidates: toRecordValue(item, "target_candidates"),
        position: toRecordValue(item, "position"),
        progress_status: toRecordValue(item, "progress_status"),
        deadline: toRecordValue(item, "deadline"),
        update_time: toRecordValue(item, "update_time"),
        detail_url: toRecordValue(item, "detail_url"),
        notice_url: toRecordValue(item, "notice_url"),
        company_size: toRecordValue(item, "company_size"),
        source_page: toRecordValue(item, "source_page"),
        crawled_at: toRecordValue(item, "crawled_at"),
      };
      insert.run(payload);
      imported += 1;
    }
  });

  tx(parsed);
  console.log(`[info] 自动导入 jobs.json 完成，共 ${imported} 条`);
}

function ensureInitialAdminUser(db: Database.Database): void {
  const row = db
    .prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'")
    .get() as { total: number };
  if (row.total > 0) {
    return;
  }

  const email = normalizeText(process.env.ADMIN_EMAIL).toLowerCase();
  const password = normalizeText(process.env.ADMIN_PASSWORD);
  if (!email || !password) {
    console.warn("[warn] 当前无 admin 用户，但 ADMIN_EMAIL / ADMIN_PASSWORD 未配置，已跳过初始化管理员");
    return;
  }
  if (password.length < 8) {
    console.warn("[warn] ADMIN_PASSWORD 长度不足 8，已跳过初始化管理员");
    return;
  }

  const now = nowSqliteDateTime();
  db.prepare(
    `
    INSERT INTO users (email, password_hash, role, status, created_at, updated_at)
    VALUES (@email, @password_hash, 'admin', 'active', @created_at, @updated_at)
    `
  ).run({
    email,
    password_hash: hashPassword(password),
    created_at: now,
    updated_at: now,
  });
  console.log(`[info] 已创建初始管理员: ${email}`);
}

export function initDb(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  ensureSchema(db);
  importJobsFromJsonIfNeeded(db);
  ensureInitialAdminUser(db);

  dbInstance = db;
  console.log(`[info] SQLite 已就绪: ${dbPath}`);
  return dbInstance;
}

export function getDb(): Database.Database {
  return dbInstance ?? initDb();
}
