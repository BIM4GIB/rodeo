// OneDrive, through Microsoft Graph. MSAL (@azure/msal-browser) signs the person
// in with a pop-up the first time and then renews the token silently. The
// calls below read folders and drawings, download them, and save them back,
// in one request when small and through an upload session when large.

import type { AccountInfo, AuthenticationResult, IPublicClientApplication } from "@azure/msal-browser";
import { DriveError, blob, failure, send } from "./net.ts";

// the MSAL library is loaded on first use, so the editor's start-up does not carry it
const msalLibrary = (): Promise<typeof import("@azure/msal-browser")> => import("@azure/msal-browser");

const GRAPH = "https://graph.microsoft.com/v1.0";
const SERVICE = "OneDrive";
const SCOPES = ["Files.ReadWrite"];
const OCTET = { "Content-Type": "application/octet-stream" };
const JSON_HEADERS = { "Content-Type": "application/json" };
/** the largest file one PUT takes; larger ones go through an upload session */
const SIMPLE_LIMIT = 4 * 1024 * 1024;
/** one chunk of an upload session: a multiple of 320 KiB, as Graph asks */
const CHUNK = 10 * 1024 * 1024;
/** pages of a folder or search read at most: 200 items each */
const MAX_PAGES = 25;
const SELECT = "id,name,size,lastModifiedDateTime,folder,file,parentReference";

/** An item in the person's OneDrive: a folder or a file. */
export interface OneDriveItem {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  /** ISO time, or "" */
  readonly modified: string;
  readonly folder: boolean;
  /** the folder it is in, as "/Folder/Sub" ("" in the root), for search results */
  readonly location: string;
}

interface RawItem {
  readonly id: string;
  readonly name: string;
  readonly size?: number;
  readonly lastModifiedDateTime?: string;
  readonly folder?: unknown;
  readonly parentReference?: { readonly path?: string };
}

function toItem(raw: RawItem): OneDriveItem {
  return {
    id: raw.id,
    name: raw.name,
    size: raw.size ?? 0,
    modified: raw.lastModifiedDateTime ?? "",
    folder: raw.folder !== undefined,
    location: (raw.parentReference?.path ?? "").replace(/^.*root:/, ""),
  };
}

// ---- sign-in ----------------------------------------------------------------------

let instance: Promise<IPublicClientApplication> | null = null;

/** The MSAL client, made and initialised once. */
function msal(clientId: string): Promise<IPublicClientApplication> {
  instance ??= (async () => {
    const { PublicClientApplication } = await msalLibrary();
    const app = new PublicClientApplication({
      auth: {
        clientId,
        authority: "https://login.microsoftonline.com/common",
        redirectUri: `${location.origin}/`,
      },
      cache: { cacheLocation: "sessionStorage" },
    });
    await app.initialize();
    return app;
  })().catch((err: unknown) => {
    instance = null;
    throw err;
  });
  return instance;
}

/** What a failed sign-in means to the person. */
function signInFailure(err: unknown): DriveError {
  const code = typeof err === "object" && err !== null && "errorCode" in err ? String(err.errorCode) : "";
  const text = err instanceof Error ? err.message : String(err);
  if (code === "popup_window_error" || code === "empty_window_error" || code === "block_nested_popups") {
    return new DriveError("The Microsoft sign-in window was blocked. Allow pop-ups for this site, then try again.");
  }
  if (code === "user_cancelled") return new DriveError("Microsoft sign-in was cancelled.");
  if (/AADSTS65004|access_denied/i.test(`${code} ${text}`)) {
    return new DriveError("OneDrive access was not allowed, so the drawing cannot be opened or saved.");
  }
  return new DriveError("Microsoft sign-in did not finish. Try again.");
}

async function interactive(app: IPublicClientApplication, account?: AccountInfo): Promise<AuthenticationResult> {
  try {
    const result = account
      ? await app.acquireTokenPopup({ scopes: SCOPES, account })
      : await app.loginPopup({ scopes: SCOPES, prompt: "select_account" });
    app.setActiveAccount(result.account);
    return result;
  } catch (err) {
    throw signInFailure(err);
  }
}

/** A Graph token: the signed-in account's, renewed silently, or from a sign-in window when it cannot be. */
async function graphToken(clientId: string, forceRefresh = false): Promise<string> {
  const app = await msal(clientId);
  const account = app.getActiveAccount() ?? app.getAllAccounts()[0];
  if (!account) return (await interactive(app)).accessToken;
  app.setActiveAccount(account);
  try {
    return (await app.acquireTokenSilent({ scopes: SCOPES, account, forceRefresh })).accessToken;
  } catch (err) {
    const { BrowserAuthError, InteractionRequiredAuthError } = await msalLibrary();
    if (err instanceof InteractionRequiredAuthError || err instanceof BrowserAuthError) {
      return (await interactive(app, account)).accessToken;
    }
    throw signInFailure(err);
  }
}

/** Signs the person in to OneDrive now (a sign-in window the first time), so later calls run silently. */
export async function signInOneDrive(clientId: string): Promise<void> {
  await graphToken(clientId);
}

// ---- Graph ------------------------------------------------------------------------

interface GraphInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: BodyInit;
}

/** A Graph request with the token, without checking the answer. An expired token is renewed once. */
async function graphRaw(clientId: string, url: string, init: GraphInit = {}): Promise<Response> {
  const attempt = async (forceRefresh: boolean): Promise<Response> => {
    const t = await graphToken(clientId, forceRefresh);
    return send(url, { method: init.method, headers: { ...init.headers, Authorization: `Bearer ${t}` }, body: init.body }, SERVICE);
  };
  let res = await attempt(false);
  if (res.status === 401) res = await attempt(true);
  return res;
}

async function graph(clientId: string, url: string, init?: GraphInit): Promise<Response> {
  const res = await graphRaw(clientId, url, init);
  if (!res.ok) throw await failure(res, SERVICE);
  return res;
}

/** The items of a Graph list, every page of it. */
async function pages(clientId: string, first: string): Promise<OneDriveItem[]> {
  const out: OneDriveItem[] = [];
  let url: string | null = first;
  for (let n = 0; url !== null && n < MAX_PAGES; n++) {
    const body = (await (await graph(clientId, url)).json()) as { value: RawItem[]; "@odata.nextLink"?: string };
    out.push(...body.value.map(toItem));
    url = body["@odata.nextLink"] ?? null;
  }
  return out;
}

/** The id of the root folder of the person's OneDrive. */
export async function rootId(clientId: string): Promise<string> {
  const body = (await (await graph(clientId, `${GRAPH}/me/drive/root?$select=id`)).json()) as { id: string };
  return body.id;
}

/** The folders and files in a folder. */
export function listFolder(clientId: string, folderId: string): Promise<OneDriveItem[]> {
  return pages(clientId, `${GRAPH}/me/drive/items/${encodeURIComponent(folderId)}/children?$select=${SELECT}&$top=200`);
}

/** Items whose name or content matches the text, across the whole OneDrive. */
export function searchOneDrive(clientId: string, text: string): Promise<OneDriveItem[]> {
  // a search term is in single quotes, with each quote in it doubled
  const term = encodeURIComponent(text.replace(/'/g, "''"));
  return pages(clientId, `${GRAPH}/me/drive/root/search(q='${term}')?$select=${SELECT}&$top=200`);
}

/** The bytes of a file. */
export async function download(clientId: string, id: string): Promise<Uint8Array> {
  const res = await graph(clientId, `${GRAPH}/me/drive/items/${encodeURIComponent(id)}/content`);
  return new Uint8Array(await res.arrayBuffer());
}

/** The item called `name` in a folder, or null when there is none. */
export async function findInFolder(clientId: string, folderId: string, name: string): Promise<OneDriveItem | null> {
  const res = await graphRaw(
    clientId,
    `${GRAPH}/me/drive/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(name)}?$select=${SELECT}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw await failure(res, SERVICE);
  return toItem((await res.json()) as RawItem);
}

/** Saves the drawing over a file (any size). */
export async function saveBack(clientId: string, id: string, bytes: Uint8Array): Promise<void> {
  const item = `${GRAPH}/me/drive/items/${encodeURIComponent(id)}`;
  if (bytes.length <= SIMPLE_LIMIT) {
    await graph(clientId, `${item}/content`, { method: "PUT", headers: OCTET, body: blob(bytes) });
    return;
  }
  await uploadSession(clientId, `${item}/createUploadSession`, bytes);
}

/** Creates a file called `name` in a folder (replacing one of that name), of any size. */
export async function createIn(clientId: string, folderId: string, name: string, bytes: Uint8Array): Promise<OneDriveItem> {
  const item = `${GRAPH}/me/drive/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(name)}:`;
  if (bytes.length <= SIMPLE_LIMIT) {
    const res = await graph(clientId, `${item}/content`, { method: "PUT", headers: OCTET, body: blob(bytes) });
    return toItem((await res.json()) as RawItem);
  }
  return uploadSession(clientId, `${item}/createUploadSession`, bytes);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** One chunk of an upload session, retried a few times when the network or the service hiccups. */
async function putChunk(uploadUrl: string, part: Uint8Array, start: number, end: number, total: number): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Range": `bytes ${start}-${end}/${total}` },
        body: blob(part),
      });
    } catch {
      if (attempt >= 3) throw new DriveError(`Could not reach ${SERVICE}. Check the connection and try again.`);
      await wait(1000 * attempt);
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await wait(1000 * attempt);
      continue;
    }
    return res;
  }
}

/** Sends a large file through an upload session, in chunks; the session is cancelled if a chunk fails. */
async function uploadSession(clientId: string, createUrl: string, bytes: Uint8Array): Promise<OneDriveItem> {
  const body = {
    item: { "@microsoft.graph.conflictBehavior": "replace" },
  };
  const session = (await (
    await graph(clientId, createUrl, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) })
  ).json()) as { uploadUrl: string };
  try {
    for (let start = 0; start < bytes.length; start += CHUNK) {
      const end = Math.min(start + CHUNK, bytes.length);
      const res = await putChunk(session.uploadUrl, bytes.subarray(start, end), start, end - 1, bytes.length);
      if (res.status === 200 || res.status === 201) return toItem((await res.json()) as RawItem);
      if (res.status !== 202) throw await failure(res, SERVICE);
    }
  } catch (err) {
    void fetch(session.uploadUrl, { method: "DELETE" }).catch(() => undefined);
    throw err;
  }
  throw new DriveError(`${SERVICE} did not confirm the upload. Try again.`);
}
