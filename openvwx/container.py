"""Outer .vwx container: big-endian file header, settings block, Snappy chunks.

Layout (offsets in the file):

    0x0000  u32be  settings block length (0x9e0 in VW 2022 files)
    0x0008  u32be  settings block offset (0x94)
    0x000c  u16be  length of the version field, then ASCII "VW<created> VW<saved>"
    0x0020  ASCII  serial/licence string
    0x003a  ASCII  "VectorWorks"
    0x0050  u32be  build number
    0x0054  u32be  total file size            <- must be rewritten on save
    0x0058  u32be  unknown (preserved)
    0x005c  u32be  unknown (preserved)
    0x0060  ASCII  "BUILD: <n>"
    0x0094  ...    settings block (little-endian, starts with its own length)
    0x0094+len     body: repeated [u32le compressed_size][raw Snappy block]
                   each block decompresses to <= 1 MiB; concatenated they form
                   the record stream (see records.py)
"""

from dataclasses import dataclass

from . import snappy

CHUNK_SIZE = 1 << 20
FILE_SIZE_OFFSET = 0x54


@dataclass
class Container:
    header: bytes          # everything before the first Snappy chunk
    created_with: str
    saved_with: str
    build: int
    raw: bytes             # decompressed record stream
    chunk_count: int


def _ascii(buf, start, end):
    return buf[start:end].split(b"\0", 1)[0].decode("latin-1")


def read(data):
    if len(data) < 0x94:
        raise ValueError("file too small to be a .vwx document")
    settings_len = int.from_bytes(data[0:4], "big")
    settings_off = int.from_bytes(data[8:12], "big")
    if b"VectorWorks" not in data[0x30:0x50]:
        raise ValueError("missing VectorWorks signature; not a VW 2018+ file?")
    body = settings_off + settings_len
    versions = _ascii(data, 0x0E, 0x20).split()
    build = int.from_bytes(data[0x50:0x54], "big")
    declared = int.from_bytes(data[FILE_SIZE_OFFSET:FILE_SIZE_OFFSET + 4], "big")
    if declared != len(data):
        raise ValueError(f"header says {declared} bytes, file has {len(data)}")

    raw = bytearray()
    pos, chunks = body, 0
    while pos < len(data):
        csize = int.from_bytes(data[pos:pos + 4], "little")
        block, end = snappy.decompress(data, pos + 4)
        if end != pos + 4 + csize:
            raise ValueError(f"chunk {chunks} at {pos:#x}: size mismatch")
        raw += block
        pos = end
        chunks += 1
    return Container(
        header=bytes(data[:body]),
        created_with=versions[0] if versions else "",
        saved_with=versions[1] if len(versions) > 1 else "",
        build=build,
        raw=bytes(raw),
        chunk_count=chunks,
    )


def write(header, raw):
    """Rebuild a .vwx file from an original header and a record stream."""
    out = bytearray(header)
    for i in range(0, len(raw), CHUNK_SIZE):
        block = snappy.compress(raw[i:i + CHUNK_SIZE])
        out += len(block).to_bytes(4, "little") + block
    out[FILE_SIZE_OFFSET:FILE_SIZE_OFFSET + 4] = len(out).to_bytes(4, "big")
    return bytes(out)
