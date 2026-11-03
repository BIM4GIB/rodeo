// Stage > Lighting Paperwork > Focus Cards…: a card per lighting instrument for the focus call, in a window to
// sort and check, printed six to a page (A4 for metric drawings, Letter for feet and inches), or exported as an
// HTML file for the crew. The window and the printed sheet are the same markup (focusCardHtml.ts).

import cardCss from "./focusCards.css?raw";
import "./focusCards.css";
import { h } from "../../../app/dom.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { fixtures } from "../instrument.ts";
import { lengthText, stageFrame } from "../stageTool.ts";
import { downloadText, noteLine, openPanel } from "../ui.ts";
import { cardOf, sortCards, type CardOrder, type FocusCard } from "./focusCards.ts";
import { gridHtml, sheetDocument, type Paper } from "./focusCardHtml.ts";
import { printDocument, segmented } from "./controls.ts";

const KEY = "docs-focus-cards";
let order: CardOrder = "position";
/** the window open now, with what redraws it */
let mounted: { readonly draw: () => void; readonly element: HTMLElement } | null = null;

/** A (A4) for metric units, Letter for feet and inches, as the drawing is printed. */
function paperOf(): Paper {
  return /ft|feet|inch|"|'/i.test(store.session?.doc.info.units ?? "") ? "Letter" : "A4";
}

/** Every instrument's card, in the order chosen. */
function cardsNow(): FocusCard[] {
  const frame = stageFrame();
  return sortCards(
    fixtures().map((f) => cardOf(f, frame, lengthText)),
    order,
  );
}

/** Opens the window of cards, or brings it forward with the drawing read again. */
export function openFocusCards(): void {
  if (!store.session) return;
  if (mounted?.element.isConnected) {
    mounted.draw();
    document.body.append(mounted.element);
    return;
  }
  if (fixtures().length === 0) {
    toast("This drawing has no lighting instruments to make cards for.", "info");
    return;
  }
  const paper = paperOf();
  const count = h("div", { cls: "th-toolbar" });
  const shown = h("div", { cls: `docs-cards-scroll docs-paper-${paper}` });
  const draw = (): void => {
    const cards = cardsNow();
    const unfocused = cards.filter((c) => !c.focused).length;
    const plural = cards.length === 1 ? "card" : "cards";
    count.replaceChildren(
      noteLine(`${cards.length} ${plural}${unfocused ? `, ${unfocused} not focused yet` : ""}`, unfocused ? "th-warn" : undefined),
      h("span", { cls: "th-spacer" }),
      segmented<CardOrder>(
        [
          { value: "position", label: "By Position" },
          { value: "channel", label: "By Channel" },
        ],
        order,
        (v) => {
          order = v;
          draw();
        },
      ),
    );
    shown.innerHTML = gridHtml(cards);
  };
  const body = h("div", { cls: "docs-cards-body" }, count, shown);
  const panel = openPanel({
    key: KEY,
    title: "Focus Cards",
    body,
    width: 960,
    height: 660,
    actions: [
      {
        label: "Export HTML",
        run: () => downloadText("Focus Cards.html", sheetDocument(cardsNow(), paper, cardCss), "text/html"),
      },
      {
        label: "Print",
        primary: true,
        run: () => printDocument(sheetDocument(cardsNow(), paper, cardCss)),
      },
    ],
    onClose: () => {
      mounted = null;
    },
  });
  mounted = { draw, element: panel.element };
  draw();
}
