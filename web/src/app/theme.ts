// View > Theme and View > Dark Canvas, kept per browser. The theme is a
// data-theme attribute on <html> that styles.css reads (index.html sets it
// before the first paint); Dark Canvas swaps the drawing's ink and paper.

import type { Row } from "./menu.ts";

export type Theme = "dark" | "light" | "system";

const THEME_KEY = "openvwx.theme";
const CANVAS_KEY = "openvwx.darkCanvas";

const THEMES: readonly (readonly [Theme, string])[] = [
  ["dark", "Dark"],
  ["light", "Light"],
  ["system", "System"],
];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // storage blocked: the defaults
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: the choice lasts for this visit
  }
}

export function theme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "system" ? t : "dark";
}

export function setTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  write(THEME_KEY, t);
}

export function darkCanvas(): boolean {
  return document.documentElement.classList.contains("dark-canvas");
}

export function setDarkCanvas(on: boolean): void {
  document.documentElement.classList.toggle("dark-canvas", on);
  write(CANVAS_KEY, on ? "1" : "0");
}

/** Applies the kept Dark Canvas choice (the theme is applied by index.html). */
export function installTheme(): void {
  document.documentElement.classList.toggle("dark-canvas", read(CANVAS_KEY) === "1");
}

/** View > Theme. */
export function themeRows(): Row[] {
  return THEMES.map(([t, label]) => ({ label, i18n: `Theme › ${label}`, checked: () => theme() === t, run: () => setTheme(t) }));
}
