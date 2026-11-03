// Icons for the search feature (static markup, stroke = currentColor). The tool,
// layer, class and view icons are the editor's own, taken from app/icons.ts.

function svg(body: string): string {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** The top bar's magnifier. */
export const SEARCH_ICON = svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>');

/** Menu commands: a terminal prompt. */
export const COMMAND_ICON = svg('<path d="M5 7l4.5 4.5L5 16M12 17h7"/>');

/** Recent picks: a clock. */
export const RECENT_ICON = svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l2.8 1.8"/>');

/** Palettes: a window with a title bar. */
export const PALETTE_ICON = svg('<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 9.5h16"/>');

/** Query: a funnel. */
export const QUERY_ICON = svg('<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>');

/** Groups of objects: a dashed bracket around two shapes. */
export const GROUP_ICON = svg('<rect x="4" y="4" width="7" height="7" stroke-dasharray="2 2"/><rect x="13" y="13" width="7" height="7" stroke-dasharray="2 2"/>');

/** Symbol instances: a cross with a centre point. */
export const SYMBOL_ICON = svg('<path d="M12 4v16M4 12h16"/><circle cx="12" cy="12" r="5"/>');
