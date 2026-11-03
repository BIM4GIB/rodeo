"""Raw Snappy block codec (https://github.com/google/snappy/blob/main/format_description.txt).

Vectorworks compresses the document body as a series of raw Snappy blocks.
This is a dependency-free implementation; if `cramjam` is installed it is
used instead because it is much faster.
"""

try:  # optional accelerator
    import cramjam as _cramjam
except ImportError:  # pragma: no cover
    _cramjam = None


def _varint(buf, pos):
    result = shift = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        shift += 7
        if b < 0x80:
            return result, pos


def decompress(buf, pos=0):
    """Decode one raw Snappy block starting at `pos`. Returns (data, end_pos)."""
    size, pos = _varint(buf, pos)
    out = bytearray()
    while len(out) < size:
        tag = buf[pos]
        pos += 1
        kind = tag & 3
        if kind == 0:  # literal
            length = tag >> 2
            if length >= 60:
                nbytes = length - 59
                length = int.from_bytes(buf[pos:pos + nbytes], "little")
                pos += nbytes
            length += 1
            out += buf[pos:pos + length]
            pos += length
            continue
        if kind == 1:
            length = ((tag >> 2) & 7) + 4
            offset = ((tag >> 5) << 8) | buf[pos]
            pos += 1
        elif kind == 2:
            length = (tag >> 2) + 1
            offset = int.from_bytes(buf[pos:pos + 2], "little")
            pos += 2
        else:
            length = (tag >> 2) + 1
            offset = int.from_bytes(buf[pos:pos + 4], "little")
            pos += 4
        if offset == 0 or offset > len(out):
            raise ValueError(f"corrupt snappy copy (offset {offset}) at {pos:#x}")
        start = len(out) - offset
        if offset >= length:
            out += out[start:start + length]
        else:  # overlapping copy repeats the last `offset` bytes
            chunk = out[start:]
            reps, rem = divmod(length, offset)
            out += chunk * reps + chunk[:rem]
    if len(out) != size:
        raise ValueError("snappy block decoded to the wrong length")
    return bytes(out), pos


def _emit_literal(out, data, start, end):
    n = end - start - 1
    if n < 60:
        out.append(n << 2)
    else:
        nbytes = (n.bit_length() + 7) // 8
        out.append((59 + nbytes) << 2)
        out += n.to_bytes(nbytes, "little")
    out += data[start:end]


def _emit_copy(out, offset, length):
    while length > 0:
        n = min(length, 64)
        if length - n and length - n < 4:  # never leave a copy shorter than 4
            n = length - 4
        if 4 <= n <= 11 and offset < 2048:
            out.append(1 | ((n - 4) << 2) | ((offset >> 8) << 5))
            out.append(offset & 0xFF)
        else:
            out.append(2 | ((n - 1) << 2))
            out += offset.to_bytes(2, "little")
        length -= n


def compress(data):
    """Encode `data` as one raw Snappy block (greedy 4-byte hash matcher)."""
    if _cramjam is not None:
        return bytes(_cramjam.snappy.compress_raw(bytes(data)))
    n = len(data)
    out = bytearray()
    v, size = n, bytearray()
    while v >= 0x80:
        size.append((v & 0x7F) | 0x80)
        v >>= 7
    size.append(v)
    out += size
    table = {}
    lit = i = 0
    limit = n - 4
    mv = memoryview(data)
    while i <= limit:
        key = mv[i:i + 4].tobytes()
        cand = table.get(key)
        table[key] = i
        if cand is not None and i - cand <= 0xFFFF:
            j = 4
            while i + j < n and data[cand + j] == data[i + j]:
                j += 1
            if lit < i:
                _emit_literal(out, data, lit, i)
            _emit_copy(out, i - cand, j)
            i += j
            lit = i
        else:
            i += 1
    if lit < n:
        _emit_literal(out, data, lit, n)
    return bytes(out)
