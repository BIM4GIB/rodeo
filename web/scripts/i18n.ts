// Translation upkeep: lists the interface text in web/src and index.html that a language file
// (web/src/i18n/<code>.json) doesn't translate yet, and what it translates that nothing shows any
// more. The text is found by reading the string literals in the source: those that read as
// words for a person (a capital letter, a word, no code look), templates with ${…} becoming
// patterns with {0}, {1}… in their place.
//
//   npx tsx scripts/i18n.ts missing zh-CN [--json]   text with no translation (JSON: an object to fill in)
//   npx tsx scripts/i18n.ts unused zh-CN             translations of text no longer in the source
//   npx tsx scripts/i18n.ts count zh-CN              how much is translated

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const WEB = resolve(import.meta.dirname, "..");
const SRC = join(WEB, "src");

/**
 * Folders and files whose text the editor doesn't show: checks, the admin page, the file readers and
 * writers (Vectorworks' and other formats' own names), the command line, what agents and voice
 * commands say to a language model or parse, and the release log (written in English).
 */
const SKIP = [
  /\.check\.ts$/,
  /(^|\/)check\.ts$/,
  /\.d\.ts$/,
  /\.worker\.ts$/,
  /^admin\//,
  /^core\//,
  /^export\//,
  /^import\//,
  /^convert\//,
  /^platform\//,
  /^features\/mcp\//,
  /^features\/news\/(releases|banners)\.ts$/,
  /^features\/agents\/(apidocs|build|check3d|history|iso|lighting|llm|look|place|plan|prompt|tools)\.ts$/,
  /^features\/voice\/(agent|command|parse)\.ts$/,
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts") && !SKIP.some((re) => re.test(relative(SRC, path)))) out.push(path);
  }
  return out;
}

/** A string literal's text, with ${…} parts of a template as {0}, {1}…, and the code just before it. */
type Literal = { text: string; line: number; before: string };

const REGEX_BEFORE = new Set("(,=:[!&|?{};+-*%<>~^".split(""));

/** The string literals of a TypeScript file, comments and regular expressions skipped. */
export function literals(src: string): Literal[] {
  const out: Literal[] = [];
  let i = 0;
  let line = 1;
  let last = ""; // the last significant character, to tell a regex from a division
  let lastWord = "";
  // template nesting: each entry is the brace depth inside a ${…} we came in from
  const braces: number[] = [];
  let depth = 0;

  const readTemplate = (start: number): void => {
    // i is just past the backtick
    const open = i - 1;
    let text = "";
    let holes = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === "\\") {
        text += unescape(src[i + 1]);
        i += 2;
        continue;
      }
      if (c === "\n") line++;
      if (c === "`") {
        i++;
        out.push({ text, line: start, before: src.slice(Math.max(0, open - 40), open) });
        return;
      }
      if (c === "$" && src[i + 1] === "{") {
        text += `{${holes++}}`;
        i += 2;
        braces.push(depth);
        depth++;
        // scan the expression with the main loop until its closing brace
        scan(() => depth === braces[braces.length - 1]);
        braces.pop();
        continue;
      }
      text += c;
      i++;
    }
  };

  const unescape = (c: string | undefined): string => (c === "n" ? "\n" : c === "t" ? "\t" : (c ?? ""));

  const scan = (stop: () => boolean): void => {
    while (i < src.length) {
      const c = src[i];
      if (c === "\n") {
        line++;
        i++;
        continue;
      }
      if (c === " " || c === "\t" || c === "\r") {
        i++;
        continue;
      }
      if (c === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        const end = src.indexOf("*/", i + 2);
        const stopAt = end < 0 ? src.length : end + 2;
        for (let k = i; k < stopAt; k++) if (src[k] === "\n") line++;
        i = stopAt;
        continue;
      }
      if (c === "/" && (last === "" || REGEX_BEFORE.has(last) || lastWord === "return" || lastWord === "typeof")) {
        // a regular expression literal
        i++;
        let inClass = false;
        while (i < src.length && src[i] !== "\n") {
          if (src[i] === "\\") i += 2;
          else if (src[i] === "[") (inClass = true), i++;
          else if (src[i] === "]") (inClass = false), i++;
          else if (src[i] === "/" && !inClass) {
            i++;
            break;
          } else i++;
        }
        while (/[a-z]/.test(src[i] ?? "")) i++;
        last = ")";
        lastWord = "";
        continue;
      }
      if (c === '"' || c === "'") {
        const start = line;
        const open = i;
        i++;
        let text = "";
        while (i < src.length && src[i] !== c && src[i] !== "\n") {
          if (src[i] === "\\") {
            text += unescape(src[i + 1]);
            i += 2;
          } else text += src[i++];
        }
        i++;
        out.push({ text, line: start, before: src.slice(Math.max(0, open - 40), open) });
        last = '"';
        lastWord = "";
        continue;
      }
      if (c === "`") {
        i++;
        readTemplate(line);
        last = '"';
        lastWord = "";
        continue;
      }
      if (c === "{") depth++;
      if (c === "}") {
        depth--;
        if (braces.length && stop()) {
          i++;
          return;
        }
      }
      if (/[A-Za-z_$0-9]/.test(c)) {
        let w = "";
        while (i < src.length && /[A-Za-z_$0-9]/.test(src[i])) w += src[i++];
        last = "a";
        lastWord = w;
        continue;
      }
      last = c;
      lastWord = "";
      i++;
    }
  };

  scan(() => false);
  return out;
}

/** Code before a literal that makes it a class name, a selector, an event or a key rather than words. */
const CODE_BEFORE = /(\bcls|className|classList\.\w+\(|querySelector(All)?\(|closest\(|matches\(|addEventListener\(|dataset\.\w+ ===?|\bkind|\btype|\bid|\bkey|\bicon|\bcase|import|from|setAttribute\("(class|role|type)",?)\s*[:=(]?\s*$/;

/** Whether a literal reads as words for a person rather than code, a key or markup. */
export function isInterfaceText(text: string, before = ""): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 600) return false;
  if (CODE_BEFORE.test(before)) return false;
  // text starting in lower case: words (a phrase, or a sentence's end made into one), not code
  if (/^[a-z]/.test(t) && !(/^[a-z][a-z'’]* [a-z'’]+( [\p{L}{}0-9'’,.()–—]+)*[a-z.!?)}]?$/u.test(t) && !/[_=\/\\#@]|[a-z]-[a-z]|\b(btn|px|rgba?|var|none|auto)\b/.test(t))) return false;
  if (t === "OK") return true;
  if (/^\{\d\}/.test(t) && !/[A-Za-z]{2}/.test(t)) return false;
  // "2D …", "3D …" and "+ Class" buttons start without a letter
  if (!/^([\p{L}¡¿"“‘(…{]|[23]D\b|\+ [A-Z])/u.test(t)) return false;
  if (!/[a-z]/.test(t)) return false;
  // code, markup, paths, CSS and identifiers
  if (/[<>]|=>|\$\{|^\{[a-z]|\\[nt]|[;]$|^[A-Z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*$|^[A-Z][a-z]+[A-Z]/.test(t) && !/ /.test(t)) return false;
  if (/<\/?[a-z]+[ >]|<svg|^[A-Z_]+$|\.(ts|js|css|png|svg|json|vwx)\b|^(https?:|\/)|[{}]\s*$/.test(t) && !/^\{\d\}/.test(t)) return false;
  if (/^[A-Z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/.test(t)) return false; // Foo.bar
  if (/^[A-Z][a-zA-Z]*_[a-zA-Z_]+$/.test(t)) return false; // Foo_bar
  return true;
}

/** The interface text in the source and index.html, each with where it was first seen. */
export function interfaceText(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(SRC)) {
    const src = readFileSync(file, "utf8");
    for (const { text, line, before } of literals(src)) {
      const t = text.trim();
      if (isInterfaceText(t, before) && !found.has(t)) found.set(t, `${relative(WEB, file)}:${line}`);
    }
  }
  const html = readFileSync(join(WEB, "index.html"), "utf8").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, "");
  for (const m of html.matchAll(/>([^<>]+)</g)) {
    const t = m[1].replace(/\s+/g, " ").trim();
    if (isInterfaceText(t) && !found.has(t)) found.set(t, "index.html");
  }
  for (const m of html.matchAll(/(?:title|aria-label|placeholder)="([^"]+)"/g)) {
    if (isInterfaceText(m[1]) && !found.has(m[1])) found.set(m[1], "index.html");
  }
  return found;
}

function locale(code: string): Record<string, string> {
  return JSON.parse(readFileSync(join(SRC, "i18n", `${code}.json`), "utf8")) as Record<string, string>;
}

if (import.meta.main ?? process.argv[1]?.endsWith("i18n.ts")) {
  const [command, code, flag] = process.argv.slice(2);
  const text = interfaceText();
  if (command === "all") {
    for (const [t, at] of text) console.log(`${at}\t${JSON.stringify(t)}`);
  } else if (!code) {
    console.error("usage: tsx scripts/i18n.ts missing|unused|count <language> [--json]");
    process.exit(1);
  } else {
    const done = locale(code);
    if (command === "missing") {
      const missing = [...text].filter(([t]) => !(t in done));
      if (flag === "--json") console.log(JSON.stringify(Object.fromEntries(missing.map(([t]) => [t, ""])), null, 2));
      else for (const [t, at] of missing) console.log(`${at}\t${JSON.stringify(t)}`);
    } else if (command === "unused") {
      for (const t of Object.keys(done)) if (!text.has(t) && !t.includes(" › ")) console.log(JSON.stringify(t));
    } else if (command === "count") {
      const translated = [...text.keys()].filter((t) => t in done).length;
      console.log(`${code}: ${translated} of ${text.size} texts translated (${Math.round((100 * translated) / text.size)}%)`);
    }
  }
}
