const TZ = "Asia/Shanghai";

function formatInTz(date: Date): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export function toSqliteDateTime(date: Date): string {
  return formatInTz(date);
}

export function nowSqliteDateTime(): string {
  return toSqliteDateTime(new Date());
}

export function todayDateCST(): string {
  return formatInTz(new Date()).slice(0, 10);
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

export function parseSqliteDateTime(value: string): Date {
  return new Date(value.replace(" ", "T") + "+08:00");
}

export function isExpired(expiresAt: string, now: Date): boolean {
  const expiresTime = parseSqliteDateTime(expiresAt).getTime();
  return Number.isNaN(expiresTime) || expiresTime <= now.getTime();
}
