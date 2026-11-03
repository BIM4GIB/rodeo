// Share dialog for a cloud drawing: the people in it with their roles (an owner
// changes or removes them), invitations by role with an optional email, and public
// view-only links with the embed code for each. A change takes effect at once and
// the dialog reloads what it touched; the controls the user is typing in are kept.

import { h } from "../../app/dom.ts";
import { confirmDialog } from "../../app/menubar.ts";
import { toast, errorMessage } from "../../app/toast.ts";
import { currentUser, files, sharing } from "../../platform/api.ts";
import { CAN_EDIT, type Invite, type Member, type Role, type Share } from "../../platform/protocol.ts";
import { openSupporterDialog } from "../account/supporter.ts";
import { cloudCall, explainFailure } from "./cloud.ts";
import { copyRow, note, openModal } from "./ui.ts";

/** A role given to someone else: an owner is kept, never given. */
type GivenRole = Exclude<Role, "owner">;

const GIVEN_ROLES: readonly GivenRole[] = ["editor", "reviewer", "viewer"];
const ROLE_LABEL: Record<Role, string> = { owner: "Owner", editor: "Editor", reviewer: "Reviewer", viewer: "Viewer" };
const ROLE_HINT: Record<GivenRole, string> = {
  editor: "Can change the drawing and invite others.",
  reviewer: "Can comment and mark it up in crit mode, but not change it.",
  viewer: "Can look at the drawing only.",
};

/** The invitation made in this dialog, with the address it was emailed to (if any). */
interface Sent {
  readonly invite: Invite;
  readonly email: string;
}

/** Opens the share dialog for a cloud drawing. */
export function openShareDialog(fileId: string): void {
  void showShare(fileId);
}

async function showShare(fileId: string): Promise<void> {
  const got = await cloudCall("Loading…", "Share", () => files.get(fileId));
  if (!got) return;
  const { file } = got;
  const canShare = CAN_EDIT.includes(file.role);
  const canManage = file.role === "owner";
  let members: Member[] = got.members;
  let shares: Share[] = [];
  let sharesError = "";
  let sent: Sent | null = null;

  const modal = openModal(`Share “${file.name}”`, "share-dialog");
  const peopleBox = h("ul", { cls: "share-people" });
  const inviteResult = h("div", { cls: "share-invite-result" });
  const linksBox = h("div", { cls: "share-links" });

  // runs a change, explains a failure, then shows the drawing's people and links as they now are
  const act = async (action: string, run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
    } catch (err) {
      await explainFailure(action, err);
    }
    await reload();
  };

  const reload = async (): Promise<void> => {
    try {
      members = await sharing.members(fileId);
    } catch (err) {
      toast(`Could not load the people: ${errorMessage(err)}`);
    }
    if (canShare) {
      try {
        shares = await sharing.shares(fileId);
        sharesError = "";
      } catch (err) {
        shares = [];
        sharesError = errorMessage(err);
      }
    }
    renderPeople();
    renderLinks();
  };

  const roleSelect = (m: Member): HTMLSelectElement => {
    const select = h(
      "select",
      { cls: "menu-dialog-input menu-dialog-select share-role-select", attrs: { "aria-label": `Role of ${m.name}` } },
      ...GIVEN_ROLES.map((r) => h("option", { value: r, text: ROLE_LABEL[r] })),
    );
    select.value = m.role;
    select.addEventListener("change", () => {
      void act("Change role", () => sharing.setRole(fileId, m.userId, select.value as GivenRole));
    });
    return select;
  };

  const personRow = (m: Member): HTMLElement => {
    const me = currentUser();
    const editable = canManage && m.role !== "owner";
    const remove = h("button", { cls: "btn small danger", text: "Remove", attrs: { type: "button" } });
    remove.addEventListener("click", async () => {
      const ok = await confirmDialog("Remove Person", `Remove ${m.name} from “${file.name}”? They lose access to it.`, "Remove");
      if (ok) await act("Remove", () => sharing.removeMember(fileId, m.userId));
    });
    return h(
      "li",
      { cls: "share-person" },
      h("span", { cls: "share-initial", text: (m.name.trim()[0] ?? "?").toUpperCase(), attrs: { "aria-hidden": "true" } }),
      h(
        "div",
        { cls: "share-who" },
        h("span", { cls: "share-name", text: m.userId === me?.id ? `${m.name} (you)` : m.name }),
        h("span", { cls: "share-email", text: m.email }),
      ),
      editable ? roleSelect(m) : h("span", { cls: "share-role", text: ROLE_LABEL[m.role] }),
      editable ? remove : null,
    );
  };

  const renderPeople = (): void => {
    peopleBox.replaceChildren(...members.map(personRow));
  };

  const renderInvite = (): void => {
    if (!sent) {
      inviteResult.replaceChildren();
      return;
    }
    const until = new Date(sent.invite.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    inviteResult.replaceChildren(
      note(
        sent.email ? `Emailed to ${sent.email}. The link works too, until ${until}.` : `Send this link. It works until ${until}.`,
        "share-hint",
      ),
      copyRow(sent.invite.url, "Invite link"),
    );
  };

  const inviteSection = (): HTMLElement => {
    const role = h(
      "select",
      { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Role" } },
      ...GIVEN_ROLES.map((r) => h("option", { value: r, text: ROLE_LABEL[r] })),
    );
    role.value = "editor";
    const hint = note(ROLE_HINT.editor, "share-hint");
    role.addEventListener("change", () => {
      hint.textContent = ROLE_HINT[role.value as GivenRole];
    });
    const email = h("input", { cls: "share-input", attrs: { type: "email", placeholder: "Email (optional)", "aria-label": "Email" } });
    const invite = h("button", { cls: "btn primary small", text: "Invite", attrs: { type: "button" } });
    invite.addEventListener("click", async () => {
      const address = email.value.trim();
      invite.disabled = true;
      try {
        const made = await sharing.invite(fileId, role.value as GivenRole, address || undefined);
        sent = { invite: made, email: address };
        email.value = "";
        renderInvite();
      } catch (err) {
        await explainFailure("Invite", err);
      } finally {
        invite.disabled = false;
      }
    });
    return section("Invite", h("div", { cls: "share-invite-row" }, role, email, invite), hint, inviteResult);
  };

  // the control for a new public link; kept across reloads so the checkbox keeps its state
  const allowDownload = h("input", { attrs: { type: "checkbox", "aria-label": "Allow download" } });
  const createLink = h("button", { cls: "btn primary small", text: "Create Link", attrs: { type: "button" } });
  createLink.addEventListener("click", () => {
    void act("Create link", () => sharing.createShare(fileId, allowDownload.checked));
  });
  const createControls = h(
    "div",
    { cls: "share-create" },
    h("label", { cls: "menu-dialog-check" }, allowDownload, "Allow download"),
    createLink,
  );

  const shareCard = (s: Share): HTMLElement => {
    const revoke = h("button", { cls: "btn small danger", text: "Revoke", attrs: { type: "button" } });
    revoke.addEventListener("click", async () => {
      const ok = await confirmDialog("Revoke Link", "Anyone with this link loses access to the drawing. Revoke it?", "Revoke");
      if (ok) await act("Revoke", () => sharing.revokeShare(s.token));
    });
    const embed = `<iframe src="${s.embedUrl}" width="800" height="600" style="border:0" allowfullscreen></iframe>`;
    return h(
      "div",
      { cls: "share-link" },
      h(
        "div",
        { cls: "share-link-head" },
        note(s.allowDownload ? "Anyone with the link can view and download it." : "Anyone with the link can view it.", "share-hint"),
        revoke,
      ),
      copyRow(s.url, "Link"),
      note("Embed code", "share-hint"),
      copyRow(embed, "Embed code"),
    );
  };

  const renderLinks = (): void => {
    const allowed = currentUser()?.limits.shareLinks === true;
    const parts: Node[] = [];
    if (!allowed) {
      const plans = h("button", { cls: "btn small", text: "See Rodeo Plus", attrs: { type: "button" } });
      plans.addEventListener("click", () => openSupporterDialog());
      parts.push(note("Public view-only links are part of Rodeo Plus."), plans);
    }
    if (sharesError) parts.push(note(`Could not load the links: ${sharesError}`));
    parts.push(...shares.map(shareCard));
    if (allowed) parts.push(createControls);
    linksBox.replaceChildren(...parts);
  };

  const done = h("button", { cls: "btn primary", text: "Done", attrs: { type: "button" } });
  done.addEventListener("click", () => modal.close());
  const footer = h("div", { cls: "menu-dialog-actions" }, done);

  modal.body.append(section("People", peopleBox));
  if (canShare) {
    modal.body.append(inviteSection(), section("Public link", linksBox));
  } else {
    modal.body.append(note("Only owners and editors can change who sees this drawing."));
  }
  modal.body.append(footer);

  renderPeople();
  renderInvite();
  renderLinks();
  await reload();
}

function section(title: string, ...children: Node[]): HTMLElement {
  return h("section", { cls: "share-section" }, h("h3", { cls: "share-heading", text: title }), ...children);
}
