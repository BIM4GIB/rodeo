// Markdown as the models write it, to DOM: headings, paragraphs, lists, quotes, fenced code,
// tables, rules, and inline code, bold, italics, strikethrough and links. Built from text nodes
// and elements only, never innerHTML, so whatever a model writes stays text. Links open only
// http(s) and mailto addresses, in a new tab.

import { h } from "../../app/dom.ts";

export function renderMarkdown(src: string): HTMLElement {
  const root = h("div", { cls: "ag-md" });
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  let para: string[] = [];
  const flush = (): void => {
    if (para.length) root.append(h("p", {}, ...inline(para.join("\n"))));
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(```+|~~~+)\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      root.append(codeBlock(body.join("\n"), fence[2]));
      continue;
    }
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = Math.min(heading[1].length + 2, 6);
      root.append(h(`h${level}` as "h3", {}, ...inline(heading[2].replace(/\s+#+\s*$/, ""))));
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      root.append(h("hr"));
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      const quote = renderMarkdown(body.join("\n"));
      root.append(h("blockquote", {}, ...Array.from(quote.childNodes)));
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      root.append(table(rows));
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const ordered = /\d/.test(item[2]);
      const list = h(ordered ? "ol" : "ul");
      const start = Number.parseInt(item[2], 10);
      if (ordered && start > 1) list.setAttribute("start", String(start));
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!m || /\d/.test(m[2]) !== ordered) break;
        const body = [m[3]];
        i++;
        // continuation lines and nested items, indented under it
        while (i < lines.length && lines[i].trim() && /^\s{2,}/.test(lines[i]) && !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i].slice(0, m[1].length + 1))) {
          body.push(lines[i++].replace(/^\s{2,4}/, ""));
        }
        const li = h("li");
        const nested = body.slice(1).some((b) => /^([-*+]|\d+[.)])\s+/.test(b.trim()));
        if (nested) li.append(...Array.from(renderMarkdown(body.join("\n")).childNodes));
        else li.append(...inline(body.join("\n")));
        list.append(li);
      }
      root.append(list);
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return root;
}

function codeBlock(text: string, lang: string): HTMLElement {
  const copy = h("button", { cls: "ag-copy", text: "Copy", attrs: { type: "button" } });
  copy.addEventListener("click", () => {
    void navigator.clipboard?.writeText(text).then(() => {
      copy.textContent = "Copied";
      window.setTimeout(() => (copy.textContent = "Copy"), 1200);
    });
  });
  return h("div", { cls: "ag-code" }, h("div", { cls: "ag-code-head" }, h("span", { text: lang || "code" }), copy), h("pre", {}, h("code", { text })));
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

function table(rows: string[]): HTMLElement {
  const head = cells(rows[0]);
  const align = cells(rows[1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : ""));
  const tr = (cs: string[], tag: "th" | "td"): HTMLElement =>
    h(
      "tr",
      {},
      ...cs.map((c, k) => {
        const cell = h(tag, {}, ...inline(c));
        if (align[k]) cell.style.textAlign = align[k];
        return cell;
      }),
    );
  return h("div", { cls: "ag-table" }, h("table", {}, h("thead", {}, tr(head, "th")), h("tbody", {}, ...rows.slice(2).map((r) => tr(cells(r), "td")))));
}

const SAFE_URL = /^(https?:|mailto:)/i;

/** Inline markup: `code`, **bold**, *italics*, ~~struck~~, [links](https://…) and bare https links. */
function inline(text: string): Node[] {
  const out: Node[] = [];
  const re = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|(?<![\w*])\*(?!\s)([\s\S]+?)(?<!\s)\*(?!\w)|(?<![\w_])_(?!\s)([\s\S]+?)(?<!\s)_(?!\w)|~~([\s\S]+?)~~|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push(...withBreaks(text.slice(last, at)));
    if (m[1]) out.push(h("code", { text: m[2] }));
    else if (m[3] ?? m[4]) out.push(h("strong", {}, ...inline((m[3] ?? m[4])!)));
    else if (m[5] ?? m[6]) out.push(h("em", {}, ...inline((m[5] ?? m[6])!)));
    else if (m[7]) out.push(h("s", {}, ...inline(m[7])));
    else if (m[8]) out.push(link(m[9], inline(m[8])));
    else if (m[10]) out.push(link(m[10], [document.createTextNode(m[10])]));
    last = at + m[0].length;
  }
  if (last < text.length) out.push(...withBreaks(text.slice(last)));
  return out;
}

function link(url: string, children: Node[]): Node {
  if (!SAFE_URL.test(url)) return h("span", {}, ...children);
  return h("a", { attrs: { href: url, target: "_blank", rel: "noopener noreferrer" } }, ...children);
}

function withBreaks(text: string): Node[] {
  const parts = text.split("\n");
  return parts.flatMap((p, k) => (k ? [h("br"), document.createTextNode(p)] : [document.createTextNode(p)]));
}
