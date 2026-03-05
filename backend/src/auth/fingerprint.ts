import crypto from "node:crypto";
import { FINGERPRINT_PEPPER } from "../constants";

export function hashFingerprint(visitorId: string): string {
  return crypto.createHash("sha256").update(`${visitorId}${FINGERPRINT_PEPPER}`).digest("hex");
}
