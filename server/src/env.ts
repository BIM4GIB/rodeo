// Reads environment variables with checks. A bad value stops the server at start-up.

export function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

function bad(name: string, what: string): never {
  throw new Error(`${name} must be ${what}`);
}

export function envInt(name: string, fallback: number): number {
  const v = env(name);
  if (v === undefined) return fallback;
  if (!/^\d+$/.test(v)) bad(name, "a whole number");
  return Number(v);
}

export function envNumber(name: string): number | undefined {
  const v = env(name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) bad(name, "a number");
  return n;
}

export function envBool(name: string, fallback: boolean): boolean {
  const v = env(name)?.toLowerCase();
  if (v === undefined) return fallback;
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return bad(name, "true or false");
}

const SIZE = /^(\d+(?:\.\d+)?)\s*(b|k|kb|m|mb|g|gb|t|tb)?$/i;
const MULTIPLIER: Record<string, number> = { b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };

/** A byte size: a number of bytes, or with a unit such as 250MB or 20GB (binary units). */
export function envBytes(name: string, fallback: number): number {
  const v = env(name);
  if (v === undefined) return fallback;
  const m = SIZE.exec(v);
  if (!m) bad(name, "a size such as 250MB or 20GB, or a number of bytes");
  const unit = (m[2] ?? "b").toLowerCase().charAt(0);
  return Math.round(Number(m[1]) * (MULTIPLIER[unit] ?? 1));
}

export function envList(name: string): string[] {
  return (env(name) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
