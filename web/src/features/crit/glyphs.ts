// Inline icons for the crit feature (trusted static markup, drawn with the
// current colour).

const svg = (body: string): string =>
  `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const GLYPH = {
  /** a speech bubble: the crit mode button */
  bubble: svg(
    `<path d="M4.2 2.5h7.6a1.7 1.7 0 0 1 1.7 1.7v4.6a1.7 1.7 0 0 1-1.7 1.7H7.4L4.6 13.2v-2.7h-.4a1.7 1.7 0 0 1-1.7-1.7V4.2a1.7 1.7 0 0 1 1.7-1.7z"/>`,
  ),
  pin: svg(`<path d="M8 14.2s4.2-4.1 4.2-7.3a4.2 4.2 0 0 0-8.4 0c0 3.2 4.2 7.3 4.2 7.3z"/><circle cx="8" cy="6.9" r="1.5"/>`),
  redline: svg(`<path d="M3 13.2l.6-2.6 7.2-7.2a1.4 1.4 0 0 1 2 2l-7.2 7.2z"/><path d="M9.6 4.6l1.8 1.8"/>`),
  select: svg(`<path d="M4 2.6l8 5-3.4.9 1.9 4.2-1.5.6-1.9-4.2L4 11.4z"/>`),
  mic: svg(`<rect x="6" y="2" width="4" height="7" rx="2"/><path d="M3.8 7.6a4.2 4.2 0 0 0 8.4 0M8 11.8V14"/>`),
  stop: svg(`<rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none"/>`),
  close: svg(`<path d="M4 4l8 8M12 4l-8 8"/>`),
  check: svg(`<circle cx="8" cy="8" r="5.6"/><path d="M5.4 8.2l1.9 1.9 3.3-3.7"/>`),
  reopen: svg(`<path d="M3.2 8a4.8 4.8 0 1 0 1.4-3.4"/><path d="M3.2 3.2v2.6h2.6"/>`),
  trash: svg(`<path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M4.8 4.5l.6 8.5h5.2l.6-8.5"/>`),
  export: svg(`<path d="M8 2.6v7.4M5 7.2l3 3 3-3M3 12.8h10"/>`),
  clear: svg(`<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>`),
};
