// Spotlight's Equipment Summary Key: a click places the key, with its corner chosen by the insertion mode
// at the click. features/theatre/docs/equipmentKey.ts draws it and counts the equipment.

import { keySettings, placeKey } from "../../features/theatre/docs/equipmentKey.ts";
import type { KeyCorner } from "../equipmentKeyShapes.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, type PointerInfo, type ToolModes } from "../tools.ts";
import { layerScale } from "./detailing.ts";

export class EquipmentKeyTool extends BaseTool {
  readonly id = "equipmentkey";
  readonly cursor = "crosshair";

  modes(): ToolModes {
    return {
      label: "Insertion Mode",
      options: [
        { id: "tl", label: "Top Left", key: "1" },
        { id: "bl", label: "Bottom Left", key: "2" },
        { id: "tr", label: "Top Right", key: "3" },
        { id: "br", label: "Bottom Right", key: "4" },
      ],
      active: keySettings.corner,
    };
  }

  setMode(id: string): void {
    keySettings.corner = id as KeyCorner;
  }

  async preferences(): Promise<void> {
    const s = keySettings;
    const v = await toolPrefs(
      "Equipment Summary Key Preferences",
      [
        { kind: "text", key: "title", label: "Key Title", value: s.title },
        { kind: "number", key: "size", label: "Text Size", value: s.size, min: 0.5, max: 50, unit: "mm on paper" },
        { kind: "check", key: "headers", label: "Column Headers", value: s.headers },
        { kind: "check", key: "total", label: "Total", value: s.total },
        { kind: "check", key: "colors", label: "Color Summary", value: s.colors },
        { kind: "check", key: "swatch", label: "Show Swatch", value: s.swatch },
        { kind: "check", key: "gobos", label: "Gobo Summary", value: s.gobos },
        { kind: "check", key: "circuits", label: "Circuit Summary", value: s.circuits },
        { kind: "check", key: "height", label: "Position Height", value: s.height },
        { kind: "check", key: "border", label: "Show Border", value: s.border },
      ],
      "It counts the lighting devices and plug-in objects in the drawing. After placing it, Object Info filters it to a hanging position, and Items and Elements… leaves things out or adds symbols. Click Refresh there when the drawing changes.",
    );
    if (!v) return;
    s.title = v.choice("title");
    s.size = v.num("size");
    s.headers = v.flag("headers");
    s.total = v.flag("total");
    s.colors = v.flag("colors");
    s.swatch = v.flag("swatch");
    s.gobos = v.flag("gobos");
    s.circuits = v.flag("circuits");
    s.height = v.flag("height");
    s.border = v.flag("border");
  }

  hint(): string {
    return "Click to place the equipment summary key";
  }

  down(p: PointerInfo): void {
    if (p.button !== 0 || p.detail > 1) return;
    const layerId = store.activeLayerId;
    if (!layerId || layerScale(this.env) === null) {
      toast("Make a design layer active to place an equipment summary key.", "info");
      return;
    }
    placeKey(layerId, p.pos);
  }
}
