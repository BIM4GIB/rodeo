// Real IndexedDB/Web Locks checks. In a FRESH isolated browser profile on a local Vite server:
// await (await import('/src/app/recovery.check.ts')).checkRecovery()
// Refuses to run if the origin already has backups; never run on a production origin.
import { blankDrawing } from "../core/blank.ts";
import { openVwx } from "../core/index.ts";
import { backupKeys, deleteBackup, readBackup, Recovery, withRecovery, writeBackup } from "./recovery.ts";

function check(ok: boolean, why: string): void { if (!ok) throw new Error(why); }
export async function checkRecovery(): Promise<void> {
  check((await backupKeys()).length === 0, "Use an isolated profile with no existing backups");
  let now = 0;
  const recovery = new Recovery(() => ({ enabled: true, minutes: 1, maxBytes: 100000 }), () => now);
  const a = openVwx(blankDrawing("mm")), b = openVwx(blankDrawing("mm"));
  const add = (s = a): void => { s.addObjects(s.doc.layers()[0].id, [{ kind: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }]); };
  const advance = async (): Promise<void> => { now += 61000; await recovery.tick(); };
  const put = IDBObjectStore.prototype.put;
  try {
    recovery.track(a, () => ({ name: "same.vwx", size: 6000 })); add(a);
    // Drawing A remains tracked when B becomes active before the first tick.
    recovery.track(b, () => ({ name: "same.vwx", size: 6000 })); add(b);
    await advance();
    const keys = await backupKeys(); check(keys.length === 2, "same-name sessions need separate backups");
    let offered = 0;
    for (const key of keys) await withRecovery(key, async () => { offered++; });
    check(offered === 0, "active sessions must not be offered to another window");
    b.markSaved(); await recovery.settled();
    check((await backupKeys()).length === 1 && a.dirty, "saving B must preserve A");
    a.undo(); await recovery.settled(); check((await backupKeys()).length === 0, "undo to saved clears only that backup");
    a.redo(); await advance(); check((await backupKeys()).length === 1, "redo schedules a new copy");

    // Save during the async IDB write: queued deletion must run AFTER the stale write.
    add(a);
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      const req = put.apply(this, args); a.markSaved(); return req;
    };
    await advance(); await recovery.settled();
    check((await backupKeys()).length === 0, "pending write must not resurrect saved data");
    IDBObjectStore.prototype.put = put;

    // A successful request followed by transaction abort is not a successful backup.
    add(a);
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      const req = put.apply(this, args); req.onsuccess = () => this.transaction.abort(); return req;
    };
    await advance(); check((await backupKeys()).length === 0, "abort must not count as persisted");
    IDBObjectStore.prototype.put = put;
    await advance(); check((await backupKeys()).length === 1, "failed storage is retried");
    await recovery.forget(a); check((await backupKeys()).length === 0, "discard deletes this session's entry");

    const changing = openVwx(blankDrawing("mm")); changing.markUnsaved();
    recovery.track(changing, () => ({ name: "changing", size: 6000 }));
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      const req = put.apply(this, args); add(changing); return req;
    };
    await recovery.copy(changing);
    IDBObjectStore.prototype.put = put;
    await advance();
    const newer = openVwx((await readBackup((await backupKeys())[0]))!.bytes);
    check(newer.doc.objects(newer.doc.layers()[0].id).length === 1, "an edit during writing remains pending for the next copy");
    let forgotten = Promise.resolve();
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      const req = put.apply(this, args); forgotten = recovery.forget(changing); return req;
    };
    add(changing); await advance(); await forgotten;
    IDBObjectStore.prototype.put = put;
    check((await backupKeys()).length === 0, "discard during a pending write cannot resurrect the backup");

    const big = openVwx(blankDrawing("mm")); big.markUnsaved();
    recovery.track(big, () => ({ name: "big", size: 100001 }));
    check(!await recovery.copy(big), "large files stay excluded"); await recovery.forget(big);
    const held = openVwx(blankDrawing("mm")); held.markUnsaved(); held.doc.holdsParts = () => true;
    recovery.track(held, () => ({ name: "held", size: 10 }));
    check(!await recovery.copy(held), "held parts stay excluded"); await recovery.forget(held);

    await writeBackup("latest", { name: "legacy.vwx", bytes: blankDrawing("mm"), savedAt: now });
    await withRecovery("latest", async (backup, exclusive) => {
      check(exclusive && backup.name === "legacy.vwx", "legacy backup remains recoverable");
      const recovered = openVwx(backup.bytes); recovered.markUnsaved();
      check(recovered.dirty, "recovered copy must require a save");
      recovery.track(recovered, () => ({ name: backup.name, size: backup.bytes.length }));
      check(await recovery.copy(recovered), "recovered copy transferred durably");
      await deleteBackup("latest");
      check((await backupKeys()).length === 1, "transfer preserves one copy");
      recovered.markSaved(); await recovery.settled();
      check((await backupKeys()).length === 0, "explicit save clears the recovered copy");
      await recovery.forget(recovered);
    });
    check(await readBackup("latest") === null, "legacy entry removed only after successful transfer");
  } finally {
    IDBObjectStore.prototype.put = put;
    await recovery.forget(a); await recovery.forget(b);
    await deleteBackup("latest");
  }
}
