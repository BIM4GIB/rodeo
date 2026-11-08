# Render in Blender

Adds **Blender** to Rodeo's **File › Export › Render Image…**: the model, the camera and the sun go to Blender on your computer, Blender renders the picture with Cycles (or EEVEE), and it comes back to Rodeo's render viewer.

Two parts:

- `rodeo_bridge.py` runs inside Blender, with no window, and listens on `http://127.0.0.1:7416` for Rodeo.
- `render-in-blender.js` is the Rodeo plug-in that adds the engine and talks to the bridge.

## Setting it up

1. Start the bridge (Blender 4.2 or later; on a Mac Blender is `/Applications/Blender.app/Contents/MacOS/Blender`):

   ```bash
   blender -b -P integrations/blender/rodeo_bridge.py -- --port 7416
   ```

   It prints `Blender … renders for Rodeo on http://127.0.0.1:7416` and whether it found a GPU (Metal, OptiX, CUDA, HIP or oneAPI). Leave it running; Ctrl+C stops it.

2. In Rodeo, open **Tools › Plug-ins › Plug-in Manager…**, import `render-in-blender.js` and turn it on.

3. Open **File › Export › Render Image…** and choose **Blender · plug-in** as the Engine. Choose Cycles or EEVEE and the samples, then **Render**. The first time, Rodeo asks whether the plug-in may reach `http://127.0.0.1:7416`, and Chrome may ask whether rodeo.build may reach devices on your network: allow both.

The first Cycles picture after the bridge starts takes longer: Blender compiles its GPU kernels once.

## Which pages may use it

The bridge only answers pages at `https://rodeo.build` and at `localhost` or `127.0.0.1` (a Rodeo you run yourself). A Rodeo at another address needs `--allow-origin https://that.address`. It listens on `127.0.0.1` only, so other computers can't reach it.

## What goes to Blender

- The visible design layers as binary glTF, as **File › Export › Export Model** writes it: each object's mesh with its class or object colour and opacity.
- The camera: Render Image's camera or the 3D view's, perspective or orthogonal, with its field of view.
- The sun where the Realistic picture has it: the Heliodon's place, date and time (none at night or with the Render palette's sun off), a plain sky, and a grey ground under the model for its shadows.

Not sent: textures, the Render palette's materials and library materials, light objects, the sky settings, fog and the effects. Light and finish them in Blender for now; the bridge is a starting point for a fuller one.

## Other renderers

The same plug-in call, `openvwx.render.engine`, can bridge to any renderer that can be driven from outside: a render farm's API, a service, or an app with a command line. Enscape and D5 Render are driven by their own plug-ins inside the modelling apps they support; unless they offer a way for another program to start a render, a bridge to them can hand over the model and camera (glTF) but not bring a picture back. See `web/src/features/plugins/API.md` for the call.
