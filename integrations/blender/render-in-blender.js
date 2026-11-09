// @name Render in Blender
// @description Adds Blender to Render Image: the model, the camera and the sun go to Blender on this computer, through rodeo_bridge.py, and its picture comes back.
// @version 1.0
// @author Rodeo

openvwx.render.engine(
  {
    name: "Blender",
    short: "Blender",
    description: "Renders in Blender on this computer: start rodeo_bridge.py in Blender first.",
    takes: "scene",
    options: [
      { key: "engine", label: "Blender engine", kind: "choice", choices: [["cycles", "Cycles"], ["eevee", "EEVEE"]], initial: "cycles" },
      { key: "samples", label: "Samples", kind: "number", initial: 128, min: 1, max: 16384 },
      { key: "port", label: "Bridge port", kind: "number", initial: 7416, min: 1024, max: 65535, hint: "The port rodeo_bridge.py listens on" },
    ],
  },
  async (job) => {
    const meta = { width: job.width, height: job.height, camera: job.camera, sun: job.sun, samples: job.options.samples, engine: job.options.engine };
    const url = "http://127.0.0.1:" + job.options.port + "/render";
    let res;
    try {
      res = await openvwx.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "model/gltf-binary", "X-Rodeo-Render": JSON.stringify(meta) },
        body: job.scene,
      });
    } catch (err) {
      throw new Error("Blender's bridge isn't answering on port " + job.options.port + ": start it with blender -b -P rodeo_bridge.py (" + err.message + ")");
    }
    if (!res.ok) {
      let said = res.statusText;
      try {
        said = JSON.parse(res.text).error || said;
      } catch (e) {
        // not JSON: the status
      }
      throw new Error("Blender: " + said);
    }
    const note = job.options.engine === "eevee" ? "EEVEE" : "Cycles, " + job.options.samples + " samples";
    return { bytes: res.bytes, type: "image/png", note: note };
  },
);
