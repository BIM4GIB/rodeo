# Importing, exporting and printing

This page covers bringing other drawings, images, 3D models, GIS data and worksheets in with **File › Import** or by dropping them on the window, opening Revit files, and the 2D and 3D export formats. Export and print to PDF and paper, and publishing, come first. Whatever the format, an import of more than one object is grouped, the group named after the file.

Writing a drawing out as a script, and running one back in, is covered in [Scripts](scripting.md).

## Printing and PDF

### PDF export

PDF export is vector, one page per layer at its scale, or fitted to A4–A0, Letter or Tabloid. Choose the layers and whether hidden classes print. A sheet layer prints on its own page, 1:1, unless a paper size is picked.

- Images and viewport renders go in as images, each written once: JPEG as it is and PNG with its transparency.
- Text is set in Helvetica, bold or oblique as it is, and narrow fonts are set narrow.

### Print and Page Setup…

Print with **File › Print** (<kbd>⌘P</kbd>).

**File › Page Setup…** sets a sheet layer's page: an ARCH, ISO or US size or a custom one, for one sheet or all. The page is drawn as an outline centred on the sheet's origin.

### Publish…

**File › Publish…** exports chosen sheets and layers at once: one PDF with a page each, or a PDF, SVG or DXF file each, written into a folder where the browser can (else downloaded in turn).

Saved views publish to PDF too, a page each after the layers. Each page is what opening the view would show (its layers and classes, with its display options and, when its Visibility box is ticked, its visibility), cropped to the area it shows on the canvas at its present size.

Publishing sets keep a choice under a name, per drawing, in this browser.

## Exporting 2D drawings and images

Drawings export as DXF (R12, in the document's units) and SVG, and with **Export EPSF**, **Export Metafile** (.emf, its text in Arial) and **Export Image File…**.

### Export EPSF

**Export EPSF** writes the layers shown on one page at the active layer's scale, as Encapsulated PostScript: vector line work, fills and Helvetica text, with see-through colours mixed with white.

**Limits:** images and drop shadows are left out.

### Export Metafile

**Export Metafile** writes the same page as a Windows enhanced metafile (.emf), its text in Arial.

### Export Image File…

**Export Image File…** writes PNG, JPEG, TIFF or BMP at a typed resolution and the layer scale. It writes all the visible objects or the part the window shows, in colour, greyscale or black and white. PNG and TIFF can optionally go on a transparent background.

## Importing 2D drawings and images

### Import DXF…

**File › Import › Import DXF…** (or dropping a `.dxf` on the window) brings a DXF drawing into the active layer. It reads the same objects as [DWG files](#dwg-files), polylines with their bulges and points as 2D loci. Each DXF layer becomes a class, and the import is one undo step.

### DWG files

**File › Open** (or dropping a `.dwg` on the start screen) opens an AutoCAD DWG file as a new drawing, and **File › Import › Import DWG…** (or dropping one on the window) brings one into the drawing you have open. It reads every release from R13 to the 2018 format AutoCAD still saves, with no need to save it as DXF first.

- Lines, arcs, circles, ellipses, polylines, splines, points, text, blocks (dynamic blocks too), dimensions, leaders, multileaders, tables and hatches come in at the drawing's own size, each DWG layer becoming a class.
- A multileader comes in as its leader lines, landing and arrowheads (AutoCAD's closed arrow unless it names another), with its text or block.
- Objects keep their colour (the nearest in your palette) and line weight. Solid and gradient hatches come in filled, patterned ones as their lines, and layers that are off or frozen become hidden classes.
- Dashed line types come across when your drawing already has a line type to copy.
- A drawing with nothing in model space comes in from its paper space.
- 3D faces, polyface and polygon meshes, MESH objects, and 3D solids, regions and bodies come in as meshes in their colour, and Top/Plan shows them from above. They go in a group of their own beside the 2D objects'. The solids are meshed through [OpenCascade](#step-and-iges), which loads the first time a drawing has one.
- External references (xrefs) are drawn from their own files, their layers coming in as classes named like AutoCAD's, `SITEPLAN|WALLS`. Drop the files with the drawing to use them straight away; otherwise the import lists the ones it needs and asks for them, and **Import Without Them** leaves them out. An overlay isn't drawn inside another xref, as in AutoCAD.

**Limits:** images, underlays, wipeouts and objects of AutoCAD's vertical apps are left out, and the import says how many. Faces of a solid on a spline surface (a loft, or a blend between curved faces) and elliptical cones are left out of its mesh.

### Import Image File(s)… and Paste as Bitmap

**File › Import › Import Image File(s)…** places one picture or several on the active layer at 72 dpi. It takes PNG and JPEG, and GIF, WebP and BMP come in as PNG. Pictures dropped on an open drawing come in the same way.

The **Image Import Options** dialog asks once for all the pictures:

- **Compression Method:** JPEG or PNG. The line under it says how big each would make them.
- **Import as black and white** (PNG): each pixel becomes black or white.
- **Import alpha channel** (PNG, when a picture has transparent parts): keeps the transparency. Without it, the picture is laid on white, as JPEG always is.

Several pictures go in a row across the middle of the view, all selected, and one undo takes them all away.

**Edit › Paste as Bitmap** does the same with a picture on the clipboard, or else turns the objects last copied or cut into one picture their own size.

Each copies its settings from an image the drawing already has.

### Import PDF…

**File › Import › Import PDF…** (or dropping a `.pdf`) places a page of a PDF as vector objects, grouped and centred in the view.

The PDF import brings in one page's line work and fills as lines and polygons (holes kept) in the drawing's nearest colours at their line weights, and its text as text objects on their baselines, angles and sizes.

The page comes in at its paper size at a chosen scale (the layer's by default), as one group and one undo step.

Form XObjects are followed. The reader (`web/src/import/pdf.ts`, no dependencies) finds objects by scanning, so damaged cross-reference tables don't matter.

**Limits:** pictures, shadings and clipping are left out and counted, and encrypted files are refused.

### Import Metafile…

**File › Import › Import Metafile…** (or dropping a `.emf`) does the same with a Windows enhanced metafile, playing its drawing records as Windows would.

**Limits:** pictures, hatched fills and clipping are left out, and dashes are drawn solid.

## Importing 3D models

### OBJ, glTF and 3DS

**File › Import › Import OBJ…**, **Import glTF…** and **Import 3DS…** (or dropping a `.obj`, `.glb`, `.gltf` or `.3ds`) bring a 3D model in as meshes on the active layer, grouped and at the model's own coordinates, so a model exported from here comes back where it was. Each part is a mesh:

- an OBJ object or group
- a glTF mesh, as its node places it
- a 3DS object's faces of one material.

OBJ and 3DS files' units and up axis are asked for (metres, y up for OBJ and z up for 3DS at first); glTF is metres, y up.

A part's colour (an OBJ vertex colour, a glTF material's base colour, a 3DS material's diffuse colour) becomes its fill, in the drawing's nearest colour.

New meshes copy their settings from a mesh in the drawing, or, in a drawing that has none (a new one), a built-in mesh.

**Limits:** lines, points, textures, Draco-compressed glTF and a `.gltf` whose buffers are in separate files are left out; at most 100,000 faces.

### STL

**File › Import › Import STL…** (or dropping a `.stl`) reads binary and ASCII STL the same way, a mesh per ASCII solid, in millimetres with z up at first.

Import as symbol makes a symbol named after the file holding the meshes, its instance at the origin showing them where they were (the drawing needs a symbol to copy settings from too).

### USD

**File › Import › Import USD…** (or dropping a `.usda`, `.usdc`, `.usd` or `.usdz`) reads USD, text or binary (crate versions 0.4.0 on), alone or as a .usdz's root layer.

- Each Mesh (and Cube, Sphere, Cylinder and Cone) comes in through its transforms.
- A GeomSubset with its own material is a part of its own.
- Parts are coloured by their material's diffuse colour or their display colour.
- Parts are grouped by the prims under the default prim (layers, as Export USD writes them).

The file's units per metre and up axis are used unless the dialog re-scales or redefines them. The dialog can also offset the model or bring it in as a symbol, as Vectorworks' Import USD Options do.

**Limits:** references and payloads to other files, curves, points, instancers and textures are left out, and an animated transform comes in at its default.

### IFC

**File › Import › Import IFC…** (or dropping a `.ifc`) brings a building model in the same way, read with [web-ifc](https://github.com/ThatOpen/engine_web-ifc) (MPL-2.0, loaded only when a file is imported). It reads IFC2X3, IFC4 and IFC4X3, in the file's own units. Each element is a mesh, split by colour, grouped by the building storey that holds it, each storey's group named after it.

**Limits:** spaces are left out and counted; the elements come in as meshes, not as walls, slabs or doors, and their property sets aren't carried over.

## Models from other design and 3D apps

Models from other design and 3D apps come in the same way, each file saying its own units and up axis, so nothing is asked. Dropping the file works too, and a model dropped on the start screen comes into a new drawing.

### Rhino 3DM

**File › Import › Import Rhino 3DM…** reads Rhino files with McNeel's [rhino3dm](https://github.com/mcneel/rhino3dm) (openNURBS as WebAssembly, MIT, loaded only when a `.3dm` is first imported or exported).

- Meshes come in, and polysurfaces and extrusions through the render meshes Rhino saves with them.
- Blocks are expanded where they are placed.
- Curves, text and points come in as 2D objects in plan: lines, polylines, arcs and circles, other curves as polylines, and a text dot's size taken as points, scaled by the layer.

Each pen is coloured as Rhino shows it, and everything is grouped by Rhino layer, each group named after its layer path.

**Limits:** a file saved with Save Small has no render meshes, and its surfaces are left out and counted, as are SubDs and bare surfaces.

### STEP and IGES

**File › Import › Import STEP…** and **Import IGES…** (or dropping a `.stp`, `.step`, `.igs` or `.iges`) read the solids and surfaces of mechanical CAD files, through [OpenCascade](https://www.opencascade.com) as WebAssembly (LGPL-2.1, loaded only when such a file is first imported). Units and up axis come from the file, and STEP and IGES are z up.

- Each assembly comes in as a group named after its node, and each part as a mesh named after it.
- A part's faces keep the colour the file gives them, so a part with coloured faces comes in as one mesh per colour.
- Curves are triangulated to within 0.1% of a part's size and 14° of its surface, so a large or finely curved part makes many triangles.
- **File › Open** takes them too, as a drop does: into a new drawing when none is open.

**Limits:** at most 250,000 triangles come in at once, so a model that would make more is triangulated coarser to fit; a file with no shapes in it (wires only) is refused with that said.

### FBX

**Import FBX…** reads binary and ASCII FBX (Blender, 3ds Max, Maya, Revit, Unity, Unreal), each model through its full transform chain, split by material.

### Collada (SketchUp)

**Import Collada (SketchUp)…** reads `.dae` and `.kmz`, which SketchUp exports: components instanced from the library, nested transforms and materials' diffuse colours, grouped by the model's top-level nodes.

### Blender

**Import Blender…** reads `.blend` files as Blender saves them, compressed or not: each mesh object at its place in the scene, split by material slot (the Principled base colour, else the viewport colour), grouped by collection.

**Limits:** modifiers are not applied (a Subdivision or Array shows its base mesh, counted), and curves, text and collection instances are left out and counted.

### PLY

**Import PLY…** reads ASCII and binary PLY (Blender, MeshLab, scanners), split by vertex colour. Its units and up axis are asked for (metres, z up at first).

**Limits:** a point cloud is left out.

### SketchUp

**File › Import › Import SketchUp…** (or dropping a `.skp`) brings a SketchUp model in as 3D meshes, with no need to export it from SketchUp first. It reads models saved by SketchUp 6 to SketchUp 2025.

- Components become symbols, placed where the model places them, turned, mirrored or scaled. Groups stay groups with their names.
- Each tag becomes a class, and a tag hidden in SketchUp comes in as a hidden class.
- Textures become Rodeo textures, laid on each face as SketchUp lays them, and colorized ones keep their colour. Colours and see-through materials come in too.
- Edges that aren't part of a face come in as 3D polygons, guides go in a Guides class, and images come in as faces showing their picture.

**Limits:** a model of up to 250,000 faces comes in at once. Hidden geometry, text, dimensions, section planes and scenes are left out, and Rodeo says what it left out.

### Archicad projects

**File › Open** (or dropping the file) opens a `.pln` project, `.pla` archive or `.tpl` template saved by Archicad 25 to 29 as a new drawing named after the project, with no Archicad or IFC export needed.

- Each story becomes a story with its own design layer at the story's level, and each Archicad layer a class, hidden when the layer is.
- Straight walls come in as walls you can edit, on their centreline with their thickness and heights. Slabs come in at their outline and thickness.
- Roofs, meshes, morphs, beams, columns, curtain walls and curved or slanted walls come in as 3D, in their surfaces' colours.
- Floor plan lines, arcs, polylines, splines, fills, text, dimensions and zones come in as 2D in their pens' colours and weights.
- Doors, windows and objects come in at their size as see-through boxes, with their library part's parameters as records. Doors and windows cut their walls.
- Hotlinked modules come in wherever they're placed.
- Lines, text, fills and dimensions drawn in sections, elevations, details and worksheets come in on hidden design layers of their own, and layouts' on sheet layers.

**Limits:** Archicad keeps objects' shapes as GDL scripts, which Rodeo doesn't run yet. Shells, stairs' and railings' 3D and cameras aren't brought in, and a note says how many were left out. Nor are the section and elevation cuts Archicad makes from the model.

### Formats that aren't read

3ds Max, Cinema 4D and Maya files are closed. Dropping one says to export the model as FBX from that app, then import that.

## Revit files

### Revit projects

A Revit project (`.rvt`, dropped, or chosen with **File › Open**) opens as a new drawing of its model, named for the project and in its units:

- a story and a design layer at its elevation for each level
- a class for each Revit category
- a record format for each parameter group
- walls as Rodeo walls: their line, thickness and heights, with the openings of their doors and windows, and the holes and sloped tops of an edited profile, cut through their 3D and broken out of their plan where it is cut 1.2 m up
- floors as extrudes of their outlines
- rooms as their outline and name
- doors, windows, curtain panels, furniture, fixtures, ducts and the rest as meshes in their materials' exact colours.

A family type placed more than once whose instances are alike (compared by their corners, whichever way each is turned or flipped) is a symbol, placed for each.

Each element keeps its parameters as records: lengths in drawing units, areas and volumes in m² and m³ or square and cubic feet, angles in degrees.

The model is read by rvt-rs (`web/vendor/rvt-rs`, Apache-2.0, WebAssembly loaded only for a Revit import) in a worker (`app/revitImport.worker.ts`), turned into a building model (`import/rvtBuilding.ts`, `import/building.ts`) and written by `app/buildingWrite.ts`. The Revit import is checked on Autodesk's sample projects saved by Revit 2015, 2017, 2019, 2021, 2023, 2024, 2025 and 2027 and on projects saved by 2024 and 2026 of up to 95 MB (`src/import/rvtBuilding.check.ts`).

**Limits:**

- Walls come in without their layers yet.
- The doors and windows aren't Rodeo door and window objects in their walls: a wall's openings are cut into its own geometry, so editing its heights or ends stretches them with it.
- Elements whose geometry isn't decoded yet come in as their bounding box, drawn see-through, and a note says how many and what was left out.

### Revit families and templates

A family or template (`.rfa`, `.rte`, `.rft`) shows what it says about itself instead: the Revit release and build that saved it, when, whether it is workshared, a family's category, parameters and types, and linked models and drawings. It also shows its thumbnail, which can be placed in a drawing that takes pictures.

The reader is `web/src/import/rvt.ts`, with `cfb.ts` for the compound file around it.

## Exporting 3D models

### OBJ and glTF

**File › Export › Export OBJ** and **Export glTF** write the 3D model of the design layers the 3D view shows, in metres, y up: an object per mesh under its layer, with its colour and opacity.

### IFC

**Export IFC** writes the same model as IFC4 for BIM tools:

- a storey per design layer, each storey placed at its layer's elevation
- each object a wall, slab, roof, door, window, stair, column, beam or railing when its plug-in name says so (else a building element proxy)
- its triangles as coloured tessellated face sets in millimetres
- each object's records (a plug-in's parameters too) as property sets, which ArchiCAD and Revit show as properties.

**Limits:** materials and openings are not carried over.

### Rhino 3DM

**Export Rhino 3DM** writes a Rhino file in millimetres: a Rhino layer per design layer with a sublayer per class, and each object's pieces as meshes in their colours. The 2D linework that stands for nothing in 3D (lines, rectangles, polygons, polylines, arcs, circles, and text as text dots sized in points by its layer's scale) goes at its layer's elevation.

### FBX

**Export FBX** writes binary FBX 7.4 (centimetres, y up, a null per layer holding a mesh per object, a material per colour) for Blender, 3ds Max, Maya, Unity and Unreal.

### SketchUp

**File › Export › Export SketchUp** writes the 3D model of the visible design layers as a SketchUp file (`.skp`), in the format SketchUp used from 2013 to 2020.

- Each symbol becomes a component, defined once and placed where the drawing places it, turned, mirrored or scaled, inside other components too.
- Each object becomes a group named after it, and the groups inside it stay groups. A symbol placed on its own goes out as that component.
- Classes become tags, and a hidden class a hidden tag. Colours, see-through fills and PNG or JPEG textures become materials, each texture laid on its faces as the 3D view lays it.
- Walls, extrudes, solids and the other objects the 3D view draws as triangles go out as whole faces, holes and all, with the edges across a curved surface softened so it reads smooth.
- 3D polygons go out as edges and 3D loci as guide points.

**Limits:** lights, text, dimensions and 2D objects are left out.

### Collada (SketchUp)

**Export Collada (SketchUp)** writes COLLADA 1.4.1 in metres, z up, a node per layer and object, which SketchUp's **File › Import** and Blender read at full size with its colours.

### PLY

**Export PLY** writes binary PLY in metres, z up, with vertex colours.

### 3DS

**Export 3DS** writes a 3DS file for older 3D packages: metres, z up, a material per colour, objects numbered and split at the format's 65535 vertices.

### STL

**Export STL…** writes STL for 3D printing, as Vectorworks' Export STL does:

- the selected objects on the active layer (all of it when nothing there is selected), the active layer, or every visible design layer
- binary or ASCII
- in millimetres with z up, as the 3D view draws curved surfaces (no colours).

### STEP

**File › Export › Export STEP (3D only)…** writes the model for mechanical CAD (AP214, millimetres): each object a solid where its flat faces close round it, else surfaces, or every face a body of its own (Export Solid as Trimmed Surfaces), coloured, by layer.

**Limits:** curved surfaces go flat-faceted, and it hasn't been opened in a CAD program yet (only Rodeo's own STEP reader has checked it).

### IGES

**File › Export › Export IGES (3D only)…** writes the same bodies as IGES 5.3 (millimetres), as Vectorworks does: solids as B-rep objects (Type 186), the rest as trimmed surfaces (Type 144), or every face a trimmed surface of its own (Export Solid as Trimmed Surfaces). Objects keep their names and colours, each layer a numbered level.

**Limits:** curved surfaces go flat-faceted, levels are numbered rather than named, and it hasn't been opened in a CAD program yet (only Rodeo's own IGES reader has checked it).

### USD

**Export USD…** writes the same model as Universal Scene Description, as Vectorworks' Export USD does, in metres, y up:

- organized by layer or by texture (combining each texture's objects into one mesh, if asked)
- each object with its name, type, id, class and layer (and its records' values, if asked) as `vw:` attributes
- colours and textures as UsdPreviewSurface materials
- as a .usdz package or as text (.usda, or .usd holding text; with textures, a zipped folder of the scene and its images).

**Limits:** no binary .usdc and no IFC data. **Export USDZ (AR)…** stays for AR viewers.

### KML for Google Earth

**Export KML…** writes a KML file for Google Earth, at the drawing's georeferenced place, or at a reference point's latitude and longitude typed in: a folder per layer and a placemark per object. It's plain polygons in the objects' colours.

**Limits:** no textures or KMZ, and it hasn't been opened in Google Earth itself.

## GIS shapefiles

### Import Shapefile…

**File › Import › Import Shapefile…** reads ESRI shapefiles for site and GIS data. Pick a `.shp` with its `.shx`, `.dbf`, `.prj` and `.cpg` (or several, or a zip of them). Each becomes a new layer with a class named `GIS-<name>` (or goes on the active layer and class):

- points as loci
- lines as open polygons
- polygons as filled outlines with their holes
- a feature of several parts grouped.

The `.dbf` attributes can be attached as a record format named `<name> Data` (text, number, on/off and date fields).

Units come from the `.prj`, or are asked for without one. Data more than 10 km from the origin is centred. Longitude and latitude are projected equirectangular about the data's centre, as no other projection is read and the drawing keeps no georeference.

**Limits:** MultiPatch features are counted and left out.

### Export Shapefile…

**Export Shapefile…** writes the other way: the selection, the active layer or the visible design layers as a zip of polygon, line and point shapefiles, in metres, feet or millimetres.

- Each top-level object is a feature: a group of one kind as one, mixed groups by part, arcs and circles as segments.
- The shapefiles have Layer and Class columns and, optionally, a record format's fields.

**Limits:** no `.prj` is written, and text, images, symbols, plug-in objects, walls and 3D objects are left out and counted.

## Worksheets and databases

### Export Worksheet…

**File › Export › Export Worksheet…** saves one of the drawing's worksheets (the selected worksheet image's, else the first) as:

- tab-delimited text, or CSV with commas or semicolons, in UTF-8
- DIF or SYLK (in Windows-1252, as Excel reads them)
- an Excel workbook (.xlsx, plain numbers as numbers).

It writes the values as last calculated, database rows as their objects' rows (as on a sheet), and a merged cell's text in its first cell.

### Export Database…

**Export Database…** saves every record of one record format the drawing's objects hold, a row per object and a column per field, as tab-delimited text or CSV, with the field names first when ticked.

### Import Worksheet…

**File › Import › Import Worksheet…** (or a dropped .csv, .tsv, .dif, .slk or .xlsx) brings any of those back as a new worksheet named after the file, which opens in the worksheet editor.

- A workbook of several sheets asks which (Excel Import Options).
- Plain numbers become number cells with their decimals.
- A workbook keeps its bold, alignment and column widths, its dates as text and its formulas' last calculated values (a formula saved without one is left empty, and said so).
- Text files are read as UTF-8, or Windows-1252 when they aren't.

Like Create Report, the worksheet copies its settings and font from one the drawing has.

**Limits:**

- Excel 97–2004 (.xls) workbooks aren't read yet, nor is a reference to the file kept.
- A drawing with no worksheet can't import one yet.

## Converting files

### Convert Files…

**File › Convert Files…** opens the converter, rodeo.build/convert, in a new tab; the start hub links to it too. Drop one or more files on it, or choose them, pick the format to write, and download what comes back; with several, **Download all (.zip)** zips them.

It reads Vectorworks, Revit projects, Archicad, DWG, DXF, PDF, EMF, IFC, SketchUp, Rhino, glTF, OBJ, FBX, Collada, STL, PLY, 3DS, USD and Blender files, and writes Vectorworks, PDF, SVG, DXF, EPS, EMF, PNG, IFC, SketchUp, Rhino, glTF, OBJ, FBX, Collada, STL, PLY, 3DS, USDZ, STEP and IGES.

The conversion runs in your browser, so the file is never uploaded. A preview shows what came in, in 3D or in plan, with its units, layers, objects, size and what was left out.

OBJ, STL, PLY and 3DS files don't say their units: choose them, and whether Y is up, on the file's row.

### Open in Rodeo

**Open in Rodeo** on a converted file opens it in the editor in a new tab, as a drawing with no file behind it: **Save** asks where it goes.

### The rodeo command

`npx @rodeo.build/cli convert model.rvt model.ifc` converts on your own computer with Node 22 or later; the output's extension picks the format. `rodeo convert "plans/*.dwg" --to pdf --out pdfs` converts many files into a folder, `rodeo info drawing.dwg` lists its layers, object counts, extent and units, and `rodeo formats` lists what it reads and writes. `--json` prints results for scripts.

**Limits:** Rodeo doesn't write DWG: write DXF, which AutoCAD opens. A DWG's or DXF's layers become classes, and its line types draw solid. A PDF converts one page (`--page` chooses it on the command line). Models' textures are left out; their colours stay. A drawing converted to .vwx is built on Rodeo's blank drawing, which Vectorworks hasn't been confirmed to open. Very large Revit models can run out of browser memory: the command line has more room.
