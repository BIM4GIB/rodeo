import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";

// Dev-only: GET /__sample.vwx serves ../samples/sample.vwx when present,
// and GET /__samples/<path> any other file under ../samples (the multi-version
// demo files). Samples are real drawings, so they are never copied into the build.
function devSample(): Plugin {
  const dir = resolve(import.meta.dirname, "../samples");
  const file = resolve(dir, "sample.vwx");
  return {
    name: "openvwx-dev-sample",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__sample.vwx", (_req, res) => {
        if (!existsSync(file)) {
          res.statusCode = 404;
          res.end("no sample");
          return;
        }
        res.setHeader("Content-Type", "application/octet-stream");
        res.end(readFileSync(file));
      });
      server.middlewares.use("/__samples/", (req, res) => {
        const target = resolve(dir, decodeURIComponent((req.url ?? "").split("?")[0].replace(/^\/+/, "")));
        if (!target.startsWith(dir + sep) || !existsSync(target) || !statSync(target).isFile()) {
          res.statusCode = 404;
          res.end("no such sample");
          return;
        }
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", String(statSync(target).size));
        createReadStream(target).pipe(res);
      });
    },
  };
}

// Dev-only: /admin is the admin page (admin.html), as the server serves it in production.
function devAdmin(): Plugin {
  return {
    name: "openvwx-dev-admin",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === "/admin" || req.url?.startsWith("/admin?")) req.url = `/admin.html${req.url.slice("/admin".length)}`;
        next();
      });
    },
  };
}

// Dev-only: /gallery and /gallery/<id>/<slug> are the gallery page (gallery.html), as the server serves them.
function devGallery(): Plugin {
  return {
    name: "openvwx-dev-gallery",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? "";
        const path = url.split("?")[0];
        if (path === "/gallery" || path.startsWith("/gallery/")) req.url = `/gallery.html${url.slice(path.length)}`;
        next();
      });
    },
  };
}

// Dev-only: the converter (convert.html) at /convert and /convert/<from>-to-<to>, as the server
// serves it in production (server/src/convert.ts, which also writes each page's title and links).
function devConvert(): Plugin {
  return {
    name: "openvwx-dev-convert",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const m = /^\/convert(?:\/[a-z0-9]+-to-[a-z0-9]+)?\/?(\?.*)?$/i.exec(req.url ?? "");
        if (m) req.url = `/convert.html${m[1] ?? ""}`;
        next();
      });
    },
  };
}

// Relative base so the build also works from file:// inside Electron/Tauri.
export default defineConfig({
  base: "./",
  plugins: [devSample(), devAdmin(), devGallery(), devConvert()],
  // /api (and the collaboration socket) go to the openvwx server in development (docs/PLATFORM.md)
  server: { port: 5173, strictPort: true, proxy: { "/api": { target: "http://localhost:8080", ws: true } } },
  build: {
    target: "es2022",
    sourcemap: true,
    // render-worker.html is the cloud render worker's page (cloudrender/worker.py), beside the
    // editor; admin.html is the admin page, served at /admin; gallery.html is the public gallery,
    // served at /gallery; convert.html is the converter, served at /convert
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        renderWorker: resolve(import.meta.dirname, "render-worker.html"),
        admin: resolve(import.meta.dirname, "admin.html"),
        gallery: resolve(import.meta.dirname, "gallery.html"),
        convert: resolve(import.meta.dirname, "convert.html"),
      },
    },
  },
});
