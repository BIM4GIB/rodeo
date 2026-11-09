// Tests for the converter's pages (src/convertPage.ts and src/convert.ts): node scripts/convert-test.ts
// The unit part renders the page template (web/convert.html) and checks the HTML, JSON-LD and sitemap.
// With --server, a real server on a loopback port checks the routes; its web/dist holds a copy of the page.

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertPage, PAGE_FORMATS, PAIRS, pageFormat, pairSlug } from "../../web/src/convert/pages.ts";
import { escapeHtml, renderConvertPage, sitemapXml } from "../src/convertPage.ts";

const PAGE_PATH = join(import.meta.dirname, "../../web/convert.html");
const template = readFileSync(PAGE_PATH, "utf8");
const BASE_URL = "http://x.test";

let failures = 0;

/** Runs one check, printing ok or FAIL with the reason. */
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${name}`);
    console.log(`     ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The text between a page's `<!-- name -->` and `<!-- /name -->` markers. */
function blockOf(html: string, name: string): string {
  const open = `<!-- ${name} -->`;
  const start = html.indexOf(open);
  const end = html.indexOf(`<!-- /${name} -->`, start);
  assert.ok(start >= 0 && end > start, `the ${name} markers`);
  return html.slice(start + open.length, end);
}

async function unitPart(): Promise<void> {
  const index = convertPage(null);
  const rvt = convertPage("rvt-to-ifc");
  assert.ok(index && rvt, "the index and rvt-to-ifc pages exist");

  await check("index page has its title and canonical address", () => {
    const html = renderConvertPage(template, index, BASE_URL);
    assert.ok(html.includes("<title>Convert CAD files online, free and private | Rodeo</title>"));
    assert.ok(html.includes('<link rel="canonical" href="http://x.test/convert" />'));
    assert.equal(html.split("<title>").length - 1, 1, "one title");
  });

  await check("rvt-to-ifc page has its headline and links to other pairs, not to itself", () => {
    const html = renderConvertPage(template, rvt, BASE_URL);
    assert.ok(html.includes("<h1>Convert RVT to IFC</h1>"));
    const links = blockOf(html, "convert:links");
    assert.ok(links.includes('href="/convert/rvt-to-pdf"'), "a link to rvt-to-pdf");
    assert.ok(!links.includes('href="/convert/rvt-to-ifc"'), "no link to itself");
    assert.equal(links.split("<li>").length - 1, 12, "twelve links");
  });

  await check("the formats table has a row per format", () => {
    const html = renderConvertPage(template, rvt, BASE_URL);
    const rows = blockOf(html, "convert:formats").split('<tr><th scope="row">').length - 1;
    assert.equal(rows, PAGE_FORMATS.length);
  });

  await check("the index links to every pair", () => {
    const html = renderConvertPage(template, index, BASE_URL);
    assert.equal(blockOf(html, "convert:links").split("<li>").length - 1, PAIRS.length);
  });

  await check("text is escaped and cannot break out of the head's script", () => {
    const html = renderConvertPage(template, { ...rvt, h1: "A <b>&", description: "x</script><b>" }, BASE_URL);
    assert.ok(html.includes("<h1>A &lt;b&gt;&amp;</h1>"));
    assert.ok(!html.includes("</script><b>"), "no script break-out");
    assert.equal(escapeHtml(`"'`), "&quot;&#39;");
  });

  await check("a fake template gets the escaped text, and a missing marker pair leaves the template alone", () => {
    const fake = "<p><!-- convert:intro --><!-- /convert:intro --></p>";
    const out = renderConvertPage(fake, { ...rvt, h1: "<i>" }, BASE_URL);
    assert.ok(out.includes("<h1>&lt;i&gt;</h1>"));
    assert.ok(out.startsWith("<p><!-- convert:intro -->") && out.endsWith("<!-- /convert:intro --></p>"), "markers kept");
    assert.equal(renderConvertPage("<b>no markers</b>", rvt, BASE_URL), "<b>no markers</b>");
  });

  await check("the JSON-LD parses and names the page", () => {
    const html = renderConvertPage(template, rvt, BASE_URL);
    const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    assert.ok(m, "a JSON-LD block");
    const data = JSON.parse(m[1]) as { url: string; offers: { price: string } };
    assert.equal(data.url, "http://x.test/convert/rvt-to-ifc");
    assert.equal(data.offers.price, "0");
  });

  await check("slugs: upper case, unknown and index are handled", () => {
    assert.equal(convertPage("RVT-to-IFC"), null);
    assert.equal(convertPage("nope"), null);
    assert.equal(convertPage("nope-to-x"), null);
    assert.equal(convertPage(null)?.path, "/convert");
  });

  await check("the sitemap lists the index and every pair", () => {
    const xml = sitemapXml(BASE_URL);
    assert.ok(xml.includes("<loc>http://x.test/convert/rvt-to-ifc</loc>"));
    assert.ok(xml.includes("<loc>http://x.test/convert</loc>"));
    assert.equal(xml.split("<loc>").length - 1, PAIRS.length + 1);
  });

  await check("every pair is readable into a writable format, and its links have pages", () => {
    for (const [from, to] of PAIRS) {
      assert.ok(pageFormat(from)?.read, `${from} is read`);
      assert.ok(pageFormat(to)?.write, `${to} is written`);
      const page = convertPage(pairSlug(from, to));
      assert.ok(page, `${from}-to-${to} has a page`);
      for (const [a, b] of page.links) assert.ok(convertPage(pairSlug(a, b)), `${a}-to-${b} has a page`);
    }
  });
}

/** One response from the server: its status, redirect target, type, frame policy and body. */
interface Reply {
  status: number;
  location: string | null;
  type: string;
  csp: string;
  body: string;
}

async function serverPart(): Promise<void> {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const base = `http://localhost:${port}`;
  const root = mkdtempSync(join(tmpdir(), "rodeo-convert-"));
  const webDist = join(root, "dist");
  mkdirSync(webDist);
  copyFileSync(PAGE_PATH, join(webDist, "convert.html"));
  let log = "";

  const server: ChildProcess = spawn(process.execPath, ["src/index.ts"], {
    cwd: join(import.meta.dirname, ".."),
    env: { ...process.env, NODE_ENV: "development", PORT: String(port), DATA_DIR: root, PUBLIC_URL: base, WEB_DIST: webDist },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (d: Buffer) => (log += d.toString()));
  server.stderr?.on("data", (d: Buffer) => (log += d.toString()));

  /** A GET that does not follow redirects, so the test sees each one. */
  async function ask(path: string): Promise<Reply> {
    const res = await fetch(`${base}${path}`, { redirect: "manual" });
    return {
      status: res.status,
      location: res.headers.get("location"),
      type: res.headers.get("content-type") ?? "",
      csp: res.headers.get("content-security-policy") ?? "",
      body: await res.text(),
    };
  }

  try {
    // any answer at all means the server is listening
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try {
        await fetch(`${base}/`);
        up = true;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!up) throw new Error(`the server did not start\n${log}`);

    await check("GET /convert serves the index page, framed only by this site", async () => {
      const r = await ask("/convert");
      assert.equal(r.status, 200);
      assert.ok(r.body.includes("<title>Convert CAD files online, free and private | Rodeo</title>"));
      assert.match(r.csp, /frame-ancestors 'self'/);
    });

    await check("GET /convert/rvt-to-ifc serves that pair's page with its own canonical address", async () => {
      const r = await ask("/convert/rvt-to-ifc");
      assert.equal(r.status, 200);
      assert.ok(r.body.includes("<h1>Convert RVT to IFC</h1>"));
      assert.ok(r.body.includes(`<link rel="canonical" href="${base}/convert/rvt-to-ifc" />`));
    });

    await check("GET /convert/RVT-to-IFC redirects to the lower-case address", async () => {
      const r = await ask("/convert/RVT-to-IFC");
      assert.equal(r.status, 301);
      assert.equal(r.location, "/convert/rvt-to-ifc");
    });

    await check("GET /convert/nope-to-x redirects to the index", async () => {
      const r = await ask("/convert/nope-to-x");
      assert.equal(r.status, 301);
      assert.equal(r.location, "/convert");
    });

    await check("GET /convert/rvt-to-ifc/ redirects without the slash", async () => {
      const r = await ask("/convert/rvt-to-ifc/");
      assert.equal(r.status, 301);
      assert.equal(r.location, "/convert/rvt-to-ifc");
    });

    await check("GET /convert/ and GET /convert.html redirect to /convert", async () => {
      for (const path of ["/convert/", "/convert.html"]) {
        const r = await ask(path);
        assert.equal(r.status, 301, path);
        assert.equal(r.location, "/convert", path);
      }
    });

    await check("GET /sitemap-convert.xml serves the sitemap", async () => {
      const r = await ask("/sitemap-convert.xml");
      assert.equal(r.status, 200);
      assert.match(r.type, /^application\/xml/);
      assert.ok(r.body.includes(`<loc>${base}/convert/rvt-to-ifc</loc>`));
    });
  } finally {
    server.kill();
    rmSync(root, { recursive: true, force: true });
  }
}

await unitPart();
if (process.argv.includes("--server")) await serverPart();
console.log(failures === 0 ? "convert tests passed" : `${failures} convert test(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
