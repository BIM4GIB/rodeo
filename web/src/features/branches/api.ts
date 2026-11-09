// The editor's calls to the branches and merge request endpoints (server/src/lineage.ts and
// merges.ts). Byte uploads go through sendBytes, so a large merged drawing is sent in parts; the
// server checks the two head versions the editor merged from before it takes the bytes.

import { bytesOf, json, request, sendBytes, type Progress } from "../../platform/api.ts";
import type { CloudFile, Version } from "../../platform/protocol.ts";
import type { BranchInfo, Family, MergeRequest } from "./wire.ts";

/** The branch calls: the family, new, rename and delete, a branch's starting point, and its update from Main. */
export const branches = {
  /** A drawing's family: Main with its branches, and the caller's role. */
  family: async (fileId: string): Promise<Family> => (await json<{ family: Family }>("GET", `/files/${fileId}/family`)).family,
  /** Starts a branch from a drawing's head: Main's, or the branch's own. */
  create: (fileId: string, name: string): Promise<{ branch: BranchInfo; file: CloudFile }> =>
    json("POST", `/files/${fileId}/branches`, { name }),
  rename: async (branchId: string, name: string): Promise<BranchInfo> =>
    (await json<{ branch: BranchInfo }>("PATCH", `/branches/${branchId}`, { name })).branch,
  remove: async (branchId: string): Promise<void> => void (await request("DELETE", `/branches/${branchId}`)),
  /** The drawing a branch and Main last agreed on: the common ancestor of a merge. */
  base: async (branchId: string): Promise<Uint8Array> => bytesOf(await request("GET", `/branches/${branchId}/base`)),
  /** Saves Main merged into the branch: `into` is the branch head merged on, `from` the Main head merged in. */
  update: async (branchId: string, bytes: Uint8Array, into: string, from: string, onProgress?: Progress): Promise<Version> => {
    const res = await sendBytes("POST", `/branches/${branchId}/update`, bytes, "The merged drawing", { "X-Into-Version": into, "X-From-Version": from }, onProgress);
    return ((await res.json()) as { version: Version }).version;
  },
};

/** The merge request calls: list, open, read, edit, approve, and merge. */
export const mergeRequests = {
  /** A family's merge requests, open ones first; `all` includes merged and closed ones. */
  list: async (fileId: string, all = false): Promise<MergeRequest[]> =>
    (await json<{ requests: MergeRequest[] }>("GET", `/files/${fileId}/merge-requests${all ? "?state=all" : ""}`)).requests,
  get: async (id: string): Promise<MergeRequest> => (await json<{ request: MergeRequest }>("GET", `/merge-requests/${id}`)).request,
  /** Asks to merge a branch into Main. */
  create: async (branchId: string, title: string, body: string): Promise<MergeRequest> =>
    (await json<{ request: MergeRequest }>("POST", `/branches/${branchId}/merge-requests`, { title, body })).request,
  edit: async (id: string, patch: { title?: string; body?: string; state?: "open" | "closed" }): Promise<MergeRequest> =>
    (await json<{ request: MergeRequest }>("PATCH", `/merge-requests/${id}`, patch)).request,
  /** Records the caller's approval of the branch's current version. */
  approve: async (id: string): Promise<MergeRequest> => (await json<{ request: MergeRequest }>("POST", `/merge-requests/${id}/approval`)).request,
  unapprove: async (id: string): Promise<MergeRequest> => (await json<{ request: MergeRequest }>("DELETE", `/merge-requests/${id}/approval`)).request,
  /** Merges the branch into Main with the bytes the editor merged; `into` is Main's head, `from` the branch's. */
  merge: async (id: string, bytes: Uint8Array, into: string, from: string, onProgress?: Progress): Promise<{ request: MergeRequest; version: Version }> => {
    const res = await sendBytes("POST", `/merge-requests/${id}/merge`, bytes, "The merged drawing", { "X-Into-Version": into, "X-From-Version": from }, onProgress);
    return (await res.json()) as { request: MergeRequest; version: Version };
  },
};
