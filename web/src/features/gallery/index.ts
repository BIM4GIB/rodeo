// The gallery in the editor: File › Publish to Gallery… and File › Browse the Gallery, a Gallery link
// in the start hub's footer, the top bar's chip on a drawing forked from the gallery, and the note
// after a fork opens (?forked=1). The gallery's own page is page/, a separate entry (gallery.html).

import "./gallery.css";
import { h } from "../../app/dom.ts";
import { documentSource, registerMenu, registerTopBar, registerUrlHandler, registerWelcome } from "../../app/ext.ts";
import { confirmDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import { serverConfig } from "../../platform/api.ts";
import { isCloudSource } from "../../platform/cloudSource.ts";
import { cloudOffered, saveDrawingToCloud } from "../cloud/cloud.ts";
import { forkedChip } from "./forked.ts";
import { openPublishDialog } from "./publish.ts";

registerMenu(
  "File",
  () =>
    cloudOffered()
      ? [
          { label: "Publish to Gallery…", enabled: () => store.session !== null, run: () => void publishFront() },
          { label: "Browse the Gallery", run: () => void window.open("/gallery", "_blank", "noopener") },
        ]
      : [],
  { after: "Share…" },
);

registerTopBar(forkedChip, "right");
registerWelcome(galleryLink, "foot");

registerUrlHandler("forked", () => {
  toast("This copy is yours to change. The original stays as it was.", "info");
  dropParams("forked");
});

/** File › Publish to Gallery…: the drawing in front, saved to the cloud first when it is not there yet. */
async function publishFront(): Promise<void> {
  const source = documentSource();
  if (isCloudSource(source)) {
    openPublishDialog(source.id);
    return;
  }
  const save = await confirmDialog(
    "Publish to Gallery",
    "Drawings go into the gallery from the cloud. Save this one to the cloud first?",
    "Save to Cloud",
  );
  if (!save) return;
  await saveDrawingToCloud();
  // the drawing is in the cloud now only if the save went through
  const saved = documentSource();
  if (isCloudSource(saved)) openPublishDialog(saved.id);
}

/** The start hub's footer link to the gallery, shown once the server offers it. */
function galleryLink(): HTMLElement {
  const link = h("a", { cls: "hub-link", text: "Gallery", hidden: true, attrs: { href: "/gallery", target: "_blank", rel: "noopener" } });
  void serverConfig().then((cfg) => {
    link.hidden = cfg === null;
  });
  return link;
}

/** Removes parameters from the address bar, keeping the rest (as the cloud's links do). */
function dropParams(...names: string[]): void {
  const url = new URL(location.href);
  for (const name of names) url.searchParams.delete(name);
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
