"""Generated legacy and shifted layer records; no sample drawing needed."""
import struct
import unittest
from openvwx import Document, container
from openvwx.document import _pack_str, _layer_shift
from unittest.mock import patch


def drawing():
    header = bytearray(0x94)
    struct.pack_into(">I", header, 8, 0x94)
    header[0x3a:0x45] = b"VectorWorks"
    records = []
    for i, (shift, kind, name, title) in enumerate([
        (0, 1, "Legacy", ""), (16, 1, "Étage", ""), (18, 2, "A-01", "Plán 日本"),
    ]):
        data = bytearray(0x292 + shift)
        data[0x19] = 31
        data[0x38] = i + 1
        data[0x23c + shift] = kind
        struct.pack_into("<d", data, 0xf8, 50)
        data += _pack_str(name) + _pack_str(title) + b"untouched trailer"
        struct.pack_into("<Q", data, 0, len(data))
        records.append(data)
    return container.write(header, b"".join(records))


class LayerLayoutTest(unittest.TestCase):
    def test_fallback_and_cached_layout(self):
        self.assertEqual(_layer_shift(bytearray(0x300)), 0)
        layer = Document(drawing()).layers[1]
        with patch("openvwx.document._layer_shift", wraps=_layer_shift) as find:
            self.assertEqual(layer.name, "Étage")
            self.assertEqual(layer.kind, "design")
            self.assertEqual(layer.title, "")
            self.assertEqual(find.call_count, 1)

    def test_read_rename_reorder(self):
        doc = Document(drawing())
        self.assertEqual([l.name for l in doc.layers], ["Legacy", "Étage", "A-01"])
        self.assertEqual([l.kind for l in doc.layers], ["design", "design", "sheet"])
        self.assertEqual(doc.layers[2].title, "Plán 日本")
        self.assertEqual(doc.to_bytes(), drawing())
        for layer, shift in zip(doc.layers, [0, 16, 18]):
            before = bytes(layer.record.data)
            doc.rename_layer(layer, layer.name + " 🏗")
            self.assertEqual(layer.record.data[8:0x292 + shift], before[8:0x292 + shift])
            self.assertTrue(layer.record.data.endswith(b"untouched trailer"))
        doc.rename_layer(doc.layers[2], title="Updated 日本")
        with self.assertRaises(ValueError):
            doc.rename_layer(doc.layers[0], doc.layers[1].name)
        doc.reorder_layers(list(reversed(doc.layers)))
        again = Document(doc.to_bytes())
        self.assertEqual([l.name for l in again.layers], ["A-01 🏗", "Étage 🏗", "Legacy 🏗"])
        self.assertEqual(again.layers[0].title, "Updated 日本")

    def test_truncated_tail_is_not_edited(self):
        doc = Document(drawing())
        layer = doc.layers[1]
        layer.record.data = layer.record.data[:0x292 + 16 + 5]
        before = bytes(layer.record.data)
        with self.assertRaises(ValueError):
            doc.rename_layer(layer, "Replacement")
        self.assertEqual(layer.record.data, before)
