// Small formatters for the account UI: sizes, money, dates, avatars and the links it follows.

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** One decimal below 10, whole above: 2.5, 250. */
function round(v: number): string {
  return String(v < 10 ? Number(v.toFixed(1)) : Math.round(v));
}

/** A size in bytes as MB or GB: "250 MB", "20 GB". */
export function formatBytes(n: number): string {
  return n >= GB ? `${round(n / GB)} GB` : `${round(n / MB)} MB`;
}

/** Whole currency units in `currency` (an ISO code such as "GBP"), as the reader's locale writes them. */
export function moneyFormatter(currency: string): (n: number) => string {
  try {
    const f = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 });
    return (n) => f.format(n);
  } catch {
    // not an ISO code: the code, then the number
    return (n) => `${currency} ${n}`;
  }
}

/** An ISO time as a day: "3 March 2027". */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

/** Two letters for a name ("Ada Lovelace" is AL), else the first letter of the name or the email. */
export function initialsOf(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : (words[0] ?? email)[0];
  return (letters ?? "?").toUpperCase();
}

/** A colour for an avatar's initials, the same for the same email. */
export function avatarColour(seed: string): string {
  let hash = 0;
  for (const c of seed) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 42% 40%)`;
}

/** Whether `text` is a web address (http or https): the only kind of link the account UI follows. */
export function isWebUrl(text: string): boolean {
  try {
    const u = new URL(text);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
