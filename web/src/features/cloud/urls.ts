// Links that open a drawing when the page loads: ?file=<id> (a cloud drawing),
// ?invite=<token> (an invitation to one) and ?share=<token> (a public view-only link; ?embed= is
// the embed feature's). Each drops its parameter from the
// address bar once it has run, so a reload does not repeat it. ?layer=<id> makes that
// layer active once a drawing has opened from one of these links.

import { setActiveLayer } from "../../app/commands.ts";
import { h } from "../../app/dom.ts";
import { type AppContext, type DocumentSource, documentSource, onDocument, registerUrlHandler } from "../../app/ext.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { confirmDialog } from "../../app/menubar.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { serverConfig, sharing } from "../../platform/api.ts";
import type { Role, SharedFile } from "../../platform/protocol.ts";
import { requireSignIn } from "../account/signin.ts";
import { cloudCall, openCloudFile, withVwx } from "./cloud.ts";
import "./embed.css";

/** How an invitation names its role in the dialog's sentence. */
const ROLE_WORD: Record<Role, string> = { owner: "own", editor: "edit", reviewer: "review", viewer: "view" };

/** Removes parameters from the address bar, keeping the rest. */
function dropParams(...names: string[]): void {
  const url = new URL(location.href);
  for (const name of names) url.searchParams.delete(name);
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Makes the layer named by ?layer= active, once a drawing has opened. */
function applyLayer(params: URLSearchParams, ctx: AppContext): void {
  const id = params.get("layer");
  if (id && ctx.scene.layer(id)) setActiveLayer(id);
}

registerUrlHandler("file", (id, params, ctx) => {
  void (async () => {
    if (!(await serverConfig())) return;
    try {
      if ((await requireSignIn("Sign in to open this drawing.")) && (await openCloudFile(id))) applyLayer(params, ctx);
    } finally {
      dropParams("file", "layer");
    }
  })();
});

registerUrlHandler("invite", (token) => {
  void (async () => {
    if (!(await serverConfig())) return;
    try {
      const info = await sharing.inviteInfo(token);
      const accept = await confirmDialog(
        "Invitation",
        `${info.inviterName} invited you to ${ROLE_WORD[info.role]} “${info.fileName}”.`,
        "Accept",
      );
      if (accept && (await requireSignIn("Sign in to accept this invitation."))) {
        const file = await sharing.acceptInvite(token);
        await openCloudFile(file.id);
      }
    } catch (err) {
      toast(`Could not accept the invitation: ${errorMessage(err)}`);
    } finally {
      dropParams("invite");
    }
  })();
});

registerUrlHandler("share", (token, params, ctx) => {
  void openShared(token, params, ctx);
});

/** Opens a shared drawing view only, under a bar saying so. */
async function openShared(token: string, params: URLSearchParams, ctx: AppContext): Promise<void> {
  if (!(await serverConfig())) return;
  try {
    const shared = await cloudCall("Opening the shared drawing…", "Open", () =>
      Promise.all([sharing.shared(token), sharing.sharedContent(token)]),
    );
    if (!shared) return;
    const [info, content] = shared;
    const source: DocumentSource = { kind: "share", label: "Shared", readOnly: true };
    await ctx.openDocument(content.bytes, info.fileName, { source });
    // the open was refused (unsaved changes were kept): nothing of the link is shown
    if (documentSource() !== source) return;
    applyLayer(params, ctx);
    showBanner(info, content.bytes, source, ctx);
  } finally {
    dropParams("share", "layer");
  }
}

/** The bar over the shared drawing and the drawing it belongs to; it shows only while that drawing is in front. */
let banner: { readonly bar: HTMLElement; readonly source: DocumentSource } | null = null;

onDocument((_session, source) => {
  if (banner) banner.bar.hidden = source !== banner.source;
});

/** The bar above a shared drawing: view only, who shared it, and Edit a Copy and Download when the owner allows it. */
function showBanner(info: SharedFile, bytes: Uint8Array, source: DocumentSource, ctx: AppContext): void {
  banner?.bar.remove();
  const bar = h("div", { cls: "share-banner", attrs: { role: "status" } }, h("span", { text: `View only · shared by ${info.ownerName}` }));
  banner = { bar, source };
  if (info.allowDownload) {
    const copy = h("button", { cls: "btn small", text: "Edit a Copy", attrs: { type: "button" } });
    copy.addEventListener("click", () => {
      // a copy of the bytes: opening may hand them to a worker
      void ctx.openDocument(bytes.slice(), `Copy of ${withVwx(info.fileName)}`);
    });
    const download = h("button", { cls: "btn small", text: "Download", attrs: { type: "button" } });
    download.addEventListener("click", () => {
      downloadBlob(withVwx(info.fileName), new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }));
    });
    bar.append(h("span", { cls: "share-banner-actions" }, copy, download));
  }
  (document.querySelector(".app") ?? document.body).prepend(bar);
}
