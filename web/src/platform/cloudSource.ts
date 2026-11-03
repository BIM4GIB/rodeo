// A drawing opened from the openvwx cloud: what features that work on cloud
// drawings (live collaboration, crit mode, versions, sharing) read off
// ext.documentSource().

import type { DocumentSource } from "../app/ext.ts";
import type { Role } from "./protocol.ts";

export interface CloudSource extends DocumentSource {
  readonly kind: "cloud";
  /** the cloud file id */
  readonly id: string;
  /** the version that was opened */
  readonly versionId: string;
  /** the last live-collaboration change that version holds */
  readonly collabSeq: number;
  /** the signed-in user's role in the drawing */
  readonly role: Role;
}

export function isCloudSource(s: DocumentSource | null): s is CloudSource {
  return !!s && s.kind === "cloud" && typeof s.id === "string" && typeof (s as CloudSource).versionId === "string";
}
