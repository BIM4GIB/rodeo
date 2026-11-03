// Crit Notes as Markdown: the threads numbered as the palette numbers them,
// each with its place, its author and date, its state, its text, its voice
// note (named, not included) and its replies.

import type { Anchor, Stroke } from "../../platform/protocol.ts";
import { REDLINE_COLOURS, type Thread } from "./state.ts";
import { clock, firstLine, fullDate, plural } from "./util.ts";

export interface NotesOptions {
  readonly title: string;
  readonly threads: readonly Thread[];
  /** the name of a layer by its id */
  readonly layerName: (id: string) => string;
  readonly now: Date;
}

/** Where a thread is: on a layer (a pin or a redline), or in the 3D model. */
function placeOf(anchor: Anchor | null, strokes: readonly Stroke[], layerName: (id: string) => string): string {
  if (anchor?.kind === "3d") return `3D point ${round(anchor.x)}, ${round(anchor.y)}, ${round(anchor.z)} mm`;
  const where = anchor ? `layer ${layerName(anchor.layerId)} at ${round(anchor.x)}, ${round(anchor.y)} mm` : "no place";
  if (strokes.length === 0) return anchor ? `Pin on ${where}` : where;
  const colours = [...new Set(strokes.map((s) => REDLINE_COLOURS.find((c) => c.value === s.color)?.name ?? s.color.toLowerCase()))];
  return `Redline (${plural(strokes.length, "stroke")}, ${colours.join(", ")}) on ${where}`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** A reply as a list item; its later lines are indented to stay in it. */
function replyItem(name: string, when: string, body: string, audio: { durationMs: number } | null): string {
  const text = body.trim();
  const note = audio ? `Voice note, ${clock(audio.durationMs)}.` : "";
  const parts = [text, note].filter((p) => p !== "");
  const indented = parts.join("\n\n").split("\n").join("\n  ");
  return `- **${name}**, ${when}: ${indented}`;
}

/** The notes for `threads` as a Markdown document. */
export function critNotes(o: NotesOptions): string {
  const total = o.threads.length;
  const open = o.threads.filter((t) => !t.root.resolved).length;
  const lines: string[] = [
    `# Crit notes: ${o.title}`,
    "",
    `Exported ${fullDate(o.now.toISOString())}. ${plural(total, "thread")}: ${open} open, ${total - open} resolved.`,
    "",
  ];
  for (const t of o.threads) {
    const r = t.root;
    const heading = firstLine(r.body) || (r.audio ? "Voice note" : r.strokes.length > 0 ? "Redline" : "Comment");
    lines.push(`## ${t.number}. ${heading.replace(/\s+/g, " ")}`, "");
    lines.push(
      `${r.resolved ? "Resolved" : "Open"}. ${placeOf(r.anchor, r.strokes, o.layerName)}. ${r.authorName}, ${fullDate(r.createdAt)}.`,
      "",
    );
    const text = r.body.trim();
    if (text) lines.push(text, "");
    if (r.audio) lines.push(`Voice note, ${clock(r.audio.durationMs)} (recorded in Rodeo; not in this export).`, "");
    if (t.replies.length > 0) {
      lines.push("Replies:", "");
      for (const c of t.replies) lines.push(replyItem(c.authorName, fullDate(c.createdAt), c.body, c.audio), "");
    }
  }
  if (total === 0) lines.push("No comments.", "");
  return lines.join("\n");
}
