// Checks the embed's DOM-free contract in node: the options an address carries (read, written and
// read back), the addresses of a share link, an embed and a public file, the escaping of the five
// codes, public-file links (GitHub pages, refused addresses), the capped download, and the preview
// client's requests against a stubbed fetch. Run from web/:
//
//   npx tsx src/features/embed/check.ts
//
// Prints each failure and exits non-zero, or prints how many checks passed.

import assert from "node:assert/strict";
import { ApiError } from "../../platform/api.ts";
import { type SharePreview, embedApi, posterUrl, turntableUrl } from "./api.ts";
import { type FileLink, MAX_REMOTE_BYTES, REMOTE_MESSAGES, fetchPublicFile, normalizeFileUrl, readCapped } from "./remote.ts";
import { codeTitle, elementAttrs, elementCode, escapeHtml, escapeMarkdown, iframeCode, markdownCode } from "./snippets.ts";
import {
  DEFAULT_OPTIONS,
  type EmbedOptions,
  OPTION_KEYS,
  displayName,
  embedUrl,
  formatCam,
  formatPlanSpot,
  openUrlFor,
  optionPairs,
  optionQuery,
  parseCam,
  parseOptions,
  parsePlanSpot,
  shareUrl,
} from "./options.ts";

const ORIGIN = "https://rodeo.build";
const TOKEN = "tok";

type Check = () => void | Promise<void>;
const checks: [string, Check][] = [];

/** Registers a named check; the checks run in the order they are registered. */
function check(name: string, fn: Check): void {
  checks.push([name, fn]);
}

/** Runs `run` with fetch replaced by `stub`, which sees each request's address and options. */
async function withFetch<T>(stub: (url: string, init: RequestInit) => Response, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => stub(String(input), init ?? {})) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

/** The error a promise rejects with; a promise that resolves fails the check. */
async function errorOf(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected a failure, got a result");
}

/** A JSON response with the given status. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A response whose body arrives in chunks of the given sizes, with optional headers. */
function streamOf(sizes: number[], headers: Record<string, string> = {}): Response {
  const parts = sizes.map((n) => new Uint8Array(n).fill(7));
  let next = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (next < parts.length) controller.enqueue(parts[next++]);
      else controller.close();
    },
  });
  return new Response(body, { headers });
}

/** One request header's value, as the stub received it. */
function header(init: RequestInit, name: string): string {
  return (init.headers as Record<string, string>)[name] ?? "";
}

/** A link for a file on an example site, for the download checks. */
const EXAMPLE_LINK: FileLink = { url: "https://example.com/a.vwx", name: "a.vwx", host: "example.com" };

// ---- the options an address carries ----------------------------------------------

check("an empty address is the defaults", () => {
  assert.deepEqual(parseOptions(new URLSearchParams("")), DEFAULT_OPTIONS);
});

check("view reads 2d and 3d in any case, else nothing", () => {
  assert.equal(parseOptions(new URLSearchParams("view=3D")).view, "3d");
  assert.equal(parseOptions(new URLSearchParams("view=2d")).view, "2d");
  assert.equal(parseOptions(new URLSearchParams("view=4d")).view, null);
});

check("layer, or sheet as its alias, names the layer or sheet", () => {
  assert.equal(parseOptions(new URLSearchParams("layer=Ground Floor")).layer, "Ground Floor");
  assert.equal(parseOptions(new URLSearchParams("sheet=A-101")).layer, "A-101");
  assert.equal(parseOptions(new URLSearchParams("layer=A-1&sheet=A-2")).layer, "A-1");
});

check("a blank layer, or one over 200 characters, is ignored", () => {
  assert.equal(parseOptions(new URLSearchParams("layer=%20%20")).layer, null);
  assert.equal(parseOptions(new URLSearchParams(`layer=${"x".repeat(201)}`)).layer, null);
  assert.equal(parseOptions(new URLSearchParams(`layer=${"x".repeat(200)}`)).layer, "x".repeat(200));
});

check("at needs three numbers and a span above zero", () => {
  assert.deepEqual(parsePlanSpot("10,20,500"), { x: 10, y: 20, span: 500 });
  assert.equal(parsePlanSpot("10,20,0"), null);
  assert.equal(parsePlanSpot("10,20"), null);
  assert.equal(parsePlanSpot("10,20,500,1"), null);
  assert.equal(parsePlanSpot("10,,500"), null);
  assert.equal(parsePlanSpot("10,20,1e10"), null);
  assert.equal(parseOptions(new URLSearchParams("at=10,20,500")).at?.span, 500);
});

check("cam needs six numbers and two different points", () => {
  assert.deepEqual(parseCam("1,2,3,4,5,6"), { position: [1, 2, 3], target: [4, 5, 6] });
  assert.equal(parseCam("1,2,3,1,2,3"), null);
  assert.equal(parseCam("1,2,3,4,5"), null);
  assert.equal(parseCam("1,2,x,4,5,6"), null);
  assert.equal(parseCam("1,2,3,4,5,1e10"), null);
  assert.equal(parseCam("1,2,3,4,5,0x1F"), null);
  const cam = parseCam("1000.4,-2000.6,1500,0,0,0");
  assert.ok(cam);
  assert.equal(formatCam(cam), "1000,-2001,1500,0,0,0");
});

check("preset is matched in any case and written in its own spelling", () => {
  assert.equal(parseOptions(new URLSearchParams("preset=LEFTISO")).preset, "leftIso");
  assert.equal(parseOptions(new URLSearchParams("preset=nope")).preset, null);
});

check("render takes the six 3D modes, not the realistic ones", () => {
  assert.equal(parseOptions(new URLSearchParams("render=Sketch")).render, "sketch");
  assert.equal(parseOptions(new URLSearchParams("render=pathtraced")).render, null);
  assert.equal(parseOptions(new URLSearchParams("render=realistic")).render, null);
});

check("rotate is on for a bare key, 1 or true, and off otherwise", () => {
  for (const q of ["rotate", "rotate=1", "rotate=true"]) assert.equal(parseOptions(new URLSearchParams(q)).rotate, true, q);
  assert.equal(parseOptions(new URLSearchParams("rotate=0")).rotate, false);
  assert.equal(parseOptions(new URLSearchParams("")).rotate, false);
});

check("theme and ui take their listed values, else the default", () => {
  assert.equal(parseOptions(new URLSearchParams("theme=blue")).theme, "auto");
  assert.equal(parseOptions(new URLSearchParams("theme=DARK")).theme, "dark");
  assert.equal(parseOptions(new URLSearchParams("ui=none")).ui, "none");
  assert.equal(parseOptions(new URLSearchParams("ui=bogus")).ui, "full");
});

check("optionPairs keeps OPTION_KEYS order and skips the defaults", () => {
  assert.deepEqual(optionPairs(DEFAULT_OPTIONS), []);
  const full: EmbedOptions = {
    view: "2d",
    layer: "L1",
    at: { x: 1, y: 2, span: 3 },
    cam: { position: [1, 2, 3], target: [4, 5, 6] },
    preset: "top",
    render: "hidden",
    rotate: true,
    theme: "dark",
    ui: "none",
  };
  const positions = optionPairs(full).map(([k]) => (OPTION_KEYS as readonly string[]).indexOf(k));
  assert.deepEqual(positions, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(optionQuery({ ...DEFAULT_OPTIONS, view: "3d", rotate: true, theme: "dark" }), "view=3d&rotate=1&theme=dark");
});

check("positions are written as whole numbers, with -0 as 0", () => {
  assert.equal(formatPlanSpot({ x: 10.4, y: -20.6, span: 0.2 }), "10,-21,1");
  assert.equal(formatCam({ position: [-0.4, 0, 0], target: [1, 1, 1] }), "0,0,0,1,1,1");
});

// ---- the addresses ---------------------------------------------------------------

check("a share link's embed address, with the options after it", () => {
  assert.equal(
    embedUrl(ORIGIN, { token: TOKEN }, { ...DEFAULT_OPTIONS, view: "3d", rotate: true, theme: "dark" }),
    "https://rodeo.build/?embed=tok&view=3d&rotate=1&theme=dark",
  );
});

check("cam and ui are written as they should be", () => {
  const o: EmbedOptions = { ...DEFAULT_OPTIONS, cam: { position: [1000, -2000, 1500], target: [0, 0, 0] }, ui: "min" };
  assert.equal(embedUrl(ORIGIN, { token: TOKEN }, o), "https://rodeo.build/?embed=tok&cam=1000,-2000,1500,0,0,0&ui=min");
});

check("a layer name is percent-encoded, with its spaces as %20", () => {
  assert.equal(embedUrl(ORIGIN, { token: TOKEN }, { ...DEFAULT_OPTIONS, layer: "Ground Floor" }), "https://rodeo.build/?embed=tok&layer=Ground%20Floor");
});

check("an embed of a public file names the file in url", () => {
  assert.equal(
    embedUrl(ORIGIN, { url: "https://raw.githubusercontent.com/a/b/main/house.vwx" }, { ...DEFAULT_OPTIONS, view: "3d" }),
    "https://rodeo.build/?embed&url=https%3A%2F%2Fraw.githubusercontent.com%2Fa%2Fb%2Fmain%2Fhouse.vwx&view=3d",
  );
});

check("an address reads back to the options it was written from", () => {
  const sets: EmbedOptions[] = [
    DEFAULT_OPTIONS,
    {
      ...DEFAULT_OPTIONS,
      view: "3d",
      layer: "Ground Floor",
      cam: { position: [1000, -2000, 1500], target: [0, 0, 0] },
      preset: "leftRearIso",
      render: "hidden",
      rotate: true,
      theme: "dark",
      ui: "min",
    },
    {
      ...DEFAULT_OPTIONS,
      view: "2d",
      layer: "A-101",
      at: { x: 1200, y: -300, span: 4000 },
      render: "sketch",
      theme: "light",
      ui: "none",
    },
    { ...DEFAULT_OPTIONS, layer: "Sheet: 1 / Plan & Ç", preset: "top", view: "3d" },
  ];
  sets.forEach((o, i) => {
    assert.deepEqual(parseOptions(new URL(embedUrl(ORIGIN, { token: TOKEN }, o)).searchParams), o, `set ${i}, share link`);
  });
  assert.deepEqual(parseOptions(new URL(embedUrl(ORIGIN, { url: "https://example.com/a.vwx" }, sets[1])).searchParams), sets[1], "public file");
});

check("share and open addresses, with ref=embed on the open ones", () => {
  assert.equal(shareUrl(ORIGIN, TOKEN), "https://rodeo.build/?share=tok");
  assert.equal(shareUrl(ORIGIN, TOKEN, "embed"), "https://rodeo.build/?share=tok&ref=embed");
  assert.equal(openUrlFor(ORIGIN, { token: TOKEN }), "https://rodeo.build/?share=tok&ref=embed");
  assert.equal(openUrlFor(ORIGIN, { url: "https://example.com/a b.vwx" }), "https://rodeo.build/?url=https%3A%2F%2Fexample.com%2Fa%20b.vwx&ref=embed");
});

check("public picture addresses", () => {
  assert.equal(posterUrl(ORIGIN, TOKEN), "https://rodeo.build/api/s/tok/poster");
  assert.equal(turntableUrl(ORIGIN, TOKEN), "https://rodeo.build/api/s/tok/turntable");
});

check("titles drop the extension, and an empty name is Drawing", () => {
  assert.equal(displayName("House.vwx"), "House");
  assert.equal(displayName("My.House.vwx"), "My.House");
  assert.equal(displayName("Plan"), "Plan");
  assert.equal(displayName(".vwx"), "Drawing");
  assert.equal(codeTitle("House.vwx"), "House on Rodeo");
});

// ---- the five codes --------------------------------------------------------------

check("escapeHtml escapes the five characters that matter in HTML", () => {
  assert.equal(escapeHtml(`a & b < c > d " e ' f`), "a &amp; b &lt; c &gt; d &quot; e &#39; f");
});

check("markdown escapes the title and keeps the links", () => {
  assert.equal(markdownCode("A [b] *c*", "https://x/p", "https://x/s"), "[![A \\[b\\] \\*c\\*](https://x/p)](https://x/s)");
  assert.equal(escapeMarkdown("a_b`c`"), "a\\_b\\`c\\`");
});

check("a parenthesis in an address cannot end the Markdown link", () => {
  assert.equal(markdownCode("T", "https://x/p(1).png", "https://x/s"), "[![T](https://x/p%281%29.png)](https://x/s)");
});

check("the iframe is the fixed 16:9 frame, lazy and fullscreen", () => {
  assert.equal(
    iframeCode("https://rodeo.build/?embed=tok", "House on Rodeo"),
    `<iframe src="https://rodeo.build/?embed=tok" title="House on Rodeo" width="100%" height="450" style="border:0;width:100%;height:auto;aspect-ratio:16/9" allow="fullscreen" allowfullscreen loading="lazy"></iframe>`,
  );
});

check("the element's attributes follow the options, with rotate bare", () => {
  assert.deepEqual(elementAttrs(TOKEN, { ...DEFAULT_OPTIONS, view: "3d", rotate: true, theme: "dark" }), [
    ["share", "tok"],
    ["view", "3d"],
    ["rotate", ""],
    ["theme", "dark"],
  ]);
  assert.equal(
    elementCode("https://rodeo.build/embed.js", elementAttrs(TOKEN, { ...DEFAULT_OPTIONS, rotate: true })),
    `<script async src="https://rodeo.build/embed.js"></script><rodeo-viewer share="tok" rotate></rodeo-viewer>`,
  );
});

check("code text is escaped: a hostile name stays text and no script tag appears", () => {
  const evil = `"><script>&'`;
  const escaped = "&quot;&gt;&lt;script&gt;&amp;&#39;";
  const iframe = iframeCode("https://rodeo.build/?embed=tok", evil);
  assert.ok(!iframe.includes("<script"));
  assert.ok(iframe.includes(escaped));
  const element = elementCode("https://rodeo.build/embed.js", elementAttrs(TOKEN, { ...DEFAULT_OPTIONS, layer: evil }));
  assert.equal(element.split("<script").length - 1, 1, "only the real script tag");
  assert.ok(element.includes(escaped));
  assert.ok(!element.includes("\n"), "one line");
});

// ---- public files ----------------------------------------------------------------

check("a GitHub file page, blob or raw, becomes its raw file", () => {
  assert.deepEqual(normalizeFileUrl("https://github.com/acme/house/blob/main/plans/house.vwx?plain=1#L3", false), {
    url: "https://raw.githubusercontent.com/acme/house/main/plans/house.vwx",
    name: "house.vwx",
    host: "raw.githubusercontent.com",
  });
  assert.deepEqual(normalizeFileUrl("https://www.github.com/acme/house/raw/main/house.vwx", false), {
    url: "https://raw.githubusercontent.com/acme/house/main/house.vwx",
    name: "house.vwx",
    host: "raw.githubusercontent.com",
  });
});

check("unsafe or unnamed addresses are refused with their message", () => {
  const refused: [string, string][] = [
    ["nonsense", REMOTE_MESSAGES.notUrl],
    ["http://example.com/a.vwx", REMOTE_MESSAGES.notHttps],
    ["ftp://example.com/a.vwx", REMOTE_MESSAGES.notHttps],
    ["https://user:pw@example.com/a.vwx", REMOTE_MESSAGES.credentials],
    ["https://localhost/a.vwx", REMOTE_MESSAGES.local],
    ["https://10.0.0.1/a.vwx", REMOTE_MESSAGES.local],
    ["https://[::1]/a.vwx", REMOTE_MESSAGES.local],
    ["https://printer.local/a.vwx", REMOTE_MESSAGES.local],
    ["https://nas.lan/a.vwx", REMOTE_MESSAGES.local],
    ["https://example.com/folder/", REMOTE_MESSAGES.noName],
  ];
  for (const [raw, message] of refused) assert.deepEqual(normalizeFileUrl(raw, false), { error: message }, raw);
});

check("a local development host is allowed only with allowLocal", () => {
  assert.deepEqual(normalizeFileUrl("https://localhost/a.vwx", true), { url: "https://localhost/a.vwx", name: "a.vwx", host: "localhost" });
  assert.deepEqual(normalizeFileUrl("http://localhost:5173/a.vwx", true), {
    url: "http://localhost:5173/a.vwx",
    name: "a.vwx",
    host: "localhost",
  });
  assert.deepEqual(normalizeFileUrl("http://localhost:5173/a.vwx", false), { error: REMOTE_MESSAGES.local });
  assert.deepEqual(normalizeFileUrl("http://example.com/a.vwx", true), { error: REMOTE_MESSAGES.notHttps });
});

check("the name is the file's name, decoded", () => {
  const link = normalizeFileUrl("https://example.com/My%20House.dwg", false);
  assert.ok("name" in link);
  assert.equal(link.name, "My House.dwg");
});

check("the cap is 300 MB", () => {
  assert.equal(MAX_REMOTE_BYTES, 300 * 1024 * 1024);
});

check("a capped download joins its chunks and reports progress", async () => {
  const seen: number[] = [];
  const bytes = await readCapped(streamOf([10, 10, 10]), 100, (got) => seen.push(got));
  assert.equal(bytes.length, 30);
  assert.deepEqual(seen, [10, 20, 30]);
});

check("a download that grows past the cap is refused as it streams", async () => {
  await assert.rejects(readCapped(streamOf([10, 10, 10]), 25, () => {}), { message: REMOTE_MESSAGES.tooLarge });
});

check("a declared size over the cap is refused before any byte is read", async () => {
  let progressCalls = 0;
  await assert.rejects(readCapped(streamOf([10], { "content-length": "999" }), 100, () => progressCalls++), {
    message: REMOTE_MESSAGES.tooLarge,
  });
  assert.equal(progressCalls, 0);
});

check("an empty download is refused, with or without a body", async () => {
  await assert.rejects(readCapped(streamOf([]), 100, () => {}), { message: REMOTE_MESSAGES.empty });
  await assert.rejects(readCapped(new Response(null), 100, () => {}), { message: REMOTE_MESSAGES.empty });
});

check("a public file is fetched without cookies, through CORS, with no referrer", async () => {
  let seen: RequestInit = {};
  const bytes = await withFetch(
    (_url, init) => {
      seen = init;
      return streamOf([3]);
    },
    () => fetchPublicFile(EXAMPLE_LINK, () => {}),
  );
  assert.equal(bytes.length, 3);
  assert.equal(seen.mode, "cors");
  assert.equal(seen.credentials, "omit");
  assert.equal(seen.referrerPolicy, "no-referrer");
});

check("a file the server refuses says its HTTP status", async () => {
  const err = await withFetch(
    () => new Response("gone", { status: 404 }),
    () => errorOf(fetchPublicFile(EXAMPLE_LINK, () => {})),
  );
  assert.equal(err.message, "That file couldn't be fetched (HTTP 404).");
});

check("a fetch the browser refuses names CORS", async () => {
  const err = await withFetch(
    () => {
      throw new TypeError("Failed to fetch");
    },
    () => errorOf(fetchPublicFile(EXAMPLE_LINK, () => {})),
  );
  assert.equal(err.message, REMOTE_MESSAGES.blocked);
});

check("a cancelled fetch is rethrown as the abort it is", async () => {
  const err = await withFetch(
    () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    },
    () => errorOf(fetchPublicFile(EXAMPLE_LINK, () => {})),
  );
  assert.equal(err.name, "AbortError");
});

// ---- the preview client ----------------------------------------------------------

check("the preview is read with the session and the CSRF header", async () => {
  const body: SharePreview = { poster: null, turntable: null, stale: false };
  let seen = "";
  const got = await withFetch(
    (url, init) => {
      seen = `${init.method} ${url} ${header(init, "X-Requested-With")} ${init.credentials}`;
      return jsonResponse(body);
    },
    () => embedApi.preview(TOKEN),
  );
  assert.deepEqual(got, body);
  assert.equal(seen, "GET /api/shares/tok/preview openvwx include");
});

check("a poster upload is a PUT with its size, the CSRF header and the picture as the body", async () => {
  const picture = new Blob([new Uint8Array([0x89, 0x50])], { type: "image/png" });
  let seen = "";
  let sentPicture = false;
  await withFetch(
    (url, init) => {
      seen = `${init.method} ${url} ${header(init, "X-Requested-With")} ${header(init, "Content-Type")}`;
      sentPicture = init.body === picture;
      return new Response(null, { status: 204 });
    },
    () => embedApi.putPoster(TOKEN, picture, 1200, 630),
  );
  assert.equal(seen, "PUT /api/shares/tok/poster?width=1200&height=630 openvwx image/png");
  assert.ok(sentPicture);
});

check("a turning picture upload goes to the turntable path", async () => {
  let seen = "";
  await withFetch(
    (url, init) => {
      seen = `${init.method} ${url}`;
      return new Response(null, { status: 204 });
    },
    () => embedApi.putTurntable(TOKEN, new Blob([], { type: "image/gif" }), 640, 360),
  );
  assert.equal(seen, "PUT /api/shares/tok/turntable?width=640&height=360");
});

check("a refused upload throws the server's message, status and code", async () => {
  const err = await withFetch(
    () => jsonResponse({ error: "The preview is larger than 1 MB", code: "too_large" }, 413),
    () => errorOf(embedApi.putPoster(TOKEN, new Blob([]), 1200, 630)),
  );
  assert.ok(err instanceof ApiError);
  assert.equal(err.message, "The preview is larger than 1 MB");
  assert.equal(err.status, 413);
  assert.equal(err.code, "too_large");
});

check("an answer that is not JSON keeps its status line as the message", async () => {
  const err = await withFetch(
    () => new Response("<html>", { status: 502, statusText: "Bad Gateway" }),
    () => errorOf(embedApi.preview(TOKEN)),
  );
  assert.ok(err instanceof ApiError);
  assert.equal(err.message, "502 Bad Gateway");
  assert.equal(err.status, 502);
});

check("a server that cannot be reached is an ApiError with status 0", async () => {
  const err = await withFetch(
    () => {
      throw new TypeError("fetch failed");
    },
    () => errorOf(embedApi.preview(TOKEN)),
  );
  assert.ok(err instanceof ApiError);
  assert.equal(err.status, 0);
  assert.equal(err.code, "network");
});

// ---- runner ----------------------------------------------------------------------

/** Runs every registered check in order, then prints the failures or the count that passed. */
async function main(): Promise<void> {
  const failures: string[] = [];
  let passed = 0;
  for (const [name, fn] of checks) {
    try {
      await fn();
      passed++;
    } catch (err) {
      failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failures.length) {
    for (const f of failures) console.log(`FAIL ${f}`);
    console.log(`embed check: ${passed} passed, ${failures.length} failed`);
    process.exit(1);
  }
  console.log(`embed check: ${passed} passed`);
}

await main();
