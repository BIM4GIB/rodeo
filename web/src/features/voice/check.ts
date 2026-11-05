// Runs the voice feature's checks in node, with no browser and no drawing: the pointing words
// (parse.check.ts), the engine choice, readiness, privacy and cost lines (engine.check.ts), and the
// WAV encoder (wav.check.ts).
//
//   cd web && npx tsx src/features/voice/check.ts

import { checkEngine } from "./engine.check.ts";
import { checkParse } from "./parse.check.ts";
import { checkWav } from "./wav.check.ts";

const failures = checkParse() + checkEngine() + checkWav();
console.log(failures === 0 ? "\nvoice: all checks passed" : `\nvoice: ${failures} check(s) failed`);
process.exit(failures > 0 ? 1 : 0);
