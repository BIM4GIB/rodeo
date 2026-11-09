// The top bar's chip on a cloud drawing forked from the gallery: "Fork of <title>", its credit and
// licence on hover, and the original's gallery page on a click while it is still there.

import { h } from "../../app/dom.ts";
import { type DocumentSource, documentSource, onDocument } from "../../app/ext.ts";
import { isCloudSource } from "../../platform/cloudSource.ts";
import { galleryApi } from "./api.ts";
import { type ForkAttribution, licenceOf } from "./rules.ts";

/** A branch: two lines leaving one point, the standard fork glyph. */
const FORK_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="3" r="1.6" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="12" cy="3" r="1.6" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="4" cy="13" r="1.6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4 4.6v6.8M12 4.6c0 3.4-8 2.6-8 6.8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;

/** Each drawing's answer, asked once: where a fork came from, or null for a drawing that is not one. */
const answers = new Map<string, Promise<ForkAttribution | null>>();

/** Where a drawing came from, asked of the server once; a failed ask is asked again next time. */
function attributionOf(fileId: string): Promise<ForkAttribution | null> {
  let answer = answers.get(fileId);
  if (!answer) {
    answer = galleryApi.forkedFrom(fileId);
    answers.set(fileId, answer);
    void answer.catch(() => answers.delete(fileId));
  }
  return answer;
}

/** The chip (hidden until the open drawing is a fork); registered with registerTopBar. */
export function forkedChip(): HTMLElement {
  const label = h("span", { cls: "gallery-forked-text" });
  const chip = h("a", { cls: "gallery-forked", hidden: true, html: FORK_ICON, attrs: { "aria-label": "Forked from the gallery" } }, label);

  // the drawing that is open now, and then each one that comes to the front
  const show = (source: DocumentSource | null): void => {
    chip.hidden = true;
    if (!isCloudSource(source)) return;
    void attributionOf(source.id).then(
      (from) => {
        // a different drawing came to the front while the answer was on its way
        if (documentSource() !== source) return;
        if (!from) return;
        label.textContent = `Fork of ${from.title}`;
        chip.title = `Forked from “${from.title}” by ${from.creditName}, ${licenceOf(from.licence)?.name ?? from.licence}`;
        if (from.path) {
          chip.href = from.path;
          chip.target = "_blank";
          chip.rel = "noopener";
        } else {
          chip.removeAttribute("href");
        }
        chip.hidden = false;
      },
      (err: unknown) => {
        console.warn("openvwx: the gallery could not say where this drawing came from", err);
      },
    );
  };

  show(documentSource());
  onDocument((_session, source) => show(source));
  return chip;
}
