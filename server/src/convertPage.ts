// The converter's pages as the server sends them (rodeo.build/convert): the converter page's template
// with each page's title, description, canonical address, links and formats filled in, and the sitemap.
// Only fixed text from web/src/convert/pages.ts goes in, and every value is HTML-escaped, so the server
// never reads or fetches a user's file here.

import { PAGE_FORMATS, PAIRS, pageFormat, pairSlug, type ConvertPage } from "../../web/src/convert/pages.ts";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes text for HTML, attribute values and XML: & < > " ' become entities. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/**
 * Replaces what lies between a template's `<!-- name -->` and `<!-- /name -->` markers, keeping the
 * markers. A pair that is missing leaves the template as it is.
 */
function fillBlock(html: string, name: string, inner: string): string {
  const open = `<!-- ${name} -->`;
  const close = `<!-- /${name} -->`;
  const start = html.indexOf(open);
  const end = start < 0 ? -1 : html.indexOf(close, start + open.length);
  if (end < 0) return html;
  return html.slice(0, start + open.length) + inner + html.slice(end);
}

/** The page's head: its title, description, canonical address, Open Graph, Twitter card and JSON-LD. */
function headBlock(page: ConvertPage, publicUrl: string): string {
  const url = `${publicUrl}${page.path}`;
  const data = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Rodeo converter",
    url,
    description: page.description,
    applicationCategory: "DesignApplication",
    operatingSystem: "Any",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  // a script block ends at its first "</script" text, so the JSON writes <, > and & as escapes
  const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return [
    `<title>${escapeHtml(page.title)}</title>`,
    `<meta name="description" content="${escapeHtml(page.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Rodeo" />`,
    `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${escapeHtml(`${publicUrl}/icon-512.png`)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<script type="application/ld+json">${json}</script>`,
  ].join("\n    ");
}

/** The headline and lede. */
function introBlock(page: ConvertPage): string {
  return `<h1>${escapeHtml(page.h1)}</h1><p class="cv-lede">${escapeHtml(page.intro)}</p>`;
}

/** The links to other conversions, each named by its two formats. */
function linksBlock(page: ConvertPage): string {
  const items = page.links.map(([from, to]) => {
    const a = pageFormat(from);
    const b = pageFormat(to);
    if (!a || !b) return "";
    return `<li><a href="/convert/${escapeHtml(pairSlug(from, to))}">${escapeHtml(a.short)} to ${escapeHtml(b.short)}</a></li>`;
  });
  return `<ul class="cv-links">${items.join("")}</ul>`;
}

/** The table of every format the pages name, with whether Rodeo reads and writes it. */
function formatsBlock(): string {
  const rows = PAGE_FORMATS.map((f) => {
    const files = f.extensions.map((ext) => `.${escapeHtml(ext)}`).join(" ");
    return `<tr><th scope="row">${escapeHtml(f.long)}</th><td>${files}</td><td>${f.read ? "Yes" : "—"}</td><td>${f.write ? "Yes" : "—"}</td></tr>`;
  });
  return (
    `<div class="cv-table-wrap"><table class="cv-table"><thead><tr><th scope="col">Format</th><th scope="col">Files</th><th scope="col">Reads</th><th scope="col">Writes</th></tr></thead>` +
    `<tbody>${rows.join("")}</tbody></table></div>`
  );
}

/**
 * The converter page for `page`: `template` (web/convert.html) with its head, intro, links and formats
 * filled in. `publicUrl` is the server's public address without a trailing slash.
 */
export function renderConvertPage(template: string, page: ConvertPage, publicUrl: string): string {
  let html = fillBlock(template, "convert:head", headBlock(page, publicUrl));
  html = fillBlock(html, "convert:intro", introBlock(page));
  html = fillBlock(html, "convert:links", linksBlock(page));
  html = fillBlock(html, "convert:formats", formatsBlock());
  return html;
}

/** The sitemap: the index page and every pair's page. */
export function sitemapXml(publicUrl: string): string {
  const paths = ["/convert", ...PAIRS.map(([from, to]) => `/convert/${pairSlug(from, to)}`)];
  const urls = paths.map((path) => `  <url><loc>${escapeHtml(`${publicUrl}${path}`)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
