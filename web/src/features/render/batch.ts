// View > Rendering > Create Batch Render Job… and Start Batch Render…, as Vectorworks has them. A
// job is Render Image's choices (camera, size, engine and quality, format) under a name, with the
// 3D view's view as it was when the job was made (its Current view). Start Batch Render renders the
// jobs chosen, in the order chosen, with the Render palette's settings, and downloads their pictures
// as one zip holding a folder named for the date and time, as Vectorworks writes them into a
// folder so named. Esc drops the job in hand and goes on with the next; Cancel stops the batch (the
// pictures already made still download). Jobs are kept per file name in localStorage, as saved
// views are, not in the file. This file loads with the renderers, not the editor.

import { h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { showDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { zipFiles } from "../../export/zip.ts";
import { shotOfView, type Shot } from "./camera.ts";
import { askRender, cameraLabel, lastPrefs, makePictures, prefsFrom, type Plan, type Prefs } from "./finalRender.ts";
import { showProgress } from "./progress.ts";
import type { Engine, Format, Job } from "./still.ts";
import type { RenderResult } from "./viewer.ts";
import "./batch.css";

const STORAGE_PREFIX = "openvwx.batchRender.";
const LIST_ROWS = 8;
const ENGINE_NAMES: Readonly<Record<Engine, string>> = { realistic: "Fast", pathtraced: "Photoreal" };

/** A batch render job as kept. */
export interface BatchJob {
  readonly name: string;
  /** the dialog's choices, which Edit starts from */
  readonly prefs: Prefs;
  readonly width: number;
  readonly height: number;
  readonly engine: Engine;
  readonly samples: number;
  readonly minutes: number;
  readonly denoise: boolean;
  readonly format: Format;
  /** the cameras it renders, by id, or null for `view` */
  readonly cameras: readonly string[] | null;
  /** the 3D view's view when the job was made */
  readonly view: Shot | null;
}

/** View > Rendering > Create Batch Render Job…: the job's name and Render Image's choices, from the 3D view as it looks now. */
export async function createBatchJobDialog(): Promise<void> {
  if (!store.session) return;
  const view = await currentShot();
  if (!view) return;
  const jobs = readJobs();
  const job = await editJob(null, jobs, view);
  if (!job) return;
  writeJobs([...jobs, job]);
  toast(`Batch render job “${job.name}” saved. View › Rendering › Start Batch Render… renders it.`);
}

/** View > Rendering > Start Batch Render…: picks the jobs and their order (and duplicates, edits or deletes jobs), then renders them. */
export async function startBatchRenderDialog(): Promise<void> {
  if (!store.session) return;
  if (readJobs().length === 0) {
    toast("There are no batch render jobs yet: View › Rendering › Create Batch Render Job… makes one.");
    return;
  }
  const view = await currentShot();
  if (!view) return;
  const chosen = await chooseJobs(view);
  if (!chosen) return;
  await runBatch(chosen);
}

/** The 3D view's view now, showing the 3D view; null (said) when there is none. */
async function currentShot(): Promise<Shot | null> {
  const ctx = appContext();
  const view = ctx ? await ctx.show3d() : null;
  if (!view) {
    toast("The 3D view is not available here, so there is nothing to render.");
    return null;
  }
  return shotOfView(view.activeCamera, view.orbitTarget);
}

/** Render Image's dialog as the job's editor; `old` is the job edited, null for a new one. */
async function editJob(old: BatchJob | null, jobs: readonly BatchJob[], view: Shot): Promise<BatchJob | null> {
  const session = store.session;
  if (!session) return null;
  const cams = session.doc.cameras();
  const plan = await askRender(cams, null, {
    title: old ? "Edit Batch Render Job" : "Create Batch Render Job",
    okLabel: old ? "OK" : "Create",
    name: old?.name ?? nextName(jobs),
    start: old?.prefs ?? lastPrefs(),
    taken: new Set(jobs.filter((j) => j !== old).map((j) => j.name)),
  });
  return plan ? jobOf(plan, old?.view ?? view) : null;
}

function jobOf(plan: Plan, view: Shot): BatchJob {
  const cameras = plan.shots.flatMap((s) => (s.camera ? [s.camera.id] : []));
  return {
    name: plan.name ?? "Job",
    prefs: { ...plan.prefs, where: "local" },
    width: plan.width,
    height: plan.height,
    engine: plan.engine,
    samples: plan.samples,
    minutes: plan.minutes,
    denoise: plan.denoise,
    format: plan.format,
    cameras: cameras.length ? cameras : null,
    view: cameras.length ? null : view,
  };
}

/** "Job 3": the first such name no job has. */
function nextName(jobs: readonly BatchJob[]): string {
  const taken = new Set(jobs.map((j) => j.name));
  let n = jobs.length + 1;
  while (taken.has(`Job ${n}`)) n++;
  return `Job ${n}`;
}

/** A job's row in the lists: its name with its pictures' extension, as Vectorworks lists them. */
function rowText(job: BatchJob): string {
  const count = job.cameras && job.cameras.length > 1 ? ` (${job.cameras.length} pictures)` : "";
  return `${job.name}.${extension(job.format)}${count}`;
}

/** A job's settings, for its row's tooltip. */
function rowTitle(job: BatchJob): string {
  const what = job.cameras ? `${job.cameras.length === 1 ? "a camera" : `${job.cameras.length} cameras`}` : "the view when it was made";
  return `${job.width} × ${job.height} px · ${ENGINE_NAMES[job.engine]}${job.engine === "pathtraced" ? `, ${job.samples} samples` : ""} · ${what}`;
}

function extension(format: Format): string {
  return format === "jpeg" ? "jpg" : format;
}

/**
 * The Start Batch Render dialog: Available Jobs and Chosen Jobs, with Choose All, >>, << and
 * Duplicate, Edit and Delete for the available job picked (each saved at once; Delete can't be
 * undone). Resolves with the chosen jobs in order, or null when cancelled.
 */
function chooseJobs(view: Shot): Promise<BatchJob[] | null> {
  let jobs = readJobs();
  let chosen: string[] = [];
  const list = (label: string): HTMLSelectElement =>
    h("select", { cls: "menu-dialog-input batch-list", attrs: { multiple: "", size: String(LIST_ROWS), "aria-label": label } });
  const available = list("Available Jobs");
  const picked = list("Chosen Jobs");
  const button = (text: string, label: string, run: () => void | Promise<void>): HTMLButtonElement => {
    const b = h("button", { cls: "btn", text, attrs: { type: "button", "aria-label": label } });
    b.addEventListener("click", () => void run());
    return b;
  };
  const byName = (name: string): BatchJob | undefined => jobs.find((j) => j.name === name);
  const fill = (keep: ReadonlySet<string> = new Set()): void => {
    chosen = chosen.filter((n) => byName(n));
    const row = (job: BatchJob): HTMLOptionElement => {
      const o = h("option", { value: job.name, text: rowText(job), title: rowTitle(job) });
      o.selected = keep.has(job.name);
      return o;
    };
    available.replaceChildren(...jobs.filter((j) => !chosen.includes(j.name)).map(row));
    picked.replaceChildren(...chosen.map((n) => row(byName(n)!)));
    update();
  };
  const selected = (sel: HTMLSelectElement): string[] => [...sel.selectedOptions].map((o) => o.value);
  const save = (next: BatchJob[]): void => {
    jobs = next;
    writeJobs(jobs);
  };

  const chooseAll = button("Choose All", "Choose all jobs", () => {
    chosen = [...chosen, ...jobs.map((j) => j.name).filter((n) => !chosen.includes(n))];
    fill();
  });
  const add = button(">>", "Add to Chosen Jobs", () => {
    const names = selected(available);
    chosen = [...chosen, ...names];
    fill(new Set(names));
  });
  const remove = button("<<", "Back to Available Jobs", () => {
    const names = new Set(selected(picked));
    chosen = chosen.filter((n) => !names.has(n));
    fill(names);
  });
  const duplicate = button("Duplicate", "Duplicate the job", async () => {
    const job = byName(selected(available)[0] ?? "");
    if (!job) return;
    const name = await assignName(`${job.name} copy`, new Set(jobs.map((j) => j.name)));
    if (!name) return;
    save([...jobs, { ...job, name }]);
    fill(new Set([name]));
  });
  const edit = button("Edit", "Edit the job", async () => {
    const job = byName(selected(available)[0] ?? "");
    if (!job) return;
    const next = await editJob(job, jobs, view);
    if (!next) return;
    save(jobs.map((j) => (j === job ? next : j)));
    fill(new Set([next.name]));
  });
  const del = button("Delete", "Delete the job", () => {
    const names = new Set(selected(available));
    if (!names.size) return;
    save(jobs.filter((j) => !names.has(j.name)));
    fill();
  });
  const update = (): void => {
    const one = available.selectedOptions.length === 1;
    add.disabled = available.selectedOptions.length === 0;
    remove.disabled = picked.selectedOptions.length === 0;
    chooseAll.disabled = chosen.length === jobs.length;
    duplicate.disabled = !one;
    edit.disabled = !one;
    del.disabled = available.selectedOptions.length === 0;
  };
  available.addEventListener("change", update);
  picked.addEventListener("change", update);
  available.addEventListener("dblclick", () => add.click());
  picked.addEventListener("dblclick", () => remove.click());
  fill();

  const column = (label: string, sel: HTMLSelectElement): HTMLElement =>
    h("div", { cls: "batch-column" }, h("span", { cls: "menu-dialog-label", text: label }), sel);
  return showDialog<BatchJob[]>({
    title: "Start Batch Render",
    okLabel: "Start",
    cls: "batch-dialog",
    body: [
      h(
        "div",
        { cls: "batch-lists" },
        column("Available Jobs", available),
        h("div", { cls: "batch-moves" }, chooseAll, add, remove),
        column("Chosen Jobs", picked),
      ),
      h("div", { cls: "batch-actions" }, duplicate, edit, del),
      h("p", { cls: "render-hint", text: `The pictures download together, in a folder named for the date and time (${folderName(new Date())}.zip). Delete can't be undone.` }),
    ],
    check: () => {
      const run = chosen.map(byName).filter((j): j is BatchJob => !!j);
      return run.length ? { value: run } : { error: "Choose the jobs to render: pick them and press >>, or Choose All.", focus: available };
    },
  });
}

/** The Assign Name dialog of Duplicate: a name no job has. */
function assignName(start: string, taken: ReadonlySet<string>): Promise<string | null> {
  const input = h("input", { cls: "menu-dialog-input", value: start, attrs: { type: "text", "aria-label": "Name" } });
  return showDialog<string>({
    title: "Assign Name",
    okLabel: "OK",
    body: [h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Name" }), input)],
    check: () => {
      const name = input.value.trim();
      if (!name) return { error: "Name the job.", focus: input };
      if (taken.has(name)) return { error: `There is a job named “${name}” already.`, focus: input };
      return { value: name };
    },
  });
}

/** "Batch Render 2026-11-02 14.05": the folder the pictures go in. */
function folderName(d: Date): string {
  const two = (n: number): string => String(n).padStart(2, "0");
  return `Batch Render ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}`;
}

/** A name a file can take on every system. */
function fileSafe(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim() || "Picture";
}

/** Renders the jobs in turn under one progress window, then downloads what was made. */
async function runBatch(jobs: readonly BatchJob[]): Promise<void> {
  const session = store.session;
  if (!session) return;
  const folder = folderName(new Date());
  let stopped = false;
  let current: Job = { cancelled: false, finishNow: false };
  const box = showProgress({
    title: "Batch Render",
    finishable: jobs.some((j) => j.engine === "pathtraced"),
    onFinish: () => (current.finishNow = true),
    onCancel: () => {
      stopped = true;
      current.cancelled = true;
    },
  });
  // Esc drops the job in hand and goes on with the next, as in Vectorworks; it runs before the window's own keys
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    current.cancelled = true;
  };
  window.addEventListener("keydown", onKey, true);

  const files: [string, Uint8Array][] = [];
  const used = new Set<string>();
  const skipped: string[] = [];
  const failed: string[] = [];
  const cams = session.doc.cameras();
  try {
    for (const [i, job] of jobs.entries()) {
      if (stopped) break;
      current = { cancelled: false, finishNow: false };
      box.next();
      const shots = job.cameras
        ? job.cameras.flatMap((id) => {
            const at = cams.findIndex((c) => c.id === id);
            return at < 0 ? [] : [{ label: cameraLabel(cams[at], at), camera: cams[at] }];
          })
        : [{ label: job.name, camera: null, ...(job.view ? { shot: job.view } : {}) }];
      if (shots.length === 0) {
        failed.push(`${job.name} (its cameras are gone)`);
        continue;
      }
      const plan: Plan = { ...job, shots, where: "local", via: null, prefs: job.prefs };
      const results: RenderResult[] = [];
      const jobBox = { ...box, label: (text: string) => box.label(`Job ${i + 1} of ${jobs.length}: ${job.name} · ${text}`) };
      try {
        await makePictures(plan, current, jobBox, results);
      } catch (err) {
        failed.push(`${job.name} (${errorMessage(err)})`);
        continue;
      }
      if (current.cancelled) {
        if (!stopped) skipped.push(job.name);
        continue;
      }
      for (const r of results) {
        const base = fileSafe(job.cameras ? `${job.name} - ${r.name}` : job.name);
        let file = `${base}.${extension(job.format)}`;
        for (let n = 2; used.has(file.toLowerCase()); n++) file = `${base} ${n}.${extension(job.format)}`;
        used.add(file.toLowerCase());
        files.push([`${folder}/${file}`, new Uint8Array(await r.blob.arrayBuffer())]);
      }
    }
  } finally {
    window.removeEventListener("keydown", onKey, true);
    box.close();
  }

  if (files.length) downloadBlob(`${folder}.zip`, new Blob([zipFiles(files, true) as BlobPart], { type: "application/zip" }));
  const notes = [
    ...(skipped.length ? [`skipped ${skipped.join(", ")}`] : []),
    ...(failed.length ? [`not rendered: ${failed.join("; ")}`] : []),
    ...(stopped ? ["cancelled"] : []),
  ];
  const made = files.length ? `${files.length} ${files.length === 1 ? "picture" : "pictures"} in “${folder}.zip”` : "no pictures";
  toast(`Batch Render: ${made}${notes.length ? `; ${notes.join("; ")}` : ""}.`);
}

// ---- storage ------------------------------------------------------------------------------------

function storageKey(): string {
  return STORAGE_PREFIX + (store.fileName || "Untitled");
}

/** This file's jobs, those that read back whole. */
export function readJobs(): BatchJob[] {
  let raw: unknown = [];
  try {
    raw = JSON.parse(localStorage.getItem(storageKey()) ?? "[]");
  } catch {
    // storage blocked or not JSON: none
  }
  return Array.isArray(raw) ? raw.flatMap((j) => jobFrom(j) ?? []) : [];
}

function writeJobs(jobs: readonly BatchJob[]): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(jobs));
  } catch {
    toast("The batch render jobs couldn't be saved in this browser (storage is full or blocked).");
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isVec = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isNum);

/** A kept job checked, or null. */
function jobFrom(v: unknown): BatchJob | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const side = (n: unknown): n is number => isNum(n) && Number.isInteger(n) && n >= 16 && n <= 8192;
  const cameras = o.cameras === null ? null : Array.isArray(o.cameras) && o.cameras.every((c) => typeof c === "string") ? (o.cameras as string[]) : undefined;
  const view = shotFrom(o.view);
  if (typeof o.name !== "string" || !o.name || !side(o.width) || !side(o.height) || cameras === undefined) return null;
  if (o.engine !== "realistic" && o.engine !== "pathtraced") return null;
  if (o.format !== "png" && o.format !== "jpeg") return null;
  if (!isNum(o.samples) || o.samples < 1 || !isNum(o.minutes) || o.minutes < 0 || typeof o.denoise !== "boolean") return null;
  if (cameras === null && !view) return null;
  return {
    name: o.name,
    prefs: prefsFrom(o.prefs),
    width: o.width,
    height: o.height,
    engine: o.engine,
    samples: o.samples,
    minutes: o.minutes,
    denoise: o.denoise,
    format: o.format,
    cameras,
    view,
  };
}

function shotFrom(v: unknown): Shot | null {
  if (typeof v !== "object" || v === null) return null;
  const s = v as Record<string, unknown>;
  if (typeof s.perspective !== "boolean" || !isVec(s.eye) || !isVec(s.target) || !isNum(s.fov) || !isNum(s.halfHeight)) return null;
  return { name: typeof s.name === "string" ? s.name : "Current view", perspective: s.perspective, eye: s.eye, target: s.target, fov: s.fov, halfHeight: s.halfHeight };
}
