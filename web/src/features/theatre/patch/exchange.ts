// The paperwork files of Stage > Lighting Paperwork: a console's patch as USITT ASCII text or as a CSV list, and the
// MVR scene file written from the drawing's instruments and read back to place them on the active design layer. The
// text is made in usitt.ts and mvr.ts; the downloads, the file picker and the placing are here.

import { attempt } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { downloadBlob } from "../../../app/fileio.ts";
import { store } from "../../../app/state.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import { zipFiles } from "../../../export/zip.ts";
import { unzip } from "../../../import/zip.ts";
import type { FixtureEdit } from "../fixture.ts";
import { fixtures, placeInstrument } from "../instrument.ts";
import { stageFrame } from "../stageTool.ts";
import { downloadText, csvText } from "../ui.ts";
import { addressOf, counted, universeOf } from "./patch.ts";
import { instrumentTypeOf, mvrXml, parseMvr, type MvrFixture } from "./mvr.ts";
import { PATCH_HEADINGS, patchRows, usittPatch, type Skipped } from "./usitt.ts";

/** The drawing's name without its extension, for the names of the files saved. */
function baseName(): string {
  return store.fileName.replace(/\.(vwx|sta)$/i, "").trim() || "Untitled";
}

/** The instruments left out of a console file, as a toast's words: how many, and the first few with why. */
function skippedNote(skipped: readonly Skipped[]): string {
  if (skipped.length === 0) return "";
  const shown = skipped
    .slice(0, 3)
    .map((s) => `${s.label} (${s.reason})`)
    .join("; ");
  const more = skipped.length > 3 ? `, and ${skipped.length - 3} more` : "";
  return ` Left out ${counted(skipped.length, "instrument")}: ${shown}${more}.`;
}

/** Stage > Lighting Paperwork > Export to Console > USITT ASCII Patch: the channels and absolute addresses, as the console reads them. */
export function exportUsitt(): void {
  const list = fixtures();
  if (list.length === 0) {
    toast("There are no lighting instruments in this drawing to export.", "info");
    return;
  }
  const { text, patched, skipped } = usittPatch(list);
  if (patched === 0) {
    toast(`Nothing to export: no instrument has a whole-number channel and a DMX address.${skippedNote(skipped)}`, "info");
    return;
  }
  downloadText(`${baseName()} patch.asc`, text, "text/plain");
  toast(`Exported ${counted(patched, "patched instrument")} to ${baseName()} patch.asc.${skippedNote(skipped)}`, "info");
}

/** Stage > Lighting Paperwork > Export to Console > Patch CSV: every instrument's patch and details, as a spreadsheet reads them. */
export function exportPatchCsv(): void {
  const list = fixtures();
  if (list.length === 0) {
    toast("There are no lighting instruments in this drawing to export.", "info");
    return;
  }
  downloadText(`${baseName()} patch.csv`, csvText(PATCH_HEADINGS, patchRows(list)), "text/csv");
  toast(`Exported ${counted(list.length, "instrument")} to ${baseName()} patch.csv.`, "info");
}

/** Stage > Lighting Paperwork > Export MVR: the scene as a .mvr file, a zip holding its GeneralSceneDescription.xml. */
export function exportMvr(): void {
  const list = fixtures();
  if (list.length === 0) {
    toast("There are no lighting instruments in this drawing to export.", "info");
    return;
  }
  const xml = mvrXml(list, stageFrame(), baseName());
  const bytes = zipFiles([["GeneralSceneDescription.xml", new TextEncoder().encode(xml)]]);
  downloadBlob(`${baseName()}.mvr`, new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }));
  toast(`Exported ${counted(list.length, "instrument")} to ${baseName()}.mvr.`, "info");
}

/** The picked file's name and bytes, or null when the picker is cancelled. */
function pickMvr(): Promise<{ readonly name: string; readonly bytes: Uint8Array } | null> {
  return new Promise((resolve) => {
    const input = h("input", { attrs: { type: "file", accept: ".mvr,.xml,application/zip,text/xml" }, hidden: true });
    document.body.append(input);
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        resolve(null);
        return;
      }
      file.arrayBuffer().then(
        (buf) => resolve({ name: file.name, bytes: new Uint8Array(buf) }),
        () => resolve(null),
      );
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });
    input.click();
  });
}

/** The scene's XML: from an MVR file (a zip holding GeneralSceneDescription.xml), or from the XML itself. */
function xmlOf(bytes: Uint8Array): string {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return new TextDecoder().decode(bytes);
  const files = unzip(bytes);
  const name = [...files.keys()].find((n) => /(^|\/)GeneralSceneDescription\.xml$/i.test(n));
  const read = name === undefined ? undefined : files.get(name);
  if (!read) throw new Error("the archive has no GeneralSceneDescription.xml in it");
  return new TextDecoder().decode(read());
}

/** The instrument an MVR fixture becomes: its layer is its position, its address split into universe and address. */
function editOf(f: MvrFixture): FixtureEdit {
  return {
    position: f.layer,
    unit: f.unit,
    universe: f.address > 0 ? universeOf(f.address) : 0,
    address: f.address > 0 ? addressOf(f.address) : 0,
    heightMm: f.z,
  };
}

/** Places an MVR file's instruments on the active design layer, as one undo step, and says how many. */
function placeMvr(name: string, bytes: Uint8Array): void {
  const s = store.session;
  const layer = s?.doc.layers().find((l) => l.id === store.activeLayerId);
  if (!s || !layer || layer.kind !== "design") {
    toast("Make a design layer active, so the instruments can go on it.", "info");
    return;
  }
  let found: MvrFixture[];
  try {
    found = parseMvr(xmlOf(bytes));
  } catch (err) {
    toast(`${name} couldn't be read: ${errorMessage(err)}`);
    return;
  }
  if (found.length === 0) {
    toast(`${name} has no instruments in it.`, "info");
    return;
  }
  const layerId = layer.id;
  const placed = attempt("Import MVR", (session) =>
    session.batch(() => {
      for (const f of found) placeInstrument(session, layerId, { x: f.x, y: f.y }, instrumentTypeOf(f.spec), editOf(f));
      return found.length;
    }),
  );
  if (placed) toast(`Placed ${counted(placed.value, "instrument")} from ${name} on ${layer.name}.`, "info");
}

/** Stage > Lighting Paperwork > Import MVR: picks an MVR file and places its instruments on the active design layer. */
export function importMvr(): void {
  if (!store.session) {
    toast("Open a drawing first.", "info");
    return;
  }
  void pickMvr().then((file) => {
    if (file) placeMvr(file.name, file.bytes);
  });
}
