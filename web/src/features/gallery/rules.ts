// The gallery's wire types and the rules both the server and the web share: licences and which a
// fork may use, tags, slugs and addresses, the trending score, and the meta tags, sitemap and
// robots.txt of the gallery's pages. It imports nothing: the server runs it as it is.

// ---- licences ---------------------------------------------------------------------------

/** The four licences a gallery drawing can be published under. */
export type LicenceId = "CC-BY-4.0" | "CC-BY-SA-4.0" | "CC-BY-NC-4.0" | "CC0-1.0";

export interface Licence {
  readonly id: LicenceId;
  /** the badge: "CC BY" */
  readonly short: string;
  /** "CC BY 4.0" */
  readonly name: string;
  readonly url: string;
  /** one sentence: what people may do */
  readonly summary: string;
}

/** The licences, in the order the publish dialog lists them. */
export const LICENCES: readonly Licence[] = [
  {
    id: "CC-BY-4.0",
    short: "CC BY",
    name: "CC BY 4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
    summary: "Anyone can use, change and share it, even commercially, as long as they credit you.",
  },
  {
    id: "CC-BY-SA-4.0",
    short: "CC BY-SA",
    name: "CC BY-SA 4.0",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
    summary: "As CC BY, and changed versions must be shared under this licence too.",
  },
  {
    id: "CC-BY-NC-4.0",
    short: "CC BY-NC",
    name: "CC BY-NC 4.0",
    url: "https://creativecommons.org/licenses/by-nc/4.0/",
    summary: "Anyone can use, change and share it with credit, but not to make money.",
  },
  {
    id: "CC0-1.0",
    short: "CC0",
    name: "CC0 1.0",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    summary: "No rights kept: anyone can do anything with it, no credit needed.",
  },
];

/** The licence a new publish starts on: BY keeps the author credited on every fork and lets anyone build with it. */
export const DEFAULT_LICENCE: LicenceId = "CC-BY-4.0";

/** Whether `v` is one of the four licence ids. */
export function isLicenceId(v: unknown): v is LicenceId {
  return typeof v === "string" && LICENCES.some((l) => l.id === v);
}

/** The licence with this id, or null when there is none. */
export function licenceOf(id: string): Licence | null {
  return LICENCES.find((l) => l.id === id) ?? null;
}

/**
 * The licences a drawing may be published under when it is a fork taken under `parent` (null: not a
 * fork). A fork can never loosen its parent's terms, and CC BY cannot be waived, so it is not CC0.
 */
export function licencesForFork(parent: LicenceId | null): readonly LicenceId[] {
  if (parent === null || parent === "CC0-1.0") return LICENCES.map((l) => l.id);
  if (parent === "CC-BY-4.0") return ["CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0"];
  if (parent === "CC-BY-SA-4.0") return ["CC-BY-SA-4.0"];
  return ["CC-BY-NC-4.0"];
}

/** The licence the publish dialog starts on: the parent's when it is a fork that needs one, else the default. */
export function defaultLicenceFor(parent: LicenceId | null): LicenceId {
  return parent !== null && parent !== "CC0-1.0" ? parent : DEFAULT_LICENCE;
}

// ---- tags, slugs and addresses ----------------------------------------------------------

/** Most tags one drawing may carry. */
export const MAX_TAGS = 6;

/** Longest tag, in characters. */
export const MAX_TAG_LENGTH = 24;

/** The chips the publish dialog offers: the tag each one saves, and the label it shows. */
export const SUGGESTED_TAGS: readonly { readonly tag: string; readonly label: string }[] = [
  { tag: "house", label: "Houses" },
  { tag: "furniture", label: "Furniture" },
  { tag: "student", label: "Student work" },
  { tag: "interior", label: "Interiors" },
  { tag: "detail", label: "Details" },
  { tag: "landscape", label: "Landscape" },
  { tag: "stage", label: "Stage" },
];

/** Longest slug taken from a title, in characters. */
const SLUG_LENGTH = 60;

/**
 * Lower-case words joined by "-": accents dropped, spaces and underscores become "-", anything but
 * a-z, 0-9 and "-" dropped, and cut to `max` characters. The cut can leave a "-" at its end, so it
 * is trimmed again. "" when nothing is left.
 */
function slugWith(v: string, max: number): string {
  const s = v
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, max).replace(/-+$/, "");
}

/** One tag, as the gallery stores it: "Timber Frame" → "timber-frame"; "" when nothing usable is left. */
export function normalizeTag(v: string): string {
  return slugWith(v, MAX_TAG_LENGTH);
}

/**
 * Tags from an array or a comma-separated string: normalized, empties and repeats dropped (the first
 * kept), order kept. Not cut to MAX_TAGS, so callers check the count. Anything else gives [].
 */
export function normalizeTags(v: unknown): string[] {
  const parts: unknown[] = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const out: string[] = [];
  for (const part of parts) {
    if (typeof part !== "string") continue;
    const tag = normalizeTag(part);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** The lengths the server and the form both hold a field to, in characters. */
export const LIMITS = {
  title: 80,
  description: 2000,
  credit: 60,
  reportNote: 1000,
  hideReason: 200,
  query: 80,
} as const;

/** Largest drawing that can be published, in bytes. */
export const MAX_GALLERY_BYTES: number = 100 * 1024 * 1024;

/** Largest cover picture, in bytes. */
export const MAX_COVER_BYTES: number = 1024 * 1024;

/** The size of a cover picture, in pixels: the card size the link previews use. */
export const COVER = { width: 1200, height: 630 } as const;

/** Cards on one page of the gallery. */
export const PAGE_SIZE = 24;

/** "Maison à ossature bois" → "maison-a-ossature-bois": the normalizeTag rules, at most 60 characters, "drawing" when empty. */
export function slugOf(title: string): string {
  return slugWith(title, SLUG_LENGTH) || "drawing";
}

/** "/gallery/<id>/<slug>" */
export function entryPath(id: string, title: string): string {
  return `/gallery/${id}/${slugOf(title)}`;
}

/** 12 characters of a-z and 2-7: the alphabet the server's ids use. */
export function isEntryId(v: string): boolean {
  return /^[a-z2-7]{12}$/.test(v);
}

/** Where a path under /gallery leads: the listing, one drawing, or nothing the gallery knows. */
export type GalleryRoute =
  | { readonly kind: "home" }
  | { readonly kind: "entry"; readonly id: string }
  | { readonly kind: "missing" };

/** What a path under /gallery is; null when it is not the gallery's. */
export function parseGalleryPath(pathname: string): GalleryRoute | null {
  if (pathname === "/gallery" || pathname === "/gallery/") return { kind: "home" };
  if (!pathname.startsWith("/gallery/")) return null;
  // "/gallery/<id>" or "/gallery/<id>/<slug>": anything else under /gallery/ is a missing drawing,
  // so a mangled link gets the "not in the gallery" page rather than the listing.
  const parts = pathname.slice("/gallery/".length).split("/");
  const idOnly = parts.length === 1 && isEntryId(parts[0]);
  const idAndSlug = parts.length === 2 && isEntryId(parts[0]) && parts[1] !== "";
  if (idOnly || idAndSlug) return { kind: "entry", id: parts[0] };
  return { kind: "missing" };
}

// ---- sorting and trending ---------------------------------------------------------------

/** How the listing orders its cards. */
export type GallerySort = "trending" | "new" | "forks";

/** The sort choices, in the order the listing shows them. */
export const SORTS: readonly { readonly id: GallerySort; readonly label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "Newest" },
  { id: "forks", label: "Most forked" },
];

/** Whether `v` is one of the sort ids. */
export function isSort(v: unknown): v is GallerySort {
  return typeof v === "string" && SORTS.some((s) => s.id === v);
}

/**
 * How hot a drawing is right now. Recent forks count most, forks in all count a little (on a log
 * scale, so the first ones matter), a featured drawing gets a lift, and the score falls off with
 * age, so a new drawing can rise and an old one settles.
 */
export function trendingScore(s: { recentForks: number; forks: number; ageDays: number; featured: boolean }): number {
  const boost = s.featured ? 2 : 0;
  return (1 + 3 * s.recentForks + Math.log2(1 + s.forks) + boost) / (Math.max(0, s.ageDays) + 2) ** 1.3;
}

// ---- reports ----------------------------------------------------------------------------

/** Why someone reports a drawing. */
export type ReportReason = "private" | "rights" | "spam" | "offensive" | "other";

/** The report reasons, in the order the form offers them. */
export const REPORT_REASONS: readonly { readonly id: ReportReason; readonly label: string }[] = [
  { id: "private", label: "It shows private or personal information" },
  { id: "rights", label: "It's my work, or copied without permission" },
  { id: "spam", label: "Spam or advertising" },
  { id: "offensive", label: "Offensive or harmful" },
  { id: "other", label: "Something else" },
];

/** Whether `v` is one of the report reasons. */
export function isReportReason(v: unknown): v is ReportReason {
  return typeof v === "string" && REPORT_REASONS.some((r) => r.id === v);
}

// ---- wire types -------------------------------------------------------------------------

/** published: in the gallery; hidden: taken out by an admin; unpublished: its owner took it down. */
export type EntryState = "published" | "hidden" | "unpublished";

/** The drawing a fork came from, as it was when the fork was made. */
export interface ForkedFrom {
  readonly title: string;
  readonly creditName: string;
  readonly licence: LicenceId;
  /** the original's gallery page while it is still in the gallery, else null */
  readonly path: string | null;
}

/** Who a fork was taken from, and when. */
export interface ForkAttribution extends ForkedFrom {
  readonly forkedAt: string;
}

/** One drawing as a card in the listing. */
export interface GalleryCard {
  readonly id: string;
  /** "/gallery/<id>/<slug>" */
  readonly path: string;
  readonly title: string;
  readonly creditName: string;
  /** published as Rodeo */
  readonly official: boolean;
  /** the author's account id, for "more by"; null when official */
  readonly authorId: string | null;
  readonly tags: readonly string[];
  readonly licence: LicenceId;
  readonly forks: number;
  readonly featured: boolean;
  /** "/api/gallery/entries/<id>/cover?v=<x>", or null without a cover */
  readonly coverUrl: string | null;
  readonly publishedAt: string;
  readonly updatedAt: string;
  readonly forkedFrom: ForkedFrom | null;
}

/** One drawing's own page: its card plus the description and the links to view and download it. */
export interface GalleryEntry extends GalleryCard {
  readonly description: string;
  /** bytes of the published version */
  readonly size: number;
  /** "/?embed=<token>"; "" while hidden */
  readonly embedUrl: string;
  /** "/?share=<token>"; "" while hidden */
  readonly viewUrl: string;
  /** "/api/gallery/entries/<id>/download" */
  readonly downloadUrl: string;
  readonly state: EntryState;
  /** why an admin hid it; only for its owner and admins, else null */
  readonly hiddenReason: string | null;
}

/** An entry as its owner sees it, with the drawing it came from. */
export interface OwnEntry extends GalleryEntry {
  readonly fileId: string;
  readonly versionId: string | null;
}

/** A published fork and the forks made from it. */
export interface RemixNode {
  readonly card: GalleryCard;
  readonly children: readonly RemixNode[];
}

/** One report on a drawing, as an admin reads it. */
export interface ModerationReport {
  readonly id: string;
  readonly reason: ReportReason;
  readonly note: string;
  readonly email: string | null;
  /** the reporter's account name; null when they were signed out */
  readonly reporterName: string | null;
  readonly createdAt: string;
}

/** A drawing an admin has to look at: reported, or hidden already. */
export interface ModerationItem {
  readonly entry: GalleryEntry;
  readonly ownerEmail: string;
  readonly reports: readonly ModerationReport[];
}

/** A drawing's page: the entry, its remix tree and who is looking. */
export interface EntryDetail {
  readonly entry: GalleryEntry;
  readonly remixes: readonly RemixNode[];
  /** forks nobody has published */
  readonly privateForks: number;
  readonly viewer: { readonly signedIn: boolean; readonly isOwner: boolean; readonly isAdmin: boolean };
  /** the drawing in its owner's cloud; only for the owner, else null */
  readonly fileId: string | null;
  /** open reports; only for admins, else null */
  readonly reports: readonly ModerationReport[] | null;
}

/** One page of the listing. */
export interface GalleryList {
  readonly entries: readonly GalleryCard[];
  readonly page: number;
  readonly hasMore: boolean;
}

/** A tag and how many visible drawings carry it. */
export interface TagCount {
  readonly tag: string;
  readonly count: number;
}

/** The details a publish or an edit sets. */
export interface PublishFields {
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly licence: LicenceId;
  readonly creditName: string;
}

/** What the publish dialog sends. */
export interface PublishRequest extends PublishFields {
  /** "I made this drawing or have the right to share it" */
  readonly agree: boolean;
  /** admins only: credit as Rodeo */
  readonly official?: boolean;
  /** admins only: pick it for the front of the gallery */
  readonly featured?: boolean;
}

/** What an edit of an entry's details sends: any of the fields, and no re-pin of the version. */
export type EntryPatch = Partial<PublishFields> & { readonly official?: boolean; readonly featured?: boolean };

/** What the publish dialog shows for one drawing. */
export interface PublishState {
  /** the drawing's entry while it is published or hidden; null when it never was or was unpublished */
  readonly entry: OwnEntry | null;
  /** the fields it was last published with, after an unpublish (to fill the form); else null */
  readonly previous: PublishFields | null;
  readonly canPublish: boolean;
  /** why not, in one sentence; null when it can be */
  readonly reason: string | null;
  readonly licences: readonly LicenceId[];
  readonly defaultLicence: LicenceId;
  readonly forkedFrom: ForkedFrom | null;
  /** the drawing's name in the cloud (the title starts as this, without ".vwx") */
  readonly fileName: string;
  readonly headVersionId: string | null;
  /** bytes of the head version */
  readonly size: number;
  readonly maxBytes: number;
  /** the signed-in user's name */
  readonly defaultCredit: string;
  readonly isAdmin: boolean;
}

/** The fork's new drawing, and the editor address that opens it. */
export interface ForkResult {
  readonly fileId: string;
  /** "/?file=<id>&forked=1" */
  readonly url: string;
}

/** What a report sends. */
export interface ReportRequest {
  readonly reason: ReportReason;
  readonly note: string;
  readonly email?: string;
}

// ---- page meta, sitemap and robots ------------------------------------------------------

/** The head of one gallery page: what search engines and link previews read. */
export interface PageMeta {
  readonly title: string;
  readonly description: string;
  /** absolute */
  readonly url: string;
  /** absolute, or null */
  readonly image: string | null;
  /** the image is a 1200 × 630 cover: the link unfurls with a large picture */
  readonly largeImage: boolean;
  readonly imageAlt: string;
  readonly type: "website" | "article";
  readonly noindex: boolean;
  readonly jsonLd: Record<string, unknown> | null;
  /** an entry's tags, as article:tag lines */
  readonly tags?: readonly string[];
}

/** The fields of an entry the page meta is built from. */
export interface MetaEntry {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly creditName: string;
  readonly official: boolean;
  readonly licence: LicenceId;
  /** a path ("/api/gallery/…") or null */
  readonly coverUrl: string | null;
  readonly publishedAt: string;
  readonly updatedAt: string;
  readonly tags?: readonly string[];
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** & < > " ' as entities (&amp; &lt; &gt; &quot; &#39;). */
export function escapeHtml(s: string): string {
  // one pass, so an escaped "&" is never escaped again
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** One line: whitespace runs to one space, trimmed; longer than max is cut at the last space before max-1 characters and ends "…". */
export function excerpt(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > 0 ? cut.slice(0, space) : cut}…`;
}

/** The head tags for a page, one per line, starting with <title>. */
export function metaTags(m: PageMeta): string {
  const lines: string[] = [
    `<title>${escapeHtml(m.title)}</title>`,
    `<meta name="description" content="${escapeHtml(m.description)}">`,
    `<link rel="canonical" href="${escapeHtml(m.url)}">`,
    `<meta property="og:site_name" content="Rodeo">`,
    `<meta property="og:type" content="${m.type}">`,
    `<meta property="og:title" content="${escapeHtml(m.title)}">`,
    `<meta property="og:description" content="${escapeHtml(m.description)}">`,
    `<meta property="og:url" content="${escapeHtml(m.url)}">`,
  ];
  if (m.image !== null) {
    lines.push(`<meta property="og:image" content="${escapeHtml(m.image)}">`);
    if (m.largeImage) {
      lines.push(`<meta property="og:image:width" content="${COVER.width}">`);
      lines.push(`<meta property="og:image:height" content="${COVER.height}">`);
    }
    lines.push(`<meta property="og:image:alt" content="${escapeHtml(m.imageAlt)}">`);
  }
  for (const tag of m.tags ?? []) lines.push(`<meta property="article:tag" content="${escapeHtml(tag)}">`);
  lines.push(`<meta name="twitter:card" content="${m.largeImage ? "summary_large_image" : "summary"}">`);
  if (m.noindex) lines.push(`<meta name="robots" content="noindex">`);
  if (m.jsonLd) {
    // "<" becomes its escape, so no string inside the JSON can close the script tag early
    lines.push(`<script type="application/ld+json">${JSON.stringify(m.jsonLd).replace(/</g, "\\u003c")}</script>`);
  }
  return lines.join("\n    ");
}

/** The meta of one drawing's page: its title, credit, cover and licence, for links and search. */
export function entryMeta(e: MetaEntry, publicUrl: string): PageMeta {
  const licence = licenceOf(e.licence);
  const summary = excerpt(e.description, 200);
  const description =
    summary || `A drawing by ${e.creditName} in the Rodeo Gallery, shared under ${licence?.name ?? e.licence}. Look round it in 3D, download it or fork it.`;
  return {
    title: `${e.title} by ${e.creditName} · Rodeo Gallery`,
    description,
    url: publicUrl + entryPath(e.id, e.title),
    image: e.coverUrl ? publicUrl + e.coverUrl : publicUrl + "/icon-512.png",
    largeImage: Boolean(e.coverUrl),
    imageAlt: e.title,
    type: "article",
    noindex: false,
    tags: e.tags ?? [],
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      name: e.title,
      description,
      url: publicUrl + entryPath(e.id, e.title),
      image: e.coverUrl ? publicUrl + e.coverUrl : publicUrl + "/icon-512.png",
      license: licence?.url ?? null,
      author: { "@type": e.official ? "Organization" : "Person", name: e.creditName },
      datePublished: e.publishedAt,
      dateModified: e.updatedAt,
      ...(e.tags?.length ? { keywords: e.tags.join(", ") } : {}),
    },
  };
}

/** The meta of the listing, or of a tag's or search's view of it (a search is not indexed). */
export function homeMeta(publicUrl: string, opts: { readonly tag?: string | null; readonly q?: string | null }): PageMeta {
  const tag = opts.tag ? opts.tag : null;
  const label = tag ? (SUGGESTED_TAGS.find((s) => s.tag === tag)?.label ?? tag) : null;
  return {
    title: label ? `${label} · Rodeo Gallery` : "Rodeo Gallery: fork a building",
    description:
      "Open drawings of houses, furniture and student work. Look round them in 3D, download them, or fork one into your own Rodeo drawings.",
    url: publicUrl + "/gallery" + (tag ? `?tag=${encodeURIComponent(tag)}` : ""),
    image: publicUrl + "/icon-512.png",
    largeImage: false,
    imageAlt: "Rodeo",
    type: "website",
    noindex: Boolean(opts.q?.trim()),
    jsonLd: null,
  };
}

/** The meta of the "not in the gallery" page: no index, no picture. */
export function missingMeta(publicUrl: string): PageMeta {
  return {
    title: "Not in the gallery · Rodeo",
    description: "This drawing is no longer in the Rodeo Gallery.",
    url: publicUrl + "/gallery",
    image: null,
    largeImage: false,
    imageAlt: "",
    type: "website",
    noindex: true,
    jsonLd: null,
  };
}

/** The sitemap: the listing and every visible drawing, with the day each last changed. */
export function sitemapXml(publicUrl: string, entries: readonly { readonly path: string; readonly updatedAt: string }[]): string {
  const urls = [`  <url><loc>${escapeHtml(publicUrl + "/gallery")}</loc></url>`];
  for (const e of entries) {
    urls.push(
      `  <url><loc>${escapeHtml(publicUrl + e.path)}</loc><lastmod>${escapeHtml(e.updatedAt.slice(0, 10))}</lastmod></url>`,
    );
  }
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
    "",
  ].join("\n");
}

/** robots.txt: crawlers may read the gallery and its covers, and nothing private or under /api/. */
export function robotsTxt(publicUrl: string): string {
  return [
    "User-agent: *",
    "Allow: /api/gallery/",
    "Disallow: /api/",
    "Disallow: /admin",
    "Disallow: /*?share=",
    "Disallow: /*?embed=",
    "Disallow: /*?invite=",
    "Disallow: /*?file=",
    `Sitemap: ${publicUrl}/sitemap.xml`,
    "",
  ].join("\n");
}
