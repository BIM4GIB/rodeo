// node scripts/credit-holds-test.ts — isolated database, no payment/provider requests.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiCredit } from "../src/config.ts";
const data = mkdtempSync(join(tmpdir(), "rodeo-credit-holds-"));
process.env.DATA_DIR = data;
const { openDatabase, run } = await import("../src/db.ts");
const { signInUser } = await import("../src/auth.ts");
const { holdCredit, freeCredit, MICRO } = await import("../src/credit.ts");
const db = openDatabase();
const terms = { hold: 1 } as AiCredit;
try {
  for (const order of ["none", "ai-first", "render-first"]) {
    const user = signInUser({ email: `${order}@example.com`, name: "Test", avatarUrl: null });
    run("UPDATE users SET ai_credit=? WHERE id=?", 10 * MICRO, user.id);
    if (order !== "none") run("INSERT INTO render_jobs(id,user_id,state,name,width,height,samples,shots,gpu,limit_seconds,hold,created_at) VALUES(?,?,'running','test',1,1,1,1,'none',90,?,?)", order, user.id, 2 * MICRO, new Date().toISOString());
    const render = order === "none" ? 0 : 2;
    const release = holdCredit(user, terms);
    const release2 = holdCredit(user, terms);
    assert.equal(freeCredit(user.id), (8 - render) * MICRO);
    assert.throws(() => holdCredit(user, { hold: 20 } as AiCredit));
    assert.equal(freeCredit(user.id), (8 - render) * MICRO, "refusal does not reserve credit");
    release2(); release2();
    assert.equal(freeCredit(user.id), (9 - render) * MICRO);
    if (order === "render-first") run("UPDATE render_jobs SET state='done' WHERE id=?", order);
    release(); release();
    assert.equal(freeCredit(user.id), (order === "ai-first" ? 8 : 10) * MICRO);
    if (order === "ai-first") run("UPDATE render_jobs SET state='done' WHERE id=?", order);
    try { const done = holdCredit(user, terms); try { throw new Error("provider failure"); } finally { done(); } } catch { /* expected */ }
    assert.equal(freeCredit(user.id), 10 * MICRO);
  }
  console.log("credit hold checks passed");
} finally { db.close(); rmSync(data, { recursive: true, force: true }); }
