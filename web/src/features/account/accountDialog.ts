// Account…: the signed-in user's name (editable), email, plan, usage and versions,
// and deleting the account (after typing DELETE).

import { h } from "../../app/dom.ts";
import { showDialog } from "../../app/menubar.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { account, currentUser } from "../../platform/api.ts";
import { config } from "./config.ts";
import { creditTerms, formatCredit, openCreditDialog } from "./credit.ts";
import { footButton, openModal, type Modal } from "./dialog.ts";
import { formatBytes, formatDate } from "./format.ts";
import { managePlan, openSupporterDialog } from "./supporter.ts";

export function openAccountDialog(): void {
  const cfg = config();
  const user = currentUser();
  if (!cfg || !user) return;
  let modal: Modal | null = null;

  // the name, saved with its own button once it differs from the account's
  const name = h("input", {
    cls: "acct-input",
    value: user.name,
    attrs: { type: "text", autocomplete: "name", spellcheck: "false", "aria-label": "Name" },
  });
  const save = h("button", { cls: "btn small", text: "Save", attrs: { type: "button" }, disabled: true });
  name.addEventListener("input", () => {
    const next = name.value.trim();
    save.disabled = next === "" || next === (currentUser()?.name ?? "");
  });
  save.addEventListener("click", () => {
    save.disabled = true;
    account
      .rename(name.value.trim())
      .then((u) => {
        name.value = u.name;
        toast("Name saved", "info");
      })
      .catch((err: unknown) => {
        modal?.error(errorMessage(err));
        save.disabled = false;
      });
  });

  // the plan: a Rodeo Plus badge with its end date, or Free; then the one plan action
  const plan = h("div", { cls: "acct-row" });
  if (user.plan === "supporter") {
    const until = user.supporterUntil ? formatDate(user.supporterUntil) : "";
    plan.append(h("span", { cls: "acct-badge", text: "Rodeo Plus" }));
    if (until) plan.append(h("span", { text: `until ${until}` }));
  } else {
    plan.append(h("span", { text: "Free" }));
  }
  if (cfg.billing) {
    const change = h("button", {
      cls: "btn small",
      text: user.plan === "supporter" ? "Manage Plan…" : "Get Rodeo Plus…",
      attrs: { type: "button" },
    });
    change.addEventListener("click", () => {
      if (user.plan === "supporter") void managePlan();
      else openSupporterDialog();
    });
    plan.append(change);
  }

  // AI credit, when the agents are sold by it
  const terms = creditTerms();
  const credit = h("div", { cls: "acct-row" });
  if (terms) {
    const add = h("button", { cls: "btn small", text: "AI Credit…", attrs: { type: "button" } });
    add.addEventListener("click", () => {
      modal?.close();
      openCreditDialog();
    });
    credit.append(h("span", { text: formatCredit(user.aiCredit ?? 0, terms.currency) }), add);
  }

  const limits = user.limits;
  const drawings = limits.files === 0 ? `${user.usage.files} (no limit)` : `${user.usage.files} of ${limits.files}`;
  const versions = limits.versions === 0 ? "All kept" : `Up to ${limits.versions} per drawing`;

  const storage = h("div", { cls: "acct-storage" });
  storage.append(
    h("span", {
      text: limits.bytes > 0 ? `${formatBytes(user.usage.bytes)} of ${formatBytes(limits.bytes)}` : `${formatBytes(user.usage.bytes)} used`,
    }),
  );
  if (limits.bytes > 0) {
    const fill = h("div", { cls: "acct-bar-fill" });
    fill.style.width = `${Math.min(100, (user.usage.bytes / limits.bytes) * 100)}%`;
    storage.append(
      h(
        "div",
        {
          cls: "acct-bar",
          attrs: {
            role: "progressbar",
            "aria-label": "Storage used",
            "aria-valuemin": "0",
            "aria-valuemax": String(limits.bytes),
            "aria-valuenow": String(user.usage.bytes),
          },
        },
        fill,
      ),
    );
  }

  // deleting asks again, and only a typed DELETE goes ahead
  const confirmDelete = async (): Promise<void> => {
    const typed = h("input", {
      cls: "acct-input",
      placeholder: "DELETE",
      attrs: { type: "text", autocomplete: "off", spellcheck: "false", "aria-label": "Type DELETE to confirm" },
    });
    const sure = await showDialog<true>({
      title: "Delete Account",
      okLabel: "Delete Account",
      cls: "account-dialog",
      body: [
        h("p", { cls: "menu-dialog-text", text: "This deletes your account and every drawing you own, with all their versions. It cannot be undone." }),
        ...((user.aiCredit ?? 0) > 0 && terms
          ? [h("p", { cls: "menu-dialog-text", text: `Your ${formatCredit(user.aiCredit ?? 0, terms.currency)} of AI credit goes with it.` })]
          : []),
        h("p", { cls: "menu-dialog-text", text: "Type DELETE to confirm." }),
        typed,
      ],
      check: () => (typed.value.trim() === "DELETE" ? { value: true } : { error: "Type DELETE in capitals to confirm.", focus: typed }),
    });
    if (!sure) return;
    try {
      await account.deleteAccount();
      modal?.close();
      toast("Your account and its drawings were deleted.", "info");
    } catch (err) {
      modal?.error(errorMessage(err));
    }
  };
  const deleteButton = h("button", { cls: "btn danger", text: "Delete Account…", attrs: { type: "button" } });
  deleteButton.addEventListener("click", () => void confirmDelete());

  modal = openModal({
    title: "Account",
    body: [
      h(
        "dl",
        { cls: "acct-info" },
        h("dt", { text: "Name" }),
        h("dd", {}, h("div", { cls: "acct-row" }, name, save)),
        h("dt", { text: "Email" }),
        h("dd", { text: user.email }),
        h("dt", { text: "Plan" }),
        h("dd", {}, plan),
        ...(terms ? [h("dt", { text: "AI credit" }), h("dd", {}, credit)] : []),
        h("dt", { text: "Drawings" }),
        h("dd", { text: drawings }),
        h("dt", { text: "Storage" }),
        h("dd", {}, storage),
        h("dt", { text: "Versions" }),
        h("dd", { text: versions }),
      ),
      h(
        "div",
        { cls: "acct-danger-zone" },
        h("p", { cls: "acct-note", text: "Deleting the account removes every drawing you own, with its versions." }),
        deleteButton,
      ),
    ],
    actions: [footButton("Close", false, () => modal?.close())],
  });
}
