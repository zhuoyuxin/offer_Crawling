import crypto from "node:crypto";
import { TOKEN_PEPPER } from "../constants";

export function generateAccessToken(): string {
  return crypto.randomBytes(48).toString("base64url");
}

export function hashAccessToken(token: string): string {
  return crypto.createHash("sha256").update(`${token}${TOKEN_PEPPER}`).digest("hex");
}
