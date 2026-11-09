# Rodeo

Rodeo is a free, open-source drawing and 3D modelling app that runs in the browser. It opens, edits and saves Vectorworks `.vwx` files, read through a reverse-engineered model of the file format, and opens or imports AutoCAD DWG and DXF, Revit, Archicad, SketchUp, Rhino, IFC, PDF and common mesh formats.

**Use it at [rodeo.build](https://rodeo.build).** No account is needed, and the files you open stay on your computer unless you save them to the cloud.

**Status: v0.2, early.** It reads VW 2018+ files (checked on Vectorworks 2022 and on the 2023, 2024, 2025 and 2026 releases of a public demo project) and the 2D of VW 2013 files (checked on one file), draws 2D geometry, sheets and a textured 3D model, and edits layers, classes and 2D objects. Files it writes re-read cleanly in both implementations, but **have not yet been opened in Vectorworks**. Keep originals and check edited copies in Vectorworks or the free Vectorworks Viewer before relying on them.

## Using Rodeo

The **[user guide](docs/guide/README.md)** covers the app menu by menu and tool by tool:

| Area | Pages |
|---|---|
| Getting around | [Files](docs/guide/files.md) · [Workspace](docs/guide/workspace.md) · [Layers and classes](docs/guide/layers-classes.md) · [Import and export](docs/guide/import-export.md) · [Branches](docs/guide/branches.md) |
| Drawing and editing | [Drawing and attributes](docs/guide/drawing.md) · [Dimensions](docs/guide/dimensions.md) · [Selecting and editing](docs/guide/editing.md) · [Symbols and plug-in objects](docs/guide/symbols-plugins.md) |
| 3D | [3D view and rendering](docs/guide/3d-view-rendering.md) · [3D modelling](docs/guide/3d-modeling.md) |
| Documents | [Sheets, viewports and worksheets](docs/guide/sheets.md) |
| Disciplines | [Architecture](docs/guide/architecture.md) · [Site and landscape](docs/guide/site.md) · [Interiors](docs/guide/interiors.md) · [MEP](docs/guide/mep.md) · [Detailing and machine parts](docs/guide/detailing-machine.md) · [Stage and lighting](docs/guide/stage.md) · [ConnectCAD](docs/guide/connectcad.md) |
| Automating | [Scripts](docs/guide/scripting.md) |

[PARITY.md](PARITY.md) lists every Vectorworks feature and whether Rodeo has it yet.

**Convert files** without opening them at [rodeo.build/convert](https://rodeo.build/convert), in your browser, or on the command line with `npx @rodeo.build/cli convert model.rvt model.ifc` ([cli/README.md](cli/README.md)).

**Agents of your own**: Claude (web, desktop and phone), ChatGPT, Claude Code, Cursor and other MCP agents sign in and drive your open drawing (Window › Connect an Agent…), or work on files on your computer with `npx -y @rodeo.build/cli mcp`.

## Running it yourself

The editor is a static site and needs no server:

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in web/dist (typecheck + bundle)
```

Accounts, cloud drawings, sharing and live collaboration come from the optional server in `server/`. [docs/SETUP.md](docs/SETUP.md) explains how to run your own, and [docs/PLATFORM.md](docs/PLATFORM.md) lists its API and settings.

## The repository

| Path | What it holds |
|---|---|
| `web/src/core/` | the format library: container, Snappy, records, geometry, attributes, document model, edit session with undo |
| `web/src/app/` | the editor: canvas renderer, tools, panels, file I/O, the 3D view |
| `web/src/import/`, `web/src/export/` | the other formats: DWG, DXF, PDF, IFC, Revit, Archicad, SketchUp, meshes |
| `web/src/features/` | self-contained features (agents, collaboration, plug-ins, search, stage, ...) |
| `web/src/platform/` | the editor's side of the server's API |
| `web/scripts/vwx.ts` | a Node command line |
| `web/src/convert/` | the converter: any format read into a drawing and written out without the editor (the converter page, the `rodeo` command and MCP use it) |
| `cli/` | the npm package `@rodeo.build/cli`, the `rodeo` command |
| `web/vendor/` | generated third-party builds (rvt-rs) |
| `server/` | accounts, cloud drawings, collaboration, billing; `server/scripts/` holds its tests |
| `cloudrender/` | the GPU worker behind Render Image's cloud option (Modal) |
| `openvwx/`, `tests/` | the original Python reader and command-line tool, and its tests |
| `docs/guide/` | the user guide |
| `docs/` | the server's API and settings, and how to run your own |
| `brand/` | the Rodeo logo and icons |
| [FORMAT.md](FORMAT.md) | what is known of the `.vwx` format: start here to work on the format |
| [PARITY.md](PARITY.md) | the checklist of Vectorworks features and Rodeo's progress on each |

The project was called openvwx before it became Rodeo, and that name remains inside: the Python package, storage keys, the plug-in API's namespace.

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems privately, as [SECURITY.md](SECURITY.md) describes.

## Python tool

The Python reader in `openvwx/` has no dependencies and is kept as an independent second implementation of the format.

```bash
python3 -m openvwx info drawing.vwx        # version, record counts
python3 -m openvwx layers drawing.vwx      # layer list
python3 -m openvwx classes drawing.vwx     # classes and usage counts
python3 -m openvwx tree drawing.vwx --depth 3
python3 -m openvwx svg drawing.vwx out.svg --layer "Ground Floor"
python3 -m openvwx edit drawing.vwx "Ground Floor" out.vwx --rename "GF Plan" --visibility visible --move-to 0
python3 -m openvwx verify drawing.vwx      # lossless re-encode check
python3 -m openvwx serve drawing.vwx       # small layer/class viewer
```

## How editing works

The file is a Snappy-compressed stream of records forming a tree (see
[FORMAT.md](FORMAT.md)). openvwx keeps every record's bytes and only rewrites
what an edit touches, so anything it doesn't understand (3D, plug-in objects,
worksheets, record data) passes through unchanged. New objects, layers and
classes are cloned from existing records of the same type in the file, then
given new GUIDs, fresh tree addresses and new geometry. An unedited file
re-encodes to an identical record stream.

Limits for now: symbols can't be edited inside; text keeps its size when scaled and its font is drawn as
Arial (the font face isn't decoded yet); images stay upright when rotated
(their centre turns) and are scaled and mirrored as their box; stretching a rotated rectangle or a
circle unevenly turns it into a polygon; ellipses can be moved but not
reshaped; reshaping a polyline turns its curves into straight segments;
a plug-in object keeps its cached drawing when its parameters change (it is
redrawn when Vectorworks next resets it); creating an object type the file has never
contained (for example the first group or symbol instance) fails because
there is no record to copy; and pasting between files matches classes, line
types and symbols by name but keeps colour indices as they are.

## Roadmap

[PARITY.md](PARITY.md) is the checklist of Vectorworks features and which of
them Rodeo has; the items below are the format work behind them.

1. Confirm edited files open in Vectorworks / Vectorworks Viewer.
2. More sample files (other VW versions, Mac vs Windows, Spotlight, landscape).
3. The rest of the bitmap fill pattern table, image fills; plan viewports in 3D or rendered
   views; data visualisation by object types other than slabs; viewport class overrides of fill
   and pen; DXF export of sheets.
4. Native dimension objects, worksheet formulas and database rows; text fonts
   and styles.
5. 3D: Parasolid solids (free-form surfaces show only their edges), the site
   model's NURBS drape, 3D editing.
6. Desktop app: wrap `web/dist` with Electron or Tauri.

## Notes

- `samples/` is git-ignored: real drawings contain client names, addresses
  and phone numbers. Don't commit or publish them, or names and text from
  them. The checks and the Python tests read `samples/sample.vwx` when it is
  there, and the dev server serves it at `/__sample.vwx` for the "Try sample"
  button; it is never copied into the build.
- Third-party code: the editor's dependencies are listed in
  `web/package.json` and are MIT, ISC, BSD, Apache-2.0 or MPL-2.0 licensed.
  web-ifc (MPL-2.0) reads IFC, rvt-rs (Apache-2.0, built into `web/vendor/`)
  reads Revit, and the SCOWL dictionaries (MIT and BSD) back Check Spelling;
  their licences ship in `web/public/licences/` and are linked from Help >
  About. The 3D view's solid subtraction follows Evan Wallace's csg.js (MIT),
  and the DWG reader follows the Open Design Alliance's published
  specification, cross-checked against ACadSharp (MIT). Run Script loads
  Pyodide (MPL-2.0) from jsDelivr when first used.
- Rodeo reads and writes Vectorworks files by reverse engineering the format
  for interoperability, which the EU Software Directive (Art. 6) and US law
  (DMCA §1201(f)) permit. Rodeo uses no Vectorworks program code or
  libraries; a drawing it starts carries only the fixed bytes every
  Vectorworks file shares, such as the default colour table.

## Licence

Rodeo is free software: you can redistribute it and modify it under the terms
of the [GNU Affero General Public License v3.0](LICENSE). If you run a
modified copy as a service that others use over a network, you must offer
them its source code; point `SOURCE_URL` in `web/src/app/menubar.ts` (Help >
About) at your own.

Copyright © 2026 Cal Bass and the Rodeo contributors.

Vectorworks is a registered trademark of Vectorworks, Inc., part of the
Nemetschek Group. AutoCAD, DWG and Revit are trademarks of Autodesk, Inc.,
Archicad of Graphisoft SE, SketchUp of Trimble Inc., and Rhinoceros of Robert
McNeel & Associates. Rodeo is not affiliated with or endorsed by any of them;
their names are used only to say which files Rodeo reads and writes.
