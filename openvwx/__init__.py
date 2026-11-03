"""openvwx: an open-source reader/editor for Vectorworks .vwx files."""

from .document import Document, Layer, DocClass

__version__ = "0.1.0"
__all__ = ["Document", "Layer", "DocClass", "open"]


def open(path):  # noqa: A001 - mirrors the built-in on purpose
    return Document.open(path)
