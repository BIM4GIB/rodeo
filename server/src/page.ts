// Page hooks: features add to index.html for the requests they know (share and embed links,
// later the gallery). static.ts asks pageExtrasFor before it sends index.html, and injectPage
// puts the answer in: a title, markup for the head, a class and markup for the body. A drawing's
// name is typed by its owner, so every value a hook puts in goes through escapeHtml.

/** What a page adds to index.html for one request. Hooks escape what they put in head and body. */
export interface PageExtras {
  /** the page's title, plain text (injectPage escapes it) */
  readonly title?: string;
  /** markup added at the end of <head> */
  readonly head?: string;
  /** markup added at the start of <body> */
  readonly body?: string;
  /** a class added to <body> */
  readonly bodyClass?: string;
}

export type PageHook = (url: URL) => PageExtras | null;

const TITLE = /<title>[\s\S]*?<\/title>/;
const BODY_TAG = /<body\b([^>]*)>/;
const hooks: PageHook[] = [];

/** Lets a feature add to index.html for the requests it knows (share and embed links, gallery pages). */
export function registerPageHook(hook: PageHook): void {
  hooks.push(hook);
}

/** The first hook's extras for this request, or null. A hook that throws is logged ("[page]") and skipped. */
export function pageExtrasFor(url: URL): PageExtras | null {
  for (const hook of hooks) {
    try {
      const extras = hook(url);
      if (extras) return extras;
    } catch (e) {
      console.error("[page] a hook failed, so it was skipped:", e);
    }
  }
  return null;
}

/** index.html with the extras put in. */
export function injectPage(html: string, extras: PageExtras): string {
  let out = html;
  let head = extras.head ?? "";

  // A title with no <title> to replace goes first in the head markup, so the page still has one.
  if (extras.title !== undefined) {
    const tag = `<title>${escapeHtml(extras.title)}</title>`;
    if (TITLE.test(out)) out = out.replace(TITLE, () => tag);
    else head = head ? `${tag}\n${head}` : tag;
  }

  const headEnd = out.indexOf("</head>");
  if (head && headEnd !== -1) out = `${out.slice(0, headEnd)}\n${head}${out.slice(headEnd)}`;

  if (extras.body !== undefined || extras.bodyClass !== undefined) {
    const tag = BODY_TAG.exec(out);
    if (tag) {
      let open = tag[0];
      if (extras.bodyClass) {
        // Added to an existing class rather than replacing it, so the page keeps its own classes.
        const add = escapeHtml(extras.bodyClass);
        const existing = /\sclass="([^"]*)"/.exec(open);
        open = existing
          ? `${open.slice(0, existing.index)} class="${[existing[1], add].filter(Boolean).join(" ")}"${open.slice(existing.index + existing[0].length)}`
          : `<body${tag[1]} class="${add}">`;
      }
      out = out.slice(0, tag.index) + open + (extras.body ?? "") + out.slice(tag.index + tag[0].length);
    }
  }
  return out;
}

/** Text made safe for HTML text and attribute values. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
