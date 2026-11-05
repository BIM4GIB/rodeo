// The converter's routes (rodeo.build/convert): the index and each pair's page, the sitemap, and the
// redirects that keep one address per page. The converter itself runs in the visitor's browser
// (web/src/convert), so these routes read no file and fetch nothing.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Context, Hono } from "hono";
import { convertPage } from "../../web/src/convert/pages.ts";
import { config } from "./config.ts";
import { renderConvertPage, sitemapXml } from "./convertPage.ts";

/** The converter page's template, kept after the first read; a build that lacks it is asked again next time. */
let template: string | null = null;

async function loadTemplate(): Promise<string | null> {
  if (template === null) {
    template = await readFile(join(config.webDist, "convert.html"), "utf8").catch(() => null);
  }
  return template;
}

/** Where a slug's page lives: its lower-case address, or the index when no pair has that slug. */
function canonicalPath(slug: string): string {
  const lower = slug.toLowerCase();
  return convertPage(lower) ? `/convert/${lower}` : "/convert";
}

/** Sends the index (slug null) or a pair's page, as HTML that browsers may not frame from other sites. */
async function servePage(c: Context, slug: string | null): Promise<Response> {
  const page = convertPage(slug);
  if (!page) return c.redirect("/convert", 301);
  const html = await loadTemplate();
  if (html === null) {
    c.header("Cache-Control", "no-store");
    return c.text("The converter page is not built on this server (web/dist/convert.html is missing).", 404);
  }
  c.header("Content-Type", "text/html; charset=utf-8");
  c.header("Cache-Control", "no-cache");
  c.header("Content-Security-Policy", "frame-ancestors 'self'");
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  return c.body(renderConvertPage(html, page, config.publicUrl));
}

/** Adds the converter's routes. They go before the editor's catch-all (registerStatic), so they answer first. */
export function registerConvert(app: Hono): void {
  app.get("/sitemap-convert.xml", (c) => {
    c.header("Content-Type", "application/xml; charset=utf-8");
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(sitemapXml(config.publicUrl));
  });
  app.get("/convert.html", (c) => c.redirect("/convert", 301));
  app.get("/convert/", (c) => c.redirect("/convert", 301));
  app.get("/convert", (c) => servePage(c, null));
  app.get("/convert/:slug/", (c) => c.redirect(canonicalPath(c.req.param("slug")), 301));
  app.get("/convert/:slug", (c) => {
    const slug = c.req.param("slug");
    const target = canonicalPath(slug);
    if (target !== `/convert/${slug}`) return c.redirect(target, 301);
    return servePage(c, slug);
  });
}
