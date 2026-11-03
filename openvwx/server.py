"""Local browser viewer/editor: python -m openvwx serve file.vwx"""

import json
import os
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import Document, svg

WEB = os.path.join(os.path.dirname(__file__), "web")


class Session:
    def __init__(self, path):
        self.path = os.path.abspath(path)
        self.doc = Document.open(self.path)
        self.lock = threading.Lock()
        self.dirty = False
        self.svg_cache = {}

    def summary(self):
        doc = self.doc
        counts = {}
        for l in doc.layers:
            counts[l.id] = {}
            for _, s in l.objects():
                counts[l.id][s.class_index] = counts[l.id].get(s.class_index, 0) + 1
        used = {}
        for per in counts.values():
            for k, v in per.items():
                used[k] = used.get(k, 0) + v
        c = doc.container
        return {
            "file": os.path.basename(self.path),
            "version": f"{c.saved_with} (created {c.created_with}, build {c.build})",
            "records": len(doc.records),
            "dirty": self.dirty,
            "layers": [{"id": l.id, "name": l.name, "title": l.title, "kind": l.kind,
                        "scale": l.scale, "visibility": l.visibility,
                        "objects": sum(counts[l.id].values())} for l in doc.layers],
            "classes": sorted(({"index": k.index, "name": k.name, "visibility": k.visibility,
                                "objects": used.get(k.index, 0)} for k in doc.classes),
                              key=lambda k: k["name"].lower()),
        }

    def layer_svg(self, layer_id):
        if layer_id not in self.svg_cache:
            g, b = svg.layer_group(self.doc, self.doc.layer(layer_id))
            self.svg_cache[layer_id] = {"svg": g, "bounds": b}
        return self.svg_cache[layer_id]

    def default_save_path(self):
        root, ext = os.path.splitext(self.path)
        return f"{root}-edited{ext or '.vwx'}"


class Handler(BaseHTTPRequestHandler):
    session: Session = None

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json"):
        if not isinstance(body, (bytes, bytearray)):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        s = self.session
        try:
            if self.path in ("/", "/index.html"):
                with open(os.path.join(WEB, "index.html"), "rb") as f:
                    return self._send(200, f.read(), "text/html; charset=utf-8")
            if self.path == "/api/doc":
                with s.lock:
                    return self._send(200, s.summary())
            if self.path.startswith("/api/layer/"):
                with s.lock:
                    return self._send(200, s.layer_svg(self.path.rsplit("/", 1)[1]))
            self._send(404, {"error": "not found"})
        except KeyError as e:
            self._send(404, {"error": f"unknown {e}"})

    def do_POST(self):
        s = self.session
        try:
            body = self._body()
            with s.lock:
                doc = s.doc
                if self.path.startswith("/api/layer/"):
                    layer = doc.layer(self.path.rsplit("/", 1)[1])
                    if "name" in body or "title" in body:
                        doc.rename_layer(layer, body.get("name"), body.get("title"))
                    if "visibility" in body:
                        doc.set_layer_visibility(layer, body["visibility"])
                elif self.path == "/api/order":
                    doc.reorder_layers([doc.layer(i) for i in body["order"]])
                elif self.path.startswith("/api/class/"):
                    doc.set_class_visibility(doc.find_class(self.path.rsplit("/", 1)[1]),
                                             body["visibility"])
                elif self.path == "/api/save":
                    path = s.default_save_path()
                    size = doc.save(path)
                    s.dirty = False
                    return self._send(200, {"path": path, "bytes": size})
                else:
                    return self._send(404, {"error": "not found"})
                s.dirty = True
                return self._send(200, s.summary())
        except (KeyError, ValueError) as e:
            self._send(400, {"error": str(e).strip("'\"")})


def serve(path, port=8765, open_browser=True):
    Handler.session = Session(path)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/"
    print(f"openvwx viewer for {path} at {url}  (Ctrl+C to stop)")
    if open_browser:
        threading.Timer(0.5, webbrowser.open, [url]).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
