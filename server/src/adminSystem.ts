// The admin page's System tab: the server's health (version, Node, uptime, memory), the size of the
// database and of the data disk, the rows in the main tables, what is set up and whether it is on
// (never a secret's value), the admins, and whether Cloudflare's visitor locations are arriving.
// GET /api/admin/system, for admins only.

import { statSync, statfsSync } from "node:fs";
import type { Hono } from "hono";
import type { AdminSystem, Tally } from "../../web/src/platform/protocol.ts";
import { dayBefore, requireAdmin } from "./admin.ts";
import { config } from "./config.ts";
import { get } from "./db.ts";

/** the tables whose rows the System tab counts */
const TABLES = ["users", "sessions", "files", "versions", "visits", "feedback", "error_groups", "gallery_entries", "comments", "ai_ledger", "render_jobs", "admin_log"];

const ACCESS: Record<string, string> = { all: "anyone signed in", supporters: "Rodeo Plus members", admins: "admins only" };

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** The disk the data folder is on: its size and what is free to us, in bytes. */
function disk(dir: string): { total: number; free: number } | null {
  try {
    const s = statfsSync(dir);
    return { total: s.bsize * s.blocks, free: s.bsize * s.bavail };
  } catch {
    return null;
  }
}

function tallies(): Tally[] {
  return TABLES.map((label) => {
    try {
      return { label, count: get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${label}`)?.n ?? 0 };
    } catch {
      return { label, count: 0 };
    }
  });
}

function features(): AdminSystem["features"] {
  const c = config;
  const out: { name: string; on: boolean; note: string | null }[] = [];
  const feature = (name: string, on: boolean, note: string | null): void => {
    out.push({ name, on, note: note || null });
  };

  // off in production until SMTP is set; in development the links go to the log
  feature("Email sign-in", c.emailAuth, !c.emailAuth ? "Needs SMTP_URL" : c.smtpUrl !== null ? "Sent through SMTP" : "Links go to the log");
  feature("Google sign-in", c.oauth.google !== undefined, c.oauth.google ? null : "Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
  feature("GitHub sign-in", c.oauth.github !== undefined, c.oauth.github ? null : "Needs GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET");
  feature("Microsoft sign-in", c.oauth.microsoft !== undefined, c.oauth.microsoft ? null : "Needs MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET");

  const stripe = c.stripe;
  const prices = stripe ? [stripe.monthly ? "monthly" : null, stripe.yearly ? "yearly" : null].filter((p): p is string => p !== null) : [];
  feature(
    "Stripe payments",
    stripe !== null,
    stripe ? `${prices.join(" and ")} ${prices.length === 1 ? "price" : "prices"} set` : "Needs STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and a price",
  );
  feature("Rodeo Plus prices", stripe !== null, stripe ? `${c.labels.monthly}, ${c.labels.yearly}` : "Not for sale without Stripe");

  const ai = c.ai;
  feature(
    "AI agents",
    ai !== null,
    ai
      ? `${ai.provider === "anthropic" ? "Anthropic" : ai.baseUrl.includes("openrouter.ai") ? "OpenRouter" : "an OpenAI-style endpoint"}, ${ai.models.length} ${ai.models.length === 1 ? "model" : "models"}, for ${ACCESS[ai.access]}`
      : "Needs ANTHROPIC_API_KEY or AI_API_KEY",
  );
  const credit = c.credit;
  feature(
    "AI credit",
    credit !== null,
    credit ? `${credit.currency.toUpperCase()}, ${Math.round((credit.markup - 1) * 100)}% markup` : "Off: the agents and renders are free, or AI_CREDIT is off",
  );
  feature("Cloud renders", c.render !== null, c.render ? `${c.render.gpu} GPU` : "Needs RENDER_URL and RENDER_SECRET");
  feature("Voice commands", c.voice !== null, c.voice ? c.voice.model : "Needs AI_API_KEY or OPENROUTER_API_KEY");
  feature("Carbon Ads", c.carbon !== null, c.carbon ? "In the start hub" : "Needs CARBON_SERVE and CARBON_PLACEMENT");
  feature("Google Drive picker", c.drives.google !== null, c.drives.google ? null : "Needs DRIVE_GOOGLE_CLIENT_ID, DRIVE_GOOGLE_API_KEY and DRIVE_GOOGLE_APP_ID");
  feature("OneDrive picker", c.drives.microsoft !== null, c.drives.microsoft ? null : "Needs DRIVE_MICROSOFT_CLIENT_ID");
  feature("Error report token", c.reportsToken !== null, c.reportsToken ? "Scripts can read and clear error reports" : "Only admins can read them");
  feature("Client IP header", c.clientIpHeader !== null, c.clientIpHeader ? c.clientIpHeader : "The last X-Forwarded-For hop is used");
  return out;
}

/** Whether Cloudflare's visitor location headers reached the server in the last day. */
function locationHeaders(): boolean {
  return get<{ n: number }>("SELECT 1 AS n FROM visits WHERE day >= ? AND city IS NOT NULL LIMIT 1", dayBefore(1)) !== undefined;
}

export function registerAdminSystem(app: Hono): void {
  app.get("/api/admin/system", (c) => {
    requireAdmin(c);
    const mem = process.memoryUsage();
    const data = disk(config.dataDir);
    const out: AdminSystem = {
      version: config.version,
      node: process.version,
      uptime: Math.round(process.uptime()),
      memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
      storage: {
        database: fileSize(config.dbPath) + fileSize(`${config.dbPath}-wal`),
        diskTotal: data?.total ?? null,
        diskFree: data?.free ?? null,
      },
      tables: tallies(),
      features: features(),
      admins: [...config.admins],
      publicUrl: config.publicUrl,
      locationHeaders: locationHeaders(),
    };
    return c.json(out);
  });
}
