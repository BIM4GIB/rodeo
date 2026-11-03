// The center of rotation Modify > Rotate 3D… asks for when Next Mouse Click is chosen
// (rotate3d.ts): one click in plan, on the layer plane. The tool is taken up by the command alone
// and hands back to the tool before it; Esc gives up.

import { endRotate3DJob, finishRotate3D, rotate3DJob } from "../rotate3d.ts";
import { BaseTool, type PointerInfo, type ToolEnv } from "../tools.ts";

export class Rotate3DCentreTool extends BaseTool {
  readonly id = "rotate3dcentre";
  readonly cursor = "crosshair";

  constructor(
    env: ToolEnv,
    private readonly done: () => void,
  ) {
    super(env);
  }

  hint(): string {
    if (!rotate3DJob()) return "Rotate 3D: select 3D objects and choose Modify > Rotate 3D…";
    return "Click the center of rotation · Esc cancels";
  }

  down(p: PointerInfo): void {
    const ready = rotate3DJob() !== null;
    this.done();
    if (ready) finishRotate3D(p.pos);
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape") return false;
    endRotate3DJob();
    this.done();
    return true;
  }
}
