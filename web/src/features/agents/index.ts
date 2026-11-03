// Agents: a chat as a tab of Navigation, with an AI agent that does anything in the open
// drawing (reads, sees, edits, renders, exports, imports, runs scripts and writes plug-ins), on
// the models the Rodeo server offers (POST /api/ai/chat, its key; signed in, and paid for with AI
// credit where the server sells it). A planner model works with a team of subagents on a cheaper
// one. Registered with app/ext.ts when imported; the engine loads with the first message.

import { appContext, registerMenu, registerPalette } from "../../app/ext.ts";
import type { Row } from "../../app/menu.ts";
import { agentsPanel } from "./panel.ts";
import "./agents.css";

export const AGENTS_PALETTE = "agents";

/** a spark in a speech bubble: the agent */
const ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M5 5.5h14a1.5 1.5 0 011.5 1.5v8.5a1.5 1.5 0 01-1.5 1.5h-7l-4.5 3.5V17H5a1.5 1.5 0 01-1.5-1.5V7A1.5 1.5 0 015 5.5z"/>' +
  '<path d="M12 8.2l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/></svg>';

registerPalette({ id: AGENTS_PALETTE, title: "Agents", side: "left", icon: ICON, tabOf: "navigation", fill: true, body: agentsPanel() });

registerMenu("Window", (): Row[] => [{ label: "Agents", run: () => appContext()?.palettes.show(AGENTS_PALETTE) }]);
