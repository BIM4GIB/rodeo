// A command's "click where it goes" on the 2D drawing (Model > Engineering Properties and
// Volumetric Properties place their list of properties this way): the Place tool (tools/placeAt.ts)
// takes the next click, hands the point to the job, and gives back the tool before it, unless the job
// asks for another click (Create Joists' second). Esc gives up.

import type { Pt } from "../core/index.ts";
import { appContext } from "./ext.ts";
import type { ToolId } from "./state.ts";
import type { Part } from "./tools/detailing.ts";

/** What waits for the click: `what` names it in the hint, `place` takes the point clicked. */
export interface PlaceJob {
  readonly what: string;
  /** the whole hint, in place of the one `what` makes */
  readonly hint?: string;
  /** a line drawn from here to the pointer, Shift keeping it to 15° steps */
  readonly from?: Pt;
  /** what a click here would make, drawn under the pointer */
  preview?(at: Pt): readonly Part[] | null;
  place(at: Pt): void;
}

let job: PlaceJob | null = null;
let back: ToolId = "select";

export function placeJob(): PlaceJob | null {
  return job;
}

/** Takes up the Place tool for `next`, on the 2D drawing; false when the editor isn't running. */
export function placeAtNextClick(next: PlaceJob): boolean {
  const ctx = appContext();
  if (!ctx) return false;
  if (ctx.controller.activeId !== "placeat") back = ctx.controller.activeId;
  job = next;
  ctx.show2d();
  ctx.setTool("placeat");
  return true;
}

/** Drops the job and gives back the tool before it. */
export function endPlace(): void {
  job = null;
  appContext()?.setTool(back);
}
