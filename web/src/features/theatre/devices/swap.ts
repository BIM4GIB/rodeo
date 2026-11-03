// Spotlight's Swap Lighting Devices, its sums (deviceMenu.ts runs it): two lighting devices trade places,
// each taking the other's hanging point and lens height. The data that belongs to where a device hangs
// stays there: the Unit Number and Position always, and the Circuit, Dimmer and Universe/Address unless
// they're chosen to move with the device. Everything else (type, colour, channel, accessories, focus and
// so on) goes with it. Plain data in and out.

import type { Fixture, FixtureEdit } from "../fixture.ts";

/** Which of the optional fields move with the device; those not ticked stay where it hangs. */
export interface SwapOptions {
  readonly circuit: boolean;
  readonly dimmer: boolean;
  readonly patch: boolean;
}

/** One device's part of a swap: how far it moves in plan and what it takes from the other. */
export interface SwapMove {
  readonly id: string;
  readonly dx: number;
  readonly dy: number;
  readonly edit: FixtureEdit;
}

export const SWAP_DEFAULTS: SwapOptions = { circuit: false, dimmer: false, patch: false };

/** The two devices' moves and edits, `a`'s first. */
export function swapDevices(a: Fixture, b: Fixture, o: SwapOptions): [SwapMove, SwapMove] {
  const to = (d: Fixture, other: Fixture): SwapMove => ({
    id: d.id,
    dx: other.at.x - d.at.x,
    dy: other.at.y - d.at.y,
    edit: {
      heightMm: other.heightMm,
      unit: other.unit,
      position: other.position,
      ...(o.circuit ? {} : { circuit: other.circuit }),
      ...(o.dimmer ? {} : { dimmer: other.dimmer }),
      ...(o.patch ? {} : { universe: other.universe, address: other.address }),
    },
  });
  return [to(a, b), to(b, a)];
}

/** Swap options read back from storage, the defaults for anything malformed. */
export function swapOptionsOf(raw: unknown): SwapOptions & { readonly shiftSkips: boolean } {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const flag = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
  return { circuit: flag(o.circuit, false), dimmer: flag(o.dimmer, false), patch: flag(o.patch, false), shiftSkips: flag(o.shiftSkips, true) };
}
