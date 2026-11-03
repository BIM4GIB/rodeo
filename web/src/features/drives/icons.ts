// Generic line icons for the drives (not any company's logo). Trusted static markup.

const svg = (body: string): string =>
  `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICON_CLOUD = svg('<path d="M4.8 12.2h6.6a2.6 2.6 0 0 0 .4-5.2 3.6 3.6 0 0 0-6.9.9 2.1 2.1 0 0 0-.1 4.3z"/>');

export const ICON_FOLDER = svg('<path d="M2.5 4.5c0-.6.4-1 1-1h2.6l1.4 1.5h5c.6 0 1 .4 1 1v5.5c0 .6-.4 1-1 1h-9c-.6 0-1-.4-1-1z"/>');

export const ICON_FILE = svg('<path d="M4 2.5h4.6L11.5 5.4V13a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z"/><path d="M8.5 2.5v3h3"/>');
