// Links that open a drawing when the page loads: ?file=<id> (a cloud drawing),
// ?invite=<token> (an invitation to one), ?share=<token> (a public view-only link) and
// ?embed=<token> (the same, framed in another page). Each drops its parameter from the
// address bar once it has run, so a reload does not repeat it. ?layer=<id> makes that
// layer active once a drawing has opened from one of these links.

import { setActiveLayer } from "../../app/commands.ts";
import { h } from "../../app/dom.ts";
import { type AppContext, type DocumentSource, documentSource, registerUrlHandler } from "../../app/ext.ts";
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
  void openShared(token, params, ctx, false);
});

registerUrlHandler("embed", (token, params, ctx) => {
  void openShared(token, params, ctx, true);
});

/** Opens a shared drawing view only. An embed also loses the editor's chrome (embed.css). */
async function openShared(token: string, params: URLSearchParams, ctx: AppContext, embed: boolean): Promise<void> {
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
    if (embed) showEmbedLink(token);
    else showBanner(info, content.bytes);
  } finally {
    dropParams(embed ? "embed" : "share", "layer");
  }
}

/** The bar above a shared drawing: view only, who shared it, and Download when the owner allows it. */
function showBanner(info: SharedFile, bytes: Uint8Array): void {
  const bar = h("div", { cls: "share-banner", attrs: { role: "status" } }, h("span", { text: `View only · shared by ${info.ownerName}` }));
  if (info.allowDownload) {
    const download = h("button", { cls: "btn small", text: "Download", attrs: { type: "button" } });
    download.addEventListener("click", () => {
      downloadBlob(withVwx(info.fileName), new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }));
    });
    bar.append(download);
  }
  (document.querySelector(".app") ?? document.body).prepend(bar);
}

/** An embed's "Open in openvwx" link: the same drawing in the editor, in a new tab. */
function showEmbedLink(token: string): void {
  document.body.classList.add("embed");
  const url = new URL(location.href);
  url.search = `?share=${encodeURIComponent(token)}`;
  url.hash = "";
  document.body.append(h("a", { cls: "embed-link", text: "Open in Rodeo", attrs: { href: url.href, target: "_blank", rel: "noopener" } }));
}
