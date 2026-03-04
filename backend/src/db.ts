import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const BACKEND_ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(BACKEND_ROOT, "..");
const DEFAULT_DB_PATH = path.resolve(PROJECT_ROOT, "data", "jobs.db");
const DEFAULT_JSON_PATH = path.resolve(PROJECT_ROOT, "jobs.json");

const JOB_COLUMNS = [
  "post_id",
  "data_id",
  "title",
  "company_name",
  "location",
  "recruitment_type",
  "target_candidates",
  "position",
  "progress_status",
  "deadline",
  "update_time",
  "detail_url",
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

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      post_id TEXT PRIMARY KEY,
      data_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      recruitment_type TEXT NOT NULL DEFAULT '',
      target_candidates TEXT NOT NULL DEFAULT '',
      position TEXT NOT NULL DEFAULT '',
      progress_status TEXT NOT NULL DEFAULT '',
      deadline TEXT NOT NULL DEFAULT '',
      update_time TEXT NOT NULL DEFAULT '',
      detail_url TEXT NOT NULL DEFAULT '',
      source_page TEXT NOT NULL DEFAULT '',
      crawled_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_company_position ON jobs(company_name, position);
    CREATE INDEX IF NOT EXISTS idx_jobs_update_time ON jobs(update_time);

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id TEXT NULL,
      company_name TEXT NOT NULL,
      position TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      detail_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('未投递','已投递','已笔试','已面试','已挂','面试通过','暂不投递','正在面试')),
      applied_at TEXT NOT NULL,
      follow_up_at TEXT NULL,
      channel TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_post_id_unique
    ON applications(post_id)
    WHERE post_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_applications_status_updated
    ON applications(status, updated_at DESC);
  `);

  const duplicate = db
    .prepare(
      `
      SELECT data_id AS dataId, COUNT(*) AS total
      FROM jobs
      GROUP BY data_id
      HAVING COUNT(*) > 1
      LIMIT 1
      `
    )
    .get() as { dataId: string; total: number } | undefined;

  if (duplicate) {
    throw new Error(
      `jobs 表存在重复 data_id（示例：${JSON.stringify(duplicate.dataId)}，数量：${duplicate.total}），无法启用 data_id 唯一约束，请先清理重复数据`
    );
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_data_id_unique
    ON jobs(data_id);
  `);
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
    console.warn("[warn] 读取 jobs.json 失败，跳过自动导入：", error);
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
      location,
      recruitment_type,
      target_candidates,
      position,
      progress_status,
      deadline,
      update_time,
      detail_url,
      source_page,
      crawled_at,
      updated_at
    )
    VALUES (
      @post_id,
      @data_id,
      @title,
      @company_name,
      @location,
      @recruitment_type,
      @target_candidates,
      @position,
      @progress_status,
      @deadline,
      @update_time,
      @detail_url,
      @source_page,
      @crawled_at,
      datetime('now')
    )
    ON CONFLICT(data_id) DO UPDATE SET
      post_id=excluded.post_id,
      data_id=excluded.data_id,
      title=excluded.title,
      company_name=excluded.company_name,
      location=excluded.location,
      recruitment_type=excluded.recruitment_type,
      target_candidates=excluded.target_candidates,
      position=excluded.position,
      progress_status=excluded.progress_status,
      deadline=excluded.deadline,
      update_time=excluded.update_time,
      detail_url=excluded.detail_url,
      source_page=excluded.source_page,
      crawled_at=excluded.crawled_at,
      updated_at=datetime('now')
  `);

  let imported = 0;
  const tx = db.transaction((items: unknown[]) => {
    for (const item of items) {
      const postId = toRecordValue(item, "post_id");
      if (!postId) {
        continue;
      }
      const dataId = toRecordValue(item, "data_id") || postId;
      const payload: Record<JobColumn, string> = {
        post_id: dataId,
        data_id: dataId,
        title: toRecordValue(item, "title"),
        company_name: toRecordValue(item, "company_name"),
        location: toRecordValue(item, "location"),
        recruitment_type: toRecordValue(item, "recruitment_type"),
        target_candidates: toRecordValue(item, "target_candidates"),
        position: toRecordValue(item, "position"),
        progress_status: toRecordValue(item, "progress_status"),
        deadline: toRecordValue(item, "deadline"),
        update_time: toRecordValue(item, "update_time"),
        detail_url: toRecordValue(item, "detail_url"),
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

export function initDb(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  ensureSchema(db);
  importJobsFromJsonIfNeeded(db);

  dbInstance = db;
  console.log(`[info] SQLite 已就绪：${dbPath}`);
  return dbInstance;
}

export function getDb(): Database.Database {
  return dbInstance ?? initDb();
}
