// The interface's language (Edit > Preferences > General, and the start hub's footer). The source
// writes its text in English, and English stays what the code goes by: commands are named by their
// menu paths, files keep Vectorworks' names. Another language translates the page as it shows:
// each text, title, placeholder and aria-label whose English its file (web/src/i18n/<code>.json)
// has shows that file's words instead, the English kept so a change of language puts it back.
// Text a person wrote (names, a worksheet's cells, a script) is left alone: anything inside
// translate="no", an editable element or <code>. `npx tsx scripts/i18n.ts missing <code>` lists
// the text a file doesn't translate yet.
//
// A file maps English to the language: "Open file…": "打开文件…". A key with {0}, {1}… in it is a
// pattern for text made up round other text, "{0} objects selected": "已选择 {0} 个对象", and
// what stands in for each {n} is looked up too. Text ending in "…" or ":" that the file lacks is
// looked up without it, and a menu path ("File › Export › Export PDF…") a step at a time. Where the English alone could mean two things, the element holding it
// carries a data-i18n key naming which ("Menu › Window", the menu, against "Window", the tool), looked
// up before its text.

import { h } from "./dom.ts";

export interface Language {
  readonly code: string;
  /** its name in itself, as the picker lists it */
  readonly name: string;
  /** what a label's colon becomes */
  readonly colon: string;
}

export const LANGUAGES: readonly Language[] = [
  { code: "en", name: "English", colon: ":" },
  { code: "zh-CN", name: "简体中文", colon: "：" },
];

const KEY = "openvwx.language";

/** the files, loaded when their language is chosen */
const FILES = import.meta.glob<Record<string, string>>("../i18n/*.json", { import: "default" });

/** what a text is translated to, for each attribute translated as text is */
const ATTRS = ["title", "placeholder", "aria-label"] as const;

/** where text is a person's own, not the interface's */
const KEEP = '[translate="no"], [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], code, pre, script, style, textarea';

interface Pattern {
  readonly re: RegExp;
  /** the longest run of plain text in the key, which a text must contain to match */
  readonly need: string;
  readonly to: string;
  /** it is only a joint between its {n}s ("{0} to {1}"): it applies only when the words in them translate too */
  readonly weak: boolean;
}

/** The patterns, filed by the whole word a text matching them must start with, or else end with. */
interface Patterns {
  readonly first: Map<string, Pattern[]>;
  readonly last: Map<string, Pattern[]>;
  /** those that start and end with a {n}, or with part of a word */
  readonly rest: Pattern[];
}

let current: Language = LANGUAGES[0];
let words = new Map<string, string>();
let patterns: Patterns = noPatterns();
/** looked-up text and what it became (null: not translated), cleared when it grows large */
let memo = new Map<string, string | null>();
let observer: MutationObserver | null = null;
const listeners = new Set<(lang: Language) => void>();

/** the English of each translated text node, and what was shown in its place */
const textShown = new WeakMap<Text, { en: string; shown: string }>();
const attrShown = new WeakMap<Element, Map<string, { en: string; shown: string }>>();

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    // storage blocked: the browser's language
    return null;
  }
}

/** The language the browser asks for, when it is one Rodeo has; Traditional Chinese isn't yet. */
function browserLanguage(): string {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const t = tag.toLowerCase();
    if (t === "en" || t.startsWith("en-")) return "en";
    if (t === "zh" || t === "zh-cn" || t === "zh-sg" || t.startsWith("zh-hans")) return "zh-CN";
    const exact = LANGUAGES.find((l) => l.code.toLowerCase() === t || l.code.toLowerCase() === t.split("-")[0]);
    if (exact) return exact.code;
  }
  return "en";
}

/** The language chosen, or the browser's when none has been. */
export function language(): Language {
  return current;
}

function chosen(): Language {
  const code = stored() ?? browserLanguage();
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function noPatterns(): Patterns {
  return { first: new Map(), last: new Map(), rest: [] };
}

/** A text's first and last words, past any punctuation at its ends. */
const firstWord = (text: string): string | undefined => /^[^A-Za-z]*([A-Za-z]+)/.exec(text)?.[1];
const lastWord = (text: string): string | undefined => /([A-Za-z]+)[^A-Za-z]*$/.exec(text)?.[1];

function file(map: Map<string, Pattern[]>, key: string, p: Pattern): void {
  const list = map.get(key);
  if (list) list.push(p);
  else map.set(key, [p]);
}

function load(entries: Record<string, string>): void {
  words = new Map();
  patterns = noPatterns();
  memo = new Map();
  // the Mode bar and screen tips show a hint's parts apart ("Click to place · Shift snaps"): each part
  // of a translated hint is a translation too, where the language keeps the parts and has none of its own
  const all = new Map(Object.entries(entries));
  for (const [en, to] of Object.entries(entries)) {
    if (!to || !en.includes(" · ")) continue;
    const [from, into] = [en.split(" · "), to.split(" · ")];
    if (from.length === into.length) from.forEach((part, k) => all.has(part) || all.set(part, into[k]));
  }
  for (const [raw, to] of all) {
    if (!to) continue;
    // looked up as text is, its runs of spaces and line breaks as one space
    const en = /\s\s|\n/.test(raw) ? raw.replace(/\s+/g, " ") : raw;
    if (!/\{\d\}/.test(en)) {
      words.set(en, to);
      continue;
    }
    const parts = en.split(/\{\d\}/);
    const order = [...en.matchAll(/\{(\d)\}/g)].map((m) => Number(m[1]));
    // each {n} captures as group gn, whatever order the key has them in; a {n} again must match the same
    const named = new Set<number>();
    const hole = (n: number): string => (named.has(n) ? `\\k<g${n}>` : (named.add(n), `(?<g${n}>[\\s\\S]+?)`));
    const re = new RegExp(`^${parts.map(escape).reduce((acc, part, k) => `${acc}${hole(order[k - 1])}${part}`)}$`);
    const need = parts.reduce((a, b) => (b.length > a.length ? b : a), "");
    // a key that is all {n} and spaces would split any text at its spaces
    if (!need.trim()) continue;
    const joint = !/[A-Za-z]/.test(parts[0]) && !/[A-Za-z]/.test(parts[parts.length - 1]) && parts.join("").replace(/[^A-Za-z]/g, "").length < 6;
    const p = { re, need, to, weak: joint };
    // filed by a whole word at the start or end ("Delete {0}", "{0} days ago"): one a {n} runs on from could be any
    const [head, tail] = [parts[0], parts[parts.length - 1]];
    const first = /^[^A-Za-z]*([A-Za-z]+)[^A-Za-z]/.exec(head)?.[1];
    const last = /[^A-Za-z]([A-Za-z]+)[^A-Za-z]*$/.exec(tail)?.[1];
    if (first) file(patterns.first, first, p);
    else if (last) file(patterns.last, last, p);
    else patterns.rest.push(p);
  }
}

/** A trimmed text's translation without patterns: as it is, or without a trailing "…" or ":". */
function word(text: string): string | undefined {
  const exact = words.get(text);
  if (exact !== undefined) return exact;
  if (text.endsWith("…")) {
    const bare = words.get(text.slice(0, -1).trimEnd());
    if (bare !== undefined) return `${bare}…`;
  } else if (text.endsWith(":")) {
    const bare = words.get(text.slice(0, -1).trimEnd());
    if (bare !== undefined) return `${bare}${current.colon}`;
  }
  return undefined;
}

/** A trimmed text's translation, patterns included; null when the language has none. */
function lookup(text: string): string | null {
  const found = word(text);
  if (found !== undefined) return found;
  if (text.length > 400) return null;
  const [start, end] = [firstWord(text), lastWord(text)];
  const candidates = [...((start && patterns.first.get(start)) || []), ...((end && patterns.last.get(end)) || []), ...patterns.rest];
  // the most specific first: the longest plain text
  candidates.sort((a, b) => b.need.length - a.need.length);
  for (const p of candidates) {
    if (!text.includes(p.need)) continue;
    const m = p.re.exec(text);
    if (!m?.groups) continue;
    const groups = m.groups;
    if (p.weak && Object.values(groups).some((part) => /[a-z]{2}/.test(part) && word(part.trim()) === undefined)) continue;
    return p.to.replace(/\{(\d)\}/g, (_, n: string) => {
      const part = groups[`g${n}`] ?? "";
      const inner = part.trim();
      return inner && /[A-Za-z]/.test(inner) ? part.replace(inner, word(inner) ?? inner) : part;
    });
  }
  // a menu path, "Modify › Convert › Convert to Group": each step as the menus have it
  const steps = text.split(/( › | > )/);
  if (steps.length > 1) {
    const each = steps.map((step, k) => (k % 2 ? step : (word(step) ?? step)));
    if (each.some((step, k) => step !== steps[k])) return each.join("");
  }
  return null;
}

/** `text` in the interface's language: its translation, or the text itself when there is none. */
export function t(text: string): string {
  return translated(text) ?? text;
}

/** in development, the text the language had nothing for, as the page showed it: openvwxMissingText() lists it */
const missed = import.meta.env.DEV ? new Set<string>() : null;
if (missed) (globalThis as { openvwxMissingText?: () => string[] }).openvwxMissingText = () => [...missed];

/** `text` translated, its spaces at either end kept; null when the language has nothing for it. */
function translated(text: string): string | null {
  // no words, or the language's own already (CJK: what this page shows or code put together from it)
  if (current.code === "en" || !/[A-Za-z]/.test(text) || /[\u3000-\u9fff\uff00-\uffef]/.test(text)) return null;
  const trimmed = text.trim();
  let to = memo.get(trimmed);
  if (to === undefined) {
    // text laid out over lines in the markup is looked up as one line
    to = lookup(/\s\s|\n/.test(trimmed) ? trimmed.replace(/\s+/g, " ") : trimmed);
    if (memo.size > 20000) memo = new Map();
    memo.set(trimmed, to);
    if (to === null) missed?.add(trimmed);
  }
  if (to === null) return null;
  return trimmed === text ? to : text.replace(trimmed, to);
}

function kept(el: Element | null): boolean {
  return el === null || el.closest(KEEP) !== null;
}

/** Translates a text node; `inside` when a walk that skips a person's own text reached it. */
function translateText(node: Text, inside = false): void {
  const seen = textShown.get(node);
  // the text we put there: nothing new to read
  if (seen && node.data === seen.shown) return;
  if (!inside && kept(node.parentElement)) return;
  const en = node.data;
  const key = node.parentElement?.getAttribute("data-i18n");
  const keyed = key && current.code !== "en" ? words.get(key) : undefined;
  const to = keyed !== undefined && en.trim() ? en.replace(en.trim(), keyed) : translated(en);
  if (to === null || to === en) {
    textShown.delete(node);
    return;
  }
  textShown.set(node, { en, shown: to });
  node.data = to;
}

function translateAttr(el: Element, name: string): void {
  const value = el.getAttribute(name);
  if (value === null) return;
  let seen = attrShown.get(el);
  if (seen?.get(name)?.shown === value) return;
  const to = translated(value);
  if (to === null || to === value) {
    seen?.delete(name);
    return;
  }
  if (!seen) attrShown.set(el, (seen = new Map()));
  seen.set(name, { en: value, shown: to });
  el.setAttribute(name, to);
}

/** Translates `root` and everything in it that isn't a person's own text. */
function translateTree(root: Node): void {
  if (root instanceof Text) {
    translateText(root);
    return;
  }
  if (!(root instanceof Element)) return;
  if (kept(root)) return;
  for (const name of ATTRS) if (root.hasAttribute(name)) translateAttr(root, name);
  // most elements added hold one text, or none
  const only = root.firstChild;
  if (!only) return;
  if (only instanceof Text && !only.nextSibling) {
    translateText(only, true);
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node instanceof Element && node.matches(KEEP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) translateText(node, true);
    else for (const name of ATTRS) if ((node as Element).hasAttribute(name)) translateAttr(node as Element, name);
  }
}

/** Puts back the English of everything translated in the page. */
function restoreTree(root: Element): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node: Node | null = root; node; node = walker.nextNode()) {
    if (node instanceof Text) {
      const seen = textShown.get(node);
      if (seen && node.data === seen.shown) node.data = seen.en;
      textShown.delete(node);
    } else if (node instanceof Element) {
      const seen = attrShown.get(node);
      if (!seen) continue;
      for (const [name, { en, shown }] of seen) if (node.getAttribute(name) === shown) node.setAttribute(name, en);
      attrShown.delete(node);
    }
  }
}

/** The English a translated text node or attribute stood for, so a new language reads from that. */
function retranslateTree(root: Element): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node: Node | null = root; node; node = walker.nextNode()) {
    if (node instanceof Text) {
      const seen = textShown.get(node);
      if (seen && node.data === seen.shown) {
        textShown.delete(node);
        node.data = seen.en;
      }
    } else if (node instanceof Element) {
      const seen = attrShown.get(node);
      if (!seen) continue;
      for (const [name, { en, shown }] of seen) if (node.getAttribute(name) === shown) node.setAttribute(name, en);
      attrShown.delete(node);
    }
  }
  translateTree(root);
}

function observe(): void {
  if (observer) return;
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "childList") r.addedNodes.forEach(translateTree);
      else if (r.type === "characterData") translateText(r.target as Text);
      else if (r.type === "attributes" && r.attributeName && r.target instanceof Element && !kept(r.target)) translateAttr(r.target, r.attributeName);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
}

const native = { alert: window.alert.bind(window), confirm: window.confirm.bind(window), prompt: window.prompt.bind(window) };

/** The browser's own message boxes say their message in the language too. */
function wrapDialogs(): void {
  window.alert = (message?: unknown) => native.alert(typeof message === "string" ? t(message) : message);
  window.confirm = (message?: string) => native.confirm(message === undefined ? message : t(message));
  window.prompt = (message?: string, value?: string) => native.prompt(message === undefined ? message : t(message), value);
}

async function apply(lang: Language): Promise<void> {
  if (lang.code !== "en") {
    const file = FILES[`../i18n/${lang.code}.json`];
    if (!file) throw new Error(`no translation file for ${lang.code}`);
    load(await file());
  }
  const was = current;
  current = lang;
  document.documentElement.lang = lang.code;
  if (lang.code === "en") {
    observer?.disconnect();
    observer = null;
    if (was.code !== "en") restoreTree(document.body);
    words = new Map();
    patterns = noPatterns();
    memo = new Map();
    for (const fn of listeners) fn(lang);
    return;
  }
  observe();
  if (was.code === "en") translateTree(document.body);
  else retranslateTree(document.body);
  for (const fn of listeners) fn(lang);
}

/**
 * Starts the chosen language before the editor builds its page, so English doesn't show first.
 * Resolves at once for English; a file that can't load leaves the page in English.
 */
export async function startLanguage(): Promise<void> {
  wrapDialogs();
  const lang = chosen();
  try {
    if (lang.code !== "en") await apply(lang);
  } catch (err) {
    console.warn("openvwx: interface language not loaded", err);
  } finally {
    // index.html hid the page while the language loaded
    document.documentElement.classList.remove("i18n-pending");
  }
}

/** Changes the interface's language now, and for later visits. */
export async function setLanguage(code: string): Promise<void> {
  const lang = LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
  try {
    localStorage.setItem(KEY, lang.code);
  } catch {
    // storage blocked: the language lasts for this visit
  }
  if (lang.code !== current.code) await apply(lang);
}

const GLOBE = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M1.8 8h12.4M8 1.8c-1.8 1.7-2.6 3.8-2.6 6.2s.8 4.5 2.6 6.2M8 1.8c1.8 1.7 2.6 3.8 2.6 6.2s-.8 4.5-2.6 6.2"/></svg>`;

/** Calls `fn` after each change of language (what code sets in its own words, such as a tooltip, follows). */
export function onLanguage(fn: (lang: Language) => void): void {
  listeners.add(fn);
}

/** The start hub's footer picker: a globe and the language's own name, a list of the others when clicked. */
export function languagePicker(): HTMLElement {
  const pick = h(
    "select",
    { cls: "hub-lang-select", attrs: { "aria-label": "Language" } },
    ...LANGUAGES.map((l) => h("option", { value: l.code, text: l.name, attrs: { translate: "no" } })),
  );
  pick.value = current.code;
  pick.addEventListener("change", () => void setLanguage(pick.value));
  listeners.add((lang) => {
    pick.value = lang.code;
  });
  return h("label", { cls: "hub-link hub-lang", title: "Language" }, h("span", { cls: "hub-lang-icon", html: GLOBE }), pick);
}
