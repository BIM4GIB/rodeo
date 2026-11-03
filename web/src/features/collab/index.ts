// collab feature: live collaboration in 2D and 3D (docs/PLATFORM.md, "Live collaboration").
// Registers with app/ext.ts when imported. This file starts and stops the session for an open
// cloud drawing and shows its notices; the engine (engine.ts) keeps the drawing in step, and the
// other files here show what collaborators do: the top bar, their marks on the drawing and in
// 3D, Follow, and the Collaborators palette. The engine is optional: until it starts, a cloud
// drawing opens as before, with the failure reported once.

import "./collab.css";
import { on3d, onDocument, onReady, registerLeaveGuard, registerMenu, registerOverlay, registerPalette, registerTopBar } from "../../app/ext.ts";
import type { EditSession } from "../../core/index.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { cloudOffered } from "../cloud/cloud.ts";
import { serverConfig } from "../../platform/api.ts";
import { isCloudSource } from "../../platform/cloudSource.ts";
import { offerPlan } from "../cloud/cloud.ts";
import { collab, onCollab, resumeOf, startCollab, type CollabSession } from "./engine.ts";
import { emitLive, setFollowed } from "./live.ts";
import { applyFollow, mountFollow, stopFollow, userMoved } from "./follow.ts";
import { attachMarkers, mountMarkers } from "./markers3d.ts";
import { attachOverlay, drawPeers } from "./overlay.ts";
import { collaboratorsPalette, windowRows } from "./palette.ts";
import { attachSharing, projectSharingDialog } from "./sharing.ts";
import { listen3d, listenPresence, publishAll, publishCamera } from "./presence.ts";
import { buildTopBar } from "./topbar.ts";

registerTopBar(buildTopBar, "right");
registerOverlay(drawPeers);
registerPalette(collaboratorsPalette());
registerMenu("Window", windowRows);
// shown where the server offers the cloud, beside Share…
registerMenu(
  "File",
  () => (cloudOffered() ? [{ label: "Project Sharing…", enabled: () => store.session !== null, run: () => void projectSharingDialog() }] : []),
  { after: "Share…" },
);

onReady((ctx) => {
  mountFollow(ctx);
  listenPresence(ctx);
});

on3d((v) => {
  mountMarkers(v);
  listen3d(v);
  publishCamera(v);
  v.onCameraChange(userMoved);
  v.domElement.addEventListener("pointerdown", stopFollow);
  v.domElement.addEventListener("wheel", stopFollow, { passive: true });
});

// ---- starting and stopping ------------------------------------------------------

/** Counts documents opened or closed, so a join that finishes after another open is left at once. */
let generation = 0;
/** the drawings that have started joining their live session, by edit session */
const joined = new WeakSet<EditSession>();

onDocument((session, source) => {
  const gen = ++generation;
  collab()?.leave();
  if (!session || !isCloudSource(source)) return;
  // a drawing brought back to the front from its tab joins again from where it left; one that left
  // with changes unsent no longer matches the server's copy, so it stays out
  const at = resumeOf(session);
  if (!at && joined.has(session)) {
    toast("This drawing has changes the live session never received. Reopen it from the cloud to work live again.", "error");
    return;
  }
  void joinLive(gen, session, source.id, (at ?? source).versionId, (at ?? source).collabSeq);
});

// another tab can't come to the front while this drawing's changes are on their way: leaving drops them
registerLeaveGuard(() => (collab()?.settled() === false ? "Your latest changes are still being sent. Try again once they have gone." : null));

async function joinLive(gen: number, session: EditSession, fileId: string, versionId: string, collabSeq: number): Promise<void> {
  try {
    if (!(await serverConfig())?.collab || gen !== generation) return;
    joined.add(session);
    const live = await startCollab(fileId, session, versionId, collabSeq);
    if (gen !== generation) live.leave();
  } catch (err) {
    if (gen === generation) toast(`Live collaboration is unavailable: ${errorMessage(err)}`);
  }
}

let stopLive: (() => void) | undefined;

onCollab((s) => {
  stopLive?.();
  stopLive = s ? attachLive(s) : undefined;
  emitLive();
});

/** Everything tied to one live session: its notices, what this client tells it, and what it shows. */
function attachLive(s: CollabSession): () => void {
  const off: (() => void)[] = [];
  let known = new Map<string, string>(s.peers().map((p): [string, string] => [p.clientId, p.name]));
  let dropped = false;
  off.push(
    s.onPeers(() => {
      const now = new Map<string, string>(s.peers().map((p): [string, string] => [p.clientId, p.name]));
      for (const [id, name] of now) if (!known.has(id)) toast(`${name} joined`, "info");
      for (const [id, name] of known) if (!now.has(id)) toast(`${name} left`, "info");
      known = now;
      applyFollow();
      emitLive();
    }),
  );
  off.push(
    s.onStatus((status) => {
      if (status === "offline" && !dropped) {
        dropped = true;
        // a session that is being left also reports offline, just before it ends: only one still running is news
        window.setTimeout(() => {
          if (collab() === s && s.status() === "offline") toast("Live collaboration disconnected — reconnecting…", "error");
        }, 0);
      } else if (status === "live" && dropped) {
        dropped = false;
        toast("Back online", "info");
      }
      emitLive();
    }),
  );
  off.push(s.onRejected(() => toast("Your change clashed with someone else’s edit and was undone", "error")));
  off.push(
    s.onAutosave((stopped, plan) => {
      const why = `Autosave has stopped. ${stopped} Your changes are kept until a version can be saved.`;
      if (stopped === null) toast("Autosave is working again", "info");
      else if (plan) void offerPlan(why);
      else toast(why);
    }),
  );
  off.push(attachOverlay(s));
  off.push(attachSharing(s));
  off.push(attachMarkers(s));
  publishAll(s);
  return () => {
    for (const f of off) f();
    setFollowed(null);
  };
}
