// Checks the Revit and compound file readers under Node. Run from web/:
//   npx tsx src/import/rvt.check.ts
// Revit files written here as the samples are laid out (rvt.ts's notes) read back: a 2015-style
// project in 512-byte sectors, its Project Information zipped, with links and a thumbnail, and a
// 2024-style family template in 4096-byte sectors with its category, parameters and types. A
// compound file big enough that its FAT runs past the header's 109 sector numbers reads whole.
// Something not a compound file, one with no BasicFileInfo, one cut short and one whose sector
// chain loops are refused with a message, not a hang. With RVT_SAMPLES set to a folder of
// Autodesk's sample projects and families (fetched from revit.downloads.autodesk.com, never kept in
// this repository), each reads with its release, build, title, save time and thumbnail; a name
// starting with a year ("2024-racbasicsampleproject.rvt") must match the release read.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32 } from "../core/bytes.ts";
import { zipFiles } from "../export/zip.ts";
import { isCompoundFile, readCompoundFile } from "./cfb.ts";
import { isRevitName, readRevit, type RevitFile } from "./rvt.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

/** The message `run` throws with; "" when it doesn't throw. */
function thrown(run: () => unknown): string {
  try {
    run();
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

// ---- writing compound files ----------------------------------------------------------------------

const END = 0xfffffffe;
const NONE = 0xffffffff;

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function u32s(values: readonly number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const v = new DataView(out.buffer);
  values.forEach((x, i) => v.setUint32(i * 4, x, true));
  return out;
}

interface Entry {
  name: string;
  type: 1 | 2 | 5;
  children: number[];
  data: Uint8Array;
  start: number;
}

/**
 * A compound file holding `files` (storages before a "/"), in sectors of 1 << `shift` bytes:
 * streams under 4096 bytes in the mini stream, a storage's children chained through their right
 * siblings, the FAT's sectors listed in the header and, past 109 of them, in DIFAT sectors.
 */
function compoundFile(files: readonly (readonly [string, Uint8Array])[], shift: 9 | 12): Uint8Array {
  const size = 1 << shift;
  const entries: Entry[] = [{ name: "Root Entry", type: 5, children: [], data: new Uint8Array(), start: END }];
  const storages = new Map<string, number>([["", 0]]);
  for (const [path, data] of files) {
    const parts = path.split("/");
    let parent = 0;
    let prefix = "";
    for (const part of parts.slice(0, -1)) {
      prefix += part + "/";
      let i = storages.get(prefix);
      if (i === undefined) {
        i = entries.push({ name: part, type: 1, children: [], data: new Uint8Array(), start: 0 }) - 1;
        storages.set(prefix, i);
        entries[parent].children.push(i);
      }
      parent = i;
    }
    entries[parent].children.push(entries.push({ name: parts[parts.length - 1], type: 2, children: [], data, start: END }) - 1);
  }

  const miniFat: number[] = [];
  const miniParts: Uint8Array[] = [];
  for (const e of entries) {
    if (e.type !== 2 || e.data.length >= 4096 || e.data.length === 0) continue;
    const n = Math.ceil(e.data.length / 64);
    e.start = miniFat.length;
    for (let k = 0; k < n; k++) miniFat.push(k === n - 1 ? END : miniFat.length + 1);
    const padded = new Uint8Array(n * 64);
    padded.set(e.data);
    miniParts.push(padded);
  }

  const sectors: Uint8Array[] = [];
  const fat: number[] = [];
  const put = (data: Uint8Array): number => {
    if (data.length === 0) return END;
    const start = sectors.length;
    const n = Math.ceil(data.length / size);
    for (let k = 0; k < n; k++) {
      const s = new Uint8Array(size);
      s.set(data.subarray(k * size, (k + 1) * size));
      sectors.push(s);
      fat.push(k === n - 1 ? END : start + k + 1);
    }
    return start;
  };
  for (const e of entries) if (e.type === 2 && e.data.length >= 4096) e.start = put(e.data);
  const miniStream = concat(miniParts);
  entries[0].start = put(miniStream);
  const miniFatStart = put(u32s(miniFat));

  const dir = new Uint8Array(Math.ceil((entries.length * 128) / size) * size);
  const dv = new DataView(dir.buffer);
  for (let i = 0; i < dir.length / 128; i++) {
    const at = i * 128;
    for (const off of [0x44, 0x48, 0x4c]) dv.setUint32(at + off, NONE, true);
    const e = entries[i];
    if (!e) continue;
    for (let k = 0; k < e.name.length; k++) dv.setUint16(at + k * 2, e.name.charCodeAt(k), true);
    dv.setUint16(at + 0x40, (e.name.length + 1) * 2, true);
    dir[at + 0x42] = e.type;
    dir[at + 0x43] = 1;
    const parent = entries.find((p) => p.children.includes(i));
    const next = parent ? parent.children[parent.children.indexOf(i) + 1] : undefined;
    if (next !== undefined) dv.setUint32(at + 0x48, next, true);
    if (e.children.length) dv.setUint32(at + 0x4c, e.children[0], true);
    dv.setUint32(at + 0x74, e.start, true);
    dv.setUint32(at + 0x78, i === 0 ? miniStream.length : e.data.length, true);
  }
  const dirStart = put(dir);

  // the FAT covers every sector, its own and the DIFAT's among them
  const per = size / 4;
  let fatCount = 0;
  let difatCount = 0;
  for (;;) {
    const total = sectors.length + fatCount + difatCount;
    const f = Math.ceil(total / per);
    const d = f > 109 ? Math.ceil((f - 109) / (per - 1)) : 0;
    if (f === fatCount && d === difatCount) break;
    fatCount = f;
    difatCount = d;
  }
  const fatStart = sectors.length;
  const difatStart = fatStart + fatCount;
  const table = [...fat, ...Array<number>(fatCount).fill(0xfffffffd), ...Array<number>(difatCount).fill(0xfffffffc)];
  while (table.length < fatCount * per) table.push(NONE);
  for (let k = 0; k < fatCount; k++) sectors.push(u32s(table.slice(k * per, (k + 1) * per)));
  const fatSectors = Array.from({ length: fatCount }, (_, k) => fatStart + k);
  for (let k = 0; k < difatCount; k++) {
    const listed = fatSectors.slice(109 + k * (per - 1), 109 + (k + 1) * (per - 1));
    while (listed.length < per - 1) listed.push(NONE);
    sectors.push(u32s([...listed, k === difatCount - 1 ? END : difatStart + k + 1]));
  }

  const header = new Uint8Array(size);
  const hv = new DataView(header.buffer);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  hv.setUint16(0x18, 0x3e, true);
  hv.setUint16(0x1a, shift === 12 ? 4 : 3, true);
  hv.setUint16(0x1c, 0xfffe, true);
  hv.setUint16(0x1e, shift, true);
  hv.setUint16(0x20, 6, true);
  if (shift === 12) hv.setUint32(0x28, dir.length / size, true);
  hv.setUint32(0x2c, fatCount, true);
  hv.setUint32(0x30, dirStart, true);
  hv.setUint32(0x38, 4096, true);
  hv.setUint32(0x3c, miniFatStart, true);
  hv.setUint32(0x40, Math.ceil(miniFat.length / per), true);
  hv.setUint32(0x44, difatCount ? difatStart : END, true);
  hv.setUint32(0x48, difatCount, true);
  for (let k = 0; k < 109; k++) hv.setUint32(0x4c + k * 4, k < fatCount ? fatStart + k : NONE, true);
  return concat([header, ...sectors]);
}

// ---- writing Revit's streams ---------------------------------------------------------------------

const utf16 = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) new DataView(out.buffer).setUint16(i * 2, text.charCodeAt(i), true);
  return out;
};
const counted = (text: string): Uint8Array => concat([u32s([text.length]), utf16(text)]);

/** BasicFileInfo as Revit writes it: the stream version, the counted strings, then the "Key: value" lines after 0d 0a, on an odd byte when `odd`. */
function basicFileInfo(version: number, strings: readonly string[], lines: readonly string[], odd: boolean): Uint8Array {
  const head = concat([u32s([version]), new Uint8Array(10), ...strings.map(counted)]);
  const pad = head.length % 2 === (odd ? 0 : 1) ? new Uint8Array(1) : new Uint8Array();
  return concat([head, pad, new Uint8Array([0x0d, 0x0a]), utf16(lines.map((l) => l + "\r\n").join(""))]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const body = concat([new TextEncoder().encode(type), data]);
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(body, 4);
  v.setUint32(8 + data.length, crc32(body));
  return out;
}

/** A PNG's chunks for a picture `w` by `h` (the pixels aren't read, so the image data is a stand-in). */
function png(w: number, h: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, w);
  new DataView(ihdr.buffer).setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return concat([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr), pngChunk("IDAT", new Uint8Array([1, 2, 3])), pngChunk("IEND", new Uint8Array())]);
}

const atomHead = (title: string, updated: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<entry xmlns="http://www.w3.org/2005/Atom" xmlns:A="urn:schemas-autodesk-com:partatom"><title>${title}</title><updated>${updated}</updated>` +
  `<A:taxonomy><term>adsk:revit</term><label>Autodesk Revit</label></A:taxonomy>`;
const designFile = (file: string, release: number) =>
  `<link rel="design-2d" type="application/rvt" href="."><A:design-file><A:title>${file}</A:title><A:product>Revit</A:product><A:product-version>${release}</A:product-version></A:design-file></link>`;

function transmissionData(refs: readonly (readonly [string, string, string])[]): Uint8Array {
  const xml =
    `<?xml version="1.0"?>\n<TransmissionData isTransmitted="false" userData="" version="5">` +
    refs
      .map(
        ([type, path, state]) =>
          `<ExternalFileReference><ElementId>1</ElementId><ExternalFileReferenceType>${type}</ExternalFileReferenceType><LastSavedPath>${path}</LastSavedPath><LastSavedLoadState>${state}</LastSavedLoadState></ExternalFileReference>`,
      )
      .join("") +
    `</TransmissionData>`;
  return concat([u32s([xml.length]), utf16(xml)]);
}

// ---- a 2015-style project ------------------------------------------------------------------------

const projectXml =
  atomHead("Harbour Lofts", "2014-01-23T09:07:47Z") +
  designFile("Harbour Lofts.rvt", 2015) +
  `<A:features><A:feature><A:title>Project Information</A:title>` +
  `<A:group><A:title>Identity Data</A:title><Organization_Name displayName="Organization Name" type="system" typeOfParameter="Text">Smith &amp; Jones</Organization_Name><Author type="system" typeOfParameter="Text">A. Person</Author><Building_Name displayName="Building Name" type="system" typeOfParameter="Text"></Building_Name></A:group>` +
  `<A:group><A:title>Other</A:title><Project_Name displayName="Project Name" type="system" typeOfParameter="Text">Harbour Lofts</Project_Name><Project_Number displayName="Project Number" type="system" typeOfParameter="Text">2041-07</Project_Number><Project_Address displayName="Project Address" type="system" typeOfParameter="Multiline Text">1 Quay Road&#10;Falmouth</Project_Address></A:group>` +
  `</A:feature></A:features></entry>`;
// as Revit zips it: one entry named by a temporary path
const projectInfo = zipFiles([["C:\\Temp\\Revit{0}.project.xml", new TextEncoder().encode(projectXml)]]);
const thumbnail = concat([new Uint8Array([0x62, 0x19, 0x22, 0x05, 0x1a, 0, 0, 0]), new Uint8Array(223), png(128, 96), new Uint8Array([128, 0, 0, 0, 128, 0, 0, 0])]);
const partition = new Uint8Array(20000).map((_, i) => (i * 7) & 0xff);

const projectBytes = compoundFile(
  [
    ["BasicFileInfo", basicFileInfo(9, ["Autodesk Revit 2015 (Build: 20140120_2215(x64))", "C:\\Projects\\Harbour Lofts.rvt"], ["Worksharing: Central", "Username: ", "Revit Build: Autodesk Revit 2015 (Build: 20140120_2215(x64))", "Locale when saved: ENG"], false)],
    ["ProjectInformation", projectInfo],
    ["TransmissionData", transmissionData([["Keynote Table", "RevitKeynotes_Metric.txt", "Loaded"], ["Revit Link", "..\\Structure\\Harbour Lofts STR.rvt", "Unloaded"], ["CAD Link", "C:/site/survey.dwg", "Not Found"]])],
    ["RevitPreview4.0", thumbnail],
    ["Formats/Latest", new Uint8Array(500)],
    ["Global/Latest", new Uint8Array(300)],
    ["Partitions/5", partition],
  ],
  9,
);
check(isCompoundFile(projectBytes), "a compound file is recognised by its signature");
const streams = readCompoundFile(projectBytes);
check([...streams.keys()].sort().join() === "BasicFileInfo,Formats/Latest,Global/Latest,Partitions/5,ProjectInformation,RevitPreview4.0,TransmissionData", "its streams listed by path, through the storages");
const part = streams.get("Partitions/5")?.();
check(!!part && part.length === partition.length && part.every((b, i) => b === partition[i]), "a stream over the mini stream cutoff reads whole");
check(streams.get("TransmissionData")?.().length === transmissionData([["Keynote Table", "RevitKeynotes_Metric.txt", "Loaded"], ["Revit Link", "..\\Structure\\Harbour Lofts STR.rvt", "Unloaded"], ["CAD Link", "C:/site/survey.dwg", "Not Found"]]).length, "a small stream reads from the mini stream at its own length");

const project = readRevit(projectBytes, "Harbour Lofts.rvt");
check(project.kind === "project" && project.release === 2015 && project.build === "20140120_2215(x64)", "a 2015 project: its release and build from the head of BasicFileInfo");
check(project.worksharing === "Central" && project.locale === "ENG", "worksharing and locale from its lines, on an even byte");
check(project.title === "Harbour Lofts" && project.saved === "2014-01-23T09:07:47Z", "title and save time from Project Information");
const info = (f: RevitFile, name: string) => f.info.find((p) => p.name === name);
check(info(project, "Organization Name")?.value === "Smith & Jones" && info(project, "Organization Name")?.group === "Identity Data", "a parameter by its display name, in its group, entities read");
check(info(project, "Author")?.value === "A. Person", "a parameter with no display name named by its tag");
check(info(project, "Project Address")?.value === "1 Quay Road\nFalmouth", "a multi-line value");
check(!info(project, "Building Name"), "an empty parameter left out");
check(project.info.map((p) => p.name).join() === "Organization Name,Author,Project Name,Project Number,Project Address", "parameters in the file's order");
check(project.category === null && project.types.length === 0, "a project has no family category or types");
check(
  project.links.map((l) => `${l.type}|${l.name}|${l.state}`).join() === "Keynote Table|RevitKeynotes_Metric.txt|Loaded,Revit Link|Harbour Lofts STR.rvt|Unloaded,CAD Link|survey.dwg|Not Found",
  "linked files by type, name (no folders) and state",
);
check(!!project.preview && project.preview.width === 128 && project.preview.height === 96 && project.preview.png.length === png(128, 96).length && project.preview.png[1] === 0x50, "the thumbnail: the PNG alone, cut at IEND, with its size");

// ---- a 2024-style family template, 4096-byte sectors --------------------------------------------

const familyXml =
  atomHead("Desk", "2023-03-27T11:56:02Z") +
  `<category><term>23.40.20.14.17</term><scheme>std:oc1</scheme></category><category><term>Furniture</term><scheme>adsk:revit:grouping</scheme></category>` +
  designFile("Desk.rft", 2024) +
  `<A:features><A:feature><A:title>Family Parameters</A:title><A:group><A:title>Identity Data</A:title><OmniClass_Number displayName="OmniClass Number" type="system" typeOfParameter="Text">23.40.20.14.17</OmniClass_Number></A:group></A:feature></A:features>` +
  `<A:family type="user"><A:variationCount>2</A:variationCount>` +
  `<A:part type="user"><title>1200 x 600</title><Width type="custom" typeOfParameter="Length" units="mm">1200.00</Width><Top_Material displayName="Top Material" type="custom" typeOfParameter="Material">Oak</Top_Material></A:part>` +
  `<A:part type="user"><title>1600 x 800</title><Width type="custom" typeOfParameter="Length" units="mm">1600.00</Width></A:part>` +
  `</A:family></entry>`;
const familyBytes = compoundFile(
  [
    ["BasicFileInfo", basicFileInfo(14, ["2024", "20230308_1635(x64)", "C:\\Families\\Desk.rft"], ["Worksharing: Not enabled", "Format: 2024", "Build: 20230308_1635(x64)", "Locale when saved: DEU"], true)],
    ["PartAtom", new TextEncoder().encode(familyXml)],
    ["Formats/Latest", new Uint8Array(5000)],
  ],
  12,
);
const family = readRevit(familyBytes, "Desk.rft");
check(family.kind === "family template", "an .rft with a PartAtom is a family template");
check(readRevit(familyBytes, "Desk.rfa").kind === "family", "the same named .rfa is a family");
check(family.release === 2024 && family.build === "20230308_1635(x64)", "a 2024 file: release and build from their own counted strings");
check(family.worksharing === "Not enabled" && family.locale === "DEU", "its lines read on an odd byte");
check(family.title === "Desk" && family.category === "Furniture", "title and category from PartAtom");
check(info(family, "OmniClass Number")?.value === "23.40.20.14.17", "family parameters");
check(
  family.types.map((t) => `${t.name}: ${t.params.map((p) => `${p.name}=${p.value}`).join("; ")}`).join(" / ") === "1200 x 600: Width=1200.00 mm; Top Material=Oak / 1600 x 800: Width=1600.00 mm",
  "each type with its parameters, lengths with their units",
);
check(family.links.length === 0 && family.preview === null, "no TransmissionData or thumbnail: none read, nothing refused");

// a release only the Atom says (BasicFileInfo's head and lines unreadable)
const atomOnly = compoundFile(
  [
    ["BasicFileInfo", basicFileInfo(14, [], ["Worksharing: Not enabled"], true)],
    ["PartAtom", new TextEncoder().encode(atomHead("Chair", "2025-05-01T10:00:00Z") + designFile("Chair.rfa", 2026) + "</entry>")],
  ],
  9,
);
check(readRevit(atomOnly).release === 2026 && readRevit(atomOnly).build === null, "the release from the Atom's product version when BasicFileInfo has none");

// ---- a FAT past the header (DIFAT) ---------------------------------------------------------------

const big = new Uint8Array(8_000_000);
for (let i = 0; i < big.length; i += 4093) big[i] = (i >> 12) & 0xff;
const bigFile = compoundFile([["BasicFileInfo", basicFileInfo(14, ["2020", "x"], ["Worksharing: Local"], true)], ["Partitions/1", big]], 9);
check(new DataView(bigFile.buffer).getUint32(0x48, true) > 0, "an 8 MB stream in 512-byte sectors needs DIFAT sectors");
const bigBack = readCompoundFile(bigFile).get("Partitions/1")?.();
let same = !!bigBack && bigBack.length === big.length;
for (let i = 0; same && i < big.length; i += 4093) same = bigBack![i] === big[i];
check(same, "and reads back whole, through the DIFAT");
check(readRevit(bigFile).worksharing === "Local", "a workshared local copy says so");

// ---- refused -------------------------------------------------------------------------------------

check(thrown(() => readRevit(new TextEncoder().encode("ISO-10303-21;"))) === "this isn't a Revit file", "a file that isn't a compound file is refused");
check(thrown(() => readRevit(compoundFile([["WordDocument", new Uint8Array(100)]], 9))) === "this isn't a Revit file", "a compound file with no BasicFileInfo is refused");
const cut = projectBytes.subarray(0, 512 * 3);
check(/cut short|damaged/.test(thrown(() => readRevit(cut))), "a file cut short is refused with a message");
const looped = projectBytes.slice();
{
  // the first FAT sector's first entry made to point at itself: the chain from sector 0 loops
  const v = new DataView(looped.buffer);
  const fatAt = (v.getUint32(0x4c, true) + 1) * 512;
  v.setUint32(fatAt, 0, true);
}
const loopMessage = thrown(() => readCompoundFile(looped).get("Partitions/5")?.());
check(/damaged|cut short/.test(loopMessage), `a sector chain that loops is refused, not followed for ever ("${loopMessage}")`);
check(isRevitName("A.RVT") && isRevitName("b.rfa") && isRevitName("c.rte") && isRevitName("d.rft") && !isRevitName("e.rvt.zip") && !isRevitName("f.ifc"), "Revit files known by their names");

// ---- Autodesk's samples --------------------------------------------------------------------------

const samples = process.env.RVT_SAMPLES;
if (samples) {
  const names = readdirSync(samples).filter(isRevitName).sort();
  check(names.length > 0, `RVT_SAMPLES holds Revit files (${names.length})`);
  for (const name of names) {
    const t0 = performance.now();
    let f: RevitFile;
    try {
      f = readRevit(new Uint8Array(readFileSync(join(samples, name))), name);
    } catch (err) {
      check(false, `${name}: reads (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    const ms = performance.now() - t0;
    const year = /^(\d{4})-/.exec(name)?.[1];
    check(f.release !== null && f.release >= 2008 && (!year || f.release === Number(year)), `${name}: Revit ${f.release}${year ? ", as its name says" : ""}`);
    check(!!f.build && !!f.title && /^\d{4}-\d\d-\d\dT/.test(f.saved ?? "") && !!f.worksharing && !!f.locale, `${name}: build ${f.build}, "${f.title}", saved ${f.saved}, ${f.worksharing}, ${f.locale}`);
    if (f.preview) check(f.preview.png[0] === 0x89 && f.preview.width > 0 && f.preview.height > 0, `${name}: a ${f.preview.width} x ${f.preview.height} thumbnail`);
    else console.log(`     ${name}: no thumbnail saved`);
    if (f.kind === "family") check(!!f.category && f.types.length > 0 && f.types.every((t) => t.name && t.params.length), `${name}: a ${f.category} family, ${f.types.length} types`);
    else check(f.info.length > 0, `${name}: ${f.info.length} Project Information values (${info(f, "Project Name")?.value ?? "no project name"})`);
    check(ms < 500, `${name}: read in ${ms.toFixed(0)} ms`);
  }
} else {
  console.log("\n(RVT_SAMPLES not set: Autodesk's sample files not checked)");
}

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
