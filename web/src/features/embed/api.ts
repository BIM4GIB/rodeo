// The client for a share link's preview pictures: the Share dialog reads what the server holds for a
// link and uploads new pictures, and the public picture addresses are what the embed, link unfurls
// and Markdown codes point at. Only fetch is used, so the check runs in node.

import { ApiError } from "../../platform/api.ts";

/** One preview picture of a share link, as the preview endpoint describes it. */
export interface PreviewImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly createdAt: string;
}

/** A share link's preview pictures, and whether the drawing changed after they were made. */
export interface SharePreview {
  readonly poster: PreviewImage | null;
  readonly turntable: PreviewImage | null;
  readonly stale: boolean;
}

const BASE = "/api";

/** One request to the server. A refusal throws an ApiError carrying the server's own message when it sent one. */
async function call(method: string, path: string, body?: Blob): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      body,
      credentials: "include",
      // the server refuses any change under /api that lacks this header (its CSRF guard)
      headers: { "X-Requested-With": "openvwx", ...(body ? { "Content-Type": body.type || "application/octet-stream" } : {}) },
    });
  } catch {
    throw new ApiError("The Rodeo server could not be reached", 0, "network");
  }
  if (res.ok) return res;
  let message = `${res.status} ${res.statusText}`.trim();
  let code: string | undefined;
  try {
    const j = (await res.json()) as { error?: string; code?: string };
    if (j.error) message = j.error;
    code = j.code;
  } catch {
    // not JSON: a proxy in front answered, so the status stands for the message
  }
  throw new ApiError(message, res.status, code);
}

/** The path of a share link's preview, with the token encoded. */
function sharePath(token: string, rest: string): string {
  return `/shares/${encodeURIComponent(token)}/${rest}`;
}

/** The preview calls: read a link's pictures and upload new ones (the owner or an editor only). */
export const embedApi = {
  /** The link's preview pictures, and whether they are older than the drawing. */
  async preview(token: string): Promise<SharePreview> {
    const res = await call("GET", sharePath(token, "preview"));
    return (await res.json()) as SharePreview;
  },
  /** Uploads the link's still picture, a PNG or JPEG of at most 1 MB. */
  async putPoster(token: string, picture: Blob, width: number, height: number): Promise<void> {
    await call("PUT", `${sharePath(token, "poster")}?width=${width}&height=${height}`, picture);
  },
  /** Uploads the link's turning picture, a GIF of at most 4 MB. */
  async putTurntable(token: string, gif: Blob, width: number, height: number): Promise<void> {
    await call("PUT", `${sharePath(token, "turntable")}?width=${width}&height=${height}`, gif);
  },
};

/** The public address of a link's still picture: always an image while the link lives. */
export function posterUrl(origin: string, token: string): string {
  return `${origin}/api/s/${encodeURIComponent(token)}/poster`;
}

/** The public address of a link's turning picture (the still when there is none). */
export function turntableUrl(origin: string, token: string): string {
  return `${origin}/api/s/${encodeURIComponent(token)}/turntable`;
}
