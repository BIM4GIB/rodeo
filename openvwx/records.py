"""Record stream: length-prefixed object records forming a pre-order tree.

Every record starts with a 0x50-byte common header (little-endian):

    +0x00  u64   record size, including this header
    +0x08  u64   next-sibling marker: 0 = last item of its list, otherwise a
                 constant placeholder (0x05792ca4 in the sample file)
    +0x10  u64   saved memory pointer (purpose unknown, preserved)
    +0x19  u8    object type (see TYPE_NAMES)
    +0x1a  u16   name index into the name table (type 55), 0 = unnamed
    +0x1f  u8    flags
    +0x20  u32   class index into the name table
    +0x26  u64   owner pointer: the in-memory address of the parent object
                 when the file was saved. Siblings share it.
    +0x38  16B   object GUID
    +0x50  ...   type-specific body

The tree is implicit. Records are written in pre-order: a parent, then its
attached ("aux") records, then its children, then a type-0 terminator if it
is a container. A record whose owner pointer has not been seen yet opens a
new list whose parent is the record immediately before it.
"""

import uuid
from dataclasses import dataclass, field

TYPE_NAMES = {
    0: "terminator",
    2: "line",
    3: "rectangle",
    5: "polygon",
    6: "arc",
    10: "text",
    11: "group",
    14: "image",
    15: "symbol",
    16: "symbol-definition",
    21: "polyline",
    31: "layer",
    47: "record-format",
    54: "symbol-library",
    55: "name-table",
    57: "class-list",
    76: "aux-data",
    80: "layer-list-header",
    86: "plug-in-object",
    92: "symbol-folder",
    94: "class",
    101: "drop-shadow",
    119: "preview-image",
}


@dataclass(eq=False)
class Record:
    index: int
    data: bytearray
    parent: "Record | None" = None
    children: list = field(default_factory=list)

    @property
    def type(self):
        return self.data[0x19]

    @property
    def type_name(self):
        return TYPE_NAMES.get(self.type, f"type-{self.type}")

    @property
    def size(self):
        return len(self.data)

    @property
    def name_index(self):
        return int.from_bytes(self.data[0x1A:0x1C], "little")

    @property
    def class_index(self):
        return int.from_bytes(self.data[0x20:0x24], "little")

    @property
    def owner(self):
        return int.from_bytes(self.data[0x26:0x2E], "little")

    @property
    def has_next(self):
        return any(self.data[0x08:0x10])

    @property
    def guid(self):
        return str(uuid.UUID(bytes_le=bytes(self.data[0x38:0x48])))

    def u16(self, off):
        return int.from_bytes(self.data[off:off + 2], "little")

    def i16(self, off):
        return int.from_bytes(self.data[off:off + 2], "little", signed=True)

    def u32(self, off):
        return int.from_bytes(self.data[off:off + 4], "little")

    def walk(self):
        yield self
        for c in self.children:
            yield from c.walk()

    def __repr__(self):
        return f"<{self.type_name} #{self.index} {self.size}B>"


def split(raw):
    """Split the decompressed stream into Records (flat, in file order)."""
    out, pos = [], 0
    while pos < len(raw):
        size = int.from_bytes(raw[pos:pos + 8], "little")
        if size < 0x50 or pos + size > len(raw):
            raise ValueError(f"bad record size {size} at stream offset {pos:#x}")
        out.append(Record(len(out), bytearray(raw[pos:pos + size])))
        pos += size
    return out


def build_tree(records):
    """Link parent/children. Returns the list of top-level records."""
    roots, stack = [], []  # stack of (owner_pointer, parent_record)
    for i, rec in enumerate(records):
        owner = rec.owner
        if stack and stack[-1][0] == owner:
            pass
        elif any(o == owner for o, _ in stack):
            while stack[-1][0] != owner:
                stack.pop()
        else:
            stack.append((owner, records[i - 1] if i else None))
        parent = stack[-1][1]
        rec.parent = parent
        (parent.children if parent else roots).append(rec)
        if rec.type == 0:
            stack.pop()
    return roots


def join(records):
    return b"".join(bytes(r.data) for r in records)
