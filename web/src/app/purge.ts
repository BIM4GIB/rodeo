// Tools > Utilities > Purge…: removes what the drawing no longer uses, as Vectorworks' Purge
// does: symbol definitions placed nowhere, classes nothing uses, and coincident duplicates
// (an unnamed object identical to an earlier one in the same layer or group). Each kind shows
// how many it finds now; the chosen kinds go in one undo step, with any class that only the
// purged definitions used.

import type { PurgeKind } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

const KINDS: readonly { readonly kind: PurgeKind; readonly label: string; readonly one: string; readonly many: string }[] = [
  { kind: "symbols", label: "Unused symbol definitions", one: "symbol definition", many: "symbol definitions" },
  { kind: "classes", label: "Unused classes", one: "class", many: "classes" },
  { kind: "duplicates", label: "Coincident duplicate objects", one: "duplicate object", many: "duplicate objects" },
];

function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Asks which kinds to purge, with how many of each the drawing has, then removes them. */
export async function purgeDialog(): Promise<void> {
  const found = attempt("Purge", (s) => s.purgeable());
  if (!found) return;
  const count = (k: PurgeKind): number => found.value[k].length;
  if (KINDS.every((k) => count(k.kind) === 0)) {
    toast("Nothing to purge: every symbol definition and class is in use, and no object is duplicated.", "info");
    return;
  }
  const boxes = KINDS.map((k) => {
    const n = count(k.kind);
    const box = h("input", { attrs: { type: "checkbox" }, checked: n > 0, disabled: n === 0 });
    return { ...k, box, row: h("label", { cls: "menu-dialog-check" }, box, h("span", { text: `${k.label} (${n})` })) };
  });
  const kinds = await showDialog<PurgeKind[]>({
    title: "Purge",
    okLabel: "Purge",
    body: [
      ...boxes.map((b) => b.row),
      h("p", {
        cls: "muted",
        text: "Classes used only inside purged symbol definitions go with them. A symbol or class whose name a plug-in, worksheet or data visualization holds as text stays, and so does a class any style might use.",
      }),
    ],
    check: () => {
      const chosen = boxes.filter((b) => b.box.checked).map((b) => b.kind);
      return chosen.length ? { value: chosen } : { error: "Choose something to purge." };
    },
  });
  if (!kinds) return;
  const done = attempt("Purge", (s) => s.purge(kinds));
  if (!done || !store.session) return;
  const parts = KINDS.map((k) => ({ ...k, n: done.value[k.kind].length }))
    .filter((k) => k.n > 0)
    .map((k) => counted(k.n, k.one, k.many));
  toast(parts.length ? `Purged ${parts.join(", ")}.` : "Nothing was purged.", "info");
}
