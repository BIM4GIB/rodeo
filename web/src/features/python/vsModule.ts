// The `vs` module a Python script imports, as Vectorworks gives it, over a copy of the open drawing
// that runner.ts takes when the script starts (lengths in millimetres there, in the drawing's units
// here). Each call reads or changes that copy at once, so the script sees its own changes, and
// records what it changed; runner.ts applies the record to the drawing when the script ends, as one
// undo step. Calls Rodeo doesn't have raise NotImplementedError naming them.

export const VS_SOURCE = String.raw`
import json as _json
import math as _math

_S = None


class Handle(object):
    """An object or layer of the drawing, as the script holds it."""

    __slots__ = ("_id",)

    def __init__(self, id=None):
        self._id = id

    def __eq__(self, other):
        if other is None:
            return self._id is None
        return isinstance(other, Handle) and other._id == self._id

    def __bool__(self):
        return self._id is not None

    __nonzero__ = __bool__

    def __ne__(self, other):
        return not self.__eq__(other)

    def __hash__(self):
        return hash(self._id)

    def __repr__(self):
        return "<vs.Handle %s>" % self._id

    @property
    def type(self):
        return GetTypeN(self)

    @property
    def name(self):
        return GetLName(self) if _is_layer(self) else GetName(self)

    @name.setter
    def name(self, value):
        SetName(self, value)

    @property
    def next(self):
        return NextLayer(self) if _is_layer(self) else NextObj(self)

    @property
    def prev(self):
        return PrevLayer(self) if _is_layer(self) else PrevObj(self)

    @property
    def parent(self):
        return GetParent(self)

    @property
    def selected(self):
        return Selected(self)

    @selected.setter
    def selected(self, value):
        if value:
            SetSelect(self)
        else:
            SetDSelect(self)


class _State(object):
    def __init__(self, snap):
        u = snap["units"]
        self.U = float(u["mm"])
        self.unit_mark = u["mark"]
        self.area_mark = u["area"]
        self.format = u["format"]
        self.display = u["display"]
        self.layers = snap["layers"]
        self.layer_by_id = dict((l["id"], l) for l in self.layers)
        self.classes = dict((c["name"], c) for c in snap["classes"])
        self.class_names = [c["name"] for c in snap["classes"]]
        self.objs = {}
        self.kids = dict((l["id"], []) for l in self.layers)
        for o in snap["objects"]:
            o["sel"] = False
            self.objs[o["id"]] = o
            self.kids.setdefault(o["parent"] or o["layer"], []).append(o["id"])
        for i in snap["selection"]:
            if i in self.objs:
                self.objs[i]["sel"] = True
        self.active_layer = snap["activeLayer"]
        self.active_class = snap["activeClass"]
        self.palette = snap["palette"]
        self.symbols = dict((s["index"], s["name"]) for s in snap["symbols"])
        self.symbol_boxes = dict((s["index"], s.get("bbox")) for s in snap["symbols"])
        # the Symbol tool's symbol as the script leaves it (SetActSymbol, Symbol), by name index
        self.active_symbol = snap.get("activeSymbol")
        self.symbol_changed = False
        self.formats = dict((f["name"], f["format"]) for f in snap["formats"])
        self.new_attrs = dict(snap["newAttrs"])
        # what a new object takes from the drawing where the Attributes palette sets nothing
        self.template_attrs = snap.get("templateAttrs") or {}
        self.class_mode = snap.get("classMode")
        self.layer_mode = snap.get("layerMode")
        self.text_paper_mm = float(snap["textPaperMm"])
        self.jspi = bool(snap["jspi"])
        self.ops = []
        self.seq = 0
        self.last_new = None
        self.pen = (0.0, 0.0)
        self.relative = False
        self.closed = True
        self.poly = None
        self.poly3d = None
        self.groups = []
        self.attrs = {}
        self.attr_stack = []
        self.text_pts = None
        self.text_h = 1
        self.text_v = 1
        # the font (a name), face (Bold 1, Italic 2, Underline 4) and angle CreateText gives new texts
        self.text_font = None
        self.text_face = None
        self.text_angle = None
        self.fonts = list(snap.get("fonts") or [])
        # the document's attributes, text settings and tool as the script leaves them, for after the run:
        # whether FillPat and the rest were called, the text settings set (pts, h, v), the SetTool tool
        self.attrs_set = False
        self.text_set = {}
        self.tool = None
        self.sel_changed = False
        self.layer_changed = False
        self.class_changed = False
        self.messages = []
        self.alerts = []
        self.cancelled = False
        # the plug-in running, if any: its parameters by key, and the object it draws (whose
        # drawing Vectorworks clears before the script runs; runner.ts leaves it out)
        p = snap.get("plugin")
        self.plugin = p
        self.params = dict((_pkey(name), _typed(t, v)) for name, t, v in p["params"]) if p else {}
        self.pio = p.get("object") if p else None
        if self.pio:
            self.kids[self.pio] = []
        # what the script sets up for the Object Info palette, and whether it asked to be run again
        self.ui = {"props": {}, "widgets": [], "states": {}}
        self.reset = False
        # layout dialogs the script has made (CreateLayout...), by id
        self.dialogs = {}


def _init(snapshot_json):
    global _S
    _S = _State(_json.loads(snapshot_json))


def _result():
    s = _S
    sel = [i for i, o in s.objs.items() if o["sel"]] if s.sel_changed else None
    return _json.dumps({
        "ops": s.ops,
        "selection": sel,
        "activeLayer": s.active_layer if s.layer_changed else None,
        "activeClass": s.active_class if s.class_changed else None,
        "messages": s.messages,
        "alerts": s.alerts,
        "drawing": s.kids.get(s.pio, []) if s.pio else None,
        "ui": s.ui if s.plugin else None,
        "reset": s.reset,
        "attrs": s.attrs if s.attrs_set and not s.plugin else None,
        "text": s.text_set if s.text_set and not s.plugin else None,
        "tool": s.tool,
        "classMode": s.class_mode,
        "layerMode": s.layer_mode,
        "activeSymbol": s.active_symbol if s.symbol_changed else None,
    })


def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    if name[:1] in "Pp" and _S is not None and _pkey(name[1:]) in _S.params:
        return _S.params[_pkey(name[1:])]
    raise NotImplementedError("vs.%s isn't available in Rodeo yet" % name)


# ---- arguments and units ---------------------------------------------------------------------

def _flat(args):
    out = []
    for a in args:
        if isinstance(a, (tuple, list)):
            out.extend(_flat(a))
        else:
            out.append(a)
    return out


def _nums(args, n, what):
    v = _flat(args)
    if len(v) < n:
        raise TypeError("vs.%s takes %d numbers here, got %d" % (what, n, len(v)))
    return [float(x) for x in v[:n]]


def _mm(v):
    return float(v) * _S.U


def _un(v):
    return v / _S.U


def _pt_out(p):
    return (_un(p[0]), _un(p[1]))


def _pen_point(x, y):
    """A point from the script in millimetres: an offset from the pen while Relative is on."""
    if _S.relative:
        return (_S.pen[0] + _mm(x), _S.pen[1] + _mm(y))
    return (_mm(x), _mm(y))


# ---- handles ---------------------------------------------------------------------------------

def _is_layer(h):
    return isinstance(h, Handle) and h._id in _S.layer_by_id


def _obj(h, what="the object"):
    if not isinstance(h, Handle):
        raise TypeError("expected a handle to %s, got %r" % (what, h))
    o = _S.objs.get(h._id)
    if o is None:
        raise ValueError("%r is not an object of the drawing (deleted, or a layer)" % h)
    return o


def _layer(h):
    if not _is_layer(h):
        raise TypeError("expected a handle to a layer, got %r" % (h,))
    return _S.layer_by_id[h._id]


def _h(id):
    return Handle(id) if id is not None else None


def _container(o):
    return o["parent"] or o["layer"]


def _siblings(o):
    return _S.kids.get(_container(o), [])


def _walk(container, deep):
    for i in list(_S.kids.get(container, [])):
        o = _S.objs.get(i)
        if o is None:
            continue
        yield o
        if deep and o["type"] == 11:
            for c in _walk(i, True):
                yield c


def _visible(o):
    l = _S.layer_by_id.get(o["layer"])
    if l is None or l["vis"] == "hidden":
        return False
    c = _S.classes.get(o["cls"])
    return c is None or c["vis"] != "hidden"


# ---- geometry (millimetres) ------------------------------------------------------------------

def _bounds(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return [min(xs), min(ys), max(xs), max(ys)]


def _shape_box(g):
    k = g.get("kind")
    if k == "arc":
        c = g["center"]
        return [c[0] - g["rx"], c[1] - g["ry"], c[0] + g["rx"], c[1] + g["ry"]]
    if g.get("pts"):
        return _bounds(g["pts"])
    if g.get("at"):
        a = g["at"]
        return [a[0], a[1], a[0], a[1]]
    return None


def _box(o):
    if o["type"] == 11:
        boxes = [_box(c) for c in _walk(o["id"], False)]
        boxes = [b for b in boxes if b]
        if boxes:
            return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
    return o.get("bbox")


def _apply(m, p):
    return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]


def _transform_copy(o, m):
    """The copy's geometry moved by the affine m (a, b, c, d, e, f), children too."""
    g = o.get("shape")
    if g:
        if g.get("pts"):
            g["pts"] = [_apply(m, p) for p in g["pts"]]
        if g.get("verts"):
            g["verts"] = [_apply(m, v[:2]) + v[2:] for v in g["verts"]]
        if g.get("center"):
            g["center"] = _apply(m, g["center"])
            sx = _math.hypot(m[0], m[1])
            sy = _math.hypot(m[2], m[3])
            g["rx"] *= sx
            g["ry"] *= sy
        if g.get("at"):
            g["at"] = _apply(m, g["at"])
    if o.get("ins") is not None:
        o["ins"] = _apply(m, o["ins"])
        o["turned"] = (float(o.get("turned") or 0) + _math.degrees(_math.atan2(m[1], m[0]))) % 360
    b = o.get("bbox")
    if b:
        corners = [_apply(m, p) for p in ([b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]])]
        o["bbox"] = _bounds(corners)
    if g:
        nb = _shape_box(g)
        if nb:
            o["bbox"] = nb
    for c in _walk(o["id"], False):
        _transform_copy(c, m)


def _xform(ids, m):
    ids = [i for i in ids if i in _S.objs]
    if not ids:
        return
    for i in ids:
        _transform_copy(_S.objs[i], m)
    _S.ops.append(["xform", ids, {"a": m[0], "b": m[1], "c": m[2], "d": m[3], "e": m[4], "f": m[5]}])


def _rotation(cx, cy, deg):
    t = _math.radians(deg)
    c = _math.cos(t)
    s = _math.sin(t)
    return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]


def _path_length(pts, closed):
    n = len(pts)
    total = 0.0
    for i in range(n - 1 if not closed else n):
        a = pts[i]
        b = pts[(i + 1) % n]
        total += _math.hypot(b[0] - a[0], b[1] - a[1])
    return total


def _arc_length(g):
    rx, ry = g["rx"], g["ry"]
    sweep = abs(g["sweep"])
    if abs(rx - ry) < 1e-9:
        return rx * _math.radians(sweep)
    h = ((rx - ry) / (rx + ry)) ** 2
    full = _math.pi * (rx + ry) * (1 + 3 * h / (10 + _math.sqrt(4 - 3 * h)))
    return full * sweep / 360.0


# ---- adding objects --------------------------------------------------------------------------

_TYPE_OF_KIND = {"line": 2, "rect": 3, "polygon": 5, "arc": 6, "text": 10, "roundrect": 13, "locus": 17, "polyline": 21, "poly3d": 25}


def _add(shape, copy, extra=None):
    """Adds a new object on the active layer (in the group being built), with the class and attributes for new objects."""
    s = _S
    s.seq += 1
    tmp = "new:%d" % s.seq
    attrs = dict(s.attrs)
    full = dict(s.new_attrs)
    full.update(attrs)
    op = ["add", tmp, s.active_layer, shape, s.active_class, (attrs if s.plugin else full) or None]
    if extra:
        op.append(extra)
    s.ops.append(op)
    o = {
        "id": tmp, "type": _TYPE_OF_KIND[shape["kind"]], "layer": s.active_layer, "parent": s.pio,
        "cls": s.active_class, "name": "", "sel": False, "attrs": full, "shape": copy, "records": {}, "sym": None,
    }
    o["bbox"] = _shape_box(copy)
    s.objs[tmp] = o
    if s.groups:
        s.groups[-1].append(tmp)
    s.kids.setdefault(s.pio or s.active_layer, []).append(tmp)
    s.last_new = tmp
    return tmp


def _pt(p):
    return {"x": p[0], "y": p[1]}


def _add_rect(x0, y0, x1, y1):
    pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    return _add({"kind": "rect", "x0": x0, "y0": y0, "x1": x1, "y1": y1}, {"kind": "rect", "pts": pts, "closed": True})


def _add_arc(cx, cy, rx, ry, start, sweep):
    shape = {"kind": "arc", "center": _pt((cx, cy)), "radius": rx, "startAngle": start, "sweepAngle": sweep}
    if abs(rx - ry) > 1e-9:
        shape["radiusY"] = ry
    return _add(shape, {"kind": "arc", "center": [cx, cy], "rx": rx, "ry": ry, "start": start, "sweep": sweep})


def _add_line(a, b):
    return _add({"kind": "line", "a": _pt(a), "b": _pt(b)}, {"kind": "line", "pts": [list(a), list(b)]})


def _add_poly(pts, closed):
    pts = [list(p) for p in pts]
    if len(pts) < 2:
        raise ValueError("a polygon needs at least two vertices")
    return _add({"kind": "polygon", "points": [_pt(p) for p in pts], "closed": closed}, {"kind": "polygon", "pts": pts, "closed": closed})


def _add_poly3d(pts):
    """A 3D polygon through pts (x, y, z in millimetres), open or closed as the next polygon is."""
    if len(pts) < 2:
        raise ValueError("a 3D polygon needs at least two vertices")
    closed = _S.closed
    flat = [c for p in pts for c in p]
    return _add({"kind": "poly3d", "points": flat, "closed": closed}, {"kind": "polygon", "pts": [[p[0], p[1]] for p in pts], "closed": closed})


_VERTEX_KIND = {0: "corner", 1: "bezier", 2: "cubic", 3: "arc", 4: "through"}
_VERTEX_CODE = dict((v, k) for k, v in _VERTEX_KIND.items())


def Rect(*args):
    x0, y0, x1, y1 = _nums(args, 4, "Rect")
    _add_rect(min(_mm(x0), _mm(x1)), min(_mm(y0), _mm(y1)), max(_mm(x0), _mm(x1)), max(_mm(y0), _mm(y1)))


def RRect(*args):
    x0, y0, x1, y1, dx, dy = _nums(args, 6, "RRect")
    a, b = min(_mm(x0), _mm(x1)), min(_mm(y0), _mm(y1))
    c, d = max(_mm(x0), _mm(x1)), max(_mm(y0), _mm(y1))
    rx, ry = abs(_mm(dx)) / 2, abs(_mm(dy)) / 2
    pts = [[a, b], [c, b], [c, d], [a, d]]
    _add({"kind": "roundrect", "x0": a, "y0": b, "x1": c, "y1": d, "rx": rx, "ry": ry}, {"kind": "roundrect", "pts": pts, "closed": True})


def Oval(*args):
    x0, y0, x1, y1 = [_mm(v) for v in _nums(args, 4, "Oval")]
    _add_arc((x0 + x1) / 2, (y0 + y1) / 2, abs(x1 - x0) / 2, abs(y1 - y0) / 2, 0.0, 360.0)


def Arc(*args):
    x0, y0, x1, y1, start, sweep = _nums(args, 6, "Arc")
    x0, y0, x1, y1 = _mm(x0), _mm(y0), _mm(x1), _mm(y1)
    _add_arc((x0 + x1) / 2, (y0 + y1) / 2, abs(x1 - x0) / 2, abs(y1 - y0) / 2, start, sweep)


def ArcByCenter(*args):
    x, y, r, start, sweep = _nums(args, 5, "ArcByCenter")
    _add_arc(_mm(x), _mm(y), abs(_mm(r)), abs(_mm(r)), start, sweep)


def Locus(*args):
    x, y = _nums(args, 2, "Locus")
    p = _pen_point(x, y)
    _add({"kind": "locus", "at": _pt(p)}, {"kind": "locus", "pts": [list(p)]})


def MoveTo(*args):
    x, y = _nums(args, 2, "MoveTo")
    p = _pen_point(x, y)
    if _S.poly is not None:
        _S.poly.append([p[0], p[1], "corner", 0.0])
    _S.pen = p


def Move(*args):
    dx, dy = _nums(args, 2, "Move")
    _S.pen = (_S.pen[0] + _mm(dx), _S.pen[1] + _mm(dy))
    if _S.poly is not None:
        _S.poly.append([_S.pen[0], _S.pen[1], "corner", 0.0])


def LineTo(*args):
    x, y = _nums(args, 2, "LineTo")
    p = _pen_point(x, y)
    if _S.poly is not None:
        _S.poly.append([p[0], p[1], "corner", 0.0])
    else:
        _add_line(_S.pen, p)
    _S.pen = p


def Line(*args):
    dx, dy = _nums(args, 2, "Line")
    p = (_S.pen[0] + _mm(dx), _S.pen[1] + _mm(dy))
    _add_line(_S.pen, p)
    _S.pen = p


def Relative():
    _S.relative = True


def Absolute():
    _S.relative = False


def ClosePoly():
    _S.closed = True


def OpenPoly():
    _S.closed = False


def Poly(*args):
    v = [float(x) for x in _flat(args)]
    if len(v) % 2 or len(v) < 4:
        raise TypeError("vs.Poly takes pairs of numbers, at least two points")
    pts = []
    for i in range(0, len(v), 2):
        p = _pen_point(v[i], v[i + 1])
        pts.append(p)
        if _S.relative:
            _S.pen = p
    _add_poly(pts, _S.closed)


def BeginPoly():
    _S.poly = []


def Poly3D(*args):
    v = [_mm(x) for x in _flat(args)]
    if len(v) % 3 or len(v) < 6:
        raise TypeError("vs.Poly3D takes x, y, z triples, at least two points")
    _add_poly3d([v[i:i + 3] for i in range(0, len(v), 3)])


def BeginPoly3D():
    _S.poly3d = []


def Add3DPt(*args):
    if _S.poly3d is None:
        raise RuntimeError("vs.Add3DPt adds a vertex between vs.BeginPoly3D() and vs.EndPoly3D()")
    v = _flat(args)
    if len(v) < 3:
        raise TypeError("vs.Add3DPt takes x, y and z")
    _S.poly3d.append([_mm(v[0]), _mm(v[1]), _mm(v[2])])


def EndPoly3D():
    pts = _S.poly3d or []
    _S.poly3d = None
    if len(pts) < 2:
        raise ValueError("vs.EndPoly3D needs at least two vertices since vs.BeginPoly3D()")
    _add_poly3d(pts)


def _vertex(args, kind, what):
    if _S.poly is None:
        raise RuntimeError("vs.%s adds a vertex between vs.BeginPoly() and vs.EndPoly()" % what)
    v = _flat(args)
    x, y = float(v[0]), float(v[1])
    r = _mm(v[2]) if len(v) > 2 else 0.0
    p = _pen_point(x, y)
    _S.poly.append([p[0], p[1], kind, abs(r)])
    _S.pen = p


def AddPoint(*args):
    _vertex(args, "corner", "AddPoint")


def ArcTo(*args):
    _vertex(args, "arc", "ArcTo")


def CurveTo(*args):
    _vertex(args, "bezier", "CurveTo")


def CurveThrough(*args):
    _vertex(args, "cubic", "CurveThrough")


def EndPoly():
    verts = _S.poly or []
    _S.poly = None
    if len(verts) < 2:
        raise ValueError("vs.EndPoly needs at least two vertices since vs.BeginPoly()")
    closed = _S.closed
    if all(v[2] == "corner" for v in verts):
        _add_poly([v[:2] for v in verts], closed)
        return
    shape = {
        "kind": "polyline", "points": [_pt(v) for v in verts], "closed": closed,
        "vertices": [v[2] for v in verts], "radii": [v[3] for v in verts],
    }
    _add(shape, {"kind": "polyline", "pts": [v[:2] for v in verts], "verts": [list(v) for v in verts], "closed": closed})


def TextOrigin(*args):
    x, y = _nums(args, 2, "TextOrigin")
    _S.pen = _pen_point(x, y)


def TextSize(size):
    _S.text_pts = float(size) if float(size) > 0 else 12.0
    _S.text_set["pts"] = _S.text_pts


def TextJust(justify):
    j = int(justify)
    _S.text_h = j if j in (1, 2, 3) else 1
    _S.text_set["h"] = _S.text_h


def TextVerticalAlign(align):
    a = int(align)
    _S.text_v = a if 1 <= a <= 5 else 1
    _S.text_set["v"] = _S.text_v


def CreateText(text):
    scale = _S.layer_by_id[_S.active_layer]["scale"] or 1
    paper = _S.text_pts * 25.4 / 72 if _S.text_pts is not None else _S.text_paper_mm
    at = _S.pen
    copy = {"kind": "text", "at": list(at), "text": str(text), "size": paper * scale, "h": _S.text_h, "v": _S.text_v}
    tmp = _add(
        {"kind": "text", "at": _pt(at), "text": str(text), "height": paper * scale, "hAlign": _S.text_h, "vAlign": _S.text_v},
        copy,
    )
    style = {}
    if _S.text_font is not None:
        style["font"] = copy["font"] = _S.text_font
    if _S.text_face is not None:
        style.update(_face(_S.text_face))
        copy.update(_face(_S.text_face))
    if _S.text_angle:
        style["angle"] = copy["angle"] = _S.text_angle
    if style:
        _S.ops.append(["textstyle", [tmp], style, "origin"])


def BeginGroup():
    _S.groups.append([])


def EndGroup():
    if not _S.groups:
        raise RuntimeError("vs.EndGroup without vs.BeginGroup")
    members = _S.groups.pop()
    if not members:
        return
    _group(members)


def _group(members):
    s = _S
    s.seq += 1
    tmp = "new:%d" % s.seq
    first = s.objs[members[0]]
    layer = first["layer"]
    g = {"id": tmp, "type": 11, "layer": layer, "parent": first["parent"], "cls": s.active_class, "name": "", "sel": False,
         "attrs": None, "shape": None, "records": {}, "sym": None, "bbox": None}
    container = first["parent"] or layer
    sibs = s.kids.setdefault(container, [])
    at = max(sibs.index(m) for m in members if m in sibs) if any(m in sibs for m in members) else len(sibs)
    for m in members:
        o = s.objs[m]
        old = s.kids.get(_container(o), [])
        if m in old:
            old.remove(m)
        o["parent"] = tmp
    at = min(at, len(sibs))
    sibs.insert(at, tmp)
    s.kids[tmp] = list(members)
    s.objs[tmp] = g
    g["bbox"] = _box(g)
    s.ops.append(["group", tmp, list(members)])
    if s.groups:
        s.groups[-1] = [i for i in s.groups[-1] if i not in members] + [tmp]
    s.last_new = tmp
    return tmp


# ---- walking the drawing ---------------------------------------------------------------------

def LNewObj():
    return _h(_S.last_new)


def ActLayer():
    return Handle(_S.active_layer)


def FLayer():
    return _h(_S.layers[0]["id"] if _S.layers else None)


def LLayer():
    return _h(_S.layers[-1]["id"] if _S.layers else None)


def _layer_step(h, d):
    ids = [l["id"] for l in _S.layers]
    i = ids.index(_layer(h)["id"]) + d
    return _h(ids[i]) if 0 <= i < len(ids) else None


def NextLayer(h):
    return _layer_step(h, 1)


def PrevLayer(h):
    return _layer_step(h, -1)


def GetLayerByName(name):
    for l in _S.layers:
        if l["name"] == name:
            return Handle(l["id"])
    return None


def _first(container, selected=False, last=False):
    ids = _S.kids.get(container, [])
    seq = reversed(ids) if last else ids
    for i in seq:
        if not selected or _S.objs[i]["sel"]:
            return Handle(i)
    return None


def FActLayer():
    return _first(_S.active_layer)


def LActLayer():
    return _first(_S.active_layer, last=True)


def FSActLayer():
    return _first(_S.active_layer, selected=True)


def LSActLayer():
    return _first(_S.active_layer, selected=True, last=True)


def FObject():
    return _first(_S.layers[0]["id"]) if _S.layers else None


def LObject():
    return _first(_S.layers[0]["id"], last=True) if _S.layers else None


def FInLayer(h):
    return _first(_layer(h)["id"])


def FSObject(h):
    return _first(_layer(h)["id"], selected=True)


def FInGroup(h):
    return _first(_obj(h, "a group")["id"])


def _step(h, d, selected=False):
    if _is_layer(h):
        return _layer_step(h, d)
    o = _obj(h)
    sibs = _siblings(o)
    i = sibs.index(o["id"]) + d
    while 0 <= i < len(sibs):
        if not selected or _S.objs[sibs[i]]["sel"]:
            return Handle(sibs[i])
        i += d
    return None


def NextObj(h):
    return _step(h, 1)


def PrevObj(h):
    return _step(h, -1)


def NextSObj(h):
    return _step(h, 1, selected=True)


def PrevSObj(h):
    return _step(h, -1, selected=True)


def GetParent(h):
    o = _obj(h)
    return Handle(o["parent"] or o["layer"])


def GetLayer(h):
    return Handle(_obj(h)["layer"])


def GetObject(name):
    if not name:
        return None
    for o in _S.objs.values():
        if o.get("name") == name:
            return Handle(o["id"])
    return GetLayerByName(name)


def NumObj(h):
    return len(_S.kids.get(_layer(h)["id"], []))


def NumSObj(h):
    return sum(1 for i in _S.kids.get(_layer(h)["id"], []) if _S.objs[i]["sel"])


# ---- reading objects -------------------------------------------------------------------------

def GetTypeN(h):
    if _is_layer(h):
        return 31
    if _is_record(h):
        return 47
    return _obj(h)["type"]


GetType = GetTypeN


def GetName(h):
    if _is_record(h):
        return _S.plugin["name"]
    return _obj(h).get("name") or ""


def GetLName(h):
    return _layer(h)["name"]


def GetClass(h):
    return _obj(h)["cls"]


def GetBBox(h):
    b = _box(_obj(h))
    if not b:
        return ((0.0, 0.0), (0.0, 0.0))
    return ((_un(b[0]), _un(b[3])), (_un(b[2]), _un(b[1])))


def HCenter(h):
    o = _obj(h)
    g = o.get("shape") or {}
    if g.get("kind") == "arc":
        return _pt_out(g["center"])
    b = _box(o)
    if not b:
        return (0.0, 0.0)
    return (_un((b[0] + b[2]) / 2), _un((b[1] + b[3]) / 2))


def HWidth(h):
    b = _box(_obj(h))
    return _un(b[2] - b[0]) if b else 0.0


def HHeight(h):
    b = _box(_obj(h))
    return _un(b[3] - b[1]) if b else 0.0


def _area_mm(o):
    g = o.get("shape") or {}
    k = g.get("kind")
    if k == "arc":
        sweep = min(abs(g["sweep"]), 360.0)
        return _math.pi * g["rx"] * g["ry"] * sweep / 360.0
    if k in ("rect", "roundrect", "polygon", "polyline") and (g.get("closed") or k in ("rect", "roundrect")):
        pts = g["pts"]
        a = 0.0
        for i in range(len(pts)):
            p, q = pts[i], pts[(i + 1) % len(pts)]
            a += p[0] * q[1] - q[0] * p[1]
        return abs(a) / 2
    if o["type"] == 11:
        return sum(_area_mm(c) for c in _walk(o["id"], False))
    return 0.0


def HArea(h):
    return _area_mm(_obj(h)) / (_S.U * _S.U)


def HPerim(h):
    o = _obj(h)
    g = o.get("shape") or {}
    k = g.get("kind")
    if k == "arc":
        return _un(_arc_length(g))
    if g.get("pts"):
        return _un(_path_length(g["pts"], g.get("closed") or k in ("rect", "roundrect")))
    return 0.0


def HLength(h):
    o = _obj(h)
    g = o.get("shape") or {}
    k = g.get("kind")
    if k == "arc":
        return _un(_arc_length(g))
    if g.get("pts") and k in ("line", "polygon", "polyline"):
        return _un(_path_length(g["pts"], bool(g.get("closed"))))
    return 0.0


def _seg(h, i):
    g = _obj(h, "a line").get("shape") or {}
    if g.get("kind") != "line":
        raise TypeError("vs.GetSegPt%d takes a line" % (i + 1))
    return _pt_out(g["pts"][i])


def GetSegPt1(h):
    return _seg(h, 0)


def GetSegPt2(h):
    return _seg(h, 1)


def _verts(h):
    g = _obj(h, "a polygon or polyline").get("shape") or {}
    if g.get("verts"):
        return g["verts"]
    if g.get("kind") in ("polygon", "rect"):
        return [p + ["corner", 0.0] for p in g["pts"]]
    raise TypeError("expected a polygon or polyline")


def GetVertNum(h):
    return len(_verts(h))


def GetPolyPt(h, index):
    v = _verts(h)[int(index) - 1]
    return _pt_out(v)


def GetPolylineVertex(h, index):
    v = _verts(h)[int(index) - 1]
    return (_pt_out(v), _VERTEX_CODE.get(v[2], 0), _un(v[3]))


def GetText(h):
    g = _obj(h, "a text object").get("shape") or {}
    if g.get("kind") != "text":
        raise TypeError("vs.GetText takes a text object")
    return g.get("text", "")


def GetTextLength(h):
    return len(GetText(h))


def GetLocPt(h):
    g = _obj(h, "a locus").get("shape") or {}
    if g.get("kind") != "locus":
        raise TypeError("vs.GetLocPt takes a locus")
    return _pt_out(g["pts"][0])


def GetSymName(h):
    o = _obj(h, "a symbol")
    return _S.symbols.get(o.get("sym"), "")


def GetRField(h, record, field):
    o = _obj(h)
    v = (o.get("records") or {}).get(record, {}).get(field)
    return "" if v is None else str(v)


def Selected(h):
    return bool(_obj(h)["sel"])


# ---- attributes ------------------------------------------------------------------------------

def _rgb16(index):
    for p in _S.palette:
        if p[0] == index:
            return (p[1] * 257, p[2] * 257, p[3] * 257)
    return (0, 0, 0)


def _index_of(args):
    v = _flat(args)
    if len(v) == 1:
        return int(v[0])
    if len(v) != 3:
        raise TypeError("a colour is (red, green, blue), each 0 to 65535, or a colour index")
    r, g, b = [float(x) / 257.0 for x in v]
    best, dist = 0, None
    for p in _S.palette:
        d = (p[1] - r) ** 2 + (p[2] - g) ** 2 + (p[3] - b) ** 2
        if dist is None or d < dist:
            best, dist = p[0], d
    return best


def RGBToColorIndex(*args):
    return _index_of(args)


def ColorIndexToRGB(index):
    return _rgb16(int(index))


def _default(key, v):
    _S.attrs[key] = v
    _S.attrs_set = True


def FillPat(n):
    _default("fillPattern", int(n))


def PenPat(n):
    _default("lineStyle", int(n))


def PenSize(mils):
    _default("lineWeight", int(mils))


def FillFore(*args):
    _default("fillFore", _index_of(args))


def FillBack(*args):
    _default("fillBack", _index_of(args))


def PenFore(*args):
    _default("penFore", _index_of(args))


def PenBack(*args):
    _default("penBack", _index_of(args))


def SetDefaultOpacityN(fillOpacity, penOpacity):
    _default("fillOpacity", max(0, min(100, int(fillOpacity))))
    _default("penOpacity", max(0, min(100, int(penOpacity))))


def SetDefaultOpacity(opacity):
    SetDefaultOpacityN(opacity, opacity)


def Opacity(opacity):
    SetDefaultOpacityN(opacity, opacity)


def SetTool(theTool):
    _S.tool = int(theTool)


def PushAttrs():
    _S.attr_stack.append((dict(_S.attrs), _S.text_pts, _S.text_h, _S.text_v, dict(_S.text_set)))


def PopAttrs():
    if _S.attr_stack:
        _S.attrs, _S.text_pts, _S.text_h, _S.text_v, _S.text_set = _S.attr_stack.pop()


def _set_attrs(h, attrs):
    o = _obj(h)
    if o.get("attrs") is None:
        raise TypeError("%r has no attributes of its own" % h)
    o["attrs"].update(attrs)
    _S.ops.append(["attrs", [o["id"]], attrs])


def SetFPat(h, n):
    _set_attrs(h, {"fillPattern": int(n)})


def SetLW(h, mils):
    _set_attrs(h, {"lineWeight": int(mils)})


def SetFillFore(h, *color):
    _set_attrs(h, {"fillFore": _index_of(color)})


def SetFillBack(h, *color):
    _set_attrs(h, {"fillBack": _index_of(color)})


def SetPenFore(h, *color):
    _set_attrs(h, {"penFore": _index_of(color)})


def SetPenBack(h, *color):
    _set_attrs(h, {"penBack": _index_of(color)})


def SetOpacity(h, opacity):
    v = max(0, min(100, int(opacity)))
    _set_attrs(h, {"fillOpacity": v, "penOpacity": v})


def SetOpacityN(h, fillOpacity, penOpacity):
    _set_attrs(h, {"fillOpacity": max(0, min(100, int(fillOpacity))), "penOpacity": max(0, min(100, int(penOpacity)))})


def _by_class(h, group, on=True):
    o = _obj(h)
    if o.get("attrs") is None:
        raise TypeError("%r has no attributes of its own" % h)
    groups = o.setdefault("byClass", [])
    if on and group not in groups:
        groups.append(group)
    elif not on and group in groups:
        groups.remove(group)
    _S.ops.append(["byclass", [o["id"]], group, bool(on)])


# Rodeo keeps a fill's pattern and colours by class together, as the file does
def SetFPatByClass(h):
    _by_class(h, "fill")


def SetFillColorByClass(h):
    _by_class(h, "fill")


def SetLSByClass(h):
    _by_class(h, "lineStyle")


def SetLWByClass(h):
    _by_class(h, "lineWeight")


def SetPenColorByClass(h):
    _by_class(h, "penColor")


def SetOpacityByClass(h):
    _by_class(h, "opacity")


def _attr(h, key):
    a = _obj(h).get("attrs")
    if a is None:
        raise TypeError("%r has no attributes of its own" % h)
    return a.get(key, 0)


def GetFPat(h):
    return _attr(h, "fillPattern")


def GetLW(h):
    return _attr(h, "lineWeight")


def GetOpacity(h):
    return _attr(h, "fillOpacity")


def GetFillFore(h):
    return _rgb16(_attr(h, "fillFore"))


def GetFillBack(h):
    return _rgb16(_attr(h, "fillBack"))


def GetPenFore(h):
    return _rgb16(_attr(h, "penFore"))


def GetPenBack(h):
    return _rgb16(_attr(h, "penBack"))


# ---- changing objects ------------------------------------------------------------------------

def SetName(h, name):
    o = _obj(h)
    name = str(name)
    if name and any(x is not o and x.get("name") == name for x in _S.objs.values()):
        raise ValueError("another object is already named %r" % name)
    o["name"] = name
    _S.ops.append(["name", o["id"], name])


def SetClass(h, name):
    o = _obj(h)
    name = str(name)
    _ensure_class(name)
    o["cls"] = name
    _S.ops.append(["class", [o["id"]], name])


def SetClassN(h, name, children=False):
    SetClass(h, name)
    if children:
        for o in _walk(_obj(h)["id"], True):
            SetClass(Handle(o["id"]), name)


def SetText(h, text):
    o = _obj(h, "a text object")
    g = o.get("shape") or {}
    if g.get("kind") != "text":
        raise TypeError("vs.SetText takes a text object")
    g["text"] = str(text)
    _S.ops.append(["text", o["id"], str(text)])


def SetRField(h, record, field, value):
    o = _obj(h)
    fmt = _S.formats.get(record)
    if fmt is None:
        raise ValueError("the drawing has no record format named %r" % record)
    o.setdefault("records", {}).setdefault(record, {})[field] = str(value)
    _S.ops.append(["record", o["id"], fmt, field, str(value)])


def HMove(h, *args):
    dx, dy = _nums(args, 2, "HMove")
    _xform([_obj(h)["id"]], [1, 0, 0, 1, _mm(dx), _mm(dy)])


def HRotate(h, *args):
    cx, cy, angle = _nums(args, 3, "HRotate")
    _xform([_obj(h)["id"]], _rotation(_mm(cx), _mm(cy), angle))


def HScale2D(h, cx, cy, sx, sy, scaleText=True):
    cx, cy, sx, sy = _mm(cx), _mm(cy), float(sx), float(sy)
    if sx == 0 or sy == 0:
        raise ValueError("vs.HScale2D can't scale to nothing")
    _xform([_obj(h)["id"]], [sx, 0, 0, sy, cx * (1 - sx), cy * (1 - sy)])


def Mirror(h, dup, *args):
    x1, y1, x2, y2 = [_mm(v) for v in _nums(args, 4, "Mirror")]
    dx, dy = x2 - x1, y2 - y1
    n = dx * dx + dy * dy
    if n == 0:
        raise ValueError("vs.Mirror needs two different points on the axis")
    a = (dx * dx - dy * dy) / n
    b = 2 * dx * dy / n
    m = [a, b, b, -a, x1 - a * x1 - b * y1, y1 - b * x1 + a * y1]
    target = HDuplicate(h, 0, 0) if dup else h
    _xform([target._id], m)
    return target


def _selected_top(all_layers=False):
    out = []
    layers = [l["id"] for l in _S.layers] if all_layers else [_S.active_layer]
    for lid in layers:
        out.extend(i for i in _S.kids.get(lid, []) if _S.objs[i]["sel"])
    return out


def MoveObjs(*args):
    v = _flat(args)
    dx, dy = _mm(v[0]), _mm(v[1])
    all_layers = bool(v[2]) if len(v) > 2 else False
    all_objects = bool(v[3]) if len(v) > 3 else False
    layers = [l["id"] for l in _S.layers] if all_layers else [_S.active_layer]
    ids = []
    for lid in layers:
        ids.extend(i for i in _S.kids.get(lid, []) if all_objects or _S.objs[i]["sel"])
    _xform(ids, [1, 0, 0, 1, dx, dy])


def Rotate(angle):
    ids = _selected_top()
    if not ids:
        return
    loci = [i for i in ids if _S.objs[i]["type"] == 17]
    if len(loci) == 1:
        cx, cy = _S.objs[loci[0]]["shape"]["pts"][0]
    else:
        boxes = [b for b in (_box(_S.objs[i]) for i in ids) if b]
        if not boxes:
            return
        cx = (min(b[0] for b in boxes) + max(b[2] for b in boxes)) / 2
        cy = (min(b[1] for b in boxes) + max(b[3] for b in boxes)) / 2
    _xform(ids, _rotation(cx, cy, float(angle)))


def _duplicate(ids, dx, dy):
    s = _S
    tmps = []
    for i in ids:
        s.seq += 1
        tmp = "new:%d" % s.seq
        tmps.append(tmp)
    s.ops.append(["dup", tmps, list(ids), dx, dy])
    for i, tmp in zip(ids, tmps):
        _copy_object(s.objs[i], tmp, None)
        _transform_copy(s.objs[tmp], [1, 0, 0, 1, dx, dy])
        s.last_new = tmp
    return tmps


def _copy_object(o, new_id, parent):
    s = _S
    c = _json.loads(_json.dumps(o))
    c["id"] = new_id
    c["sel"] = False
    c["name"] = ""
    if parent is not None:
        c["parent"] = parent
    s.objs[new_id] = c
    sibs = s.kids.setdefault(_container(c), [])
    if parent is None and o["id"] in sibs:
        sibs.insert(sibs.index(o["id"]) + 1, new_id)
    else:
        sibs.append(new_id)
    for k in list(s.kids.get(o["id"], [])):
        s.seq += 1
        _copy_object(s.objs[k], "copy:%d" % s.seq, new_id)


def HDuplicate(h, *args):
    dx, dy = _nums(args, 2, "HDuplicate")
    return Handle(_duplicate([_obj(h)["id"]], _mm(dx), _mm(dy))[0])


def Duplicate(*args):
    dx, dy = _nums(args, 2, "Duplicate")
    ids = _selected_top()
    if not ids:
        return
    tmps = _duplicate(ids, _mm(dx), _mm(dy))
    for i in ids:
        _S.objs[i]["sel"] = False
    for t in tmps:
        _S.objs[t]["sel"] = True
    _S.sel_changed = True


def _remove(ids):
    s = _S
    gone = []
    def drop(i):
        o = s.objs.pop(i, None)
        if o is None:
            return
        gone.append(i)
        sibs = s.kids.get(_container(o), [])
        if i in sibs:
            sibs.remove(i)
        for k in list(s.kids.pop(i, [])):
            drop(k)
    for i in ids:
        drop(i)
    if s.last_new in gone:
        s.last_new = None
    return gone


def DelObject(h):
    o = _obj(h)
    _S.ops.append(["delete", [o["id"]]])
    _remove([o["id"]])


def DeleteObjs():
    ids = _selected_top()
    if ids:
        _S.ops.append(["delete", ids])
        _remove(ids)


def _arrange(h, how):
    o = _obj(h)
    sibs = _siblings(o)
    i = sibs.index(o["id"])
    sibs.pop(i)
    if how == "front":
        sibs.append(o["id"])
    elif how == "back":
        sibs.insert(0, o["id"])
    elif how == "forward":
        sibs.insert(min(i + 1, len(sibs)), o["id"])
    else:
        sibs.insert(max(i - 1, 0), o["id"])
    _S.ops.append(["arrange", [o["id"]], how])


def HMoveForward(h, toFront):
    _arrange(h, "front" if toFront else "forward")


def HMoveBackward(h, toBack):
    _arrange(h, "back" if toBack else "backward")


def Group():
    ids = _selected_top()
    if not ids:
        return
    tmp = _group(ids)
    for i in ids:
        _S.objs[i]["sel"] = False
    _S.objs[tmp]["sel"] = True
    _S.sel_changed = True


def Ungroup():
    s = _S
    groups = [i for i in _selected_top() if s.objs[i]["type"] == 11]
    if not groups:
        return
    s.ops.append(["ungroup", groups])
    for gid in groups:
        g = s.objs.pop(gid)
        sibs = s.kids.get(_container(g), [])
        at = sibs.index(gid)
        sibs.pop(at)
        members = s.kids.pop(gid, [])
        for k, m in enumerate(members):
            s.objs[m]["parent"] = g["parent"]
            s.objs[m]["sel"] = True
            sibs.insert(at + k, m)
    s.sel_changed = True


# ---- selection -------------------------------------------------------------------------------

def SetSelect(h):
    _obj(h)["sel"] = True
    _S.sel_changed = True


def SetDSelect(h):
    _obj(h)["sel"] = False
    _S.sel_changed = True


def DSelectAll():
    for o in _S.objs.values():
        o["sel"] = False
    _S.sel_changed = True


def SelectAll():
    for i in _S.kids.get(_S.active_layer, []):
        o = _S.objs[i]
        if _visible(o):
            o["sel"] = True
    _S.sel_changed = True


# ---- layers and classes ----------------------------------------------------------------------

def Layer(name):
    s = _S
    name = str(name)
    for l in s.layers:
        if l["name"] == name:
            s.active_layer = l["id"]
            s.layer_changed = True
            return
    s.seq += 1
    tmp = "layer:%d" % s.seq
    scale = s.layer_by_id[s.active_layer]["scale"] if s.active_layer in s.layer_by_id else 1
    l = {"id": tmp, "name": name, "kind": "design", "scale": scale, "vis": "visible", "elev": 0.0}
    s.layers.append(l)
    s.layer_by_id[tmp] = l
    s.kids[tmp] = []
    s.ops.append(["layer", tmp, name, "design", scale])
    s.active_layer = tmp
    s.layer_changed = True


def _ensure_class(name):
    if name not in _S.classes:
        _S.classes[name] = {"name": name, "vis": "visible"}
        _S.class_names.append(name)
        _S.ops.append(["newclass", name])


def NameClass(name):
    name = str(name)
    _ensure_class(name)
    _S.active_class = name
    _S.class_changed = True


def ActiveClass():
    return _S.active_class


def ClassNum():
    return len(_S.class_names)


def ClassList(index):
    i = int(index)
    return _S.class_names[i - 1] if 1 <= i <= len(_S.class_names) else ""


def _class_vis(name, vis):
    name = str(name)
    if name not in _S.classes:
        raise ValueError("the drawing has no class named %r" % name)
    _S.classes[name]["vis"] = vis
    _S.ops.append(["classvis", name, vis])


def ShowClass(name):
    _class_vis(name, "visible")


def HideClass(name):
    _class_vis(name, "hidden")


def GrayClass(name):
    _class_vis(name, "grayed")


# ---- search criteria -------------------------------------------------------------------------

_TYPE_NAMES = {
    "LINE": 2, "RECT": 3, "OVAL": 4, "POLY": 5, "ARC": 6, "FHAND": 8, "LOCUS3D": 9, "TEXT": 10, "GROUP": 11, "RRECT": 13,
    "BITMAP": 14, "SYMBOL": 15, "LOCUS": 17, "SPRDSHEET": 18, "POLYLINE": 21, "PICT": 22, "XTRD": 24, "POLY3D": 25,
    "LAYERLINK": 29, "SWEEP": 34, "MXTRD": 38, "MESH": 40, "DIMENSION": 63, "WALL": 68, "SLAB": 71, "LIGHT": 81,
    "ROOF": 83, "CSGSOLID": 84, "PLUGINOBJECT": 86, "ROOFELEMENT": 87, "SOLID": 95, "NURBSCURVE": 111,
    "NURBSSURFACE": 113, "VIEWPORT": 122,
}
_SCOPE_WORDS = ("INSYMBOL", "INOBJECT", "INVIEWPORT", "NOTINDLVP", "NOTINREFDLVP", "INWALL")


def _tokens(text):
    out = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch.isspace():
            i += 1
        elif ch in "()&|[],":
            out.append(ch)
            i += 1
        elif ch == "<" and text[i:i + 2] == "<>":
            out.append("<>")
            i += 2
        elif ch == "=":
            out.append("=")
            i += 1
        elif ch in "'\"":
            j = text.find(ch, i + 1)
            if j < 0:
                raise ValueError("criteria: a quote isn't closed in %r" % text)
            out.append(("str", text[i + 1:j]))
            i = j + 1
        else:
            j = i
            while j < len(text) and not text[j].isspace() and text[j] not in "()&|[],=<'\"":
                j += 1
            out.append(("word", text[i:j]))
            i = j
    return out


def _criteria(text):
    toks = _tokens(str(text))
    pos = [0]

    def peek():
        return toks[pos[0]] if pos[0] < len(toks) else None

    def take():
        t = peek()
        pos[0] += 1
        return t

    def value():
        t = take()
        if isinstance(t, tuple):
            return t[1]
        raise ValueError("criteria: expected a value in %r" % text)

    def expr():
        left = term()
        while peek() == "|":
            take()
            right = term()
            left = (lambda a, b: lambda o: a(o) or b(o))(left, right)
        return left

    def term():
        left = factor()
        while peek() == "&":
            take()
            right = factor()
            left = (lambda a, b: lambda o: a(o) and b(o))(left, right)
        return left

    def factor():
        t = peek()
        if t == "(":
            take()
            f = expr()
            if take() != ")":
                raise ValueError("criteria: a bracket isn't closed in %r" % text)
            return f
        if isinstance(t, tuple) and t[1].upper() == "NOT":
            take()
            f = factor()
            return lambda o: not f(o)
        return atom()

    def atom():
        t = take()
        if not isinstance(t, tuple):
            raise ValueError("criteria: unexpected %r in %r" % (t, text))
        word = t[1].upper()
        if word == "ALL" or word in _SCOPE_WORDS:
            return lambda o: True
        if word == "V":
            return _visible
        if word == "R" and isinstance(peek(), tuple) and peek()[1].upper() == "IN":
            take()
            if take() != "[":
                raise ValueError("criteria: R IN takes ['record'] in %r" % text)
            names = [value()]
            while peek() == ",":
                take()
                names.append(value())
            take()
            return lambda o: any(n in (o.get("records") or {}) for n in names)
        op = take()
        if op not in ("=", "<>"):
            raise ValueError("criteria: %s needs = or <> in %r" % (word, text))
        v = value()
        test = _criterion(word, v, text)
        return test if op == "=" else (lambda o: not test(o))

    f = expr()
    if peek() is not None:
        raise ValueError("criteria: unexpected %r in %r" % (peek(), text))
    return f


def _criterion(word, v, text):
    truth = str(v).upper() in ("TRUE", "1")
    if word == "SEL":
        return lambda o: bool(o["sel"]) == truth
    if word == "VSEL":
        return lambda o: (bool(o["sel"]) and _visible(o)) == truth
    if word == "T":
        code = int(v) if str(v).isdigit() else _TYPE_NAMES.get(str(v).upper())
        if code is None:
            raise ValueError("criteria: unknown object type %r" % v)
        if code == 4:
            return lambda o: o["type"] == 4 or (o["type"] == 6 and abs((o.get("shape") or {}).get("sweep", 0)) >= 360)
        return lambda o: o["type"] == code
    if word == "C":
        return lambda o: o["cls"] == v
    if word == "L":
        return lambda o: _S.layer_by_id.get(o["layer"], {}).get("name") == v
    if word == "N":
        return lambda o: (o.get("name") or "") == v
    if word == "PON":
        return lambda o: o.get("typeName") == v
    if word == "S":
        return lambda o: _S.symbols.get(o.get("sym")) == v
    raise NotImplementedError("criteria %s isn't available in Rodeo yet (in %r)" % (word, text))


def _all_objects():
    for l in _S.layers:
        for o in _walk(l["id"], True):
            yield o


def ForEachObject(callback, c):
    test = _criteria(c)
    for o in [o for o in _all_objects() if test(o)]:
        if o["id"] in _S.objs:
            callback(Handle(o["id"]))


def Count(c):
    test = _criteria(c)
    return sum(1 for o in _all_objects() if test(o))


def _select_matching(c, on):
    test = _criteria(c)
    for l in _S.layers:
        for o in _walk(l["id"], False):
            if test(o):
                o["sel"] = on
    _S.sel_changed = True


def SelectObj(c):
    _select_matching(c, True)


def DSelectObj(c):
    _select_matching(c, False)


def ForEachObjectInLayer(actionFunc, objOptions, travOptions, layerOptions):
    lo = int(layerOptions)
    if lo == 0:
        layers = [_S.active_layer]
    elif lo == 2:
        layers = [l["id"] for l in _S.layers if l["vis"] != "hidden"]
    else:
        layers = [l["id"] for l in _S.layers]
    oo = int(objOptions)
    deep = int(travOptions) in (1, 2)
    found = []
    for lid in layers:
        for o in _walk(lid, deep):
            if oo & 2 and not o["sel"]:
                continue
            if oo & 1 and not _visible(o):
                continue
            found.append(o["id"])
    for i in found:
        if i in _S.objs and actionFunc(Handle(i)):
            break


# ---- the user --------------------------------------------------------------------------------

def _host(kind, *args):
    if not _S.jspi:
        raise RuntimeError("vs.%s waits for an answer, which needs a browser that can pause a script (Chrome or Edge)" % kind)
    from pyodide.ffi import run_sync
    import _rodeo
    return run_sync(_rodeo.ask(kind, _json.dumps(args)))


def Message(*z):
    text = "".join(str(x) for x in z)
    _S.messages.append(text)


def ClrMessage():
    pass


def SysBeep():
    pass


def AlrtDialog(message):
    if _S.jspi:
        _host("AlrtDialog", str(message))
    else:
        _S.alerts.append(str(message))


def _answer(kind, request, default):
    got = _json.loads(_host(kind, str(request), str(default)))
    _S.cancelled = got is None
    return got


def StrDialog(request, default=""):
    v = _answer("StrDialog", request, default)
    return "" if v is None else str(v)


def IntDialog(request, default="0"):
    v = _answer("IntDialog", request, default)
    return 0 if v is None else int(v)


def RealDialog(request, default="0"):
    v = _answer("RealDialog", request, default)
    return 0.0 if v is None else float(v)


def YNDialog(s):
    v = _answer("YNDialog", s, "")
    return bool(v)


def DidCancel():
    return _S.cancelled


def _pick(kind):
    """Points the user clicks in the drawing (mm); Esc ends the script, keeping what it did."""
    got = _json.loads(_host(kind, _S.messages[-1] if _S.messages else ""))
    if got is None:
        raise SystemExit(0)
    return [_pt_out(p) for p in got]


def GetPt(callback=None):
    p = _pick("GetPt")[0]
    if callback is None:
        return p
    callback(p)


def GetLine(callback=None):
    a, b = _pick("GetLine")
    if callback is None:
        return (a, b)
    callback(a, b)


def GetRect(callback=None):
    a, b = _pick("GetRect")
    if callback is None:
        return (a, b)
    callback(a, b)


# ---- layout dialogs --------------------------------------------------------------------------
# A dialog the script lays out (CreateLayout, its controls, SetFirstLayoutItem, SetBelowItem,
# SetRightItem...) is kept here as it is built. RunLayoutDialog shows it in the editor and calls the
# script's handler: with SetupDialogC first, then with each control clicked or changed (and a
# choice's index), until OK (1) or Cancel (2) closes it, then with SetdownDialogC. The handler reads
# and sets this copy, which each event brings up to date with the editor's controls.

_SETUP_DIALOG = 12255
_SETDOWN_DIALOG = 12256
_OK = 1
_CANCEL = 2
# CreateEditReal's kinds that are lengths in the drawing's units: a dimension, an x or a y coordinate
_EDIT_LENGTHS = (3, 4, 5)


def _dialog(dialog):
    d = _S.dialogs.get(int(dialog))
    if d is None:
        raise ValueError("there's no dialog %r (CreateLayout makes one)" % (dialog,))
    return d


def _item(dialog, item):
    d = _dialog(dialog)
    c = d["items"].get(int(item))
    if c is None:
        raise ValueError("dialog %s has no item %r" % (d["id"], item))
    return c


def _width(chars):
    try:
        w = float(chars)
    except (TypeError, ValueError):
        return None
    return w if w > 0 else None


def _layout(title, ok, cancel):
    did = len(_S.dialogs) + 1
    _S.dialogs[did] = {"id": did, "title": str(title), "first": None, "focus": None, "items": {
        _OK: {"id": _OK, "kind": "ok", "text": str(ok) or "OK", "enabled": True, "visible": True},
        _CANCEL: {"id": _CANCEL, "kind": "cancel", "text": str(cancel), "enabled": True, "visible": bool(cancel)},
    }}
    return did


def CreateLayout(title, hasHelp=False, defaultButton="OK", cancelButton="Cancel"):
    return _layout(title, defaultButton, cancelButton)


def CreateResizableLayout(title, hasHelp, defaultButton, cancelButton, widthResizable=False, heightResizable=False):
    return _layout(title, defaultButton, cancelButton)


def _control(dialog, item, kind, **more):
    c = {"id": int(item), "kind": kind, "text": "", "enabled": True, "visible": True}
    c.update(more)
    _dialog(dialog)["items"][int(item)] = c


def CreateStaticText(dialog, item, text, width=-1):
    _control(dialog, item, "static", text=str(text), width=_width(width))


def CreateStyledStatic(dialog, item, text, width=-1, style=0):
    _control(dialog, item, "static", text=str(text), width=_width(width), bold=int(style) == 1)


CreateStyledStaticText = CreateStyledStatic


def CreateEditText(dialog, item, text, width=20):
    _control(dialog, item, "edit", text=str(text), width=_width(width))


def CreateEditTextBox(dialog, item, text, width=20, height=4):
    _control(dialog, item, "edit", text=str(text), width=_width(width), lines=max(1, int(height)))


def CreateEditReal(dialog, item, kind, value, width=10):
    _control(dialog, item, "real", edit=int(kind), value=float(value), raw=None, width=_width(width))


def CreateEditInteger(dialog, item, value, width=10):
    _control(dialog, item, "int", value=int(value), raw=None, width=_width(width))


def CreateCheckBox(dialog, item, text):
    _control(dialog, item, "check", text=str(text), value=False)


def CreateThreeStateCheckBox(dialog, item, text):
    _control(dialog, item, "check3", text=str(text), value=0)


def CreateRadioButton(dialog, item, text):
    _control(dialog, item, "radio", text=str(text), value=False)


def CreatePushButton(dialog, item, text):
    _control(dialog, item, "button", text=str(text))


def CreatePullDownMenu(dialog, item, width=20):
    _control(dialog, item, "popup", choices=[], sel=[], width=_width(width))


def CreateClassPullDownMenu(dialog, item, width=20):
    _control(dialog, item, "popup", choices=list(_S.class_names), sel=[], width=_width(width))


def CreateLayerPullDownMenu(dialog, item, width=20):
    names = [l["name"] for l in _S.layers if l.get("kind") == "design"]
    _control(dialog, item, "popup", choices=names, sel=[], width=_width(width))


def CreateListBox(dialog, item, width=20, height=8):
    _control(dialog, item, "list", choices=[], sel=[], width=_width(width), lines=max(1, int(height)), multi=False)


def CreateListBoxN(dialog, item, width, height, multiple):
    _control(dialog, item, "list", choices=[], sel=[], width=_width(width), lines=max(1, int(height)), multi=bool(multiple))


def CreateColorPopup(dialog, item, width=-1):
    _control(dialog, item, "color", value=0, width=_width(width))


def CreateGroupBox(dialog, item, text, hasFrame=True):
    _control(dialog, item, "group", text=str(text), frame=bool(hasFrame), first=None)


def CreateCheckBoxGroupBox(dialog, item, text, hasFrame=True):
    _control(dialog, item, "checkgroup", text=str(text), frame=bool(hasFrame), first=None, value=False)


def CreateRadioButtonGroupBox(dialog, item, text, hasFrame=True):
    _control(dialog, item, "radiogroup", text=str(text), frame=bool(hasFrame), first=None, value=False)


def CreateTabControl(dialog, item):
    _control(dialog, item, "tabs", panes=[], value=None)


def CreateTabPane(dialog, tabs, group):
    t = _item(dialog, tabs)
    t["panes"].append(int(group))
    if t["value"] is None:
        t["value"] = int(group)


def SelectTabPane(dialog, tabs, pane):
    _item(dialog, tabs)["value"] = int(pane)


def CreateSeparator(dialog, item, length=20):
    _control(dialog, item, "sep", width=_width(length))


def CreateImageControl(dialog, item, *image):
    """An image from the plug-in's resource file, which Rodeo doesn't read: it takes no room."""
    _control(dialog, item, "image")


CreateImageControl2 = CreateImageControl


def SetFirstLayoutItem(dialog, item):
    _dialog(dialog)["first"] = int(item)


def _place(dialog, src, dst, where, indent, space):
    _item(dialog, src)[where] = int(dst)
    c = _item(dialog, dst)
    c["indent"] = float(indent)
    c["space"] = float(space)


def SetBelowItem(dialog, src, below, indent=0, space=0):
    _place(dialog, src, below, "below", indent, space)


def SetRightItem(dialog, src, right, indent=0, space=0):
    _place(dialog, src, right, "right", indent, space)


def SetFirstGroupItem(dialog, group, item):
    _item(dialog, group)["first"] = int(item)


def VerifyLayout(dialog):
    _dialog(dialog)
    return True


def _choice_text(c):
    sel = c.get("sel") or []
    choices = c.get("choices") or []
    return choices[sel[0]] if sel and 0 <= sel[0] < len(choices) else ""


def GetItemText(dialog, item):
    c = _item(dialog, item)
    if c["kind"] in ("real", "int"):
        if c.get("raw") is not None:
            return c["raw"]
        return "" if c["value"] is None else "%g" % c["value"]
    if c["kind"] in ("popup", "list"):
        return _choice_text(c)
    return c.get("text", "")


def SetItemText(dialog, item, text):
    c = _item(dialog, item)
    if c["kind"] in ("real", "int"):
        try:
            c["value"] = float(text) if c["kind"] == "real" else int(text)
            c["raw"] = None
        except (TypeError, ValueError):
            c["value"] = None
            c["raw"] = str(text)
    else:
        c["text"] = str(text)


def GetEditReal(dialog, item, kind=1):
    v = _item(dialog, item).get("value")
    return (False, 0.0) if v is None else (True, float(v))


def SetEditReal(dialog, item, kind, value):
    c = _item(dialog, item)
    c["value"] = float(value)
    c["raw"] = None


def GetEditInteger(dialog, item):
    v = _item(dialog, item).get("value")
    return (False, 0) if v is None else (True, int(v))


def SetEditInteger(dialog, item, value):
    c = _item(dialog, item)
    c["value"] = int(value)
    c["raw"] = None


def GetBooleanItem(dialog, item):
    return bool(_item(dialog, item).get("value"))


def SetBooleanItem(dialog, item, state):
    _item(dialog, item)["value"] = bool(state)


def GetThreeStateCheckBoxState(dialog, item):
    return int(_item(dialog, item).get("value") or 0)


def SetThreeStateCheckBoxState(dialog, item, state):
    _item(dialog, item)["value"] = int(state)


def AddChoice(dialog, item, text, index=-1):
    c = _item(dialog, item)
    choices = c.setdefault("choices", [])
    i = int(index)
    if i < 0 or i >= len(choices):
        choices.append(str(text))
    else:
        choices.insert(i, str(text))
        c["sel"] = [s + 1 if s >= i else s for s in c.get("sel", [])]
    # a pull-down menu always shows a choice: its first until one is chosen
    if c["kind"] == "popup" and not c.get("sel"):
        c["sel"] = [0]


InsertChoice = AddChoice


def RemoveChoice(dialog, item, index):
    c = _item(dialog, item)
    i = int(index)
    if 0 <= i < len(c.get("choices", [])):
        del c["choices"][i]
        c["sel"] = [s - 1 if s > i else s for s in c.get("sel", []) if s != i]


def RemoveAllChoices(dialog, item):
    c = _item(dialog, item)
    c["choices"] = []
    c["sel"] = []


DeleteAllItems = RemoveAllChoices


def GetChoiceCount(dialog, item):
    return len(_item(dialog, item).get("choices", []))


def GetChoiceText(dialog, item, index):
    choices = _item(dialog, item).get("choices", [])
    i = int(index)
    return choices[i] if 0 <= i < len(choices) else ""


def GetChoiceIndex(dialog, item, text):
    choices = _item(dialog, item).get("choices", [])
    return choices.index(str(text)) if str(text) in choices else -1


def GetSelectedChoiceInfo(dialog, item, at=0):
    """The first chosen at or after index at (a list's choices are walked this way), and its text; -1 when none."""
    c = _item(dialog, item)
    after = sorted(s for s in c.get("sel", []) if s >= int(at))
    if not after:
        return (-1, "")
    return (after[0], c["choices"][after[0]])


def GetSelectedChoiceIndex(dialog, item, at=0):
    return GetSelectedChoiceInfo(dialog, item, at)[0]


def SelectChoice(dialog, item, index, select=True):
    c = _item(dialog, item)
    i = int(index)
    if not select:
        c["sel"] = [s for s in c.get("sel", []) if s != i]
    elif c.get("multi"):
        c["sel"] = sorted(set(c.get("sel", [])) | set([i]))
    else:
        c["sel"] = [i]


def GetColorChoice(dialog, item):
    return int(_item(dialog, item).get("value") or 0)


def SetColorChoice(dialog, item, color):
    _item(dialog, item)["value"] = int(color)


def EnableItem(dialog, item, enable):
    _item(dialog, item)["enabled"] = bool(enable)


def ShowItem(dialog, item, show):
    _item(dialog, item)["visible"] = bool(show)


def SetTextEditable(dialog, item, editable):
    _item(dialog, item)["readonly"] = not bool(editable)


def SetFocusOnItem(dialog, item):
    _dialog(dialog)["focus"] = int(item)


def SetHelpText(dialog, item, text):
    _item(dialog, item)["tip"] = str(text)


def SetItemToolTipText(dialog, item, text, *more):
    _item(dialog, item)["tip"] = str(text)


def _dialog_json(d):
    items = []
    for c in d["items"].values():
        c = dict(c)
        # lengths go to the editor in millimetres
        if c["kind"] == "real" and c.get("edit") in _EDIT_LENGTHS and c.get("value") is not None:
            c["value"] = _mm(c["value"])
        items.append(c)
    return _json.dumps({"id": d["id"], "title": d["title"], "first": d["first"], "focus": d["focus"], "items": items})


def _dialog_values(d, values):
    """The editor's controls as they are when an event comes: what each holds."""
    for key, v in values.items():
        c = d["items"].get(int(key))
        if c is None:
            continue
        if "text" in v:
            c["text"] = str(v["text"])
        if "raw" in v:
            c["raw"] = v["raw"]
        if "sel" in v:
            c["sel"] = [int(s) for s in v["sel"]]
        if "value" in v:
            x = v["value"]
            if x is not None and c["kind"] == "real":
                x = _un(float(x)) if c.get("edit") in _EDIT_LENGTHS else float(x)
            elif x is not None and c["kind"] in ("int", "check3", "color", "tabs"):
                x = int(x)
            elif x is not None and c["kind"] in ("check", "radio", "checkgroup", "radiogroup"):
                x = bool(x)
            c["value"] = x


def _handle(handler, item, data):
    """The script's handler called for an event: the item it leaves (a Vectorscript handler's VAR item, or what a Python one returns)."""
    if handler is None:
        return item
    r = handler(item, data)
    return r if isinstance(r, int) and not isinstance(r, bool) else item


def RunLayoutDialog(dialog, handler=None):
    d = _dialog(dialog)
    if not _S.jspi:
        raise RuntimeError("vs.RunLayoutDialog shows a dialog the script waits on, which needs a browser that can pause a script (Chrome or Edge)")
    _handle(handler, _SETUP_DIALOG, 0)
    try:
        while True:
            got = _json.loads(_host("Dialog", _dialog_json(d)))
            _dialog_values(d, got.get("values") or {})
            item = _handle(handler, int(got.get("item", _CANCEL)), int(got.get("data", 0)))
            if item in (_OK, _CANCEL):
                break
        _handle(handler, _SETDOWN_DIALOG, 0)
    finally:
        _host("DialogClose", d["id"])
    return item


# ---- numbers, units and the window -----------------------------------------------------------

def Num2Str(decPlace, v):
    d = int(decPlace)
    if d < 0:
        return "%e" % float(v)
    return "%.*f" % (min(d, 9), float(v))


def Str2Num(s):
    try:
        return float(str(s).strip())
    except ValueError:
        return 0.0


def GetUnits():
    upi = 25.4 / _S.U
    return (_S.U, _S.display, _S.format, upi, _S.unit_mark, _S.area_mark)


def ReDraw():
    pass


def ReDrawAll():
    pass


def ResetObject(h):
    if isinstance(h, Handle) and _S.pio is not None and h._id == _S.pio:
        _S.reset = True


# ---- plug-ins ----------------------------------------------------------------------------------
# A plug-in's script runs with its parameters (P and the name, spaces as underscores, in any case)
# and, for an object, the object: what the script draws goes into it, in its own frame. Its event
# (vsoGetEventInfo) is Recalculate, which draws it, or one of those that set up and update its own
# Object Info layout (runner.ts runs those and applies nothing they draw): the widgets the script
# adds, their indents, which are greyed or hidden, and a button clicked.

_RECALCULATE = 3

def _pkey(name):
    return str(name).replace(" ", "_").lower()


def _typed(t, v):
    """A parameter's value as its type has it in a script: int, float, bool or str."""
    try:
        if t == "int":
            return int(v)
        if t == "real":
            return float(v)
    except (TypeError, ValueError):
        return 0 if t == "int" else 0.0
    if t == "bool":
        return v if isinstance(v, bool) else str(v).strip().lower() in ("true", "1", "yes")
    return "" if v is None else str(v)


def _param_type(name):
    """The type a parameter's value has (for the Vectorscript translator), or None when the plug-in has no such parameter."""
    if _S is None or _pkey(name) not in _S.params:
        return None
    v = _S.params[_pkey(name)]
    return "bool" if isinstance(v, bool) else "int" if isinstance(v, int) else "real" if isinstance(v, float) else "str"


def _param(name):
    return _S.params[_pkey(name)]


def _is_record(h):
    return isinstance(h, Handle) and _S.pio is not None and h._id == "rec:" + _S.pio


def GetCustomObjectInfo():
    s = _S
    if not s.pio:
        return (False, "", None, None, None)
    return (True, s.plugin["name"], Handle(s.pio), Handle("rec:" + s.pio), None)


def GetPluginInfo():
    s = _S
    if not s.plugin:
        return (False, "", None)
    return (True, s.plugin["name"], Handle("rec:" + s.pio) if s.pio else None)


def IsNewCustomObject(name):
    return bool(_S.plugin and _S.plugin.get("isNew"))


def vsoGetEventInfo():
    p = _S.plugin or {}
    return (int(p.get("event", _RECALCULATE)), int(p.get("eventData", 0)))


def SetObjPropVS(prop, value):
    _S.ui["props"][str(int(prop))] = bool(value)
    return True


def _widget(w):
    _S.ui["widgets"].append(w)
    return True


def vsoAddWidget(widget, kind, text=""):
    return _widget({"id": int(widget), "type": int(kind), "label": str(text), "level": 0})


def vsoAppendWidget(kind, widget, text="", data=0):
    return vsoAddWidget(widget, kind, text)


def vsoAddParamWidget(widget, param, text=""):
    return _widget({"id": int(widget), "param": str(param), "label": str(text), "level": 0})


def vsoInsertAllParams():
    """Every parameter, in order (runner.ts lists them): Vectorworks numbers them from 1."""
    return _widget({"all": True, "level": 0})


def vsoWidgetSetIndLvl(widget, level):
    for w in _S.ui["widgets"]:
        if w.get("id") == int(widget):
            w["level"] = int(level)
    return True


def _widget_state(widget, key, on):
    _S.ui["states"].setdefault(str(int(widget)), {})[key] = bool(on)
    return True


def vsoWidgetSetEnable(widget, enabled):
    return _widget_state(widget, "enabled", enabled)


def vsoWidgetSetVisible(widget, visible):
    return _widget_state(widget, "visible", visible)


def GetPluginString(index):
    """A string from the plug-in's resource file, which Rodeo doesn't have: empty."""
    return ""


def _accepted(*args):
    return True


for _n in ("SetObjPropCharVS", "SetObjPropRealVS", "SetPrefInt", "vsoSetEventResult", "vsoButtonGetResource",
           "SetObjectVariableBoolean", "SetObjectVariableInt", "SetObjectVariableReal", "SetObjectVariableString",
           "SetObjectVariableHandle", "SetObjectVariableLongInt",
           # a layout dialog's fine placing and sizing, which the editor's own layout does without
           "AlignItemEdge", "SetEdgeBinding", "SetProportionalBinding", "SetLayoutDialogSize", "SetLayoutDialogPosition",
           "SetHelpString"):
    globals()[_n] = _accepted
del _n


# ---- math, strings, vectors and 2D geometry (Vectorworks' Math, Strings and Graphic Calculation calls) ----

class _Vec(tuple):
    """A point or vector a vs call returns: a tuple, as Python gets it, with Vectorscript's VECTOR fields."""

    def __new__(cls, *xyz):
        t = tuple.__new__(cls, [float(v) for v in xyz])
        t.v_x, t.v_y = t[0], t[1]
        t.v_z = t[2] if len(t) > 2 else 0.0
        return t


def _vec(v):
    """A POINT or VECTOR argument as (x, y, z): a tuple or list, or a Vectorscript VECTOR."""
    if hasattr(v, "v_x"):
        return (float(v.v_x), float(v.v_y), float(getattr(v, "v_z", 0.0)))
    t = [float(x) for x in _flat([v])]
    return (t[0], t[1], t[2] if len(t) > 2 else 0.0)


def Abs(v):
    return abs(v)


def ArcCos(v):
    return _math.acos(float(v))


def ArcSin(v):
    return _math.asin(float(v))


def ArcTan(v):
    return _math.atan(float(v))


def Cos(v):
    return _math.cos(float(v))


def Sin(v):
    return _math.sin(float(v))


def Tan(v):
    return _math.tan(float(v))


def Deg2Rad(degreeValue):
    return _math.radians(float(degreeValue))


def Rad2Deg(radianValue):
    return _math.degrees(float(radianValue))


def Exp(v):
    return _math.exp(float(v))


def Ln(v):
    return _math.log(float(v))


def Max(val1, val2):
    return max(float(val1), float(val2))


def Min(val1, val2):
    return min(float(val1), float(val2))


def Random():
    import random
    return random.random()


def Round(v):
    """To the nearest whole number, a half away from zero, as Pascal rounds."""
    v = float(v)
    return int(_math.floor(abs(v) + 0.5)) * (1 if v >= 0 else -1)


def Trunc(v):
    return int(float(v))


def Sqr(v):
    return float(v) * float(v)


def Sqrt(v):
    return _math.sqrt(float(v))


def Chr(v):
    return chr(int(v))


def UniChr(v):
    return chr(int(v))


def Ord(v):
    return ord(str(v)[0]) if str(v) else 0


def Len(v):
    return len(str(v))


def Concat(*txt):
    return "".join(str(t) for t in txt)


def Copy(source, index, count):
    i = max(int(index), 1)
    return str(source)[i - 1:i - 1 + max(int(count), 0)]


def Delete(source, index, count):
    s, i = str(source), max(int(index), 1)
    return s[:i - 1] + s[i - 1 + max(int(count), 0):]


def Insert(source, dest, index):
    """Vectorscript's Insert(source, VAR dest, index): dest with source put in at index."""
    d, i = str(dest), max(int(index), 1)
    return d[:i - 1] + str(source) + d[i - 1:]


def Pos(subStr, str_):
    return str(str_).find(str(subStr)) + 1


def UprString(s):
    return str(s).upper()


def SubString(text, delimiter, index):
    """The index-th token of text split at any of delimiter's characters, or '' when there is none."""
    toks, cur, d = [], "", str(delimiter)
    for ch in str(text):
        if d and ch in d:
            toks.append(cur)
            cur = ""
        else:
            cur += ch
    toks.append(cur)
    i = int(index)
    return toks[i - 1] if 1 <= i <= len(toks) else ""


def Num2StrF(vDistance):
    """A length in the drawing's units as it shows them: feet and inches to a sixteenth, else to its decimal places."""
    v = float(vDistance)
    if _S.format == 3:
        inches = v * (_S.U / 25.4)
        sign = "-" if inches < 0 else ""
        n16 = int(round(abs(inches) * 16))
        ft, rest = divmod(n16, 192)
        whole, frac = divmod(rest, 16)
        part = ""
        if frac:
            den = 16
            while frac % 2 == 0:
                frac, den = frac // 2, den // 2
            part = " %d/%d" % (frac, den)
        return "%s%d'-%d%s\"" % (sign, ft, whole, part)
    if _S.format == 1:
        return ("%.3f" % v).rstrip("0").rstrip(".") + '"'
    return "%.*f" % (max(0, min(int(_S.display), 9)), v)


def Angle2Str(value):
    return ("%.2f" % float(value)).rstrip("0").rstrip(".") + "°"


def Str2Angle(str_):
    """Degrees from 45, 45° or degrees, minutes and seconds (45°30'15")."""
    import re
    nums = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", str(str_))]
    if not nums:
        return 0.0
    d = nums[0]
    rest = (nums[1] if len(nums) > 1 else 0.0) / 60.0 + (nums[2] if len(nums) > 2 else 0.0) / 3600.0
    return d - rest if d < 0 else d + rest


def Ang2Vec(angleR, Length):
    a, l = _math.radians(float(angleR)), float(Length)
    return _Vec(l * _math.cos(a), l * _math.sin(a), 0.0)


def Vec2Ang(Vect):
    x, y, z = _vec(Vect)
    if x == 0 and y == 0 and z == 0:
        return -90.0
    if z:
        return _math.degrees(_math.atan2(_math.hypot(y, z), x))
    return _math.degrees(_math.atan2(y, x))


def Norm(Vec):
    x, y, z = _vec(Vec)
    return _math.sqrt(x * x + y * y + z * z)


def UnitVec(Vect):
    x, y, z = _vec(Vect)
    n = _math.sqrt(x * x + y * y + z * z)
    return _Vec(x / n, y / n, z / n) if n else _Vec(0.0, 0.0, 0.0)


def Perp(Vec):
    """At the vector's angle less 90 degrees, as long, in the plan."""
    x, y, _ = _vec(Vec)
    return _Vec(y, -x, 0.0)


def DotProduct(v1, v2):
    a, b = _vec(v1), _vec(v2)
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def CrossProduct(v1, v2):
    a, b = _vec(v1), _vec(v2)
    return _Vec(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def AngBVec(v1, v2):
    a, b = _vec(v1), _vec(v2)
    na, nb = Norm(a), Norm(b)
    if not na or not nb:
        return 0.0
    c = max(-1.0, min(1.0, DotProduct(a, b) / (na * nb)))
    return _math.degrees(_math.acos(c))


def Comp(v1, v2):
    """v1's part along v2, and its part square to v2."""
    a, b = _vec(v1), _vec(v2)
    bb = DotProduct(b, b)
    k = DotProduct(a, b) / bb if bb else 0.0
    along = (b[0] * k, b[1] * k, b[2] * k)
    return (_Vec(*along), _Vec(a[0] - along[0], a[1] - along[1], a[2] - along[2]))


def Distance(x1, y1, x2, y2):
    return _math.hypot(float(x2) - float(x1), float(y2) - float(y1))


def Distance3D(x1, y1, z1, x2, y2, z2):
    return _math.sqrt((float(x2) - float(x1)) ** 2 + (float(y2) - float(y1)) ** 2 + (float(z2) - float(z1)) ** 2)


def Eq(value1, value2, tolerance):
    return abs(float(value1) - float(value2)) <= float(tolerance)


def EqPercent(value1, value2, percent):
    a, b = float(value1), float(value2)
    return abs(a - b) <= max(abs(a), abs(b)) * float(percent) / 100.0


def EqPt(pt1, pt2, tolerance):
    a, b = _vec(pt1), _vec(pt2)
    return _math.hypot(a[0] - b[0], a[1] - b[1]) <= float(tolerance)


EqPt2D = EqPt


def EqPt3D(pt1, pt2, tolerance):
    a, b = _vec(pt1), _vec(pt2)
    return Distance3D(a[0], a[1], a[2], b[0], b[1], b[2]) <= float(tolerance)


def EqualPt(p1, p2):
    a, b = _vec(p1), _vec(p2)
    return abs(a[0] - b[0]) < 1e-12 and abs(a[1] - b[1]) < 1e-12


def _corners(p1, p2):
    a, b = _vec(p1), _vec(p2)
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1]))


def EqualRect(rectAp1, rectAp2, rectBp1, rectBp2):
    return all(abs(u - v) < 1e-12 for u, v in zip(_corners(rectAp1, rectAp2), _corners(rectBp1, rectBp2)))


def PtInRect(point, rect1, rect2):
    x, y, _ = _vec(point)
    x0, y0, x1, y1 = _corners(rect1, rect2)
    return x0 <= x <= x1 and y0 <= y <= y1


def UnionRect(p1, p2, p3, p4):
    """The box round two boxes, each by its top left and bottom right corners: (top left, bottom right)."""
    a, b = _corners(p1, p2), _corners(p3, p4)
    return (_Vec(min(a[0], b[0]), max(a[3], b[3])), _Vec(max(a[2], b[2]), min(a[1], b[1])))


def PtPerpLine(pt, begPt, endPt):
    p, a, b = _vec(pt), _vec(begPt), _vec(endPt)
    d = (b[0] - a[0], b[1] - a[1])
    dd = d[0] * d[0] + d[1] * d[1]
    k = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / dd if dd else 0.0
    return _Vec(a[0] + d[0] * k, a[1] + d[1] * k, 0.0)


def PtPerpLine3D(pt, pt0, pt1):
    p, a, b = _vec(pt), _vec(pt0), _vec(pt1)
    d = [b[i] - a[i] for i in range(3)]
    dd = sum(c * c for c in d)
    k = sum((p[i] - a[i]) * d[i] for i in range(3)) / dd if dd else 0.0
    return _Vec(*[a[i] + d[i] * k for i in range(3)])


def PtOnLine(pt, begPt, endPt, tolerance):
    p, a, b = _vec(pt), _vec(begPt), _vec(endPt)
    q = PtPerpLine(p, a, b)
    if _math.hypot(p[0] - q[0], p[1] - q[1]) > float(tolerance):
        return False
    t = float(tolerance)
    return min(a[0], b[0]) - t <= q[0] <= max(a[0], b[0]) + t and min(a[1], b[1]) - t <= q[1] <= max(a[1], b[1]) + t


def PtPerpCircle(pt, cenPt, radius):
    p, c = _vec(pt), _vec(cenPt)
    dx, dy = p[0] - c[0], p[1] - c[1]
    n = _math.hypot(dx, dy) or 1.0
    r = float(radius)
    return _Vec(c[0] + dx / n * r, c[1] + dy / n * r, 0.0)


def PtOnArc(pt, cenPt, radius, startAng, sweepAng, tolerance):
    p, c = _vec(pt), _vec(cenPt)
    if abs(_math.hypot(p[0] - c[0], p[1] - c[1]) - float(radius)) > float(tolerance):
        return False
    sweep = float(sweepAng)
    if abs(sweep) >= 360:
        return True
    a = (_math.degrees(_math.atan2(p[1] - c[1], p[0] - c[0])) - float(startAng)) % 360.0
    return a <= sweep if sweep >= 0 else (360.0 - a) <= -sweep or a == 0


def ThreePtCenter(pt1, pt2, pt3):
    a, b, c = _vec(pt1), _vec(pt2), _vec(pt3)
    d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
    if not d:
        return _Vec(0.0, 0.0, 0.0)
    s = [p[0] * p[0] + p[1] * p[1] for p in (a, b, c)]
    x = (s[0] * (b[1] - c[1]) + s[1] * (c[1] - a[1]) + s[2] * (a[1] - b[1])) / d
    y = (s[0] * (c[0] - b[0]) + s[1] * (a[0] - c[0]) + s[2] * (b[0] - a[0])) / d
    return _Vec(x, y, 0.0)


def RelativeCoords(pt, begPt, endPt):
    """pt in the frame with its origin at begPt and its x axis toward endPt."""
    p, a, b = _vec(pt), _vec(begPt), _vec(endPt)
    ang = _math.atan2(b[1] - a[1], b[0] - a[0])
    dx, dy = p[0] - a[0], p[1] - a[1]
    c, s = _math.cos(ang), _math.sin(ang)
    return _Vec(dx * c + dy * s, -dx * s + dy * c)


def LineLineIntersection(l1start, l1end, l2start, l2end):
    """(parallel, the point on both segments, the point where the lines cross)."""
    a, b, c, d = _vec(l1start), _vec(l1end), _vec(l2start), _vec(l2end)
    r = (b[0] - a[0], b[1] - a[1])
    s = (d[0] - c[0], d[1] - c[1])
    den = r[0] * s[1] - r[1] * s[0]
    if abs(den) < 1e-12:
        return (True, False, _Vec(0.0, 0.0))
    t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den
    u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
    eps = 1e-9
    return (False, -eps <= t <= 1 + eps and -eps <= u <= 1 + eps, _Vec(a[0] + r[0] * t, a[1] + r[1] * t))


def LineCircleIntersect(begPt, endPt, cenPt, radius):
    """Where the line through the two points meets the circle: (whether it does, the points)."""
    a, b, c = _vec(begPt), _vec(endPt), _vec(cenPt)
    d = (b[0] - a[0], b[1] - a[1])
    f = (a[0] - c[0], a[1] - c[1])
    A = d[0] * d[0] + d[1] * d[1]
    B = 2 * (f[0] * d[0] + f[1] * d[1])
    C = f[0] * f[0] + f[1] * f[1] - float(radius) ** 2
    disc = B * B - 4 * A * C
    if not A or disc < 0:
        return (False, _Vec(0.0, 0.0, 0.0), _Vec(0.0, 0.0, 0.0))
    q = _math.sqrt(disc)
    t1, t2 = (-B - q) / (2 * A), (-B + q) / (2 * A)
    return (True, _Vec(a[0] + d[0] * t1, a[1] + d[1] * t1, 0.0), _Vec(a[0] + d[0] * t2, a[1] + d[1] * t2, 0.0))


def CircleCircleInters(cenPt1, cenPt2, radius1, radius2):
    a, b = _vec(cenPt1), _vec(cenPt2)
    r1, r2 = float(radius1), float(radius2)
    dx, dy = b[0] - a[0], b[1] - a[1]
    d = _math.hypot(dx, dy)
    if not d or d > r1 + r2 or d < abs(r1 - r2):
        return (False, _Vec(0.0, 0.0, 0.0), _Vec(0.0, 0.0, 0.0))
    k = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
    hgt = _math.sqrt(max(r1 * r1 - k * k, 0.0))
    mx, my = a[0] + dx * k / d, a[1] + dy * k / d
    return (True, _Vec(mx + dy * hgt / d, my - dx * hgt / d, 0.0), _Vec(mx - dy * hgt / d, my + dx * hgt / d, 0.0))


def _outline(h):
    """A polygon's, polyline's or rectangle's corners in the drawing's units (a polyline's arcs as their corners)."""
    return [_pt_out(v) for v in _verts(h)]


def PtInPoly(p, h):
    x, y, _ = _vec(p)
    pts = _outline(h)
    inside = False
    for i in range(len(pts)):
        (x0, y0), (x1, y1) = pts[i - 1], pts[i]
        if PtOnLine((x, y), (x0, y0), (x1, y1), 1e-9):
            return True
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside


def Centroid(h):
    try:
        pts = _outline(h)
    except (TypeError, ValueError):
        return (False, 0.0, 0.0)
    a = cx = cy = 0.0
    for i in range(len(pts)):
        (x0, y0), (x1, y1) = pts[i - 1], pts[i]
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    if not a:
        return (False, 0.0, 0.0)
    return (True, cx / (3 * a), cy / (3 * a))


def _takes(spec):
    """Lets a call's POINT arguments (p in spec) come as a point or, as Vectorscript may pass them, as x and y."""
    def wrap(fn):
        def call(*args):
            out, i = [], 0
            for c in spec:
                if i >= len(args):
                    break
                a = args[i]
                if c == "p" and not isinstance(a, (tuple, list)) and not hasattr(a, "v_x") and i + 1 < len(args):
                    out.append((float(a), float(args[i + 1])))
                    i += 2
                else:
                    out.append(a)
                    i += 1
            return fn(*out)
        call.__name__ = fn.__name__
        call.__doc__ = fn.__doc__
        return call
    return wrap


for _n, _spec in (("EqPt", "ppr"), ("EqPt2D", "ppr"), ("EqualPt", "pp"), ("EqualRect", "pppp"), ("PtInRect", "ppp"),
                  ("UnionRect", "pppp"), ("PtPerpLine", "ppp"), ("PtOnLine", "pppr"), ("PtPerpCircle", "ppr"),
                  ("PtOnArc", "pprrrr"), ("ThreePtCenter", "ppp"), ("RelativeCoords", "ppp"),
                  ("LineLineIntersection", "pppp"), ("LineCircleIntersect", "pppr"), ("CircleCircleInters", "pprr"),
                  ("PtInPoly", "ph")):
    globals()[_n] = _takes(_spec)(globals()[_n])
del _n, _spec

# ---- classes, layers and the attributes new objects take (Vectorworks' Classes, Layers, Object and Document Attributes calls) ----

_VIS_NUM = {"visible": 0, "hidden": -1, "grayed": 2}
# Layer Options and Class Options as Vectorworks numbers them
_MODES = {"active-only": 1, "gray-others": 2, "show-others": 3, "show-snap-others": 4, "modify-others": 5, "gray-snap-others": 6}


def _mode_of(n):
    for k, v in _MODES.items():
        if v == int(n):
            return k
    raise ValueError("options go from 1 (Active Only) to 6 (Gray/Snap Others), not %r" % n)


def _class_rec(name):
    c = _S.classes.get(str(name))
    if c is None:
        raise ValueError("the drawing has no class named %r" % str(name))
    return c


def _cl_attr(name, key):
    a = _class_rec(name).get("attrs")
    return a.get(key, 0) if a else 0


def _set_cl(name, attrs):
    c = _class_rec(name)
    if c.get("attrs") is None:
        raise ValueError("class %r keeps no attributes Rodeo can change" % c["name"])
    c["attrs"].update(attrs)
    _S.ops.append(["classattrs", c["name"], attrs])


def GetCVis(className):
    c = _S.classes.get(str(className))
    return _VIS_NUM.get(c["vis"], 0) if c else 0


def RenameClass(className, newName):
    c = _class_rec(className)
    old, new = c["name"], str(newName)
    if new == old:
        return
    if old == "None":
        raise ValueError("the None class keeps its name")
    if not new or new in _S.classes:
        raise ValueError("there's already a class named %r" % new)
    _S.ops.append(["renameclass", old, new])
    c["name"] = new
    del _S.classes[old]
    _S.classes[new] = c
    _S.class_names[_S.class_names.index(old)] = new
    for o in _S.objs.values():
        if o.get("cls") == old:
            o["cls"] = new
    if _S.active_class == old:
        _S.active_class = new


def DelClass(className):
    name = _class_rec(className)["name"]
    if name == "None":
        raise ValueError("the None class can't be deleted")
    _S.ops.append(["delclass", name])
    del _S.classes[name]
    _S.class_names.remove(name)
    for o in _S.objs.values():
        if o.get("cls") == name:
            o["cls"] = "None"
    if _S.active_class == name:
        _S.active_class = "None"
        _S.class_changed = True


def GetClFPat(className):
    return _cl_attr(className, "fillPattern")


def SetClFPat(className, pattern):
    _set_cl(className, {"fillPattern": int(pattern)})


def GetClFillFore(className):
    return _rgb16(_cl_attr(className, "fillFore"))


def GetClFillBack(className):
    return _rgb16(_cl_attr(className, "fillBack"))


def GetClPenFore(className):
    return _rgb16(_cl_attr(className, "penFore"))


def GetClPenBack(className):
    return _rgb16(_cl_attr(className, "penBack"))


def SetClFillFore(className, *color):
    _set_cl(className, {"fillFore": _index_of(color)})


def SetClFillBack(className, *color):
    _set_cl(className, {"fillBack": _index_of(color)})


def SetClPenFore(className, *color):
    _set_cl(className, {"penFore": _index_of(color)})


def SetClPenBack(className, *color):
    _set_cl(className, {"penBack": _index_of(color)})


# Rodeo keeps one line style number, as the file does: 0 none, 2 solid, a negative one a dash style
def GetClLS(className):
    return _cl_attr(className, "lineStyle")


def SetClLS(className, lineStyle):
    _set_cl(className, {"lineStyle": int(lineStyle)})


GetClLSN = GetClLS
SetClLSN = SetClLS


def GetClLW(className):
    return _cl_attr(className, "lineWeight")


def SetClLW(className, lineWeight):
    _set_cl(className, {"lineWeight": int(lineWeight)})


def GetClOpacity(className):
    return _cl_attr(className, "fillOpacity")


def SetClOpacity(className, opacity):
    v = max(0, min(100, int(opacity)))
    _set_cl(className, {"fillOpacity": v, "penOpacity": v})


def GetClOpacityN(className):
    return (_cl_attr(className, "fillOpacity"), _cl_attr(className, "penOpacity"))


def SetCLOpacityN(className, penOpacity, fillOpacity):
    _set_cl(className, {"fillOpacity": max(0, min(100, int(fillOpacity))), "penOpacity": max(0, min(100, int(penOpacity)))})


def GetClTextStyleRef(className):
    return _class_rec(className).get("textStyle", 0)


def SetClTextStyleRef(className, textStyleRef):
    c = _class_rec(className)
    c["textStyle"] = int(textStyleRef)
    _S.ops.append(["classtextstyle", c["name"], int(textStyleRef)])


def GetClassOptions():
    return _MODES.get(_S.class_mode, 5)


def SetClassOptions(classOpts):
    _S.class_mode = _mode_of(classOpts)


def GetLayerOptions():
    return _MODES.get(_S.layer_mode, 5)


def SetLayerOptions(layerOpts):
    _S.layer_mode = _mode_of(layerOpts)


def NumLayers():
    return len(_S.layers)


def _act_layer():
    l = _S.layer_by_id.get(_S.active_layer)
    if l is None:
        raise ValueError("the drawing has no active layer")
    return l


def GetLVis(h):
    return _VIS_NUM.get(_layer(h)["vis"], 0)


def _layer_vis(vis):
    l = _act_layer()
    l["vis"] = vis
    _S.ops.append(["layervis", l["id"], vis])


def ShowLayer():
    _layer_vis("visible")


def HideLayer():
    _layer_vis("hidden")


def GrayLayer():
    _layer_vis("grayed")


def GetLScale(h):
    return _layer(h)["scale"] or 1


def SetLScale(h, scale):
    l = _layer(h)
    v = float(scale)
    if v <= 0:
        raise ValueError("a layer's scale is more than 0, not %r" % scale)
    l["scale"] = v
    _S.ops.append(["layerscale", l["id"], v])


def SetScale(actualSize):
    SetLScale(ActLayer(), actualSize)


def _design(l):
    if l["kind"] != "design":
        raise TypeError("layer %r is a sheet layer, which has no elevation" % l["name"])
    return l


def _set_elev(l, mm):
    _design(l)["elev"] = mm
    _S.ops.append(["layerelev", l["id"], mm])


# Rodeo keeps a design layer's elevation, not its thickness, which reads 0
def GetLayerElevation(h):
    return (float(_design(_layer(h)).get("elev") or 0), 0.0)


def SetLayerElevation(h, baseElev, thickness):
    _set_elev(_layer(h), float(baseElev))


def GetZVals():
    return (_un(float(_design(_act_layer()).get("elev") or 0)), 0.0)


def SetZVals(zDistance, deltaZDistance):
    _set_elev(_act_layer(), _mm(zDistance))


def CreateLayer(layerName, layerType):
    s = _S
    name = str(layerName)
    if any(l["name"] == name for l in s.layers):
        raise ValueError("there's already a layer named %r" % name)
    kind = "sheet" if int(layerType) == 2 else "design"
    scale = 1 if kind == "sheet" else (s.layer_by_id[s.active_layer]["scale"] if s.active_layer in s.layer_by_id else 1)
    s.seq += 1
    tmp = "layer:%d" % s.seq
    l = {"id": tmp, "name": name, "kind": kind, "scale": scale, "vis": "visible", "elev": 0.0}
    s.layers.append(l)
    s.layer_by_id[tmp] = l
    s.kids[tmp] = []
    s.ops.append(["layer", tmp, name, kind, scale])
    return Handle(tmp)


def NumSelectedObjects():
    return sum(1 for o in _S.objs.values() if o["sel"])


def NumColors():
    return max([p[0] for p in _S.palette] or [0])


# an object's line style, opacity, and what it takes from its class
def GetLS(h):
    return _attr(h, "lineStyle")


def SetLS(h, lineStyle):
    _set_attrs(h, {"lineStyle": int(lineStyle)})


GetLSN = GetLS
SetLSN = SetLS


def GetOpacityN(h):
    a = _obj(h).get("attrs")
    if a is None:
        return (False, 0, 0)
    return (True, a.get("penOpacity", 100), a.get("fillOpacity", 100))


def _is_by_class(h, group):
    return group in (_obj(h).get("byClass") or [])


def IsFPatByClass(h):
    return _is_by_class(h, "fill")


def IsFillColorByClass(h):
    return _is_by_class(h, "fill")


def IsLSByClass(h):
    return _is_by_class(h, "lineStyle")


def IsLWByClass(h):
    return _is_by_class(h, "lineWeight")


def IsPenColorByClass(h):
    return _is_by_class(h, "penColor")


def GetOpacityByClass(h):
    return _is_by_class(h, "opacity")


def GetOpacityByClassN(h):
    b = _is_by_class(h, "opacity")
    return (b, b)


# Rodeo keeps an object's pen and fill opacity by class together
def SetOpacityByClassN(h, inIsPenOpacityByClass, inIsFillOpacityByClass):
    _by_class(h, "opacity", bool(inIsPenOpacityByClass) or bool(inIsFillOpacityByClass))


# the attributes new objects take: the script's, the Attributes palette's, or the drawing's
def _new_attr(key):
    for a in (_S.attrs, _S.new_attrs, _S.template_attrs):
        if key in a:
            return a[key]
    return 0


def FFillPat():
    return _new_attr("fillPattern")


def FPenPat():
    return _new_attr("lineStyle")


FPenPatN = FPenPat


def PenPatN(patNumber):
    PenPat(patNumber)


def FPenSize():
    return _new_attr("lineWeight")


def FFillFore():
    return _rgb16(_new_attr("fillFore"))


def FFillBack():
    return _rgb16(_new_attr("fillBack"))


def FPenFore():
    return _rgb16(_new_attr("penFore"))


def FPenBack():
    return _rgb16(_new_attr("penBack"))


def GetDefaultOpacity():
    return _new_attr("fillOpacity")


def GetDefaultOpacityN():
    return (_new_attr("penOpacity"), _new_attr("fillOpacity"))


def OpacityN(fillOpacity, penOpacity):
    SetDefaultOpacityN(fillOpacity, penOpacity)


# new objects never take their attributes from the class in Rodeo
def FFPatByClass():
    return False


FFillColorByClass = FLSByClass = FLWByClass = FPenColorByClass = FMarkerByClass = FFPatByClass



# ---- text objects (Vectorworks' Objects - Text calls) ----
# Rodeo styles a text as a whole: a call that takes a position or a run of characters reads or sets all of it.
# A restyled text keeps its origin, where its justification puts it, and the text shifts round it, except
# with SetTextJustN and SetTextVertAlignN, which keep the text where it is

_MM_PER_PT = 25.4 / 72


def _text_of(h):
    o = _obj(h, "a text object")
    g = o.get("shape") or {}
    if g.get("kind") != "text":
        raise TypeError("expected a text object, got %r" % h)
    return o, g


def _pt_mm(o):
    """A text's points in mm of the drawing: its point size times the layer scale."""
    return _MM_PER_PT * (_S.layer_by_id.get(o["layer"], {}).get("scale") or 1)


def _text_style(h, style, origin="origin"):
    o, g = _text_of(h)
    _S.ops.append(["textstyle", [o["id"]], style, origin])
    return o, g


def _face(bits):
    b = int(bits)
    return {"bold": bool(b & 1), "italic": bool(b & 2), "underline": bool(b & 4)}


def GetTextSize(TextHd, Position=0):
    o, g = _text_of(TextHd)
    return round(float(g.get("size") or 0) / _pt_mm(o), 3)


def SetTextSize(objectHd, Start, Count, Size):
    o, g = _text_of(objectHd)
    if float(Size) <= 0:
        raise ValueError("a text size is more than 0, not %r" % Size)
    g["size"] = float(Size) * _pt_mm(o)
    _text_style(objectHd, {"size": g["size"]})


def GetTextJust(TextHd):
    return _text_of(TextHd)[1].get("h") or 1


def SetTextJust(TextHd, JustFlag):
    j = int(JustFlag)
    if j not in (1, 2, 3):
        raise ValueError("Rodeo's texts justify 1 (left), 2 (centre) or 3 (right), not %r" % JustFlag)
    _text_style(TextHd, {"hAlign": j})[1]["h"] = j


def SetTextJustN(TextHd, JustFlag):
    j = int(JustFlag)
    if j not in (1, 2, 3):
        raise ValueError("Rodeo's texts justify 1 (left), 2 (centre) or 3 (right), not %r" % JustFlag)
    _text_style(TextHd, {"hAlign": j}, None)[1]["h"] = j


def GetTextVerticalAlign(TextHd):
    return _text_of(TextHd)[1].get("v") or 1


def SetTextVerticalAlign(TextHd, verticalAlignment):
    v = int(verticalAlignment)
    if not 1 <= v <= 5:
        raise ValueError("a vertical alignment goes from 1 (top) to 5 (bottom), not %r" % verticalAlignment)
    _text_style(TextHd, {"vAlign": v})[1]["v"] = v


def SetTextVertAlignN(TextHd, verticalAlignment):
    v = int(verticalAlignment)
    if not 1 <= v <= 5:
        raise ValueError("a vertical alignment goes from 1 (top) to 5 (bottom), not %r" % verticalAlignment)
    _text_style(TextHd, {"vAlign": v}, None)[1]["v"] = v


def GetFontID(fontName):
    name = str(fontName)
    for i, f in enumerate(_S.fonts):
        if f.lower() == name.lower():
            return i
    _S.fonts.append(name)
    return len(_S.fonts) - 1


def GetFontName(fontID):
    i = int(fontID)
    return _S.fonts[i] if 0 <= i < len(_S.fonts) else ""


def GetFontListSize():
    return len(_S.fonts)


def GetTextFont(objectHd, Position=0):
    name = _text_of(objectHd)[1].get("font")
    return GetFontID(name) if name else -1


def SetTextFont(objectHd, Start, Count, FontNum):
    name = GetFontName(FontNum)
    if not name:
        raise ValueError("no font has the number %r: GetFontID gives a font's" % FontNum)
    _text_style(objectHd, {"font": name})[1]["font"] = name


def GetTextStyle(TextHd, Position=0):
    g = _text_of(TextHd)[1]
    return (1 if g.get("bold") else 0) | (2 if g.get("italic") else 0) | (4 if g.get("underline") else 0)


def SetTextStyle(objectHd, Start, Count, Style):
    face = _face(Style)
    _text_style(objectHd, face)[1].update(face)


def GetTextOrientation(theText):
    g = _text_of(theText)[1]
    at = g.get("at") or [0, 0]
    return ((_un(at[0]), _un(at[1])), round(float(g.get("angle") or 0), 9), False)


def SetTextOrientation(theText, *args):
    v = _flat(args)
    if len(v) != 4:
        raise TypeError("vs.SetTextOrientation takes the text, its origin, its angle and whether it's mirrored")
    x, y, angle, mirrored = float(v[0]), float(v[1]), float(v[2]), v[3]
    if mirrored:
        raise ValueError("Rodeo doesn't mirror texts")
    at = [_mm(x), _mm(y)]
    g = _text_style(theText, {"angle": angle}, at)[1]
    g["angle"] = angle
    g["at"] = at


def GetTextStyleRef(objectId):
    return _text_of(objectId)[1].get("tstyle") or 0


def GetTextStyleRefN(objectId, position=0):
    return GetTextStyleRef(objectId)


def SetTextStyleRef(objectId, textStyleRef):
    _text_style(objectId, {"textStyle": int(textStyleRef)})[1]["tstyle"] = int(textStyleRef)


def SetTextStyleRefN(objectId, start, count, textStyleRef):
    SetTextStyleRef(objectId, textStyleRef)
    return True


# a text that follows its class's text style
def IsTextStyleByClassN(objectId, position=0):
    return GetTextStyleRef(objectId) == -2


def SetTextStyleByClassN(objectId, start=0, count=0):
    SetTextStyleRef(objectId, -2)
    return True


def TextFont(fontID):
    name = GetFontName(fontID)
    if not name:
        raise ValueError("no font has the number %r: GetFontID gives a font's" % fontID)
    _S.text_font = name


def TextFace(s):
    _S.text_face = int(s)


def TextRotate(Rotation):
    _S.text_angle = float(Rotation)



# ---- changing a shape by handle, and the selection (Vectorworks' Objects - Polys, Objects - 2D, General Edit calls) ----

def _poly_of(h, what):
    o = _obj(h, "a polygon or polyline")
    g = o.get("shape") or {}
    if g.get("kind") not in ("polygon", "polyline"):
        raise TypeError("vs.%s takes a polygon or polyline" % what)
    verts = [list(v) for v in g["verts"]] if g.get("verts") else [list(p) + ["corner", 0.0] for p in g["pts"]]
    return o, g, verts


def _put_poly(o, g, verts, closed, what):
    """A polygon or polyline's new vertices (x, y in mm, kind, radius in mm), in the copy and in the drawing."""
    if len(verts) < 2:
        raise ValueError("vs.%s would leave fewer than two vertices" % what)
    if g["kind"] == "polygon":
        if any(v[2] != "corner" for v in verts):
            raise TypeError("vs.%s: a polygon's vertices are corners; Rodeo can't make it a polyline here" % what)
        shape = {"kind": "polygon", "points": [_pt(v) for v in verts], "closed": closed}
        g.pop("verts", None)
    else:
        shape = {"kind": "polyline", "points": [_pt(v) for v in verts], "closed": closed,
                 "vertices": [v[2] for v in verts], "radii": [v[3] for v in verts]}
        g["verts"] = verts
    g["pts"] = [v[:2] for v in verts]
    g["closed"] = closed
    o["bbox"] = _shape_box(g)
    _S.ops.append(["geom", o["id"], shape])


def _vertex_at(verts, n, what):
    i = int(n) - 1
    if not 0 <= i < len(verts):
        raise IndexError("vs.%s: there's no vertex %r (1 to %d)" % (what, n, len(verts)))
    return i


def SetPolyPt(objectHd, index, *p):
    o, g, verts = _poly_of(objectHd, "SetPolyPt")
    x, y = _nums(p, 2, "SetPolyPt")
    i = _vertex_at(verts, index, "SetPolyPt")
    verts[i][0], verts[i][1] = _mm(x), _mm(y)
    _put_poly(o, g, verts, bool(g.get("closed")), "SetPolyPt")


def SetPolylineVertex(obj, vertexNum, *args):
    v = _flat(args)
    if len(v) < 4:
        raise TypeError("vs.SetPolylineVertex takes the vertex's point, type and radius")
    o, g, verts = _poly_of(obj, "SetPolylineVertex")
    i = _vertex_at(verts, vertexNum, "SetPolylineVertex")
    verts[i] = [_mm(v[0]), _mm(v[1]), _VERTEX_KIND.get(int(v[2]), "corner"), abs(_mm(v[3]))]
    _put_poly(o, g, verts, bool(g.get("closed")), "SetPolylineVertex")


def InsertVertex(objectHandle, x, y, beforeVertexNum, vertexType=0, arcRadius=0):
    o, g, verts = _poly_of(objectHandle, "InsertVertex")
    i = max(0, min(len(verts), int(beforeVertexNum) - 1))
    verts.insert(i, [_mm(x), _mm(y), _VERTEX_KIND.get(int(vertexType), "corner"), abs(_mm(arcRadius))])
    _put_poly(o, g, verts, bool(g.get("closed")), "InsertVertex")


def DelVertex(objectHd, vertexNum):
    o, g, verts = _poly_of(objectHd, "DelVertex")
    verts.pop(_vertex_at(verts, vertexNum, "DelVertex"))
    _put_poly(o, g, verts, bool(g.get("closed")), "DelVertex")


def IsPolyClosed(polyHandle):
    return bool(_poly_of(polyHandle, "IsPolyClosed")[1].get("closed"))


def SetPolyClosed(polyHandle, isClosed):
    o, g, verts = _poly_of(polyHandle, "SetPolyClosed")
    _put_poly(o, g, verts, bool(isClosed), "SetPolyClosed")


def Add2DVertex(*args):
    v = _flat(args)
    if len(v) < 3:
        raise TypeError("vs.Add2DVertex takes a point, a vertex type and a radius")
    _vertex([v[0], v[1], v[3] if len(v) > 3 else 0], _VERTEX_KIND.get(int(v[2]), "corner"), "Add2DVertex")


def _set_seg(h, i, p, what):
    o = _obj(h, "a line")
    g = o.get("shape") or {}
    if g.get("kind") != "line":
        raise TypeError("vs.%s takes a line" % what)
    x, y = _nums(p, 2, what)
    g["pts"][i] = [_mm(x), _mm(y)]
    a, b = g["pts"]
    o["bbox"] = _shape_box(g)
    _S.ops.append(["geom", o["id"], {"kind": "line", "a": _pt(a), "b": _pt(b)}])


def SetSegPt1(h, *p):
    _set_seg(h, 0, p, "SetSegPt1")


def SetSegPt2(h, *p):
    _set_seg(h, 1, p, "SetSegPt2")


def _arc_of(h, what):
    o = _obj(h, "an arc")
    g = o.get("shape") or {}
    if g.get("kind") != "arc" or g.get("center") is None:
        raise TypeError("vs.%s takes an arc" % what)
    return o, g


def GetArc(h):
    g = _arc_of(h, "GetArc")[1]
    return (float(g.get("start") or 0), float(g.get("sweep") or 0))


def SetArc(h, startAngle, arcAngle):
    o, g = _arc_of(h, "SetArc")
    g["start"], g["sweep"] = float(startAngle), float(arcAngle)
    shape = {"kind": "arc", "center": _pt(g["center"]), "radius": g["rx"], "startAngle": g["start"], "sweepAngle": g["sweep"]}
    if abs(g["ry"] - g["rx"]) > 1e-9:
        shape["radiusY"] = g["ry"]
    _S.ops.append(["geom", o["id"], shape])


def _rrect_of(h, what):
    o = _obj(h, "a rounded rectangle")
    g = o.get("shape") or {}
    if g.get("kind") != "roundrect" or not g.get("rr"):
        raise TypeError("vs.%s takes a rounded rectangle" % what)
    return o, g


def GetRRDiam(h):
    rx, ry = _rrect_of(h, "GetRRDiam")[1]["rr"]
    return (_un(2 * rx), _un(2 * ry))


def SetRRDiam(h, xDiam, yDiam):
    o, g = _rrect_of(h, "SetRRDiam")
    xs = [p[0] for p in g["pts"]]
    ys = [p[1] for p in g["pts"]]
    if len(set(round(x, 6) for x in xs)) > 2 or len(set(round(y, 6) for y in ys)) > 2:
        raise ValueError("vs.SetRRDiam: Rodeo changes the corners of a rounded rectangle that isn't turned")
    g["rr"] = [abs(_mm(xDiam)) / 2, abs(_mm(yDiam)) / 2]
    _S.ops.append(["geom", o["id"], {"kind": "roundrect", "x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys), "rx": g["rr"][0], "ry": g["rr"][1]}])


def HAngle(h):
    g = _obj(h).get("shape") or {}
    k = g.get("kind")
    if k == "line" or (k in ("rect", "roundrect") and len(g.get("pts") or []) >= 2):
        (x0, y0), (x1, y1) = g["pts"][0], g["pts"][1]
        return _math.degrees(_math.atan2(y1 - y0, x1 - x0))
    if k == "text":
        return float(g.get("angle") or 0)
    return 0.0


def _selection_box():
    ids = _selected_top()
    boxes = [b for b in (_box(_S.objs[i]) for i in ids) if b]
    if not boxes:
        return ids, None
    return ids, ((min(b[0] for b in boxes) + max(b[2] for b in boxes)) / 2, (min(b[1] for b in boxes) + max(b[3] for b in boxes)) / 2)


def FlipHor():
    ids, c = _selection_box()
    if c:
        _xform(ids, [-1, 0, 0, 1, 2 * c[0], 0])


def FlipVer():
    ids, c = _selection_box()
    if c:
        _xform(ids, [1, 0, 0, -1, 0, 2 * c[1]])


def Scale(scaleXR, scaleYR):
    sx, sy = float(scaleXR), float(scaleYR)
    if sx == 0 or sy == 0:
        raise ValueError("vs.Scale can't scale to nothing")
    ids, c = _selection_box()
    if c:
        _xform(ids, [sx, 0, 0, sy, c[0] * (1 - sx), c[1] * (1 - sy)])


def RotatePoint(*args):
    x, y, angle = _nums(args, 3, "RotatePoint")
    _xform(_selected_top(), _rotation(_mm(x), _mm(y), angle))


def _arrange_selection(how):
    for i in (_selected_top() if how in ("front", "backward") else list(reversed(_selected_top()))):
        _arrange(Handle(i), how)


def Forward():
    _arrange_selection("forward")


def Backward():
    _arrange_selection("backward")


def MoveFront():
    _arrange_selection("front")


def MoveBack():
    _arrange_selection("back")


def MirrorN(h, dup, *args):
    v = _flat(args)
    return Mirror(h, dup, *v[:4])


def CreateDuplicateObject(objectToDuplicate, containerHandle=None):
    o = _obj(objectToDuplicate)
    if containerHandle is not None and containerHandle._id != _container(o):
        raise ValueError("vs.CreateDuplicateObject: Rodeo duplicates into the object's own layer or group")
    return Handle(_duplicate([o["id"]], 0, 0)[0])



# ---- what objects matching search criteria measure (Vectorworks' Criteria calls) ----
# a sum, an average, or the extreme or last one, each as the function reference gives it; 0 when nothing matches

def _matches(c):
    test = _criteria(c)
    return [o for o in _all_objects() if test(o)]


def _sum_of(c, fn):
    return sum(fn(Handle(o["id"])) for o in _matches(c))


def _boxes(c):
    return [b for b in (_box(o) for o in _matches(c)) if b]


def Area(c):
    return _sum_of(c, HArea)


def Perim(c):
    return _sum_of(c, HPerim)


def Length(c):
    return _sum_of(c, HLength)


AreaN, PerimN, LengthN = Area, Perim, Length


def Width(c):
    return _sum_of(c, HWidth)


def Height(c):
    return _sum_of(c, HHeight)


def XCenter(c):
    return sum(_un((b[0] + b[2]) / 2) for b in _boxes(c))


def YCenter(c):
    return sum(_un((b[1] + b[3]) / 2) for b in _boxes(c))


def XCenterN(c):
    b = _boxes(c)
    return XCenter(c) / len(b) if b else 0.0


def YCenterN(c):
    b = _boxes(c)
    return YCenter(c) / len(b) if b else 0.0


def LeftBound(c):
    b = _boxes(c)
    return _un(b[-1][0]) if b else 0.0


def BotBound(c):
    b = _boxes(c)
    return _un(b[-1][1]) if b else 0.0


def RightBound(c):
    return sum(_un(b[2]) for b in _boxes(c))


def TopBound(c):
    return sum(_un(b[3]) for b in _boxes(c))


def LeftBoundN(c):
    b = _boxes(c)
    return _un(min(x[0] for x in b)) if b else 0.0


def BotBoundN(c):
    b = _boxes(c)
    return _un(min(x[1] for x in b)) if b else 0.0


def RightBoundN(c):
    b = _boxes(c)
    return _un(max(x[2] for x in b)) if b else 0.0


def TopBoundN(c):
    b = _boxes(c)
    return _un(max(x[3] for x in b)) if b else 0.0


def Angle(c):
    total = 0.0
    for o in _matches(c):
        g = o.get("shape") or {}
        if g.get("kind") == "line":
            total += HAngle(Handle(o["id"]))
        elif g.get("kind") == "arc":
            total += float(g.get("sweep") or 0)
    return total


def ObjectType(c):
    m = _matches(c)
    return m[-1]["type"] if m else 0


HAreaN = ObjArea = ObjAreaN = HArea
HPerimN = HPerim


def GetObjectUuid(h):
    """The object's id in the file, which Rodeo keeps as Vectorworks keeps its UUID; "" for one the script made."""
    i = _obj(h)["id"]
    return "" if ":" in i else i


def GetObjectByUuid(UUID):
    u = str(UUID)
    return Handle(u) if u in _S.objs else None


# areas and volumes as text: the drawing's area unit (Rodeo's square feet, or square metres), 2 places
_AREA_MM2 = {"sq ft": 92903.04, "ft²": 92903.04, "sq in": 645.16, "in²": 645.16, "sq m": 1e6, "m²": 1e6, "m2": 1e6,
             "cm²": 100.0, "sq cm": 100.0, "mm²": 1.0, "sq mm": 1.0, "sq km": 1e12, "km²": 1e12}
_VOLUME_MM3 = {"cu ft": 28316846.592, "ft³": 28316846.592, "cu in": 16387.064, "in³": 16387.064, "cu m": 1e9, "m³": 1e9,
               "m3": 1e9, "l": 1e6, "cm³": 1000.0, "mm³": 1.0, "cu yd": 764554857.984, "yd³": 764554857.984}


def _volume_mark():
    return "cu ft" if _S.area_mark == "sq ft" else "m³"


def _unit_text(v, mark, table):
    return ("%.2f" % (float(v) / table[mark])) + " " + mark


def _unit_value(text, mark, table):
    import re
    s = str(text).strip()
    m = re.match(r"^\s*(-?\d+(?:[.,]\d+)?)\s*(.*?)\s*$", s)
    if not m:
        return 0.0
    n = float(m.group(1).replace(",", "."))
    unit = m.group(2).lower()
    return n * table.get(unit, table[mark])


def Area2Str(value):
    return _unit_text(value, _S.area_mark, _AREA_MM2)


def Str2Area(str_):
    return _unit_value(str_, _S.area_mark, _AREA_MM2)


def Volume2Str(value):
    return _unit_text(value, _volume_mark(), _VOLUME_MM3)


def Str2Volume(str_):
    return _unit_value(str_, _volume_mark(), _VOLUME_MM3)



# ---- symbols (Vectorworks' Objects - Symbols calls) ----

def _symbol_index(name):
    name = str(name)
    for i, n in _S.symbols.items():
        if n == name:
            return i
    raise ValueError("the drawing has no symbol named %r" % name)


def Symbol(symbolName, *args):
    x, y, angle = _nums(args, 3, "Symbol")
    s = _S
    index = _symbol_index(symbolName)
    at = [_mm(x), _mm(y)]
    s.seq += 1
    tmp = "new:%d" % s.seq
    s.ops.append(["symbol", tmp, s.active_layer, index, at, s.active_class])
    b = s.symbol_boxes.get(index)
    o = {"id": tmp, "type": 15, "layer": s.active_layer, "parent": s.pio, "cls": s.active_class, "name": "", "sel": False,
         "attrs": None, "shape": None, "records": {}, "sym": index, "ins": list(at), "turned": 0.0,
         "bbox": [b[0] + at[0], b[1] + at[1], b[2] + at[0], b[3] + at[1]] if b else None}
    s.objs[tmp] = o
    if s.groups:
        s.groups[-1].append(tmp)
    s.kids.setdefault(s.pio or s.active_layer, []).append(tmp)
    s.last_new = tmp
    if angle:
        _xform([tmp], _rotation(at[0], at[1], angle))
    # Vectorworks makes the symbol it placed the active one
    s.active_symbol = index
    s.symbol_changed = True


def _placed(h, what):
    o = _obj(h, "a symbol or plug-in object")
    if o.get("ins") is None:
        raise TypeError("vs.%s takes a symbol or plug-in object" % what)
    return o


def GetSymLoc(symHd):
    return _pt_out(_placed(symHd, "GetSymLoc")["ins"])


def GetSymRot(symHd):
    return round(float(_placed(symHd, "GetSymRot").get("turned") or 0), 9)


def SymDefNum():
    return len(_S.symbols)


def SetActSymbol(name):
    _S.active_symbol = _symbol_index(name)
    _S.symbol_changed = True


def SymbolToGroup(h, convertAction=0):
    o = _obj(h, "a symbol")
    if o["type"] != 15:
        raise TypeError("vs.SymbolToGroup takes a symbol")
    _S.ops.append(["togroup", o["id"]])
    o["type"] = 11
    o["sym"] = None
    o["ins"] = None
    # as in Vectorworks, LNewObj doesn't give the group
    _S.last_new = None

`;
