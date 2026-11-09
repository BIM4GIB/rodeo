// Icons for the branches feature (static markup, stroke = currentColor), drawn like the editor's
// own in app/icons.ts: a 24-unit grid, a 1.6 stroke and round caps.

function svg(body: string): string {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** A branch: a trunk with a curve leaving it, git-style. */
export const BRANCH = svg('<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9c0 6-12 4-12 8"/>');

/** Compare: two overlapping squares. */
export const COMPARE = svg('<rect x="3" y="3" width="11" height="11" rx="1"/><rect x="10" y="10" width="11" height="11" rx="1"/>');

/** Merge: two lines meeting in one. */
export const MERGE = svg('<path d="M6 4l6 7 6-7M12 11v9"/>');

/** Blame: a head and shoulders beside lines. */
export const BLAME = svg('<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><path d="M17 6h4M17 10h4M17 14h4"/>');
