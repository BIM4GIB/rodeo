// The fillet radius Vectorworks shares between the Fillet tool and Modify > Join > Join and Fillet:
// a change in one is the radius both use. Join and Fillet asks for it (Fillet Settings) until one
// has been set in this window.

/** mm, until one is set */
const DEFAULT_RADIUS = 300;

let radius = DEFAULT_RADIUS;
let chosen = false;

export function filletRadius(): number {
  return radius;
}

/** True once a radius has been set here (the Fillet tool's, or Fillet Settings'). */
export function filletRadiusChosen(): boolean {
  return chosen;
}

export function setFilletRadius(r: number): void {
  radius = r;
  chosen = true;
}
