// Stage > Lighting Paperwork > Magic Sheet…: asks for the sheet's width, bubble size and grouping, then draws it
// as a new sheet layer ("Magic Sheet", numbered if taken) at scale 1 in one undo step: a box per system, its
// colour chip, and the channels as bubbles in a small stage map. The new sheet is made active and fitted.

import { attempt, setActiveLayer, setSelection } from "../../../app/commands.ts";
import { appContext } from "../../../app/ext.ts";
import { colorMatcher } from "../../../app/pdfImport.ts";
import { store } from "../../../app/state.ts";
import { markerParts } from "../../../app/tools/markers.ts";
import type { Part } from "../../../app/tools/detailing.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import type { NewShape } from "../../../core/index.ts";
import { fixtures } from "../instrument.ts";
import { stageFrame } from "../stageTool.ts";
import { magicLayout, type Grouping } from "./magicSheet.ts";

const GROUPS: readonly { readonly value: Grouping; readonly label: string }[] = [
  { value: "purposeColour", label: "Purpose and Colour" },
  { value: "colour", label: "Colour" },
  { value: "position", label: "Position" },
];
const NOTE =
  "Each box is a system: its purpose and colour, its colour, or its position. A bubble is a channel, placed where its lights focus, or where they hang until they are focused. The sheet is drawn at scale 1 on a new sheet layer, as one undo step.";

/** what the window last asked for */
let prefs: { page: number; bubble: number; group: Grouping } = { page: 400, bubble: 8, group: "purposeColour" };

/**
 * "Magic Sheet", or the first of "Magic Sheet 2", "3"… whose layer name and drawing group name ("<name> Drawing")
 * no layer uses. The core refuses an object name that a layer has, so the group can't take the layer's name.
 */
function sheetName(): string {
  const taken = new Set((store.session?.doc.layers() ?? []).map((l) => l.name.toLowerCase()));
  const free = (base: string): boolean => !taken.has(base.toLowerCase()) && !taken.has(`${base} Drawing`.toLowerCase());
  let name = "Magic Sheet";
  for (let n = 2; !free(name); n++) name = `Magic Sheet ${n}`;
  return name;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export async function openMagicSheet(): Promise<void> {
  if (!store.session) return;
  if (fixtures().length === 0) {
    toast("This drawing has no lighting instruments to put on a magic sheet.", "info");
    return;
  }
  const v = await toolPrefs(
    "Magic Sheet",
    [
      { kind: "length", key: "page", label: "Page Width", value: prefs.page },
      { kind: "length", key: "bubble", label: "Bubble Size", value: prefs.bubble },
      { kind: "choice", key: "group", label: "Group Systems By", value: prefs.group, options: GROUPS },
    ],
    NOTE,
  );
  if (!v) return;
  const asked = v.choice("group");
  prefs = {
    page: v.num("page"),
    bubble: v.num("bubble"),
    group: GROUPS.some((g) => g.value === asked) ? (asked as Grouping) : "purposeColour",
  };
  const sheet = magicLayout(fixtures(), stageFrame(), { pageMm: prefs.page, bubbleMm: prefs.bubble, group: prefs.group });
  if (sheet.channels === 0) {
    toast("None of the lighting instruments has a channel yet, so there is nothing to put on the sheet.", "info");
    return;
  }
  const match = colorMatcher();
  const solid = (c: number) => ({ fillPattern: 1, fillFore: c, fillBack: c, fillOpacity: 100 });
  const parts: Part[] = [
    ...markerParts(sheet.drawing),
    ...sheet.chips.map((c): Part => ({ shape: { kind: "polygon", points: [...c.poly], closed: true }, attrs: solid(match(c.colour)) })),
  ];
  const name = sheetName();
  const made = attempt("Magic Sheet", (s) =>
    s.batch(() => {
      const layerId = s.createLayer(name, "sheet", 1);
      const ids = parts.map((part) =>
        "shape" in part ? s.addObject(layerId, part.shape, store.activeClassIndex, part.attrs) : s.addObject(layerId, part as NewShape, store.activeClassIndex),
      );
      const group = s.groupObjects(ids);
      s.setObjectName(group, `${name} Drawing`);
      return { layerId, group };
    }),
  );
  if (!made) return;
  setActiveLayer(made.value.layerId);
  setSelection([made.value.group]);
  appContext()?.fit();
  const left = sheet.unchanneled ? ` ${plural(sheet.unchanneled, "instrument")} with no channel ${sheet.unchanneled === 1 ? "is" : "are"} left off.` : "";
  toast(`Magic Sheet: ${plural(sheet.channels, "channel")} in ${plural(sheet.systems, "system")}.${left}`, "info");
}
