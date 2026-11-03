// The sums behind Convert To Lighting Device and Replace Lighting Devices (devices.ts): the generic type a
// symbol's name suggests, for the figures a device converted from it starts with, and which way a
// converted device aims from its symbol's turn. Kept apart so it runs without the page.

import { DEFAULT_TYPE } from "../fixture.ts";

/** words in a symbol's name and the generic type they suggest, the more particular first */
const WORDS: readonly (readonly [RegExp, string])[] = [
  [/\bfollow\s*spot|\bfollowspot/, "followspot"],
  [/\bled\b.*\bpar\s*\d*\b|\bpar\s*\d*\b.*\bled\b/, "ledpar"],
  [/\bvnsp\b/, "parvnsp"],
  [/\bnsp\b/, "parnsp"],
  [/\bwfl\b/, "parwfl"],
  [/\bpar\s*\d*\b|\bmfl\b/, "parmfl"],
  [/\bwash\b.*\b(mover|moving|head)|\b(mover|moving|head)\b.*\bwash\b/, "washmover"],
  [/\bbeam\b/, "beammover"],
  [/\bprofile\b.*\b(mover|moving|head)|\b(mover|moving|head)\b.*\bprofile\b/, "profilemover"],
  [/\b(mover|moving|head|spot)\b/, "spotmover"],
  [/\bzoom\b/, "zoomprofile"],
  [/\bled\b.*\b(profile|ellipsoidal|ers)\b|\b(profile|ellipsoidal|ers)\b.*\bled\b/, "ledprofile"],
  [/\b(fresnel|pc)\b.*\b2\s*k/, "fresnel2k"],
  [/\b(fresnel|pc)\b.*\b(650|500)/, "fresnel650"],
  [/\b(fresnel|pc)\b/, "fresnel1k"],
  [/\b(cyc|flood|asymmetric)\b/, "cycflood"],
  [/\b(batten|strip|striplight|bar)\b/, "ledbatten"],
  [/\b(panel|wash)\b/, "ledpanel"],
  [/\b(19|5|10)\s*(°|deg|degree)/, "profile19"],
  [/\b(36)\s*(°|deg|degree)/, "profile36"],
  [/\b(50)\s*(°|deg|degree)/, "profile50"],
  [/\b(profile|ellipsoidal|leko|source\s*four|s4|ers)\b/, "profile26"],
];

/** The generic type whose figures a device named `name` (a symbol's) starts with: the first its words suggest, else the default. */
export function typeForName(name: string): string {
  const t = name.toLowerCase().replace(/[_\-.]+/g, " ");
  return WORDS.find(([re]) => re.test(t))?.[1] ?? DEFAULT_TYPE;
}

/** The aim of a device converted from a symbol instance turned `turned` degrees: the symbol's front is toward -y, so it aims down the page unturned. */
export const aimOfTurn = (turned: number): number => {
  const a = (((turned - 90) % 360) + 540) % 360 - 180;
  return Object.is(a, -0) ? 0 : a;
};
