// Builds the rodeo command into dist/: one self-contained rodeo.mjs, the three WebAssembly readers
// beside it, and THIRD-PARTY-NOTICES.txt with the licences of what was bundled. It bundles from the
// web/ folder and uses the esbuild that web/ already has, so nothing is installed here. Run it with
// npm run build in cli/, or node cli/build.mjs from anywhere.

import { existsSync, readFileSync, readdirSync, copyFileSync, chmodSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "../web");
const dist = join(here, "dist");
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

if (!existsSync(join(web, "node_modules"))) {
  console.error("Run npm ci in web/ first: the CLI is bundled from it.");
  process.exit(1);
}
const { build } = createRequire(join(web, "package.json"))("esbuild");

// The banner gives the bundle the require, __filename and __dirname that the packages it bundles
// expect from a CommonJS module (web-ifc's and rhino3dm's Node builds look for their WebAssembly
// beside themselves through them).
const BANNER = `#!/usr/bin/env node
import { createRequire as __rodeoRequire } from "node:module"; import { fileURLToPath as __rodeoPath } from "node:url"; import { dirname as __rodeoDir } from "node:path"; const require = __rodeoRequire(import.meta.url); const __filename = __rodeoPath(import.meta.url); const __dirname = __rodeoDir(__filename);`;

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

let result;
try {
  result = await build({
    absWorkingDir: here,
    entryPoints: [join(web, "scripts/rodeo.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: join(dist, "rodeo.mjs"),
    minify: true,
    legalComments: "none",
    // rhino3dm's unused socket code; the command never opens one
    external: ["ws"],
    metafile: true,
    define: { "process.env.RODEO_VERSION": JSON.stringify(pkg.version) },
    banner: { js: BANNER },
    logLevel: "warning",
  });
} catch (err) {
  console.error(`The bundle didn't build: ${err.message}`);
  process.exit(1);
}
chmodSync(join(dist, "rodeo.mjs"), 0o755);

// the WebAssembly the readers load, beside the bundle: node.ts and the packages find them there
const wasm = [
  [join(web, "node_modules/web-ifc/web-ifc-node.wasm"), "web-ifc-node.wasm"],
  [join(web, "node_modules/rhino3dm/rhino3dm.wasm"), "rhino3dm.wasm"],
  [join(web, "vendor/rvt-rs/rvt_bg.wasm"), "rvt_bg.wasm"],
];
for (const [from, name] of wasm) {
  if (!existsSync(from)) {
    console.error(`Missing ${from}: the bundle needs it.`);
    process.exit(1);
  }
  copyFileSync(from, join(dist, name));
}

copyFileSync(resolve(here, "../LICENSE"), join(here, "LICENSE"));

/** The text of a package's licence file, or a pointer to its homepage when it ships none. */
function licenceText(dir, meta) {
  const files = readdirSync(dir).filter((f) => /^(licen[cs]e|copying)/i.test(f)).sort();
  if (files.length > 0) return files.map((f) => readFileSync(join(dir, f), "utf8").trimEnd()).join("\n\n");
  const repository = typeof meta.repository === "string" ? meta.repository : meta.repository?.url;
  return `See ${meta.homepage ?? repository ?? "the package's page"}`;
}

/** A package's licence name, as its package.json states it. */
function licenceName(meta) {
  if (typeof meta.license === "string") return meta.license;
  return meta.license?.type ?? "unknown licence";
}

// every package the bundle took from node_modules, by the folder it was read from
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const marker = "node_modules/";
  const at = input.lastIndexOf(marker);
  if (at < 0) continue;
  const parts = input.slice(at + marker.length).split("/");
  const name = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
  const dir = resolve(here, input.slice(0, at + marker.length) + name);
  if (!packages.has(dir)) packages.set(dir, name);
}

const sections = [];
for (const [dir, name] of [...packages].sort((a, b) => a[1].localeCompare(b[1]))) {
  const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  sections.push(`== ${name} ${meta.version} (${licenceName(meta)}) ==\n${licenceText(dir, meta)}`);
}
sections.push(`== rvt-rs (Apache-2.0) ==\n${readFileSync(join(web, "public/licences/rvt-rs.txt"), "utf8").trimEnd()}`);
writeFileSync(
  join(here, "THIRD-PARTY-NOTICES.txt"),
  `Rodeo's command line bundles these packages. Their licences follow.\n\n${sections.join("\n\n")}\n`,
);

let total = 0;
for (const file of readdirSync(dist).sort()) {
  const size = statSync(join(dist, file)).size;
  total += size;
  console.log(`${file.padEnd(22)} ${(size / 1e6).toFixed(2)} MB`);
}
console.log(`${"total".padEnd(22)} ${(total / 1e6).toFixed(2)} MB`);
if (total > 25e6) console.warn("Warning: the bundle is over 25 MB.");
