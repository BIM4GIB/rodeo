# Rodeo CLI

Convert CAD and 3D files on your own computer: Revit, DWG, DXF, SketchUp, IFC, Rhino, Archicad and Vectorworks files in; IFC, PDF, DXF, glTF, OBJ, STL, STEP and more out. Nothing is uploaded.

Needs Node 22 or later.

```sh
npx @rodeo.build/cli convert model.rvt model.ifc
npm i -g @rodeo.build/cli     # then: rodeo convert model.rvt model.ifc
```

## Usage

```
Usage
  rodeo convert <input> <output>       convert one file; the output's extension picks the format
  rodeo convert <inputs…> --to <format> [--out <folder>]
                                       convert many files (globs such as "plans/*.dwg" work too)
  rodeo info <file>                    layers, object counts, extent and units
  rodeo formats                        what Rodeo reads and writes
  rodeo help, rodeo --version
```

Run `rodeo help` for the options: `--to`, `--out`, `--layer`, `--units`, `--y-up`, `--page`, `--scale`, `--force`, `--json` and `--quiet`.

## Examples

Convert one file:

```sh
rodeo convert tower.rvt tower.ifc
```

Convert many files into a folder, with a glob:

```sh
rodeo convert "plans/*.dwg" --to pdf --out pdfs
```

Describe a drawing as JSON, for a script:

```sh
rodeo info --json site.dwg
```

List the formats:

```sh
rodeo formats
```

## Formats

- Vectorworks (`.vwx`, `.sta`): reads and writes
- AutoCAD DWG (`.dwg`): reads; write DXF instead
- AutoCAD DXF (`.dxf`): reads and writes
- PDF (`.pdf`): reads and writes, one page at a time
- SVG (`.svg`), EPS (`.eps`): writes
- Windows metafile (`.emf`): reads and writes
- Revit project (`.rvt`): reads
- Archicad (`.pln`, `.pla`, `.tpl`): reads
- IFC (`.ifc`): reads and writes
- SketchUp (`.skp`): reads and writes
- Rhino (`.3dm`): reads and writes
- glTF (`.glb`, `.gltf`): reads and writes
- OBJ (`.obj`), FBX (`.fbx`), Collada (`.dae`, `.kmz`): reads and writes
- STL (`.stl`), PLY (`.ply`), 3DS (`.3ds`): reads and writes
- USD (`.usdz`, `.usd`, `.usda`, `.usdc`): reads; writes `.usdz`
- Blender (`.blend`): reads
- STEP (`.stp`, `.step`), IGES (`.igs`, `.iges`): writes

PNG is written by the converter page (rodeo.build/convert), not here.

## Privacy

Nothing is uploaded: files are read and written on this computer, and the command line sends nothing anywhere.

## Big models

Node keeps its heap to a default size. For a very large model, give it more room:

```sh
NODE_OPTIONS=--max-old-space-size=8192 rodeo convert big.rvt big.ifc
```

## Links

- Converter in the browser: [rodeo.build/convert](https://rodeo.build/convert)
- Source: [github.com/rodeobuild/rodeo](https://github.com/rodeobuild/rodeo)

## Licence

AGPL-3.0-only. The bundled packages' licences are in `THIRD-PARTY-NOTICES.txt`.

Revit and AutoCAD are trademarks of Autodesk, Inc.; SketchUp of Trimble Inc.; Rhino of Robert McNeel & Associates; Archicad of Graphisoft SE; Vectorworks of Vectorworks, Inc. Rodeo is not affiliated with any of them.
