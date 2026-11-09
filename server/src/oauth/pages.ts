// The pages a person sees while an agent app connects to Rodeo: the sign-in page, the consent page and
// the error page. They are plain HTML from the server, not the editor, so they open fast in a popup,
// take a strict nonce policy, and can't be cached as the app shell. Every value put in goes through
// escapeHtml, because an app names itself and a redirect address comes from the app.

import { randomBytes } from "node:crypto";
import { escapeHtml } from "../page.ts";
import type { ClientLook } from "./shared.ts";

/** A fresh nonce for one page's inline style and script: 16 random bytes, base64. */
export function newNonce(): string {
  return randomBytes(16).toString("base64");
}

/**
 * The headers every consent, sign-in and error page is sent with. The policy is nonce-only and loads
 * nothing from another origin. There is no form-action: Chrome applies it to the redirect after the
 * POST, which would block the 303 back to the app. Referrer-Policy is same-origin, not no-referrer,
 * because no-referrer makes a same-origin form POST send Origin: null.
 */
export function pageHeaders(nonce: string): Record<string, string> {
  return {
    "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
    "X-Openvwx-Page": "oauth",
  };
}

/** What the consent page shows: the request, its csrf value, the app and the signed-in person. */
export interface ConsentView {
  readonly nonce: string;
  readonly requestId: string;
  readonly csrf: string;
  readonly app: ClientLook;
  readonly user: { readonly name: string; readonly email: string };
}

/** What the sign-in page shows: the request, the app, the sign-in providers and whether email sign-in is on. */
export interface SignInView {
  readonly nonce: string;
  readonly requestId: string;
  readonly app: ClientLook;
  readonly providers: readonly { readonly id: string; readonly label: string }[];
  readonly email: boolean;
}

// The page's style. Solid panels with no blur or transparency, the colours of web/src/tokens.css in
// both light and dark. Kept as one constant so the frame can put it in a single nonce'd style tag.
const CSS = `:root{color-scheme:dark;--bg:#1d1d1d;--panel:#262626;--panel-2:#232323;--border:rgba(255,255,255,.08);--text:rgba(255,255,255,.95);--text-2:rgba(255,255,255,.6);--accent:#5ea8ff;--accent-text:#111;--btn:rgba(255,255,255,.12);--warn:#f2c879;--font:"Spline Sans","Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#f6f6f6;--panel:#fff;--panel-2:#fafafa;--border:rgba(0,0,0,.1);--text:rgba(0,0,0,.88);--text-2:rgba(0,0,0,.55);--accent:#1a7fe0;--accent-text:#fff;--btn:rgba(0,0,0,.07);--warn:#8a5a00}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 var(--font)}
main{max-width:440px;margin:0 auto;padding:48px 16px}
.brand{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:16px}
.panel{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:24px}
h1{font-size:18px;line-height:1.3;margin:0 0 12px}
p{margin:0 0 12px}
.muted{color:var(--text-2)}
.warn{color:var(--warn)}
.app{background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:12px 12px 0;margin:0 0 16px;overflow-wrap:anywhere}
ul.can{margin:0 0 16px;padding-left:18px}
ul.can li{margin:4px 0}
.actions{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}
.stack{display:flex;flex-direction:column;gap:8px;margin:0 0 16px}
.btn{appearance:none;border:0;border-radius:6px;padding:8px 16px;font:inherit;font-weight:500;cursor:pointer;background:var(--btn);color:var(--text);text-decoration:none;display:inline-block;text-align:center}
.btn.primary{background:var(--accent);color:var(--accent-text)}
.btn:disabled{opacity:.6;cursor:default}
input[type=email]{width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--border);background:var(--panel-2);color:var(--text);font:inherit}
.foot{font-size:12px;color:var(--text-2);margin:16px 0 0}
.link{background:none;border:0;padding:0;color:var(--accent);font:inherit;cursor:pointer;text-decoration:underline}`;

// The email sign-in script. It takes no values: the redirect comes from the form's data attribute, so
// nothing from the request is ever put into script text. It polls /api/me after the email goes out and
// reloads once the person is signed in (the link opened in this browser).
const EMAIL_SCRIPT = `const form = document.getElementById("email");
const said = document.getElementById("email-said");
let watching = false;
function check() {
  return fetch("/api/me", { credentials: "same-origin" })
    .then((r) => r.json())
    .then((j) => {
      if (j && j.user) location.reload();
      return !!(j && j.user);
    })
    .catch(() => false);
}
function watch() {
  if (watching) return;
  watching = true;
  const started = Date.now();
  const tick = () => {
    if (Date.now() - started > 15 * 60 * 1000) return;
    check().then((done) => {
      if (!done) setTimeout(tick, 3000);
    });
  };
  setTimeout(tick, 3000);
}
window.addEventListener("focus", () => void check());
if (form) {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const button = form.querySelector("button");
    const email = form.elements.namedItem("email").value.trim();
    button.disabled = true;
    fetch("/api/auth/email", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Requested-With": "openvwx" },
      body: JSON.stringify({ email, redirect: form.dataset.redirect }),
    })
      .then((res) => res.json().catch(() => ({})).then((body) => ({ res, body })))
      .then(({ res, body }) => {
        said.textContent = res.ok
          ? "Check your email and open the link in this browser. This page goes on by itself once you're signed in."
          : body.error || "Rodeo couldn't send the link. Try again.";
        if (res.ok) watch();
      })
      .catch(() => {
        said.textContent = "Rodeo's server couldn't be reached. Try again.";
      })
      .finally(() => {
        button.disabled = false;
      });
  });
}`;

/** The page around each one: the head, the brand line, one panel with the page's content, and an optional script. */
function frame(nonce: string, title: string, inner: string, script?: string): string {
  const n = escapeHtml(nonce);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Rodeo</title>
<style nonce="${n}">${CSS}</style>
</head>
<body>
<main>
<div class="brand"><img src="/icon.svg" width="24" height="24" alt=""> Rodeo</div>
<div class="panel">${inner}</div>
</main>
${script ? `<script nonce="${n}">${script}</script>` : ""}
</body>
</html>`;
}

/**
 * The app's box: its name, where Rodeo sends the person back, and how far Rodeo can vouch for it.
 * A local app is always called out, because any program on this computer could claim to be it.
 */
function appBox(app: ClientLook): string {
  const name = escapeHtml(app.name);
  const where = escapeHtml(app.where);
  let body: string;
  if (app.local) {
    body = `<p><strong>${name}</strong> <span class="muted">· this computer</span></p><p class="warn">It's a program on this computer. Rodeo can't check which program: allow it only if you just started connecting ${name} here.</p>`;
  } else if (app.verified) {
    body = `<p><strong>${name}</strong> <span class="muted">· ${where}</span></p><p class="muted">Rodeo sends you back to ${where}.</p>`;
  } else {
    const details = app.detailsFrom ? ` Its details come from ${escapeHtml(app.detailsFrom)}.` : "";
    body = `<p><strong>${name}</strong></p><p class="warn">Not verified by Rodeo: this app calls itself “${name}”.</p><p class="muted">Rodeo sends you back to ${where}.${details}</p>`;
  }
  return `<div class="app">${body}</div>`;
}

/** The consent page: what the app will be able to do as the signed-in person, with Cancel and Allow. */
export function consentPage(v: ConsentView): string {
  const name = escapeHtml(v.app.name);
  const inner = `<h1>Connect ${name} to Rodeo?</h1>
${appBox(v.app)}
<p>As you, ${escapeHtml(v.user.name)}, it will be able to:</p>
<ul class="can">
<li>Work in your open drawings and your cloud drawings: read them, look at the plan and the 3D model, edit and build</li>
<li>Render pictures and export files</li>
</ul>
<p class="muted">It uses its own AI, not your Rodeo credit. You can remove it any time in Window › Connect an Agent… in Rodeo.</p>
<form method="post" action="/oauth/consent">
<input type="hidden" name="request" value="${escapeHtml(v.requestId)}">
<input type="hidden" name="csrf" value="${escapeHtml(v.csrf)}">
<div class="actions">
<button class="btn" type="submit" name="decision" value="deny">Cancel</button>
<button class="btn primary" type="submit" name="decision" value="allow">Allow</button>
</div>
</form>
<form method="post" action="/oauth/consent/signout" class="foot">
<input type="hidden" name="request" value="${escapeHtml(v.requestId)}">
<input type="hidden" name="csrf" value="${escapeHtml(v.csrf)}">
Signed in as ${escapeHtml(v.user.email)}. <button class="link" type="submit">Use another account</button>
</form>`;
  return frame(v.nonce, `Connect ${v.app.name}`, inner);
}

/** The sign-in page: one button per sign-in provider, and an email form when email sign-in is on. */
export function signInPage(v: SignInView): string {
  const requestId = escapeHtml(v.requestId);
  const back = encodeURIComponent(`/oauth/consent?request=${v.requestId}`);
  const providers = v.providers.length
    ? `<div class="stack">\n${v.providers
        .map(
          (p) =>
            `<a class="btn" href="${escapeHtml(`/api/auth/oauth/${encodeURIComponent(p.id)}?redirect=${back}`)}">Continue with ${escapeHtml(p.label)}</a>`,
        )
        .join("\n")}\n</div>`
    : "";
  const email = v.email
    ? `<form id="email" class="stack" data-redirect="${escapeHtml(`/oauth/consent?request=${v.requestId}`)}">
<label for="email-input" class="muted">${v.providers.length ? "Or get" : "Get"} a sign-in link by email</label>
<input id="email-input" type="email" name="email" autocomplete="email" required>
<button class="btn primary" type="submit">Email me a link</button>
<p id="email-said" class="muted" role="status"></p>
</form>
<p class="foot">Open an emailed link in this browser: this page goes on by itself once you're signed in.</p>`
    : "";
  const none = !v.providers.length && !v.email ? "<p>This Rodeo server has no way to sign in set up.</p>" : "";
  const inner = `<h1>Sign in to Rodeo to connect ${escapeHtml(v.app.name)}</h1>
${appBox(v.app)}
${providers}${email}${none}`;
  return frame(v.nonce, "Sign in", inner, v.email ? EMAIL_SCRIPT : undefined);
}

/** The error page: a title and a message, with a line telling the person where to go back to. */
export function errorPage(nonce: string, title: string, message: string): string {
  const inner = `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p class="foot">Go back to the app you were connecting and try again.</p>`;
  return frame(nonce, title, inner);
}
