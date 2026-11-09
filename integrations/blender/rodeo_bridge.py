"""Rodeo's bridge to Blender: renders Render Image's pictures in Blender on this computer.

Blender runs this headless, and it listens on 127.0.0.1 for the plug-in render-in-blender.js, which
adds "Blender Cycles" to Rodeo's File > Export > Render Image. For each picture the plug-in sends
the visible model as binary glTF (y up, metres) in the body, and the picture's size, the camera
(eye and target in millimetres, z up), the sun and the samples as JSON in an X-Rodeo-Render header.
The bridge opens the model in an empty scene, places the camera and the sun, renders with Cycles
(or EEVEE) on the GPU when Blender finds one, and answers with the PNG. One picture at a time;
nothing is kept.

Run (Blender 4.2 or later):
    blender -b -P integrations/blender/rodeo_bridge.py -- --port 7416
Only pages at the origins allowed may use it: Rodeo's (https://rodeo.build), this computer's own
(http://localhost and http://127.0.0.1, for a Rodeo of your own), and any given with --allow-origin.
"""

import argparse
import json
import math
import os
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

import bpy
from mathutils import Vector

DEFAULT_PORT = 7416
ORIGINS = {"https://rodeo.build"}
# a model larger than this isn't taken
MAX_BODY = 1024 * 1024 * 1024
MAX_SIDE = 8192
MAX_SAMPLES = 16384
# the sky behind the model, linear RGB, and how bright it is with the sun on and off
SKY = (0.55, 0.66, 0.82, 1.0)
SKY_STRENGTH = (0.35, 0.15)
SUN_ENERGY = 3.0
# the sun's width, degrees: soft shadow edges as the sky gives them
SUN_ANGLE = 1.0
# the ground under the model: its colour (linear RGB) and how far past the model it reaches, times its size
GROUND = (0.32, 0.32, 0.3, 1.0)
GROUND_REACH = 40


def allowed(origin, extra):
    """A page at `origin` may use the bridge: Rodeo's, this computer's own, or one given."""
    if not origin:
        return False
    if origin in ORIGINS or origin in extra:
        return True
    url = urlparse(origin)
    return url.scheme in ("http", "https") and url.hostname in ("localhost", "127.0.0.1", "::1")


def use_gpu():
    """Has Cycles render on the GPU where Blender finds one; its kind ("METAL", "OPTIX"...), or None."""
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except KeyError:
        return None
    for kind in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type != "CPU"]
        if gpus:
            for d in prefs.devices:
                d.use = d.type != "CPU"
            return kind
    return None


def eevee_id():
    """EEVEE's engine name in this Blender: BLENDER_EEVEE_NEXT in 4.2 to 4.4, BLENDER_EEVEE before and since."""
    names = {item.identifier for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    return "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in names else "BLENDER_EEVEE"


def add_ground(scene):
    """A plain ground a hair under the model's lowest point, for its shadows; nothing for an empty model."""
    corners = [obj.matrix_world @ Vector(c) for obj in scene.objects if obj.type == "MESH" for c in obj.bound_box]
    if not corners:
        return
    low = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    high = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    size = max((high - low).length, 1.0) * GROUND_REACH
    centre = (low + high) / 2
    bpy.ops.mesh.primitive_plane_add(size=size, location=(centre.x, centre.y, low.z - 1e-4 * size))
    material = bpy.data.materials.new("Rodeo ground")
    material.use_nodes = True
    shader = material.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = GROUND
    shader.inputs["Roughness"].default_value = 0.9
    bpy.context.object.data.materials.append(material)


def look_from(obj, eye, target):
    """Turns `obj` (a camera or a light, which look down their -Z) from `eye` toward `target`."""
    obj.location = eye
    obj.rotation_euler = (target - eye).to_track_quat("-Z", "Y").to_euler()


def render(meta, glb, gpu):
    """The picture of the glTF model `glb` that `meta` asks for, as PNG bytes."""
    width = int(meta.get("width", 1920))
    height = int(meta.get("height", 1080))
    if not (16 <= width <= MAX_SIDE and 16 <= height <= MAX_SIDE):
        raise ValueError(f"a picture is 16 to {MAX_SIDE} px a side")
    samples = max(1, min(MAX_SAMPLES, int(meta.get("samples", 128))))
    cam = meta.get("camera") or {}
    # Rodeo's millimetres, z up, are Blender's metres once the glTF importer has turned y up to z up
    eye = Vector(cam.get("eye", (10000, -10000, 6000))) / 1000
    target = Vector(cam.get("target", (0, 0, 0))) / 1000
    if (target - eye).length < 1e-6:
        raise ValueError("the camera's eye and target are the same point")

    bpy.ops.wm.read_homefile(use_empty=True)
    scene = bpy.context.scene
    with tempfile.TemporaryDirectory() as tmp:
        model = os.path.join(tmp, "model.glb")
        with open(model, "wb") as f:
            f.write(glb)
        bpy.ops.import_scene.gltf(filepath=model)
        add_ground(scene)

        data = bpy.data.cameras.new("Rodeo camera")
        data.sensor_fit = "VERTICAL"
        # a far plane well past the model but not the 100 km an orthogonal EEVEE picture loses its depth over
        data.clip_start = 0.01
        data.clip_end = max(1000.0, 50 * (target - eye).length)
        if cam.get("perspective", True):
            data.type = "PERSP"
            data.angle_y = math.radians(float(cam.get("fov", 35)))
        else:
            data.type = "ORTHO"
            data.ortho_scale = 2 * float(cam.get("halfHeight", 5000)) / 1000
        camera = bpy.data.objects.new("Rodeo camera", data)
        scene.collection.objects.link(camera)
        look_from(camera, eye, target)
        scene.camera = camera

        sun = meta.get("sun")
        if sun:
            light = bpy.data.lights.new("Sun", "SUN")
            light.energy = SUN_ENERGY
            light.angle = math.radians(SUN_ANGLE)
            lamp = bpy.data.objects.new("Sun", light)
            scene.collection.objects.link(lamp)
            # the light falls from the sun: along the opposite of the direction toward it
            lamp.rotation_euler = (-Vector(sun)).to_track_quat("-Z", "Y").to_euler()

        world = bpy.data.worlds.new("Rodeo sky")
        world.use_nodes = True
        background = world.node_tree.nodes["Background"]
        background.inputs[0].default_value = SKY
        background.inputs[1].default_value = SKY_STRENGTH[0] if sun else SKY_STRENGTH[1]
        scene.world = world

        if meta.get("engine") == "eevee":
            scene.render.engine = eevee_id()
            scene.eevee.taa_render_samples = samples
        else:
            scene.render.engine = "CYCLES"
            scene.cycles.samples = samples
            scene.cycles.use_denoising = True
            scene.cycles.device = "GPU" if gpu else "CPU"
        scene.render.resolution_x = width
        scene.render.resolution_y = height
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGB"
        out = os.path.join(tmp, "picture.png")
        scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        with open(out, "rb") as f:
            return f.read()


def handler_for(extra, gpu):
    class Handler(BaseHTTPRequestHandler):
        server_version = "RodeoBlenderBridge/1"

        def cors(self):
            origin = self.headers.get("Origin", "")
            if allowed(origin, extra):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Rodeo-Render")
                # Chrome asks before a public page reaches this computer
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Access-Control-Max-Age", "600")

        def answer(self, status, body, kind="application/json"):
            self.send_response(status)
            self.cors()
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def refuse(self, status, message):
            self.answer(status, json.dumps({"error": message}).encode())

        def do_OPTIONS(self):
            self.send_response(204 if allowed(self.headers.get("Origin", ""), extra) else 403)
            self.cors()
            self.end_headers()

        def do_GET(self):
            if self.path != "/status":
                return self.refuse(404, "Not found")
            self.answer(200, json.dumps({"ok": True, "blender": bpy.app.version_string, "gpu": gpu}).encode())

        def do_POST(self):
            if self.path != "/render":
                return self.refuse(404, "Not found")
            origin = self.headers.get("Origin", "")
            if origin and not allowed(origin, extra):
                return self.refuse(403, f"{origin} may not use this bridge: start it with --allow-origin {origin}")
            size = int(self.headers.get("Content-Length") or 0)
            if size <= 0 or size > MAX_BODY:
                return self.refuse(413, "Send the model as binary glTF, under 1 GB")
            try:
                meta = json.loads(self.headers.get("X-Rodeo-Render") or "{}")
            except json.JSONDecodeError:
                return self.refuse(400, "X-Rodeo-Render isn't JSON")
            glb = self.rfile.read(size)
            if glb[:4] != b"glTF":
                return self.refuse(400, "The body isn't binary glTF")
            try:
                picture = render(meta, glb, gpu)
            except Exception as err:  # the request's fault or Blender's: said to the plug-in, the bridge stays up
                print(f"[rodeo] render failed: {err}", file=sys.stderr)
                return self.refuse(422, f"Blender couldn't render it: {err}")
            self.answer(200, picture, "image/png")

        def log_message(self, fmt, *args):
            print("[rodeo] " + fmt % args, file=sys.stderr)

    return Handler


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="rodeo_bridge.py", description="Renders Rodeo's pictures in Blender.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--allow-origin", action="append", default=[], help="another address of Rodeo allowed to use the bridge")
    args = parser.parse_args(argv)
    gpu = use_gpu()
    server = HTTPServer(("127.0.0.1", args.port), handler_for(set(args.allow_origin), gpu))
    print(f"[rodeo] Blender {bpy.app.version_string} renders for Rodeo on http://127.0.0.1:{args.port} ({gpu or 'CPU'})", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


main()
