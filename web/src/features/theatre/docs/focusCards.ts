// A focus card per lighting instrument: what an electrician needs on the deck to hang, focus and patch it,
// as text, with its numbers worked from the beam (beam.ts) and the stage's frame (stage.ts). cardOf makes
// one; sortCards puts a set in position or channel order. The printed layout and the QR code are in
// focusCardHtml.ts. Pure: lengths in mm, shown by the caller's format.

import { naturalCompare, patchText, type Fixture } from "../fixture.ts";
import { stageText, toStage, type StageFrame, type StagePoint } from "../stage.ts";
import { beamOf, type Beam } from "./beam.ts";

export type CardOrder = "position" | "channel";

export interface FocusCard {
  readonly id: string;
  /** "Unit 3 @ 1st Electric", or the type's name where the instrument has no unit */
  readonly title: string;
  /** the instrument's type, "Profile 26°" */
  readonly type: string;
  readonly unit: string;
  readonly position: string;
  readonly channel: string;
  /** "1/101", or "" when it isn't patched */
  readonly patch: string;
  readonly colour: string;
  readonly gobo: string;
  readonly purpose: string;
  readonly focused: boolean;
  /** the hot spot in stage terms, "1.20 m SL · 3.00 m US"; "" when not focused */
  readonly hotSpot: string;
  /** the hanging point in stage terms */
  readonly hungAt: string;
  /** the lens height above the stage floor */
  readonly lens: string;
  /** the throw and the beam's angle at the focus, "6.08 m at 45°"; "" when not focused */
  readonly throwText: string;
  /** the field and beam pools at the focus, "2.81 m"; "" when not focused */
  readonly fieldText: string;
  readonly beamText: string;
  /** the hot spot's distance from CL and from PL, unsigned; "" when not focused */
  readonly acrossText: string;
  readonly upText: string;
  /** the text the QR code carries, which reads on a phone with no network */
  readonly qr: string;
  /** the hanging point and the focus in stage terms, for the plan drawing */
  readonly hang: StagePoint;
  readonly focus: StagePoint | null;
  readonly beam: Beam | null;
}

/** A card for `f`, its hot spot and hanging point in `frame`'s stage terms, lengths written by `format`. */
export function cardOf(f: Fixture, frame: StageFrame, format: (mm: number) => string): FocusCard {
  const beam = beamOf(f);
  const hang = toStage(frame, f.at);
  const focus = f.focus ? toStage(frame, f.focus) : null;
  const unit = f.unit.trim();
  const position = f.position.trim();
  const channel = f.channel.trim();
  const title = position ? `${unit ? `Unit ${unit}` : f.label} @ ${position}` : unit ? `Unit ${unit}` : f.label;
  const hotSpot = focus ? stageText(focus, format) : "";
  const qrSpot = focus ? `Hot spot ${hotSpot.replace(" · ", " ")}` : "Not focused yet";
  return {
    id: f.id,
    title,
    type: f.label,
    unit,
    position,
    channel,
    patch: patchText(f),
    colour: f.color.trim(),
    gobo: f.gobo.trim(),
    purpose: f.purpose.trim(),
    focused: focus !== null,
    hotSpot,
    hungAt: stageText(hang, format),
    lens: format(f.heightMm),
    throwText: beam ? `${format(beam.throwMm)} at ${Math.round(beam.elevationDeg)}°` : "",
    fieldText: beam ? format(beam.fieldMm) : "",
    beamText: beam ? format(beam.beamMm) : "",
    acrossText: focus ? format(Math.abs(focus.across)) : "",
    upText: focus ? format(Math.abs(focus.up)) : "",
    qr: `${title}${channel ? ` Ch ${channel}` : ""} ${qrSpot}`,
    hang,
    focus,
    beam,
  };
}

/** The cards in position or channel order, as people read them: a blank goes after the rest. */
export function sortCards(cards: readonly FocusCard[], by: CardOrder): FocusCard[] {
  const blankLast = (a: string, b: string): number => (a && b ? naturalCompare(a, b) : a ? -1 : b ? 1 : 0);
  const byPosition = (a: FocusCard, b: FocusCard): number => blankLast(a.position, b.position) || blankLast(a.unit, b.unit) || blankLast(a.channel, b.channel);
  const byChannel = (a: FocusCard, b: FocusCard): number => blankLast(a.channel, b.channel) || byPosition(a, b);
  return [...cards].sort(by === "channel" ? byChannel : byPosition);
}
