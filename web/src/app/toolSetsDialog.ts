// Window > Workspaces > Tool Sets…: Vectorworks' workspace editor for tool sets. Sets can be
// added, renamed, reordered and deleted, and tools added to a set, moved up and down in it or
// taken out; a tool belongs to one set at most. Nothing changes until OK.

import "./toolSetsDialog.css";
import { h } from "./dom.ts";
import { TOOL_ICON } from "./icons.ts";
import { showDialog } from "./menubar.ts";
import type { ToolId } from "./state.ts";
import { allTools, defaultToolSets, setToolSets, toolDef, toolSets, type ToolSetConfig } from "./toolbar.ts";

interface Draft {
  id: string;
  label: string;
  tools: ToolId[];
}

function smallButton(text: string, label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const btn = h("button", { cls: "btn small ts-btn", text, title: label, attrs: { type: "button", "aria-label": label } });
  btn.disabled = disabled;
  btn.addEventListener("click", onClick);
  return btn;
}

function move<T>(list: T[], i: number, by: number): void {
  const j = i + by;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}

export async function toolSetsDialog(): Promise<void> {
  let draft: Draft[] = toolSets().map((s) => ({ id: s.id, label: s.label, tools: [...s.tools] }));
  const list = h("div", { cls: "ts-list" });
  let fresh = 0;

  const render = (): void => {
    const used = new Set(draft.flatMap((s) => s.tools));
    const free = allTools().filter((t) => !used.has(t.id));
    list.replaceChildren(
      ...draft.map((set, i) => {
        const name = h("input", {
          cls: "menu-dialog-input ts-name",
          value: set.label,
          attrs: { type: "text", "aria-label": "Tool set name", spellcheck: "false" },
        });
        name.addEventListener("input", () => (set.label = name.value));
        const head = h(
          "div",
          { cls: "ts-head" },
          name,
          smallButton("↑", `Move ${set.label} up`, () => (move(draft, i, -1), render()), i === 0),
          smallButton("↓", `Move ${set.label} down`, () => (move(draft, i, 1), render()), i === draft.length - 1),
          smallButton("Delete", `Delete ${set.label}`, () => (draft.splice(i, 1), render())),
        );
        const rows = set.tools.map((id, k) =>
          h(
            "div",
            { cls: "ts-tool" },
            h("span", { cls: "ts-icon", html: TOOL_ICON[id] }),
            h("span", { cls: "ts-label", text: toolDef(id)?.label ?? id }),
            smallButton("↑", "Move up", () => (move(set.tools, k, -1), render()), k === 0),
            smallButton("↓", "Move down", () => (move(set.tools, k, 1), render()), k === set.tools.length - 1),
            smallButton("×", `Take ${toolDef(id)?.label ?? id} out`, () => (set.tools.splice(k, 1), render())),
          ),
        );
        const add = h(
          "select",
          { cls: "select ts-add", attrs: { "aria-label": `Add a tool to ${set.label}` } },
          h("option", { text: free.length ? "Add a tool…" : "Every tool is in a set", disabled: true, attrs: { value: "", selected: "" } }),
          ...free.map((t) => h("option", { text: t.label, attrs: { value: t.id } })),
        );
        add.disabled = free.length === 0;
        add.addEventListener("change", () => {
          set.tools.push(add.value as ToolId);
          render();
        });
        return h("section", { cls: "ts-set" }, head, ...rows, add);
      }),
    );
  };

  const addSet = smallButton("New Tool Set", "Add a tool set", () => {
    let n = draft.length + 1;
    while (draft.some((s) => s.label === `Tool Set ${n}`)) n++;
    draft.push({ id: `custom-${Date.now().toString(36)}-${fresh++}`, label: `Tool Set ${n}`, tools: [] });
    render();
  });
  const restore = smallButton("Restore Defaults", "Put back the tool sets Rodeo starts with", () => {
    draft = defaultToolSets().map((s) => ({ ...s, tools: [...s.tools] }));
    render();
  });
  render();

  const next = await showDialog<ToolSetConfig[]>({
    title: "Tool Sets",
    okLabel: "OK",
    cls: "ts-dialog",
    body: [
      h("p", { cls: "muted", text: "The Tool Sets palette shows these, in this order. A tool can be in one set; the Basic palette keeps its own." }),
      list,
      h("div", { cls: "ts-actions" }, addSet, restore),
    ],
    check: () => {
      const names = new Set<string>();
      for (const set of draft) {
        const label = set.label.trim();
        if (!label) return { error: "Give every tool set a name." };
        if (names.has(label)) return { error: `Two tool sets are called "${label}".` };
        if (!set.tools.length) return { error: `"${label}" has no tools: add one, or delete it.` };
        names.add(label);
      }
      if (!draft.length) return { error: "Keep at least one tool set." };
      return { value: draft.map((s) => ({ id: s.id, label: s.label.trim(), tools: [...s.tools] })) };
    },
  });
  if (next) setToolSets(next);
}
