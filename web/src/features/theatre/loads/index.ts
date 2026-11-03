// Stage > Loads and Power: the Load Check of each hanging position (its instruments, pipe, hoists and their reactions,
// against capacities) and the Power Balance of the supply over one or three phases. Each window is in its own file.

import { store } from "../../../app/state.ts";
import { addStageRows } from "../registry.ts";
import { openLoadCheck } from "./loadCheck.ts";
import { openPowerBalance } from "./powerPanel.ts";

const open = (): boolean => store.session !== null;

addStageRows("Lighting Loads", () => [
  { label: "Load Check…", enabled: open, run: () => openLoadCheck() },
  { label: "Power Balance…", enabled: open, run: () => openPowerBalance() },
]);
