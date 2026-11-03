// Recent picks in Search Everything, kept in this browser (localStorage). Only the
// item ids are kept; a pick that no longer exists is skipped when the list is shown.

const STORAGE_KEY = "openvwx.search.recent.v1";
const MAX = 8;

/** The ids of the recent picks, newest first; none when nothing is stored or storage throws. */
export function loadRecent(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Puts a pick at the front of the recent list. */
export function rememberRecent(id: string): void {
  const next = [id, ...loadRecent().filter((x) => x !== id)].slice(0, MAX);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage full or blocked: the list lasts for this visit only
  }
}
