// Encapsulated PostScript (EPSF 3.0), as File > Export > Export EPSF writes it: one page drawn by
// the PDF writer (pdf.ts layersPage), its content operators translated to PostScript's. Paths,
// fills, strokes, dashes, clipping and the graphics state map one for one. PostScript has one
// colour where PDF keeps a fill and a stroke colour, so this keeps both and sets the one a paint
// uses. EPS has no transparency: a colour drawn see-through is mixed with the white page by its
// opacity, as it shows on paper when nothing lies under it. Text is set in Helvetica (re-encoded
// to Latin-1, as pdf.ts writes its strings), its glyph outlines stroked where the text render mode
// strokes them. Images aren't written; the caller is told how many were left out.

import type { DrawnPage } from "./pdf.ts";
import { onWhite, stateAlpha, tokens, type Token } from "./pageOps.ts";

/** PostScript Level 2 name for each font pdf.ts uses. */
const FONTS: Readonly<Record<string, string>> = {
  F1: "Helvetica",
  F2: "Helvetica-Bold",
  F3: "Helvetica-Oblique",
  F4: "Helvetica-BoldOblique",
};

function num(v: number): string {
  const s = (Math.abs(v) < 5e-7 ? 0 : v).toFixed(4).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

interface State {
  fill: number[];
  stroke: number[];
  fillAlpha: number;
  strokeAlpha: number;
  font: string;
  size: number;
  hscale: number;
  render: number;
}

export interface Eps {
  readonly text: string;
  /** images in the drawing that the file leaves out */
  readonly imagesLeftOut: number;
}

/** An EPS file of the page. */
export function pageEps(page: DrawnPage, title: string): Eps {
  const out: string[] = [];
  const w = Math.max(1, page.width);
  const h = Math.max(1, page.height);
  out.push(
    "%!PS-Adobe-3.0 EPSF-3.0",
    `%%BoundingBox: 0 0 ${Math.ceil(w)} ${Math.ceil(h)}`,
    `%%HiResBoundingBox: 0 0 ${num(w)} ${num(h)}`,
    `%%Title: (${title.replace(/[()\\]/g, "")})`,
    "%%Creator: Rodeo (File > Export > Export EPSF)",
    `%%CreationDate: (${new Date().toISOString().slice(0, 10)})`,
    "%%DocumentNeededResources: font Helvetica Helvetica-Bold Helvetica-Oblique Helvetica-BoldOblique",
    "%%LanguageLevel: 2",
    "%%Pages: 1",
    "%%EndComments",
    "%%BeginProlog",
    "/RodeoDict 16 dict def",
    "RodeoDict begin",
    "/re { 4 2 roll moveto 1 index 0 rlineto 0 exch rlineto neg 0 rlineto closepath } bind def",
    // a copy of a font with the Latin-1 encoding the strings are written in
    "/latin1 { findfont dup length dict begin { 1 index /FID ne { def } { pop pop } ifelse } forall /Encoding ISOLatin1Encoding def currentdict end definefont pop } bind def",
    ...Object.entries(FONTS).map(([k, name]) => `/Rodeo${k} /${name} latin1`),
    "end",
    "%%EndProlog",
    "%%Page: 1 1",
    "RodeoDict begin",
    "save",
  );

  let st: State = { fill: [0, 0, 0], stroke: [0, 0, 0], fillAlpha: 1, strokeAlpha: 1, font: "F1", size: 12, hscale: 100, render: 0 };
  const stack: State[] = [];
  let clipNext: "clip" | "eoclip" | null = null;
  let tm: string | null = null;
  const args: Token[] = [];
  const nums = (): number[] => args.filter((t): t is Extract<Token, { kind: "num" }> => t.kind === "num").map((t) => t.v);
  const fillColour = (): string => `${onWhite(st.fill, st.fillAlpha).map(num).join(" ")} setrgbcolor`;
  const strokeColour = (): string => `${onWhite(st.stroke, st.strokeAlpha).map(num).join(" ")} setrgbcolor`;
  /** paints the current path, then makes it the clip when W came before */
  const paint = (ops: string): void => {
    if (clipNext) {
      out.push(ops === "newpath" ? `${clipNext} newpath` : `gsave ${ops} grestore ${clipNext} newpath`);
      clipNext = null;
    } else out.push(ops);
  };

  for (const t of tokens(page.content)) {
    if (t.kind !== "op") {
      args.push(t);
      continue;
    }
    const a = nums();
    switch (t.v) {
      case "q":
        stack.push({ ...st, fill: [...st.fill], stroke: [...st.stroke] });
        out.push("gsave");
        break;
      case "Q":
        st = stack.pop() ?? st;
        out.push("grestore");
        break;
      case "cm":
        if (a.length === 6) out.push(`[${a.map(num).join(" ")}] concat`);
        break;
      case "w":
        out.push(`${num(a[0] ?? 1)} setlinewidth`);
        break;
      case "J":
        out.push(`${a[0] ?? 0} setlinecap`);
        break;
      case "j":
        out.push(`${a[0] ?? 0} setlinejoin`);
        break;
      case "M":
        out.push(`${num(a[0] ?? 10)} setmiterlimit`);
        break;
      case "d": {
        const arr = args.find((x) => x.kind === "arr");
        out.push(`${arr && arr.kind === "arr" ? arr.raw : "[]"} ${num(a[a.length - 1] ?? 0)} setdash`);
        break;
      }
      case "rg":
        st.fill = a.slice(0, 3);
        break;
      case "RG":
        st.stroke = a.slice(0, 3);
        break;
      case "gs": {
        const name = args.find((x) => x.kind === "name");
        const al = stateAlpha(name && name.kind === "name" ? page.states.get(name.v) : undefined);
        st.fillAlpha = al.fill;
        st.strokeAlpha = al.stroke;
        break;
      }
      case "m":
        out.push(`${num(a[0])} ${num(a[1])} moveto`);
        break;
      case "l":
        out.push(`${num(a[0])} ${num(a[1])} lineto`);
        break;
      case "c":
        out.push(`${a.slice(0, 6).map(num).join(" ")} curveto`);
        break;
      case "h":
        out.push("closepath");
        break;
      case "re":
        out.push(`${a.slice(0, 4).map(num).join(" ")} re`);
        break;
      case "W":
        clipNext = "clip";
        break;
      case "W*":
        clipNext = "eoclip";
        break;
      case "n":
        paint("newpath");
        break;
      case "S":
        paint(`${strokeColour()} stroke`);
        break;
      case "f":
      case "F":
        paint(`${fillColour()} fill`);
        break;
      case "f*":
        paint(`${fillColour()} eofill`);
        break;
      case "B":
        paint(`gsave ${fillColour()} fill grestore ${strokeColour()} stroke`);
        break;
      case "B*":
        paint(`gsave ${fillColour()} eofill grestore ${strokeColour()} stroke`);
        break;
      case "BT":
        tm = null;
        break;
      case "ET":
        tm = null;
        break;
      case "Tf": {
        const name = args.find((x) => x.kind === "name");
        if (name && name.kind === "name") st.font = name.v;
        st.size = a[0] ?? st.size;
        break;
      }
      case "Tz":
        st.hscale = a[0] ?? 100;
        break;
      case "Tr":
        st.render = a[0] ?? 0;
        break;
      case "Tm":
        if (a.length === 6) tm = `[${a.map(num).join(" ")}]`;
        break;
      case "Tj": {
        const s = args.find((x) => x.kind === "str");
        if (!s || s.kind !== "str") break;
        const font = `/Rodeo${FONTS[st.font] ? st.font : "F1"} findfont [${num((st.size * st.hscale) / 100)} 0 0 ${num(st.size)} 0 0] makefont setfont`;
        const at = `gsave ${tm ?? "[1 0 0 1 0 0]"} concat 0 0 moveto ${font}`;
        if (st.render === 0) out.push(`${at} ${fillColour()} ${s.raw} show grestore`);
        else if (st.render === 1) out.push(`${at} ${s.raw} false charpath ${strokeColour()} stroke grestore`);
        else if (st.render === 2) out.push(`${at} ${s.raw} false charpath gsave ${fillColour()} fill grestore ${strokeColour()} stroke grestore`);
        break;
      }
      // images (Do) and anything else pdf.ts doesn't write are left out
      default:
        break;
    }
    args.length = 0;
  }
  out.push("restore", "end", "showpage", "%%Trailer", "%%EOF");
  return { text: out.join("\n") + "\n", imagesLeftOut: page.images };
}
