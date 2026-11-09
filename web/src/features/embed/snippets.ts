// The codes an owner copies from the Share dialog's embed section: an iframe, the web component's
// element and a Markdown picture that links to the drawing. Pure string work, so the check runs in
// node. The addresses come from options.ts, and every value put into a code is escaped here, since
// a name or a layer can come from a drawing that someone else made.

import { type EmbedOptions, displayName, optionPairs } from "./options.ts";

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Text made safe for HTML text and attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Text made safe inside a Markdown link's or image's brackets: each marker gets a backslash. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>]/g, (c) => `\\${c}`);
}

/** The title a code names its drawing by: "House on Rodeo" for a file "House.vwx". */
export function codeTitle(fileName: string): string {
  return `${displayName(fileName)} on Rodeo`;
}

/** The percent-codes for the characters that would end a URL inside a Markdown link's parentheses. */
const MARKDOWN_URL_ESCAPES: Record<string, string> = { "(": "%28", ")": "%29", "<": "%3C", ">": "%3E", " ": "%20" };

/** A URL written inside a Markdown link's parentheses, with the characters that would end it percent-encoded. */
function markdownUrl(url: string): string {
  return url.replace(/[()<> ]/g, (c) => MARKDOWN_URL_ESCAPES[c]);
}

/** An iframe that fills the page's width at 16:9 and loads when it nears the screen. */
export function iframeCode(src: string, title: string): string {
  return `<iframe src="${escapeHtml(src)}" title="${escapeHtml(title)}" width="100%" height="450" style="border:0;width:100%;height:auto;aspect-ratio:16/9" allow="fullscreen" allowfullscreen loading="lazy"></iframe>`;
}

/** The web component's attributes for a share link: the token, then the options that differ from the defaults. */
export function elementAttrs(token: string, o: EmbedOptions): [string, string][] {
  // rotate is a flag, so it is written as a bare attribute with an empty value
  return [["share", token], ...optionPairs(o).map(([k, v]): [string, string] => [k, k === "rotate" ? "" : v])];
}

/** The script tag and the element on one line. A value of "" is written as a bare attribute. */
export function elementCode(scriptSrc: string, attrs: readonly [string, string][]): string {
  const text = attrs.map(([k, v]) => (v === "" ? k : `${k}="${escapeHtml(v)}"`)).join(" ");
  return `<script async src="${escapeHtml(scriptSrc)}"></script><rodeo-viewer ${text}></rodeo-viewer>`;
}

/** A Markdown picture that links to the drawing: [![title](picture)](link). */
export function markdownCode(title: string, imageUrl: string, linkUrl: string): string {
  return `[![${escapeMarkdown(title)}](${markdownUrl(imageUrl)})](${markdownUrl(linkUrl)})`;
}
