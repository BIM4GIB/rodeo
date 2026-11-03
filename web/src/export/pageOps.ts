// Reading a page of PDF content operators drawn by pdf.ts (layersPage), for the writers that
// translate it to another format: eps.ts (Export EPSF) and emf.ts (Export Metafile).

export type Token =
  | { kind: "num"; v: number; raw: string }
  | { kind: "name"; v: string }
  | { kind: "str"; raw: string }
  | { kind: "arr"; raw: string }
  | { kind: "op"; v: string };

/** The tokens of a PDF content stream: numbers, names, literal strings, arrays (kept as text) and operators. */
export function tokens(content: string): Token[] {
  const out: Token[] = [];
  const n = content.length;
  let i = 0;
  while (i < n) {
    const c = content[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "%") {
      while (i < n && content[i] !== "\n") i++;
    } else if (c === "(") {
      // a literal string: balanced parentheses, backslash escapes
      let depth = 0;
      let j = i;
      for (; j < n; j++) {
        const d = content[j];
        if (d === "\\") j++;
        else if (d === "(") depth++;
        else if (d === ")" && --depth === 0) break;
      }
      out.push({ kind: "str", raw: content.slice(i, j + 1) });
      i = j + 1;
    } else if (c === "[") {
      const j = content.indexOf("]", i);
      out.push({ kind: "arr", raw: content.slice(i, j + 1) });
      i = j + 1;
    } else if (c === "/") {
      let j = i + 1;
      while (j < n && !/[\s/[\]()<>]/.test(content[j])) j++;
      out.push({ kind: "name", v: content.slice(i + 1, j) });
      i = j;
    } else if (c === "<" && content[i + 1] === "<") {
      // a dictionary operand (inline images): not written by pdf.ts content
      const j = content.indexOf(">>", i);
      i = j < 0 ? n : j + 2;
    } else {
      let j = i;
      while (j < n && !/[\s/[\]()<>%]/.test(content[j])) j++;
      const word = content.slice(i, j > i ? j : i + 1);
      const v = Number(word);
      out.push(word !== "" && Number.isFinite(v) && /^[+-]?(\d|\.\d)/.test(word) ? { kind: "num", v, raw: word } : { kind: "op", v: word });
      i = j > i ? j : i + 1;
    }
  }
  return out;
}

/** The numbers of an array operand ("[3 2]"), as a dash pattern gives them. */
export function arrayNumbers(raw: string): number[] {
  return raw
    .replace(/[[\]]/g, " ")
    .split(/\s+/)
    .filter((s) => s !== "")
    .map(Number)
    .filter((v) => Number.isFinite(v));
}

/** The text of a literal string as pdf.ts writes them: Latin-1, octal escapes for the rest. */
export function stringText(raw: string): string {
  const s = raw.slice(1, -1);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1));
    if (oct) {
      out += String.fromCharCode(parseInt(oct[0], 8));
      i += oct[0].length;
    } else {
      const e = s[++i];
      out += e === "n" ? "\n" : e === "r" ? "\r" : e === "t" ? "\t" : e === "b" ? "\b" : e === "f" ? "\f" : (e ?? "");
    }
  }
  return out;
}

/** The fill (ca) and stroke (CA) opacity an ExtGState dictionary sets. */
export function stateAlpha(dict: string | undefined): { fill: number; stroke: number } {
  const get = (key: string): number => {
    const m = new RegExp(`/${key}\\s+([0-9.]+)`).exec(dict ?? "");
    return m ? Math.max(0, Math.min(1, Number(m[1]))) : 1;
  };
  return { fill: get("ca"), stroke: get("CA") };
}

/** A colour (0-1 a channel) drawn at `alpha` over the white page: how it prints with nothing under it. */
export function onWhite(rgb: readonly number[], alpha: number): number[] {
  return rgb.map((c) => c * alpha + (1 - alpha));
}
