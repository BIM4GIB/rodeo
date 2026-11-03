"""Render layers to SVG. Document y points up, so every y is negated."""

import base64
from collections import defaultdict
from xml.sax.saxutils import escape

from .document import _bounds
from .geometry import arc_points


def _fmt(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def _path(points, closed):
    if len(points) < 2:
        return ""
    d = "M" + " L".join(f"{_fmt(x)} {_fmt(-y)}" for x, y in points)
    return d + (" Z" if closed else "")


def shape_svg(s):
    if s.kind in ("line", "polyline", "rect"):
        d = _path(s.points, s.closed)
        return f'<path d="{d}"/>' if d else ""
    if s.kind == "arc":
        if abs(s.sweep) >= 360:
            (cx, cy), (rx, ry) = s.center, s.radii
            return f'<ellipse cx="{_fmt(cx)}" cy="{_fmt(-cy)}" rx="{_fmt(rx)}" ry="{_fmt(ry)}"/>'
        return f'<path d="{_path(arc_points(s), False)}"/>'
    if s.kind == "text" and s.bbox:
        x0, y0, x1, y1 = s.bbox
        h = (y1 - y0) or 1
        lines = s.text.replace("\r\n", "\r").replace("\n", "\r").split("\r")
        size = h / max(1, len(lines)) * 0.8
        tspans = "".join(
            f'<tspan x="{_fmt(x0)}" y="{_fmt(-y1 + size * (i + 1))}">{escape(t)}</tspan>'
            for i, t in enumerate(lines))
        return f'<text font-size="{_fmt(size)}">{tspans}</text>'
    if s.kind == "image" and s.bbox:
        x0, y0, x1, y1 = s.bbox
        if s.image:
            href = f"data:{s.image_mime};base64,{base64.b64encode(s.image).decode()}"
            return (f'<image x="{_fmt(x0)}" y="{_fmt(-y1)}" width="{_fmt(x1 - x0)}" '
                    f'height="{_fmt(y1 - y0)}" preserveAspectRatio="none" href="{href}"/>')
        return (f'<rect class="placeholder" x="{_fmt(x0)}" y="{_fmt(-y1)}" '
                f'width="{_fmt(x1 - x0)}" height="{_fmt(y1 - y0)}"/>')
    return ""


def layer_group(doc, layer):
    """<g> for one layer, with one child <g data-class=..> per class.
    Returns (svg_text, bounds)."""
    by_class = defaultdict(list)
    shapes = []
    for _, s in layer.objects():
        frag = shape_svg(s)
        if frag:
            by_class[s.class_index].append(frag)
            shapes.append(s)
    parts = [f'<g class="layer" data-layer="{layer.id}">']
    for cls, frags in by_class.items():
        parts.append(f'<g data-class="{cls}">' + "".join(frags) + "</g>")
    parts.append("</g>")
    return "".join(parts), _bounds(shapes)


STYLE = ("path,ellipse,rect.placeholder{fill:none;stroke:#1d1d1f;"
         "stroke-width:0.6;vector-effect:non-scaling-stroke}"
         "rect.placeholder{stroke-dasharray:4 3}"
         "text{fill:#1d1d1f;font-family:Arial,Helvetica,sans-serif}")


def document_svg(doc, layers):
    groups, boxes = [], []
    for layer in layers:
        g, b = layer_group(doc, layer)
        groups.append(g)
        if b:
            boxes.append(b)
    if boxes:
        x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
        x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
    else:
        x0 = y0 = 0; x1 = y1 = 1
    pad = max(x1 - x0, y1 - y0) * 0.02
    vb = f"{_fmt(x0 - pad)} {_fmt(-y1 - pad)} {_fmt(x1 - x0 + 2 * pad)} {_fmt(y1 - y0 + 2 * pad)}"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}">'
            f"<style>{STYLE}</style>" + "".join(groups) + "</svg>")
