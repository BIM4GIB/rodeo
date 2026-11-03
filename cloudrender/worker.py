"""Rodeo's cloud renders, on Modal (https://modal.com).

The Rodeo server (server/src/render.ts) sends a render job the editor packed (web/src/features/
render/pack.ts) to the `api` endpoint here, which starts `render` on a GPU. `render` runs headless
Chrome on the GPU (ANGLE on Vulkan) with the editor's render worker page (web/render-worker.html,
from web/dist), which builds the scene and makes the pictures with the same engines the editor
uses. The server polls the job, takes the pictures when they are done and charges the user's credit
for the seconds it ran.

Deploy (after building the editor, whose dist is baked in):
    cd web && npm run build && cd .. && modal deploy cloudrender/worker.py
The endpoint takes `Authorization: Bearer $RENDER_SECRET`, from the Modal secret "rodeo-render":
    modal secret create rodeo-render RENDER_SECRET=<a long random string>
"""

import hmac
import os
import pathlib
import threading
import time

import modal

DIST = pathlib.Path(__file__).resolve().parent.parent / "web" / "dist"
# the GPUs a job may ask for (Modal's names)
GPUS = {"T4", "L4", "A10", "L40S", "A100", "A100-80GB", "H100"}
# the longest a job may take, seconds
MAX_SECONDS = 4 * 3600
# kept on top of a job's own limit before Modal stops it: Chrome's start, the scene's build, sending the pictures
GRACE_SECONDS = 600

render_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("wget", "ca-certificates", "libvulkan1")
    .pip_install("playwright==1.55.0")
    .run_commands(
        "wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb",
        "apt-get update && apt-get install -y /tmp/chrome.deb && rm /tmp/chrome.deb",
        "playwright install-deps chromium",
    )
    # without "graphics" the container has no NVIDIA GL, EGL or Vulkan, and Chrome draws in software
    .env({"NVIDIA_DRIVER_CAPABILITIES": "all"})
    .add_local_dir(DIST, "/dist", ignore=["**/*.map"])
)
api_image = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi[standard]==0.115.12")

app = modal.App("rodeo-render")
# each running job's progress, and what the user asked of it ("stop:" + its call id), by call id
progress = modal.Dict.from_name("rodeo-render-progress", create_if_missing=True)

# when this container started: the first job it runs is billed from here, as Modal bills it
BOOT = time.time()
served = {"jobs": 0}

CHROME_ARGS = [
    "--no-sandbox",
    "--ignore-gpu-blocklist",
    "--enable-gpu",
    "--disable-gpu-sandbox",
    "--use-angle=vulkan",
    "--enable-features=Vulkan",
    "--disable-vulkan-surface",
]


@app.function(image=render_image, gpu="L40S", cpu=2.0, memory=8192, timeout=MAX_SECONDS, scaledown_window=2)
def render(pack: bytes, limit_seconds: float) -> dict:
    """Makes a job's pictures. Resolves with them and the seconds this container ran."""
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

    from playwright.sync_api import sync_playwright

    started = BOOT if served["jobs"] == 0 else time.time()
    served["jobs"] += 1
    call_id = modal.current_function_call_id() or "local"
    results: dict[int, tuple[bytes, str]] = {}

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory="/dist", **kwargs)

        def log_message(self, *args):
            pass

        def do_GET(self):
            if self.path != "/job.pack":
                return super().do_GET()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(pack)))
            self.end_headers()
            self.wfile.write(pack)

        def do_PUT(self):
            n = int(self.path.rsplit("/", 1)[-1])
            data = self.rfile.read(int(self.headers["Content-Length"]))
            results[n] = (data, self.headers.get("Content-Type") or "image/png")
            self.send_response(204)
            self.end_headers()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_address[1]}"

    # progress goes to the Dict from a thread of its own: Playwright's callbacks run in its event loop,
    # where Modal's blocking calls don't belong; the page is answered with the last word on stopping
    shared: dict = {"report": None, "preview": None, "stop": None, "done": False}

    def pump():
        while not shared["done"]:
            r = shared["report"]
            if r is not None:
                shared["report"] = None
                progress[call_id] = {**r, "preview": shared["preview"]}
            shared["stop"] = progress.get("stop:" + call_id)
            time.sleep(1)

    threading.Thread(target=pump, daemon=True).start()

    def report(r: dict):
        if r.get("preview"):
            shared["preview"] = r["preview"]
        shared["report"] = {"label": r.get("label"), "fraction": r.get("fraction"), "at": time.time()}
        return shared["stop"]

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path="/usr/bin/google-chrome",
                headless=True,
                args=CHROME_ARGS,
                ignore_default_args=["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"],
            )
            page = browser.new_page()
            page.on("console", lambda m: print(f"[page {m.type}] {m.text}") if m.type in ("error", "warning") else None)
            page.on("pageerror", lambda e: print(f"[page error] {e}"))
            page.expose_function("rodeoReport", report)
            page.goto(origin + "/render-worker.html")
            gpu = page.evaluate(
                """() => {
                  const gl = document.createElement('canvas').getContext('webgl2');
                  const e = gl && gl.getExtension('WEBGL_debug_renderer_info');
                  return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'no WebGL 2';
                }"""
            )
            print(f"WebGL: {gpu}")
            if "SwiftShader" in gpu or "no WebGL" in gpu:
                raise RuntimeError(f"Chrome has no GPU here ({gpu})")
            made = page.evaluate(
                "job => window.rodeoRender(job)",
                {"pack": "/job.pack", "results": "/results", "limitSeconds": max(1.0, limit_seconds - (time.time() - started))},
            )
            browser.close()
    finally:
        shared["done"] = True
        server.shutdown()

    images = []
    for n, m in enumerate(made):
        data, mime = results[n]
        images.append({"name": m["name"], "mime": mime, "samples": m["samples"], "seconds": m["seconds"], "data": data})
    for key in (call_id, "stop:" + call_id):
        try:
            progress.pop(key)
        except KeyError:
            pass
    return {"images": images, "seconds": time.time() - started, "gpu": gpu}


@app.function(image=api_image, secrets=[modal.Secret.from_name("rodeo-render")], scaledown_window=300)
@modal.concurrent(max_inputs=50)
@modal.asgi_app()
def api():
    from fastapi import FastAPI, HTTPException, Request, Response

    web = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    secret = os.environ["RENDER_SECRET"].encode()

    def check(req: Request) -> None:
        given = req.headers.get("authorization", "").removeprefix("Bearer ").encode()
        if not hmac.compare_digest(given, secret):
            raise HTTPException(401, "not allowed")

    def call_of(call_id: str) -> modal.FunctionCall:
        if not call_id.startswith("fc-"):
            raise HTTPException(404, "no such job")
        return modal.FunctionCall.from_id(call_id)

    @web.post("/jobs")
    async def start(req: Request, gpu: str = "L40S", limit: float = 0):
        """Starts a job: the body is its gzipped pack; `limit` the seconds it may take (0 for MAX_SECONDS)."""
        check(req)
        if gpu not in GPUS:
            raise HTTPException(400, f"no GPU {gpu}")
        pack = await req.body()
        if not pack:
            raise HTTPException(400, "no job")
        timeout = int(min(MAX_SECONDS, limit + GRACE_SECONDS if limit > 0 else MAX_SECONDS))
        call = await render.with_options(gpu=gpu, timeout=timeout).spawn.aio(pack, limit or MAX_SECONDS - GRACE_SECONDS)
        return {"call": call.object_id}

    @web.get("/jobs/{call_id}")
    async def status(req: Request, call_id: str):
        """running (with its progress), done (the pictures' details and the seconds it ran) or failed."""
        check(req)
        call = call_of(call_id)
        try:
            result = await call.get.aio(timeout=0)
        except TimeoutError:
            return {"state": "running", "progress": await progress.get.aio(call_id)}
        except modal.exception.FunctionTimeoutError:
            return {"state": "failed", "error": "the render ran out of time"}
        except Exception as e:  # noqa: BLE001 - whatever stopped it, the server is told
            return {"state": "failed", "error": str(e) or type(e).__name__}
        images = [{k: v for k, v in im.items() if k != "data"} | {"bytes": len(im["data"])} for im in result["images"]]
        return {"state": "done", "seconds": result["seconds"], "gpu": result.get("gpu"), "images": images}

    @web.get("/jobs/{call_id}/images/{n}")
    async def image(req: Request, call_id: str, n: int):
        check(req)
        result = await call_of(call_id).get.aio(timeout=0)
        if not 0 <= n < len(result["images"]):
            raise HTTPException(404, "no such picture")
        im = result["images"][n]
        return Response(content=im["data"], media_type=im["mime"])

    @web.post("/jobs/{call_id}/stop")
    async def stop(req: Request, call_id: str, mode: str = "finish"):
        """finish: keep the picture in hand; cancel: discard it. kill: stop the container (a job that hangs)."""
        check(req)
        call = call_of(call_id)
        if mode == "kill":
            await call.cancel.aio()
        elif mode in ("finish", "cancel"):
            await progress.put.aio("stop:" + call_id, mode)
        else:
            raise HTTPException(400, "finish, cancel or kill")
        return {"ok": True}

    return web


@app.local_entrypoint()
def main(pack: str, gpu: str = "L40S", limit: float = 600, out: str = "."):
    """A job straight to the GPU, for testing: modal run cloudrender/worker.py --pack job.pack.gz"""
    t = time.time()
    result = render.with_options(gpu=gpu).remote(pathlib.Path(pack).read_bytes(), limit)
    print(f"{result['gpu']}: {result['seconds']:.1f} s in the container, {time.time() - t:.1f} s here")
    for n, im in enumerate(result["images"]):
        path = pathlib.Path(out) / f"cloud-{n}.{'jpg' if im['mime'] == 'image/jpeg' else 'png'}"
        path.write_bytes(im["data"])
        print(f"{path}: {im['name']}, {im['samples']} samples in {im['seconds']:.1f} s")
