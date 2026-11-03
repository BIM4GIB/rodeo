// Installing openvwx and opening files from the system. The service worker (public/sw.js)
// is registered in production builds only; a new worker that takes over from an old one
// is announced with a notice to reload. "Open with openvwx" arrives through the launch
// queue, for the file_handlers entry in manifest.webmanifest.

import type { AppContext } from "../../app/ext.ts";
import { writeHandle } from "../../app/fileio.ts";
import { h } from "../../app/dom.ts";
import { rememberRecent } from "../../app/recent.ts";
import { errorMessage, toast } from "../../app/toast.ts";

interface LaunchParams {
  readonly files?: readonly FileSystemHandle[];
}

interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void | Promise<void>): void;
}

/** A file opened from the system (Finder, Files) opens here; its handle lets Save write it back. */
export function openFromLaunchQueue(ctx: AppContext): void {
  const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
  queue?.setConsumer(async (params) => {
    const handle = params.files?.[0];
    if (!handle || handle.kind !== "file") return;
    const fileHandle = handle as FileSystemFileHandle;
    try {
      const file = await fileHandle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      await ctx.openDocument(bytes, file.name, { source: { kind: "local", save: (out) => writeHandle(fileHandle, out) } });
      void rememberRecent(fileHandle);
    } catch (err) {
      toast(`Could not open the file: ${errorMessage(err)}`);
    }
  });
}

/** Registers the service worker in a production build, and announces an update to a page that had one. */
export function registerServiceWorker(): void {
  const env = (import.meta as unknown as { env?: { PROD?: boolean } }).env;
  if (!env?.PROD || !("serviceWorker" in navigator)) return;
  // the build's bundle name changes with every build: a new script URL installs a new worker
  const build = new URL(import.meta.url).pathname.split("/").pop() ?? "";
  const hadWorker = navigator.serviceWorker.controller !== null;
  const register = (): void => {
    navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(build)}`).catch((err: unknown) => {
      console.warn("openvwx: offline use is off:", errorMessage(err));
    });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
  if (!hadWorker) return;
  let announced = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!announced) {
      announced = true;
      updateNotice();
    }
  });
}

/** A notice that stays until the user reloads (toast.ts has no actions, so this one is built here). */
function updateNotice(): void {
  const host = document.getElementById("toasts");
  if (!host) return;
  const reload = h("button", { cls: "touch-update-reload", text: "Reload", attrs: { type: "button" } });
  reload.addEventListener("click", () => window.location.reload());
  host.append(h("div", { cls: "toast info touch-update", attrs: { role: "status" } }, h("span", { text: "Rodeo was updated — reload to use the new version" }), reload));
}
