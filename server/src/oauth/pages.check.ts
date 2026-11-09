// Checks the OAuth pages (pages.ts) with no browser and no database: a hostile app name, redirect
// host and request id can't break out of their attribute or text; every script and style carries the
// page's nonce; nothing loads from another origin; the consent form and its variants say what they
// must; the sign-in links are built right; the headers are the policy. Prints an ok line per check;
// exits 1 on any failure.
//
// Run: cd server && node src/oauth/pages.check.ts

import { consentPage, errorPage, newNonce, pageHeaders, signInPage, type ConsentView, type SignInView } from "./pages.ts";
import { describeClient, type ClientLook } from "./shared.ts";

// Values an app or a request could send. Each would open a tag or a script if it went in unescaped.
const HOSTILE_NAME = `<script>alert(1)</script>"'`;
const HOSTILE_HOST = `"><img src=x>`;
const HOSTILE_ID = `"><img src=x>`;

let failures = 0;

function expect(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

/** Whether every <script and <style opening tag in a page carries the page's nonce. */
function everyTagNonced(html: string, nonce: string): boolean {
  const tags = html.match(/<(script|style)\b[^>]*>/g) ?? [];
  return tags.every((tag) => tag.includes(`nonce="${nonce}"`));
}

/** The app as an unverified Cursor-like client with a hostile name and a hostile redirect host. */
const hostileApp: ClientLook = {
  name: HOSTILE_NAME,
  verified: false,
  where: HOSTILE_HOST,
  local: false,
  detailsFrom: HOSTILE_HOST,
};

const nonce = newNonce();
const consentView: ConsentView = {
  nonce,
  requestId: HOSTILE_ID,
  csrf: HOSTILE_ID,
  app: hostileApp,
  user: { name: HOSTILE_NAME, email: HOSTILE_HOST },
};
const signInView: SignInView = {
  nonce,
  requestId: HOSTILE_ID,
  app: hostileApp,
  providers: [{ id: "google", label: HOSTILE_NAME }],
  email: true,
};
const consent = consentPage(consentView);
const signIn = signInPage(signInView);
const error = errorPage(nonce, HOSTILE_NAME, HOSTILE_HOST);

// 1. Escaping: the raw hostile values appear nowhere, and their escaped forms do.
for (const [label, html] of [
  ["consent", consent],
  ["sign-in", signIn],
  ["error", error],
] as const) {
  expect(`escaping: ${label} page has no raw script`, !html.includes("<script>alert"));
  expect(`escaping: ${label} page has no raw hostile name`, !html.includes(HOSTILE_NAME));
  expect(`escaping: ${label} page has no raw hostile host or id`, !html.includes(HOSTILE_HOST));
  expect(`escaping: ${label} page has the escaped name`, html.includes("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;"));
}
expect(
  "escaping: the escaped id is in the consent form",
  consent.includes(`value="&quot;&gt;&lt;img src=x&gt;"`),
);
expect(
  "escaping: the escaped id is in the sign-in link and email form",
  signIn.includes("%22%3E%3Cimg%20src%3Dx%3E") && signIn.includes(`data-redirect="/oauth/consent?request=&quot;&gt;&lt;img src=x&gt;"`),
);

// A redirect host that is a real URL's host can't reach the page as markup either.
const realHost = describeClient("rodeo_dcr_0123456789abcdefghijkl", "cursor://anysphere.cursor-mcp/oauth/callback", HOSTILE_NAME);
const realPage = consentPage({ ...consentView, app: realHost });
expect("escaping: an app's own name is escaped on the consent page", !realPage.includes(HOSTILE_NAME));

// 2. Nonces: every script and style tag carries the page's nonce; the consent and error pages have no script.
expect("nonces: consent page style is nonced", everyTagNonced(consent, nonce) && consent.includes(`<style nonce="${nonce}">`));
expect("nonces: consent page has no script", !consent.includes("<script"));
expect("nonces: error page has no script", !error.includes("<script"));
expect("nonces: error page style is nonced", everyTagNonced(error, nonce));
expect("nonces: sign-in page script and style are nonced", everyTagNonced(signIn, nonce) && signIn.includes(`<script nonce="${nonce}">`));

// 3. Nothing from another origin, and no blur or glass.
for (const [label, html] of [
  ["consent", consent],
  ["sign-in", signIn],
  ["error", error],
] as const) {
  expect(`no outside resources: ${label} page`, !html.includes("http://") && !html.includes("https://") && !html.includes("fonts.googleapis"));
  expect(`solid panels: ${label} page has no blur`, !html.includes("backdrop-filter") && !html.includes("blur("));
}

// 4. The consent form: posts to /oauth/consent with the request and csrf, allow and deny, and a signout form.
expect(`consent form posts to /oauth/consent`, consent.includes(`<form method="post" action="/oauth/consent">`));
expect(`consent form has the request and csrf inputs`, consent.includes(`name="request" value="&quot;&gt;`) && consent.includes(`name="csrf" value="&quot;&gt;`));
expect(`consent form has allow and deny`, consent.includes(`value="allow"`) && consent.includes(`value="deny"`));
expect(`consent page has the signout form`, consent.includes(`action="/oauth/consent/signout"`));

// 5. Consent variants: verified, unverified, local, and an unverified document's address.
const claude = describeClient("https://claude.ai/oauth/mcp-oauth-client-metadata", "https://claude.ai/api/mcp/auth_callback", "");
const verifiedPage = consentPage({ ...consentView, app: claude });
expect("variants: verified app has no 'Not verified'", !verifiedPage.includes("Not verified"), claude.name);
expect("variants: verified app says where it sends them back", verifiedPage.includes("Rodeo sends you back to claude.ai."));

const cursor = describeClient("rodeo_dcr_0123456789abcdefghijkl", "cursor://anysphere.cursor-mcp/oauth/callback", "Cursor");
const cursorPage = consentPage({ ...consentView, app: cursor });
expect("variants: unverified app says 'Not verified by Rodeo'", cursorPage.includes("Not verified by Rodeo: this app calls itself “Cursor”."));

const local = describeClient("rodeo_dcr_0123456789abcdefghijkl", "http://127.0.0.1:8123/callback", "Claude Code");
const localPage = consentPage({ ...consentView, app: local });
expect("variants: local app says 'this computer'", localPage.includes("this computer"));
expect("variants: local app says 'allow it only if'", localPage.includes("allow it only if"));

const doc = describeClient("https://example.com/app.json", "https://example.com/cb", "Example");
const docPage = consentPage({ ...consentView, app: doc });
expect("variants: unverified document says 'Its details come from'", docPage.includes("Its details come from example.com."));

// 6. Sign-in: provider links carry the request in the redirect, and email and no-option cases.
const plain = signInPage({
  nonce,
  requestId: "abc-DEF_123",
  app: cursor,
  providers: [
    { id: "google", label: "Google" },
    { id: "github", label: "GitHub" },
  ],
  email: false,
});
expect(
  "sign-in: google link carries the request",
  plain.includes(`href="/api/auth/oauth/google?redirect=%2Foauth%2Fconsent%3Frequest%3Dabc-DEF_123"`),
);
expect(
  "sign-in: github link carries the request",
  plain.includes(`href="/api/auth/oauth/github?redirect=%2Foauth%2Fconsent%3Frequest%3Dabc-DEF_123"`),
);
expect("sign-in: provider labels are shown", plain.includes("Continue with Google") && plain.includes("Continue with GitHub"));
expect("sign-in: no email form without email sign-in", !plain.includes(`id="email"`) && !plain.includes("<script"));

const withEmail = signInPage({ nonce, requestId: "abc-DEF_123", app: cursor, providers: [], email: true });
expect("sign-in: email form and its script when email is on", withEmail.includes(`id="email"`) && withEmail.includes(`<script nonce="${nonce}">`));
expect("sign-in: no provider buttons when there are none", !withEmail.includes("Continue with"));

const none = signInPage({ nonce, requestId: "abc-DEF_123", app: cursor, providers: [], email: false });
expect("sign-in: no sign-in method says so", none.includes("no way to sign in"));

// 7. The headers, exactly.
const headers = pageHeaders("abc");
const wantHeaders: Record<string, string> = {
  "Content-Security-Policy": "default-src 'none'; style-src 'nonce-abc'; script-src 'nonce-abc'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
  "X-Openvwx-Page": "oauth",
};
const gotKeys = Object.keys(headers).sort().join("|");
const wantKeys = Object.keys(wantHeaders).sort().join("|");
expect("headers: exactly the policy's names", gotKeys === wantKeys, gotKeys);
expect(
  "headers: exactly the policy's values",
  Object.entries(wantHeaders).every(([name, value]) => headers[name] === value),
);

// 8. Nonces are fresh and have the expected length.
const n1 = newNonce();
const n2 = newNonce();
expect("nonce: two calls differ", n1 !== n2);
expect("nonce: 24 base64 characters", n1.length === 24 && /^[A-Za-z0-9+/]{22}==$/.test(n1), n1);

console.log(failures ? `${failures} failed` : "all good");
process.exit(failures ? 1 : 0);
