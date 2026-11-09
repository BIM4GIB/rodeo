// Checks the cadmpeg WebAssembly bridge in Node: the Parasolid mesher (vendor/cadmpeg-xt) on bare
// transmit streams, and one STEP converter per format (vendor/cadmpeg/<format>) on that format's
// corpus files.
//
//   node web/scripts/cadmpeg-wasm.test.mjs
//
// Run cadmpeg-wasm.sh first. CADMPEG_XT_FIXTURES names the directory of bare .ps streams and
// CADMPEG_CORPUS cadmpeg's corpus directory; each defaults to this machine's copy, and a missing
// directory skips its half of the checks.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const vendor = join(here, '..', 'vendor');
const fixtures = process.env.CADMPEG_XT_FIXTURES ?? '/Users/cal/Desktop/openvwx-scratch/cadmpeg/xt-fixtures';
const corpus = process.env.CADMPEG_CORPUS ?? '/Users/cal/Desktop/openvwx-scratch/cadmpeg/src/corpus';

const XT_CHORD_REL = 0.002;
const XT_ANGLE_DEG = 15;
const XT_MAX_TRIANGLES = 10_000_000;

// Streams whose tessellation is known, by file name prefix, from the build that wrote these tests.
const KNOWN_XT = [['nist_ctc_03_asme1_nx1980_rc-000b1e44', { faces: 139, triangles: 5010 }]];

// The corpus files each format's module converts, relative to the corpus directory. Each format
// has its own module; a module refuses every other format.
const NATIVE = {
  sldprt: [
    'nist-pmi/sldprt/nist_ftc_06_asme1_rd_sw1802.SLDPRT',
    'nist-pmi/sldprt/nist_ftc_08_asme1_rc_sw1802.SLDPRT',
  ],
  inventor: ['nist-pmi/inventor/INV_nist_ctc_01_asme1_2021.ipt'],
  fcstd: [
    'freecad_fcstd/fixtures/geometry_topology.FCStd',
    'freecad_fcstd/fixtures/core_operations.FCStd',
    'freecad_fcstd/fixtures/binary_exact_shape.FCStd',
    'freecad_fcstd/fixtures/sketch_conics.FCStd',
  ],
  f3d: ['1WireRGBWController.f3d'],
  nx: [
    'nist-pmi/nx/nist_ctc_03_asme1_nx1980_rc.prt',
    'nist-pmi/nx/NIST mtc crada assembly.prt',
  ],
  creo: ['nist-pmi/creo/nist_ctc_01_asme1_rd_cr10030.prt.5'],
};

let failures = 0;
function check(condition, message) {
  if (!condition) {
    failures += 1;
    console.log(`  FAIL: ${message}`);
  }
}

async function load(name, stem) {
  const module = await import(pathToFileURL(join(vendor, name, `${stem}.js`)).href);
  module.initSync({ module: readFileSync(join(vendor, name, `${stem}_bg.wasm`)) });
  return module;
}

function pad(text, width) {
  const value = String(text);
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function table(headers, rows) {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => String(row[column]).length)));
  const line = (cells) => cells.map((cell, column) => pad(cell, widths[column])).join('  ');
  console.log(line(headers));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) console.log(line(row));
}

async function testXt() {
  console.log('\nxt: Parasolid B-rep of bare streams, tessellated (cadmpeg-xt)');
  if (!existsSync(fixtures)) {
    console.log(`  skipped: no fixtures at ${fixtures}`);
    return;
  }
  const xt = await load('cadmpeg-xt', 'cadmpeg_xt');
  const streams = readdirSync(fixtures).filter((name) => name.endsWith('.ps')).sort();
  check(streams.length > 0, 'the fixtures directory holds .ps streams');
  const rows = [];
  let meshed = 0;
  for (const name of streams) {
    const bytes = readFileSync(join(fixtures, name));
    const started = performance.now();
    let mesh;
    try {
      mesh = xt.xt_mesh(bytes, XT_CHORD_REL, XT_ANGLE_DEG, XT_MAX_TRIANGLES);
    } catch (error) {
      const ms = (performance.now() - started).toFixed(1);
      const report = JSON.parse(xt.xt_last_report());
      check(typeof report.error === 'string', `${name}: a refusal is reported`);
      console.log(`  ${name}: refused (${report.error})`);
      rows.push([name, bytes.length, 'refused', report.faces, '-', '-', '-', ms, report.error]);
      continue;
    }
    const ms = (performance.now() - started).toFixed(1);
    const report = JSON.parse(xt.xt_last_report());
    const triangles = mesh.length / 9;
    meshed += 1;
    check(Number.isInteger(triangles) && triangles > 0, `${name}: triangles in whole multiples of 9`);
    check(mesh.every(Number.isFinite), `${name}: every coordinate is finite`);
    check(report.triangles === triangles, `${name}: report counts the triangles returned`);
    check(report.refused === report.faces - report.tessellated, `${name}: refused faces are counted`);
    const known = KNOWN_XT.find(([prefix]) => name.startsWith(prefix));
    if (known) {
      check(report.faces === known[1].faces, `${name}: ${known[1].faces} faces`);
      check(triangles === known[1].triangles, `${name}: ${known[1].triangles} triangles`);
    }
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    for (let index = 0; index < mesh.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        low[axis] = Math.min(low[axis], mesh[index + axis]);
        high[axis] = Math.max(high[axis], mesh[index + axis]);
      }
    }
    const extent = high.map((value, axis) => (value - low[axis]).toFixed(3)).join(' x ');
    rows.push([name, bytes.length, 'meshed', report.faces, report.tessellated, report.refused, triangles, ms, extent]);
    console.log(`  ${name}: report ${JSON.stringify(report)}`);
  }
  check(meshed > 0, 'at least one stream meshes');
  table(['stream', 'bytes', 'status', 'faces', 'tessellated', 'refused', 'triangles', 'ms', 'extent mm or error'], rows);

  // A byte string with no Parasolid header and a chord that is not a length are both refused, and
  // the report of the failed call says so.
  let threw = false;
  try {
    xt.xt_mesh(new Uint8Array([1, 2, 3, 4]), XT_CHORD_REL, XT_ANGLE_DEG, XT_MAX_TRIANGLES);
  } catch {
    threw = true;
  }
  check(threw, 'a non-Parasolid byte string is refused');
  check(JSON.parse(xt.xt_last_report()).error !== undefined, 'the refusal is in the report');
  threw = false;
  const firstMeshed = streams.find((name) => name.startsWith(KNOWN_XT[0][0]));
  const firstBytes = readFileSync(join(fixtures, firstMeshed));
  try {
    xt.xt_mesh(firstBytes, 0, XT_ANGLE_DEG, XT_MAX_TRIANGLES);
  } catch {
    threw = true;
  }
  check(threw, 'a zero chord is refused');

  // A cap below the stream's triangle count stops the call with the planner's error, and the
  // report counts the triangles reached before it stopped. A zero cap is refused.
  const CAP = 1000;
  threw = false;
  try {
    xt.xt_mesh(firstBytes, XT_CHORD_REL, XT_ANGLE_DEG, CAP);
  } catch {
    threw = true;
  }
  const capped = JSON.parse(xt.xt_last_report());
  check(threw, `a cap of ${CAP} triangles stops a ${KNOWN_XT[0][1].triangles}-triangle stream`);
  check(capped.error === `more than ${CAP} triangles`, `the cap error is "more than ${CAP} triangles"`);
  check(capped.triangles > CAP, 'the report counts the triangles reached when the cap stopped the call');
  console.log(`  capped at ${CAP}: ${JSON.stringify(capped)}`);
  threw = false;
  try {
    xt.xt_mesh(firstBytes, XT_CHORD_REL, XT_ANGLE_DEG, 0);
  } catch {
    threw = true;
  }
  check(threw, 'a zero triangle cap is refused');
}

async function testNative(format) {
  console.log(`\n${format}: corpus files to STEP in memory (cadmpeg/${format})`);
  if (!existsSync(corpus)) {
    console.log(`  skipped: no corpus at ${corpus}`);
    return;
  }
  const native = await load(`cadmpeg/${format}`, 'cadmpeg');
  const rows = [];
  for (const relative of NATIVE[format]) {
    const path = join(corpus, relative);
    if (!existsSync(path)) {
      check(false, `${relative} is in the corpus`);
      continue;
    }
    const name = relative.split('/').pop();
    const bytes = readFileSync(path);
    const started = performance.now();
    let converted;
    try {
      converted = native.to_step(bytes, name);
    } catch (error) {
      check(false, `${name}: to_step failed: ${error}`);
      rows.push([name, '-', '-', '-', '-', '-', '-']);
      continue;
    }
    const ms = (performance.now() - started).toFixed(1);
    const step = converted.step;
    const header = Buffer.from(step.subarray(0, 13)).toString('latin1');
    check(header === 'ISO-10303-21;', `${name}: the STEP output starts with ISO-10303-21;`);
    const warnings = JSON.parse(converted.warnings);
    check(Array.isArray(warnings), `${name}: warnings is a JSON array`);
    check(converted.format === format, `${name}: the module reads ${format}, found ${converted.format}`);
    rows.push([name, converted.format, `L${converted.level}`, step.length, ms, warnings.length, header]);
    converted.free();
  }
  table(['file', 'format', 'level', 'STEP bytes', 'ms', 'warnings', 'header'], rows);

  // Unrecognized bytes are refused, and so is a file of another format: the module has only its own
  // codec registered.
  const names = Object.keys(NATIVE);
  const foreign = NATIVE[names[(names.indexOf(format) + 1) % names.length]][0];
  const foreignPath = join(corpus, foreign);
  const tries = [
    ['an unrecognized byte string', new Uint8Array([0x50, 0x4b, 0x00, 0x00, 0x01]), 'junk.bin'],
  ];
  if (existsSync(foreignPath)) {
    tries.push([`a ${names[(names.indexOf(format) + 1) % names.length]} file`, readFileSync(foreignPath), foreign.split('/').pop()]);
  }
  for (const [label, bytes, fileName] of tries) {
    let threw = false;
    try {
      native.to_step(bytes, fileName);
    } catch {
      threw = true;
    }
    check(threw, `${format}: ${label} is refused`);
  }
}

await testXt();
for (const format of Object.keys(NATIVE)) await testNative(format);
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
