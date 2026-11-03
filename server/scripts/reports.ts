// Reads the error reports a Rodeo server has (server/src/reports.ts) from a terminal:
//
//   node scripts/reports.ts                 every error, latest first, one line each
//   node scripts/reports.ts <group>         that error's latest report in full
//   node scripts/reports.ts <group> --all   every kept report of it in full
//   node scripts/reports.ts --clear <group> drops it, once it is fixed
//
// The server is RODEO_URL (default https://rodeo.build); the token is REPORTS_TOKEN, or the
// file ~/.config/rodeo/reports-token. It must match the server's REPORTS_TOKEN.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ErrorReport, ErrorReportGroup } from "../../web/src/platform/protocol.ts";

const base = (process.env.RODEO_URL ?? "https://rodeo.build").replace(/\/+$/, "");
const token = process.env.REPORTS_TOKEN ?? readToken();

function readToken(): string {
  try {
    return readFileSync(join(homedir(), ".config/rodeo/reports-token"), "utf8").trim();
  } catch {
    console.error("No token: set REPORTS_TOKEN or write it to ~/.config/rodeo/reports-token");
    process.exit(2);
  }
}

async function api<T>(method: string, path: string): Promise<T> {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "X-Requested-With": "openvwx" },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(`${res.status}: ${body.error ?? res.statusText}`);
  return body;
}

function block(title: string, rec: Readonly<Record<string, unknown>> | undefined): string[] {
  return rec && Object.keys(rec).length ? ["", `${title}:`, ...Object.entries(rec).map(([k, v]) => `  ${k}: ${String(v)}`)] : [];
}

function full(r: ErrorReport): string {
  return [
    `${r.createdAt}  ${r.kind} in ${r.area}  (${r.userName ?? "signed out"})`,
    r.message,
    ...block("Details", r.details),
    ...block("Where", r.env),
    ...(r.trail?.length ? ["", "Just before:", ...r.trail.map((t) => `  ${t}`)] : []),
    ...(r.stack ? ["", "Stack:", r.stack] : []),
  ].join("\n");
}

const args = process.argv.slice(2);
if (args[0] === "--clear" && args[1]) {
  await api("DELETE", `/admin/reports/${encodeURIComponent(args[1])}`);
  console.log(`Cleared ${args[1]}.`);
} else if (args[0]) {
  const { reports } = await api<{ reports: ErrorReport[] }>("GET", `/admin/reports?group=${encodeURIComponent(args[0])}`);
  if (reports.length === 0) console.log("No reports in that group.");
  for (const r of args.includes("--all") ? reports : reports.slice(0, 1)) console.log(`${full(r)}\n${"-".repeat(72)}`);
} else {
  const { groups } = await api<{ groups: ErrorReportGroup[] }>("GET", "/admin/reports");
  if (groups.length === 0) console.log("No error reports.");
  for (const g of groups) {
    console.log(`${g.fingerprint}  ${g.lastSeen.slice(0, 16).replace("T", " ")}  ×${String(g.count).padEnd(4)} ${g.kind.padEnd(7)} ${g.area}: ${g.message.slice(0, 110)}`);
  }
}
