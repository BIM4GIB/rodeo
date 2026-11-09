// Autosave keeps a separate browser copy of every dirty drawing, including background tabs.
// After edits pause, one drawing per timer tick is copied at the preference's interval.
// Saving, undoing to the saved state, or explicitly discarding a drawing removes its copy.
// At startup, copies left by a crash are offered back; inactive copies expire after seven days.
// Drawings over AUTOSAVE_MAX_BYTES or with held parts are excluded because serialization
// needs another drawing's worth of memory. Edit > Preferences (prefs.ts) controls the interval.
import type { EditSession } from "../core/index.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { AUTOSAVE_MAX_BYTES, prefs } from "./prefs.ts";
import { backupKeys, deleteBackupIfUnchanged, expireBackups, Recovery, withRecovery } from "./recovery.ts";
import { toast } from "./toast.ts";

export interface AutosaveDeps {
  openDocument(bytes: Uint8Array, name: string): Promise<EditSession | null>;
}

export function installAutosave(deps: AutosaveDeps): Recovery {
  const recovery = new Recovery(() => ({
    enabled: prefs().autosave,
    minutes: prefs().autosaveMinutes,
    maxBytes: AUTOSAVE_MAX_BYTES,
  }));
  window.setInterval(() => void recovery.tick(), 15_000);
  if (!new URLSearchParams(location.search).has("embed")) {
    void offerRecovery(deps, recovery).catch(() => {});
  }
  return recovery;
}

async function offerRecovery(deps: AutosaveDeps, recovery: Recovery): Promise<void> {
  // Includes the legacy "latest" entry; never clears another live window's backups.
  await expireBackups();
  for (const key of await backupKeys()) await withRecovery(key, async (b) => {
    const discard = h("input", { attrs: { type: "checkbox" } });
    const open = await showDialog<true>({
      title: "Recover Drawing",
      okLabel: "Open Copy",
      body: [
        h("p", { cls: "menu-dialog-text", text: `Rodeo kept a copy of "${b.name}" with changes that were not saved (${new Date(b.savedAt).toLocaleString()}).` }),
        h("p", { cls: "muted", text: "Open it, then save it to keep the changes." }),
        h("label", { cls: "menu-dialog-check" }, discard, "Delete the copy"),
      ],
      check: () => ({ value: true }),
    });
    if (open) {
      const session = await deps.openDocument(b.bytes, b.name);
      if (!session) return;
      session.markUnsaved();
      // Keep the old backup if the new one cannot commit (quota, close, or a failed open).
      if (await recovery.copy(session)) await deleteBackupIfUnchanged(key, b);
      toast(`Opened the kept copy of ${b.name}. Save it to keep its changes.`, "info");
    } else if (discard.checked) await deleteBackupIfUnchanged(key, b);
  });
}
