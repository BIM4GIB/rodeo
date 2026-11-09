"""High-level document model: layers, classes, geometry, edits, save."""

import struct
from functools import cached_property

from . import container, geometry, records

# record types that are attached data rather than drawable children
AUX_TYPES = {0, 47, 48, 76, 101, 119, 124, 125}

VISIBILITY = {0: "visible", -1: "hidden", 2: "grayed"}
VISIBILITY_CODES = {v: k for k, v in VISIBILITY.items()}

LAYER_VIS_OFFSET = 0xD8
LAYER_SCALE_OFFSET = 0xF8
LAYER_KIND_OFFSET = 0x23C
LAYER_NAME_OFFSET = 0x292
CLASS_VIS_OFFSET = 0xB6


def _read_str(data, off):
    if off < 0 or off + 4 > len(data):
        raise ValueError("truncated layer string")
    n = int.from_bytes(data[off:off + 4], "little")
    if n % 2 or n > len(data) - off - 4:
        raise ValueError("invalid layer string length")
    return bytes(data[off + 4:off + 4 + n]).decode("utf-16le"), off + 4 + n


def _layer_shift(data):
    """Find the same per-record kind/name/title layout as the web reader."""
    for shift in range(0, 65, 2):
        kind = LAYER_KIND_OFFSET + shift
        name = LAYER_NAME_OFFSET + shift
        if name + 8 > len(data) or data[kind] not in (1, 2, 3):
            continue
        try:
            value, end = _read_str(data, name)
            _read_str(data, end)
            if value:
                return shift
        except (ValueError, UnicodeError):
            continue
    return 0  # Match the web reader when no shifted layout is recognized.


def _pack_str(s):
    b = s.encode("utf-16le")
    return len(b).to_bytes(4, "little") + b


def _set_size(rec):
    rec.data[0:8] = len(rec.data).to_bytes(8, "little")


class Layer:
    @cached_property
    def _shift(self):
        return _layer_shift(self.record.data)

    def __init__(self, doc, rec):
        self.doc, self.record = doc, rec

    @property
    def id(self):
        return self.record.guid

    @property
    def kind(self):
        return "sheet" if self.record.data[LAYER_KIND_OFFSET + self._shift] == 2 else "design"

    @property
    def name(self):
        """Design layers: the layer name. Sheet layers: the sheet number."""
        return _read_str(self.record.data, LAYER_NAME_OFFSET + self._shift)[0]

    @property
    def title(self):
        """Sheet title (empty for design layers)."""
        _, off = _read_str(self.record.data, LAYER_NAME_OFFSET + self._shift)
        return _read_str(self.record.data, off)[0]

    @property
    def scale(self):
        return struct.unpack_from("<d", self.record.data, LAYER_SCALE_OFFSET)[0]

    @property
    def visibility(self):
        code = self.record.i16(LAYER_VIS_OFFSET)
        return VISIBILITY.get(code, f"unknown({code})")

    def objects(self):
        """Drawable records on this layer, descending into groups/symbols."""
        return self.doc._drawables(self.record)

    def __repr__(self):
        return f"<Layer {self.name!r} {self.kind} 1:{self.scale:g} {self.visibility}>"


class DocClass:
    def __init__(self, doc, rec):
        self.doc, self.record = doc, rec

    @property
    def index(self):
        return self.record.name_index

    @property
    def name(self):
        return self.doc.names.get(self.index, f"#{self.index}")

    @property
    def visibility(self):
        code = self.record.i16(CLASS_VIS_OFFSET)
        return VISIBILITY.get(code, f"unknown({code})")

    def __repr__(self):
        return f"<Class {self.name!r} {self.visibility}>"


class Document:
    def __init__(self, data):
        self.container = container.read(data)
        self._load(self.container.raw)

    @classmethod
    def open(cls, path):
        with open(path, "rb") as f:
            return cls(f.read())

    def _load(self, raw):
        self.records = records.split(raw)
        self.roots = records.build_tree(self.records)
        self.names = self._read_names()
        self.layers = [Layer(self, r) for r in self.roots if r.type == 31]
        self.classes = [DocClass(self, r) for r in self.records if r.type == 94]
        self.symbols = {r.name_index: r for r in self.records if r.type == 16}

    def _read_names(self):
        rec = next((r for r in self.roots if r.type == 55), None)
        names = {}
        if rec is None:
            return names
        count, pos = rec.u32(0x58), 0x5C
        for _ in range(count):
            idx, n = rec.u32(pos), rec.u32(pos + 4)
            names[idx] = bytes(rec.data[pos + 8:pos + 8 + n]).decode("utf-16le")
            pos += 8 + n
        return names

    # ---- reading -------------------------------------------------------

    def class_name(self, index):
        return self.names.get(index, "")

    def _drawables(self, rec, depth=0):
        for c in rec.children:
            if c.type in AUX_TYPES:
                continue
            if c.type == 15 and depth < 8:  # symbol instance
                yield from self._symbol_shapes(c, depth)
                continue
            shape = geometry.decode(c)
            if shape is not None:
                yield c, shape
            if c.children:
                yield from self._drawables(c, depth + 1)

    def _symbol_shapes(self, inst, depth):
        """Place a symbol definition's geometry by mapping its extents onto the
        instance's bounding box. Exact for unrotated instances."""
        sym = self.symbols.get(inst.u16(0x8E))
        target = geometry._bbox(inst.data)
        if sym is None or target is None:
            return
        shapes = list(self._drawables(sym, depth + 1))
        src = _bounds(s for _, s in shapes)
        if src is None:
            return
        sx = (target[2] - target[0]) / ((src[2] - src[0]) or 1)
        sy = (target[3] - target[1]) / ((src[3] - src[1]) or 1)
        mapx = lambda x: target[0] + (x - src[0]) * sx
        mapy = lambda y: target[1] + (y - src[1]) * sy
        for rec, s in shapes:
            s.points = [(mapx(x), mapy(y)) for x, y in s.points]
            if s.bbox:
                s.bbox = (mapx(s.bbox[0]), mapy(s.bbox[1]), mapx(s.bbox[2]), mapy(s.bbox[3]))
            if s.center:
                s.center = (mapx(s.center[0]), mapy(s.center[1]))
                s.radii = (s.radii[0] * sx, s.radii[1] * sy)
            yield rec, s

    def layer(self, key):
        for l in self.layers:
            if key in (l.id, l.name, l.title):
                return l
        raise KeyError(key)

    def find_class(self, key):
        for c in self.classes:
            if key in (c.name, c.index, str(c.index)):
                return c
        raise KeyError(key)

    # ---- editing -------------------------------------------------------

    def _check_unique(self, name, ignore):
        taken = {l.name for l in self.layers if l is not ignore}
        taken |= set(self.names.values())
        if name in taken:
            raise ValueError(f"name {name!r} is already used in this document")

    def rename_layer(self, layer, name=None, title=None):
        rec = layer.record
        name_at = LAYER_NAME_OFFSET + layer._shift
        old_name, off = _read_str(rec.data, name_at)
        old_title, end = _read_str(rec.data, off)
        if not old_name:
            raise ValueError("unsupported or truncated layer layout")
        name = old_name if name is None else name
        title = old_title if title is None else title
        if not name:
            raise ValueError("layer name cannot be empty")
        if name != old_name:
            self._check_unique(name, layer)
        if layer.kind == "design" and title:
            raise ValueError("design layers have no title")
        rec.data[name_at:end] = _pack_str(name) + _pack_str(title)
        _set_size(rec)

    def set_layer_visibility(self, layer, visibility):
        code = VISIBILITY_CODES[visibility]
        layer.record.data[LAYER_VIS_OFFSET:LAYER_VIS_OFFSET + 2] = code.to_bytes(2, "little", signed=True)

    def set_class_visibility(self, cls, visibility):
        code = VISIBILITY_CODES[visibility]
        cls.record.data[CLASS_VIS_OFFSET:CLASS_VIS_OFFSET + 2] = code.to_bytes(2, "little", signed=True)

    def reorder_layers(self, ordered):
        """Reorder layers (stacking order). `ordered` is a list of Layers."""
        if sorted(id(l) for l in ordered) != sorted(id(l) for l in self.layers):
            raise ValueError("reorder must list every layer exactly once")
        first = self.layers[0].record.index
        last = max(r.index for r in self.layers[-1].record.walk())
        block = [r for l in ordered for r in l.record.walk()]
        assert len(block) == last - first + 1, "layers are not contiguous"
        self.records[first:last + 1] = block
        self._reload()

    def _reload(self):
        self._load(records.join(self.records))

    # ---- saving --------------------------------------------------------

    def to_bytes(self):
        for r in self.records:
            _set_size(r)
        return container.write(self.container.header, records.join(self.records))

    def save(self, path):
        data = self.to_bytes()
        Document(data)  # refuse to write something we cannot read back
        with open(path, "wb") as f:
            f.write(data)
        return len(data)


def _bounds(shapes):
    xs, ys = [], []
    for s in shapes:
        if s.bbox:
            xs += [s.bbox[0], s.bbox[2]]
            ys += [s.bbox[1], s.bbox[3]]
        for x, y in s.points:
            xs.append(x)
            ys.append(y)
    if not xs:
        return None
    return (min(xs), min(ys), max(xs), max(ys))
