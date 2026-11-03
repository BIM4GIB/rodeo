// The openvwx server: one process serves the API, the live-collaboration socket and the editor.
// Start with `node src/index.ts` (Node 22 runs TypeScript directly). See docs/PLATFORM.md.

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readdirSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { registerAccount } from "./account.ts";
import { registerAdmin } from "./admin.ts";
import { registerAi } from "./ai.ts";
import { registerAuth, userFromRequest } from "./auth.ts";
import { registerBilling } from "./billing.ts";
import { attachCollab, type CollabDeps } from "./collab.ts";
import { registerComments } from "./comments.ts";
import { config } from "./config.ts";
import { registerCredit } from "./credit.ts";
import { database, get, openDatabase } from "./db.ts";
import { registerFeedback } from "./feedback.ts";
import { accessOf, registerFiles, saveRefusal } from "./files.ts";
import { apiNotFound, cors, csrf, noStore, onError, redirectHosts, requestLog } from "./http.ts";
import { setHub } from "./hub.ts";
import { startHousekeeping } from "./housekeeping.ts";
import { registerRender } from "./render.ts";
import { registerReports } from "./reports.ts";
import { registerSettings } from "./settings.ts";
import { registerSharing } from "./sharing.ts";
import { archiveAssets, registerStatic } from "./static.ts";
import { registerUploads } from "./uploads.ts";
import { registerVisits } from "./visits.ts";

openDatabase();
// Temp files are left behind only by a crash mid-upload.
for (const name of readdirSync(config.tmpDir)) rmSync(join(config.tmpDir, name), { recursive: true, force: true });

const app = new Hono();
app.use("*", redirectHosts);
app.use("/api/*", cors);
app.use("/api/*", csrf);
app.use("/api/*", noStore);
app.use("/api/*", requestLog);
app.onError(onError);
registerAccount(app);
registerAuth(app);
registerUploads(app);
registerFiles(app);
registerSharing(app);
registerComments(app);
registerBilling(app);
registerSettings(app);
registerFeedback(app);
registerAi(app);
registerCredit(app);
registerRender(app);
registerReports(app);
registerVisits(app);
registerAdmin(app);
app.all("/api/*", apiNotFound);
registerStatic(app);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`openvwx ${config.version} listening on port ${info.port}, public at ${config.publicUrl}`);
}) as Server;

const deps: CollabDeps = {
  db: database(),
  userFromRequest,
  roleOf: (fileId, userId) => accessOf(fileId, userId),
  head: (fileId) => {
    const r = get<{ head_version_id: string | null; collab_seq: number | null; size: number }>(
      "SELECT f.head_version_id, v.collab_seq, f.size FROM files f LEFT JOIN versions v ON v.id = f.head_version_id WHERE f.id = ?",
      fileId,
    );
    return r && r.head_version_id ? { versionId: r.head_version_id, collabSeq: r.collab_seq ?? 0, size: r.size } : null;
  },
  saveRefusal,
};
setHub(attachCollab(server, deps));
startHousekeeping();
archiveAssets().catch((e: unknown) => console.error("[assets] could not keep this build's assets:", e));

function shutdown(): void {
  server.close();
  database().close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
