// Periodic clean-up: expired sessions, sign-in links and invites; voice notes never attached
// to a comment; cloud renders past keeping; uploads left unused; error reports and earlier
// builds' assets past keeping; visits past keeping; feedback attachments that stopped arriving or
// are past keeping; OAuth codes, tokens and connections past keeping, and app registrations never
// used; and the in-memory rate-limit windows.

import { pruneRateLimits } from "./auth.ts";
import { releaseBlobs } from "./blobs.ts";
import { all, run } from "./db.ts";
import { sweepFeedback } from "./feedback.ts";
import { sweepRenders } from "./render.ts";
import { pruneReports } from "./reports.ts";
import { pruneOAuth } from "./oauth/index.ts";
import { pruneAssets } from "./static.ts";
import { sweepUploads } from "./uploads.ts";
import { pruneVisits } from "./visits.ts";
import { DAY, inMs, MINUTE, nowIso } from "./util.ts";

async function sweep(): Promise<void> {
  const now = nowIso();
  run("DELETE FROM sessions WHERE expires_at <= ?", now);
  run("DELETE FROM magic_links WHERE expires_at <= ?", now);
  run("DELETE FROM invites WHERE expires_at <= ?", now);
  const orphans = all<{ id: string; blob: string }>(
    "SELECT id, blob FROM audio WHERE created_at <= ? AND id NOT IN (SELECT audio_id FROM comments WHERE audio_id IS NOT NULL)",
    inMs(-DAY),
  );
  for (const o of orphans) run("DELETE FROM audio WHERE id = ?", o.id);
  await releaseBlobs(orphans.map((o) => o.blob));
  await sweepRenders();
  await sweepUploads();
  await sweepFeedback();
  pruneReports();
  pruneVisits();
  pruneOAuth();
  await pruneAssets();
  pruneRateLimits();
}

export function startHousekeeping(): void {
  const tick = (): void => {
    sweep().catch((e: unknown) => console.error("[housekeeping]", e));
  };
  tick();
  setInterval(tick, 30 * MINUTE).unref();
}
