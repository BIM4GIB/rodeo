// The words of a voice command and the pins dropped while it was said: what parse.ts reads, pins.ts
// makes, and the controller and the agent use.

/** A word of the transcript, with what it points at: a pin (for "these", `all` lists every pin it takes), the selection, what the words before pointed at, a place with no pin, or nothing. */
export interface Word {
  readonly text: string;
  readonly ref:
    | { readonly kind: "pin"; readonly n: number; readonly all?: readonly number[] }
    | { readonly kind: "selection" }
    | { readonly kind: "previous" }
    | { readonly kind: "missing" }
    | null;
}

/** A pin dropped while speaking. */
export interface Pin {
  /** 1, 2, 3… in click order */
  readonly n: number;
  /** world millimetres: the plan point, and its height when pinned in the 3D view */
  readonly at: { readonly x: number; readonly y: number; readonly z?: number };
  /** the top-level object under it (the one a click selects), or null */
  readonly objectId: string | null;
  /** what is under it, as its label shows: "Door · A-Door", or "" */
  readonly label: string;
  /** the snap it took in the plan ("Endpoint"), or null */
  readonly snap: string | null;
  readonly in3d: boolean;
}
