// Fuzzy matching for Search Everything. A query matches a text when its characters
// occur in the text in the same order (spaces in the query are ignored, so "edit copy"
// finds "Edit › Copy"). Scores favour matches at word starts (after a space, a
// separator or a lower-to-upper case change), runs of consecutive characters, and a
// text that begins with the query. Pure: no DOM, so the check script runs it in node.

export interface FuzzyMatch {
  /** higher is a better match */
  readonly score: number;
  /** [start, end) ranges of the text the query matched, for highlighting */
  readonly ranges: readonly (readonly [number, number])[];
}

/** Characters after which a word starts. */
const SEPARATORS = " \t›-_/.,:;()[]&+'\"";

/** How many places the first query character is tried from, so a long text is not scanned in full each time. */
const MAX_STARTS = 8;

function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  if (SEPARATORS.includes(prev)) return true;
  const cur = text[i];
  // a lower-case letter followed by an upper-case one: "fillColour" starts at "C"
  return prev === prev.toLowerCase() && prev !== prev.toUpperCase() && cur !== cur.toLowerCase();
}

/** Scores the match that starts at `start` (greedy: each character takes the next occurrence). */
function alignFrom(q: string, lower: string, text: string, start: number): FuzzyMatch | null {
  const at: number[] = [start];
  let from = start + 1;
  for (let k = 1; k < q.length; k++) {
    const i = lower.indexOf(q[k], from);
    if (i === -1) return null;
    at.push(i);
    from = i + 1;
  }
  let score = 0;
  for (let k = 0; k < at.length; k++) {
    const i = at[k];
    let s = 1;
    if (isWordStart(text, i)) s += 6;
    if (k > 0) {
      const gap = i - at[k - 1] - 1;
      if (gap === 0) s += 4;
      else s -= Math.min(3, gap * 0.5);
    }
    score += s;
  }
  if (at[0] === 0) score += 10;
  // a match that ends a word ("Wall" in "A-Wall") is closer than one that runs on ("Walls")
  const end = at[at.length - 1] + 1;
  if (end === text.length || SEPARATORS.includes(text[end])) score += 3;
  // of two equal matches, the shorter text is the closer one
  score -= text.length * 0.02;
  return { score, ranges: rangesOf(at) };
}

/** Consecutive indexes merged into [start, end) ranges. */
function rangesOf(at: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const i of at) {
    const last = out[out.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else out.push([i, i + 1]);
  }
  return out;
}

/** The best match of `query` in `text`, or null when the query's characters do not occur in order. An empty query matches everything with score 0. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (q.length === 0) return { score: 0, ranges: [] };
  const lower = text.toLowerCase();
  let best: FuzzyMatch | null = null;
  let start = lower.indexOf(q[0]);
  for (let n = 0; start !== -1 && n < MAX_STARTS; n++, start = lower.indexOf(q[0], start + 1)) {
    const m = alignFrom(q, lower, text, start);
    if (m && (best === null || m.score > best.score)) best = m;
  }
  return best;
}

/** The score of the best match, or null: a shorthand for fuzzyMatch when only ranking matters. */
export function fuzzyScore(query: string, text: string): number | null {
  return fuzzyMatch(query, text)?.score ?? null;
}
