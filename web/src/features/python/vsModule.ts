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
        self.formats = dict((f["name"], f["format"]) for f in snap["formats"])
        self.new_attrs = dict(snap["newAttrs"])
        self.text_paper_mm = float(snap["textPaperMm"])
        self.jspi = bool(snap["jspi"])
        self.ops = []
        self.seq = 0
        self.last_new = None
        self.pen = (0.0, 0.0)
        self.relative = False
        self.closed = True
        self.poly = None
        self.groups = []
        self.attrs = {}
        self.attr_stack = []
        self.text_pts = None
        self.text_h = 1
        self.text_v = 1
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

_TYPE_OF_KIND = {"line": 2, "rect": 3, "polygon": 5, "arc": 6, "text": 10, "roundrect": 13, "locus": 17, "polyline": 21}


def _add(shape, copy, extra=None):
    """Adds a new object on the active layer (in the group being built), with the class and attributes for new objects."""
    s = _S
    s.seq += 1
    tmp = "new:%d" % s.seq
    attrs = dict(s.attrs)
    op = ["add", tmp, s.active_layer, shape, s.active_class, attrs or None]
    if extra:
        op.append(extra)
    s.ops.append(op)
    full = dict(s.new_attrs)
    full.update(attrs)
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


def TextJust(justify):
    j = int(justify)
    _S.text_h = j if j in (1, 2, 3) else 1


def TextVerticalAlign(align):
    a = int(align)
    _S.text_v = a if 1 <= a <= 5 else 1


def CreateText(text):
    scale = _S.layer_by_id[_S.active_layer]["scale"] or 1
    paper = _S.text_pts * 25.4 / 72 if _S.text_pts is not None else _S.text_paper_mm
    at = _S.pen
    _add(
        {"kind": "text", "at": _pt(at), "text": str(text), "height": paper * scale, "hAlign": _S.text_h, "vAlign": _S.text_v},
        {"kind": "text", "at": list(at), "text": str(text)},
    )


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


def FillPat(n):
    _S.attrs["fillPattern"] = int(n)


def PenPat(n):
    _S.attrs["lineStyle"] = int(n)


def PenSize(mils):
    _S.attrs["lineWeight"] = int(mils)


def FillFore(*args):
    _S.attrs["fillFore"] = _index_of(args)


def FillBack(*args):
    _S.attrs["fillBack"] = _index_of(args)


def PenFore(*args):
    _S.attrs["penFore"] = _index_of(args)


def PenBack(*args):
    _S.attrs["penBack"] = _index_of(args)


def PushAttrs():
    _S.attr_stack.append((dict(_S.attrs), _S.text_pts, _S.text_h, _S.text_v))


def PopAttrs():
    if _S.attr_stack:
        _S.attrs, _S.text_pts, _S.text_h, _S.text_v = _S.attr_stack.pop()


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


def _by_class(h, group):
    o = _obj(h)
    if o.get("attrs") is None:
        raise TypeError("%r has no attributes of its own" % h)
    _S.ops.append(["byclass", [o["id"]], group])


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
    l = {"id": tmp, "name": name, "kind": "design", "scale": scale, "vis": "visible"}
    s.layers.append(l)
    s.layer_by_id[tmp] = l
    s.kids[tmp] = []
    s.ops.append(["layer", tmp, name])
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
`;
