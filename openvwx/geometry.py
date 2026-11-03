"""Decoders for drawable object records.

Coordinates inherit Vectorworks' MiniCAD/QuickDraw heritage:
  * points are stored (y, x)
  * bounding boxes are stored (top, left, bottom, right), with y pointing up
  * arc angles are QuickDraw angles: 0 = 12 o'clock, positive = clockwise
All values are IEEE doubles in document units (millimetres in the sample).
"""

import math
import struct
from dataclasses import dataclass, field

_f64 = struct.Struct("<d").unpack_from
EMPTY = -1.7976931348623157e308  # Vectorworks writes +/-DBL_MAX for "no bounds"


def _pt(d, off):
    y, x = struct.unpack_from("<dd", d, off)
    return (x, y)


def _bbox(d, off=0x68):
    top, left, bottom, right = struct.unpack_from("<dddd", d, off)
    if abs(top) > 1e300:
        return None
    return (min(left, right), min(top, bottom), max(left, right), max(top, bottom))


@dataclass
class Shape:
    kind: str                       # line | polyline | rect | arc | text | image
    class_index: int
    points: list = field(default_factory=list)
    closed: bool = False
    bbox: tuple | None = None       # (xmin, ymin, xmax, ymax)
    text: str = ""
    center: tuple | None = None
    radii: tuple | None = None
    start: float = 0.0              # math angle in degrees (CCW from +x)
    sweep: float = 0.0              # degrees, CCW positive
    image: bytes = b""
    image_mime: str = ""


def _bezier_points(verts, closed):
    """Flatten a Vectorworks polyline. Bezier vertices are quadratic control
    points between the midpoints of their neighbours (VW 'bezier' vertex)."""
    pts = []
    n = len(verts)
    for i, (p, kind) in enumerate(verts):
        if kind != 1 or (not closed and (i == 0 or i == n - 1)):
            pts.append(p)
            continue
        a = verts[(i - 1) % n][0]
        b = verts[(i + 1) % n][0]
        m0 = ((a[0] + p[0]) / 2, (a[1] + p[1]) / 2) if verts[(i - 1) % n][1] == 1 else a
        m1 = ((b[0] + p[0]) / 2, (b[1] + p[1]) / 2) if verts[(i + 1) % n][1] == 1 else b
        for s in range(1, 9):
            t = s / 8
            u = 1 - t
            pts.append((u * u * m0[0] + 2 * u * t * p[0] + t * t * m1[0],
                        u * u * m0[1] + 2 * u * t * p[1] + t * t * m1[1]))
    return pts


def decode(rec):
    """Return a Shape for drawable records, or None."""
    d, t, cls = rec.data, rec.type, rec.class_index
    if t == 2:  # line
        return Shape("line", cls, [_pt(d, 0x68), _pt(d, 0x78)])
    if t == 3:  # rectangle (axis-aligned bounds; rotation not decoded yet)
        b = _bbox(d)
        if not b:
            return None
        x0, y0, x1, y1 = b
        return Shape("rect", cls, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], True, b)
    if t == 5:  # polygon
        n = rec.u16(0x8E)
        pts = [_pt(d, 0x90 + 16 * i) for i in range(n)]
        return Shape("polyline", cls, pts, bool(d[0x8D]), _bbox(d))
    if t == 21:  # polyline: 36-byte vertices (y, x, u32 kind, f64 radius, f64)
        n = rec.u16(0x8E)
        verts = []
        for i in range(n):
            off = 0x90 + 36 * i
            verts.append((_pt(d, off), (rec.u32(off + 16) >> 8) & 0xFF))
        closed = bool(d[0x8D])
        return Shape("polyline", cls, _bezier_points(verts, closed), closed, _bbox(d))
    if t == 6:  # arc / circle
        b = _bbox(d)
        if not b:
            return None
        center = _pt(d, 0xB0)
        qd_start, qd_sweep = _f64(d, 0xC0)[0], _f64(d, 0xC8)[0]
        return Shape("arc", cls, bbox=b, center=center,
                     radii=((b[2] - b[0]) / 2, (b[3] - b[1]) / 2),
                     start=90.0 - qd_start, sweep=-qd_sweep)
    if t == 10:  # text: char count at +0xf6, UTF-16LE characters at the end
        n = rec.u16(0xF6)
        if not n or 2 * n > len(d) - 0xF8:
            return None
        text = bytes(d[len(d) - 2 * n:]).decode("utf-16le", "replace")
        return Shape("text", cls, bbox=_bbox(d), text=text)
    if t == 14:  # image: PNG/JPEG stream embedded at +0x190
        blob = bytes(d[0x190:])
        mime = ("image/png" if blob.startswith(b"\x89PNG") else
                "image/jpeg" if blob.startswith(b"\xff\xd8") else "")
        return Shape("image", cls, bbox=_bbox(d), image=blob if mime else b"",
                     image_mime=mime)
    return None


def arc_points(s, steps=48):
    cx, cy = s.center
    rx, ry = s.radii
    sweep = s.sweep if abs(s.sweep) < 360 else 360.0
    n = max(8, int(steps * abs(sweep) / 360))
    out = []
    for i in range(n + 1):
        a = math.radians(s.start + sweep * i / n)
        out.append((cx + rx * math.cos(a), cy + ry * math.sin(a)))
    return out
