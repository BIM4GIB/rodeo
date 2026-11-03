"""Command line: python -m openvwx <command> file.vwx ..."""

import argparse
import collections
import sys

from . import Document, svg


def cmd_info(doc, args):
    c = doc.container
    types = collections.Counter(r.type_name for r in doc.records)
    print(f"created with {c.created_with}, saved with {c.saved_with} (build {c.build})")
    print(f"{c.chunk_count} snappy chunks -> {len(c.raw):,} bytes, {len(doc.records):,} records")
    print(f"{len(doc.layers)} layers, {len(doc.classes)} classes, "
          f"{len(doc.symbols)} symbol definitions, {len(doc.names)} names")
    print("record types:", ", ".join(f"{k} {v}" for k, v in types.most_common(14)))


def cmd_layers(doc, args):
    for i, l in enumerate(doc.layers):
        n = sum(1 for _ in l.objects())
        title = f"  ({l.title})" if l.title else ""
        print(f"{i:2d}  {l.kind:6s} {l.visibility:8s} 1:{l.scale:<6g} {n:6d} objects  {l.name}{title}")


def cmd_classes(doc, args):
    used = collections.Counter(s.class_index for l in doc.layers for _, s in l.objects())
    for c in sorted(doc.classes, key=lambda c: c.name.lower()):
        print(f"{c.visibility:8s} {used.get(c.index, 0):6d}  {c.name}")


def cmd_tree(doc, args):
    def show(rec, depth):
        kids = [k for k in rec.children if k.type != 0]
        label = doc.names.get(rec.name_index, "") if rec.name_index else ""
        if rec.type == 31:
            label = doc.layer(rec.guid).name
        print("  " * depth + f"{rec.type_name} {label}".rstrip() + (f"  [{len(kids)}]" if kids else ""))
        if depth < args.depth:
            for k in kids[:args.limit]:
                show(k, depth + 1)
            if len(kids) > args.limit:
                print("  " * (depth + 1) + f"... {len(kids) - args.limit} more")
    for r in doc.roots:
        if r.type != 0:
            show(r, 0)


def cmd_svg(doc, args):
    layers = [doc.layer(n) for n in args.layer] if args.layer else \
        [l for l in doc.layers if l.kind == "design" and l.visibility == "visible"]
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(svg.document_svg(doc, layers))
    print(f"wrote {args.out} ({', '.join(l.name for l in layers)})")


def cmd_edit(doc, args):
    layer = doc.layer(args.layer)
    if args.rename or args.title is not None:
        doc.rename_layer(layer, args.rename, args.title)
    if args.visibility:
        doc.set_layer_visibility(layer, args.visibility)
    if args.move_to is not None:
        order = [l for l in doc.layers if l is not layer]
        order.insert(args.move_to, layer)
        doc.reorder_layers(order)
    n = doc.save(args.out)
    print(f"wrote {args.out} ({n:,} bytes): {doc.layer(layer.id)!r}")


def cmd_verify(doc, args):
    """Re-encode without edits and confirm the record stream survives intact."""
    again = Document(doc.to_bytes())
    same = again.container.raw == doc.container.raw
    print(f"re-encoded {len(doc.container.raw):,} bytes: "
          f"{'record stream identical' if same else 'MISMATCH'}")
    return 0 if same else 1


def cmd_serve(doc, args):
    from .server import serve
    serve(args.file, args.port, open_browser=not args.no_browser)


def main(argv=None):
    p = argparse.ArgumentParser(prog="openvwx", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("info", "layers", "classes", "verify"):
        sub.add_parser(name).add_argument("file")
    t = sub.add_parser("tree")
    t.add_argument("file")
    t.add_argument("--depth", type=int, default=2)
    t.add_argument("--limit", type=int, default=12)
    s = sub.add_parser("svg", help="render layers to SVG")
    s.add_argument("file")
    s.add_argument("out")
    s.add_argument("--layer", action="append", help="layer name (repeatable)")
    e = sub.add_parser("edit", help="edit a layer and save a copy")
    e.add_argument("file")
    e.add_argument("layer")
    e.add_argument("out")
    e.add_argument("--rename")
    e.add_argument("--title")
    e.add_argument("--visibility", choices=["visible", "hidden", "grayed"])
    e.add_argument("--move-to", type=int, metavar="INDEX", help="new stacking position")
    v = sub.add_parser("serve", help="open the browser viewer/editor")
    v.add_argument("file")
    v.add_argument("--port", type=int, default=8765)
    v.add_argument("--no-browser", action="store_true")
    args = p.parse_args(argv)
    if args.cmd == "serve":
        return cmd_serve(None, args)
    doc = Document.open(args.file)
    return globals()[f"cmd_{args.cmd}"](doc, args)


if __name__ == "__main__":
    sys.exit(main())
