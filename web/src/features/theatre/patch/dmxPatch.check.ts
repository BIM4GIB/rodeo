// npx tsx src/features/theatre/patch/dmxPatch.check.ts
import { freeStart, nextChannel, nextConflict, patchIssues, patchOrder, patchRun, universeCells, unpatched, type PatchRow } from "./dmxPatch.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const row = (id: string, channel: string, universe: number, address: number, footprint = 1): PatchRow => ({ id, channel, universe, address, footprint });
const issuesOf = (rows: PatchRow[], id: string): string => [...(patchIssues(rows).get(id) ?? [])].sort().join();

// the problems between two devices sharing addresses, and running past 512
{
  const rows = [row("a", "1", 1, 1, 4), row("b", "2", 1, 3, 2), row("c", "5", 1, 10), row("d", "5", 1, 10), row("e", "6", 1, 20), row("f", "7", 1, 20), row("g", "8", 1, 510, 6), row("h", "9", 2, 1)];
  ok(issuesOf(rows, "a") === "overlap" && issuesOf(rows, "b") === "overlap", "a different start sharing addresses overlaps");
  ok(issuesOf(rows, "c") === "identical" && issuesOf(rows, "d") === "identical", "the same start and channel is an identical patch");
  ok(issuesOf(rows, "e") === "multi" && issuesOf(rows, "f") === "multi", "the same start, another channel, is a patch conflict");
  ok(issuesOf(rows, "g") === "outside", "running past 512 is out of universe");
  ok(!patchIssues(rows).has("h"), "another universe's address 1 is no problem");
  ok(!patchIssues([row("x", "1", 0, 1), row("y", "1", 1, 0), row("z", "1", 1, 1)]).size, "an unpatched device has no problems");
}

// the diagram's cells: free, one device, a problem, several problems, out of universe
{
  const rows = [row("a", "1", 1, 1, 4), row("b", "2", 1, 3, 2), row("c", "2", 1, 3, 2), row("g", "8", 1, 511, 4)];
  const u = universeCells(rows, 1);
  ok(u.state[1] === "ok" && u.state[2] === "ok", `one device: ${u.state.slice(1, 3)}`);
  ok(u.state[3] === "several" && u.ids[3].length === 3, `a, b and c on 3: an overlap and an identical patch: ${u.state[3]}`);
  ok(u.state[5] === "free" && u.state[0] === "free", "nothing on 5");
  ok(u.state.length === 515 && u.state[512] === "ok" && u.state[513] === "outside" && u.state[514] === "outside", `past 512: ${u.state.length} ${u.state.slice(511)}`);
  ok(universeCells(rows, 2).state.every((s) => s === "free"), "an empty universe is free");
}

// Find Next Conflict goes by universe and address, round to the start
{
  const rows = [row("u2", "1", 2, 1), row("u2b", "2", 2, 1), row("ok", "3", 1, 50), row("x", "4", 1, 1, 3), row("y", "5", 1, 2), row("none", "", 0, 0)];
  const issues = patchIssues(rows);
  ok(patchOrder(rows).map((r) => r.id).join() === "x,y,ok,u2,u2b,none", `patch order: ${patchOrder(rows).map((r) => r.id)}`);
  ok(nextConflict(rows, issues, null) === "x", "the first");
  ok(nextConflict(rows, issues, "x") === "y" && nextConflict(rows, issues, "y") === "u2", "skips the device without one");
  ok(nextConflict(rows, issues, "ok") === "u2", "from a device without one");
  ok(nextConflict(rows, issues, "u2b") === "x", "round to the start");
  ok(nextConflict([row("a", "1", 1, 1)], patchIssues([row("a", "1", 1, 1)]), null) === null, "none");
}

// Patch: channels by the increment, addresses by the footprint, the next universe when one won't fit
{
  const all = [row("a", "", 0, 0, 10), row("b", "", 0, 0, 500), row("c", "", 0, 0, 20), row("d", "9", 1, 100), row("w", "", 0, 0, 600)];
  const r = patchRun(all, ["a", "b", "c", "w"], { fields: "all", channel: 101, increment: 2, universe: 1, address: 1 });
  ok(r.rows.map((x) => `${x.id}:${x.channel}:${x.universe}/${x.address}`).join() === "a:101:1/1,b:103:1/11,c:105:2/1", `the run: ${r.rows.map((x) => `${x.id}:${x.channel}:${x.universe}/${x.address}`)}`);
  ok(r.left.join() === "w", "wider than a universe left");
  ok(r.hits.join() === "d", `lands on d at 100: ${r.hits}`);
  const ch = patchRun(all, ["d", "a"], { fields: "channel", channel: 1, increment: 1, universe: 7, address: 7 });
  ok(ch.rows.map((x) => `${x.channel}:${x.universe}/${x.address}`).join() === "1:1/100,2:0/0" && ch.hits.length === 0, `channels only: ${ch.rows.map((x) => `${x.channel}:${x.universe}/${x.address}`)}`);
  const ad = patchRun(all, ["a"], { fields: "address", channel: 50, increment: 1, universe: 1, address: 505 });
  ok(ad.rows[0].channel === "" && ad.rows[0].universe === 2 && ad.rows[0].address === 1, `addresses only, past 512 into universe 2: ${JSON.stringify(ad.rows[0])}`);
  const moved = patchRun([row("p", "1", 1, 1, 4), row("q", "2", 1, 5, 4)], ["p", "q"], { fields: "address", channel: 1, increment: 1, universe: 1, address: 3 });
  ok(moved.hits.length === 0, "the devices being patched don't count as hit");
}

// Unpatch, free addresses and the next channel
{
  const r = row("a", "12", 3, 40, 2);
  ok(JSON.stringify(unpatched(r, "channel")) === JSON.stringify({ ...r, channel: "" }), "channel only");
  ok(JSON.stringify(unpatched(r, "address")) === JSON.stringify({ ...r, universe: 0, address: 0 }), "address only");
  ok(JSON.stringify(unpatched(r, "all")) === JSON.stringify({ ...r, channel: "", universe: 0, address: 0 }), "all");
  const rows = [row("a", "1", 1, 1, 10), row("b", "2", 1, 15, 490), row("c", "7", 2, 1, 512)];
  ok(JSON.stringify(freeStart(rows, 4)) === JSON.stringify({ universe: 1, address: 11 }), `the gap that fits: ${JSON.stringify(freeStart(rows, 4))}`);
  ok(JSON.stringify(freeStart(rows, 20)) === JSON.stringify({ universe: 3, address: 1 }), `too wide for the gaps: ${JSON.stringify(freeStart(rows, 20))}`);
  ok(JSON.stringify(freeStart(rows, 20, new Set(["c"]))) === JSON.stringify({ universe: 2, address: 1 }), "a device being moved leaves its addresses free");
  ok(JSON.stringify(freeStart([], 1)) === JSON.stringify({ universe: 1, address: 1 }), "an empty patch starts at 1/1");
  ok(nextChannel([row("a", "12", 0, 0), row("b", "A3", 0, 0), row("c", " 40 ", 0, 0)]) === 41 && nextChannel([]) === 1, "next channel");
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
