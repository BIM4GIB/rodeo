// Checks the gallery's pure rules in node, with no browser or server: tags, slugs and addresses,
// the licences a fork may use, the trending score, escaping, and the meta tags, sitemap and
// robots.txt that the gallery's pages send. The server runs the same rules.
//
//   cd web && npx tsx src/features/gallery/check.ts

import {
  defaultLicenceFor,
  entryMeta,
  entryPath,
  escapeHtml,
  excerpt,
  homeMeta,
  isEntryId,
  isLicenceId,
  isReportReason,
  isSort,
  LICENCES,
  licenceOf,
  licencesForFork,
  metaTags,
  missingMeta,
  normalizeTag,
  normalizeTags,
  parseGalleryPath,
  REPORT_REASONS,
  robotsTxt,
  sitemapXml,
  slugOf,
  trendingScore,
  type MetaEntry,
} from "./rules.ts";

let passed = 0;
let failures = 0;

function check(ok: boolean, what: string): void {
  if (ok) {
    passed++;
    return;
  }
  failures++;
  console.log(`  FAIL: ${what}`);
}

/** Whether two values are the same once JSON-encoded: enough for the arrays and objects checked here. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A complete entry for the meta checks, with any field overridden. */
function entry(over: Partial<MetaEntry> = {}): MetaEntry {
  return {
    id: "abcdefghijk2",
    title: "Chair",
    description: "A chair",
    creditName: "Ana",
    official: false,
    licence: "CC-BY-4.0",
    coverUrl: null,
    publishedAt: "2026-11-04T10:00:00Z",
    updatedAt: "2026-11-04T10:00:00Z",
    ...over,
  };
}

// ---- tags -------------------------------------------------------------------------------

check(normalizeTag("  Timber Frame ") === "timber-frame", "tag: spaces become dashes and ends are trimmed");
check(normalizeTag("Kit_of_Parts!!") === "kit-of-parts", "tag: underscores become dashes, punctuation is dropped");
check(normalizeTag("Écoles") === "ecoles", "tag: accents are dropped");
check(normalizeTag("---") === "", "tag: nothing usable gives an empty tag");
check(normalizeTag("x".repeat(40)).length === 24, "tag: cut to 24 characters");
check(!normalizeTag("abcdefghijklmnopqrstuvw x").endsWith("-"), "tag: a dash left by the cut is trimmed");
check(same(normalizeTags(["House", "house", "", "Stage"]), ["house", "stage"]), "tags: array is normalized, repeats and empties dropped");
check(same(normalizeTags("house, timber frame"), ["house", "timber-frame"]), "tags: comma-separated string is split");
check(same(normalizeTags(42), []), "tags: anything else gives no tags");
check(same(normalizeTags(["a", 3, null]), ["a"]), "tags: non-strings in an array are skipped");

// ---- slugs and addresses ----------------------------------------------------------------

check(slugOf("Maison à ossature bois") === "maison-a-ossature-bois", "slug: accents and spaces");
check(slugOf("") === "drawing", "slug: empty title falls back to drawing");
check(slugOf("!!!") === "drawing", "slug: punctuation-only title falls back to drawing");
const longSlug = slugOf("a b ".repeat(50));
check(longSlug.length <= 60 && !longSlug.endsWith("-"), "slug: at most 60 characters, no trailing dash");
check(entryPath("abcdefghijk2", "My Chair") === "/gallery/abcdefghijk2/my-chair", "path: /gallery/<id>/<slug>");
check(isEntryId("abcdefghijk2"), "id: twelve characters of a-z and 2-7 pass");
check(!isEntryId("ABCDEFGHIJK2"), "id: capitals fail");
check(!isEntryId("abcdefghijk1"), "id: the digit 1 fails");
check(!isEntryId("abc"), "id: short fails");

// ---- routes -----------------------------------------------------------------------------

check(same(parseGalleryPath("/gallery"), { kind: "home" }), "route: /gallery is the listing");
check(same(parseGalleryPath("/gallery/"), { kind: "home" }), "route: /gallery/ is the listing");
check(same(parseGalleryPath("/gallery/abcdefghijk2"), { kind: "entry", id: "abcdefghijk2" }), "route: /gallery/<id> is a drawing");
check(
  same(parseGalleryPath("/gallery/abcdefghijk2/any-slug"), { kind: "entry", id: "abcdefghijk2" }),
  "route: /gallery/<id>/<slug> is a drawing",
);
check(same(parseGalleryPath("/gallery/nope"), { kind: "missing" }), "route: a bad id is missing");
check(same(parseGalleryPath("/gallery/abcdefghijk2/a/b"), { kind: "missing" }), "route: extra segments are missing");
check(parseGalleryPath("/galleryx") === null, "route: /galleryx is not the gallery's");
check(parseGalleryPath("/") === null, "route: the app root is not the gallery's");
check(parseGalleryPath("/admin") === null, "route: /admin is not the gallery's");

// ---- licences ---------------------------------------------------------------------------

const allFour = ["CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0", "CC0-1.0"];
check(same(LICENCES.map((l) => l.id), allFour), "licences: four, in the dialog's order");
check(same(licencesForFork(null), allFour), "fork licences: a drawing that is not a fork may use all four");
check(same(licencesForFork("CC0-1.0"), allFour), "fork licences: a CC0 parent allows all four");
check(
  same(licencesForFork("CC-BY-4.0"), ["CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0"]),
  "fork licences: a CC BY parent allows BY, BY-SA and BY-NC, not CC0",
);
check(same(licencesForFork("CC-BY-SA-4.0"), ["CC-BY-SA-4.0"]), "fork licences: a BY-SA parent allows BY-SA only");
check(same(licencesForFork("CC-BY-NC-4.0"), ["CC-BY-NC-4.0"]), "fork licences: a BY-NC parent allows BY-NC only");
check(defaultLicenceFor(null) === "CC-BY-4.0", "default licence: CC BY for a new drawing");
check(defaultLicenceFor("CC0-1.0") === "CC-BY-4.0", "default licence: CC0 parent starts on CC BY");
check(defaultLicenceFor("CC-BY-SA-4.0") === "CC-BY-SA-4.0", "default licence: a fork starts on its parent's licence");
check(!isLicenceId("MIT") && !isLicenceId(3), "licence id: unknown values fail");
check(isLicenceId("CC0-1.0"), "licence id: CC0 passes");
check(licenceOf("CC0-1.0")?.short === "CC0", "licence: CC0 badge");
check(licenceOf("nope") === null, "licence: unknown id gives null");

// ---- sorting, trending and reports ------------------------------------------------------

check(isSort("trending") && isSort("new") && isSort("forks"), "sort: the three sorts pass");
check(!isSort("hot"), "sort: an unknown sort fails");
const base = { recentForks: 0, forks: 5, ageDays: 2, featured: false };
check(
  trendingScore({ ...base, recentForks: 5 }) > trendingScore(base),
  "trending: recent forks raise the score",
);
check(
  trendingScore({ ...base, ageDays: 1 }) > trendingScore({ ...base, ageDays: 100 }),
  "trending: older drawings score lower",
);
check(trendingScore({ ...base, featured: true }) > trendingScore(base), "trending: a featured drawing scores higher");
const samples = [
  { recentForks: 0, forks: 0, ageDays: 0, featured: false },
  { recentForks: 2, forks: 9, ageDays: -5, featured: true },
  { recentForks: 0, forks: 1000, ageDays: 3650, featured: false },
];
check(
  samples.every((s) => Number.isFinite(trendingScore(s)) && trendingScore(s) > 0),
  "trending: finite and above zero, even for a negative age",
);
check(isReportReason("spam") && !isReportReason("rude"), "report reason: known reasons pass, others fail");
check(
  same(REPORT_REASONS.map((r) => r.id), ["private", "rights", "spam", "offensive", "other"]),
  "report reasons: five, in the form's order",
);

// ---- escaping and excerpts --------------------------------------------------------------

check(
  escapeHtml(`<a href="x">'&`) === "&lt;a href=&quot;x&quot;&gt;&#39;&amp;",
  "escape: & < > \" ' become entities, once",
);
check(escapeHtml("&amp;") === "&amp;amp;", "escape: an existing entity is escaped again, not left alone");
check(excerpt("a  b\n c", 100) === "a b c", "excerpt: whitespace runs become one space");
const cutExcerpt = excerpt("word ".repeat(100), 50);
check(cutExcerpt.length <= 50 && cutExcerpt.endsWith("…"), "excerpt: cut at most to the limit, ending with an ellipsis");
check(excerpt("abc def", 5) === "abc…", "excerpt: cut at the last space before the limit");

// ---- meta tags, sitemap and robots ------------------------------------------------------

const covered = metaTags(
  entryMeta(
    entry({ title: "T & co", coverUrl: "/api/gallery/entries/abcdefghijk2/cover?v=1" }),
    "https://x.test",
  ),
);
check(covered.includes("<title>T &amp; co by Ana · Rodeo Gallery</title>"), "meta: title is escaped and credited");
check(
  covered.includes(`<meta property="og:image" content="https://x.test/api/gallery/entries/abcdefghijk2/cover?v=1">`),
  "meta: og:image is the absolute cover address",
);
check(covered.includes("summary_large_image"), "meta: a covered drawing unfurls large");
check(!covered.includes("noindex"), "meta: a published drawing is indexed");
check(covered.includes(`<meta property="og:image:width" content="1200">`), "meta: cover width is 1200");
const tagged = metaTags(entryMeta(entry({ tags: ["house", "a&b"] }), "https://x.test"));
check(
  tagged.includes(`<meta property="article:tag" content="house">`) && tagged.includes(`content="a&amp;b"`) && tagged.includes(`"keywords":"house, a&b"`),
  "meta: tags are article:tag lines and JSON-LD keywords, escaped",
);

const hostile = metaTags(entryMeta(entry({ title: "</script><script>" }), "https://x.test"));
check(!hostile.includes("</script><script>"), "meta: a title cannot close the JSON-LD script early");
check(hostile.split("</script>").length - 1 === 1, "meta: the only closing script tag is ours");

const fallback = entryMeta(entry({ description: "" }), "https://x.test");
check(fallback.description.includes("Look round it in 3D"), "meta: an empty description gets the fallback sentence");
check(
  fallback.jsonLd?.license === "https://creativecommons.org/licenses/by/4.0/",
  "meta: the JSON-LD names the licence's address",
);
check(
  fallback.image === "https://x.test/icon-512.png" && fallback.largeImage === false,
  "meta: a drawing without a cover uses the Rodeo icon, small",
);

const gone = metaTags(missingMeta("https://x.test"));
check(gone.includes(`content="noindex"`), "meta: the missing page is noindex");
check(!gone.includes("og:image"), "meta: the missing page has no picture");

check(homeMeta("https://x.test", { q: "chair" }).noindex === true, "meta: a search page is noindex");
check(homeMeta("https://x.test", {}).noindex === false, "meta: the listing is indexed");
check(homeMeta("https://x.test", { tag: "house" }).title === "Houses · Rodeo Gallery", "meta: a tag page takes the tag's label");
check(
  homeMeta("https://x.test", { tag: "house" }).url === "https://x.test/gallery?tag=house",
  "meta: a tag page's address carries the tag",
);
check(homeMeta("https://x.test", {}).title === "Rodeo Gallery: fork a building", "meta: the listing's title");

const sitemap = sitemapXml("https://x.test", [{ path: "/gallery/abcdefghijk2/a", updatedAt: "2026-11-04T10:00:00Z" }]);
check(sitemap.includes("<loc>https://x.test/gallery</loc>"), "sitemap: lists the listing");
check(sitemap.includes("<loc>https://x.test/gallery/abcdefghijk2/a</loc>"), "sitemap: lists each drawing");
check(sitemap.includes("<lastmod>2026-11-04</lastmod>"), "sitemap: last change is the day");
check(
  sitemapXml("https://x.test/&", []).includes("https://x.test/&amp;/gallery"),
  "sitemap: an ampersand in the address is escaped",
);

const robots = robotsTxt("https://x.test");
check(robots.includes("Sitemap: https://x.test/sitemap.xml"), "robots: names the sitemap");
check(robots.includes("Allow: /api/gallery/"), "robots: covers may be fetched");
check(robots.includes("Disallow: /*?embed="), "robots: embed links are kept out");

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log(`gallery rules: ${passed} checks passed`);
