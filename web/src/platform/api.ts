// Client for the openvwx server (docs/PLATFORM.md). Calls go to /api on this
// site (Vite proxies it to the server in development). serverConfig() is null
// when there is no server, as on a static host: features then stay hidden.

import type {
  AdminEngagement,
  AdminGeo,
  AdminLive,
  AdminLogEntry,
  AdminOverview,
  AdminRevenue,
  AdminSettings,
  AdminSystem,
  AdminUsage,
  AdminUser,
  AdminUserDetail,
  AdminUserFilter,
  AdminUserSort,
  AiCreditInfo,
  Announcement,
  CloudFile,
  Comment,
  ErrorReport,
  ErrorReportGroup,
  Feedback,
  FeedbackSent,
  Funding,
  Invite,
  Member,
  NewComment,
  NewFeedback,
  NewRenderJob,
  RenderJob,
  Role,
  ServerConfig,
  Share,
  SharedFile,
  Sponsor,
  User,
  Version,
} from "./protocol.ts";

const BASE = "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

type Body = unknown;

export async function request(method: string, path: string, body?: Body, headers: Record<string, string> = {}): Promise<Response> {
  const h: Record<string, string> = { "X-Requested-With": "openvwx", ...headers };
  let payload: BodyInit | undefined;
  if (body instanceof Uint8Array) {
    // sent as is, not as a Blob: the browser's store for Blobs fills up long before memory does
    payload = body as Uint8Array<ArrayBuffer>;
    h["Content-Type"] ??= "application/octet-stream";
  } else if (body instanceof Blob) {
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
    let message = plainStatus(res.status, res.statusText);
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

/** What a status means when the answer isn't the server's own JSON. */
function plainStatus(status: number, statusText: string): string {
  if (status === 413) return "It is too large for the server to take";
  if (status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 527)) {
    return `The Rodeo server didn't answer (${status}). It may be restarting after an update: try again in a minute`;
  }
  return `${status} ${statusText}`.trim();
}

/**
 * request() and json() for a body whose going out is watched: fetch says nothing until the answer,
 * so a part on a slow line showed no progress for its whole length. `onSent` hears how many of
 * the body's bytes have gone. Fails as request() does.
 */
function sendWatched<T>(method: string, path: string, body: Blob | Uint8Array, headers: Record<string, string>, onSent: (sent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, BASE + path);
    xhr.withCredentials = true;
    const type = body instanceof Blob && body.type ? body.type : "application/octet-stream";
    for (const [k, v] of Object.entries({ "X-Requested-With": "openvwx", "Content-Type": type, ...headers })) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onSent(e.loaded);
    xhr.onerror = xhr.ontimeout = xhr.onabort = () => reject(new ApiError("The Rodeo server could not be reached", 0, "network"));
    xhr.onload = () => {
      let answer: { error?: string; code?: string } | null = null;
      try {
        answer = JSON.parse(xhr.responseText) as { error?: string; code?: string };
      } catch {
        // not JSON: a proxy in front answered (Cloudflare's own pages are HTML)
      }
      if (xhr.status >= 200 && xhr.status < 300 && answer) resolve(answer as T);
      else reject(new ApiError(answer?.error ?? plainStatus(xhr.status, xhr.statusText), xhr.status, answer?.code));
    };
    xhr.send(body as Blob | Uint8Array<ArrayBuffer>);
  });
}

/** Upload progress: bytes sent so far, of the whole. */
export type Progress = (sent: number, total: number) => void;

/**
 * Bytes larger than this go up in parts (POST /uploads), each this size at most: a proxy in front
 * may refuse a large request outright (Cloudflare takes 100 MB at most), and parts show progress.
 */
const PART = 8 * 1024 * 1024;
/** tries for each part, when the line drops or the server is restarting */
const PART_TRIES = 4;

function megabytes(n: number): string {
  return `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;
}

/**
 * Sends a drawing's or a job's bytes for `method path`: in one request when small, else in parts
 * first and then the call itself with X-Upload-Id. Bytes larger than the server takes fail at once.
 */
export async function sendBytes(
  method: string,
  path: string,
  bytes: Uint8Array | Blob,
  what: string,
  headers: Record<string, string>,
  onProgress?: Progress,
): Promise<Response> {
  const size = bytes instanceof Blob ? bytes.size : bytes.length;
  const max = (await serverConfig())?.maxUploadBytes;
  if (max && size > max) {
    throw new ApiError(`${what} is ${megabytes(size)}, more than the ${megabytes(max)} the cloud takes`, 413, "too_large");
  }
  onProgress?.(0, size);
  if (size <= PART) {
    const res = await request(method, path, bytes, headers);
    onProgress?.(size, size);
    return res;
  }
  const { id } = await json<{ id: string }>("POST", "/uploads", undefined, { "X-Upload-Size": String(size) });
  // each part is cut from the bytes as it goes: a large drawing made into one Blob can be more than
  // the browser's store for Blobs holds (ERR_BLOB_OUT_OF_MEMORY part way through the upload)
  let sent = 0;
  while (sent < size) {
    const from = sent;
    const part = bytes instanceof Blob ? bytes.slice(from, from + PART) : bytes.subarray(from, from + PART);
    sent = await sendPart(`/uploads/${encodeURIComponent(id)}`, from, part, {}, (n) => onProgress?.(from + n, size));
    onProgress?.(sent, size);
  }
  return request(method, path, undefined, { ...headers, "X-Upload-Id": id });
}

/**
 * Sends one part at `offset` to `at` (an upload, or a report's file), telling `onSent` how much of
 * it has gone; a part lost on the way is sent again. Resolves with how much has arrived.
 */
async function sendPart(
  at: string,
  offset: number,
  part: Blob | Uint8Array,
  headers: Record<string, string> = {},
  onSent: (sent: number) => void = () => undefined,
): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    try {
      return (await sendWatched<{ size: number }>("PUT", `${at}?offset=${offset}`, part, headers, onSent)).size;
    } catch (err) {
      const again = err instanceof ApiError && (err.status === 0 || err.status >= 500 || err.status === 409);
      if (!again || attempt >= PART_TRIES) throw err;
      await new Promise((resolve) => window.setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
      // the part may have arrived though its answer didn't
      const { size } = await json<{ size: number }>("GET", at, undefined, headers);
      if (size >= offset + (part instanceof Blob ? part.size : part.length)) return size;
      if (size !== offset) throw err;
    }
  }
}

export async function json<T>(method: string, path: string, body?: Body, headers?: Record<string, string>): Promise<T> {
  return (await (await request(method, path, body, headers)).json()) as T;
}

export async function bytesOf(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer());
}

// ---- server and signed-in user ---------------------------------------------------

let config: Promise<ServerConfig | null> | null = null;

/** What the server offers, or null with no server (fetched once). */
export function serverConfig(): Promise<ServerConfig | null> {
  config ??= fetch(`${BASE}/config`, { credentials: "include" })
    .then(async (r) => (r.ok && (r.headers.get("content-type") ?? "").includes("json") ? ((await r.json()) as ServerConfig) : null))
    .catch(() => null);
  return config;
}

let user: User | null = null;
let userKnown = false;
const userListeners = new Set<(u: User | null) => void>();

/** The signed-in user as last fetched (null: signed out, or not fetched yet). */
export function currentUser(): User | null {
  return user;
}

/** Whether refreshUser() has answered at least once. */
export function userLoaded(): boolean {
  return userKnown;
}

/** Calls `fn` now and whenever the signed-in user changes; returns a function that stops it. */
export function onUser(fn: (u: User | null) => void): () => void {
  userListeners.add(fn);
  fn(user);
  return () => userListeners.delete(fn);
}

function setUser(u: User | null): void {
  user = u;
  userKnown = true;
  for (const fn of [...userListeners]) fn(u);
}

let refreshing: Promise<User | null> | null = null;

/** Fetches who is signed in (null with no server or when signed out). */
export function refreshUser(): Promise<User | null> {
  refreshing = (async () => {
    if (!(await serverConfig())) {
      setUser(null);
      return null;
    }
    try {
      setUser((await json<{ user: User | null }>("GET", "/me")).user);
    } catch {
      setUser(null);
    }
    return user;
  })();
  return refreshing;
}

/** The signed-in user once the first fetch has answered (a link opened at page load waits for it). */
export function userReady(): Promise<User | null> {
  if (userKnown) return Promise.resolve(user);
  return refreshing ?? refreshUser();
}

/** The current page, as a redirect target after signing in. */
function here(): string {
  return location.pathname + location.search;
}

export const account = {
  async rename(name: string): Promise<User> {
    const { user: u } = await json<{ user: User }>("PATCH", "/me", { name });
    setUser(u);
    return u;
  },
  async deleteAccount(): Promise<void> {
    await request("DELETE", "/me");
    setUser(null);
  },
  emailSignIn: (email: string, redirect = here()): Promise<{ ok: true }> => json("POST", "/auth/email", { email, redirect }),
  /** Where to send the browser to sign in with a provider. */
  oauthUrl: (provider: string, redirect = here()): string =>
    `${BASE}/auth/oauth/${encodeURIComponent(provider)}?redirect=${encodeURIComponent(redirect)}`,
  async logout(): Promise<void> {
    await request("POST", "/auth/logout");
    setUser(null);
  },
};

// ---- drawings ------------------------------------------------------------------

export interface Content {
  readonly bytes: Uint8Array;
  readonly versionId: string;
  /** the last live-collaboration change the version holds (0: none) */
  readonly collabSeq: number;
}

function content(res: Response, bytes: Uint8Array): Content {
  return { bytes, versionId: res.headers.get("X-Version-Id") ?? "", collabSeq: Number(res.headers.get("X-Collab-Seq") ?? 0) };
}

export const files = {
  list: async (): Promise<CloudFile[]> => (await json<{ files: CloudFile[] }>("GET", "/files")).files,
  create: async (bytes: Uint8Array, name: string, onProgress?: Progress): Promise<CloudFile> => {
    const res = await sendBytes("POST", "/files", bytes, "The drawing", { "X-File-Name": encodeURIComponent(name) }, onProgress);
    return ((await res.json()) as { file: CloudFile }).file;
  },
  get: (id: string): Promise<{ file: CloudFile; members: Member[] }> => json("GET", `/files/${id}`),
  rename: async (id: string, name: string): Promise<CloudFile> => (await json<{ file: CloudFile }>("PATCH", `/files/${id}`, { name })).file,
  remove: async (id: string): Promise<void> => void (await request("DELETE", `/files/${id}`)),
  async content(id: string, versionId?: string): Promise<Content> {
    const res = await request("GET", `/files/${id}/content${versionId ? `?version=${encodeURIComponent(versionId)}` : ""}`);
    return content(res, await bytesOf(res));
  },
  /** Saves a new version; `baseVersion` makes it fail with code "conflict" if someone saved since. */
  save: async (
    id: string,
    bytes: Uint8Array,
    opts: { baseVersion?: string; label?: string; collabSeq?: number; autosave?: "keep" | "replace"; onProgress?: Progress } = {},
  ): Promise<{ file: CloudFile; version: Version }> => {
    const headers: Record<string, string> = {};
    if (opts.baseVersion) headers["X-Base-Version"] = opts.baseVersion;
    if (opts.label) headers["X-Version-Label"] = encodeURIComponent(opts.label);
    if (opts.collabSeq !== undefined) headers["X-Collab-Seq"] = String(opts.collabSeq);
    if (opts.autosave) headers["X-Autosave"] = opts.autosave;
    const res = await sendBytes("PUT", `/files/${id}/content`, bytes, "The drawing", headers, opts.onProgress);
    return (await res.json()) as { file: CloudFile; version: Version };
  },
  versions: async (id: string): Promise<Version[]> => (await json<{ versions: Version[] }>("GET", `/files/${id}/versions`)).versions,
  restore: (id: string, versionId: string): Promise<{ file: CloudFile; version: Version }> =>
    json("POST", `/files/${id}/versions/${versionId}/restore`),
  labelVersion: async (id: string, versionId: string, label: string): Promise<Version> =>
    (await json<{ version: Version }>("PATCH", `/files/${id}/versions/${versionId}`, { label })).version,
  putThumbnail: async (id: string, png: Blob): Promise<void> => void (await request("PUT", `/files/${id}/thumbnail`, png, { "Content-Type": "image/png" })),
  thumbnailUrl: (id: string, bust = ""): string => `${BASE}/files/${id}/thumbnail${bust ? `?v=${encodeURIComponent(bust)}` : ""}`,
};

// ---- sharing ---------------------------------------------------------------------

export const sharing = {
  members: async (id: string): Promise<Member[]> => (await json<{ members: Member[] }>("GET", `/files/${id}/members`)).members,
  setRole: async (id: string, userId: string, role: Role): Promise<Member> =>
    (await json<{ member: Member }>("PATCH", `/files/${id}/members/${userId}`, { role })).member,
  removeMember: async (id: string, userId: string): Promise<void> => void (await request("DELETE", `/files/${id}/members/${userId}`)),
  invite: async (id: string, role: Exclude<Role, "owner">, email?: string): Promise<Invite> =>
    (await json<{ invite: Invite }>("POST", `/files/${id}/invites`, { role, email })).invite,
  inviteInfo: (token: string): Promise<{ fileName: string; role: Role; inviterName: string }> => json("GET", `/invites/${token}`),
  acceptInvite: async (token: string): Promise<CloudFile> => (await json<{ file: CloudFile }>("POST", `/invites/${token}/accept`)).file,
  shares: async (id: string): Promise<Share[]> => (await json<{ shares: Share[] }>("GET", `/files/${id}/shares`)).shares,
  createShare: async (id: string, allowDownload: boolean): Promise<Share> =>
    (await json<{ share: Share }>("POST", `/files/${id}/shares`, { allowDownload })).share,
  revokeShare: async (token: string): Promise<void> => void (await request("DELETE", `/shares/${token}`)),
  shared: (token: string): Promise<SharedFile> => json("GET", `/s/${token}`),
  async sharedContent(token: string): Promise<Content> {
    const res = await request("GET", `/s/${token}/content`);
    return content(res, await bytesOf(res));
  },
};

// ---- crit mode -------------------------------------------------------------------

export const comments = {
  list: async (fileId: string): Promise<Comment[]> => (await json<{ comments: Comment[] }>("GET", `/files/${fileId}/comments`)).comments,
  add: async (fileId: string, c: NewComment): Promise<Comment> => (await json<{ comment: Comment }>("POST", `/files/${fileId}/comments`, c)).comment,
  update: async (id: string, patch: { body?: string; resolved?: boolean }): Promise<Comment> =>
    (await json<{ comment: Comment }>("PATCH", `/comments/${id}`, patch)).comment,
  remove: async (id: string): Promise<void> => void (await request("DELETE", `/comments/${id}`)),
  uploadAudio: async (fileId: string, audio: Blob): Promise<string> => (await json<{ id: string }>("POST", `/files/${fileId}/audio`, audio)).id,
  audioUrl: (id: string): string => `${BASE}/audio/${id}`,
};

// ---- supporter plan and funding -------------------------------------------------

export const billing = {
  checkout: async (interval: "month" | "year"): Promise<string> => (await json<{ url: string }>("POST", "/billing/checkout", { interval })).url,
  portal: async (): Promise<string> => (await json<{ url: string }>("POST", "/billing/portal")).url,
  /** a Checkout page for an AI credit top-up of `amount` (one the server sells) */
  topUp: async (amount: number): Promise<string> => (await json<{ url: string }>("POST", "/billing/credit", { amount })).url,
  credit: (): Promise<AiCreditInfo> => json<AiCreditInfo>("GET", "/ai/credit"),
  setFunding: async (f: Funding): Promise<void> => void (await request("PUT", "/admin/funding", f)),
  setSponsor: async (s: Sponsor | null): Promise<void> => void (await request("PUT", "/admin/sponsor", s)),
  setAnnouncements: async (list: readonly Announcement[]): Promise<void> => void (await request("PUT", "/admin/announcements", list)),
};

export const renders = {
  /** Starts a cloud render of a packed job (features/render/pack.ts). */
  start: async (job: NewRenderJob, pack: Blob, onProgress?: Progress): Promise<RenderJob> => {
    const headers = { "X-Render-Job": encodeURIComponent(JSON.stringify(job)), "Content-Type": "application/octet-stream" };
    const res = await sendBytes("POST", "/render/jobs", pack, "The model", headers, onProgress);
    return ((await res.json()) as { job: RenderJob }).job;
  },
  list: async (): Promise<RenderJob[]> => (await json<{ jobs: RenderJob[] }>("GET", "/render/jobs")).jobs,
  get: async (id: string): Promise<RenderJob> => (await json<{ job: RenderJob }>("GET", `/render/jobs/${encodeURIComponent(id)}`)).job,
  /** finish keeps the picture in hand; cancel discards it */
  stop: async (id: string, mode: "finish" | "cancel"): Promise<RenderJob> =>
    (await json<{ job: RenderJob }>("POST", `/render/jobs/${encodeURIComponent(id)}/stop`, { mode })).job,
  remove: async (id: string): Promise<void> => void (await request("DELETE", `/render/jobs/${encodeURIComponent(id)}`)),
  picture: async (id: string, n: number): Promise<Blob> => (await request("GET", `/render/jobs/${encodeURIComponent(id)}/pictures/${n}`)).blob(),
};

export const feedback = {
  /** `website` is the form's hidden bot trap: people leave it empty */
  /** Sends a report; what it attaches follows with the answer's token (screenshot, file). */
  send: async (f: NewFeedback & { readonly website: string }): Promise<FeedbackSent> => json<FeedbackSent>("POST", "/feedback", f),
  screenshot: async (sent: FeedbackSent, picture: Blob): Promise<void> =>
    void (await request("PUT", `/feedback/${encodeURIComponent(sent.id)}/screenshot`, picture, { "X-Feedback-Token": sent.token ?? "" })),
  /** Sends a report's file in parts, saying how far it has got; `signal` stops it between parts. */
  async file(sent: FeedbackSent, bytes: Blob | Uint8Array, onProgress?: Progress, signal?: AbortSignal): Promise<void> {
    const at = `/feedback/${encodeURIComponent(sent.id)}/file`;
    const headers = { "X-Feedback-Token": sent.token ?? "" };
    const size = bytes instanceof Blob ? bytes.size : bytes.length;
    let done = 0;
    onProgress?.(0, size);
    while (done < size) {
      signal?.throwIfAborted();
      const from = done;
      const part = bytes instanceof Blob ? bytes.slice(from, from + PART) : bytes.subarray(from, from + PART);
      done = await sendPart(at, from, part, headers, (n) => onProgress?.(from + n, size));
      onProgress?.(done, size);
    }
  },
  /** Where an admin's browser reads a report's screenshot and file. */
  screenshotUrl: (id: string): string => `${BASE}/admin/feedback/${encodeURIComponent(id)}/screenshot`,
  fileUrl: (id: string): string => `${BASE}/admin/feedback/${encodeURIComponent(id)}/file`,
  list: async (): Promise<Feedback[]> => (await json<{ feedback: Feedback[] }>("GET", "/admin/feedback")).feedback,
  setStatus: async (id: string, status: Feedback["status"]): Promise<Feedback> =>
    (await json<{ feedback: Feedback }>("PATCH", `/admin/feedback/${encodeURIComponent(id)}`, { status })).feedback,
  remove: async (id: string): Promise<void> => void (await request("DELETE", `/admin/feedback/${encodeURIComponent(id)}`)),
};

export const errorReports = {
  /** admins: each error's group, the latest first */
  list: async (): Promise<ErrorReportGroup[]> => (await json<{ groups: ErrorReportGroup[] }>("GET", "/admin/reports")).groups,
  /** admins: the reports kept of one error, newest first */
  group: async (fingerprint: string): Promise<ErrorReport[]> =>
    (await json<{ reports: ErrorReport[] }>("GET", `/admin/reports?group=${encodeURIComponent(fingerprint)}`)).reports,
  clear: async (fingerprint: string): Promise<void> => void (await request("DELETE", `/admin/reports/${encodeURIComponent(fingerprint)}`)),
};

/** The admin page (web/src/admin): every call needs an admin's account. */
export const adminApi = {
  overview: (days: number): Promise<AdminOverview> => json<AdminOverview>("GET", `/admin/overview?days=${days}`),
  users: (q: string, filter: AdminUserFilter, sort: AdminUserSort, offset: number): Promise<{ users: AdminUser[]; total: number; page: number }> =>
    json("GET", `/admin/users?${new URLSearchParams({ q, filter, sort, offset: String(offset) }).toString()}`),
  user: (id: string): Promise<AdminUserDetail> => json<AdminUserDetail>("GET", `/admin/users/${encodeURIComponent(id)}`),
  /** gives (or, negative, takes back) AI credit; resolves with the balance after */
  grant: async (userId: string, amount: number, note: string, notify: boolean): Promise<number> =>
    (await json<{ balance: number }>("POST", "/admin/ai-credit", { userId, amount, note, notify })).balance,
  plus: (id: string, months: number): Promise<AdminUserDetail> => json<AdminUserDetail>("POST", `/admin/users/${encodeURIComponent(id)}/plus`, { months }),
  signOut: (id: string): Promise<AdminUserDetail> => json<AdminUserDetail>("POST", `/admin/users/${encodeURIComponent(id)}/sign-out`),
  suspend: (id: string, suspended: boolean): Promise<AdminUserDetail> =>
    json<AdminUserDetail>("POST", `/admin/users/${encodeURIComponent(id)}/suspend`, { suspended }),
  /** for good; `email` is the account's, typed to confirm */
  remove: async (id: string, email: string): Promise<void> => void (await request("DELETE", `/admin/users/${encodeURIComponent(id)}`, { email })),
  settings: (): Promise<AdminSettings> => json<AdminSettings>("GET", "/admin/settings"),
  saveSettings: (s: AdminSettings): Promise<AdminSettings> => json<AdminSettings>("PUT", "/admin/settings", s),
  live: (): Promise<AdminLive> => json<AdminLive>("GET", "/admin/live"),
  geo: (days: number): Promise<AdminGeo> => json<AdminGeo>("GET", `/admin/geo?days=${days}`),
  engagement: (days: number): Promise<AdminEngagement> => json<AdminEngagement>("GET", `/admin/engagement?days=${days}`),
  revenue: (days: number): Promise<AdminRevenue> => json<AdminRevenue>("GET", `/admin/revenue?days=${days}`),
  usage: (days: number): Promise<AdminUsage> => json<AdminUsage>("GET", `/admin/usage?days=${days}`),
  system: (): Promise<AdminSystem> => json<AdminSystem>("GET", "/admin/system"),
  /** the steps admins took, newest first, 50 at a time */
  log: (offset: number): Promise<{ entries: AdminLogEntry[]; total: number }> => json("GET", `/admin/log?offset=${offset}`),
};

/** The live-collaboration socket's address for a drawing. */
export function collabUrl(fileId: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${BASE}/collab/${encodeURIComponent(fileId)}`;
}
