// How the admin page writes numbers, money, dates and countries.

/** "£4.12"; whole amounts without the pence when `whole` ("£5"). */
export function money(n: number, currency: string, whole = false): string {
  const digits = whole && Number.isInteger(n) ? 0 : 2;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  } catch {
    return `${currency.toUpperCase()} ${n.toFixed(digits)}`;
  }
}

/** "$1.23", for what the model providers charged. */
export function usd(n: number): string {
  return money(n, "usd");
}

/** "1,284", "12.9K", "4.2M". */
export function count(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
}

/** "38%" of a whole, "0.3%" below ten; "–" when there is none. */
export function share(part: number, whole: number): string {
  if (whole <= 0) return "–";
  const p = (part / whole) * 100;
  return `${p > 0 && p < 10 ? +p.toFixed(1) : Math.round(p)}%`;
}

/** "1.2 GB". */
export function bytes(n: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${n} bytes` : `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** "4 min", "1 h 20 min". */
export function minutes(m: number): string {
  if (m < 1) return m <= 0 ? "under a minute" : "about a minute";
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  const rest = Math.round(m - h * 60);
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** "3 Nov" (and the year when it isn't this one). */
export function day(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}

/** "3 Nov, 14:05". */
export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", then the date. */
export function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)} days ago`;
  return day(iso);
}

let regions: Intl.DisplayNames | null = null;

/** "🇬🇧 United Kingdom" for "GB". */
export function country(code: string): string {
  const flag = String.fromCodePoint(...[...code.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
  try {
    regions ??= new Intl.DisplayNames(undefined, { type: "region" });
    return `${flag} ${regions.of(code) ?? code}`;
  } catch {
    return `${flag} ${code}`;
  }
}

/** A change on the period before, as "+12%" or "−3%" (null when there's nothing to compare with). */
export function change(now: number, before: number): { text: string; up: boolean } | null {
  if (before <= 0) return null;
  const p = Math.round(((now - before) / before) * 100);
  return { text: `${p > 0 ? "+" : p < 0 ? "−" : "±"}${Math.abs(p)}%`, up: p >= 0 };
}
