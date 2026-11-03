"""Round-trip and edit tests against a sample drawing.

Run: python3 -m unittest discover -s tests   (from the repo root)

The drawing tests need a .vwx with at least three layers and one class: samples/sample.vwx,
or the file named by OPENVWX_SAMPLE. Without one they are skipped.
"""

import os
import unittest

from openvwx import Document, snappy

SAMPLE = os.environ.get("OPENVWX_SAMPLE") or os.path.join(os.path.dirname(__file__), "..", "samples", "sample.vwx")


class SnappyTest(unittest.TestCase):
    def test_codec_roundtrip(self):
        for data in (b"", b"a", b"abcabcabcabcabcabc" * 50, os.urandom(5000), bytes(70000)):
            block = snappy.compress(data)
            self.assertEqual(snappy.decompress(block)[0], data)


@unittest.skipUnless(os.path.exists(SAMPLE), "sample file missing")
class DocumentTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = Document.open(SAMPLE)

    def test_structure(self):
        self.assertGreater(len(self.doc.records), 0)
        self.assertGreaterEqual(len(self.doc.layers), 3)
        self.assertGreater(len(self.doc.classes), 0)
        names = [l.name for l in self.doc.layers]
        self.assertEqual(len(set(names)), len(names))

    def test_unedited_save_preserves_stream(self):
        again = Document(self.doc.to_bytes())
        self.assertEqual(again.container.raw, self.doc.container.raw)
        self.assertEqual(again.container.header[:0x54], self.doc.container.header[:0x54])

    def test_layer_edits(self):
        doc = Document.open(SAMPLE)
        first, third = doc.layers[0].name, doc.layers[2].name
        # only sheet layers have titles
        sheet = next((l.name for l in doc.layers if l.kind == "sheet" and l.name != first), None)
        cls = doc.classes[0].name
        doc.rename_layer(doc.layer(first), "Renamed by test")
        if sheet:
            doc.rename_layer(doc.layer(sheet), title="Ground Floor Plan")
        doc.set_layer_visibility(doc.layer(third), "hidden")
        doc.set_class_visibility(doc.find_class(cls), "visible")
        again = Document(doc.to_bytes())
        names = [l.name for l in again.layers]
        self.assertIn("Renamed by test", names)
        self.assertNotIn(first, names)
        if sheet:
            self.assertEqual(again.layer(sheet).title, "Ground Floor Plan")
        self.assertEqual(again.layer(third).visibility, "hidden")
        self.assertEqual(again.find_class(cls).visibility, "visible")
        self.assertEqual(len(again.records), len(doc.records))
        before = sum(1 for _ in Document.open(SAMPLE).layer(first).objects())
        self.assertEqual(sum(1 for _ in again.layer("Renamed by test").objects()), before)

    def test_reorder(self):
        doc = Document.open(SAMPLE)
        counts = {l.name: sum(1 for _ in l.objects()) for l in doc.layers}
        doc.reorder_layers(list(reversed(doc.layers)))
        again = Document(doc.to_bytes())
        self.assertEqual([l.name for l in again.layers], list(reversed(list(counts))))
        self.assertEqual({l.name: sum(1 for _ in l.objects()) for l in again.layers}, counts)

    def test_duplicate_name_rejected(self):
        doc = Document.open(SAMPLE)
        with self.assertRaises(ValueError):
            doc.rename_layer(doc.layers[0], doc.layers[1].name)


if __name__ == "__main__":
    unittest.main()
