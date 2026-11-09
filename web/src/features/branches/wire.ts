// The wire types of branches and merge requests, shared by the server and the editor. No DOM here:
// the server imports this file, and the name rules below are checked on both ends.

import type { Role } from "../../platform/protocol.ts";

/** Most branches one drawing can have. */
export const MAX_BRANCHES = 20;
/** Longest branch name, in characters. */
export const BRANCH_NAME_MAX = 60;
/** Longest merge request title, in characters. */
export const MERGE_TITLE_MAX = 120;
/** Longest merge request description, in characters. */
export const MERGE_BODY_MAX = 4000;
/** the name Main is shown by; a branch can't take it */
export const MAIN_NAME = "Main";

/** A drawing's longest file name, the same limit a drawing's name has everywhere else. */
const FILE_NAME_MAX = 200;

/** A person as the editor shows them: their id and name. */
export interface Person {
  readonly id: string;
  readonly name: string;
}

/** A drawing of a family, Main or one of its branches, as the editor lists it. */
export interface BranchInfo {
  readonly fileId: string;
  /** the branch's name, or "Main" */
  readonly name: string;
  readonly main: boolean;
  readonly headVersionId: string;
  readonly size: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: Person | null;
  /** the version it started from (a version of Main or of the branch it came from); null for Main */
  readonly fromVersionId: string | null;
  /** its open merge request, if any */
  readonly openRequestId: string | null;
}

/** A drawing's family: Main with its branches, and the caller's role on Main. */
export interface Family {
  /** Main's file id */
  readonly rootId: string;
  readonly rootName: string;
  readonly ownerId: string;
  /** the caller's role */
  readonly role: Role;
  readonly main: BranchInfo;
  /** oldest first */
  readonly branches: readonly BranchInfo[];
}

/** Where a merge request stands. */
export type MergeState = "open" | "merged" | "closed";

/** One person's approval of a branch, on the version they approved. */
export interface Approval {
  readonly user: Person;
  readonly at: string;
  /** the branch version approved */
  readonly versionId: string;
  /** true when that is still the branch's head */
  readonly current: boolean;
}

/** A request to merge a branch into Main, with its discussion read from the branch's comments. */
export interface MergeRequest {
  readonly id: string;
  readonly sourceFileId: string;
  readonly targetFileId: string;
  readonly branchName: string;
  readonly title: string;
  readonly body: string;
  readonly state: MergeState;
  readonly author: Person | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly mergedBy: Person | null;
  readonly mergedAt: string | null;
  readonly mergedVersionId: string | null;
  readonly approvals: readonly Approval[];
  readonly sourceHeadVersionId: string;
  readonly targetHeadVersionId: string;
}

/** Cleans a branch name for use, or null when it can't be one (empty, or Main's name in any case). */
export function cleanBranchName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = Array.from(v.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim())
    .slice(0, BRANCH_NAME_MAX)
    .join("")
    .trim();
  if (!name || name.toLowerCase() === MAIN_NAME.toLowerCase()) return null;
  return name;
}

/** A branch's file name, "<Main's name> · <branch>", keeping a ".vwx" ending where Main has one. */
export function branchFileName(rootName: string, branch: string): string {
  const ending = /\.vwx$/i.test(rootName) ? rootName.slice(-4) : "";
  const base = rootName.slice(0, rootName.length - ending.length);
  const tail = ` · ${branch}${ending}`;
  // Main's name is cut, not the branch's, so the branch name always shows in full.
  const room = Math.max(0, FILE_NAME_MAX - Array.from(tail).length);
  return Array.from(base).slice(0, room).join("") + tail;
}
