import type { NextFunction, Request, Response } from "express";
import { hashFingerprint } from "../auth/fingerprint";
import { hashAccessToken } from "../auth/token";
import { ERROR_CODES, SESSION_TTL_SECONDS, type SessionRevokeReason } from "../constants";
import { getDb } from "../db";
import { sendError } from "../http";
import { addSeconds, isExpired, toSqliteDateTime } from "../time";

interface SessionLookupRow {
  session_id: number;
  token_hash: string;
  fingerprint_hash: string;
  expires_at: string;
  revoked_at: string | null;
  user_id: number;
  email: string;
  role: "user" | "vip" | "admin";
  status: "active" | "disabled";
}

function extractBearerToken(req: Request): string | null {
  const auth = req.header("authorization");
  if (!auth) {
    return null;
  }
  const [schema, value] = auth.split(" ");
  if (schema?.toLowerCase() !== "bearer" || !value?.trim()) {
    return null;
  }
  return value.trim();
}

function revokeSession(sessionId: number, reason: SessionRevokeReason): void {
  const db = getDb();
  db.prepare(
    `
    UPDATE user_sessions
    SET revoked_at = @revoked_at, revoked_reason = @revoked_reason
    WHERE id = @id AND revoked_at IS NULL
    `
  ).run({
    id: sessionId,
    revoked_at: toSqliteDateTime(new Date()),
    revoked_reason: reason,
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const db = getDb();
  const token = extractBearerToken(req);
  const fingerprint = req.header("x-device-fingerprint")?.trim();

  if (!token || !fingerprint) {
    sendError(res, 401, ERROR_CODES.UNAUTHORIZED, "缺少登录令牌或设备指纹");
    return;
  }

  const tokenHash = hashAccessToken(token);
  const row = db
    .prepare(
      `
      SELECT
        s.id AS session_id,
        s.token_hash,
        s.fingerprint_hash,
        s.expires_at,
        s.revoked_at,
        u.id AS user_id,
        u.email,
        u.role,
        u.status
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = @token_hash
      LIMIT 1
      `
    )
    .get({ token_hash: tokenHash }) as SessionLookupRow | undefined;

  if (!row) {
    sendError(res, 401, ERROR_CODES.UNAUTHORIZED, "登录态无效");
    return;
  }

  if (row.revoked_at) {
    sendError(res, 401, ERROR_CODES.SESSION_REVOKED, "会话已失效，请重新登录");
    return;
  }

  const now = new Date();
  if (isExpired(row.expires_at, now)) {
    revokeSession(row.session_id, "EXPIRED");
    sendError(res, 401, ERROR_CODES.SESSION_EXPIRED, "会话已过期，请重新登录");
    return;
  }

  const requestFingerprintHash = hashFingerprint(fingerprint);
  if (requestFingerprintHash !== row.fingerprint_hash) {
    revokeSession(row.session_id, "FINGERPRINT_MISMATCH");
    sendError(res, 401, ERROR_CODES.FINGERPRINT_MISMATCH, "设备指纹不匹配，请重新登录");
    return;
  }

  if (row.status !== "active") {
    revokeSession(row.session_id, "EXPIRED");
    sendError(res, 403, ERROR_CODES.FORBIDDEN, "账号已被禁用");
    return;
  }

  const nextExpiresAt = toSqliteDateTime(addSeconds(now, SESSION_TTL_SECONDS));
  const nowText = toSqliteDateTime(now);
  db.prepare(
    `
    UPDATE user_sessions
    SET last_seen_at = @last_seen_at, expires_at = @expires_at
    WHERE id = @id
    `
  ).run({
    id: row.session_id,
    last_seen_at: nowText,
    expires_at: nextExpiresAt,
  });

  req.auth = {
    sessionId: row.session_id,
    tokenHash: row.token_hash,
    fingerprintHash: row.fingerprint_hash,
    expiresAt: nextExpiresAt,
    user: {
      id: row.user_id,
      email: row.email,
      role: row.role,
      status: row.status,
    },
  };

  next();
}
