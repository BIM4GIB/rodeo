// Voice commands: hold Space (or the mic button), say what to do, and click to point while
// speaking. Every command goes to the agent with the words, the selection and the pins. The
// browser's speech recognition turns speech into text, or Rodeo's server where the browser has
// none (record.ts). Registers the Tools menu row, the top bar's mic and the touch mic with
// app/ext.ts when imported.

import { onReady, registerMenu, registerTopBar } from "../../app/ext.ts";
import { COARSE } from "../touch/layout.ts";
import { openVoiceSettings } from "./settings.ts";
import { MicButton } from "./ui.ts";
import { installVoice } from "./voice.ts";
import "./voice.css";

registerMenu("Tools", () => [{ label: "Voice Commands…", run: () => void openVoiceSettings() }]);

// hidden until the editor starts and installVoice shows it as voice is set
const topMic = new MicButton("tb-icon voice-mic");
topMic.set("hidden");
registerTopBar(() => topMic.el, "right");

onReady((ctx) => {
  const mics = [topMic];
  // a touch screen has no key to hold, so a large round mic floats over the drawing's lower right
  if (COARSE) {
    const fab = new MicButton("voice-fab");
    fab.set("hidden");
    document.getElementById("stage")?.append(fab.el);
    mics.push(fab);
  }
  installVoice(ctx, mics);
});
