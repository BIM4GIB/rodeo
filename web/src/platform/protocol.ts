// The contract between the editor and the openvwx server (server/): the JSON
// the REST API sends and takes, and the messages of the live collaboration
// socket. Types only (plus constants), so the server imports this file as is.
// docs/PLATFORM.md lists the endpoints these belong to.

export type Plan = "free" | "supporter";

/** A role in a shared drawing: editors change it, reviewers comment and mark up (crit mode), viewers look. */
export type Role = "owner" | "editor" | "reviewer" | "viewer";

export const CAN_EDIT: readonly Role[] = ["owner", "editor"];
export const CAN_COMMENT: readonly Role[] = ["owner", "editor", "reviewer"];

export interface Limits {
  /** drawings kept in the cloud (0: no limit) */
  readonly files: number;
  /** bytes of every version of every drawing together */
  readonly bytes: number;
  /** versions kept per drawing, newest first (0: all) */
  readonly versions: number;
  /** public view-only links and embeds */
  readonly shareLinks: boolean;
}

export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly plan: Plan;
  /** ISO time a supporter's plan runs to (null: not a supporter) */
  readonly supporterUntil: string | null;
  readonly usage: { readonly files: number; readonly bytes: number };
  readonly limits: Limits;
  readonly admin: boolean;
  /** AI credit left, in the server's credit currency (ServerConfig.ai.credit); null when the agents are free */
  readonly aiCredit: number | null;
}

export interface FundingLink {
  readonly label: string;
  readonly url: string;
}

/** The start hub's ad when it is a sponsor an admin set (it comes before Carbon's). */
export interface Sponsor {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly url: string;
  /** a logo or picture (absolute URL), optional */
  readonly image: string | null;
  /** the button's text, e.g. "Visit" */
  readonly cta: string;
}

/** A Carbon Ads placement for the start hub's ad (carbonads.net): the codes Carbon gives a site. */
export interface CarbonAd {
  readonly serve: string;
  readonly placement: string;
}

export interface Funding {
  readonly currency: string;
  /** what hosting costs a month, in whole currency units */
  readonly goalMonthly: number;
  /** what an admin has put down as raised this month (donations from elsewhere, say) */
  readonly raisedThisMonth: number;
  /** given through the Stripe donation link this calendar month (UTC), counted by the server, on top of raisedThisMonth */
  readonly donatedThisMonth?: number;
  readonly links: readonly FundingLink[];
}

/** A note on the start screen's news list, written by an admin (Help > Announcements…). */
export interface Announcement {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** a link to read more (absolute URL), optional */
  readonly url: string | null;
  /** ISO date it was posted; the list shows the newest first */
  readonly date: string;
  /** also shown once as a bar across the top of the editor, until this date (ISO); absent or null: only in What's new */
  readonly bannerUntil?: string | null;
}

export type FeedbackKind = "bug" | "idea" | "other";

/**
 * The details a report may carry, so a bug can be reproduced; never the drawing or its name. "file"
 * is the kind and size of the file the report is about, and how it opened ("DWG, 2.4 MB, opened").
 */
export const FEEDBACK_CONTEXT_KEYS = ["version", "browser", "platform", "screen", "language", "theme", "view", "drawing", "file"] as const;
export type FeedbackContext = Partial<Record<(typeof FEEDBACK_CONTEXT_KEYS)[number], string>>;

/** What a report carries beyond its one-line details, with them, for looking into a bug. */
export interface FeedbackDiagnostics {
  /** where it happened: the build, browser, GPU, memory (as error reports carry) */
  readonly env?: Readonly<Record<string, ReportValue>>;
  /** the drawing on screen: its layers, objects, view and zoom (no names) */
  readonly workspace?: Readonly<Record<string, ReportValue>>;
  /** what happened just before, oldest first: messages shown, console errors, freezes */
  readonly trail?: readonly string[];
}

/** POST /api/feedback: a bug report or a feature request, from anyone. */
export interface NewFeedback {
  readonly kind: FeedbackKind;
  readonly message: string;
  /** where to reply, optional */
  readonly email: string | null;
  readonly context: FeedbackContext | null;
  readonly diagnostics?: FeedbackDiagnostics | null;
  /**
   * What the sender chose to attach, sent after the report with the token its answer gives
   * (PUT /api/feedback/:id/screenshot, and the file in parts to /api/feedback/:id/file).
   */
  readonly attach?: { readonly screenshot: boolean; readonly file: { readonly name: string; readonly size: number } | null } | null;
}

/** POST /api/feedback's answer; `token` (for an hour) lets the attachments follow. */
export interface FeedbackSent {
  readonly id: string;
  readonly token: string | null;
  /** why the file can't come (too large, no room), or null */
  readonly fileRefused: string | null;
}

/** A report as admins see it (Help > Feedback Inbox…). */
export interface Feedback extends NewFeedback {
  readonly id: string;
  /** the account's name when it was sent signed in */
  readonly userName: string | null;
  readonly status: "new" | "done";
  readonly createdAt: string;
  /** a screenshot arrived (GET /api/admin/feedback/:id/screenshot) */
  readonly screenshot: boolean;
  /** the file it was sent with (GET /api/admin/feedback/:id/file); `received` is less than `size` while it arrives, or when it stopped */
  readonly file: { readonly name: string; readonly size: number; readonly received: number } | null;
}

/**
 * What an error report is about: an error nothing caught ("crash"), a failure the user was told
 * of ("failure"), work that took far too long ("slow"), or an error in the server ("server").
 */
export type ErrorReportKind = "crash" | "failure" | "slow" | "server";

/** A short value in an error report's details or environment. */
export type ReportValue = string | number | boolean | null;

/** POST /api/reports: what the editor sends on its own when something breaks or crawls. */
export interface NewErrorReport {
  readonly kind: ErrorReportKind;
  /** the part of Rodeo it happened in: "render", "cloud-save", "autosave", "window", … */
  readonly area: string;
  readonly message: string;
  readonly stack?: string;
  /** what bears on it: sizes, timings, the render's engine and samples */
  readonly details?: Readonly<Record<string, ReportValue>>;
  /** where it happened: the build, browser, GPU, memory, view */
  readonly env?: Readonly<Record<string, ReportValue>>;
  /** what happened just before, oldest first ("+12.3s toast: Render failed: …") */
  readonly trail?: readonly string[];
}

/** An error report as admins read it. */
export interface ErrorReport extends NewErrorReport {
  readonly id: string;
  /** the account's name when it was sent signed in */
  readonly userName: string | null;
  readonly createdAt: string;
}

/** Reports of the same error (kind, area and message, numbers aside), with the latest in full. */
export interface ErrorReportGroup {
  readonly fingerprint: string;
  readonly kind: ErrorReportKind;
  readonly area: string;
  readonly message: string;
  /** every report of it since the group was last cleared (only the latest few are kept in full) */
  readonly count: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly latest: ErrorReport;
}

/** GET /api/config: what this server offers, for the editor to show only what works. */
export interface ServerConfig {
  readonly version: string;
  /** sign-in methods set up on this server */
  readonly auth: { readonly email: boolean; readonly oauth: readonly ("google" | "microsoft" | "github")[] };
  readonly billing: boolean;
  readonly collab: boolean;
  /** client ids for opening and saving drawings in the user's own drives (null: not set up) */
  readonly drives: {
    readonly google: { readonly clientId: string; readonly apiKey: string; readonly appId: string } | null;
    readonly microsoft: { readonly clientId: string } | null;
  };
  readonly funding: Funding | null;
  readonly sponsor: Sponsor | null;
  /** the start hub's ad from Carbon, when there is no sponsor (null or missing: none) */
  readonly carbon?: CarbonAd | null;
  /** the start screen's news, newest first (empty: none) */
  readonly announcements: readonly Announcement[];
  readonly plans: {
    readonly free: Limits;
    readonly supporter: Limits & { readonly monthly: string; readonly yearly: string };
  };
  /** the Agents panel's models (null: the server has no model key, and no agents) */
  readonly ai: {
    readonly planner: string;
    readonly worker: string;
    readonly models: readonly string[];
    /** pay as you go (null: free to use within the request limits) */
    readonly credit: AiCreditTerms | null;
  } | null;
  /** the credit the agents and cloud renders take from (null: they are free, or neither is set up) */
  readonly credit?: AiCreditTerms | null;
  /** cloud renders (null: not set up on this server) */
  readonly render?: RenderTerms | null;
  /** voice commands' speech to text on the server (null or missing: none) */
  readonly voice?: VoiceTerms | null;
  /** the largest drawing or render job the server takes, in bytes */
  readonly maxUploadBytes?: number;
}

/** How cloud renders run: on what GPU, at what price, for how long at most. */
export interface RenderTerms {
  readonly gpu: string;
  /** what a minute of a render takes from the credit, in its currency, and for Rodeo Plus (null: free) */
  readonly perMinute: number | null;
  readonly plusPerMinute: number | null;
  /** the longest a job may run, minutes */
  readonly maxMinutes: number;
}
/** Voice commands' speech to text on the server, for browsers with none of their own. */
export interface VoiceTerms {
  /** POST /api/voice/transcribe turns recordings into text here */
  readonly transcribe: boolean;
  /** who turns the speech into text, for the privacy text ("Google, through OpenRouter"); null without it */
  readonly by: string | null;
}
/** POST /api/voice/transcribe: a recording as 16 kHz mono 16-bit WAV in base64, its language (BCP 47, or "") and the drawing's names. */
export interface VoiceTranscribeRequest {
  readonly audio: string;
  readonly lang: string;
  readonly hints: readonly string[];
}
/** What a request was charged and the credit left, in the credit's currency (null: free, or not known yet). */
export interface VoiceCharge {
  readonly charged: number | null;
  readonly balance: number | null;
}
/** Its answer: the words heard ("" for none). */
export interface VoiceTranscript extends VoiceCharge {
  readonly text: string;
}

/** POST /api/render/jobs: what the job is, in its X-Render-Job header (JSON); the body is the gzipped pack. */
export interface NewRenderJob {
  /** the drawing's name, for the list of renders */
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly samples: number;
  /** pictures in the job (cameras) */
  readonly shots: number;
  /** minutes each picture may take, 0 for no limit */
  readonly minutes: number;
}

export type RenderState = "starting" | "running" | "done" | "failed" | "cancelled";

/** A picture a cloud render made: GET /api/render/jobs/{id}/pictures/{n}. */
export interface RenderPicture {
  readonly name: string;
  readonly mime: string;
  readonly samples: number | null;
  readonly seconds: number;
  readonly bytes: number;
}

/** A cloud render, as its owner sees it. */
export interface RenderJob {
  readonly id: string;
  readonly state: RenderState;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly samples: number;
  readonly shots: number;
  readonly gpu: string;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  /** seconds it may run */
  readonly limitSeconds: number;
  /** while it runs: what it is doing, how far along, and a small picture so far (a JPEG data URL) */
  readonly progress: { readonly label: string; readonly fraction: number | null; readonly preview: string | null } | null;
  /** what its owner asked of it while it runs */
  readonly stop: "finish" | "cancel" | null;
  /** seconds it ran, once finished */
  readonly seconds: number | null;
  /** what it took from the credit, in its currency (null: free, or not finished) */
  readonly charged: number | null;
  readonly error: string | null;
  readonly pictures: readonly RenderPicture[];
}

/** How AI credit is sold: what it is in, the top-ups offered, and what a request costs. */
export interface AiCreditTerms {
  /** an ISO code, lower case */
  readonly currency: string;
  /** the amounts a top-up may be */
  readonly topups: readonly number[];
  /** the credit a request needs to start */
  readonly hold: number;
  /** what a request costs against what the model provider charged (1.3: 30% more), and for Rodeo Plus */
  readonly markup: number;
  readonly plusMarkup: number;
  /** whether credit can be bought here (Stripe is set up) */
  readonly sold: boolean;
}

/** GET /api/ai/credit: the balance, the latest top-ups and grants, and what the agents used each day. */
export interface AiCreditInfo {
  readonly balance: number;
  readonly currency: string;
  /** a grant's note is the admin's word on it ("Welcome credit") */
  readonly moves: readonly { readonly kind: "topup" | "grant"; readonly amount: number; readonly at: string; readonly note?: string }[];
  /** newest first; amount is what was spent that day, steps the model requests */
  readonly days: readonly { readonly amount: number; readonly steps: number; readonly at: string }[];
  /** the same for cloud renders: what they cost that day, and how many */
  readonly renders?: readonly { readonly amount: number; readonly count: number; readonly at: string }[];
}

export interface CloudFile {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly ownerId: string;
  readonly ownerName: string;
  /** the caller's role */
  readonly role: Role;
  readonly headVersionId: string;
  readonly hasThumbnail: boolean;
}

export interface Version {
  readonly id: string;
  readonly fileId: string;
  readonly createdAt: string;
  readonly size: number;
  readonly authorId: string;
  readonly authorName: string;
  readonly label: string | null;
  /** saved by autosave; a big drawing's next autosave replaces it unless it is named */
  readonly autosave?: boolean;
}

export interface Member {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly avatarUrl: string | null;
  readonly role: Role;
}

export interface Invite {
  readonly token: string;
  readonly fileId: string;
  readonly role: Exclude<Role, "owner">;
  /** the link to send: PUBLIC_URL/?invite=token */
  readonly url: string;
  readonly expiresAt: string;
}

export interface Share {
  readonly token: string;
  readonly fileId: string;
  readonly allowDownload: boolean;
  /** PUBLIC_URL/?share=token */
  readonly url: string;
  /** PUBLIC_URL/?embed=token, for an <iframe> */
  readonly embedUrl: string;
  readonly createdAt: string;
}

/** What a share link shows before the drawing loads (GET /api/s/:token). */
export interface SharedFile {
  readonly fileName: string;
  readonly ownerName: string;
  readonly allowDownload: boolean;
  readonly updatedAt: string;
}

/** A pin on the drawing (2D: world mm on a layer; 3D: a point in the model). */
export type Anchor =
  | { readonly kind: "2d"; readonly layerId: string; readonly x: number; readonly y: number }
  | { readonly kind: "3d"; readonly x: number; readonly y: number; readonly z: number };

/** A redline: a freehand stroke on a layer, in world mm. */
export interface Stroke {
  readonly layerId: string;
  readonly points: readonly (readonly [number, number])[];
  readonly color: string;
  /** on screen, in CSS px */
  readonly width: number;
}

/** A crit-mode comment: a pin, a redline or both, with text and/or a voice note; replies have parentId. */
export interface Comment {
  readonly id: string;
  readonly fileId: string;
  readonly parentId: string | null;
  readonly authorId: string;
  readonly authorName: string;
  readonly createdAt: string;
  readonly body: string;
  readonly anchor: Anchor | null;
  readonly strokes: readonly Stroke[];
  readonly audio: { readonly id: string; readonly durationMs: number } | null;
  readonly resolved: boolean;
}

export type NewComment = Pick<Comment, "parentId" | "body" | "anchor" | "strokes" | "audio">;

/** An error body: every failing endpoint answers { error } with a 4xx/5xx status. */
export interface ApiError {
  readonly error: string;
  /** e.g. "limit" (plan limit reached), "conflict" (a newer version exists), "auth" (sign in) */
  readonly code?: string;
}

// ---- live collaboration (WebSocket at /api/collab/:fileId) ----------------------
//
// The server orders every change. A client sends one change at a time and waits for
// its ack before sending the next; `base` is the last seq it has applied. The server
// rewrites a change made against an older seq past the ones since (core/splice.ts),
// or refuses it when they touch the same records. Records travel as base64.

/**
 * The version of the change messages. A client says it in hello; the server turns away one
 * older than its own (closing with 4003 "outdated"), whose copy would come apart from everyone's.
 * 2: a change can have several runs (WireOp.more).
 */
export const COLLAB_PROTOCOL = 2;

/** `del` records from `start` replaced by `add` (records base64). */
export interface WireRun {
  readonly start: number;
  readonly del: number;
  readonly add: readonly string[];
}

/** One change to the record list (core SpliceOp, records base64): its first run, then each of `more` in turn. */
export interface WireOp extends WireRun {
  /** further runs in order (core/splice.ts inOrder), each at the positions the ones before it left */
  readonly more?: readonly WireRun[];
  readonly kind: "objects" | "layers" | "classes" | "all";
  readonly ids: readonly string[];
  /**
   * File header bytes the change sets too (document settings such as units), base64. Two changes
   * to the header made at the same time clash, like two to the same records.
   */
  readonly header?: { readonly at: number; readonly bytes: string };
}

export interface Peer {
  readonly clientId: string;
  readonly userId: string;
  readonly name: string;
  readonly color: string;
  readonly avatarUrl: string | null;
  readonly role: Role;
}

/** Where a collaborator is and what they look at (sent ~15 times a second at most). */
export interface Presence {
  readonly mode: "2d" | "3d";
  readonly layerId: string | null;
  /** world mm on layerId, null when the pointer is off the drawing */
  readonly cursor: { readonly x: number; readonly y: number } | null;
  readonly selection: readonly string[];
  /** the 2D view: centre (world mm) and scale (CSS px per mm) */
  readonly view: { readonly cx: number; readonly cy: number; readonly scale: number } | null;
  /** the 3D camera and the point under the pointer (world mm), in 3D */
  readonly camera: { readonly position: readonly [number, number, number]; readonly target: readonly [number, number, number] } | null;
  readonly pointer3d: readonly [number, number, number] | null;
}

/** A layer checked out for one member's editing alone (Project Sharing): the others can't change it until it is released. */
export interface Checkout {
  /** the layer's id (its GUID in the drawing) */
  readonly layerId: string;
  readonly userId: string;
  /** the holder's name */
  readonly name: string;
  /** ISO time it was checked out */
  readonly at: string;
}

/** Most layers one checkout or release message names. */
export const MAX_CHECKOUT_LAYERS = 1000;

export type ClientMessage =
  /** first message: the version the client loaded (from GET /api/files/:id/content, header X-Version-Id) */
  | { readonly t: "hello"; readonly versionId: string; readonly proto: number }
  | { readonly t: "op"; readonly id: number; readonly base: number; readonly op: WireOp }
  | { readonly t: "presence"; readonly p: Presence }
  /** the client saved a version holding every change up to seq (PUT content with X-Collab-Seq) */
  | { readonly t: "saved"; readonly seq: number; readonly versionId: string }
  /** checks layers out for this member alone (editors and owners); layers someone else holds stay theirs */
  | { readonly t: "checkout"; readonly layers: readonly string[] }
  /** gives layers back: the member's own, or anyone's when the member owns the drawing */
  | { readonly t: "release"; readonly layers: readonly string[] }
  | { readonly t: "ping" };

export type ServerMessage =
  /**
   * Answer to hello. `ops` are the changes since the version the client loaded, to apply in
   * order; `seq` is the last of them. `reload` asks the client to fetch the content again
   * (it loaded a version the room has moved past).
   */
  | {
      readonly t: "welcome";
      readonly you: Peer;
      readonly peers: readonly Peer[];
      readonly presence: Readonly<Record<string, Presence>>;
      readonly seq: number;
      readonly ops: readonly { readonly seq: number; readonly op: WireOp }[];
      /** the layers checked out now (left out by servers before Project Sharing) */
      readonly checkouts?: readonly Checkout[];
    }
  | { readonly t: "reload" }
  | { readonly t: "ack"; readonly id: number; readonly seq: number }
  | { readonly t: "reject"; readonly id: number; readonly reason: string }
  | { readonly t: "op"; readonly seq: number; readonly clientId: string; readonly op: WireOp }
  | { readonly t: "presence"; readonly clientId: string; readonly p: Presence }
  | { readonly t: "join"; readonly peer: Peer }
  | { readonly t: "leave"; readonly clientId: string }
  /** this client should save a version (it is an editor and the room has many unsaved changes) */
  | { readonly t: "save-request" }
  /** The drawing's owner has no room on their plan for another version, so none is being asked for. */
  | { readonly t: "save-blocked"; readonly error: string }
  | { readonly t: "comment"; readonly comment: Comment }
  | { readonly t: "comment-deleted"; readonly id: string }
  /** every layer checked out now, after a checkout or release by anyone */
  | { readonly t: "checkouts"; readonly checkouts: readonly Checkout[] }
  | { readonly t: "error"; readonly error: string }
  | { readonly t: "pong" };

// ---- the admin page (server/src/admin.ts, web/src/admin) ----

/** How a visit to the editor began: the editor itself, a share link, an invite, an embed, or the installed app. */
export type VisitEntry = "editor" | "share" | "invite" | "embed" | "app" | "convert";

/** A label and how many: a row of a breakdown (referrers, countries...). */
export interface Tally {
  readonly label: string;
  readonly count: number;
}

/** One day (UTC) of the overview's charts. */
export interface AdminDay {
  /** YYYY-MM-DD */
  readonly day: string;
  /** visitors not signed in */
  readonly guests: number;
  /** signed-in visitors (accounts) */
  readonly members: number;
  readonly signups: number;
  /** drawings opened */
  readonly opens: number;
  /** credit bought, in the credit's currency */
  readonly topups: number;
  /** credit the agents and cloud renders used */
  readonly usage: number;
}

/** GET /api/admin/overview?days=N: the admin page's front. Visitors leave admins out. */
export interface AdminOverview {
  readonly days: number;
  /** the credit's currency (null: no credit on this server, so `money` is null too) */
  readonly currency: string | null;
  /** in the editor within the last 5 minutes */
  readonly now: { readonly guests: number; readonly members: number };
  /** this period, and the one of the same length before it */
  readonly period: AdminPeriod;
  readonly previous: AdminPeriod;
  readonly accounts: {
    readonly total: number;
    /** Rodeo Plus now; paid through Stripe, the rest given by an admin */
    readonly plus: number;
    readonly plusPaid: number;
    readonly suspended: number;
    /** drawings in the cloud and their bytes, every version */
    readonly files: number;
    readonly bytes: number;
  };
  readonly money: {
    /** every account's balance: credit sold or given and not yet used, which the model provider's balance must cover */
    readonly owed: number;
    /** this period, in the currency */
    readonly topups: number;
    readonly granted: number;
    readonly agents: number;
    readonly renders: number;
    /** what the providers charged for that use, in US dollars */
    readonly providerUsd: number;
  } | null;
  readonly series: readonly AdminDay[];
  readonly breakdowns: {
    readonly referrers: readonly Tally[];
    readonly campaigns: readonly Tally[];
    readonly countries: readonly Tally[];
    readonly devices: readonly Tally[];
    readonly browsers: readonly Tally[];
    readonly systems: readonly Tally[];
    readonly entries: readonly Tally[];
    /** drawings opened by kind ("vwx", "dwg", "blank") */
    readonly formats: readonly Tally[];
    /** the check after a file comes in, by answer: "asked", "failed", "ok", "report", "closed" */
    readonly checks: readonly Tally[];
  };
  /** what waits on the admin page's Feedback and Errors tabs */
  readonly inbox: { readonly feedback: number; readonly errors: number };
}

export interface AdminPeriod {
  /** visitors summed over the days (a visitor is known for one day only) */
  readonly visits: number;
  readonly guestVisits: number;
  /** different accounts that used the editor */
  readonly activeMembers: number;
  readonly signups: number;
  /** guests who made an account the same day */
  readonly converted: number;
  /** drawings opened */
  readonly opens: number;
  /** the middle visit's minutes in the editor */
  readonly medianMinutes: number;
}

/** An account as the admin page lists it. */
export interface AdminUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly createdAt: string;
  readonly lastSeenAt: string | null;
  readonly plan: Plan;
  readonly supporterUntil: string | null;
  /** pays for Rodeo Plus through Stripe (else a plan an admin gave, or none) */
  readonly paidPlus: boolean;
  /** AI credit left (null: no credit on this server) */
  readonly credit: number | null;
  /** credit the account has used, bought and been given, in all */
  readonly spent: number;
  readonly bought: number;
  readonly granted: number;
  readonly files: number;
  readonly bytes: number;
  /** how it signs in: "google", "github", "microsoft", or "email" alone */
  readonly providers: readonly string[];
  readonly suspended: boolean;
  readonly admin: boolean;
}

export type AdminUserSort = "joined" | "seen" | "credit" | "spent" | "files" | "name";
export type AdminUserFilter = "all" | "plus" | "credit" | "spenders" | "suspended";

/** GET /api/admin/users/:id: an account and what it has done. */
export interface AdminUserDetail {
  readonly user: AdminUser;
  /** the latest credit moves, newest first; agent use is gathered a day at a time */
  readonly ledger: readonly AdminLedgerRow[];
  /** days in the editor of the last 30 */
  readonly daysActive: number;
  /** the latest visit's device, browser, system and country */
  readonly lastVisit: { readonly device: string; readonly browser: string; readonly os: string; readonly country: string | null } | null;
  readonly renders: number;
  readonly feedback: number;
}

export interface AdminLedgerRow {
  readonly kind: "topup" | "grant" | "usage" | "renders";
  readonly amount: number;
  readonly at: string;
  /** the grant's note; for usage, how many requests that day */
  readonly note: string | null;
  /** who gave a grant (an admin's email, "welcome") */
  readonly by: string | null;
}

/** GET and PUT /api/admin/settings: what the admin page sets. */
export interface AdminSettings {
  /** credit each new account starts with (0: none) */
  readonly welcomeCredit: number;
}

/** Someone in the editor now (heard from in the last 3 minutes): one visitor-day row of the visits table. */
export interface AdminLiveVisitor {
  /** the day's visitor hash, cut short: stable between polls the same day, for keeping a dot in place */
  readonly key: string;
  /** the account, when signed in */
  readonly member: { readonly id: string; readonly name: string; readonly email: string } | null;
  /** two-letter country, city and region (Cloudflare's), when known */
  readonly country: string | null;
  readonly city: string | null;
  readonly region: string | null;
  /** roughly where (Cloudflare's, rounded to 0.1°); null when unknown, and the globe uses the country's middle */
  readonly lat: number | null;
  readonly lon: number | null;
  readonly device: string;
  readonly browser: string;
  readonly os: string;
  readonly entry: VisitEntry;
  readonly referrer: string | null;
  /** came today at, last heard from at (ISO) */
  readonly firstAt: string;
  readonly lastAt: string;
  /** drawings opened today */
  readonly opens: number;
}

/** GET /api/admin/live: who is in the editor now. The admin page asks every 10 s on its Live tab. */
export interface AdminLive {
  /** the server's time (ISO) */
  readonly at: string;
  /** newest first, at most 300; admins left out */
  readonly visitors: readonly AdminLiveVisitor[];
  /** people in the editor once a minute, oldest first, the last 60 minutes the server has been up (it forgets on restart) */
  readonly recent: readonly { readonly at: string; readonly guests: number; readonly members: number }[];
  /** today (UTC) so far */
  readonly today: { readonly visitors: number; readonly members: number; readonly signups: number; readonly opens: number };
  /** drawings open in a live session (cloud drawings), the people in them, and how many have two or more */
  readonly sessions: { readonly drawings: number; readonly people: number; readonly together: number };
}

/** A place visitors came from in the period: a city where Cloudflare named one, else the country alone. */
export interface AdminPlace {
  readonly country: string;
  readonly city: string | null;
  readonly region: string | null;
  /** the city's rough position, or null (the globe uses the country's middle) */
  readonly lat: number | null;
  readonly lon: number | null;
  readonly visits: number;
  /** different accounts */
  readonly members: number;
}

/** A country's row in GET /api/admin/geo. */
export interface AdminCountry {
  /** two letters */
  readonly code: string;
  readonly visits: number;
  readonly members: number;
  /** accounts made in the period whose visit that day came from here */
  readonly signups: number;
  readonly opens: number;
  /** the middle visit's minutes */
  readonly medianMinutes: number;
}

/** GET /api/admin/geo?days=N: where the period's visitors were. Admins left out. */
export interface AdminGeo {
  readonly days: number;
  /** most visits first, every country */
  readonly countries: readonly AdminCountry[];
  /** most visits first, at most 400 */
  readonly places: readonly AdminPlace[];
  /** visits with a city known, and all visits: below 1, Cloudflare's location headers are off or new */
  readonly located: number;
  readonly total: number;
}

/** GET /api/admin/engagement?days=N: how people use the editor over time. Admins left out. */
export interface AdminEngagement {
  readonly days: number;
  /** each day of the period: accounts in the editor that day, in the 7 days to it, and the 30 days to it */
  readonly active: readonly { readonly day: string; readonly dau: number; readonly wau: number; readonly mau: number }[];
  /** visits by the weekday (0 Sunday) and hour (UTC) they began: 7 rows of 24 */
  readonly hours: readonly (readonly number[])[];
  /** how long visits lasted, shortest first: "Under 1 min", "1–5 min", "5–15 min", "15–30 min", "30–60 min", "1–2 h", "Over 2 h" */
  readonly lengths: readonly Tally[];
  /** drawings opened in a visit: "None", "1", "2–3", "4–9", "10 or more" */
  readonly opensPerVisit: readonly Tally[];
  /** the period from visiting to paying, each step a subset of the one before as far as can be known */
  readonly funnel: readonly { readonly label: string; readonly count: number; readonly note: string | null }[];
  /** weekly sign-up cohorts (weeks start Monday, UTC), oldest first, at most 12: of those who joined, how many were in the editor each week after (weeks[0] = the week they joined) */
  readonly cohorts: readonly { readonly week: string; readonly size: number; readonly weeks: readonly number[] }[];
  /** signed-in visitors a day: accounts made in the last 7 days, and older ones */
  readonly members: readonly { readonly day: string; readonly fresh: number; readonly returning: number }[];
}

/** GET /api/admin/revenue?days=N: what the period earned and what it cost. */
export interface AdminRevenue {
  readonly days: number;
  /** the credit's currency, or null when this server has no credit (then the credit fields are 0) */
  readonly currency: string | null;
  readonly plus: {
    readonly paid: number;
    readonly given: number;
    /** the prices as the sign-up page shows them ("£2/month") */
    readonly monthlyLabel: string;
    readonly yearlyLabel: string;
  };
  /** the agents' use in the period by model, most charged first */
  readonly models: readonly {
    readonly model: string;
    readonly steps: number;
    readonly users: number;
    /** credit taken, in the currency */
    readonly charged: number;
    readonly costUsd: number;
    readonly tokensIn: number;
    readonly tokensOut: number;
  }[];
  /** cloud renders made in the period */
  readonly renders: { readonly jobs: number; readonly finished: number; readonly failed: number; readonly gpuSeconds: number; readonly charged: number };
  /** the accounts that used the most credit in the period, at most 10 */
  readonly topSpenders: readonly { readonly id: string; readonly name: string; readonly email: string; readonly spent: number; readonly bought: number }[];
  /** each day of the period: credit bought, credit taken for use, and what the providers charged for that use */
  readonly daily: readonly { readonly day: string; readonly topups: number; readonly charged: number; readonly costUsd: number }[];
  /** the period's credit taken and the providers' cost in the same currency (at the server's rate); null without credit */
  readonly margin: { readonly charged: number; readonly cost: number } | null;
}

/** GET /api/admin/usage?days=N: what is in the cloud and what people make with Rodeo. */
export interface AdminUsage {
  readonly days: number;
  readonly files: {
    readonly total: number;
    /** made in the period */
    readonly fresh: number;
    readonly versions: number;
    readonly bytes: number;
    /** branches of other drawings */
    readonly branches: number;
    /** with a share link */
    readonly shared: number;
    /** shared with other accounts as members */
    readonly withMembers: number;
    /** by the name's extension, most first */
    readonly kinds: readonly Tally[];
  };
  /** cloud drawings made each day of the period */
  readonly daily: readonly { readonly day: string; readonly files: number; readonly versions: number }[];
  readonly gallery: { readonly published: number; readonly hidden: number; readonly openReports: number; readonly forks: number; readonly fresh: number };
  /** in the period */
  readonly comments: number;
  readonly mergeRequests: number;
  readonly agents: {
    /** apps people let in with OAuth, and personal agent tokens, now */
    readonly apps: number;
    readonly tokens: number;
    /** accounts that used the agents in the period */
    readonly users: number;
  };
}

/** One step an admin took, as the log keeps it. */
export interface AdminLogEntry {
  readonly id: number;
  readonly at: string;
  readonly admin: string;
  /** "credit.grant", "user.suspend", "announcement.post", "gallery.hide"... */
  readonly action: string;
  /** what it was done to: an account's email, an announcement's title, a drawing's title */
  readonly target: string | null;
  readonly detail: string | null;
}

/** GET /api/admin/system: the server's health and what it is set up with. */
export interface AdminSystem {
  readonly version: string;
  readonly node: string;
  /** seconds since the server started */
  readonly uptime: number;
  readonly memory: { readonly rss: number; readonly heapUsed: number; readonly heapTotal: number };
  /** bytes: the database (with its WAL), and the data disk's size and free space (null where unknown) */
  readonly storage: { readonly database: number; readonly diskTotal: number | null; readonly diskFree: number | null };
  /** rows in the main tables */
  readonly tables: readonly Tally[];
  /** what is set up, each with a word on how: [name, on, note] */
  readonly features: readonly { readonly name: string; readonly on: boolean; readonly note: string | null }[];
  readonly admins: readonly string[];
  readonly publicUrl: string;
  /** whether Cloudflare's visitor location headers reached the server in the last day (cities on the globe) */
  readonly locationHeaders: boolean;
}

/** Ask an editor to save once this many changes are unsaved, or after this long. */
export const SAVE_EVERY_OPS = 60;
export const SAVE_EVERY_MS = 120_000;
/**
 * A drawing larger than BIG_DRAWING is autosaved only every SAVE_BIG_EVERY_MS, however many
 * changes: writing it out freezes the editor for seconds, and each copy counts against the plan's
 * storage. Its autosaves replace each other (X-Autosave: replace).
 */
export const BIG_DRAWING = 100 * 1024 * 1024;
export const SAVE_BIG_EVERY_MS = 15 * 60_000;

/** Colours given to collaborators in turn. */
export const PEER_COLORS: readonly string[] = ["#e5484d", "#30a46c", "#0090ff", "#f76b15", "#8e4ec6", "#12a594", "#d6409f", "#ffc53d"];
