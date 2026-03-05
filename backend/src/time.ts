export function toSqliteDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function nowSqliteDateTime(): string {
  return toSqliteDateTime(new Date());
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

export function parseSqliteDateTime(value: string): Date {
  return new Date(value.replace(" ", "T") + "Z");
}

export function isExpired(expiresAt: string, now: Date): boolean {
  const expiresTime = parseSqliteDateTime(expiresAt).getTime();
  return Number.isNaN(expiresTime) || expiresTime <= now.getTime();
}
