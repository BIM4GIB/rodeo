// Public files opened by address. The visitor's own browser fetches the file, never the Rodeo
// server (remote.ts says why), and the bytes open as a drawing: ?url= in the editor asks first and
// opens it on this computer, and an embed shows it view only (viewer.ts). Other formats open as a
// drop does, through the editor's own openFile.

import { type AppContext, type DocumentSource, documentSource } from "../../app/ext.ts";
import { showLoading } from "../../app/loading.ts";
import { confirmDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { type FileLink, fetchPublicFile, normalizeFileUrl } from "./remote.ts";

/** Whether this page runs on a development host (localhost), where local file addresses are allowed. */
export function isLocalHost(): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
}

/** A byte count in megabytes, to one decimal place, for the progress text. */
function mb(n: number): string {
  return (n / 1048576).toFixed(1);
}

/** An AbortError from a cancelled fetch: the user asked for it, so it is not a failure to report. */
function isAbort(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

/** Fetches a public file, telling `progress` how far it has got ("Fetching house.vwx… 3.2 of 12.0 MB"). */
export async function fetchLinked(
  link: FileLink,
  progress: (text: string, fraction: number | null) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  progress(`Fetching ${link.name}…`, null);
  return fetchPublicFile(
    link,
    (got, total) => {
      if (total) progress(`Fetching ${link.name}… ${mb(got)} of ${mb(total)} MB`, got / total);
      else progress(`Fetching ${link.name}… ${mb(got)} MB`, null);
    },
    signal,
  );
}

/**
 * Opens bytes as a drawing in any format Rodeo reads. A .vwx or .sta opens with `source` (view only
 * in an embed); other formats open as a drop does. In an embed that is a drawing of its own that
 * nothing saves, which a model, DWG or Revit file makes by itself; a format that only imports into a
 * drawing already open (DXF, PDF) has none to go into there. False when it couldn't.
 */
export async function openAny(ctx: AppContext, bytes: Uint8Array, name: string, source: DocumentSource | null): Promise<boolean> {
  if (/\.(vwx|sta)$/i.test(name)) {
    await ctx.openDocument(bytes, name, source ? { source } : undefined);
    return source ? documentSource() === source : true;
  }
  await ctx.openFile(new File([bytes as Uint8Array<ArrayBuffer>], name));
  return source ? store.session !== null : true;
}

/** Removes parameters from the address bar, keeping the rest (as cloud/urls.ts does). */
function dropParams(...names: string[]): void {
  const url = new URL(location.href);
  for (const name of names) url.searchParams.delete(name);
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/** ?url= in the editor: asks, fetches with the loading bar, opens the file as a drawing on this computer, and drops ?url from the address. */
export async function openFromLink(address: string, ctx: AppContext): Promise<void> {
  try {
    const link = normalizeFileUrl(address, isLocalHost());
    if ("error" in link) {
      toast(link.error);
      return;
    }
    const ok = await confirmDialog("Open from the Web", `Open “${link.name}” from ${link.host}? It opens here as a drawing on this computer.`, "Open");
    if (!ok) return;
    const abort = new AbortController();
    const done = showLoading(`Fetching ${link.name}…`, () => abort.abort());
    let bytes: Uint8Array;
    try {
      bytes = await fetchLinked(
        link,
        (text, fraction) => {
          done.label(text);
          done.progress(fraction);
        },
        abort.signal,
      );
    } finally {
      done();
    }
    if (!(await openAny(ctx, bytes, link.name, null))) toast("Rodeo can't open this kind of file from a link yet.");
  } catch (err) {
    if (!isAbort(err)) toast(`Could not open the file: ${errorMessage(err)}`);
  } finally {
    dropParams("url");
  }
}
