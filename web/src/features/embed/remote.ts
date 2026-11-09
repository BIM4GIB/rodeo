// Public files opened by address (?url=). The address is checked and a GitHub file page is rewritten
// to its raw file, then the file is fetched by the visitor's own browser, never by the Rodeo server,
// so the server cannot be pointed at other hosts. Only fetch is used, so the check runs in node.

/** The largest public file that opens from a link, counted as its bytes arrive. */
export const MAX_REMOTE_BYTES = 300 * 1048576;

/** A public file's address, ready to fetch, and the name it opens under. */
export interface FileLink {
  readonly url: string;
  readonly name: string;
  readonly host: string;
}

/** The messages a public-file link can fail with, word for word. */
export const REMOTE_MESSAGES = {
  notUrl: "That isn't a web address.",
  notHttps: "Only https:// addresses can be opened.",
  credentials: "The address can't carry a user name or password.",
  local: "Rodeo opens files from public websites only.",
  noName: "The address must end in the file's name, such as house.vwx.",
  blocked:
    "Rodeo couldn't fetch that file. The website has to allow it (CORS), as raw files on GitHub do. You can download it and drop it on Rodeo instead.",
  tooLarge: "That file is larger than 300 MB, too large to open from a link.",
  empty: "That file is empty.",
} as const;

/** Name endings that only ever point at a machine on a private network. */
const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];
/** An IPv4 address written out in full. */
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/** The hosts a development server answers on; plain http is allowed for these only when local addresses are. */
const DEV_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** True for a name or address that is only reachable on the machine or a private network. */
function isLocalHost(host: string): boolean {
  return host === "localhost" || LOCAL_SUFFIXES.some((s) => host.endsWith(s)) || IPV4.test(host) || host.startsWith("[");
}

/** A GitHub file page (blob or raw) becomes the raw address its file is served from; null for any other address. */
function rawGithub(url: URL): URL | null {
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
  // the path segments stay percent-encoded, so they are joined as they are
  const [owner, repo, kind, ref, ...rest] = url.pathname.split("/").filter(Boolean);
  if (!owner || !repo || (kind !== "blob" && kind !== "raw") || !ref || rest.length === 0) return null;
  return new URL(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${rest.join("/")}`);
}

/** The file's name: the last part of its address, decoded and cleaned of characters a file name can't hold. */
function nameOf(url: URL): string {
  const parts = url.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  let name: string;
  try {
    name = decodeURIComponent(last);
  } catch {
    name = last;
  }
  return name.replace(/[\u0000-\u001f\u007f/\\]/g, "");
}

/** A public file's address made ready to fetch (a GitHub page becomes its raw file), or why it can't be. */
export function normalizeFileUrl(raw: string, allowLocal: boolean): FileLink | { readonly error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { error: REMOTE_MESSAGES.notUrl };
  }
  if (url.username || url.password) return { error: REMOTE_MESSAGES.credentials };
  if (!allowLocal && isLocalHost(url.hostname)) return { error: REMOTE_MESSAGES.local };
  const devHttp = allowLocal && url.protocol === "http:" && DEV_HOSTS.includes(url.hostname);
  if (url.protocol !== "https:" && !devHttp) return { error: REMOTE_MESSAGES.notHttps };
  const final = rawGithub(url) ?? url;
  const name = nameOf(final);
  if (!/\.[A-Za-z0-9]{1,8}$/.test(name)) return { error: REMOTE_MESSAGES.noName };
  return { url: final.href, name, host: final.hostname };
}

/** An AbortError from a cancelled fetch, which the caller asked for and so is not a failure of the file. */
function isAbort(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

/** Fetches a public file from the visitor's browser, without cookies, at most MAX_REMOTE_BYTES. */
export async function fetchPublicFile(
  link: FileLink,
  onProgress: (got: number, total: number | null) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(link.url, {
      mode: "cors",
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal,
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    // the browser reports a CORS refusal only as a failed fetch, so the message names CORS
    throw new Error(REMOTE_MESSAGES.blocked);
  }
  if (!res.ok) throw new Error(`That file couldn't be fetched (HTTP ${res.status}).`);
  return readCapped(res, MAX_REMOTE_BYTES, onProgress);
}

/** A response's body, refusing more than `max` bytes as it streams. */
export async function readCapped(
  res: Response,
  max: number,
  onProgress: (got: number, total: number | null) => void,
): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length")) || null;
  // a declared size over the cap is refused before a byte is read
  if (declared !== null && declared > max) throw new Error(REMOTE_MESSAGES.tooLarge);
  // A server may compress the file (gzip): the declared size is then the compressed one, which the
  // decoded bytes counted here pass, so the total is unknown from that point on.
  const totalFor = (got: number): number | null => (declared !== null && got <= declared ? declared : null);
  if (!res.body) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > max) throw new Error(REMOTE_MESSAGES.tooLarge);
    if (bytes.length === 0) throw new Error(REMOTE_MESSAGES.empty);
    onProgress(bytes.length, totalFor(bytes.length));
    return bytes;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    // a file that grows past the cap while it streams stops here, since the declared size can lie
    if (got > max) {
      await reader.cancel();
      throw new Error(REMOTE_MESSAGES.tooLarge);
    }
    chunks.push(value);
    onProgress(got, totalFor(got));
  }
  if (got === 0) throw new Error(REMOTE_MESSAGES.empty);
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
