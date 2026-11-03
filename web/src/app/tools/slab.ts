// Slab tool (Building Shell): draws a rectangular slab between two corners, by press-drag-release
// or click-click, as the Rectangle tool takes them; Shift makes it square. A new slab is a copy of a
// rectangular slab the drawing has (a slab plug-in drawn only with its outline, components and
// solids), stretched onto the rectangle: its style, thickness, heights and components are that
// slab's (Preferences chooses which, one per style and thickness). It goes on the active layer in
// the active class, one undo step, selected; the tool stays active for more.

import type { ObjectInfo, Pt, SlabTemplate } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { store } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo } from "../tools.ts";
import { formatLength } from "../units.ts";

/** the slab a slab plug-in draws (its outline, thickness and style) */
const SLAB_PART = 71;

/** pointer travel (CSS px) that counts as a drag rather than a click */
const CLICK_PX = 4;

export class SlabTool extends BaseTool {
  readonly id = "slab";
  readonly cursor = "crosshair";
  /** the slab a new one copies (SlabTemplate.id), once one has been chosen */
  private template: string | null = null;
  /** the first corner, once pressed */
  private first: { pos: Pt; screen: Pt } | null = null;
  /** last pointer event; the preview follows it */
  private pointer: PointerInfo | null = null;

  async preferences(): Promise<void> {
    const kinds = store.session?.slabTemplates() ?? [];
    if (!kinds.length) return;
    const units = store.session?.doc.info.units;
    const v = await toolPrefs(
      "Slab Preferences",
      [{ kind: "choice", key: "style", label: "Style", value: this.current()?.id ?? kinds[0].id, options: kinds.map((k) => ({ value: k.id, label: slabLabel(k, units) })) }],
      "A new slab copies a rectangular one the drawing has in that style, stretched onto the rectangle drawn.",
    );
    if (v) this.template = v.choice("style");
  }

  snapFrom(): Pt | null {
    return this.first?.pos ?? null;
  }

  /**
   * Create Similar Object: new slabs copy this slab plug-in (or the one this slab is drawn in), or
   * another of its style; an unstyled one only itself.
   */
  takeFrom(obj: ObjectInfo): boolean {
    const s = store.session;
    if (!s) return false;
    const id = obj.type === SLAB_PART && obj.parentId ? obj.parentId : obj.id;
    // a slab plug-in's Style parameter names its style
    const style = (x: string): unknown => s.doc.records(x).find((r) => r.parametric)?.fields.find((f) => f.name === "Style")?.value;
    const own = style(id);
    const kind = s.slabTemplates().find((k) => k.id === id || (typeof own === "number" && style(k.id) === own));
    if (kind) this.template = kind.id;
    return kind !== undefined;
  }

  hint(): string {
    const k = this.current();
    if (!k) return "This drawing has no rectangular slab to copy";
    return this.first
      ? "Click or release at the opposite corner · Shift square · Esc cancels"
      : `Press and drag, or click two corners · ${slabLabel(k, store.session?.doc.info.units)}`;
  }

  move(p: PointerInfo): void {
    this.pointer = p;
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    if (!this.first) {
      this.first = { pos: p.pos, screen: p.screen };
      return;
    }
    this.place(p);
  }

  up(p: PointerInfo): void {
    // a drag places at its release; a click waits for the second corner
    const first = this.first;
    if (first && Math.hypot(p.screen.x - first.screen.x, p.screen.y - first.screen.y) >= CLICK_PX) this.place(p);
  }

  cancel(): void {
    this.first = null;
    this.pointer = null;
  }

  key(e: KeyboardEvent): boolean {
    if (!this.first || e.key !== "Escape") return false;
    this.first = null;
    this.env.requestDraw();
    return true;
  }

  overlay(g: Painter): void {
    if (!this.first || !this.pointer) return;
    const a = this.first.pos;
    const b = this.corner(this.pointer);
    withPreview(g, () => strokeScreen(g, [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], true));
  }

  private place(p: PointerInfo): void {
    const first = this.first;
    this.first = null;
    const k = this.current();
    const layerId = store.activeLayerId;
    if (!first || !k || !layerId) return;
    const b = this.corner(p);
    const r = attempt("Add Slab", (s) => s.addSlab(layerId, first.pos, b, k.id, store.activeClassIndex));
    if (r) setEditGroup(null, [r.value]);
  }

  /** The opposite corner for the pointer: Shift makes the rectangle square. */
  private corner(p: PointerInfo): Pt {
    const a = this.first?.pos ?? p.pos;
    if (!p.shift) return p.pos;
    const dx = p.pos.x - a.x;
    const dy = p.pos.y - a.y;
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: a.x + Math.sign(dx || 1) * side, y: a.y + Math.sign(dy || 1) * side };
  }

  /** The slab a new one copies: the one chosen, while the drawing still has it, else the first. */
  private current(): SlabTemplate | null {
    const kinds = store.session?.slabTemplates() ?? [];
    return kinds.find((k) => k.id === this.template) ?? kinds[0] ?? null;
  }
}

/** A slab kind as Preferences and the hint name it: its style and thickness. */
export function slabLabel(k: SlabTemplate, units: string | undefined): string {
  return `${k.style ?? "Unstyled"} · ${formatLength(k.thickness, units)} thick`;
}
