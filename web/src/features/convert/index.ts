// convert feature: the links to the converter (File › Convert Files… and the start hub's footer) and
// the way a converted drawing comes back from it. The converter page keeps the drawing in IndexedDB
// and opens ?convert=<id>; this takes that record, deletes it, and opens it as a drawing with no
// file behind it. Registers with app/ext.ts when imported.

import { h } from "../../app/dom.ts";
import { fileIn, registerMenu, registerUrlHandler, registerWelcome } from "../../app/ext.ts";
import { errorMessage, toast } from "../../app/toast.ts";

/** A converted drawing the converter page handed over: the bytes, the name it opens as, and the file it came from. */
interface Handoff {
  readonly id: string;
  readonly name: string;
  readonly source: string;
  readonly bytes: Uint8Array;
  readonly at: number;
}

/** The database and store the converter page writes its records to; the same names on both sides. */
const DB = "openvwx-convert";
const STORE = "handoff";

/** The converter's address: its page on this site, or on rodeo.build when the editor runs from a file. */
function converterUrl(): string {
  return location.protocol === "http:" || location.protocol === "https:" ? "/convert" : "https://rodeo.build/convert";
}

/** Opens the converter in a tab of its own. */
function openConverter(): void {
  window.open(converterUrl(), "_blank", "noopener");
}

/** Opens the handoff database, making its store the first time it is created. */
function openHandoffDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Takes the record with this id and deletes it in the same transaction, so a drawing opens once. */
async function takeHandoff(id: string): Promise<Handoff | undefined> {
  const db = await openHandoffDb();
  try {
    return await new Promise<Handoff | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      let found: Handoff | undefined;
      const get = store.get(id);
      get.onsuccess = () => {
        found = get.result as Handoff | undefined;
        store.delete(id);
      };
      // the result is given once the delete has committed, not when the read returns
      tx.oncomplete = () => resolve(found);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("the transaction was aborted"));
    });
  } finally {
    db.close();
  }
}

/** Removes a parameter from the address bar, keeping the rest, so a reload does not open the drawing again. */
function dropParam(name: string): void {
  const url = new URL(location.href);
  url.searchParams.delete(name);
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

registerUrlHandler("convert", (id, _params, ctx) => {
  void (async () => {
    try {
      const record = await takeHandoff(id);
      if (!record) {
        toast("That converted drawing isn't here any more: convert the file again.", "info");
        return;
      }
      await ctx.openDocument(record.bytes, record.name);
      // the file it came in as is the converted drawing (the converter page kept the original), so a report names that
      fileIn(record.bytes, record.name);
    } catch (err) {
      toast(`Could not open the converted drawing: ${errorMessage(err)}`);
    } finally {
      dropParam("convert");
    }
  })();
});

registerMenu("File", () => [{ label: "Convert Files…", run: openConverter }], { after: "Export" });

registerWelcome(
  () => h("a", { cls: "hub-link", text: "Convert files", attrs: { href: converterUrl(), target: "_blank", rel: "noopener" } }),
  "foot",
);
