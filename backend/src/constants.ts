function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export const APPLICATION_STATUSES = [
  "未投递",
  "已投递",
  "已笔试",
  "已面试",
  "已挂",
  "面试通过",
  "暂不投递",
  "正在面试",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const USER_ROLES = ["user", "vip", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["active", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const SESSION_REVOKE_REASONS = [
  "NEW_LOGIN",
  "LOGOUT",
  "FINGERPRINT_MISMATCH",
  "ADMIN_FORCE_LOGOUT",
  "EXPIRED",
] as const;
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

export const ERROR_CODES = {
  UNAUTHORIZED: "UNAUTHORIZED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  SESSION_REVOKED: "SESSION_REVOKED",
  FINGERPRINT_MISMATCH: "FINGERPRINT_MISMATCH",
  FORBIDDEN: "FORBIDDEN",
  APP_LIMIT_REACHED: "APP_LIMIT_REACHED",
  EMAIL_EXISTS: "EMAIL_EXISTS",
  BAD_REQUEST: "BAD_REQUEST",
  NOT_FOUND: "NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const DEFAULT_SESSION_TTL_SECONDS = 10_800;
export const SESSION_TTL_SECONDS = readPositiveInt(
  process.env.SESSION_TTL_SECONDS,
  DEFAULT_SESSION_TTL_SECONDS
);

export const MAX_USER_APPLICATIONS = 30;
export const MAX_USER_JOB_RESULTS = 10;

export const BCRYPT_ROUNDS = readPositiveInt(process.env.BCRYPT_ROUNDS, 12);

const DEFAULT_TOKEN_PEPPER = "dev-token-pepper";
const DEFAULT_FINGERPRINT_PEPPER = "dev-fingerprint-pepper";
export const TOKEN_PEPPER = (process.env.TOKEN_PEPPER ?? DEFAULT_TOKEN_PEPPER).trim();
export const FINGERPRINT_PEPPER = (process.env.FINGERPRINT_PEPPER ?? DEFAULT_FINGERPRINT_PEPPER).trim();

export function validatePeppers(): void {
  const usingDefaults =
    TOKEN_PEPPER === DEFAULT_TOKEN_PEPPER || FINGERPRINT_PEPPER === DEFAULT_FINGERPRINT_PEPPER;
  const hasBlank = !TOKEN_PEPPER || !FINGERPRINT_PEPPER;
  if (!usingDefaults && !hasBlank) return;

  if (process.env.NODE_ENV === "production") {
    console.error(
      "[FATAL] TOKEN_PEPPER / FINGERPRINT_PEPPER must be set in production. Refusing to start."
    );
    process.exit(1);
  }
  console.warn("[WARN] TOKEN_PEPPER / FINGERPRINT_PEPPER are using insecure default values.");
}

/* ── CORS ── */
export const CORS_ORIGINS: string[] = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/* ── Rate-limit ── */
export const LOGIN_RATE_WINDOW_MS = readPositiveInt(process.env.LOGIN_RATE_WINDOW_MIN, 15) * 60_000;
export const LOGIN_RATE_MAX = readPositiveInt(process.env.LOGIN_RATE_MAX, 10);
export const REGISTER_RATE_WINDOW_MS = readPositiveInt(process.env.REGISTER_RATE_WINDOW_MIN, 60) * 60_000;
export const REGISTER_RATE_MAX = readPositiveInt(process.env.REGISTER_RATE_MAX, 5);
