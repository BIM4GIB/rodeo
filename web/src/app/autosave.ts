// Per-drawing recovery copies; inactive tabs keep their own timers and listeners.
import type { EditSession } from "../core/index.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { AUTOSAVE_MAX_BYTES, prefs } from "./prefs.ts";
import { backupKeys, deleteBackup, Recovery, withRecovery } from "./recovery.ts";
import { toast } from "./toast.ts";

export interface AutosaveDeps {
  openDocument(bytes: Uint8Array, name: string): Promise<EditSession | null>;
}

export function installAutosave(deps: AutosaveDeps): Recovery {
  const recovery = new Recovery(() => ({ enabled: prefs().autosave, minutes: prefs().autosaveMinutes, maxBytes: AUTOSAVE_MAX_BYTES }));
  window.setInterval(() => void recovery.tick(), 15_000);
  void offerRecovery(deps, recovery).catch(() => {});
  return recovery;
}

async function offerRecovery(deps: AutosaveDeps, recovery: Recovery): Promise<void> {
  // Includes the legacy "latest" entry; never clears another live window's backups.
  for (const key of await backupKeys()) await withRecovery(key, async (b, exclusive) => {
    const discard = h("input", { attrs: { type: "checkbox" } });
    const open = await showDialog<true>({
      title: "Recover Drawing", okLabel: "Open Copy",
      body: [
        h("p", { cls: "menu-dialog-text", text: `Rodeo kept a copy of "${b.name}" with changes that were not saved (${new Date(b.savedAt).toLocaleString()}).` }),
        h("p", { cls: "muted", text: "Open it, then save it to keep the changes." }),
        ...(exclusive ? [h("label", { cls: "menu-dialog-check" }, discard, "Delete the copy")] : []),
      ],
      check: () => ({ value: true }),
    });
    if (open) {
      const session = await deps.openDocument(b.bytes, b.name);
      if (!session) return;
      session.markUnsaved();
      // Keep the old backup if the new one cannot commit (quota, close, or a failed open).
      if (await recovery.copy(session) && exclusive) await deleteBackup(key);
      toast(`Opened the kept copy of ${b.name}. Save it to keep its changes.`, "info");
    } else if (exclusive && discard.checked) await deleteBackup(key);
  });
}
