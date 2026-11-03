// Google Drive. Google Identity Services gives the access token (its sign-in
// window opens the first time), the Picker lets the person choose a file, and
// the Drive API downloads and saves it. The scope drive.file reaches only the
// files the person picks and the ones this app creates. The two scripts load
// once, on first use.

import { DriveError, blob, failure, send } from "./net.ts";
import type { GoogleConfig } from "./config.ts";

const GIS_SRC = "https://accounts.google.com/gsi/client";
const GAPI_SRC = "https://apis.google.com/js/api.js";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const API = "https://www.googleapis.com";
const SERVICE = "Google Drive";
const MIME = "application/octet-stream";
/** the largest body Drive takes in one simple request; larger ones go as a resumable upload */
const SIMPLE_LIMIT = 5 * 1024 * 1024;

/** A file the person picked in the Picker. */
export interface GoogleFile {
  readonly id: string;
  readonly name: string;
}

// The parts of window.google (Identity Services and Picker) and window.gapi used here.

interface TokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number | string;
  readonly error?: string;
}

interface TokenClient {
  requestAccessToken(options: { prompt: string }): void;
}

interface PickerDoc {
  readonly id: string;
  readonly name: string;
}

interface PickerData {
  readonly action: string;
  readonly docs?: readonly PickerDoc[];
}

interface DocsView {
  setIncludeFolders(on: boolean): DocsView;
}

interface PickerBuilder {
  setAppId(id: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  addView(view: DocsView): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setCallback(fn: (data: PickerData) => void): PickerBuilder;
  build(): { setVisible(on: boolean): void };
}

interface GoogleNamespace {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type?: string }) => void;
      }): TokenClient;
    };
  };
  picker: {
    PickerBuilder: new () => PickerBuilder;
    DocsView: new (viewId: string) => DocsView;
    ViewId: { DOCS: string };
    Action: { PICKED: string; CANCEL: string };
  };
}

interface GapiNamespace {
  load(api: string, callback: () => void): void;
}

const googleNs = (): GoogleNamespace => (window as unknown as { google: GoogleNamespace }).google;
const gapiNs = (): GapiNamespace => (window as unknown as { gapi: GapiNamespace }).gapi;

// ---- scripts ----------------------------------------------------------------------

const scripts = new Map<string, Promise<void>>();

/** Adds a script tag once. A failed load is forgotten, so the next use tries again. */
function loadScript(src: string): Promise<void> {
  let loaded = scripts.get(src);
  if (!loaded) {
    loaded = new Promise<void>((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => {
        el.remove();
        reject(new DriveError("Google's sign-in script could not be loaded. Check the connection or any blocker, then try again."));
      };
      document.head.append(el);
    });
    scripts.set(src, loaded);
    loaded.catch(() => scripts.delete(src));
  }
  return loaded;
}

let pickerReady: Promise<void> | null = null;

/** Loads the Picker library (api.js, then gapi's "picker" module). */
function loadPicker(): Promise<void> {
  pickerReady ??= loadScript(GAPI_SRC)
    .then(() => new Promise<void>((resolve) => gapiNs().load("picker", () => resolve())))
    .catch((err: unknown) => {
      pickerReady = null;
      throw err;
    });
  return pickerReady;
}

// ---- access token -----------------------------------------------------------------

interface Token {
  readonly value: string;
  /** when it stops being used: a minute before Google says it expires */
  readonly until: number;
}

let token: Token | null = null;
let tokenClient: TokenClient | null = null;
/** the request in progress, shared by everyone who asks while it runs */
let tokenRequest: Promise<string> | null = null;
/** settles the request in progress, from the token client's callbacks */
let settle: ((error: DriveError | null, value?: string) => void) | null = null;

function tokenFailure(type: string | undefined): DriveError {
  if (type === "popup_failed_to_open") {
    return new DriveError("The Google sign-in window was blocked. Allow pop-ups for this site, then try again.");
  }
  if (type === "popup_closed") return new DriveError("Google sign-in was closed before it finished.");
  return new DriveError("Google sign-in did not finish. Try again.");
}

async function requestToken(cfg: GoogleConfig): Promise<string> {
  await loadScript(GIS_SRC);
  const client = (tokenClient ??= googleNs().accounts.oauth2.initTokenClient({
    client_id: cfg.clientId,
    scope: SCOPE,
    callback: (response) => {
      if (response.error || !response.access_token) {
        settle?.(
          new DriveError(
            response.error === "access_denied"
              ? "Google Drive access was not allowed, so the drawing cannot be opened or saved."
              : "Google sign-in did not finish. Try again.",
          ),
        );
        return;
      }
      token = { value: response.access_token, until: Date.now() + (Number(response.expires_in ?? 3600) - 60) * 1000 };
      settle?.(null, response.access_token);
    },
    error_callback: (error) => settle?.(tokenFailure(error.type)),
  }));
  return new Promise<string>((resolve, reject) => {
    settle = (error, value) => {
      settle = null;
      if (error || value === undefined) reject(error ?? new DriveError("Google sign-in did not finish. Try again."));
      else resolve(value);
    };
    client.requestAccessToken({ prompt: "" });
  });
}

/** A current access token, from memory or a new one (Google may open its sign-in window). */
async function accessToken(cfg: GoogleConfig): Promise<string> {
  if (token && Date.now() < token.until) return token.value;
  tokenRequest ??= requestToken(cfg).finally(() => {
    tokenRequest = null;
  });
  return tokenRequest;
}

const bearer = (t: string): Record<string, string> => ({ Authorization: `Bearer ${t}` });

/**
 * Runs a request with the token. An expired token (a 401) is dropped and the request is
 * made once more with a new one; any other failure status is turned into a message.
 */
async function call(cfg: GoogleConfig, make: (bearerToken: string) => Promise<Response>): Promise<Response> {
  let res = await make(await accessToken(cfg));
  if (res.status === 401) {
    token = null;
    res = await make(await accessToken(cfg));
  }
  if (!res.ok) throw await failure(res, SERVICE);
  return res;
}

// ---- the Picker -------------------------------------------------------------------

/** Shows the Picker over the person's Drive; resolves with the file picked, or null when cancelled. */
export async function pickDrawing(cfg: GoogleConfig): Promise<GoogleFile | null> {
  const t = await accessToken(cfg);
  await loadPicker();
  const g = googleNs();
  return new Promise<GoogleFile | null>((resolve) => {
    const view = new g.picker.DocsView(g.picker.ViewId.DOCS).setIncludeFolders(true);
    const picker = new g.picker.PickerBuilder()
      .setAppId(cfg.appId)
      .setOAuthToken(t)
      .setDeveloperKey(cfg.apiKey)
      .addView(view)
      .setTitle("Open a drawing from Google Drive")
      .setCallback((data) => {
        if (data.action === g.picker.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve(doc ? { id: doc.id, name: doc.name } : null);
        } else if (data.action === g.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

// ---- files ------------------------------------------------------------------------

/** The bytes of a Drive file. */
export async function download(cfg: GoogleConfig, id: string): Promise<Uint8Array> {
  const res = await call(cfg, (t) => send(`${API}/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers: bearer(t) }, SERVICE));
  return new Uint8Array(await res.arrayBuffer());
}

/** Writes the drawing over a Drive file (any size). */
export async function saveBack(cfg: GoogleConfig, id: string, bytes: Uint8Array): Promise<void> {
  await upload(cfg, bytes, { id });
}

/** Creates a new drawing with this name in My Drive. */
export function createDrawing(cfg: GoogleConfig, name: string, bytes: Uint8Array): Promise<GoogleFile> {
  return upload(cfg, bytes, { name });
}

type Target = { readonly id: string } | { readonly name: string };

function multipart(metadata: object, bytes: Uint8Array): { type: string; body: Blob } {
  const boundary = `openvwx${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${MIME}\r\n\r\n`,
    bytes as Uint8Array<ArrayBuffer>,
    `\r\n--${boundary}--`,
  ]);
  return { type: `multipart/related; boundary=${boundary}`, body };
}

/**
 * Writes the drawing to a file: a new one (multipart, or resumable when large) or an existing
 * one (media, or resumable when large). A resumable upload is started, then sent in one piece.
 */
async function upload(cfg: GoogleConfig, bytes: Uint8Array, target: Target): Promise<GoogleFile> {
  const id = "id" in target ? target.id : undefined;
  const name = "name" in target ? target.name : undefined;
  const method = id === undefined ? "POST" : "PATCH";
  const path = `/upload/drive/v3/files${id === undefined ? "" : `/${encodeURIComponent(id)}`}`;
  const fields = "fields=id,name";

  if (bytes.length <= SIMPLE_LIMIT) {
    const part = name !== undefined ? multipart({ name, mimeType: MIME }, bytes) : { type: MIME, body: blob(bytes) };
    const url = `${API}${path}?uploadType=${name !== undefined ? "multipart" : "media"}&${fields}`;
    const res = await call(cfg, (t) =>
      send(url, { method, headers: { ...bearer(t), "Content-Type": part.type }, body: part.body }, SERVICE),
    );
    return (await res.json()) as GoogleFile;
  }

  const metadata = name !== undefined ? { name, mimeType: MIME } : {};
  const start = `${API}${path}?uploadType=resumable&${fields}`;
  const res = await call(cfg, (t) =>
    send(
      start,
      {
        method,
        headers: { ...bearer(t), "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": MIME },
        body: JSON.stringify(metadata),
      },
      SERVICE,
    ),
  );
  const session = res.headers.get("Location");
  if (!session) throw new DriveError("Google Drive did not start the upload. Try again.");
  const done = await send(session, { method: "PUT", headers: { "Content-Type": MIME }, body: blob(bytes) }, SERVICE);
  if (!done.ok) throw await failure(done, SERVICE);
  return (await done.json()) as GoogleFile;
}
