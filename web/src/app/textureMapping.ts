// The texture commands Vectorworks puts on a textured object's context menu and on the Render tab's
// texture list: Rotate Texture by 90° turns the mapping a quarter turn, Reset to Default Mapping
// undoes what the Attribute Mapping tool or Object Info did (no offset, the texture's own scale, no
// rotation), and Remove Texture Override takes the texture off (None). Right-clicking the drawing
// acts on every textured part of the object under the pointer, and removes only the texture on the
// whole object; right-clicking a part's heading in the Render tab acts on that part. Each command is
// one undo step (EditSession.setObjectTexture for each part).

import type { TexturePart } from "../core/index.ts";
import { attempt } from "./commands.ts";
import type { Row } from "./menu.ts";
import { store } from "./state.ts";

/** Vectorworks' part id for the whole object */
const OVERALL = 3;
/** mapping values this close to the default are the default */
const SAME = 1e-9;

/** The parts of an object that show a texture (its own or its class's), or only those in `only`. */
function textured(id: string, only?: number): TexturePart[] {
  const parts = store.session?.doc.objectTextures(id) ?? [];
  return parts.filter((p) => p.texture !== -1 && (only === undefined || p.part === only));
}

function isDefault(p: TexturePart): boolean {
  return Math.abs(p.offsetU) < SAME && Math.abs(p.offsetV) < SAME && Math.abs(p.scaleU - 1) < SAME && Math.abs(p.scaleV - 1) < SAME && Math.abs(p.rotation) < SAME;
}

function rotate90(id: string, only?: number): void {
  attempt("Rotate Texture by 90°", (s) =>
    s.batch(() => {
      for (const p of textured(id, only)) s.setObjectTexture(id, p.part, { rotation: (((p.rotation + 90) % 360) + 360) % 360 });
    }),
  );
}

function resetMapping(id: string, only?: number): void {
  attempt("Reset to Default Mapping", (s) =>
    s.batch(() => {
      for (const p of textured(id, only)) {
        if (!isDefault(p)) s.setObjectTexture(id, p.part, { offsetU: 0, offsetV: 0, scaleU: 1, scaleV: 1, rotation: 0 });
      }
    }),
  );
}

function removeOverride(id: string, part: number): void {
  attempt("Remove Texture Override", (s) => s.setObjectTexture(id, part, { texture: -1 }));
}

/**
 * The texture rows for object `id`: for one of its parts (`part`, from the Render tab), or for the
 * whole object (the drawing's context menu). None when nothing there shows a texture.
 */
export function textureRows(id: string | null, part?: number): Row[] {
  if (id === null || !textured(id, part).length) return [];
  const remove = part ?? OVERALL;
  return [
    { label: "Rotate Texture by 90°", run: () => rotate90(id, part) },
    { label: "Reset to Default Mapping", enabled: () => textured(id, part).some((p) => !isDefault(p)), run: () => resetMapping(id, part) },
    ...(textured(id, remove).length ? [{ label: "Remove Texture Override", run: () => removeOverride(id, remove) }] : []),
  ];
}
