import bcrypt from "bcryptjs";
import { BCRYPT_ROUNDS } from "../constants";

export function hashPassword(rawPassword: string): string {
  return bcrypt.hashSync(rawPassword, BCRYPT_ROUNDS);
}

export function verifyPassword(rawPassword: string, passwordHash: string): boolean {
  return bcrypt.compareSync(rawPassword, passwordHash);
}
