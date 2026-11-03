// File > Open from Cloud…: the drawings the signed-in user owns, and the ones shared
// with them, as cards with thumbnails. A search narrows them. Each card offers what
// its role allows: Open; Rename for an owner or editor; Delete for an owner, Leave
// for anyone the drawing is shared with. A bar shows how much of the plan is used.

import { h } from "../../app/dom.ts";
import { confirmDialog, showDialog } from "../../app/menubar.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { currentUser, files, refreshUser, sharing } from "../../platform/api.ts";
import { CAN_EDIT, type CloudFile, type User } from "../../platform/protocol.ts";
import { requireSignIn } from "../account/signin.ts";
import { cloudCall, openCloudDrawing, openCloudFile, withVwx } from "./cloud.ts";
import { cardThumb, field, note, openModal, sizeText, timeAgo } from "./ui.ts";

type Tab = "mine" | "shared";

/** Opens the cloud browser dialog (after a sign-in, if one is needed). */
export async function openCloudBrowser(): Promise<void> {
  if (!(await requireSignIn("Sign in to open your cloud drawings."))) return;
  await refreshUser();

  let tab: Tab = "mine";
  let all: CloudFile[] | null = null;
  let loadError = "";
  const modal = openModal("Open from Cloud", "cloud-dialog");

  const tabButton = (id: Tab, label: string): HTMLButtonElement => {
    const btn = h("button", { cls: "seg-btn", text: label, attrs: { type: "button", role: "tab" } });
    btn.addEventListener("click", () => {
      tab = id;
      render();
    });
    return btn;
  };
  const mineTab = tabButton("mine", "My Drawings");
  const sharedTab = tabButton("shared", "Shared with Me");
  const search = h("input", {
    cls: "cloud-search",
    attrs: { type: "search", placeholder: "Search drawings", "aria-label": "Search drawings" },
  });
  const status = note("");
  const grid = h("div", { cls: "cloud-grid" });
  const usage = h("div", { cls: "cloud-usage" });
  search.addEventListener("input", () => render());
  modal.body.append(h("div", { cls: "cloud-toolbar" }, h("div", { cls: "seg cloud-tabs", attrs: { role: "tablist" } }, mineTab, sharedTab), search), status, grid, usage);

  const actionButton = (label: string, run: () => void, cls = ""): HTMLButtonElement => {
    const btn = h("button", { cls: `btn small ${cls}`.trim(), text: label, attrs: { type: "button" } });
    btn.addEventListener("click", run);
    return btn;
  };

  const rename = async (f: CloudFile): Promise<void> => {
    const input = h("input", { cls: "menu-dialog-input cloud-wide-input", value: f.name, attrs: { type: "text", "aria-label": "Name" } });
    const name = await showDialog<string>({
      title: "Rename Drawing",
      okLabel: "Rename",
      body: [field("Name", input)],
      check: () => {
        const value = input.value.trim();
        return value ? { value: withVwx(value) } : { error: "Enter a name for the drawing.", focus: input };
      },
    });
    if (name === null || name === f.name) return;
    const renamed = await cloudCall("Renaming…", "Rename", () => files.rename(f.id, name).then(() => true));
    if (renamed) await load();
  };

  const remove = async (f: CloudFile): Promise<void> => {
    const ok = await confirmDialog("Delete Drawing", `Delete “${f.name}” and all its versions? This cannot be undone.`, "Delete");
    if (!ok) return;
    const gone = await cloudCall("Deleting…", "Delete", () => files.remove(f.id).then(() => true));
    if (!gone) return;
    if (openCloudDrawing()?.id === f.id) {
      // the open copy stays on screen, but the cloud no longer holds it
      toast(`“${f.name}” is still open here, but it is no longer in the cloud.`, "info");
    }
    await load();
    await refreshUser();
  };

  const leave = async (f: CloudFile): Promise<void> => {
    const me = currentUser();
    if (!me) return;
    const ok = await confirmDialog("Leave Drawing", `Remove “${f.name}” from the drawings shared with you? The owner can invite you again.`, "Leave");
    if (!ok) return;
    const left = await cloudCall("Leaving…", "Leave", () => sharing.removeMember(f.id, me.id).then(() => true));
    if (left) await load();
  };

  const card = (f: CloudFile, me: User | null): HTMLElement => {
    const open = actionButton("Open", () => {
      modal.close();
      void openCloudFile(f.id);
    }, "primary");
    const actions: Node[] = [open];
    if (CAN_EDIT.includes(f.role)) actions.push(actionButton("Rename", () => void rename(f)));
    actions.push(
      f.role === "owner"
        ? actionButton("Delete", () => void remove(f), "danger")
        : actionButton("Leave", () => void leave(f), "danger"),
    );
    return h(
      "article",
      { cls: "cloud-card" },
      cardThumb(f, "cloud-thumb"),
      h(
        "div",
        { cls: "cloud-card-body" },
        h("div", { cls: "cloud-name", text: f.name, attrs: { title: f.name } }),
        h("div", { cls: "cloud-meta", text: `Updated ${timeAgo(f.updatedAt)} · ${sizeText(f.size)}` }),
        h("div", { cls: "cloud-meta", text: `Owner: ${f.ownerId === me?.id ? "you" : f.ownerName}` }),
      ),
      h("div", { cls: "cloud-actions" }, ...actions),
    );
  };

  const render = (): void => {
    const mine = tab === "mine";
    mineTab.classList.toggle("active", mine);
    sharedTab.classList.toggle("active", !mine);
    mineTab.setAttribute("aria-selected", String(mine));
    sharedTab.setAttribute("aria-selected", String(!mine));
    const me = currentUser();
    usage.replaceChildren(usageBar(me));
    if (all === null) {
      grid.replaceChildren();
      status.textContent = loadError ? `Could not load your drawings: ${loadError}` : "Loading…";
      return;
    }
    const query = search.value.trim().toLowerCase();
    const inTab = all.filter((f) => (f.role === "owner") === mine);
    const shown = inTab.filter((f) => query === "" || f.name.toLowerCase().includes(query));
    grid.replaceChildren(...shown.map((f) => card(f, me)));
    if (inTab.length === 0) {
      status.textContent = mine
        ? "No drawings yet. Use File > Save to Cloud… to keep a drawing here."
        : "Nothing has been shared with you yet.";
    } else if (shown.length === 0) {
      status.textContent = `No drawings match “${search.value.trim()}”.`;
    } else {
      status.textContent = "";
    }
  };

  async function load(): Promise<void> {
    all = null;
    loadError = "";
    render();
    try {
      all = await files.list();
    } catch (err) {
      loadError = errorMessage(err);
    }
    render();
  }

  void load();
  search.focus();
}

/** The plan's room: drawings and bytes used against the limits (a limit of 0 is none). */
function usageBar(me: User | null): HTMLElement {
  if (!me) return h("div");
  const { usage, limits } = me;
  const drawings = limits.files > 0 ? `${usage.files} of ${limits.files} drawings` : `${usage.files} ${usage.files === 1 ? "drawing" : "drawings"}`;
  const room = limits.bytes > 0 ? `${sizeText(usage.bytes)} of ${sizeText(limits.bytes)} used` : `${sizeText(usage.bytes)} used`;
  const fill = h("div", { cls: "cloud-bar-fill" });
  fill.style.width = `${limits.bytes > 0 ? Math.min(100, (usage.bytes / limits.bytes) * 100) : 0}%`;
  return h(
    "div",
    { cls: "cloud-usage-inner" },
    h("div", { cls: "cloud-usage-text", text: `${drawings} · ${room}` }),
    h("div", { cls: "cloud-bar" }, fill),
  );
}
