// Palette sections that fold, as Vectorworks' Object Info groups do: a click on a section's heading
// (or Enter or Space on it) folds it to the heading alone or opens it again, Option with it folds or
// opens every section of the palette alike. Which are folded is kept by palette and title in this
// browser, so a section stays folded as the selection changes and the palette is drawn again.

import "./sections.css";
import { h } from "../dom.ts";

const STORAGE_KEY = "openvwx.sectionFolds";

const folded = load();

function load(): Set<string> {
  try {
    const kept = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(kept) ? kept.filter((k): k is string => typeof k === "string") : []);
  } catch {
    // no storage, or nothing kept: every section open
    return new Set();
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...folded]));
  } catch {
    // kept for this visit only
  }
}

/** Folds or opens `section`, its heading saying which. */
function show(section: HTMLElement, fold: boolean): void {
  section.classList.toggle("folded", fold);
  section.querySelector(":scope > h3")?.setAttribute("aria-expanded", String(!fold));
  const key = section.dataset.foldKey;
  if (!key) return;
  if (fold) folded.add(key);
  else folded.delete(key);
}

/** A section of `palette` under the heading `title`, folded as it was last left. */
export function foldingSection(palette: string, title: string, ...children: Node[]): HTMLElement {
  const head = h("h3", { text: title, attrs: { role: "button", tabindex: "0", title: "Fold or open (Option: every section)" } });
  const section = h("section", { cls: "info-section foldable" }, head, ...children);
  section.dataset.foldKey = `${palette}:${title}`;
  show(section, folded.has(section.dataset.foldKey));
  const toggle = (all: boolean): void => {
    const fold = !section.classList.contains("folded");
    const root = all ? section.closest(".pal-body") : null;
    const sections = root ? [...root.querySelectorAll<HTMLElement>(".info-section.foldable")] : [section];
    for (const s of sections) show(s, fold);
    persist();
  };
  head.addEventListener("click", (e) => toggle(e.altKey));
  head.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    toggle(e.altKey);
  });
  return section;
}

/** Folds (or opens) every section of the palette `from` is in, as Option-clicking a heading does. */
export function foldAll(from: HTMLElement, fold: boolean): void {
  const root = from.closest(".pal-body");
  if (!root) return;
  for (const s of root.querySelectorAll<HTMLElement>(".info-section.foldable")) show(s, fold);
  persist();
}
