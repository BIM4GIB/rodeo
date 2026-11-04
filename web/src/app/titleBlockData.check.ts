// Node check of Duplicate on Layers (titleBlockData.ts). Run from web/: npx tsx src/app/titleBlockData.check.ts
// With TBB_SAMPLES set to a folder of drawings, each one with a title block border on a sheet has
// it copied to a new sheet and checked there; the files are only read, and only counts are printed.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { blankDrawing } from "../core/blank.ts";
import { openVwx } from "../core/index.ts";
import { dataRecord, duplicateTitleBlock, findTitleBlocks, isTitleBlock, layersWithoutTitleBlock, SHEET_DATA } from "./titleBlockData.ts";

// a drawing without title blocks: every layer can take one, and a plain object isn't one
{
  const s = openVwx(blankDrawing("mm"));
  const sheet = s.createLayer("A-1", "sheet");
  const rect = s.addObject(sheet, { kind: "rect", x0: 0, y0: 0, x1: 100, y1: 50 }, s.doc.classes()[0].index);
  assert.equal(isTitleBlock(s.doc, rect), false);
  assert.deepEqual(
    layersWithoutTitleBlock(s.doc).map((l) => l.id),
    s.doc.layers().map((l) => l.id),
  );
}

const folder = process.env.TBB_SAMPLES?.replace(/^~/, process.env.HOME ?? "~");
if (folder) {
  const names = (await readdir(folder)).filter((n) => n.toLowerCase().endsWith(".vwx"));
  let files = 0;
  let copies = 0;
  for (const name of names) {
    const bytes = new Uint8Array(await readFile(join(folder, name)));
    let s;
    try {
      s = openVwx(bytes, "check.vwx");
    } catch {
      continue;
    }
    const source = findTitleBlocks(s.doc).find((t) => t.sheet);
    if (!source) continue;
    files++;
    const sheet = s.createLayer("ZZ-99", "sheet");
    s.renameLayer(sheet, "ZZ-99", "Check Sheet");
    assert.ok(layersWithoutTitleBlock(s.doc).some((l) => l.id === sheet), `file ${files}: the new sheet can take one`);
    assert.ok(!layersWithoutTitleBlock(s.doc).some((l) => l.id === source.layerId), `file ${files}: the source's sheet can't`);
    const [copy] = s.batch(() => duplicateTitleBlock(s, source.id, [sheet]));
    assert.ok(copy && isTitleBlock(s.doc, copy), `file ${files}: the copy is a title block border`);
    assert.equal(s.doc.object(copy)?.layerId, sheet);
    const kids = (id: string): number => {
      const all = s.doc.objects(s.doc.object(id)?.layerId ?? "");
      const under = new Set([id]);
      let n = 0;
      for (const o of all)
        if (o.parentId && under.has(o.parentId)) {
          under.add(o.id);
          n++;
        }
      return n;
    };
    assert.equal(kids(copy), kids(source.id), `file ${files}: drawn as the original`);
    assert.equal(s.doc.records(copy).length, s.doc.records(source.id).length, `file ${files}: records kept`);
    const data = dataRecord(s.doc, copy, SHEET_DATA);
    if (data) {
      const field = (n: string): unknown => data.fields.find((f) => f.name === n)?.value;
      assert.equal(field("Sheet Number"), "ZZ-99", `file ${files}: sheet number coordinated`);
      assert.equal(field("Sheet Title"), "Check Sheet", `file ${files}: sheet title coordinated`);
      const orig = dataRecord(s.doc, source.id, SHEET_DATA)?.fields.find((f) => f.name === "Sheet Number")?.value;
      assert.notEqual(orig, "ZZ-99", `file ${files}: the original's left alone`);
    }
    const sheetAfter = s.doc.layers().find((l) => l.id === sheet);
    assert.equal(sheetAfter?.name, "ZZ-99");
    assert.equal(sheetAfter?.title, "Check Sheet");
    // saved and opened again, it's still there
    const again = openVwx(s.doc.toBytes(), "again.vwx").doc;
    const sheetAgain = again.layers().find((l) => l.name === "ZZ-99");
    assert.ok(sheetAgain && findTitleBlocks(again).some((t) => t.layerId === sheetAgain.id), `file ${files}: kept when saved`);
    copies++;
  }
  console.log(`title block samples: ${files} with a sheet title block, ${copies} copied and checked`);
}
console.log("titleBlockData: checks passed");
