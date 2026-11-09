// Connect an Agent: the dialog where a person connects an outside agent (Claude, ChatGPT, Claude Code,
// Cursor or another MCP client). It lists the apps connected by signing in, which can be removed;
// shows how each app signs in; and makes the personal access tokens for agents that take a header
// instead, which can be renamed or removed. A token's secret is shown once, here. It is kept nowhere
// else: not in storage, and not in the page once the panel is replaced or closed.

import { h } from "../../app/dom.ts";
import { confirmDialog } from "../../app/menubar.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { serverConfig } from "../../platform/api.ts";
import { requireSignIn } from "../account/signin.ts";
import { copyRow, field, note, openModal, timeAgo } from "../cloud/ui.ts";
import { holdConnection, tokensApi } from "./api.ts";
import type { AgentGrant, AgentToken, NewAgentToken } from "./wire.ts";
import "./dialog.css";

/** One way to connect: the text to paste, where it goes, and a link when the app has one. */
export interface Snippet {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  readonly note: string;
  readonly link?: string;
}

/** What each connection tab pastes: the endpoint and the token, in the form that app reads. */
export function snippets(endpoint: string, secret: string): Snippet[] {
  const cursorConfig = { url: endpoint, headers: { Authorization: `Bearer ${secret}` } };
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      text: `claude mcp add --transport http --scope user rodeo ${endpoint} --header "Authorization: Bearer ${secret}"`,
      note: "Run it in a terminal. Then ask Claude Code to work in your Rodeo drawing.",
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      // "${RODEO_AUTH}" is for Claude Desktop to read from the env block, so it stays literal here
      text: JSON.stringify(
        { mcpServers: { rodeo: { command: "npx", args: ["-y", "mcp-remote", endpoint, "--header", "Authorization:${RODEO_AUTH}"], env: { RODEO_AUTH: `Bearer ${secret}` } } } },
        null,
        2,
      ),
      note: "In Claude Desktop: Settings › Developer › Edit Config, add this, and restart Claude. It needs Node.js; mcp-remote is a small open-source bridge that runs on your computer. Claude Desktop's Connectors can also sign in without a token: see Sign in from your agent above.",
    },
    {
      id: "cursor",
      label: "Cursor",
      text: JSON.stringify({ mcpServers: { rodeo: cursorConfig } }, null, 2),
      note: "Add it to ~/.cursor/mcp.json, or use Add to Cursor.",
      // the deep link carries the config in the app's own scheme; nothing goes to a web server
      link: `cursor://anysphere.cursor-deeplink/mcp/install?name=rodeo&config=${encodeURIComponent(btoa(JSON.stringify(cursorConfig)))}`,
    },
    {
      id: "other",
      label: "Other",
      text: `MCP server: ${endpoint} (Streamable HTTP)\nHeader: Authorization: Bearer ${secret}`,
      note: "Any agent that connects to remote MCP servers with a header can use these.",
    },
  ];
}

/** How each app signs in to Rodeo: what to paste and where. No token: the app opens Rodeo's sign-in page. */
export function signInSteps(endpoint: string): Snippet[] {
  return [
    {
      id: "claude",
      label: "Claude",
      text: endpoint,
      note: "In Claude (claude.ai, or the desktop or phone app): Settings › Connectors › Add custom connector, paste this address and press Connect, then sign in to Rodeo and press Allow. It then works in all of Claude's apps. On a Team or Enterprise plan, an owner adds it first.",
    },
    {
      id: "claude-code",
      label: "Claude Code",
      text: `claude mcp add --transport http --scope user rodeo ${endpoint}`,
      note: "Run it in a terminal, then type /mcp in Claude Code, choose rodeo and sign in. Your browser opens Rodeo: press Allow.",
    },
    {
      id: "cursor",
      label: "Cursor",
      text: JSON.stringify({ mcpServers: { rodeo: { url: endpoint } } }, null, 2),
      note: "Add it to ~/.cursor/mcp.json or use Add to Cursor, then sign in when Cursor asks. Your browser opens Rodeo: press Allow.",
      // the deep link carries the config in the app's own scheme; nothing goes to a web server
      link: `cursor://anysphere.cursor-deeplink/mcp/install?name=rodeo&config=${encodeURIComponent(btoa(JSON.stringify({ url: endpoint })))}`,
    },
    {
      id: "chatgpt",
      label: "ChatGPT",
      text: endpoint,
      note: "In ChatGPT with developer mode on (Settings › Apps & Connectors › Advanced settings), create a connector with this address, choose OAuth, and sign in to Rodeo when it asks.",
    },
    {
      id: "other",
      label: "Other",
      text: `MCP server: ${endpoint} (Streamable HTTP, OAuth sign-in)`,
      note: "Agents that sign in to MCP servers with OAuth open Rodeo in your browser: sign in and press Allow. Agents that take only a header use a token: make one below.",
    },
  ];
}

/** Copies text to the clipboard; false when the browser refuses. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Selects an element's text, so the person can copy it by hand where the clipboard refuses. */
function selectText(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** A titled block of the dialog. */
function section(title: string, ...body: Node[]): HTMLElement {
  return h("section", { cls: "mcp-section" }, h("h3", { cls: "mcp-heading", text: title }), ...body);
}

/**
 * The tabs of one way to connect, the text of the one shown with its Copy button, and its note and
 * link. onPick is told the id of a tab the person picks, so the caller can show that one.
 */
function snippetPanel(options: readonly Snippet[], current: Snippet, onPick: (id: string) => void): HTMLElement {
  const tabs = h(
    "div",
    { cls: "seg mcp-tabs", attrs: { role: "tablist", "aria-label": "Connect with" } },
    ...options.map((s) => {
      const btn = h("button", {
        cls: s.id === current.id ? "seg-btn active" : "seg-btn",
        text: s.label,
        attrs: { type: "button", role: "tab", "aria-selected": String(s.id === current.id) },
      });
      btn.addEventListener("click", () => onPick(s.id));
      return btn;
    }),
  );

  const pre = h("pre", { cls: "mcp-snippet", text: current.text });
  const copy = h("button", { cls: "btn small", text: "Copy", attrs: { type: "button" } });
  copy.addEventListener("click", () => {
    void copyText(current.text).then((ok) => {
      if (ok) {
        copy.textContent = "Copied";
        window.setTimeout(() => {
          copy.textContent = "Copy";
        }, 1500);
        return;
      }
      selectText(pre);
      toast("Select the text and copy it.", "info");
    });
  });
  const actions = h("div", { cls: "mcp-snippet-actions" }, copy);
  if (current.link) actions.append(h("a", { cls: "btn small mcp-link", text: "Add to Cursor", attrs: { href: current.link } }));

  return h("div", { cls: "mcp-panel" }, tabs, pre, actions, note(current.note));
}

/**
 * Opens Connect an Agent. `status`, when given, says how the agent side stands (shown under the
 * intro). Resolves once the dialog is open; signing in first when the person is not signed in.
 */
export async function openConnectDialog(status?: () => string): Promise<void> {
  if (!(await serverConfig())) {
    toast("Connecting an agent needs the Rodeo server.", "info");
    return;
  }
  if (!(await requireSignIn("Sign in to connect an agent"))) return;
  // the tab connects for agents from now on, even before the person has connected one, so its tools
  // are already on the server when they connect an app from another window
  holdConnection();

  // null until the list has loaded; the endpoint comes with the list, never from the browser's own config
  let tokens: AgentToken[] | null = null;
  let grants: AgentGrant[] | null = null;
  let loadError = "";
  let endpoint = "";
  // the token just made, while its panel shows; cleared by Make Another and when the dialog closes
  let made: NewAgentToken | null = null;
  let tab = "claude-code";
  let signTab = "claude";
  let editing: string | null = null;
  let busy = false;

  const modal = openModal("Connect an Agent", "mcp-dialog");
  const appsBox = h("div", { cls: "mcp-list" });
  const listBox = h("div", { cls: "mcp-list" });
  const signInBox = h("div", { cls: "mcp-list" });
  const newBox = h("div", { cls: "mcp-new" });

  /** Fetches the tokens, the connected apps and the endpoint; throws when the server does not answer. */
  const load = async (): Promise<void> => {
    const list = await tokensApi.list();
    tokens = [...list.tokens];
    grants = [...list.grants];
    endpoint = list.endpoint;
    loadError = "";
  };

  /** Redraws everything the list fills in: the connected apps, the tokens and the sign-in steps. */
  const renderAll = (): void => {
    renderApps();
    renderList();
    renderSignIn();
  };

  /** Loads the list and shows it. A failure is shown where the list goes; false then. */
  const showList = async (): Promise<boolean> => {
    try {
      await load();
    } catch (err) {
      loadError = errorMessage(err);
    }
    renderAll();
    return tokens !== null;
  };

  /** One connected app's row: its name, where it sends the person back, when it was used, and Remove. */
  const grantRow = (g: AgentGrant): HTMLElement => {
    const remove = h("button", { cls: "btn small danger", text: "Remove", attrs: { type: "button" } });
    remove.addEventListener("click", () => void removeApp(g));
    const used = g.lastUsedAt ? `Last used ${timeAgo(g.lastUsedAt)}${g.lastClient ? ` by ${g.lastClient}` : ""}` : "Never used";
    return h(
      "li",
      { cls: "mcp-token" },
      h(
        "div",
        { cls: "mcp-token-main" },
        h(
          "div",
          { cls: "mcp-token-name" },
          h("strong", { text: g.name }),
          g.verified ? null : h("span", { cls: "mcp-unverified", text: "· not verified" }),
        ),
        h("div", { cls: "mcp-token-meta", text: `${g.where} · Connected ${timeAgo(g.createdAt)} · ${used}` }),
      ),
      h("div", { cls: "mcp-token-actions" }, remove),
    );
  };

  /** Disconnects an app after the person confirms; it loses access at once. */
  const removeApp = async (g: AgentGrant): Promise<void> => {
    if (!(await confirmDialog(`Remove ${g.name}?`, "It loses access to Rodeo at once. To use it again, connect it again from the app.", "Remove"))) return;
    try {
      await tokensApi.removeGrant(g.id);
    } catch (err) {
      toast(errorMessage(err));
      return;
    }
    grants = (grants ?? []).filter((x) => x.id !== g.id);
    renderApps();
  };

  const renderApps = (): void => {
    if (!grants) {
      appsBox.replaceChildren(loadError ? note(loadError, "mcp-warn") : note("Loading…"));
      return;
    }
    if (grants.length === 0) {
      appsBox.replaceChildren(note("No apps yet: connect one from your agent below."));
      return;
    }
    appsBox.replaceChildren(h("ul", { cls: "mcp-tokens" }, ...grants.map((g) => grantRow(g))));
  };

  /** One token's row, or its rename row while it is being renamed. */
  const tokenRow = (t: AgentToken): HTMLElement => {
    if (editing === t.id) return renameRow(t);
    const rename = h("button", { cls: "btn small", text: "Rename", attrs: { type: "button" } });
    rename.addEventListener("click", () => {
      editing = t.id;
      renderList();
    });
    const remove = h("button", { cls: "btn small danger", text: "Remove", attrs: { type: "button" } });
    remove.addEventListener("click", () => void removeOne(t));
    const used = t.lastUsedAt ? `Last used ${timeAgo(t.lastUsedAt)}${t.lastClient ? ` by ${t.lastClient}` : ""}` : "Never used";
    return h(
      "li",
      { cls: "mcp-token" },
      h(
        "div",
        { cls: "mcp-token-main" },
        h("div", { cls: "mcp-token-name" }, h("strong", { text: t.name }), h("code", { cls: "mcp-token-prefix", text: `${t.prefix}…` })),
        h("div", { cls: "mcp-token-meta", text: `Made ${timeAgo(t.createdAt)} · ${used}` }),
      ),
      h("div", { cls: "mcp-token-actions" }, rename, remove),
    );
  };

  /** The row being renamed: an input that Enter saves and Escape cancels. */
  const renameRow = (t: AgentToken): HTMLElement => {
    const input = h("input", { cls: "share-input mcp-rename", value: t.name, attrs: { type: "text", maxlength: "60", "aria-label": `Rename ${t.name}` } });
    const stop = (): void => {
      editing = null;
      renderList();
    };
    const save = async (): Promise<void> => {
      const name = input.value.trim();
      if (name === t.name) {
        stop();
        return;
      }
      input.disabled = true;
      try {
        const updated = await tokensApi.rename(t.id, name);
        tokens = (tokens ?? []).map((x) => (x.id === t.id ? updated : x));
        editing = null;
        renderList();
      } catch (err) {
        input.disabled = false;
        toast(errorMessage(err));
        input.focus();
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void save();
      } else if (e.key === "Escape") {
        // Esc cancels the rename; it must not also close the dialog
        e.preventDefault();
        e.stopPropagation();
        stop();
      }
    });
    // on the page by now, so it can take the focus
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
    return h("li", { cls: "mcp-token mcp-token-editing" }, input, h("span", { cls: "mcp-token-meta", text: "Enter to save, Esc to cancel" }));
  };

  /** Removes a token after the person confirms; its agents lose access at once. */
  const removeOne = async (t: AgentToken): Promise<void> => {
    if (!(await confirmDialog(`Remove ${t.name}?`, "Agents using this token lose access at once.", "Remove"))) return;
    try {
      await tokensApi.remove(t.id);
    } catch (err) {
      toast(errorMessage(err));
      return;
    }
    tokens = (tokens ?? []).filter((x) => x.id !== t.id);
    if (editing === t.id) editing = null;
    renderList();
  };

  const renderList = (): void => {
    if (!tokens) {
      listBox.replaceChildren(loadError ? note(loadError, "mcp-warn") : note("Loading…"));
      return;
    }
    if (tokens.length === 0) {
      listBox.replaceChildren(note("No tokens."));
      return;
    }
    listBox.replaceChildren(h("ul", { cls: "mcp-tokens" }, ...tokens.map((t) => tokenRow(t))));
  };

  /** The sign-in steps: what to paste into each app, which signs in to Rodeo itself. */
  const renderSignIn = (): void => {
    if (!tokens) {
      signInBox.replaceChildren(loadError ? note(loadError, "mcp-warn") : note("Loading…"));
      return;
    }
    const options = signInSteps(endpoint);
    const current = options.find((s) => s.id === signTab) ?? options[0];
    signInBox.replaceChildren(
      snippetPanel(options, current, (id) => {
        signTab = id;
        renderSignIn();
      }),
    );
  };

  /** The token panel: the secret once, then the connection line for each kind of agent. */
  const tokenPanel = (m: NewAgentToken): HTMLElement => {
    const options = snippets(endpoint, m.secret);
    const current = options.find((s) => s.id === tab) ?? options[0];

    const again = h("button", { cls: "btn small", text: "Make Another", attrs: { type: "button" } });
    again.addEventListener("click", () => {
      made = null;
      renderNew();
    });

    return h(
      "div",
      { cls: "mcp-panel" },
      note("Copy this token now: Rodeo won't show it again.", "mcp-warn"),
      copyRow(m.secret, "Token"),
      snippetPanel(options, current, (id) => {
        tab = id;
        renderNew();
      }),
      h("div", { cls: "mcp-actions" }, again),
    );
  };

  /** The form for a new token, or the token panel while a token just made is shown. */
  const renderNew = (): void => {
    if (made) {
      newBox.replaceChildren(tokenPanel(made));
      return;
    }
    // the first connection is named for the usual agent, Claude Code
    const nameInput = h("input", {
      cls: "share-input mcp-name",
      value: tokens !== null && tokens.length === 0 ? "Claude Code" : "",
      placeholder: "Claude Code on my laptop",
      attrs: { type: "text", maxlength: "60", "aria-label": "Name" },
    });
    const create = h("button", { cls: "btn primary", text: "Create Token", attrs: { type: "button" } });
    create.disabled = busy;

    const press = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      create.disabled = true;
      const label = nameInput.value.trim();
      try {
        // the endpoint is needed for the connection lines, so the list comes first when it has not loaded
        if (!tokens && !(await showList())) return;
        const created = await tokensApi.create(label);
        made = created;
        tokens = [created.token, ...(tokens ?? [])];
        tab = "claude-code";
        renderList();
        renderNew();
      } catch (err) {
        toast(errorMessage(err));
      } finally {
        busy = false;
        create.disabled = false;
      }
    };
    create.addEventListener("click", () => void press());
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void press();
      }
    });

    newBox.replaceChildren(field("Name", nameInput), h("div", { cls: "mcp-actions" }, create));
  };

  const done = h("button", { cls: "btn primary", text: "Done", attrs: { type: "button" } });
  done.addEventListener("click", () => modal.close());

  modal.body.append(
    note("Let Claude, ChatGPT, Cursor or another AI agent work in your open drawing while you watch. The agent uses its own AI account, not your Rodeo credit."),
    ...(status ? [note(status(), "mcp-status")] : []),
    section("Connected apps", appsBox),
    section("Tokens", listBox),
    section("Sign in from your agent", signInBox),
    section("Or make a token", newBox),
    h("div", { cls: "mcp-foot" }, done),
  );
  renderAll();
  // the form waits for the list: its default name depends on whether the person has any connections yet
  void showList().then(renderNew);
}
