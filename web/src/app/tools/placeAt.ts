// The click a command asks for on the 2D drawing (placeAt.ts): where its list of properties goes.
// Taken up by the command alone; it hands back to the tool before it when clicked, and Esc gives up.

import type { Pt } from "../../core/index.ts";
import { ANGLE_STEP_DEG, snapAngle } from "../geom.ts";
import { endPlace, placeJob } from "../placeAt.ts";
import { BaseTool, type Painter, type PointerInfo } from "../tools.ts";
import { preview } from "./detailing.ts";

export class PlaceAtTool extends BaseTool {
  readonly id = "placeat";
  readonly cursor = "crosshair";
  private pointer: Pt | null = null;

  hint(): string {
    const job = placeJob();
    return job ? (job.hint ?? `${job.what}: click where it goes · Esc cancels`) : "Place: choose Model > Engineering Properties… or Volumetric Properties…";
  }

  snapFrom(): Pt | null {
    return placeJob()?.from ?? null;
  }

  down(p: PointerInfo): void {
    const job = placeJob();
    if (job) job.place(this.at(p));
    // a job that asks for another click keeps the tool
    if (placeJob() === job) endPlace();
  }

  move(p: PointerInfo): void {
    this.pointer = this.at(p);
  }

  overlay(g: Painter): void {
    const job = placeJob();
    const b = this.pointer;
    if (!job || !b) return;
    const parts = job.preview?.(b) ?? (job.from ? [{ kind: "polyline" as const, points: [job.from, b], closed: false }] : null);
    if (parts) preview(g, parts);
  }

  private at(p: PointerInfo): Pt {
    const from = placeJob()?.from;
    return from && p.shift ? snapAngle(from, p.pos, ANGLE_STEP_DEG) : p.pos;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape") return false;
    endPlace();
    return true;
  }
}
