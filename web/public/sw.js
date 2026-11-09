// openvwx service worker: the editor opens offline once it has been loaded.
// Registered by src/features/touch/install.ts (production builds only) as
// sw.js?v=<build>, so each build installs a new worker and the page can say so.
//
// - the app shell ("./" and "./index.html") is precached at install
// - /assets/* (hashed by the build, so never stale) is cache-first, filled as used
// - page navigations are network-first; the cached index.html is the offline fallback
//   (not for the admin page, /admin, the gallery, /gallery, or the converter, /convert, which
//   are left to the network; nor is a share or embed link's own page kept as the shell)
// - /api/* is never cached
// Cache names carry the build; the old ones go when the new worker activates.

const BUILD = new URL(self.location.href).searchParams.get("v") || "dev";
const SHELL_CACHE = `openvwx-shell-${BUILD}`;
const ASSET_CACHE = `openvwx-assets-${BUILD}`;
const SCOPE = new URL("./", self.registration.scope).href;
const INDEX = new URL("./index.html", self.registration.scope).href;
const ASSETS = new URL("./assets/", self.registration.scope).pathname;
const API = new URL("./api/", self.registration.scope).pathname;
const ADMIN = new URL("./admin", self.registration.scope).pathname;
const GALLERY = new URL("./gallery", self.registration.scope).pathname;
const CONVERT = new URL("./convert", self.registration.scope).pathname;
const OAUTH = new URL("./oauth/", self.registration.scope).pathname;
const WELL_KNOWN = new URL("./.well-known/", self.registration.scope).pathname;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([SCOPE, INDEX]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith("openvwx-") && k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(API)) return; // never cached: the default network fetch
  if (url.pathname === ADMIN || url.pathname === `${ADMIN}.html`) return; // nor the admin page
  // nor the gallery's pages: they are not the editor, and must not take the shell's place
  if (url.pathname === GALLERY || url.pathname.startsWith(`${GALLERY}/`) || url.pathname === `${GALLERY}.html`) return;
  // nor the converter's pages, which the server writes per conversion; caching one as the shell would open it offline in place of the editor
  if (url.pathname === CONVERT || url.pathname === `${CONVERT}.html` || url.pathname.startsWith(`${CONVERT}/`)) return;
  // nor the OAuth sign-in pages and metadata: server-written, never the editor's shell
  if (url.pathname.startsWith(OAUTH) || url.pathname.startsWith(WELL_KNOWN)) return;
  if (req.mode === "navigate") {
    event.respondWith(networkFirstPage(req));
  } else if (url.pathname.startsWith(ASSETS)) {
    event.respondWith(cacheFirst(req));
  }
});

async function networkFirstPage(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    // a link's page (its preview tags, an embed's poster) is that link's, not the app shell to keep
    if (res.ok && !res.headers.has("X-Openvwx-Page")) cache.put(INDEX, res.clone()).catch(() => undefined);
    return res;
  } catch (err) {
    const cached = (await cache.match(INDEX)) || (await cache.match(req));
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === "basic") cache.put(req, res.clone()).catch(() => undefined);
  return res;
}
