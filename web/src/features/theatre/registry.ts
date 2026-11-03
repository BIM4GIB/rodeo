// How each part of the Stage menu joins it: its menu rows under a section, and its tools, which it can
// add once the editor runs. A part calls these when its index.ts is imported.

import { onReady } from "../../app/ext.ts";
import type { Row } from "../../app/menu.ts";
import type { Tool, ToolEnv } from "../../app/tools.ts";

export type StageSection = "Venue" | "Sightlines" | "Scenes" | "Scene Shop" | "Event" | "ConnectCAD" | "ConnectCAD Layout" | "Lighting" | "Lighting Paperwork" | "Lighting Loads" | "Visualization" | "Audit";

const sections = new Map<StageSection, (() => readonly Row[])[]>();

/** Adds rows to a section of the Stage menu; they're read each time the menu opens. */
export function addStageRows(section: StageSection, rows: () => readonly Row[]): void {
  sections.set(section, [...(sections.get(section) ?? []), rows]);
}

/** The section's rows, parts' rows in the order they joined. */
export function stageRows(section: StageSection): Row[] {
  return (sections.get(section) ?? []).flatMap((r) => [...r()]);
}

/** Adds tools to the editor (their ids in state.ts's ToolId, as `setTool` and the toolbar pick them). */
export function addStageTools(build: (env: ToolEnv) => readonly Tool[]): void {
  onReady((ctx) => ctx.controller.addTools(build));
}
