// Checks AI renders' model call (image.ts) against a stand-in provider on localhost: what is sent
// (the picture as a data URL, both modalities, the aspect, the usage), what comes back (the picture,
// its cost), a model that answers in words alone, and a refusal.
//   cd server && DATA_DIR=$(mktemp -d) node src/image.check.ts

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { ImageConfig } from "./config.ts";
import { askPainter, imageType, paintPrompt, pictureOf } from "./image.ts";

let failed = 0;
function check(what: string, ok: boolean): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
let sent: Record<string, unknown> = {};
let reply: { status: number; body: unknown } = { status: 200, body: {} };
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (d: Buffer) => (raw += d.toString()));
  req.on("end", () => {
    sent = JSON.parse(raw) as Record<string, unknown>;
    res.writeHead(reply.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply.body));
  });
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const port = (server.address() as AddressInfo).port;
const m: ImageConfig = { baseUrl: `http://127.0.0.1:${port}`, apiKey: "test", model: "still/model", liveModel: "live/model", usdPerPicture: 0.04, perHour: 10, perDay: 10 };

check("a PNG is a PNG", imageType(PNG) === "image/png");
check("a JPEG is a JPEG", imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0])) === "image/jpeg");
check("text is neither", imageType(new TextEncoder().encode("<svg></svg>")) === null);
check("the prompt keeps the building and names the style", paintPrompt("dusk", "subtle").includes("Do not add, remove, move or reshape") && paintPrompt("dusk", "subtle").endsWith("Style: dusk"));
check("no style asks for daylight", paintPrompt("", "balanced").endsWith("a photographic daylight render"));
check("pictureOf reads a data URL", pictureOf({ images: [{ image_url: { url: "data:image/png;base64,AAAA" } }] })?.image === "AAAA");
check("pictureOf skips anything else", pictureOf({ images: [{ image_url: { url: "https://example.com/a.png" } }] }) === null);

reply = {
  status: 200,
  body: { id: "gen-1", choices: [{ message: { content: "Here it is.", images: [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG.toString("base64")}` } }] } }], usage: { cost: 0.039, prompt_tokens: 1400, completion_tokens: 1290 } },
};
const painted = await askPainter(m, m.model, PNG.toString("base64"), "image/png", paintPrompt("dusk", "balanced"), "16:9", AbortSignal.timeout(5000));
const content = ((sent.messages as { content: { type: string; image_url?: { url: string } }[] }[])[0]).content;
check("sends the still model", sent.model === "still/model");
check("asks for a picture and words", JSON.stringify(sent.modalities) === '["image","text"]');
check("sends the aspect", (sent.image_config as { aspect_ratio?: string }).aspect_ratio === "16:9");
check("asks for the cost", (sent.usage as { include?: boolean }).include === true);
check("sends the picture as a data URL", content.some((p) => p.type === "image_url" && p.image_url?.url.startsWith("data:image/png;base64,iVBOR") === true));
check("reads the picture back", painted.image === PNG.toString("base64") && painted.mime === "image/png");
check("reads its cost and tokens", painted.usd === 0.039 && painted.tokensIn === 1400 && painted.tokensOut === 1290 && painted.id === "gen-1");

reply = { status: 200, body: { choices: [{ message: { content: "I can't draw that." } }] } };
const words = await askPainter(m, m.liveModel, PNG.toString("base64"), "image/png", "x", "1:1", AbortSignal.timeout(5000));
check("words alone: no picture, the words kept", words.image === "" && words.text === "I can't draw that.");

reply = { status: 402, body: { error: { message: "Insufficient credits" } } };
let refused = "";
try {
  await askPainter(m, m.model, PNG.toString("base64"), "image/png", "x", "1:1", AbortSignal.timeout(5000));
} catch (e) {
  refused = `${(e as { status?: number }).status} ${(e as Error).message}`;
}
check("a refusal throws with its status and reason", refused === "402 Insufficient credits");

server.close();
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
process.exit(0);
