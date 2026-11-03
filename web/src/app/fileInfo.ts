// File > File Info…: what Vectorworks shows of the active file, as a list. Its name and kind, its
// size as opened and when it last changed on disk (when the browser gave a handle to it), the
// Vectorworks versions the file says created it and last saved it, with the build, its units,
// whether it has changes not saved yet, and what it holds: design and sheet layers, classes,
// objects, symbol definitions and resources. A browser isn't told the file's folder, so no
// location is shown.

import "./engineeringProperties.css";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";

/** "VW23.0.2" as Vectorworks names the release: Vectorworks 2018 (23.0.2). */
export function versionName(v: string): string {
  const m = /^VW(\d+)((?:\.\d+)*)$/i.exec(v.trim());
  if (!m) return v.trim() || "Not known";
  const major = Number(m[1]);
  return major >= 13 ? `Vectorworks ${major + 1995} (${m[1]}${m[2]})` : `Vectorworks ${m[1]}${m[2]}`;
}

function bytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]} (${n.toLocaleString()} bytes)`;
}

const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The lines File Info lists, under their headings; `untitled` for a drawing not saved yet. */
export async function fileInfoLines(untitled: boolean): Promise<{ title?: string; lines: [string, string][] }[]> {
  const session = store.session;
  if (!session) return [];
  const doc = session.doc;
  const info = doc.info;
  const name = store.fileName || info.fileName || "Untitled";
  const kind = untitled ? "New drawing, not saved yet" : /\.sta$/i.test(name) ? "Vectorworks template (.sta)" : "Vectorworks drawing (.vwx)";
  let modified: string | null = null;
  if (store.handle) {
    try {
      const file = await store.handle.getFile();
      modified = new Date(file.lastModified).toLocaleString();
    } catch {
      // the browser may ask again for permission to read it; leave it out
    }
  }
  const layers = doc.layers();
  const design = layers.filter((l) => l.kind === "design");
  const objects = layers.reduce((n, l) => n + l.objectCount, 0);
  return [
    {
      lines: [
        ["Name", name],
        ["Kind", kind],
        ...(untitled || !(store.fileSize > 0) ? [] : [["Size as opened", bytes(store.fileSize)] as [string, string]]),
        ...(modified ? [["Last changed on disk", modified] as [string, string]] : []),
        ["Unsaved changes", session.dirty ? "Yes" : "No"],
      ],
    },
    {
      title: "Vectorworks",
      lines: [
        ["Created with", versionName(info.createdWith)],
        ["Last saved with", versionName(info.savedWith)],
        ["Build", info.build ? String(info.build) : "Not known"],
        ["Units", info.units || "Not known"],
      ],
    },
    {
      title: "Contents",
      lines: [
        ["Design layers", count(design.length, "layer")],
        ["Sheet layers", count(layers.length - design.length, "sheet")],
        ["Classes", count(doc.classes().length, "class", "classes")],
        ["Objects", count(objects, "object")],
        ["Symbol definitions", count(doc.symbolDefs().length, "definition")],
        ["Resources", count(doc.resources().length, "resource")],
        ["Records in the file", count(info.records, "record")],
      ],
    },
  ];
}

/** File > File Info…: the list, in a box. */
export async function fileInfoDialog(untitled: boolean): Promise<void> {
  const groups = await fileInfoLines(untitled);
  if (groups.length === 0) return;
  const list = h(
    "dl",
    { cls: "props-list" },
    ...groups.flatMap((g) => [
      ...(g.title ? [h("div", { cls: "props-group", text: g.title })] : []),
      ...g.lines.flatMap(([label, value]) => [h("dt", { text: label }), h("dd", { text: value })]),
    ]),
  );
  await showDialog<true>({
    title: "File Info",
    okLabel: "OK",
    cls: "props-dialog",
    body: [
      h("div", { cls: "props-holder" }, list),
      h("p", { cls: "muted", text: "The versions are the ones the file names; saving it here keeps them." }),
    ],
    check: () => ({ value: true }),
  });
}
