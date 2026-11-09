// The gallery's calls to the server, for the editor's publish dialog and the gallery page. Its own
// small fetch wrapper in the idiom of platform/api.ts, so the gallery page needs nothing else from
// it but ApiError.

import { ApiError } from "../../platform/api.ts";
import type {
  EntryDetail,
  EntryPatch,
  ForkAttribution,
  ForkResult,
  GalleryList,
  GallerySort,
  ModerationItem,
  OwnEntry,
  PublishRequest,
  PublishState,
  ReportRequest,
  TagCount,
} from "./rules.ts";

const BASE = "/api/gallery";

/** One call to the gallery's API. Every call carries the header the server's CSRF check wants. */
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const h: Record<string, string> = { "X-Requested-With": "openvwx", ...headers };
  let payload: BodyInit | undefined;
  if (body instanceof Blob) {
    // sent as is: a cover picture's own type becomes its Content-Type
    payload = body;
    h["Content-Type"] ??= body.type || "application/octet-stream";
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    h["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(BASE + path, { method, headers: h, body: payload, credentials: "include" });
  } catch {
    throw new ApiError("The Rodeo server could not be reached", 0, "network");
  }
  if (!res.ok) {
    let message = plainStatus(res);
    let code: string | undefined;
    try {
      const j = (await res.json()) as { error?: string; code?: string };
      if (j.error) message = j.error;
      code = j.code;
    } catch {
      // not JSON: a proxy in front answered (Cloudflare's own pages are HTML)
    }
    throw new ApiError(message, res.status, code);
  }
  return res;
}

/** A call whose answer is JSON. */
async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await (await call(method, path, body)).json()) as T;
}

/** What a status means when the answer isn't the server's own JSON. */
function plainStatus(res: Response): string {
  if (res.status === 413) return "It is too large for the server to take";
  if (res.status === 502 || res.status === 503 || res.status === 504 || (res.status >= 520 && res.status <= 527)) {
    return `The Rodeo server didn't answer (${res.status}). It may be restarting after an update: try again in a minute`;
  }
  return `${res.status} ${res.statusText}`.trim();
}

/** The gallery's API: the public reads, the owner's publishing, forks, reports and the admins' moderation. */
export const galleryApi = {
  /** One page of the listing. Parameters at their defaults are left out of the address. */
  list(p: { q?: string; tag?: string; author?: string; featured?: boolean; sort?: GallerySort; page?: number }): Promise<GalleryList> {
    const qs = new URLSearchParams();
    const q = p.q?.trim();
    if (q) qs.set("q", q);
    if (p.tag) qs.set("tag", p.tag);
    if (p.author) qs.set("author", p.author);
    if (p.featured) qs.set("featured", "1");
    if (p.sort && p.sort !== "trending") qs.set("sort", p.sort);
    if (p.page && p.page > 1) qs.set("page", String(p.page));
    const query = qs.toString();
    return json<GalleryList>("GET", `/entries${query ? `?${query}` : ""}`);
  },

  /** The most used tags among visible drawings. */
  async tags(): Promise<TagCount[]> {
    return (await json<{ tags: TagCount[] }>("GET", "/tags")).tags;
  },

  /** One drawing's page. */
  entry(id: string): Promise<EntryDetail> {
    return json<EntryDetail>("GET", `/entries/${encodeURIComponent(id)}`);
  },

  /** Reports a drawing. */
  async report(id: string, r: ReportRequest): Promise<void> {
    await call("POST", `/entries/${encodeURIComponent(id)}/report`, r);
  },

  /** Forks a drawing into the signed-in account's cloud drawings. */
  fork(id: string): Promise<ForkResult> {
    return json<ForkResult>("POST", `/entries/${encodeURIComponent(id)}/fork`);
  },

  /** What the publish dialog shows for one of the owner's drawings. */
  status(fileId: string): Promise<PublishState> {
    return json<PublishState>("GET", `/files/${encodeURIComponent(fileId)}`);
  },

  /** Publishes the drawing's current version, or re-pins a published one to it. */
  async publish(fileId: string, r: PublishRequest): Promise<OwnEntry> {
    return (await json<{ entry: OwnEntry }>("POST", `/files/${encodeURIComponent(fileId)}/publish`, r)).entry;
  },

  /** Changes an entry's details, without moving it to another version. */
  async patch(id: string, p: EntryPatch): Promise<OwnEntry> {
    return (await json<{ entry: OwnEntry }>("PATCH", `/entries/${encodeURIComponent(id)}`, p)).entry;
  },

  /** Takes a drawing out of the gallery. Its forks stay as they are. */
  async unpublish(id: string): Promise<void> {
    await call("DELETE", `/entries/${encodeURIComponent(id)}`);
  },

  /** Sets the cover picture: a PNG or JPEG of the cover's size. */
  async putCover(id: string, picture: Blob): Promise<void> {
    await call("PUT", `/entries/${encodeURIComponent(id)}/cover`, picture);
  },

  /** Where a drawing was forked from, or null when it was not a fork of a gallery drawing. */
  async forkedFrom(fileId: string): Promise<ForkAttribution | null> {
    try {
      return (await json<{ attribution: ForkAttribution | null }>("GET", `/forked/${encodeURIComponent(fileId)}`)).attribution ?? null;
    } catch (e) {
      // an older server answered 404 for "not a fork"
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },

  /** The admins' queue: drawings with open reports, and hidden ones. */
  async moderation(): Promise<ModerationItem[]> {
    return (await json<{ items: ModerationItem[] }>("GET", "/admin/reports")).items;
  },

  /** Hides a drawing from the gallery, with the reason its owner is emailed. */
  async hide(id: string, reason: string): Promise<void> {
    await call("POST", `/admin/entries/${encodeURIComponent(id)}/hide`, { reason });
  },

  /** Puts a hidden drawing back in the gallery. */
  async restore(id: string): Promise<void> {
    await call("POST", `/admin/entries/${encodeURIComponent(id)}/restore`);
  },

  /** Closes a drawing's open reports without hiding it. */
  async dismiss(id: string): Promise<void> {
    await call("POST", `/admin/entries/${encodeURIComponent(id)}/dismiss`);
  },

  /** Picks a drawing for the front of the gallery, or takes it off the front. */
  async feature(id: string, featured: boolean): Promise<void> {
    await call("POST", `/admin/entries/${encodeURIComponent(id)}/feature`, { featured });
  },
};
