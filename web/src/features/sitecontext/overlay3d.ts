// Site Context in the 3D view: each import's buildings and terrain as a group the view shows with the
// model, while the import's layer is shown. It is an overlay, never saved: it lives in memory with the
// open drawing and is cleared when another drawing opens. The meshes (and three.js) load only once
// there is context to show.

import type * as THREE from "three";
import type { View3D } from "../../app/view3d.ts";
import type { ContextImport } from "./model.ts";

type Meshes = typeof import("./meshes.ts");

/** The imported context of the open drawing, shown in the 3D view while it is on. */
export class ContextOverlay {
  /** each import, with its group once the meshes are built */
  private readonly imports = new Map<ContextImport, THREE.Group | null>();
  private meshes: Meshes | null = null;
  private view: View3D | null = null;
  private shown = true;

  /** Whether the view shows the context (View > Show Site Context in 3D). */
  get on(): boolean {
    return this.shown;
  }

  /** Whether the open drawing has any imported context. */
  get has(): boolean {
    return this.imports.size > 0;
  }

  /** Forgets the context: a drawing was opened or closed. */
  reset(): void {
    for (const group of this.imports.values()) {
      if (!group) continue;
      this.view?.removeContent(group);
      this.meshes?.disposeGroup(group);
    }
    this.imports.clear();
  }

  /** Adds an import of the open drawing; an open 3D view frames it. */
  add(imp: ContextImport): void {
    this.imports.set(imp, null);
    void import("./meshes.ts").then((m) => {
      this.meshes = m;
      // another drawing was opened meanwhile
      if (!this.imports.has(imp)) return;
      const group = m.buildGroup(imp);
      this.imports.set(imp, group);
      if (!this.view || !this.shown) return;
      this.view.addContent(group, imp.layer);
      if (this.view.visible) this.view.fit();
    });
  }

  /** Puts the overlay into the 3D view (when the view is made). */
  attach(view: View3D): void {
    this.view = view;
    this.sync();
  }

  setShown(on: boolean): void {
    this.shown = on;
    this.sync();
  }

  private sync(): void {
    const view = this.view;
    if (!view) return;
    for (const [imp, group] of this.imports) {
      if (!group) continue;
      if (this.shown) view.addContent(group, imp.layer);
      else view.removeContent(group);
    }
    view.redraw();
  }
}

/** The one overlay the editor has (the open drawing's context). */
export const siteOverlay = new ContextOverlay();
