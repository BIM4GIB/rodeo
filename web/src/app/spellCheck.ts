// Text > Check Spelling…: steps through the words of the drawing's text objects that an English
// dictionary doesn't know, as Vectorworks' Check Spelling does, offering its suggestions. Each word
// can be ignored (here or everywhere), changed (here or everywhere) or added to this browser's own
// word list. It checks the selected text, the active layer or every layer, in British or American
// English (the choice kept in this browser), and can pass over words in capitals (drawing labels and
// abbreviations) and words with numbers. Nothing changes until Done, which makes every change as one
// undo step. Text inside symbol definitions is left alone, as Find-Replace Text leaves it.
//
// The dictionaries are SCOWL's Hunspell ones (MIT and BSD), loaded on first use; nspell reads them.

import NSpell from "nspell";
import type { ObjectInfo, VwxDocument } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import "./spellCheck.css";

type Lang = "en-GB" | "en-US";
type Scope = "selection" | "layer" | "all";

const DICTIONARIES: Readonly<Record<Lang, { label: string; aff: URL; dic: URL }>> = {
  "en-GB": {
    label: "English (UK)",
    aff: new URL("../../node_modules/dictionary-en-gb/index.aff", import.meta.url),
    dic: new URL("../../node_modules/dictionary-en-gb/index.dic", import.meta.url),
  },
  "en-US": {
    label: "English (US)",
    aff: new URL("../../node_modules/dictionary-en/index.aff", import.meta.url),
    dic: new URL("../../node_modules/dictionary-en/index.dic", import.meta.url),
  },
};

const SCOPES: readonly { readonly id: Scope; readonly label: string }[] = [
  { id: "selection", label: "Selected text" },
  { id: "layer", label: "Active layer" },
  { id: "all", label: "All layers" },
];

const LANG_KEY = "openvwx:spelling:lang";
const WORDS_KEY = "openvwx:spelling:words";
/** the most suggestions shown for a word */
const MAX_SUGGESTIONS = 8;
/** characters of context shown either side of the word */
const CONTEXT = 36;
/** a word: letters, with apostrophes inside it ("don't") */
const WORD = /\p{L}+(?:['’]\p{L}+)*/gu;

const spellers = new Map<Lang, Promise<NSpell>>();

/** The dictionary for `lang`, fetched and read once. */
function speller(lang: Lang): Promise<NSpell> {
  let p = spellers.get(lang);
  if (!p) {
    const d = DICTIONARIES[lang];
    p = Promise.all([fetch(d.aff), fetch(d.dic)])
      .then(async ([a, b]) => {
        if (!a.ok || !b.ok) throw new Error("the dictionary didn't load");
        const spell = NSpell(await a.text(), await b.text());
        for (const w of ownWords()) spell.add(w);
        return spell;
      })
      .catch((e: unknown) => {
        spellers.delete(lang);
        throw e;
      });
    spellers.set(lang, p);
  }
  return p;
}

function readLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === "en-GB" || v === "en-US") return v;
  } catch {
    // storage blocked: the default
  }
  return "en-GB";
}

/** Words added to this browser's own list. */
function ownWords(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(WORDS_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((w): w is string => typeof w === "string") : [];
  } catch {
    return [];
  }
}

function addOwnWord(word: string): void {
  try {
    localStorage.setItem(WORDS_KEY, JSON.stringify([...new Set([...ownWords(), word])]));
  } catch {
    // storage blocked: known for this visit only
  }
}

/** The text objects in `scope` that can be edited (as Find-Replace Text finds them); `selection` is what was selected on opening. */
function textsIn(doc: VwxDocument, scope: Scope, selection: ReadonlySet<string>): ObjectInfo[] {
  const editable = (o: ObjectInfo | null): o is ObjectInfo => !!o && o.shape?.kind === "text" && !isDerivedId(o.id);
  if (scope === "selection") return [...selection].map((id) => doc.object(id)).filter(editable);
  const layers = scope === "layer" ? (store.activeLayerId ? [store.activeLayerId] : []) : doc.layers().map((l) => l.id);
  return layers.flatMap((id) => doc.objects(id)).filter(editable);
}

/** The word as the dictionary spells it: a straight apostrophe. */
function plain(word: string): string {
  return word.replace(/’/g, "'");
}

/** The word as it stands in `was`'s case: all capitals, a capital first letter, or as typed. */
function inCaseOf(was: string, word: string): string {
  if (was.length > 1 && was === was.toUpperCase()) return word.toUpperCase();
  if (was[0] === was[0].toUpperCase() && was[0] !== was[0].toLowerCase()) return word[0].toUpperCase() + word.slice(1);
  return word;
}

interface Text {
  readonly id: string;
  text: string;
}

/** Opens Check Spelling; the changes are made on Done. */
export async function spellCheckDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  let lang = readLang();
  // the check selects each text it stops at, so "Selected text" keeps to what was selected on opening
  const selected = new Set(store.selection);
  let spell: NSpell | null = null;
  const changes = new Map<string, string>();
  const ignored = new Set<string>();
  const changeAll = new Map<string, string>();
  let texts: Text[] = [];
  // where the check is: the text and the place in it after the last word looked at
  let at = 0;
  let from = 0;
  let current: { text: Text; index: number; word: string } | null = null;
  let checked = 0;

  const scope = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Check" } }, ...SCOPES.map((s) => h("option", { value: s.id, text: s.label })));
  scope.value = textsIn(doc, "selection", selected).length ? "selection" : "layer";
  const language = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Language" } },
    ...(Object.keys(DICTIONARIES) as Lang[]).map((l) => h("option", { value: l, text: DICTIONARIES[l].label })),
  );
  language.value = lang;
  const capitals = h("input", { checked: true, attrs: { type: "checkbox" } });
  const numbers = h("input", { checked: true, attrs: { type: "checkbox" } });
  const status = h("p", { cls: "sc-status muted", attrs: { role: "status" } });
  const context = h("p", { cls: "sc-context" });
  const changeTo = h("input", { cls: "menu-dialog-input sc-change", attrs: { type: "text", "aria-label": "Change to", spellcheck: "false" } });
  const suggestions = h("div", { cls: "sc-suggestions", attrs: { role: "listbox", "aria-label": "Suggestions" } });
  const button = (text: string, title: string, run: () => void): HTMLButtonElement => {
    const b = h("button", { cls: "btn small", text, title, attrs: { type: "button" } });
    b.addEventListener("click", run);
    return b;
  };
  const ignore = button("Ignore", "Leave this word here", () => {
    if (!current) return;
    from = current.index + current.word.length;
    advance();
  });
  const ignoreAll = button("Ignore All", "Leave this word everywhere", () => {
    if (!current) return;
    ignored.add(current.word);
    from = current.index + current.word.length;
    advance();
  });
  const change = button("Change", "Change this word to the one above", () => replace(false));
  const changeEvery = button("Change All", "Change this word everywhere", () => replace(true));
  const add = button("Add", "Add this word to this browser's word list", () => {
    if (!current || !spell) return;
    addOwnWord(plain(current.word));
    spell.add(plain(current.word));
    from = current.index + current.word.length;
    advance();
  });
  const actions = [ignore, ignoreAll, change, changeEvery, add];
  const card = h(
    "div",
    { cls: "sc-card" },
    h("div", { cls: "sc-label muted", text: "Not in the dictionary" }),
    context,
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Change to" }), changeTo),
    suggestions,
    h("div", { cls: "sc-actions" }, ...actions),
  );

  const skip = (word: string): boolean =>
    word.length < 2 || ignored.has(word) || (capitals.checked && word === word.toUpperCase() && word !== word.toLowerCase());

  const show = (): void => {
    const busy = !spell;
    for (const b of actions) b.disabled = busy || !current;
    changeTo.disabled = busy || !current;
    if (busy) {
      status.textContent = `Loading the ${DICTIONARIES[lang].label} dictionary…`;
      context.replaceChildren();
      suggestions.replaceChildren();
      return;
    }
    const pending = changes.size ? ` ${changes.size} text${changes.size === 1 ? "" : "s"} to change on Done.` : "";
    if (!current) {
      status.textContent = texts.length ? `No more words to check in ${texts.length} text${texts.length === 1 ? "" : "s"}.${pending}` : `No text to check.${pending}`;
      context.replaceChildren(h("span", { cls: "muted", text: "–" }));
      changeTo.value = "";
      suggestions.replaceChildren();
      return;
    }
    const { text, index, word } = current;
    status.textContent = `Text ${at + 1} of ${texts.length}.${pending}`;
    const before = text.text.slice(Math.max(0, index - CONTEXT), index);
    const after = text.text.slice(index + word.length, index + word.length + CONTEXT);
    const flat = (s: string): string => s.replace(/\s*\n\s*/g, " ⏎ ");
    context.replaceChildren(
      (index > CONTEXT ? "…" : "") + flat(before),
      h("mark", { text: word }),
      flat(after) + (index + word.length + CONTEXT < text.text.length ? "…" : ""),
    );
    const offered = spell!.suggest(plain(word)).slice(0, MAX_SUGGESTIONS).map((w) => inCaseOf(word, w));
    changeTo.value = offered[0] ?? word;
    suggestions.replaceChildren(
      ...(offered.length
        ? offered.map((w) => {
            const b = h("button", { cls: "sc-suggestion", text: w, attrs: { type: "button", role: "option" } });
            b.addEventListener("click", () => {
              changeTo.value = w;
              changeTo.focus();
            });
            b.addEventListener("dblclick", () => replace(false));
            return b;
          })
        : [h("span", { cls: "muted", text: "No suggestions" })]),
    );
    // the text being checked shows selected when it is on the active layer
    if (store.activeLayerId && doc.objects(store.activeLayerId).some((o) => o.id === text.id)) setSelection([text.id]);
  };

  /** Finds the next word the dictionary doesn't know from where the check is, making Change All's changes on the way. */
  const advance = (): void => {
    current = null;
    if (!spell) return show();
    for (; at < texts.length; at++, from = 0) {
      const t = texts[at];
      const re = new RegExp(WORD.source, WORD.flags);
      re.lastIndex = from;
      for (let m = re.exec(t.text); m; m = re.exec(t.text)) {
        const word = m[0];
        // a word joined to digits ("2nd", "A4") is a label, not prose
        const edge = t.text[m.index - 1] ?? "";
        const next = t.text[m.index + word.length] ?? "";
        if (numbers.checked && (/\d/.test(edge) || /\d/.test(next))) continue;
        if (skip(word)) continue;
        const to = changeAll.get(word);
        if (to !== undefined) {
          t.text = t.text.slice(0, m.index) + to + t.text.slice(m.index + word.length);
          changes.set(t.id, t.text);
          re.lastIndex = m.index + to.length;
          continue;
        }
        checked++;
        if (spell.correct(plain(word))) continue;
        current = { text: t, index: m.index, word };
        from = m.index;
        return show();
      }
    }
    show();
  };

  const replace = (everywhere: boolean): void => {
    if (!current) return;
    const to = changeTo.value;
    if (to === "") {
      changeTo.focus();
      return;
    }
    const { text, index, word } = current;
    if (everywhere) changeAll.set(word, to);
    text.text = text.text.slice(0, index) + to + text.text.slice(index + word.length);
    changes.set(text.id, text.text);
    from = index + to.length;
    advance();
  };

  /** Starts over from the first text, keeping the changes made so far. */
  const restart = (): void => {
    texts = textsIn(doc, scope.value as Scope, selected).map((o) => ({ id: o.id, text: changes.get(o.id) ?? o.shape?.text ?? "" }));
    at = 0;
    from = 0;
    checked = 0;
    advance();
  };

  const load = (): void => {
    spell = null;
    current = null;
    show();
    const want = lang;
    speller(want).then(
      (s) => {
        if (lang !== want) return;
        spell = s;
        restart();
      },
      () => {
        status.textContent = "The dictionary didn't load. Check the connection and choose the language again.";
      },
    );
  };

  scope.addEventListener("change", restart);
  language.addEventListener("change", () => {
    lang = language.value as Lang;
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // storage blocked: this visit only
    }
    load();
  });
  capitals.addEventListener("change", restart);
  numbers.addEventListener("change", restart);
  // Return in the field changes the word rather than closing the dialog
  changeTo.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    replace(false);
  });

  const field = (label: string, input: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input);
  const done = showDialog<true>({
    title: "Check Spelling",
    okLabel: "Done",
    cls: "sc-dialog",
    body: [
      field("Check", scope),
      field("Language", language),
      h("label", { cls: "menu-dialog-check" }, capitals, "Ignore words in capitals"),
      h("label", { cls: "menu-dialog-check" }, numbers, "Ignore words with numbers"),
      status,
      card,
      h(
        "p",
        { cls: "sc-credit muted" },
        "Word lists from ",
        h("a", { text: "SCOWL", attrs: { href: "licences/english-dictionaries.txt", target: "_blank", rel: "noopener" } }),
        ".",
      ),
    ],
    check: () => ({ value: true }),
  });
  load();
  if (!(await done)) return;
  const edits = [...changes].filter(([id, text]) => doc.object(id)?.shape?.text !== text);
  if (!edits.length) {
    toast(checked ? "No spelling changes to make." : "No text to check.", "info");
    return;
  }
  const r = attempt("Check spelling", (s) =>
    s.batch(() => {
      for (const [id, text] of edits) s.setText(id, text);
    }),
  );
  if (r) toast(`Changed the spelling in ${edits.length} text object${edits.length === 1 ? "" : "s"}.`, "info");
}
