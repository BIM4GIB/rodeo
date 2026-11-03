// The Stage menu's Sightlines section: the audience and its seats, the seat coverage map, the masking
// solver and the seating rake solver. Show Seats and the coverage map draw over the drawing; each window
// lives in its own file, and shared.ts holds what they have in common. This file only joins them up.

import { registerOverlay } from "../../../app/ext.ts";
import { store } from "../../../app/state.ts";
import { addStageRows } from "../registry.ts";
import { drawSeats, openAudience, seatsOn, toggleSeats } from "./audienceWindow.ts";
import { coverageOn, drawCoverage, toggleCoverage } from "./coverageMap.ts";
import { openMasking } from "./maskingWindow.ts";
import { openRake } from "./rakeWindow.ts";

const open = (): boolean => store.session !== null;

addStageRows("Sightlines", () => [
  { label: "Audience…", enabled: open, run: openAudience },
  { label: "Show Seats", enabled: open, checked: seatsOn, run: toggleSeats },
  { label: "Seat Coverage Map", enabled: open, checked: coverageOn, run: toggleCoverage },
  "-",
  { label: "Masking Solver…", enabled: open, run: () => void openMasking() },
  { label: "Seating Rake Solver…", enabled: open, run: () => void openRake() },
]);

registerOverlay((p) => {
  drawSeats(p);
  drawCoverage(p);
});
