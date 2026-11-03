# Rodeo

Rodeo is a free, open-source drawing and 3D modelling app that runs in the
browser. It opens, edits and saves Vectorworks `.vwx` files, read through a
reverse-engineered model of the file format, and opens or imports AutoCAD DWG
and DXF, Revit, Archicad, SketchUp, Rhino, IFC, PDF and common mesh formats.

Use it at **[rodeo.build](https://rodeo.build)**. No account is needed, and
the files you open stay on your computer unless you save them to the cloud.

**Status: v0.2, early.** It reads VW 2018+ files (checked on Vectorworks 2022
and on the 2023, 2024, 2025 and 2026 releases of a public demo project), draws
2D geometry, sheets and a textured 3D model, and edits layers, classes and 2D
objects. Files it writes re-read cleanly in both
implementations, but **have not yet been opened in Vectorworks**. Keep
originals and check edited copies in Vectorworks or the free Vectorworks
Viewer before relying on them.

The repository has these parts:

- **`web/`**: the editor. A browser app (TypeScript, Vite, Canvas 2D and
  three.js) that opens, edits and saves drawings entirely on your machine. It
  is a static site with relative paths, and works with no server.
- **`server/`**: the optional server. It adds accounts, cloud drawings with
  version history, sharing and live collaboration, the AI agents, and Rodeo
  Plus. See [docs/PLATFORM.md](docs/PLATFORM.md) and, to run your own,
  [docs/SETUP.md](docs/SETUP.md).
- **`openvwx/`**: the original Python reader and command-line tool (no
  dependencies), kept as an independent second implementation of the format.
- **`cloudrender/`**: the GPU worker behind Render Image's cloud option.
- **[FORMAT.md](FORMAT.md)**: what is known of the `.vwx` format. Start here
  to work on the format.
- **[PARITY.md](PARITY.md)**: the checklist of Vectorworks features and
  Rodeo's progress on each.

The project was called openvwx before it became Rodeo, and that name remains
inside: the Python package, storage keys, the plug-in API's namespace.

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Report
security problems privately, as [SECURITY.md](SECURITY.md) describes.

## Web editor

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in web/dist (typecheck + bundle)
```

Open a `.vwx` file with **Open** or by dropping it on the window. Save writes
back to the same file where the browser allows it (Chrome/Edge File System
Access API), otherwise it downloads a copy. File > Open Recent lists the
drawings opened or saved that way (the browser keeps their file handles, not
the drawings), and File > Revert reopens the saved file. File > Save a Copy
As… writes the drawing as it stands to a new file while the window goes on
working on its own, and File > Save All saves every open drawing with
unsaved changes (asking where for one never saved). Each drawing opened
goes in a tab of its own: once two are open a strip of tabs shows over the
drawing, and each comes back to the front as it was left (layer, class,
selection, view and undo); File > Close or a tab's × closes one, asking first
about unsaved changes, File > Close All closes them all (Cancel on one stops
there), and Window > Drawings lists them; Window > Show Document Tabs hides
the strip, and Window > Home Screen brings the start screen back over the
drawing (Back to drawing or Escape returns). File > New (New
drawing on the start screen) starts a blank drawing, "Untitled 1": one design
layer and the class None, in feet and inches where the browser's region
measures in them and millimetres elsewhere (File > Document Settings > Units
changes that). Its lines, rectangles, polygons, polylines, arcs, text and
groups are written from Rodeo's own records rather than copied from the
drawing, and whether Vectorworks opens a drawing started this way is not yet
confirmed. File > New from Template… opens a Vectorworks template (`.sta`, or
any `.vwx`) as a new drawing in the same way, leaving the template as it was;
Save asks where the new drawing goes. File > File Info… lists the open file's
name, size, the Vectorworks versions and build it names, its units and what it
holds. File > Save as Template… writes the
drawing as a `.sta` for that, while the window goes on working on its own
file. File > Import DXF…
(or dropping a `.dxf` on the window) brings a DXF drawing into the active
layer. File > Import Image… places a PNG or JPEG (GIF, WebP and BMP become
PNG) on the active layer at 72 dpi, and Edit > Paste as Bitmap does the same
with a picture on the clipboard, or else turns the objects last copied or cut
into one picture their own size; each copies its settings from an image the
drawing already has. File > Import PDF… (or dropping a `.pdf`) places a page
of a PDF as vector objects, grouped and centred in the view; File > Import >
Import Metafile… (or dropping a `.emf`) does the same with a Windows enhanced
metafile, playing its drawing records as Windows would (pictures, hatched
fills and clipping left out, dashes drawn solid). File > Import
OBJ…, Import glTF… and Import 3DS… (or dropping a `.obj`, `.glb`, `.gltf` or
`.3ds`) bring a 3D model in as meshes on the active layer, a mesh per part
(an OBJ object or group, a glTF mesh as its node places it, a 3DS object's
faces of one material), grouped and at the model's own coordinates, so a
model exported from here comes back where it was. OBJ and 3DS files' units
and up axis are asked for (metres, y up for OBJ and z up for 3DS at first);
glTF is metres, y up. A part's colour (an OBJ vertex colour, a glTF
material's base colour, a 3DS material's diffuse colour) becomes its fill,
in the drawing's nearest colour. Lines, points, textures, Draco-compressed
glTF and a `.gltf` whose buffers are in separate files are left out; at most
100,000 faces. New meshes copy their settings from a mesh in the drawing, or,
in a drawing that has none (a new one), a built-in mesh. File > Import
STL… (or dropping a `.stl`) reads binary and ASCII STL the same way, a mesh
per ASCII solid, in millimetres with z up at first; Import as symbol makes a
symbol named after the file holding the meshes, its instance at the origin
showing them where they were (the drawing needs a symbol to copy settings
from too). File > Import USD… (or dropping a `.usda`, `.usdc`, `.usd` or
`.usdz`) reads USD, text or binary (crate versions 0.4.0 on), alone or as a
.usdz's root layer: each Mesh (and Cube,
Sphere, Cylinder and Cone) through its transforms, a GeomSubset with its own
material as a part of its own, coloured by its material's diffuse colour or
its display colour, grouped by the prims under the default prim (layers, as
Export USD writes them). The file's units per metre and up axis are used
unless the dialog re-scales or redefines them, and it can offset the model
or bring it in as a symbol, as Vectorworks' Import USD Options do.
References and payloads to other files, curves, points, instancers and
textures are left out, and an animated transform comes in at its default. File > Import > Import Shapefile… reads ESRI shapefiles for
site and GIS data: pick a `.shp` with its `.shx`, `.dbf`, `.prj` and `.cpg`
(or several, or a zip of them), and each becomes a new layer with a class
named GIS-<name> (or goes on the active layer and class): points as loci,
lines as open polygons, polygons as filled outlines with their holes, a
feature of several parts grouped. The `.dbf` attributes can be attached as
a record format named "<name> Data" (text, number, on/off and date
fields). Units come from
the `.prj`, or are asked for without one; data more than 10 km from the
origin is centred; longitude and latitude are projected equirectangular
about the data's centre, as no other projection is read and the drawing
keeps no georeference. MultiPatch features are counted and left out. Export
Shapefile… writes the other way: the selection, the active layer or the
visible design layers as a zip of polygon, line and point shapefiles, each
top-level object a feature (a group of one kind as one, mixed groups by
part, arcs and circles as segments), with Layer and Class columns and,
optionally, a record format's fields, in metres, feet or millimetres; no
`.prj` is written, and text, images, symbols, plug-in objects, walls and 3D
objects are left out and counted. File > Import
IFC… (or dropping a `.ifc`) brings a building model in the same way, read
with [web-ifc](https://github.com/ThatOpen/engine_web-ifc) (MPL-2.0, loaded
only when a file is imported): IFC2X3, IFC4 and IFC4X3, in the file's own
units; an element a mesh, split by colour, grouped by the building storey
that holds it, each storey's group named after it. Spaces are left out and
counted; the elements come in as meshes, not as walls, slabs or doors, and
their property sets aren't carried over.

Models from other design and 3D apps come in the same way, each file saying
its own units and up axis, so nothing is asked (dropping the file works too,
and a model dropped on the start screen comes into a new drawing):
File > Import > Import Rhino 3DM… reads Rhino files with McNeel's
[rhino3dm](https://github.com/mcneel/rhino3dm) (openNURBS as WebAssembly, MIT,
loaded only when a `.3dm` is first imported or exported): meshes, and
polysurfaces and extrusions through the render meshes Rhino saves with them
(a file saved with Save Small has none, and its surfaces are left out and
counted, as are SubDs and bare surfaces), blocks expanded where they are
placed; curves, text and points come in as 2D objects in plan (lines,
polylines, arcs and circles, other curves as polylines; a text dot's size
taken as points, scaled by the layer), each pen coloured as Rhino shows it,
and everything is grouped by Rhino layer, each group named after its layer
path.
Import FBX… reads binary and ASCII FBX (Blender, 3ds Max, Maya, Revit,
Unity, Unreal), each model through its full transform chain, split by
material. Import Collada (SketchUp)… reads `.dae` and `.kmz`, SketchUp's own
exchange format (SketchUp's `.skp` is closed): components instanced from the
library, nested transforms, materials' diffuse colours, grouped by the
model's top-level nodes. Import Blender… reads `.blend` files as Blender
saves them, compressed or not: each mesh object at its place in the scene,
split by material slot (the Principled base colour, else the viewport
colour), grouped by collection; modifiers are not applied (a Subdivision or
Array shows its base mesh, counted), and curves, text and collection
instances are left out and counted. Import PLY… reads ASCII and binary PLY
(Blender, MeshLab, scanners), split by vertex colour; its units and up axis
are asked for (metres, z up at first), and a point cloud is left out.
Whatever the format, an import of more than one object is grouped, the group
named after the file. Dropping a file of an app whose own format is closed (SketchUp `.skp`,
ArchiCAD `.pln`, 3ds Max, Cinema 4D, Maya) or not read yet
(`.dwg`) says what to export from that app instead. A Revit project (`.rvt`,
dropped, or chosen with File > Open) opens as a new drawing of its model,
named for the project and in its units: a story and a design layer at its
elevation for each level, a class for each Revit category, a record format
for each parameter group, walls as Rodeo walls (their line, thickness and
heights, without their layers yet, with the openings of their doors and windows, and the
holes and sloped tops of an edited profile, cut through their 3D and broken
out of their plan where it is cut 1.2 m up),
floors as extrudes of their outlines, rooms as their outline and name, and
doors, windows, curtain panels, furniture, fixtures, ducts and the rest as
meshes in their materials' exact colours; a family type placed more than
once whose instances are alike (compared by their corners, whichever way
each is turned or flipped) is a symbol, placed for each. Each element keeps
its parameters as records (lengths in drawing units, areas and volumes in
m² and m³ or square and cubic feet, angles in degrees). Elements whose
geometry isn't decoded yet come in as their bounding box, drawn see-through,
and a note says how many and what was left out. The doors and windows aren't
Rodeo door and window objects in their walls: a wall's openings are cut into
its own geometry, so editing its heights or ends stretches them with it. The model is read by rvt-rs
(`web/vendor/rvt-rs`, Apache-2.0, WebAssembly loaded only for a Revit import,
`scripts/rvt-wasm.sh` rebuilds it) in a worker (`app/revitImport.worker.ts`),
turned into a building model (`import/rvtBuilding.ts`, `import/building.ts`)
and written by `app/buildingWrite.ts`. Checked on Autodesk's sample projects
saved by Revit 2015, 2017, 2019, 2021, 2023, 2024, 2025 and 2027 and on
projects saved by 2024 and 2026 of up to 95 MB (`src/import/rvtBuilding.check.ts`). A family or
template (`.rfa`, `.rte`, `.rft`) shows what it says about itself instead
(the Revit release and build that saved it, when, whether it is workshared,
a family's category, parameters and types, linked models and drawings) and
its thumbnail, which can be placed in a drawing that takes pictures
(`web/src/import/rvt.ts`, `cfb.ts` for the compound file around it).

- **Workspace**: laid out after Spline's editor, dark by default (View >
  Theme: Dark, Light or System; View > Dark Canvas inverts the drawing's ink
  and paper). Full-height side panels flank the drawing, which sits in an
  inset card, beside one sidebar on the right packed as Vectorworks packs
  its palettes: Object Info (Shape, Data and Render tabs) with Attributes
  as a tab of it, above Navigation (Layers, Classes, Stories, Sheets,
  Viewports and Saved Views tabs) with Resources and Agents as its tabs.
  The left side is down to its rail of palette icons, so the drawing has
  the rest of the window (Window > Workspaces > Two Sidebars puts
  Navigation back on the left and Attributes under Object Info). The top bar holds the Menu button (every menu), the
  file's name, 2D or 3D with the standard views and render mode, the tools
  in groups (each shows its last used tool; its caret drops the rest), undo,
  the zoom (type a percentage), Export (PDF, image files, SVG, DXF, Print) and Save.
  Over the drawing, the View bar pill holds the active layer and its scale and
  class with the layer and class options and visibility lists (each design
  layer or class as visible, grayed or hidden, searchable, a column head
  setting every listed row, each change one undo step), the saved views and
  the active working plane;
  at its foot, the cursor's position, the Mode bar (the active tool, its
  modes, such as Dimension's linear, chain, baseline, ordinate, radial,
  diameter and angular, Offset by
  distance or through a point, Fillet and Chamfer alone, splitting or
  trimming the lines, Mirror and Rotate on a copy, Zoom In or Out, the
  Eyedropper's Pick Up and Put Down, Regular Polygon inscribed,
  circumscribed or by edge, Split by point or line or Line Trim and Connect/Combine's
  single, dual and combining modes, chosen by number keys, and the Selection tool's
  rectangle, polygon or lasso marquee and interactive scaling; its preferences, the step
  to take and its keys; when the canvas is too narrow for every mode, the
  tool shows its icon alone and each mode group drops its modes from one
  button) and the snap and grid toggles,
  whose ⋯ opens the Snapping palette, with the Notification Center's bell
  beside them: every alert of the session (notes and errors, each with its
  time), newest first, a count of those not yet seen (red when one is an
  error), and Clear All; Window > Notification Center opens it too. Panels stay configurable: drag a
  palette by its title to another place in a side panel, to the other side or
  out to float, or onto another palette's title to make it a tab there (drag
  the tab out to separate it); roll it up, close it, resize the side panels
  and split the height between palettes. As in Vectorworks, a docking guide
  shows while a palette is dragged: over a docked palette, squares put it
  above, below, as a tab, or in a new column to its left or right (the side
  panel widens by the palette's width, a blue band showing where; a handle
  between columns resizes them, and a column left empty goes, the panel
  narrowing again), and a square at each side of the drawing docks it at the
  end of that side's panel; Option or Ctrl held keeps it floating. Window shows each palette again
  (including Tools and Tool Sets, Vectorworks' grids of tool buttons), hides
  them all (⇧⌘P), rolls them up, toggles the View, Mode and Snapping bars and
  resets the arrangement, which is kept per browser. The bars over the drawing
  move and roll up too: drag a bar's grip (its dots) to put it anywhere over
  the drawing, click the grip to roll the bar up to its name (the Mode bar to
  its tool's icon), double-click it to put the bar back, or use the arrow keys
  on it; Window > Reset Bars puts them all back. Inside Object Info, Attributes
  and Visualization, a click on a section's heading folds the section to its
  heading (Option-click folds or opens every section of the palette), and
  it stays folded as the selection changes, kept per browser.
- **Menus**: File, Edit, View, Modify, Model, AEC, Tools, Text, Window and Help menus
  with the usual Vectorworks shortcuts. Tools > Organization… (⇧⌘O) lists
  the classes, design layers and sheet layers on three tabs, each a dense
  searchable table of visibility (a column head sets every listed row),
  name, a design layer's scale or a sheet's title and the object count, with
  New, Delete and the design layers' stacking order (Move Up, Move Down),
  and Edit… (or a double-click) for a class's line weight, line style, pen
  and fill colours, fill style and opacities, which objects using the class
  style draw with, its RenderWorks texture, which objects textured by
  class show in 3D, and its text style, which texts set to Class Text Style
  follow; a
  fourth tab lists every viewport with its sheet, kind, and name and scale
  to edit. Design layers also have their elevation and story there, and a
  Stories tab names, suffixes, raises, adds and deletes the stories (a
  story's layers move with its elevation) and its Levels… sets a story's
  levels (each a level type, an elevation above the story and the design
  layer at it, which sits at the story's elevation plus the level's; levels
  can be added and removed), as the Navigation palette's Stories tab does
  with its Edit…, where each story's layers and levels are listed under it. Nothing changes until OK, which applies it all as one undo step.
  A layer's objects rise and fall with its elevation. What Rodeo places on
  a design layer goes at its height above the layer plus the layer's
  elevation, as Vectorworks keeps it: a light, camera, extrude, imported
  model or symbol on the layer at its elevation and above, a new wall,
  slab, plug-in object or Heliodon as high above the layer as the one it
  copies is above its own, and objects pasted or moved to a layer at
  another elevation as high above it as they were above theirs.
  A fifth tab adds the current view, renames, deletes and reorders the saved
  views and sets which restore visibility; they are kept in the browser,
  outside the undo step. Object Info names any object (names are unique in
  a drawing; emptied, it has none). Tools >
  Find and Modify… finds objects with Custom Selection's criteria and
  changes every one found at once (class, fill or pen colour, line weight,
  opacity, the symbol shown or the layer), as one undo step. Tools >
  Utilities > Purge… removes symbol definitions placed nowhere (or only
  inside other unused ones), classes nothing uses (with those only the
  purged definitions used) and coincident duplicates (an unnamed object
  identical to an earlier one in the same layer or group), each kind with
  its count, as one undo step. A name a plug-in, worksheet or data
  visualization holds as text keeps its symbol or class, and so does any
  class a style might use. Utilities > Batch Rename… renames many
  classes, design layers, sheet layers (numbers or titles), stories or
  resources at once: find and replace, case, a prefix and suffix and a
  running number (before, after or instead of the name, as wide as the
  start is typed), previewed row by row with clashes marked, and applied
  to the ticked rows as one undo step; names can swap, and story levels
  follow their layers' new names. Utilities > Replace Font… swaps one font
  for another in every text object on the drawing's layers and every text
  style (the list shows what each font is used by), as one undo step.
  Utilities > Reset All Plug-Ins draws every plug-in object again from its
  parameters with its plug-in's current script (installed Vectorworks
  plug-ins and Hyperlinks; Vectorworks' own plug-ins stay as they were last
  drawn), then reports how many were reset, failed or left.
  Utilities > Change Symbol Attrs… puts the objects of the symbol
  definitions in a folder (with its subfolders), in no folder or in all of
  them in one class, taking the class's fill, pen colour, line style, line
  weight and opacity as chosen, the rest kept or set to the Attributes
  palette's for new objects; every instance follows, after a confirmation
  naming how many definitions change, as one undo step (a mesh's faces go
  with it). Utilities > Create Color Chart… draws the drawing's colour
  palette on the active layer as a grouped chart of swatches sixteen to a
  row, each palette index under its swatch when asked, sized on paper as
  text is, in one undo step. Utilities > List Symbols… saves a text file of
  the symbol folders, each with its definitions or the folders alone,
  indented a tab a level. Tools > Origin > Locate Internal Origin brings
  the window to the internal origin (0, 0) in Top/Plan, zoomed out as far as
  the drawing needs to stay in sight, and marks it for a few seconds; Center
  Drawing on Internal Origin… says how far the farthest object is from it and
  will be, then moves every object on the design layers, hidden ones too, so
  the drawing's middle is on it, in one undo step, the sheets' plan
  viewports going on showing the same parts and the window moving with it.
  It refuses, saying why, while the drawing has elevation, section or 3D
  viewports or design-layer viewports (how their views would follow isn't
  known) or objects that can't be moved yet; a user origin isn't read or
  kept, so coordinates change, and saved views stay where they were. Tools >
  Check File Health… runs the tests of Vectorworks' File Health Check that
  Rodeo can (objects far from the origin, outlying objects, polygons with
  many vertices, transparent symbols, groups of 3D polygons, hatch levels,
  texture sizes, the colour count, Class Options at Show Others), each at a
  limit kept in this browser, and lists what fails; the issues ticked are
  located, deleted or resolved (Simplify Polys on the polygons), and show as
  resolved when the dialog reopens. Tools > Compress Images… saves the
  selected bitmap images, or all of them, again as JPEGs to make the file
  smaller, leaving those that are JPEGs already, have clear parts or
  wouldn't get smaller. Text sets the selected text's font (the
  file's own, or a common one, added to the file's font list), size (Text >
  Size > Set Size… types any size in points), style
  (plain, bold, italic, underline), justification and vertical alignment,
  or a text style from the file (its font, size and alignment) or the
  one the text's class names (Class Text Style). Convert Text to Polylines
  turns each selected text into a group of filled polylines tracing its
  characters as the drawing shows them, Text Along Path… sets a single-line
  text's letters along a selected line, polyline, arc or circle (as they
  are, or stretched to the path's length; above or below it), grouped with
  the path, and Find-Replace Text finds the next text object, record field
  or worksheet cell holding a string (selecting and zooming to it, on its
  layer) or replaces it there, in the selected objects or everywhere, on the
  active, visible or every layer (case-sensitive, whole words), each replace
  one undo step, its settings kept. Check Spelling steps through the words a British
  or American English dictionary doesn't know, with suggestions, to ignore,
  change (here or everywhere) or add to the browser's own word list, and
  makes the changes as one undo step; Window > Workspaces saves the palette
  arrangement, the view panes and the Quick Preferences list under a name and switches between them, exports the current
  arrangement and tool and menu shortcuts as a workspace file and imports one (kept
  as a workspace and switched to), its Menus… rearranges the menu bar (new
  menus, names, order, commands or submenus moved between menus or taken
  out, still running from their shortcuts; workspaces keep it), its Tool
  Sets… rearranges the Tool Sets palette (new sets, names, order, which
  tools each holds; workspaces keep them), its Tool
  Shortcuts… sets the key of every tool (a letter, or Shift and a letter), and
  Menu Shortcuts… the combination of every menu command (pressed with ⌘, and ⇧
  or ⌥ if wanted; the menus, tooltips and Help > Keyboard Shortcuts follow it). Right-click the
  drawing for what applies to the selection (or, on empty space, paste,
  select, zoom and grid), a layer, class or viewport row for its own
  commands, or a palette's title to roll it up, close, dock, float or tab it
  (the Tools and Tool Sets palettes also offer Small Icons, Large Icons or
  Icons and Names there, and Resources small, medium or large thumbnails or
  a list). As in Vectorworks 2027, a tab of Object Info (Shape, Data,
  Render) or Navigation (Layers, Classes and the rest) dragged off its strip
  comes out as a palette of its own, to float or dock anywhere; tabs out of
  the same palette connect into one, and go back when dropped on it, closed,
  or docked back from its title bar menu ("Dock Data here", "Dock all tabs
  here"). A tab dragged along the strip moves along it, and "Lock tabs" in
  that menu holds them where they are; its Tab Style shows a palette's tabs
  as icons, names, or both (icons alone fit Navigation's six tabs in half
  the width). Vectorworks 2027's docking bars
  run along the drawing's top and bottom too: a palette dragged to that edge
  (or sent there from its title bar menu's Send to) stands in the bar beside
  the others there, the drawing making room. A handle between two palettes
  shares the width out, the bar's inner edge sets its height, and rolled up,
  the bar is just its palettes' titles. A palette that wide (or floating or
  docked wider than two columns of fields) lays its sections side by side,
  so Object Info or Visualization in a short bar shows what a sidebar
  stacks. Floating palettes dock to each other
  too: drag one over another and the docking guide's top or bottom square
  puts it above or below, the two then one floating card that moves by its
  top palette's title (Window > Palette Options > Floating Palettes Can Dock
  to Each Other turns this off). Along each dock's window edge runs a rail of icons, one per
  palette of that side, closed ones too (the left rail has Tools, Tool Sets,
  Navigation and Resources, which starts as a tab of Navigation; the right
  Object Info, Attributes, Snapping, Visualization and the cloud palettes): a
  click opens a closed palette, brings a rolled-up one or a tab behind another
  into view, or closes one in view, and a right-click offers its title bar's
  menu. A dot marks the open ones out of view. The rail's fold button, Window
  > Fold Left Dock and Fold Right Dock, or a double-click on a dock's inner
  edge or the rail's empty part fold a dock to its rail (36 px), so of a
  1440 × 900 window the drawing gets 1108 × 844 px as it starts (one
  sidebar), 864 × 844 with two sidebars open and 1352 × 844 with both
  folded; an icon then opens its
  palette beside the rail, over the drawing, until the next click elsewhere or
  Escape. Auto-hiding a dock (the pin on its rail, Window > Auto-Hide Left or
  Right Dock, or a title bar's menu) folds it the same way, but a palette
  slides out while the pointer rests on its icon and back once the pointer
  leaves it, so the drawing keeps the whole width until a palette is wanted.
  Window > Palette Options > Auto-Hide Docked Palettes does it to both docks
  at once, and Auto-Hide Floating Palettes rolls each floating palette up to
  its title bar while the pointer is elsewhere, unrolling it as the pointer
  comes back. Window > Palettes lists every palette by its Vectorworks name,
  each tab of Object Info, Navigation and Visualization too (Shape, Data,
  Render, Design Layers, Classes, Sheet Layers, Saved Views, Lights,
  Cameras…): choosing one brings it to the front, or closes it when it is in
  view, and a palette's title bar menu undocks any of its tabs into a
  floating palette of its own. Hide Enabled Palettes (⇧⌘P) puts them all
  away and back. Window > Palettes > Save Palette Positions keeps the
  arrangement in the saved workspace in use (with a built-in one, it asks for
  a new workspace's name), and Activate Object Info Palette (also in the
  drawing's right-click menu) brings Object Info up with its first field
  taking the keyboard. Window > View Bar Options shows the View bar in
  its regular size, compact (tighter, without the layer's scale) or
  auto-hidden (a short mark where it is till the pointer comes near), and
  Show View Bar Group Labels puts Layer, Class and Views captions in it.
  A dock with every palette closed is just its rail. Window > Use Full Screen
  gives the window the whole screen, without the browser's bars. Window > Compact
  Interface packs the top bar, palette titles, rows and fields as tightly as
  Vectorworks does, and Window > Workspaces > Dense arranges everything that
  way at once: compact rows, narrower docks, the menu bar's row of titles and
  the smaller palettes as tabs (Resources with Navigation; Attributes,
  Snapping and Visualization together with Object Info) for 1146 × 838 px
  (860 without the menu titles). Workspaces > Standard goes back to the one
  sidebar, Two Sidebars to Spline's two, and Classic puts the tools in the
  Tools and Tool Sets palettes down the left, as Vectorworks keeps them,
  instead of the top bar, with the menu titles over it. A right-click on the
  top bar (or Window > Top Bar) shows or hides its groups: the Menu Bar (File,
  Edit, View, Modify … Help in a row over the top bar, a press on a title
  dropping its menu and moving over the others while one is down switching to
  theirs, as a native menu bar does; never on a phone), 2D, 3D and Views,
  Tools, Undo and Redo, and Zoom; hiding the tools brings their palettes out.
  The Smart Options display (\` (backquote), a middle click that doesn't
  pan, or Window > Smart Options) brings the palettes to the cursor: a ring
  around the active tool whose segments open Tools (Basic and every tool
  set), Snaps (the Snapping palette's toggles), View (zoom, previous and
  next views, 3D, standard views, rendering and the grid) and Layers (the
  active layer and class) beside it, so the docks can stay folded or
  hidden. Choosing a tool or command closes it, as do Escape and a click
  elsewhere; arrow keys move between the segments.
  Screen tips, as Vectorworks shows them: rest the pointer on a tool for its
  name and key, the tool set it is in and how to use it (the Mode bar's
  help, with the keys it takes), or on a mode for its tool and group; along
  a row the next tip comes at once, and a press or a key puts it away.
  Window > View Panes (or the View bar's View panes pop-up, or View >
  Multiple View Panes) splits the
  drawing area into two, three or four panes, all drawn at once and kept up
  to date as the drawing is edited, each a plan or a 3D view. A new
  arrangement has the plan in the first and a 3D view in each of the others
  (Front, Right and an isometric view to start with). Two panes put the
  plan beside the 3D view or above it. With three or four, the plan's pane
  is the large one, on the left, the right, the top or below, and the small
  panes share the other side evenly; Four Panes alone are two by two.
  Split Horizontally and Split Vertically cut the active pane in two (the new
  half showing what it showed), Close Active View Pane gives its room to its
  neighbours, and Enable Multiple View Panes goes to one pane and back to the
  last arrangement of several. The
  menu pictures each arrangement. The active pane is ringed in the accent:
  the render mode, the zoom and Fit act on it, and Top/Plan, 3D View (the
  View bar's 2D and 3D) and the standard views turn it into a plan or a 3D
  view, so two plans can show the drawing at different zooms, or every
  pane a 3D view. A click in another pane makes that one active (the click
  does nothing else). The live plan, for drawing and editing, is in the
  plan pane last made active, and the live 3D view, for orbiting, picking
  and walking, in the 3D pane last made active; every other pane shows the
  drawing from its own view, kept as it was left and drawn again as the
  drawing or the look changes. Each 3D pane keeps its own render mode and
  projection: the View bar's Render mode and Projection set the live
  pane's, and the pane the live view moves to takes its own back (a new
  arrangement starts every pane in the one shown). A Realistic pane without
  the live 3D view shows the render feature's picture through its own
  camera, Shaded until that has loaded. A Path Traced one refines a
  path-traced picture of its own, a sample a frame up to the Render
  palette's preview samples (512 at most), on a renderer the panes share,
  so the live view isn't drawn again meanwhile; the panes refine one at a
  time, each showing a Realistic picture until its turn, and start over
  as their camera, size, the model or the settings change. The dividers drag (each
  pane keeps at least 15%), and a double-click on one shares the area
  evenly; the arrangement, what each pane shows included, is kept in this
  browser and with saved and exported workspaces. Single Pane goes back to
  the one view. View > Multiple View Panes > Create Floating View Pane opens
  another view of the drawing in a window of its own over the drawing area,
  showing what the active view shows (the plan, or the model from where the
  live 3D view looks). Its view button or right-click menu turns it into
  Top/Plan or any standard 3D view; a drag pans the plan or orbits the model
  (Shift- or middle-drag pans the model), the wheel zooms, and a
  double-click or Show in Main View gives its view to the live plan or 3D
  view. Its title bar moves it, its corner resizes it, and its buttons fit
  the drawing in it, roll it up and close it. The 3D ones are drawn in View
  > Rendering's mode (Path Traced as a still Realistic picture), and their
  model is kept up to date with the 3D view hidden. A Renderworks camera's
  right-click menu has Open Camera View in New Pane: a floating pane
  looking through the camera, its picture the camera's shape, in its
  projection, following the camera as it is moved or re-aimed until the
  pane's own view is turned. Nothing is drawn or
  picked in a floating pane; the panes close with their drawing and aren't
  saved.
- **Autosave**: while a drawing has unsaved changes, a copy is kept in the
  browser every 5 minutes (Edit > Preferences… sets how often, or turns it
  off) and offered back when openvwx starts after a crash or a closed tab.
  Drawings over 150 MB are not copied, since writing one out takes as much
  memory again.
- **Preferences** (Edit > Preferences…, ⌘,), in Vectorworks 2026's panes
  beside a list, kept in the browser: General (the interface theme, a black
  background), Edit (whether Duplicate offsets its copies a grid step or
  leaves them on the originals; whether the mouse wheel zooms or scrolls the
  drawing, Shift scrolling sideways and ⌘ or Ctrl zooming; a pinch always
  zooms), Display (zoomed line thickness; Show other objects while in
  editing modes, which while a group is edited draws the rest of the
  drawing grayed, or without it neither draws nor snaps to it), Session (tool help in the Mode
  bar), 3D (the 3D conversion resolution, how finely circles and ellipses in
  extrude and sweep profiles become faces, from Low to Very High; whether the
  3D view opens with the render mode and projection last used), Autosave, and
  Interactive (a full-screen cursor; the selection box, which sets how near a
  click picks, and the snap box, the snap radius, each shown at the pointer
  if wished; pre-selection highlighting, the Selection tool outlining what a
  click would pick once the pointer rests; animated view transitions, Fit,
  Zoom to Selection, saved views and Previous and Next View easing there over
  the time and with the motion chosen, any pan or zoom by hand stopping one),
  and Appearance, Vectorworks' Interactive Appearance Settings: the colours of
  the selection (its outline, handles and the tools' previews), pre-selection,
  the snap indicators (markers, their names, smart points and the snap box)
  and the cursor (crosshairs and the selection box, else dark on white and
  light on black), with Restore Defaults.
  The View bar's Quick Preferences pop-up lists the ones turned on and off
  most, each checked while on: at first Black Background, Zoom Line
  Thickness, Show Grid, Snap to Grid, Full-Screen Cursor, Offset Duplicates
  and Pre-selection Highlighting. Its Customize… picks from those, Snap to
  Objects, the selection and snap boxes, animated views, wheel zooming,
  showing other objects while editing, tool help, keeping the 3D render mode, autosave and Compact Interface, kept in
  the browser and with workspaces; Preferences… opens the dialog.
- **3D view** (View > 3D View, the 3D button or key 3; View > Standard Views,
  Rendering and Projection, or the View bar, pick the direction, Wireframe,
  Hidden Line, Dashed Hidden Line, Sketch (hidden line drawn as two pencil
  strokes per edge on paper), Shaded, Textured, Realistic or Path Traced
  (see Rendering), and Orthogonal or a perspective; Top/Plan goes back to
  the plan). The standard views are Top, Bottom, Front, Back, Left, Right
  and the eight isometrics (Right, Left, Right Rear and Left Rear, from
  above or, as the Lower ones, from below). Projection's Narrow, Normal and
  Wide Perspective see 20°, 35° and 60° from the picture's top to its bottom,
  and Set Custom Perspective… takes any angle from 5° to 120°; the camera
  stands nearer or further back so the model keeps its size. Two-Point
  Perspective keeps the eye level, so uprights stay upright as the view
  turns. The Oblique projections (Cavalier and Cabinet, at 45° or 30°)
  keep the front true and draw depth slantwise, full length or half.
  Projection's 2D Plan goes back to the plan, and a 3D projection picked
  from the plan opens the 3D view in it.
  View > Rotate Plan turns the plan on screen and leaves the drawing where it
  is: click the center, then click along the line that will lie level (Shift
  for 15° steps), or type an angle in the View bar's field beside its button.
  Rotated Top/Plan (⌘5) and Standard Views swap between it and the true
  Top/Plan. The grid, rulers, snap to grid, Shift angles, marquee, selection
  handles and arrow keys go with the view; Rectangle, Rounded Rectangle, Oval,
  Text, Symbol and the part-placing tools lay theirs square to the screen,
  the rest lie square to the drawing. The rotation lasts for the session and
  isn't saved in the file; saved views, the data bar and Object Info, exports
  and prints keep to the drawing's own axes, and sheet layers and symbol
  editing show unrotated.
  View > Rendering > Shaded Options… (also at the foot of the View bar's
  Render mode pop-up) sets whether Shaded draws textures and colours (off:
  white faces), draws the edges, casts shadows (the Visualization palette's
  switch) on the objects or on the ground under the model only, and how
  sharp they are (Low to Very High shadow maps); Line Render Options… gives
  Dashed Hidden Line one of the document's dash styles, at the active
  layer's scale, and the hidden edges' shade, from the edges' grey to white.
  View > Rotate 3D View… turns the view by typed angles about the screen's
  horizontal, its upright and the drawing's z axis. View > Set 3D View… looks
  from a typed viewer position to a typed look-to point (x, y and a height
  above the active layer's elevation), opening the 3D view from the plan;
  its fields start at the camera, or from the plan at eye height at the
  window's foot looking to its middle. The active design layer's
  saved view opens with the drawing: a layer saved in a perspective, an
  isometric or an elevation shows it, with its render mode, the first time
  the 3D view is shown, and saving stores the 3D view's camera, projection
  and render mode on the active layer (or Top/Plan, when the plan is
  showing). The 3D view shows the visible design
  layers as a shaded model at their elevations: walls, slabs, roofs,
  extrudes and other solids rebuilt from their cached edges, extrudes saved
  without one (most plug-in objects' parts) swept from their profile, holes
  included, multiple extrudes saved without one lofted through their
  profiles, solids Rodeo makes drawn from their operands (a subtraction
  cut), symbols, plug-in objects' parts placed where the plug-in is
  (doors and windows in their walls), 3D
  polygons, meshes and the site model's terrain, with RenderWorks textures
  (image textures mapped at their real size, others shown in their preview's
  colour; "by class" textures come from the class; untextured faces take
  their fill colour as the plan paints it). Orbit, pan and zoom to the cursor; click a face to select its
  object. Large models (3–4 million triangles) build in a few seconds.
  Double-click a point to orbit about it; with the view focused, W A S D or
  the arrows walk through the model and Q and E go down and up (Shift goes
  faster). The Onscreen View Control, a cube in a corner of the drawing
  (View > Onscreen View Control), turns as the view does: click a face, edge
  or corner for that view (the one shown already goes to the opposite one),
  drag it to turn the 3D view, or scroll over it to zoom; the 2D/3D toggle on
  its Top face goes to Top/Plan or back to the 3D view, and its menu button (or the View
  menu) shows or hides it, its axes and its cube and moves it to any corner.
  With several view panes it sits in the active pane's corner. The Visualization palette (Window > Palettes), in Lights and Cameras tabs, sets the projection,
  the sun (a headlight with the view, or a Heliodon sun for a latitude, date,
  solar time and north, with shadows), the ambient light, and a clip cube
  (also View > Clip Cube) that cuts the model to X, Y and Z ranges. These
  belong to the window, not the file. Its Cameras list holds the drawing's
  Renderworks cameras, on design layers or belonging to sheet viewports;
  clicking one opens the 3D view through it, from its eye to its look-to
  point with its view angle (or orthogonal, as the camera is set). Orbiting
  then turns about the look-to point; a standard view or fit goes back to
  the usual lens. With the 3D view open, a camera's Match View button points
  it the way the view looks, from the view's eye toward the point it orbits
  (its lens stays), one undo step, and moves carry a camera's eye and
  look-to point with it. Its Lights list holds the drawing's light objects (point,
  spot and directional, in light-fixture symbols too, a Heliodon's sun left
  to the Lighting settings) with their colour and brightness; clicking one
  selects what holds it. They light the 3D view, spots in their cones, the
  16 nearest where the view looks (chosen again as it settles), unless
  "Light the model with them" is off. A light the drawing places itself
  turns on and off from its row. Selected, a light shows a Light section in
  Object Info: on, kind (directional, point or spot), brightness, colour,
  where it is (X, Y and Z, on its layer, Z above it, or in its symbol), where it shines (a
  spot's pan, clockwise from north, and tilt below level; a directional
  light's azimuth and elevation, where it comes from, as the sun's) and a
  spot's spread and beam, each change one undo step; a spot's or directional
  light's Set Light to View aims it the way the view looks, and Set View to
  Light turns the 3D view to look the way it shines (both on its right-click
  menu too, with Turn On or Turn Off). Moves (Move, nudges,
  Move 3D) and Duplicate take light objects too. A light-fixture symbol's lights change in
  Edit Symbol, for every instance, and a plug-in's are redrawn from its
  parameters, so they don't change on their own. While the sun casts
  shadows, so do the 2 spots, the point light and the directional light
  nearest where the view looks, their shadows drawn again only when the
  model, the layers shown, the render mode or the clip cube change.
  View > Set Sun Position… adds sunlight as a directional light: give the
  site's latitude and longitude, its time zone, page north (counter-clockwise),
  the date, the clock time and daylight saving, and it shows the sun's azimuth
  from south and from north, its elevation and the true solar time as you
  type. OK aims the selected directional lights at the sun, or adds one at the
  view's centre (copying a light the drawing has); a sun below the horizon is
  refused.
  View > Set Lighting Options… sets, in Vectorworks' groups, the path
  tracer's indirect lighting (None, 2, 3, 4 or 16 bounces after the first
  hit), the Shaded view's ambient light (on or off, its brightness with 35 %
  as the usual), the Realistic engine's ambient occlusion (on or off, its
  strength) and every light object's emitter brightness; they are the same
  settings the Visualization and Render palettes show, kept on this machine.
  View > Renderworks Style (and the View bar's Render mode pop-up) applies
  one of Vectorworks' default styles by name: Preview, Realistic Fast or
  Final, Exterior, Interior or Exterior Night, or Render Style White Model.
  Each sets the render mode (Realistic, or Path Traced for Final) and the
  Render palette's sky, sun, light objects, exposure, effects, bounces and
  clay look at once; it stays checked until one of those changes.
  Vectorworks doesn't publish its library styles' settings, so these are
  Rodeo's readings of their names; the file's own styles aren't read.
  The Working Planes palette (Window > Palettes, or the View bar's
  Active Plane pop-up) sets a working plane on a face: Set on Face, then
  click one in the 3D view. The plane lies on it, its x along the world's
  as near as the face allows, and the 3D view draws its grid there with
  red and green x and y axes. Save keeps it, by name, with the drawing's
  file name in this browser (double-click a row to rename it, × deletes
  it); clicking a row makes it active, Layer Plane goes back to none, and
  Look At turns the 3D view square onto it. The palette shows the active
  plane's origin and whether it is level, upright (with its bearing) or
  tilted. Modify > Working Plane has Vectorworks' commands: Set Working
  Plane, Look at Working Plane, Save Working Plane…, Previous and Next
  Working Plane (the last ten made active), Align Working Plane with
  Current View (its z toward the viewer), with Layer Plane and its X Axis
  with Layer Plane, and Rotate About X', Y' or Z' Left or Right 90° and
  Flip X', Y' or Z' (Left is counter-clockwise looking from the axis's
  positive end), the origin kept; a plane changed so is unsaved until
  saved. The 2D tools still draw on the layer plane, and the planes a
  drawing saves aren't read yet.
- **Rendering**: the 3D view's Realistic mode draws the model each frame in
  physically based materials, lit by the Heliodon's sun (with soft shadows)
  and the sky, with ambient occlusion, bloom, fog and a filmic finish; Path
  Traced shows that while the view moves and, once it rests, refines a
  path-traced picture (light bouncing between surfaces, glass, mirrors,
  the light objects) up to the preview's samples, denoised while it has few.
  The path tracer builds its scene off the page's thread. The Render palette
  (View > Render Settings) sets the sky (physical for the sun, a gradient, a
  solid colour or a studio), its haze and intensity, a ground plane under a
  model that stands on level ground (a sloping site model is its own
  ground), the sun's date, time, intensity and softness, the light objects'
  intensity, exposure and tone (AgX, ACES Filmic or Neutral), fog (how far
  it hides, how it thins going up, its glow toward the sun), two-point
  perspective and depth of field, each material's finish (Auto guesses one
  from its texture's name and colour: wood, glass, metal, foliage and so on,
  each with its roughness, metalness, transmission, glow and tint to
  change), the effects (ambient occlusion, bloom, vignette, contrast,
  saturation) and the quality (preview samples, bounces, denoise). Its
  Cameras list looks through the drawing's cameras. The settings belong to
  the drawing on this machine, not the file. File > Export > Render Image…
  renders the current view, one camera or all of them, at HD, QHD, 4K UHD,
  4K DCI, square, A4 at 300 dpi, the camera's shape or any size up to
  8192 px a side, with the Realistic engine (a 4K picture in a second) or
  path traced (64 to 4096 samples, with a time limit and denoise), as PNG
  or JPEG, with its progress, Finish now and Cancel, then shows the pictures
  to save or copy. View > Rendering > Create Batch Render Job… keeps those
  choices under a name, with the 3D view's view as it is then, and Start
  Batch Render… renders the jobs chosen, in the order chosen, and downloads
  their pictures as one zip of a folder named for the date and time (Esc
  drops the job in hand and goes on; Duplicate, Edit and Delete manage the
  jobs, which are kept for the file on this machine, not in it). File >
  Export > Export HDRI… asks the same as Render Image (no format or cloud)
  and saves each picture as a Radiance .hdr file, linear and unclipped:
  fog, exposure and white balance applied, tone mapping and grading left to
  the imaging program (several cameras' in one zip; up to 16.8 megapixels).
  File > Export > Export Panorama… makes a 360° picture
  from the 3D view's eye (Shaded, Realistic or Path Traced, up to 8192 ×
  4096) and saves it as a .jpg or as one .html page, the picture inside it,
  to look around in by dragging, the wheel or a pinch. Model > Create
  Animation records a movie of the 3D view: orbiting a centre (the layer
  plane, the working plane or the selection, in perspective or orthogonal),
  spinning round the selection, or walking along a selected line, arc,
  polyline or polygon, at 24 to 60 fps up to 4K, saved as an .mp4 (or a
  .webm where the browser can't make one). No animation path is kept in the
  drawing.
- **Sheets**: View > Create Viewport… makes a plan viewport on a sheet, of the
  design layers and at the scale chosen, in blank drawings too. Plan viewports
  draw the design layers they list, live (edits
  on a design layer show on every sheet), with the viewport's class overrides
  and grayed layers; section, elevation and detail viewports draw their cached
  drawings, with a cached Renderworks render under their line work. Both are placed at the viewport's scale and rotation and cropped as
  on the sheet, with their annotations (dimensions, tags, grid bubbles) where
  Vectorworks puts them; edges Vectorworks hides and crop objects (often
  filled white) are left out, and drawings are cropped to the crop object's
  shape (polygons, rounded rectangles), annotations to the box. Click a
  viewport's drawing to select the viewport and drag to move it, drawing,
  annotations and all. Object Info edits a viewport's scale (the drawing and
  its annotations rescale about the box's centre), its crop edges, which
  design layers it shows and their visibility, and its class overrides. PDF
  and SVG exports of a sheet include its plan drawings, cropped to their
  viewports.
  Edit Annotations (right-click a viewport, or double-click it) opens its
  annotations as the active layer at the viewport's scale, over what it
  shows; every tool draws and snaps there, the viewport's drawing included,
  and Exit Viewport Annotation goes back to the sheet.
- **Data visualisation**: a plan viewport applies the data visualisations it
  lists, redrawing the objects that match their criteria (plug-in type, layer,
  class, story, object type for slabs) with the fill and pen of their value: for every object, by class or
  by object style or by material (wall cabinets dashed with no fill, floor
  slabs hatched by finish, shading devices in a highlight colour, framing
  hidden on a ceiling plan, lower floors greyed on a roof plan, steel columns
  black). Section, elevation and detail viewports apply theirs to the drawing
  they cache, piece by piece by class and material (cut framing greyed under
  its batt insulation on a wall section). Fills can be none, solid, a pattern
  or a hatch; pens none, solid or a line type. Exports show them too.
- **Worksheets**: schedules placed on sheets (door, window and steel
  schedules, drawing lists) are drawn from their cached cell values: database
  rows expanded and sorted, merged cells, fills, bold headers, and dimensions,
  areas and counts formatted as the worksheet says. They can be moved, and
  their text and number cells edited in a grid (Tools > Reports > Edit
  Worksheet…, a worksheet's Resources tile, or a double-click on it on a
  sheet), the changes going in together as one undo step. Formula cells and
  database rows show their last results, read-only. Tools > Reports > Create
  Report… makes a new worksheet listing objects (the selection, the active
  layer, the visible or all design layers, optionally only those meeting
  Custom Selection's criteria) with the columns chosen: type, name, class,
  layer, area, perimeter, length and their record and plug-in fields, sorted
  and optionally summarized with counts and sums. It holds the values as they
  are now (formulas can't be written yet) and is made from a worksheet the
  drawing has, so a drawing with none can't have one yet.
- **Fills**: hatches are drawn from the file's hatch definitions in their own
  ground and line colours, laid from each object's fill mapping and clipped to
  the shape; world-sized ones shrink with a viewport's scale, paper-sized ones
  (the wall component hatches: concrete, insulation, gypsum) keep their size
  on the sheet. PDF export fills them with their ground. Tiles are drawn from
  their motif (in the pen colour), laid and sized by each object's fill
  mapping (a batt's loops fill the insulation's depth), else at world size; gradients as colour ramps
  laid out by each object's own mapping (direction, linear or radial), with
  their stops' opacity and midpoints. Bitmap patterns whose bits are known
  (the 2026 wall lattice) draw as 8×8 bitmaps in the fill's two colours, one bit
  to a screen pixel, and export to PDF as the colours' mix; the rest draw solid.
- **Plug-in objects** (doors, windows, title blocks, spaces, grids, plants…)
  draw their cached 2D geometry placed by their own matrix, and can be moved.
  As in Top/Plan, one that has a 2D drawing shows only that, not its 3D parts
  (a cabinet's footprint, not its panels, nor the hinge markers doors keep
  on their leaves for elevations); 3D solids elsewhere draw as
  wireframe (an extrude's profile placed by the extrude's own frame, where its
  body starts; a 3D polygon as its outline seen from above), and open polygons
  and polylines with a fill are filled. File > Title Block Manager… edits the
  title blocks' data: project data on all of them, sheet data on the sheets
  ticked (several at once, differing values shown as Varies). Their drawn text
  follows where it shows a value exactly, and Sheet Number and Sheet Title
  rename the sheet, all in one undo step; revision data isn't edited yet.
  Object Info lists a plug-in's parameters and any data records attached to
  an object (text, numbers, dimensions, choices, checkboxes) and edits them.
  Its Data tab attaches a record of any of the document's data record formats
  (holding the format's default values) and detaches one; Tools > Records >
  Attach Record… attaches one to every selected object without it, in one
  undo step, and Detach Record… takes a format's records off them; Change
  One Field… and Change All Fields… set a record's values on the symbol
  definitions in a symbol folder, at the top level or everywhere, which
  symbols placed afterwards start with. Merge Record Formats… puts one
  format's fields on the end of another's, the objects' values going with
  them, and deletes the first; Split Record Format… moves the fields ticked
  to a new format, every object with the source format's record gaining
  one of the new format with its values. Modify by Record… reads a
  field's number on each object (across the drawing or the selection, in
  groups if asked) and colours the objects by it (along a gradient, by
  ranges or by value, on the fill's or pen's colours), scales them by it,
  extrudes them that high or raises polygons to 3D polygons at it, in one
  undo step. Tools > Records
  makes new data record formats and edits them (also from a format's
  Resources tile): fields of text, integers, numbers, dimensions and
  checkboxes with their defaults, added, renamed, moved and removed, the
  objects' records keeping their values in the fields kept. Its Render
  tab lists an object's texture parts (the whole object, and by number the
  further parts walls, slabs, solids and some plug-ins hold) and sets
  each one's texture (none, the class's or one of the drawing's) and its
  offset, scale and rotation; a 3D object without parts takes a texture on
  the whole of it. Right-clicking a part's heading there, or a textured
  object in the drawing (every textured part of it), gives Rotate Texture by
  90°, Reset to Default Mapping (no offset, scale 1, no rotation) and Remove
  Texture Override (None; from the drawing, the whole object's texture
  only), each one undo step; the heading's menu also folds or opens every
  part (Expand All, Collapse All).
- **Class Style**: objects take their fill, pen colour, line style, weight and
  opacity from their class where the file says so (teal grid lines and
  bubbles, white counter tops, tag fills), and Object Info's "From class"
  ticks switch each one. A hidden or grayed class hides or grays everything
  inside a plug-in or symbol of that class; a group's or wall's contents keep
  to their own classes, and None-class geometry inside a symbol or plug-in
  follows its container. Pens set to None or weight
  0 draw no outline, as Vectorworks prints them. Rounded rectangles draw, and
  text inside plug-ins (tags on turned objects) reads the right way up.
- **Layers**: create design and sheet layers, rename, set sheet titles,
  visibility (visible / grayed / hidden), scale, drag to reorder, delete.
  Layer options, as Vectorworks has them: Active Only, Gray Others,
  Gray/Snap Others, Show Others, Show/Snap Others and Show/Snap/Modify Others
  (only the /Snap ones let the pointer snap to other layers, only the last
  select on them), in View > Layer Options, the View bar, the Navigation
  palette and the drawing's right-click menu, keyed ⌥⌘3 to ⌥⌘8.
- **Classes**: create, rename, delete (objects move to "None"), visibility,
  and the same class options (View > Class Options, keyed ⇧⌥⌘3 to ⇧⌥⌘8).
- **Hiding objects** (View menu): Hide Selected Objects, Show Selected
  Objects Only, Unhide Objects, and Object Visibility… (show, show only or
  hide the objects meeting criteria, as Custom Selection sets them). Hidden
  objects aren't drawn, selected or snapped to, in plan, 3D or viewports,
  nor exported or printed, until Unhide Objects or the button the drawing
  shows; they stay hidden while the drawing is open, not in the saved file.
- **Saved views**: save the zoom, active layer and class, layer/class options
  and visibilities; restore them per file. View > Save View… names the
  current view and whether opening it restores layer and class visibility.
- **Objects**: click any object on a visible layer to select it (its layer
  becomes active), shift-click, select with a box (dragged rightwards for
  what is inside, leftwards for what it touches), a polygon clicked point by
  point or a freehand lasso (what is inside, or with Option what it touches;
  the Selection tool's Marquee modes), move by dragging or arrow keys,
  scale by the eight handles round the selection (Interactive Scaling: a
  single object, or several together; Shift keeps the proportions),
  reshape by dragging grips (line ends, polygon/polyline vertices, rectangle
  corners, circle centre and radius; a curved polyline's grips are its own
  vertices, so its curves survive), duplicate, delete, change class, layer
  and attributes, and edit text and coordinates in Object Info. For a
  polygon or polyline Object Info steps through the vertices (◀ ▶; the one
  shown is filled on the drawing, and a right-click on a vertex offers Select
  Vertex in Object Info Palette to step to it) to type each one's position, a polyline
  vertex's type and an arc vertex's radius, add or delete one, and open or
  close the outline (a polyline's hidden edges are drawn again once it is
  edited). Walls move, turn, mirror and duplicate too (dragging, arrow
  keys, Move, Move 3D, Rotate, Flip, Duplicate), with their plan drawing,
  their 3D and the doors and windows in them, and Object Info shows a
  selected wall's style, thickness, height (its bottom and top), length and
  the ends of its control line, and sets them. Its Style offers each style
  and thickness the drawing has a plain wall in: choosing one puts a copy of
  that wall on the same control line, at the wall's own heights, in its
  class and place, its corners mitred again to the new faces, its ends cut
  along a face kept, and walls teeing into it slid onto its new faces, as
  far into it for its width as they went into the old (a
  wall holding doors or windows can't change style yet). A wall dragged, nudged,
  moved, turned or flipped takes a wall mitred to it at a corner of two
  along (its end follows, and the corners are mitred again), and a wall
  meeting its side at a tee (its end slides along its own line, as deep in
  it as it was); a copy made in place on a wall takes none along. Plug-in
  objects (doors, windows, furniture, tags, cameras) turn, mirror and
  duplicate, a camera keeping its view (cameras and Heliodons don't mirror),
  and so do walls holding them. Slabs and roof faces move, lift, turn,
  mirror and duplicate the same way, with their outline, components and 3D,
  and Object Info shows their style and thickness. Walls, slabs, plug-in objects
  and lights cut, copy and paste within their drawing (onto another design
  layer as high above it as they were, not onto sheets), and plug-in objects
  and lights go into symbols; another drawing doesn't take them yet, as they
  name its resources in ways not all known.
- **Reshape tool** (⇧V, under Selection): reshapes the selected lines,
  polygons and polylines. Move Vertices picks vertices with a box or clicks
  (Shift adds), across several objects at once, and dragging a picked one
  moves them all; Delete removes the picked ones. Move Edge drags an edge
  with both its vertices. Change Vertex makes a vertex a corner, Bezier or
  arc vertex (a polygon becomes a polyline), Add Vertex drags a new one of
  that type out of an edge's midpoint, and Delete Vertex clicks them away.
  Each change is one undo step.
- **Text**: the Text tool places text justified left, centre or right (keys
  1–3) and aligned top, top baseline, centre, bottom baseline or bottom on
  the point clicked (the Mode bar's modes); rotated and justified text is
  drawn as Vectorworks lays it out, in its own font, bold, italic or
  underlined (a narrow font this machine lacks is drawn squeezed to its width);
  Object Info edits the content, text style, font, bold, italic, underline,
  size (pt), rotation, justification and vertical alignment. Text > Format
  Text… sets the font, any size in points, bold, italic, underline,
  justification and vertical alignment of every selected text at once,
  showing Mixed where they differ and changing only what is changed, in one
  undo step. Text > Capitalization makes the selected texts UPPER CASE,
  lower case or Title Caps, in one undo step. Rotate and mirror turn text
  (mirrored text stays readable).
- **Modify**: cut, copy, paste and paste in place (also between files, through
  the system clipboard), group and ungroup, send to front/back and
  forward/backward, rotate 90° and flip, align and distribute (Align to Grid
  puts each selected object's upper-left corner on the nearest point of the
  snap grid, in one undo step; Modify > Align > Align/Distribute… aligns or
  distributes across and up the window at once, by edges, centres,
  insertion points or equal gaps, a selected locus or the object
  right-clicked staying put; Align/Distribute 3D… does so along X, Y and Z
  for the objects that show in 3D, on the layer plane's axes or the working
  plane's; Align/Distribute Leader Lines… lines up the shoulder points or the
  label points of the selected callouts and leader lines on a reference line
  drawn next, every label under the topmost's when both are ticked, and
  turns their target lines parallel to the topmost's or spaces their shoulder
  lines evenly, the callout's note going with its label point), scale and move
  by typed values (Modify > Move 3D… raises or lowers 3D objects too), and
  rotate by a typed angle (Modify > Rotate…). Rotate Each Left 90° and Rotate
  Each Right 90° turn each selected object a quarter about the centre of its
  own bounds instead, so each stays where it was. Modify > Unrotate 3D
  Objects (⇧⌘0) turns the selected extrudes, sweeps, multiple extrudes and
  solids back to the layer's axes, however they were turned in plan or in
  3D, each about the middle of its 3D box, and symbols holding 3D about their
  insertion point, in one undo step; mirrored or stretched ones stay as they
  are, and objects inside selected groups aren't reached. Modify > Rotate
  3D… turns the selection by a typed angle about the X, Y or Z axis of the
  layer plane or the working plane, through the working plane's centre, the
  middle of the selection's 3D box or a clicked point: about the layer's Z
  axis everything turns, about any other only 3D objects do. Rotated rectangles stay rectangles, and rounded ones keep their corners,
  stretched with the sides they lie along when they scale. 3D objects (extrudes,
  sweeps, solids, 3D polygons and meshes) move, rotate, mirror, duplicate and
  copy like 2D ones, a pasted one keeping its textures and material where the
  drawing has them by name. Extrudes and multiple extrudes scale in plan too: the
  profiles take the scale in the extrude's own plane and the height stays,
  as a 3D polygon's does (not yet extrudes tilted against the scale), and
  sweeps turning about an upright axis scale evenly in plan; solids don't
  scale yet.
- **Surfaces**: Add, Clip and Intersect Surface on closed shapes (rectangles,
  polygons, closed polylines, circles and ellipses). A result with holes is
  one polygon with the holes joined in by a zero-width cut, since polygons
  here have no holes of their own. Combine into Surface adds a polygon of the
  area the selected lines, arcs and outlines enclose together (crossings
  found, loose ends ignored; one for each separate set), keeping the pieces.
- **Join** (Modify menu, ⌘J; Join (No Trim), ⇧⌘J): two lines, or two
  straight walls, meet where their lines cross. Lines are extended, or cut
  back by their shorter part (No Trim only extends); walls meet in a mitred
  corner, or with No Trim in a tee where one runs past the other.
- **Join and Fillet** (Modify > Join, ⌥⌘J): four lines making two double
  lines are joined in an L or a T with rounded corners at the Fillet tool's
  radius (asked for the first time when the Fillet tool hasn't set one). An
  L's inner lines round at the radius and its outer ones a width further
  out, about one centre; in a T the line that ends rounds into the near line
  of the other, which opens between the fillets. Crossing double lines, and
  a radius too big for the lines, are refused.
- **Hatch…** (Modify menu): fills one closed object with one of the
  drawing's hatches as plain lines. Pick the hatch from a list with its
  preview, click where it starts, then click again to turn it (Shift holds
  15° steps); the lines, cut to the outline and to their dashes, come as a
  group just above the object, in each line family's colour and weight. It
  is drawn once, not tied to the object (Vectorworks' non-associative
  hatch); a hatch sized on the page is drawn at the layer's scale. Hatches
  needing more than 20,000 lines in the object are refused.
- **Compose, Decompose, Convert, Smoothing**: join lines, polylines and arcs
  that meet end to end into a polyline (or a polygon when the chain closes),
  break shapes into their edges, turn rectangles, polylines and arcs into
  polygons, or turn them and polygons into the lines of their outlines
  (Convert to Lines; arcs and circles sampled; Convert Copy to Polygons and
  Convert Copy to Lines leave the originals and convert copies of them,
  just above), or turn rectangles, polygons, circles, circular arcs and
  rounded rectangles into polylines that trace them exactly, their corners
  and curves editable vertices (Convert to Polylines; a circle becomes four
  arc vertices round its square, an arc runs through its middle; ellipses
  and elliptical corners stay, as a polyline's arcs can't trace them), or
  turn lines into linear dimensions measuring them and circular arcs into
  angular dimensions of the angle they span, in place (Convert Object to
  Dimension), or turn symbols into groups of
  their contents, placed, turned, scaled and raised as the symbol was, and plug-in
  objects into groups of their drawing as it shows: in the plug-in's class,
  with its shadow and opacity, its text the right way up, its 3D parts
  placed and raised as the plug-in placed them (Convert to Group, ⌘K; plug-in
  objects inside either stay plug-ins, placed with the rest; not yet plug-ins
  whose 3D is a body or terrain of their own, such as site models, or symbols and plug-ins tilted or
  stretched in 3D that hold 3D objects). Convert to 3D Polygons turns 3D objects, symbols and plug-in objects
  into groups of closed 3D polygons, one per flat face they show in 3D (the
  triangles of each face merged; a face with a hole stays as its triangles),
  each drawn as the part it came from; it needs a 3D polygon in the drawing
  to copy settings from. Convert to Mesh turns each into one mesh of those
  faces sharing their corners (cut into convex faces of at most ten corners,
  as the demo files' are), each face drawn as the part it came from and the
  object's texture on the whole mesh; it needs a mesh in the drawing to copy
  settings from. Simplify Mesh… draws the selected meshes (and those in
  selected groups, plug-in objects and symbols) with fewer faces, collapsing
  edges by least change of shape at the Quality set, with Preview giving the
  number of faces; borders, creases and a UV map's seams keep their place and
  the texture stays put. Replace with Symbol… turns the selected objects into
  instances of a symbol chosen from the drawing's definitions: a locus's on
  its point, a symbol keeping its placement, anything else on the centre of
  its bounds, each in the object's layer and class, with the objects' data
  records kept or dropped and the definition's records added or not; it asks
  to confirm, is one undo step and needs a symbol in the drawing to copy
  settings from. Poly Smoothing makes every vertex
  of the selected polygons and polylines a corner, a bezier control point, a
  cubic spline point (Cubic Spline Smoothing: a curve through every vertex) or
  an arc as large as fits, from a polyline's own vertices rather than its
  drawn curve; Radius Smoothing rounds the corners as Arc Smoothing does,
  with a radius vertex on each curve. Drafting Aids > Simplify Polys… takes corner vertices from
  the selected polygons, polylines and 3D polygons, by maximum deviation (the
  outline stays within it of where it was; 0 takes collinear vertices) or
  minimum distance (those at or within it of a neighbour go; 0 takes
  coincident ones); start and end vertices, a polyline's curves and the
  corners beside them stay, each object keeps its id, class and records, and
  a toast says how many went. One undo step. AEC > Terrain > Simplify 3D
  Polygons… does the same by deviation to copies of the selected 3D
  polygons, put on the layer chosen, leaving the originals as they are, and
  Validate 3D Data checks selected 3D polygons as site model source data
  (copies, polygons of under 2 points, points repeated in a row, points
  one above another or in several places), with buttons to correct or
  select each.
  AEC > Survey Input > 2D Polys to 3D Source Data… makes contours drawn as
  polygons, polylines, lines, rectangles, arcs, circles or ellipses into 3D
  polygons at their elevations: a start elevation and interval, then Set
  Elevation steps through them from the backmost (Up and Dn by the
  interval, or the same height as the last), and the originals are
  deleted or kept; one undo step.
  Arc into Segments… draws the
  selected arcs, circles and ovals again as straight segments of equal length
  along them, by their number or the longest one may be, as a polygon or a
  line per segment, leaving the arcs; Line into Segments… divides the selected
  lines into equal segments, placing loci between them, breaking the line, or
  both, and keeps the line or not; Even Divide… splits the selected lines,
  arcs and circles into equal lines or arcs, and rectangles into a grid of
  equal rectangles (a turned one's turned with it), keeping the original or
  not. What they make takes the object's class and attributes and is left
  selected. Create Dividing Lines…, with two lines selected, takes a click
  where new lines start and one where they end, then a number of divisions,
  and divides the space between the two evenly: out from where they cross,
  or alongside them when parallel (loci when both clicks are on one guide). Attributes > Make All Attributes by Class
  gives the selected objects every attribute group from their classes, Remove
  by Class Settings keeps what each draws with as its own, Set Default
  Attributes saves a default set (the one selected object's attributes,
  which new objects are then drawn with, or with nothing selected what the
  Attributes palette sets for new objects) and Use Default Attributes gives
  the selected objects that set or puts the palette back to it; the set is
  kept while the drawing is open. The Attributes palette's title bar menu has
  the same four. Guides > Make Guide puts the selected objects in the
  class Guides (made when the drawing has none); Show Guides and Hide Guides
  set its visibility, Select Guides selects the guides on the active layer,
  and Delete All Guides deletes every one.
- **Model menu**: Extrude… (⌘E) turns the selected rectangles, rounded
  rectangles, polygons, polylines, circles and ellipses into extrudes of the
  height given (in the document's units), standing on their layer, each
  holding its shape as its profile with the shape's class, attributes and
  material, and no texture. It needs an extrude in the drawing to copy
  settings from. New extrudes are saved without a cached body, as
  Vectorworks saves the parts of most plug-in objects; whether Vectorworks
  rebuilds one on opening isn't confirmed. Multiple Extrude… (⌥⌘E) makes one
  multiple extrude of the height given through two or more of those shapes
  on one layer or group, the backmost at the bottom and the frontmost at the
  top (more evenly between), taking the backmost's class, attributes and
  material; it too copies settings from an extrude and has no cached body.
  Tapered Extrude… (⌥⌘U) asks for a height and a taper angle and replaces
  each of those shapes by a mesh whose sides lean in by the angle (out when
  it is negative), its top the profile moved in by the height times the
  angle's tangent; a taper that closes a profile up before the top is
  refused. Vectorworks makes an editable Tapered Extrude plug-in object.
  Extrude Along Path… (⌥⌘X) takes two objects, a closed shape as the
  profile and a line, arc, polygon, polyline or 3D polygon as the path,
  and replaces them by a mesh of the profile swept along the path, centred
  on it and square to it, mitred at the corners, optionally growing evenly
  to a scale factor at the path's end; Lock Profile Plane keeps the
  profile upright. Vectorworks makes an editable Extrude Along Path object.
  Sweep… stands each of those shapes up on its layer and turns it about the
  upright through its left edge, through the arc given in segments of the
  angle given; it copies settings from an extrude and has no cached body,
  as Vectorworks saves some sweeps. The 3D view draws every sweep turned
  from its profile, about the 2D locus it holds where it has one. Top/Plan shows a standing sweep's profile edge-on, as
  it does a standing extrude's.
  Add Solids and Subtract Solids turn two or more selected extrudes,
  multiple extrudes, sweeps and solids on one layer or group into one solid
  that adds them, or takes the others from the backmost; the 3D view draws
  it from them, cutting a subtraction. It copies settings from an extrude
  and has no cached body. Intersect Solids (⌥⌘I) replaces them by a mesh
  of the volume they all enclose, in the backmost's class and attributes
  (Vectorworks makes an editable solid; the kind it saves for one isn't
  known), and refuses solids that don't all overlap.
  Section Solids… (⌥⌘T) cuts a solid or mesh with a flat 3D polygon,
  taking away the part on its normal's side, or with another solid, taking
  away the part inside it (reversed, the other side or only the inside);
  what is left becomes a mesh, the cut faces in the sectioning object's
  attributes. Vectorworks makes an editable solid section.
  3D Power Pack > Create Helix-Spiral… replaces each selected line, arc,
  polygon, polyline or 3D polygon by a 3D polygon coiling round it, by
  turns or pitch, from a start radius to an end radius (a spiral when they
  differ), from a start angle and either way round; Extrude Along Path
  takes the coil as a path, to make springs. Vectorworks makes an editable
  helix-spiral object.
  Create Contours… cuts the selected 3D objects, symbols and plug-in objects
  with planes level with the layer or square to its x or y axis, from a
  first plane every interval either way. Each cut becomes a 3D polygon,
  closed where it goes all the way round, drawn as the part it cuts. Each
  object's contours are grouped after it, and the object stays. Like
  Convert to 3D Polygons, it needs a 3D polygon in the drawing to copy
  settings from.
  Model > Cut 2D Section slices the selected 3D objects, symbols and
  plug-in objects as Vectorworks Fundamentals does: click the section line's
  start and end across them (Shift for 15° steps), then the side to keep.
  The upright plane through the line cuts them, and the slice goes onto a new
  design layer named Section, at the active layer's scale, seen from the side
  given up: each object's cut faces as polygons with the attributes of the
  part they cut (holes kept), grouped per object in its class, standing on
  the line's start with heights as they are in 3D. The model stays as it
  was, the whole cut is one undo step, and Esc gives up. Only the cut itself
  is drawn, not the model beyond it.
  Model > Cut 3D Section takes the same clicks and keeps what of each
  object lies on the chosen side, where it was, on a new design layer named
  3D Section: a mesh per object closed by a face over the cut (holes kept),
  each face drawn as the part it came from, with the object's texture.
  Objects wholly on the other side are left out, and the model stays.
  Vectorworks keeps solids; Rodeo makes meshes, so, like Convert to Mesh,
  it needs a mesh in the drawing to copy settings from.
  Model > Engineering Properties… measures one closed 2D object (and, with
  a locus selected too, its moments about the locus): area, perimeter,
  centroid, the second moments about the centroid, the polar and principal
  moments, the section moduli and the radii of gyration, in the units
  chosen. Model > Volumetric Properties… gives the surface area, volume and
  centre of mass of the selected 3D objects, the volume only when their
  faces close round one; AEC > Machine Design > 3D Properties… adds their
  radii of gyration and, from a density or specific gravity, their mass,
  weight and mass moments of inertia. Each can place its list as text
  where the drawing is clicked next, or save it as a text file, and place
  a locus at the centroid or centre of mass.
- **3D Power Pack surfaces.** Model > 3D Power Pack > Create Planar Caps (flat meshes over a solid's open ends, joined by Add Solids, which now takes meshes), Create Surface from Curves (one closed curve, or open curves meeting end to end), Create Drape Surface (a rectangular height field over any objects, down to a Plane Z Value), Revolve with Rail (a profile about an axis, following a rail, from three selected curves) and Unfold Surfaces (developable surfaces as polygons, one per surface between creases; a surface curved two ways is refused). Results are meshes of flat pieces, not NURBS surfaces.
- **3D Power Pack surface editing.** Create Fillet Surface (a rolling ball between two open meshes, circular, linear or blended, optionally trimming them), Stitch and Trim Surfaces (a closed mesh for each volume crossing surfaces enclose), Extend NURBS (a 3D polygon past an end or a mesh past an edge, linear or smooth) and Rebuild NURBS (3D polygons and four-sided or tube meshes with a chosen number of points and a live maximum deviation). Trim Type and interpolated surfaces aren't offered.
- **Trace Bitmap** (Modify menu): turns the selected image into vector
  objects, reading it in black and white at a brightness threshold (the dark
  or the light parts as ink): filled outlines, one polygon per patch of ink
  with its holes, or centrelines down the middle of its lines, for scanned
  line work. The result is grouped over the image, in one undo step; specks
  and how closely the paths follow the pixels are settings. Pictures over
  2000 pixels across are traced at that size.
- **Edit Crop** (Modify menu, or right-click an image): draw a rectangle,
  circle, oval or closed polygon over an image, select both, and the picture
  is cut to it: square to a level rectangle, or to the outline of any other
  shape with the rest left clear. The image shrinks to what's kept, at the
  same scale, and the shape goes or stays as a frame. With the image alone
  selected, it trims a length off each side. One undo step. Unlike
  Vectorworks, the crop can't be edited later: the pixels outside are gone
  (Undo brings them back).
- **Duplicate Array** (Edit menu): linear, rectangular grid or circular
  copies, optionally turned, in one undo step.
- **Duplicate Along Path** (Edit menu): select the objects and a line,
  polyline, polygon, rectangle, arc or circle; copies go along it, a number
  spread from the start offset to its end (or round a closed path) or a
  distance apart, the centre of the objects on the path and, with Tangent to
  Path, turned with it. One undo step; the copies are selected.
- **Groups**: double-click a group to edit the objects inside it (Esc
  twice, the Exit Group button over the drawing or a double-click on empty
  space leaves), or Cmd+click to select an object inside its groups
  directly. Window > Edit Group and Object Visibility Options sets whether
  Esc Esc leaves, and whether the Exit Group, Exit Symbol and Unhide Objects
  buttons are large (icon and label) or small (the icon alone, the label in
  its tooltip). Modify > Top Level leaves
  every group open at once (and the symbol being edited). Group bounds are
  updated when their contents change.
- **Slab tool** (the Building Shell tool set): draws a rectangular slab
  between two corners, by press-drag-release or click-click (Shift
  square). It copies a rectangular slab plug-in the drawing has in the style
  Preferences chooses (one per style and thickness), its parts stretched
  along the outline's sides onto the rectangle, so its style, thickness,
  heights, components and 3D are that slab's. It goes on the active layer
  in the active class, one undo step, selected. Slabs with other outlines,
  and styles whose 3D stands past the outline, can't be drawn yet.
- **AEC menu**: Create Auto Hybrid holds the selected 3D objects in an
  object that 3D views show as they are and Top/Plan as a plan worked out
  from them: where a level cut plane goes through them, and the edges below
  and above it, those out of sight dashed or left out. 2D Appearance sets
  the cut's height and each part's class, fill and pen; Modify > Edit Auto
  Hybrid opens the objects to change, and leaving them draws the plan again.
  Pillar… stands the selected shapes up to a height, closed ones
  as extrudes and open ones as flat screens. Create Polys from Walls… draws a polygon round the outside of
  the selected walls (Gross Area Polys) or inside each room they close (Net
  Area (Room) Polys), each wall taken as the area its plan drawing covers
  with door and window gaps filled. Dimension Exterior Walls… dimensions
  every building the walls on a layer make, on all four sides: its doors and
  windows (edges or centres, and the walls meeting it from inside), its
  corners and jogs, and its overall size, each chain further out, to the
  outer faces or the centrelines, with small spans drawn in red. Create Objects from Shapes… turns the
  selected lines, rectangles, polygons and polylines into walls or slabs,
  in a style the drawing has (the ones the Wall and Slab tools copy). Walls run along each
  side from corner to corner, each mitred to the one before, and round a
  closed shape the last to the first; corners closer than 1 unit merge.
  A slab covers each rectangle square to x and y. Polylines with curves,
  rounded rectangles and circles are refused. Delete Source Shapes takes
  the shapes away. They go on the shape's layer in the active class, in one
  undo step, and are selected.
  Framing > Create Joists… frames the selected closed shape: joists the
  spacing apart along two clicks, cut to the perimeter members round its
  edge (lapped or mitred), headers round openings selected inside it, each
  member a group of its plan and a solid, and a Joist Take-Off worksheet
  when the drawing has a worksheet to copy one from.
  Framing > Wall Framer… frames the walls on the layers ticked: studs
  the spacing apart, plates, and king and jack studs, headers, cripples
  and sills round each door and window, with each wall class's own
  spacing and lumber, drawn on the framing model's own layers in 3D, in
  plan and as a diagram of each wall, with take-off and wall info
  worksheets when the drawing has a worksheet to copy one from.
  Framing > Roof Framer… frames the selected roofs from their 3D faces:
  rafters down each slope (jacks at the hips and valleys), ridges, hips
  and valleys where slopes meet, level purlins and plates under the
  eaves, each kind in its class, with a Roof Framing Take-Off worksheet.
  Framing > Simple Beam Calculator… works out a beam's reactions, end
  moments, greatest shear and bending moment, bending stress and greatest
  deflection as the values are typed, for twelve configurations (simple,
  fixed at both ends, propped cantilever and cantilever, under a uniform
  load or concentrated loads), in Imperial or Metric units. Machine Design
  holds the Belt Length and Chain Length calculators (a belt's or roller
  chain's length round two pulleys or sprockets, or the center distance a
  given length fits; either can place its data as text on the drawing),
  Centroid… (one closed 2D object's centroid, with a locus there if asked),
  Conversion Factors… (93 units of 13 quantities), Solution of
  Triangles… (from three sides, two sides and an angle, or two angles and a
  side, with both answers where two triangles fit) and Spring Calculator…
  (a compression spring's rate and unit stress from its diameters, wire and
  coils, and the Compression Spring 2 tool ready to draw it); its Create 3D
  Object From 2D makes the selected 2D machine parts' 3D versions, from the
  settings each part keeps in a 'Rodeo Machine Part' record. Electrical > Conductor
  Sizing Calc… works out a run's wire size, voltage drop, current, length,
  voltage, phase factor or resistivity from the rest, for copper or
  aluminum wire from 18 AWG to 1000 kcmil, as the values are typed. Conduit
  Sizing Calc… lists the wires going in a conduit (by the NEC's Table 5, or
  any wire's area typed) and reports the actual size and the trade size of
  EMT, RMC, IMC, FMC, LFMC or PVC they need, sharing them over as many
  conduits as given at the fill suggested by Table 1 or typed. Vectorworks'
  wire database of manufacturers and part numbers isn't here. Roads >
  Station on Polyline… stakes the selected line every 100' (30.48 m) and at a
  partial interval, each labeled with its station, and can draw each circular
  curve's data and tangent guide lines or list them in a worksheet (made from
  one the drawing already has). The stakes are the Stake tool's default look
  as grouped 2D objects, not site-model stakes.
- **Plug-in Insertion tool** (the Insertion tool set): places plug-in
  objects of any kind the drawing has on its design layers (columns and
  beams, plants, cabinets, stairs, grid axes, railings, spaces...): press
  where its insertion point goes and drag to turn it (Shift in 15° steps),
  or click to keep the turn of the one it copies. Preferences picks the
  kind. The copy keeps that object's class, parameters and drawing, since
  Rodeo can't redraw a plug-in from its parameters; tags, section lines,
  cameras and Heliodons (their own tools place them), site models and design
  layer viewports aren't offered.
- **Symbols**: Resources lists the file's symbol definitions by
  folder with previews and search; pick one and the Symbol tool (K) places it
  with a live preview, with a click or (Click and Rotate) a click and then a
  second click for its rotation, Shift in 15° steps. Instances are drawn through their placement matrix,
  can be moved, rotated and mirrored, and Object Info shows the definition
  and replaces it with another. Modify > Create Symbol… turns the selection
  into a new definition and puts an instance in its place. Modify > Edit
  Symbol (or double-click an instance, or Edit Symbol on its Resources
  tile) opens the definition in place of the layers, at its insertion
  point, for every tool to edit; each change reaches every instance and
  undoes as usual, and Exit Symbol (the bar over the drawing, Modify, or
  Cmd+]) goes back to the layer and view it came from. Right-click an
  object on the drawing for Locate Symbol (or Hatch, Gradient, Tile, Image
  Fill, Line Type, Text Style, Worksheet, Texture) in Resource Manager: one
  row for each resource it uses, which shows Resources with that tile
  selected and scrolled to (a symbol becomes the one the Symbol tool
  places, without switching tools). Right-click a
  tile in Resources to rename any resource, to duplicate or delete a
  symbol definition, or to delete a worksheet or a data record format (its
  records going from the objects that have one). Hatches are edited there
  too (Edit Hatch…, or a double-click on the tile): the ground colour,
  whether the sizes are on the printed page or in the world, and the levels
  of parallel lines with their angle, spacing, shift along the line, dash,
  start point, colour and weight, with a preview that follows each change;
  New Hatch…, Duplicate… and Delete… sit beside it. Gradients (their stops'
  position, colour, opacity and midpoint), line types (dash and gap
  lengths on the printed page) and text styles (font, size in points and
  alignment, with a sample line; editing one restyles the texts that follow
  it, by name or through their class, keeping a size they set apart in
  proportion) are edited the same way, and the panel's +
  button makes a new hatch, gradient, line type, text style or record
  format; a drawing with no gradient or text style yet gets its first from
  a hatch's frame. The + button's
  Import from Another File… (or File > Import Resources…) lists another
  .vwx file's symbols, textures, hatches, gradients, simple line types,
  text styles and data record formats to tick; one
  whose name the drawing already uses comes in as Name-2, replaces the
  drawing's own of that kind (a replaced symbol's instances draw its new
  contents), or stays out, as chosen. A
  symbol brings the symbols nested in it and the classes, line types,
  hatches, gradients, text styles, record formats and textures (those its 3D
  objects show) it uses that the drawing lacks (the drawing's own of the
  same name are used as they are); symbols holding plug-in objects are
  listed with the reason they can't come in yet. A texture brings its shaders' images and settings and
  the shader record formats the drawing lacks (one it has must hold the
  same kinds of field in the same places). A record format that replaces
  the drawing's keeps the values of the fields both have, of the same kind,
  in the records already attached; one with fields a new format can't have
  yet (choice fields, say) is listed with the reason. Colours are matched to the drawing's palette (the
  nearest when it lacks one), previews are drawn anew, and the imports are
  one undo step. A definition,
  worksheet, hatch, gradient, line type or text style still in use somewhere isn't deleted, and a resource whose name other
  records hold as text (plug-in parameters, worksheet formulas, data
  visualizations) or a plug-in's parameter format isn't renamed or deleted,
  since those would not follow.
- **Attributes** (its own palette): pen and fill colour from the document's
  colour table (with its colour names), fill none/solid, opacity, line weight
  and line type, for selected objects and, with nothing selected, for new
  objects. Line weights are drawn on the canvas. For the selection it also
  sets the line markers at each end of lines, arcs, polygons and polylines
  (none, arrow, dot or slash, their size on paper and the angle of arrows
  and slashes) and the drop shadow (on or off, offset, angle, blur, opacity
  and colour). New objects can be given markers and a drop shadow too; each
  new object takes them in the same undo step that draws it. Tools > Options >
  Edit Marker List… names the markers its Start and End menus offer (style,
  size on paper and angle, in order) and Line Thickness… the weights its Line
  weight menu offers, both kept in this browser; a line whose marker isn't on
  the list shows its style, size and angle instead.
- **Line types**: dash styles defined in the file (ISO and VW dashed
  styles) are drawn at the layer's scale, can be changed in Object Info,
  and are written to DXF (as LTYPE line types), SVG and PDF.
- **Line markers**: arrowheads, dots and slashes (dimension ticks) at the
  ends of lines, arcs, polygons and polylines draw in the pen colour at their
  size on paper (scaled by the layer or viewport, as dashes are), and print
  to PDF, SVG and PNG.
- **Drop shadows**: objects with a drop shadow cast a soft shadow at its
  blur, distance, angle, colour and opacity, on paper (scaled by the layer
  or viewport). A plug-in, symbol or group casts one shadow from its whole
  drawing, and a plug-in's own opacity fades its drawing. Shadows show on
  the canvas and in SVG and PNG exports (cast by the outlines and text those
  draw). PDF has no blur, so its shadows are layered copies of the outlines
  and text, stroked wider out to the blur radius and fading as they go.
- **Drawing tools**: line, rectangle, rounded rectangle (Shift+R; corners
  round by a share of the shorter side, or by fixed radii set in its
  preferences), circle, arc (by radius, through
  three points, a quarter arc between two points, or a tangent arc that
  leaves its start in a clicked direction; keys 1–4), the Quarter Arc tool
  beside it (a quarter circle or ellipse leaving its start the way the
  pointer first moves, Shift keeping it circular; a polyline, as Vectorworks
  lists quarter arcs), triangle (beside Polygon: click the first side, give
  the rest in Triangle Settings as three sides, two sides and the angle
  between them, or two angles and the side between them, then click the side
  of the first one it goes on), polygon (P: by
  vertices, or in Inner Boundary mode a click inside an area the active
  layer's visible objects enclose makes a polygon of that area, and in Outer
  Boundary mode of the outside of the outlines round it; resting over an
  area previews it; keys 1–3),
  polyline (Y: each vertex placed as a corner, a bezier control point, a
  cubic spline point the curve passes through, an arc rounding the corner or
  a point an arc passes through; keys 1–5), oval (B), regular polygon (Shift+G), spiral (Shift+S: circle the centre
  to add loops; a smooth polyline), double line (W: two parallel polylines
  with mitred corners, the path on the top, centre or bottom line, as lines,
  the polygon between them, or both) and Double Line Polygon (Shift+W: the
  same, closed), freehand (U; No Smoothing keeps the simplified corners,
  Low, Medium and High draw a smooth curve), 2D locus (a click places a
  reference point that snaps but doesn't print; DXF takes it as a POINT),
  text, rotate (centre, reference, angle)
  and mirror (axis; Option keeps the original), Move by Points (Shift+M: move
  the selection from one point to another; Option or Copy mode moves a copy),
  offset (E: parallel copies of lines, polylines, polygons,
  rectangles, circles and arcs at a typed distance) and fillet (F: rounds the
  corner between two lines with a typed radius, trimming both) and chamfer
  (Q: cuts the corner with a line at two typed distances). Shear and Fixed
  Point Resize (beside Clip, as in Vectorworks) work on the selected
  rectangles, rounded rectangles, polygons, circles and ovals (Shear on
  polylines too): click the point that stays fixed, then press on the
  selection and drag, or click, move and click. Fixed Point Resize stretches
  across and up about that point, each by how far the dragged point now lies
  from it against where it started (not from a start level or plumb with it;
  past it, the selection is reversed; Shift keeps the proportions). Shear
  skews the selection so the dragged point lands under the pointer (Shift:
  straight across or up). A shape that can't keep its kind becomes a
  polygon; one undo step.
- **3D Modeling tools** (their own tool set): Extruded Rectangle and
  Extruded Polygon draw as the Rectangle and Polygon tools do and make an
  extrude of the height in their Preferences (a metre at first); Sphere,
  Hemisphere and Cone go from the centre out to the radius, as the Circle
  tool does, and make sweeps turned a full turn about their upright axis:
  a sphere centred on the layer's plane, a hemisphere and a cone (its height
  in Preferences) standing on it. Like Model > Extrude and Sweep… they copy
  settings from an extrude already in the drawing; each is one undo step.
- **Edit a solid's edges and faces** (3D Modeling tool set): Chamfer Edge,
  Fillet Edge, Shell Solid and Taper Face work in the 3D view, which they show
  when picked. Click an edge or face of a solid (Shift-click for more, a drag
  still orbits), set the setback, radius, thickness or angle in the bar over
  the view, and press Apply or Enter. Chamfer and Fillet take a single edge,
  its tangent chain (all of a cylinder's rim from one click), a face's edges,
  or all of them; Shell Solid hollows inside or outside, leaving the clicked
  faces open; Taper Face turns a face about where it meets a face or plane you
  click first. The result is a mesh in the solid's place, and can be edited
  again by these tools, but its setback or radius can't be changed afterward as
  in Vectorworks: PARITY.md lists the limits.
- **Loft Surface and 3D Polygon** (3D Modeling tool set): Loft Surface makes a
  mesh through cross sections, with no rail, one rail or two. Pick it, click
  each curve in the 3D view (3D polygons, or 2D shapes on the active layer), and
  press Enter or Loft; the Loft Creation dialog sets each curve's Reverse and
  Start, and Ruled, Closed, Create Solid and Keep Curves, with the 3D view
  showing the result as they change. 3D Polygon draws those curves: corner by
  corner in Top/Plan at the Elevation in its Preferences, or in the 3D view on a
  face or at that Elevation. Rodeo has no NURBS, so the curves stay polygons and
  the loft a mesh: PARITY.md lists the limits.
- **Align Plane.** The 3D Modeling set's Align Plane lays the selected 3D objects on the active working plane (or the layer plane): click a face to lay it on the plane, or click three points that go to the plane's origin, its x axis and its y side. Clicks near a solid's corner take the corner. It's one undo step.
- **Push/Pull and Offset Edge.** The 3D Modeling set's Push/Pull adds or cuts a slab on a face, flat or curved, moves a flat face with its neighbours running on, and works on the part of a face a curve marks out; Offset Edge offsets an edge or loop across a flat face as a 3D polygon and can go straight on to push or pull it. Both preview in the 3D view as the pointer moves, or take a typed distance. Results on solids are meshes, with no history to edit later.
- **Deform.** The 3D Modeling set's Deform twists, tapers, bulges and bends solids in the 3D view, or twists one face and its neighbours, with Symmetric and Finite Length as in Vectorworks. The result is a mesh of small faces rather than a generic solid.
- **3D Locus.** Place 3D reference points in Top/Plan or the 3D view, on a face, a working plane or at an elevation. Edit X, Y and Z in Object Info. Make them from 3D polygons or 2D contours, and turn them into stakes. The record's point order comes from demos that are all at the origin, so it isn't confirmed against a file with loci elsewhere.
- **Extract.** Take 3D loci, curves, iso-parametric curves or surfaces off the edges and faces of a solid or surface, leaving it as it was. Rodeo has no NURBS kernel, so edges and iso-curves are worked out from the triangles, and the results are 3D polygons, 3D loci and open meshes.
- **Project.** Project a 2D object or 3D polygon along its plane's normal to split a solid or surface, trim it, or stand a rib on a solid. The results are meshes with no history, and it's limited to about 4,000 triangles.
- **Analysis.** The 3D Modeling set's Analysis tool works in the 3D view. Proximity takes two objects, solids, surfaces, curves or 3D loci, and marks where they come nearest with 3D loci and says how far apart that is; where they cross it marks the crossing instead, with loci for a curve and a 3D polygon for two solids. Interrogation takes a curve or surface and shows how it bends under the pointer, the curvature circle in red and the tangent or normal in blue; a click gives the numbers and can add those to the drawing. Curvature comes from neighbouring points, as Rodeo's curves are polylines and its surfaces triangles, so it's close on a smooth faceted shape, and a corner in a polyline reads as a tight circle.
- **Class and Layer Mapping** (Tools): give each class and design layer the name it's
  to have. A new name renames it, another's merges with that one, a blank deletes it
  with its objects. Vectorworks' mapping files load and save.
- **Symbols in new drawings.** Create Symbol and the rest of the symbol commands now work in a blank drawing, where they used to refuse for lack of a symbol to copy from. These symbols haven't been opened in Vectorworks yet.
- **Existing trees from loci.** AEC > Existing Trees > Create Existing Trees from Loci turns selected loci or symbols into existing trees, mapping a survey record's fields to the tree's parameters with their units. Preserve Record keeps the record on the tree. A tree only has the parameters the Existing Tree tool draws, so Height and Condition stay in the record, and saved mapping sets aren't there.
- **Chain Extrude.** In the Building Shell set. Select a profile, a back shape and any shapes in front of it, then click a path: the back shape runs along it with mitred corners, and the front ones repeat as ribs along the sides and at the corners. Object Info changes Flip, ribs, thickness, spacing, datum and elevation, and Draw New Path replaces the path. It can't be reshaped, and its profile can't be edited afterward.
- **Shell Solid on surfaces.** Shell Solid also thickens open meshes and closed flat shapes. Click one (Shift for several), then Apply or Enter; Inside goes against the normal and Outside along it. Each becomes a closed mesh of that thickness, which can't be changed afterward. A flat 2D shape keeps only its outline, not its holes.
- **Surface arrays.** Model > Create Surface Array repeats the selected items in a grid across a flat object or open surface, also selected, with its dialog's Origin, Pattern Rotation, Repetition, Offset, Shift and Edge Conditions, and the 3D view showing the array as they change. It makes a plain group, not an editable array object, and a surface has no U and V here, so the grid is laid on the plane it faces most and carried onto it.
- **Meshes in Top/Plan.** A mesh, the kind of object the 3D Modeling tools make, now draws in Top/Plan from above, as its rims, sharp folds and the edges where it turns away. A click on those lines picks it. One in a symbol or plug-in, or grouped with a plan drawing, leaves plan to that.
- **Light tool** (the Visualization tool set): places a point light, a spot
  or a directional light (keys 1 to 3) at its Preferences' elevation above
  the layer, a spot or directional one shining straight down; dragging from
  where it goes aims it, a spot at the point the drag ends on the layer's
  floor and a directional light that way, 45° down. A new light copies its
  colour, brightness and cone from one the drawing has, so a drawing without
  one can't take one yet. Plan draws the drawing's own light objects as
  amber marks a fixed size on screen: rays round a point light, a spot's
  beam and a directional light's arrow the way they shine (a dot when
  straight down), faint when off. A click selects one and a drag moves it; a
  light-fixture symbol's lights show in Edit Symbol.
- **Camera tool** (the Visualization tool set): press where a Renderworks
  camera stands and drag to the point it looks at, or click to look north
  5 m; it goes on the active layer at its Preferences' eye height above the
  layer (1600 mm), looking level, named "Camera n", selected, one undo step.
  It copies its lens, projection and plan drawing from a camera the drawing
  has, so a drawing without one can't take one yet.
- **Heliodon tool** (the Visualization tool set): click to place a Heliodon,
  the sun for a place, a date and a time, copied from one the drawing has
  (so a drawing without one can't take one yet), selected, one undo step.
  Preferences set the latitude (south negative), month, day and solar time a
  new one has. Selected, a Heliodon shows a Sun section in Object Info: its
  latitude, date and solar time, its longitude and daylight saving, which
  set it, its time zone, and the sun's altitude and azimuth and the sunrise
  and sunset by its clock. A change, there or to those parameters in its
  record, writes the figures it shows again as Vectorworks does, prints its
  label's time and date again and turns its lights to shine from the sun
  (level when it is below the horizon); the rest of its plan drawing stays
  as it was. Light the 3D view puts the 3D view's sun where the Heliodon's is.
- **Wall tool** (the Building Shell tool set): click the start, then each
  corner; every click past the first places a straight wall from the corner
  before, one undo step each, the last selected. Double-click, Enter or Esc
  ends the run and Shift keeps each wall to 15° steps. A new wall copies a
  straight wall the drawing has in the style Preferences chooses (one per
  style, thickness and height): square-ended, with no doors or windows in
  it, stretched along the line drawn, so its style, thickness, heights,
  components, plan drawing and 3D are that wall's. A drawing with no styled
  walls, a new blank one among them, also offers plain walls, 4", 6", 8" and
  1' thick and 8' high, or 100 to 300 mm and 2700 mm high in metric: a single
  white solid in plan and a box in 3D, with no components, and not yet opened
  in Vectorworks. It goes on the active
  layer in the active class. Each wall is mitred to the one before it, in
  plan and 3D, along the bisector of their corner, and clicking the run's
  start again closes it, mitring that corner too (a corner sharper than
  150°, or walls too short for the cut, stay square). A click on the end of
  a wall already on the layer starts or ends the run there, the two mitred
  at the corner (unless that wall is joined there already or holds a door
  or window); one on a wall's side starts or ends it at that wall's face,
  the new wall's end cut along the face (a tee, refused under 15°), and the
  wall met stays as it is, its face line crossing the joint. A run ends at
  a wall it joins. The components' outlines show the mitre as a line across
  the corner. No Vectorworks join records are written, and joined walls are
  untested in Vectorworks.
  Selected, a wall's Object Info sets its start and end, its length (from
  the start), its bottom, top (both above its layer) and height, one undo step each: each point of
  its drawing and 3D goes with the end it is at, so its thickness,
  components and mitred or cut ends keep their shape, and its 3D stretches
  between its new bottom and top. A wall mitred to it at a corner where
  only the two meet follows an end that moves, and every corner of a wall
  that moves, turns or follows is mitred again along the line through where
  their faces cross. A wall meeting its side at a tee, or a mitred one's,
  slides its end along its own line, each point there as deep in it as it
  was, so each of its components stays joined. A wall whose end meets the
  moving end at the same point (three walls or more meeting there, or two
  cut as Vectorworks cuts its own corners) goes to where that end went, and
  one butted into the end goes with it as the end went, each keeping its
  cut; walls stacked on it at other heights stay as they are, and a joined
  wall that can't follow (an end through a door) refuses the move.
  The doors, windows and symbols set in it, their openings and anything
  else between its ends keep their place from the end that stays put (the
  start when both move), turning with it, and their height above its bottom
  as its top moves; an end that would pass through one, a top that would
  come down through one, a wall sloping over its doors and windows, or one
  too short for its cut ends refuses, saying why. Its style and thickness
  stay read only.
- **Wall Join** (Building Shell): joins two walls already drawn. Click a wall
  on the part to keep, then the other. T Join (1) runs the first wall's end
  to the second's face toward the first's other end, cut along it, the
  second staying as it is; L Join (2) takes an end of each to where their
  lines cross and mitres the corner as the Wall tool does. Where a wall
  crosses the other, the part clicked stays; otherwise the end nearer the
  crossing goes. Joined walls then follow each other as the Wall tool's do.
  Walls that never meet, an end another wall meets already, a tee at under
  15° or past the wall's end, and ends not cut straight across are refused,
  saying why. X Join (3), for walls crossing between their ends, breaks the
  first where they cross (as Split does) and runs each part to the second's
  face toward it, cut along it, as two tees. One undo step each. The wall
  met keeps its face lines across the joint: Vectorworks' cleanup there isn't
  drawn yet.
- **Door and Window** (Building Shell): set a door or window in a straight
  wall by copying one the drawing has set alone in a wall of that style and
  thickness. Click the wall where its middle goes; the pointer shows its
  outline along the wall, and Preferences picks which door or window (by
  size and the wall it goes in). Rodeo can't cut an opening yet, so the wall
  is redrawn as a copy of the one the door is copied from, laid along its
  line with the opening where you clicked: its ends are cut as the wall's
  were, and its top and bottom, class, name and attached records stay its
  own (the door keeps its height above the bottom), so the walls joined to it
  don't move. The copy faces as the copied one does from its wall's start to
  its end. A wall of another style or thickness, one holding a door, window
  or symbol already, a sloping wall, one with an end not cut straight across
  or a cleaned-up joint, a door that would reach the wall's end or a wall
  meeting its side, and a top below the opening are refused, saying why. One
  undo step; the new door or window is selected afterwards.
- **Doors and windows in walls**: a click with the Select tool picks a door,
  window or symbol out of the wall it is set in, as Vectorworks does (the
  wall tools still take the wall). Dragging it, nudging it or Move slides it
  along the wall with its opening: the drag runs along the wall's line, and
  the wall's drawing and 3D within 60 mm of the door's drawing go with it.
  It can't reach the wall's end, another door or window, or a wall meeting
  the side, and one whose opening can't be told apart from a neighbour's (one
  within 60 mm) stays put, saying why. Turning, deleting, duplicating or
  grouping one is refused: Rodeo can't cut or close an opening yet. Its
  parameters edit in Object Info as before.
- **Trim, split, connect**: Trim (X) removes the piece of a line, polyline,
  polygon, rectangle or arc between the nearest crossings either side of the
  click; Split (S) cuts an object in two at the clicked point, or in Line
  Split mode cuts everything a dragged line crosses wherever it crosses (a
  polygon or rectangle cut across becomes two closed polygons), or in Line
  Trim mode cuts the same way and then deletes the pieces on the side you
  click. A straight wall clicked with Split, or crossed by its line, becomes
  two walls where the point lies along its line, each part square there, its
  far end keeping its corner, and the walls teeing into it staying with the
  part they meet (walls with doors, windows or symbols set in them, or drawn
  with more than their two ends, aren't split yet; nor where another wall
  meets the side); Connect (J)
  extends or shortens the clicked end of a line or arc to meet another object,
  or in its dual modes moves the clicked ends of two lines or arcs to where
  they meet, and Dual Object Combine joins two lines met that way into one polyline.
  Clip (Shift+X) cuts the selected closed shapes by a dragged rectangle:
  Exclusion cuts away what is inside it, Inclusion keeps only what is inside,
  Split keeps both as separate objects.
- **Callout** (Shift+C): click where the leader points and where it meets
  the note, then type the note. The leader has an arrow, a dot or no marker
  and a short shoulder, and the note sits in no box, a box or a rounded box;
  sizes are on paper and scale with the layer. **Revision Cloud** (Shift+L)
  draws a ring of outward arcs round a dragged rectangle or a clicked
  polygon. Both are plain objects (a group, a polygon).
- **Markers** (the Dims/Notes tool set), each a group of plain objects with
  sizes on paper and numbers in Preferences: **Section-Elevation Marker**
  draws a section line with a bubble past each end, its arrows looking to
  the line's left or right (keys 3 and 4), or in Elevation (key 2) one
  bubble looking from the first click toward the second. **Interior
  Elevation Marker** places a circle with an arrow each way and each look's
  number (a press dragged turns it). **Detail Callout** circles a detail
  dragged from its centre to its edge and carries a leader on to its bubble.
  **Drawing Label** places the bubble, the title on a line and the layer's
  scale. **Reference Marker** places a bubble with the referenced drawing's
  number over its sheet's and a note under it, on a leader (straight, an arc
  or a curve) from an arrowhead at the target to a shoulder: click the
  marker then the target, or the target then the marker (keys 1 and 2).
  **Grid Line** draws structural grid lines with a bubble holding the label
  past either end or both: straight (key 1, Shift in 15° steps from the
  last grid line), radial about a clicked centre (key 2), through clicked
  corners (key 3, double-click or Enter ends it), or Duplicate (key 4), a
  copy of the last one moved across, offset or turned about its centre to
  the pointer or by a set offset or angle; each takes the next label,
  stepped on as Vectorworks does (1.9 to 2.0, Z to AA, past letters not to
  include). **Redline** rings a change in red, as a cloud, rounded or plain
  (dashed when the drawing has a dashed line type): a drag or two clicks
  for a box or an oval (keys 1 and 2), clicked corners (key 3) or a
  freehand stroke (key 4); it then asks for the note, and a leader runs to
  a tag with the date and who authorised and was assigned it. Redlines
  live in the Notes-Redlines class; Text > Redlines picks one up (it turns
  yellow with today's date), restores it, shows or hides them all, and
  makes a Redlines Status Report worksheet of the open and closed ones.
  **General Notes** places a titled block of notes typed one a line,
  numbered or lettered with hanging indents, in one or more columns.
  **Elevation Benchmark** marks a point with a quartered circle and its
  Y from the drawing's origin, for elevations drawn in 2D. **North Arrow**
  points up on a click, or at the pointer when dragged. **Scale Bar** places
  four segments of a round length for the layer's scale, labelled in the
  drawing's units. **Data Tag**: press on an object and drag to where the
  tag goes, for its name, class, area or length (keys 1 to 4). **Graphic
  Legend** lists the classes used on the active layer, each swatch drawn in
  its class's attributes. Vectorworks's markers, tags and legends follow the
  viewports, objects and classes they name; these are drawn as they are
  when placed. **Symmetry Label**: drag the axis, crossed near each end by
  two short bars. **Center Mark**: click a circle, oval, rectangle or
  rounded rectangle to cross its centre with two lines; with Option/Alt, a
  rounded rectangle's nearest corner.
- **Spur Gear** and **Spur Gear Rack** (the Machine Components tool set): a
  click places one, a press dragged turns it. A gear is seen from the front
  (key 1), its involute teeth drawn (key 3) or simplified to its outside and
  pitch circles (key 4), or cut through its axis from the side (key 2).
  Preferences hold its pitch diameter, teeth, pressure angle (14.5°, 20° or
  25°) and face width, a web recess, a hub standing out on both sides or
  one, a bore with an ASME-sized or custom keyway, holes through the web and
  centre lines; they show the module, diametral pitch and outside and root
  diameters for reference. A rack is seen from the front (key 1: every
  tooth, or two at each end with the tips' and roots' lines between, the
  roots filleted if asked), the top (key 2) or the side (key 3), sized by
  module or diametral pitch.
- **Sprocket**, **Roller Chain - Linear** and **Roller Chain - Circular**
  (Machine Components): a sprocket for an ANSI or ISO roller chain is placed
  like a gear, seen from the front (key 1) with its teeth in the ISO 606
  tooth form or from the side (key 2) with a row of teeth for each strand;
  it shares the gear's hub, bore, recess and web hole Preferences. A linear
  chain runs right from the click (a press dragged turns it); a circular one
  wraps round a sprocket's pitch circle about the click, from a start angle,
  clockwise or counterclockwise. Both draw link plates and pins as seen from
  the side; placed on a sprocket's centre, a circular chain's rollers sit in
  its seats.
- **Ball Bearing**, **Roller Bearing** and **Needle Bearing** (Machine
  Components): a click places a bearing centred on it, seen down its axis
  (key 1) or cut through it (key 2), a press dragged turns it. Preferences
  hold the type (single or double row, radial, angular, separable or
  self-aligning; a machined or drawn-cup needle bearing, its rows and inner
  ring), the inside and outside diameters and the width; the rings, grooves,
  ribs and rolling elements are proportioned from those. Show Detail off
  draws the simplified bearing of ISO 8826-1, its outline with an upright
  cross.
  **Tapered Roller Bearing** (single row, or a double row back to back) is
  sized by both rings' widths, the space between rows and how far the inner
  ring stands out past the outer; **Thrust Bearing** (single or double ball,
  or cylindrical roller, its washers grooved or flat) by its thickness. Both
  can show their retainers' side rings in section. **Bearing Lock Nut**
  places a KM nut (KM0 to KM20) the same way, from the front with its four
  slots and, if asked, the tab washer behind it, or cut through its axis.
- **Pulley** (Machine Components): placed like a gear, from the front or cut
  through its axis (keys 1 and 2). Preferences hold the outside diameter and
  up to ten grooves, each a V of the angle, width and depth given with its
  bottom corners rounded to the groove radius (a small angle and a radius
  half the width make a round belt's groove), and the gear's hub, bore,
  keyway and recess. The web is plain, has holes sized by a share of the
  room across the recess or by their diameter, or has spokes.
- **Key** and **Woodruff Key** (Machine Components): a click places a key
  centred on it, from the front, top or side (keys 1 to 3). Key takes a DIN
  6885-1 or ASME B17.1 size, or a custom width and height, and a length;
  Woodruff Key a DIN 6888 or ASME B17.2 size, its Preferences showing how
  deep the keyseat goes into the shaft and the hub.
- **Compression Spring 1** and **2**, **Conical Compression Spring** and
  **Die Spring** (Machine Components): a click places one end of a spring,
  its axis running right for the working length (a press dragged turns it).
  Preferences hold the wire, the diameters, the solid height or the active
  coils, the kind of ends and the hand of the spiral. Keys 1 to 5 show the
  front coils, the rear coils or both, solid; a section through the axis;
  or the zigzag ISO 2162-1 draws for a spring.
- **Extension Spring - Front**, **Extension Spring - End** and **Belleville
  Spring** (Machine Components): Extension Spring - Front is placed like the
  compression springs, its coils close wound at the free length and spread
  over the working length, with a full loop or an open hook at each end seen
  face on or edgewise; Show All Coils off draws three coils at each end.
  Extension Spring - End draws the spring seen down its axis, its far loop
  at right angles if asked. Belleville Spring places a stack of disc springs
  nested, or in groups facing alternately down and up, cut through its axis
  (key 1), or one seen down its axis (key 2).
- **Pillow Block**, **Flanged Bearing - 2 Hole** and **Flanged Bearing - 4
  Hole** (Machine Components): a click places a mounted ball bearing unit
  centred on the shaft, seen down it (key 1), across it (key 2) or, a pillow
  block, from above (key 3); a press dragged turns it. Preferences pick a
  UC204 to UC215 size from FYH's catalogue, or Use Custom Dimensions to type
  your own, and show the set screw, the grease fitting, and the centre and
  hidden lines.
- **Roller Chain - Offset Link** (Machine Components): a click places one
  offset link of the chain size picked in Preferences, its roller end on the
  click and its pin end a pitch to the right, seen from the side (key 1) or
  from above with its plates cranked (key 2); a press dragged turns it.
- **Bevel Gears** (Machine Components): a click puts the pitch apex of a
  bevel gear and pinion there, cut through their axes (key 1) with the
  pinion's axis turned the Shaft Angle from the gear's, or the gear seen down
  its axis (key 2). Preferences set the module or diametral pitch, the face
  width, each member's teeth, mounting distance, hub, bore, keyway, recess and
  fillet, and whether to draw both, one, or a miter pair.
- **Worm** and **Worm Gear** (Machine Components): a click places a worm
  with its axis running right, or its gear, centred there; a press dragged
  turns it. Keys 1 to 5 pick the view: the worm from the front with its
  threads wound round it, from either end, or cut across or along it; the
  gear from the front or back, cut through its axis with its rim hollowed to
  wrap round the worm, or from the side with or without hidden lines. Keys 6
  and 7 switch the teeth between Detailed and Schematic. A negative Hub
  Projection sets the hub into the face.
- **Pins** (the Fasteners tool set): Clevis Pin (Inch, Metric, DIN), Cotter
  Pin (Inch), Dowel Pin (Inch), Parallel Pin (DIN) and Taper Pin (Inch, DIN)
  in their standard sizes. A click places one, a press dragged turns it;
  keys 1 to 5 pick the view (a clevis pin from the top down its split pin
  hole, from the side, or end on at its head or body; a cotter pin from the
  front with its prongs bent at the grip length, from either end, above or
  below). Preferences keep lengths to the standard ones when asked.
- **Rivets** (the Fasteners tool set): Large Rivet (Inch), Small Rivet (Inch)
  and Rivet (DIN) stand head up with the head's bearing face on the click,
  in each standard's diameters and heads (button, high button, cone, pan,
  flat, truss, round, flat round, mushroom, flat and oval countersunk), with
  an optional second head at the far end; key 2 looks down on the head.
  Tubular Rivet (DIN) lies along its axis from its head, its far end set into
  a flange and the unset tube dashed past it.
- **Nuts** (the Fasteners tool set): Acorn Nut (Inch) with a low or high
  crown and Hex Cap Nut (DIN) from the front, side or top; Knurled Thumb Nut
  (DIN) and (Inch) from the front, with or without the knurl, or the top.
  Each stands crown or head up with its bearing face on the click.
- **Wing nuts** (the Fasteners tool set): Wing Nut (DIN) and Wing Nut - Type
  A, B, C and D (Inch), their styles (moderate, high, low wings; die cast
  hollow wings; stamped strip with a large base) from the front, side or top,
  wings up with the bearing face on the click.
- **Retaining rings and washers** (the Fasteners tool set): Retaining Ring
  (ASME) as a basic internal or external ring, heavy duty external, basic or
  reinforced E-ring or C-ring in metric sizes; Retaining Ring (DIN) for bores
  or shafts, regular or heavy; and Retaining Washer (DIN 6799) by groove
  size. Each is centred on the click with its gap down, or seen edge on as a
  section or solid, with a locus at its centre if asked.
- **Bolts** (the Fasteners tool set): Eye Bolt (plain, shoulder or bent),
  Swing Bolt, Swing Eye Bolt, T-Bolt, U-Bolt and J-Bolt on any UNC or ISO
  coarse thread, from the front, side, top or bottom, the thread drawn in any
  of the shaft's styles. Eye bolts follow ASME B18.15 and swing eye bolts DIN
  444; a J-bolt can carry a hex or square nut, a lock washer and a narrow,
  regular or wide washer at its bearing length, its anchor left or right.
- **Thumb screws** (the Fasteners tool set): Thumb Screw (Inch) in ASME
  B18.17's Type A and B, regular or heavy, #6 to 1/2 in, with a plain,
  cup/flat, dog, oval or cone point, from the front, side or top; lengths can
  keep to the standard's increments.
- **Fastener** (the Fasteners tool set): one tool for screws, shoulder
  screws, set screws, nuts, plain washers and spring lock washers in ASME
  inch, ASME metric, ISO or DIN sizes, chosen on the Tool bar with the view
  (front, side, top or bottom). Screws and bolts come hex, heavy hex, square,
  flange, socket head, flat and button socket, and slotted machine screw
  heads, with washers and lock washers under the head and washers, a lock
  washer and a nut at the bearing length; their length can keep to standard
  steps or follow the nut. Set screws come with a hex or spline socket, a
  slot or a square head and a cup, flat, dog, half dog, oval or cone point at
  each standard's sizes; shoulder screws by the shoulder's diameter and
  length. Nuts come hex,
  heavy, thick, flat, jam, slotted or castle, square or machine screw as each
  standard lists them, ISO's hex styles plain or washer faced; washers in
  each standard's series (narrow to wide, small to large, regular to
  hi-collar).
- **Shaft** (Machine Components): a click puts a shaft's left end there with
  its axis running right; a press dragged turns it. Preferences open the
  Shaft Configuration, where < Add, Add > and Delete build the shaft segment
  by segment (the current one red in the preview): straight, tapered or
  threaded (inch, metric, custom, Acme or bearing lock nut threads), each end
  plain, chamfered, flared or rounded, and on straight segments a keyway
  (parallel or Woodruff, sized for the diameter), a groove and wrench flats.
  Threads show Simplified (ASME or ISO), Schematic or Detailed, with centre
  drills at either end.
- **Break Line** and **Insulation** (the Detailing tool set): drag a line or
  click its two ends (Shift keeps it to 15° steps). Break Line draws the line
  with a zigzag break at its middle, its height on paper set in Preferences.
  Insulation draws a band of the thickness set in Preferences to the left of
  the line, centred on it or to its right (keys 3 to 5): Batt (key 1) as one
  polyline of loops running end to end, Rigid (key 2) as the band's outline
  crossed corner to corner, grouped. **Repetitive Unit** lays bricks (key 1)
  or blocks (key 2) of the size in Preferences in courses along the line,
  every other course moved half a unit and the units cut at the line's ends.
  **Steel Section** (wide flange, channel, angle, tee, I-beam, rectangular,
  square or round tubing, or Z-section, keys 1 to 9, sized in Preferences;
  **Steel Section - 3D** stands the same shapes up as solids of a Length)
  and **Lumber** (a nominal size such as 2×4 at its dressed
  size, or a custom one; crossed for a continuous member or with one
  diagonal for blocking) place a section with a click, or with a press
  dragged to turn it. **Bulb Flat** places EN 10067's hot-rolled bulb flats
  (HP 120 x 6 to HP 430 x 20) or a custom size the same way, its section
  properties listed in Preferences, with a locus at its centroid or the
  centroid on the click if asked. **Shaft Break** draws a round shaft's
  break, solid or hollow, of the diameter and width in Preferences, on a
  click (a press dragged turns it); **Shaft Break 2** draws one at each end
  of a shortened shaft, a click on each. **Bolt** draws a hex-head bolt from the side, the line
  running from under the head to the tip, its diameter in Preferences.
  **Weld** draws a welding symbol: click the joint, then where the arrow
  meets the reference line, which runs on away from the arrow; a fillet
  (key 1) or V-groove (key 2) on the arrow side, the other side or both
  (keys 3 to 5), and a circle for all around (Preferences). **Screw**,
  **Nail** and **Anchor** draw those fasteners from the side, dragged from
  the head to the tip, their diameter in Preferences. **Carriage Bolt**
  places ASME B18.5's inch round head bolts (plain, short or regular square
  neck) or ASME B18.5.2.2M's and DIN 603's metric square neck bolts, and
  **Lag Screw** ASME B18.2.1's hex or square inch lag screws or B18.2.3.8M's
  metric ones, threaded to a gimlet point; each a click (a press dragged
  turns it) in Front, Side, Top or Bottom (keys 1 to 4), its series, type,
  size and length in Preferences. **Wood Screw** places ASME B18.6.1's inch
  or DIN 95 to 97's metric flat, oval, pan and round head wood screws, and
  **Sheet Metal Screw** ASME B18.6.4's inch or ISO's metric tapping screws
  with flat, oval, truss, pan, hex or hex washer heads and point A, AB or
  B; each slotted, cross or square recessed, placed the same way.
  **Stipple** fills a
  dragged rectangle with dots, even (key 1) or thinning across it (key 2),
  at a density on paper set in Preferences. **Hole - Drilled** places a
  hole seen from the top (key 1) or cut through its axis (key 2), plain,
  counterbored or countersunk (keys 3 to 5), through or blind with its drill
  point (Preferences). **Hole - Tapped (Metric)** and **(Inch)** do the same
  for a coarse thread chosen in Preferences, drawn as ISO 6410 shows
  threads. **Slot**: click each end, then click for its width. **Hole
  Pattern** places round, tapped or slotted holes (keys 3 to 5) in rows and
  columns (key 1) or round a bolt circle (key 2). **Screw Threads** draws an
  external thread from the side, simplified, schematic or detailed (keys 1
  to 3). **Keyway** draws a shaft (key 1) or bore (key 2) cut across with
  its keyway, the key a standard size for the diameter. Vectorworks
  makes plug-in objects of all of these; these are plain objects, grouped.
- **Table and Chairs** (the Furniture/Fixtures tool set): click to place a
  rectangular table (key 1) with a chair for each 600 mm along both long
  sides, and at its ends if Preferences say so, or a round one (key 2) with
  the number of chairs set; a press dragged turns it.
- **Desk**, **Shelving Unit**, **Clothes Rod**, **Bath-Shower**, **Grab
  Bars**, **Fireplace**, **Toilet Stall**, **Cabinet** and **Compartment
  Sink** (Furniture/Fixtures) stand against a wall: a click puts the middle
  of the fixture's back on the point and a press dragged turns it along the
  wall, its front to the drag's right. Desk is straight (key 1) or has a
  left (key 2) or right (key 3) return, with a chair unless Preferences say
  not; Bath-Shower draws a bathtub (key 1) with its drain at an offset from
  the basin's end, or a shower tray (key 2) with falls to a middle drain.
  Toilet Stall draws a row of stalls, its partitions, doors (swinging in or
  out), toilets and turning circles as set in Preferences; Fireplace a unit
  narrowing to the wall with its firebox and a top flue.
  Cabinet draws a base cabinet (key 1) with its counter and back splash, a
  utility cabinet (key 2, crossed) or a wall cabinet (key 3, one diagonal).
  **Compartment Sink** draws a counter with its rolled edge and backsplash
  and a row of rounded bowls, each with a drain.
  Sizes are in each tool's Preferences. Vectorworks makes plug-in objects
  of these; these are plain objects, grouped, drawn as Rodeo draws them in
  plan.
- **Ceiling Grid** (Furniture/Fixtures): drag a rectangle (key 1) or click a
  polygon (key 2) as for Space, for a ceiling with the lines between its
  tiles inside it, their width, length and angle in Preferences, a tile
  centred in the ceiling or the grid laid from the drawing's origin.
- **Seating Section** (Furniture/Fixtures): drag a rectangle (key 1) or
  click a polygon (key 2) as for Space; rows of chairs fill it, facing the
  way Preferences set, the first row at the front, seats centred along each
  row or every other row offset half a seat. A toast gives the seat count.
- **Plant** (the Site Planning tool set): click to place a plant in plan, a
  scalloped (key 3) or round (key 4) canopy of the spread in Preferences
  round a crossed trunk. In Row (key 2) drag a line to place plants along
  it at the spacing in Preferences, each its own group. Vectorworks's plant
  objects carry a plant record; these are plain objects.
- **Hardscape**, **Landscape Area** and **Property Line** (Site Planning):
  drag a rectangle (key 1) or click a polygon's corners (key 2; a
  double-click, Enter or the first corner closes it). A
  hardscape gets a border inside its outline and square paving joints laid
  from the drawing's origin (width, spacing and angle in Preferences); a
  landscape area a cloud boundary (or the outline as drawn) with its name
  and area; a property line each side's bearing and length beside it.
  **Parking Space**: drag along the curb for a row of stalls to its left, at
  90°, 60° or 45° (keys 1 to 3), their width and depth in Preferences.
- **Column** and **Stair** (Building Shell): click to place a rectangular
  (key 1) or round (key 2) column, a press dragged turning it; drag a
  straight stair from its foot to its head for its treads at the going in
  Preferences, its walk line and arrow, its break line and "UP". Vectorworks
  makes plug-in objects of all of these, with 3D; these are plain objects
  in plan, grouped.
- **Simple Stair**, **Ramp**, **Elevator** and **Escalator** (Building
  Shell): click to place one, a press dragged turning it. Simple Stair and
  Ramp run straight, through a landing, turn left or right at one or double
  back beside themselves, with treads (a stair's risers from its height and
  maximum riser), stringers, rails, a path-of-travel arrow with each
  flight's risers and riser height, and a break line where a plan cut 1200
  mm up crosses them. Elevator draws the hoistway, the cab crossed inside
  and its doors (single slide, side bi-pass or bi-part) standing open, front
  and rear. Escalator draws its truss, steps, handrails and balustrades,
  cut Up or Down at the break, with its pit and the opening the floor above
  needs. Plain objects in plan, grouped.
- **Pilaster** (Building Shell): click to put the middle of its shaft on a
  wall's face, a press dragged turning it along the wall. Its shaft
  (rectangular or a half oval), base and capital outlines, its structural
  part (concrete, wood or a steel wide flange) at its offsets with the
  clearance cut round it, centre marks and column ID, as set in Preferences.
- **Railing/Fence** (Furniture/Fixtures): click each corner of its path, a
  double-click or Enter ending it, a click on the first corner closing it.
  Its top rail, posts (at the start, end and corners, and between them by
  approximate distance, fixed distance or number) and frame bars or panels
  are drawn in plan.
- **Stake** (Site Planning): click to place a stake, or press and drag to
  where its label goes, with a leader line back to it; Poly-Vertex (key 2)
  places one at each corner clicked. Its indicator in Vectorworks' eight
  styles and its label (ID, elevation, description or coordinates from the
  drawing's origin) in one of six bubbles, the ID stepping on with each.
- **Fence** (Site Planning): click each corner of its path as for
  Railing/Fence. Its line alone, the line with square or round posts, or in
  full detail its posts (fixed or equal spacing, corner posts lined up with
  either segment or between), rails, board or panel infill on its face side,
  gravel board and the footers hidden below grade, drawn in plan.
- **Curb** (Site Planning): click each corner of its front edge; its
  front edge, front and back lines, or in full detail its units and joints,
  mitred corners and the foundation hidden under it, drawn in plan.
- **Hedgerow** (Site Planning): click each corner of its path, a
  double-click or Enter ending it open, a click on the first corner making
  it a ring. A band its width wide, centred on the path or to its left or
  right, the outside of its corners rounded with Smooth corners; its edge a
  single line, a plant cloud (billows bulging out or in, varying in size) or
  a rough plant line. Afterwards it reports its length, area and how many of
  each plant it takes (by length or area, up to seven plants by
  percentage). Plain objects in plan, grouped.
- **Site Model** (AEC > Terrain, and **Site Modifiers** in Site Planning): select 3D loci
  and 3D polygons and choose Site Model from Source Data, or a closed shape for a flat
  one from Site Model from Boundary. Plan shows contours (smoothed, coloured by elevation
  or slope, or triangles), labels, flow arrows and a cut and fill area; 3D shows a mesh,
  a grid, columns, contours or a layer cake. Draw Grade Limits and Planar Pads with the
  Site Modifiers tool, set their elevation and slope in the Data tab, and Update: the
  model wears a striped border until you do, then shows cut, fill and volumes in Object
  Info. Send to Surface puts what's selected on the ground. Vectorworks' own site models
  aren't changed.
- **Grading** (AEC > Terrain). Create Grade Limits from Planar Pad finds where a batter slope from a pad meets the ground. Create Planar Pad from Grade Limits places a level pad that balances cut and fill. Site Model Section draws existing and proposed profiles with their grid and stations. Create Site Model Volume List reports each triangle's areas and volumes as a text file, group or worksheet. View > Show or Hide Site Modifiers switches their class.
- **Grade** (Site Planning). Two clicks and Grade Settings: any two of the elevations, a grade, a ratio or the change give the slope. Ends in one place share their elevation and move together, an end on a grade splits it, and Update, the checks for grades or elevations out of range, a site model's heights or changing the model as a line of known heights all work on the whole network. AEC > Terrain > Create 3D Loci at Grade Points drops a point at each end.
- **Zone of Visual Influence** (AEC > Terrain). What can't be seen from a point above a site model, as dark ground in plan and 3D, with the share of the site it covers.
- **Editing a site model** (AEC > Terrain): Edit Site Model Crop, Edit Existing or Proposed
  Surface (the Sculptor, Add Vertex and Swale/Berm) and Edit Existing or Proposed Contours. Each edit
  stays a site modifier you can move, reshape or delete, and the ground follows at Update. Sculpting
  is on the plan with a vertical drag.
- **Contour labels and snapshots** (AEC > Terrain). Add Contour Labels along a line of clicks, or
  move, add and delete them one at a time with Edit Contour Labels. Create a Snapshot in a site
  model's Object Info keeps a second picture of the ground that stays as it is until you unfreeze it,
  with an opacity and, for coloured elevations or slopes, a legend.
- **Massing Model** (Site Planning): draw an outline and get a building shell with walls, floors and a hipped or flat roof, its roof or footprint in plan with a name and gross area label, in classes you choose. With Use Site Modifiers it levels a pad under itself and adds grade limits round it. Not done: custom roofs from a profile, or the floor usage worksheet function.
- **Retaining walls** (AEC > Terrain > Create Retaining Wall Site Modifier): from connected walls or an extrude, a modifier that holds the ground at one height on one side of the wall and another on the other, with a pad at its foot. Set each edge by the wall's top or bottom or the terrain; change heights by edge or by corner in Object Info. Wall peaks and stepped walls aren't done, since their format isn't known.
- **Import Tree Survey File** (AEC > Existing Trees): a spreadsheet or delimited survey as existing trees, 2D loci or 3D loci. Map each column to a tree parameter or a location (X/Y/Z, coordinate pairs, latitude and longitude), set its unit, and keep the columns you choose in a custom record. Not done: Height and Condition stay in the record, since Rodeo's trees don't hold them.
- **Survey Input** (AEC). Grid Method Entry types elevations over a grid, Import Survey File reads survey points from a text file or an Excel workbook, either way as 3D loci or stakes a site model takes as source data.
- **More Site Modifiers** (Site Planning). Pad with Retaining Edge, Aligned (its corners take the height of what they touch), Open Edge Line, Spoil Pile and Texture Bed, each one able to apply to the existing or proposed surface. Create Objects from Shapes makes them from selected shapes too.
- **Pathway and Boundary Paths** (Site Planning's Site Modifiers). Draw a centre line with a width, or an outline whose centre line is worked out for you. Set heights along it and across it with longitudinal and transverse profiles, as tables with a small drawing, or Fit to Surface. The site model takes it at its next update. Reshape moves its corners.
- **Space** (Space Planning) and **AEC > Space Planning**: draw a room as a
  rectangle or polygon, click inside walls, or pick the walls round it, and
  its name, number and area are labelled, the numbers counting on. Create
  Spaces from Walls finds every room, or the gross floor, and run again
  reshapes them to moved walls; Create Spaces from Polys converts shapes;
  Create Walls from Spaces makes exterior and interior walls in the styles you
  choose; Update Spaces re-measures them. A space is a group with its data in
  a record, not a Vectorworks Space object, and has no finishes or 3D volume.
- **Space Link, Adjacency Score, Adjacency Matrix, Stacking Diagram** (Space Planning) and **AEC > Space Planning > Import Adjacency Matrix…**: link two spaces with a click on each, and the stronger the link (1 to 18, in Object Info) the heavier its line. The score adds up each link's length × strength, the lower the better; the matrix lists the spaces in a diamond grid of strengths, ordered by each space's Matrix Order; the stacking diagram shows each layer's spaces as wide as their areas, stacked by layer elevation and grouped by Department. All of them follow the spaces as you move them, in the same undo step, and a link goes when its space does. Importing a tab- or comma-delimited adjacency spreadsheet builds the spaces, links, matrix and stacking diagram. They read Rodeo's spaces, not Vectorworks' own Space objects; imported spaces are squares in rows; link length is centre to centre; and the score's unit and Row Spacing 0 files are this app's reading of the help.
- **AEC > Plants > Vegetation Line**: draw one line round selected shapes
  and plant symbols that overlap, following their outer edge or as a cloud of
  arcs, to show a massed planting. Symbols count as the ellipse their box
  holds.
- **Piping Run** (MEP) and **AEC > Electrical > Create Piping Runs**: click
  a run's corners, or turn selected polygons and polylines into runs. It
  works out the length, sections and couplings a run takes, and its elbows
  or bends, and tags it with its size and material. They're worked out once,
  when it's placed, and go in a Piping Run record.
- **GIS**: place a drawing on the Earth with File > Document Settings >
  Georeferencing (local, UTM or Pseudo-Mercator, kept in this browser), then use
  Graticule, Great Circle, Survey Point, GIS Stake and Modify > Move Geographic.
  The Onscreen View Control gets a compass ring. Other coordinate systems and
  background maps aren't there.
- **Create Roof** (AEC): a roof over walls or a closed shape, hipped all round
  with valleys at inward corners, or gabled where you click an edge in the
  dialog. The eave's cut, thickness and levels are set as in Vectorworks. It's
  a plain group of plan and solid, so to change it, make it again.
- **HVAC** (MEP): Straight Duct, Elbow Duct, Flex Duct, Vertical Duct,
  Transition, Splitter, Damper, Diffuser and Outlet each place a plan and a
  solid at the height you set, in a group. Ducts can show a label with their
  size and a marker with the height of their top and bottom. The help covers
  only the general idea, so their options are Rodeo's own; fittings don't join
  up automatically, and there are no flanges or insulation.
- **Bolt and Nut**: Detailing's inch and mm tools place a bolt through a joint
  with its washers, lock washers and nut in standard sizes, in any of four
  views, with a solid for 3D. The length follows the joint or is typed.
- **Machine components in 3D**: gears, racks, sprockets, chains, pulleys,
  bevel gears, worms, keys, shafts, bearings, mounted units and springs each
  have a "- 3D" tool beside the 2D one, with the same sizes, placing a solid
  with its top view for plan. Spur gears and sprockets have real teeth, worms a
  real helical thread, springs real coils. Bevel gears have no teeth, and
  keyways, spokes, set screws and cages aren't modelled.
- **Fasteners in 3D**: Clevis, Dowel, Parallel and Taper Pins, Large, Small,
  DIN and Tubular Rivets, and Acorn, Hex Cap and Knurled Thumb Nuts each have
  a "- 3D" tool beside the 2D one, with the same sizes. A click places a solid
  with its top view for plan, grouped. There are no threads, knurling or
  split pin holes, and acorn and hex cap nuts are closed underneath.
  Cotter Pins, Wing Nuts, Retaining Rings and Washers, Eye, Swing, Swing Eye,
  T, U and J Bolts, Thumb Screws, Carriage Bolts, and Lag, Wood and Sheet Metal
  Screws have them too. Their heads have no slots or recesses, and swing and
  thumb heads are flat plates.
- **Holes in 3D**: Hole - Drilled and Hole - Tapped (Metric, Inch) - 3D place a
  real sweep of the hole, mouth at the layer's level and running down, for
  Subtract Solids to cut from a solid, beside its 2D drawing for plan, not
  grouped with it. A tapped hole is its tap drill's size, with no thread.
- **Existing Tree** (Site Planning): click to place a surveyed tree, or
  press and drag to turn it. Its Preferences set its names, Action
  (Retain, Remove, Transplant Original or Proposed), Significance, number,
  canopy, DBH, root zones and protection zone. It's drawn in plan as a
  group of plain objects named by its number, with no 3D tree, species list
  or worksheet data.
- **Custom Cabinet** (Furniture/Fixtures): click to put the middle of its
  back on the point, a press dragged turning it; its outline in plan,
  crossed with Show Diagonals.
- **Roadway (Straight)**, **Roadway (Curved)** and **Roadway (Tee)** (Site
  Planning): drag a straight road's centre line; click to place a curved
  road (its radius, width and sweep, left or right, in Preferences) or a tee
  (a throat widening through fillets into the road across it), a press
  dragged turning them. The paving, the curbs either side and the joints
  where sections meet, with loci at the arcs' centres; plain objects in
  plan, grouped.
- **Parking Spaces** (Site Planning): click to place a row of stalls along a
  header stripe, or press and drag to turn it. Its Preferences choose Single
  Bay, Double Bay or Parallel, the number and size of spaces, their angle, a
  straight or angled header, accessible spaces with their symbol and aisles,
  which stripes show, numbering, bumpers and 3D stripes. It's drawn as plain
  objects in a group, so to change one, place it again.
- **Parking Along Path**, **Parking Area** and **Roadway (Poly)** (Site
  Planning): click each corner of a path, a double-click or Enter ending it,
  a click on the first corner closing it. Parking Along Path stands stalls
  square to each run on its left, right or both, numbered; Parking Area
  fills an outline with double rows of stalls about header stripes, at the
  row and space angles and lane width in Preferences; Roadway (Poly) runs
  the paving and its curbs along the centre line, a closed path making a
  ring road. Plain objects in plan, grouped.
- **Stage Deck**, **Stage Plug**, **Stage Steps**, **Stage Ramp** and
  **Rope and Stanchion** (Event Design): click to place a deck (its middle on
  the point) or steps or a ramp (the middle of their top on the point), a
  press dragged turning them; click a plug's outline or a barrier's path.
  Rectangular or round decks with railings on the sides chosen and their
  legs at the Reference Spacing; treads, stringers, railings and an UP or
  DN arrow; a ramp's run from its rise and pitch; stanchions along the path
  with belts, ropes or chains between. Plain objects in plan, grouped.
- **Soft Goods**, **Television**, **Video Screen** and **LED Screen**
  (Event Design): click a path for a pleated curtain or border (its opening,
  pipe, track and drape breaks) or a pipe-and-drape run on uprights and
  base plates; click to place a television, a screen with its frame,
  support and projector, or a row of LED modules on their base structure, a
  press dragged turning them to face the pointer, with the coverage zone
  viewers can see a screen from. Plain objects in plan, grouped.
- **Create Lectern** (Stage > Event): choose one of five lecterns in a dialog
  that shows it from the front, the side and above, then click where it
  stands and click the way it faces the audience. A hybrid symbol of the
  lectern's name, made once and placed again; Custom Attributes makes a new
  symbol coloured by a class or with its own fill, pen and texture. Over a
  stage built in 3D (as Create Stage builds one) it stands on the stage's top.
- **Create Stage**, **Create Stair** and **Create Screen** (Stage > Event):
  lay a selected shape with standard stage decks, the pieces its edge cuts as
  smaller decks or stage plugs, each standing in 3D to the stage height (a
  block, or a top on legs, fewer where neighbours meet); click where steps
  meet the stage and the way they come down, fitted to the stage's height;
  pick a projection screen, LED screen or television and click it in place.
- **Create Room** and **Create Views** (Stage > Event): walls round a selected
  shape (the room's inside), plain or in one of the drawing's wall styles,
  mitred at the corners, on a floor; then a Plan View sheet with a plan
  viewport and a Rendered View sheet with a Shaded isometric picture of the
  model (taken when the command runs).
- **Receptacle**, **Switch**, **Comm Device** and **Incandescent Fixture**
  (MEP), and **Speaker** (Event Design): click to place an electrical or
  communication indicator, the same size on paper at any layer scale, its
  stem on the wall and a press dragged turning it off the wall, with its
  config label; or a speaker, its dispersion lines and the coverage shadow
  on the listening plane. Plain objects in plan, grouped.
- **Speaker Array** (Event Design): click to place a bumper with up to
  three kinds of line-array box hung under it, each splayed down from the
  one above, a press dragged turning it; its Column ID, rigging guides for
  one or two hoists, the widest spread's dispersion lines, a tick where
  each box aims at the listening plane and the coverage they share there.
  Plain objects in plan, grouped.
- **Rack Ruler** (Event Design): click beside an equipment rack and toward
  its top for a ruler numbered in rack units, a tick at each, with their
  heights in the drawing's units every five. Plain objects, grouped.
- **Straight Truss**, **Curved Truss**, **Lighting Pipe**, **Lighting Pipe
  Ladder**, **House Rigging Point** and **Hoist** (Rigging): drag a box,
  triangle or ladder truss in its sections (a short last one red), place a
  curved one round a point, click a pipe's path with its end markers and
  tick marks, drag a ladder flat or standing, and place a rigging point or
  a hoist with its ID and X/Y label. Plain objects in plan, grouped.
- **Hoist Origin** (Rigging): click to place a named hoist origin; a
  hoist whose Origin names it measures its X/Y label from it.
- **Outlet**, **Pipe**, **Valve**, **Point of Connection** and
  **Controller** (Irrigation): place spray, rotor or emitter outlets with
  their coverage one at a time, at a path's corners, spaced along it, or
  filling an area in rectangular or triangular rows; click a main, lateral
  or drip line with its flow arrow and size; and place a valve, point of
  connection or controller with its name. Plain objects in plan, grouped.
- **Drip Outlet**, **System Component**, **Design Zone** and **Hydrozone**
  (Irrigation): click a drip line, or an area filled with rows of drip
  line; place a system component with its name; and outline a design zone
  (its Zone ID counting on) or a hydrozone labelled with its water use and
  area. Plain objects in plan, grouped.
- **Blended Screen** (Event Design): place a wide video screen with the
  projectors that share its image, as many overlapping areas as cover it
  at their aspect, each projector its throw away with its cone, or the
  screen alone (key 1). Plain objects in plan, grouped.
- **Bridle** and **Mother Grid** (Rigging): click a two leg, three leg or
  reversed bridle's connection and legs, each leg labelled with its length
  and angle from the bridle's heights; or a mother grid's truss between two
  hoists, a third hoist at its connection. Plain objects in plan, grouped.
- **Cable Path** and **Cable** (Rigging): click a cable path's corners, sharp
  or rounded by its fillet radius; a cable clicked onto a path follows it to
  the point nearest the next click, is sized into the fewest stock cable
  parts with a connector mark where each meets the next, and is labelled with
  its run ID and length. Plain objects in plan, the cable grouped.
- **HopOver** (ConnectCAD Schematics): click a line where another crosses it
  and it hops over the other in a half circle, up or down, a true arc in the
  polyline it becomes; a ConnectCAD circuit keeps its hop over the circuit
  crossing it, which follows as either moves, and a circuit selected first
  takes priority.
- **ConnectCAD Schematics** (Device, Socket, Terminator, Connect; Stage >
  ConnectCAD): draw devices, add input and output sockets down their sides,
  and connect them with circuits coloured by signal that keep to their sockets
  as devices move; number cables by signal letter, source device or sequence,
  and clear them.
- **ConnectCAD drawing commands** (Stage > ConnectCAD): Connect Selected
  joins selected devices' facing sockets at once, or joins them to the device
  clicked; Check Drawing marks duplicate names and numbers, loose circuits and
  mismatched signals as markup in its own class; Clear Markup; Renumber
  ConnectCAD Objects names selected devices in order; the ConnectCAD Status
  palette lists the same issues as you work, with buttons to zoom to each and
  to ignore it.
- **ConnectCAD reports** (Stage > ConnectCAD): circuit reports for the
  active layer or every layer, a device report with totals, a device
  connections report and a parts report, each as a new worksheet (shown in a
  dialog in a drawing that has no worksheet yet).
- **External** (ConnectCAD Schematics): the system's links to equipment
  outside it, one at a click or a numbered row in Linear Array, left or right
  facing, with as many circuits as asked in the Object Info palette; they
  connect, check and report like devices.
- **Socket Loop** (ConnectCAD Schematics): loop two inputs side by side so
  the signal passes through to the next device; the Socket and Socket Loop
  tools also place a whole row down a device's side in Linear Array.
- **Legend** (ConnectCAD Schematics): a key to the signals on a schematic
  layer, each a sample of its circuit line in its colour, its name and how
  many circuits carry it; Refresh Legend reads the layer again.
- **Distribution Amplifier** (ConnectCAD Schematics): video or audio DAs,
  one input (looped through if asked) to several outputs, one at a click or
  a numbered row; a click on a circuit puts the DA in it, splitting the
  circuit at its input and first output.
- **Term Panel**, **Jackfield** and **Linked Jackfield** (ConnectCAD
  Schematics): one port of a panel at a click or a row of them, named by
  panel (JA1) and numbered on; a term panel's port takes a circuit either
  way, and a click on a circuit puts the port in it.
- **Combine Panels** and **Split Panels** (Stage > ConnectCAD): the selected
  ports of one panel made one device with a row each, or a panel device made
  a device a port, their circuits kept.
- **Adapter** (ConnectCAD Schematics): click a device's socket to put an
  adapter on it, a breakout's L and R or one socket of another connector;
  the socket's circuits move to it, it follows its device, and dragged off
  it shows a warning until dropped on another socket.
- **ReRoute Circuits** (ConnectCAD Schematics): the selected circuits
  follow the circuit clicked, bussed on its run with breakout nodes if
  asked, or a dragged distance apart so they run parallel.
- **Device eyedropper** (ConnectCAD Schematics' Device tool): Pick Up a
  device and Apply it to others, or to a selection: same-named sockets take
  its sockets' settings and places, its other sockets are added, and they
  take its make, model, physical and location data; their own sockets are
  kept or deleted as asked.
- **ConnectCAD cable lists** (Stage > ConnectCAD): Convert Report to List
  freezes a report as a list; Compare Cable List and Drawing marks numbers
  that differ and circuits missing from either; Make Connections from List
  draws the circuits a list has and the drawing hasn't. A list is a worksheet,
  or a CSV or Excel file.
- **ConnectCAD devices from a list** (Stage > ConnectCAD): Create Devices
  from Worksheet makes the quantity of each make and model a device list asks
  for, counting the drawing's own first and copying their sockets; columns are
  assigned by heading, and the rest kept in an Imported Device Data record.
- **ConnectCAD Layout Room** (ConnectCAD Layout tool set): a rectangle or
  polygon room with its Room ID, nested rooms naming their contents MAIN.AV1,
  a 3D wireframe unless 2D only; Create Objects from Shapes makes them too.
  The Rack Ruler now sits in this tool set.
- **ConnectCAD Equipment Rack 3D** (ConnectCAD Layout tool set): 4-post and
  2-post racks, consoles and enclosures in plan and 3D, with rails, side panels
  and doors; overall sizes keep whole rack units; Room ID from the layout room
  it's in, power and weight from the equipment and devices racked in it.
- **ConnectCAD Equipment Item** (ConnectCAD Layout tool set): click over a
  rack and equipment goes in at the first free unit, front or rear, full or
  half width; it moves with its rack, leaves it when dragged off, and keeps
  the schematic devices of its name up to date (make, model, size, location).
- **ConnectCAD Create Equipment** (Stage > ConnectCAD Layout): equipment
  for each device name on the chosen layers, linked to its devices, placed
  in its rack at its unit (or below the rack), round its layout room's walls,
  or round the drawing; missing locations listed first.
- **ConnectCAD Rack Frame** (ConnectCAD Layout tool set): a frame or tray in
  a rack with a grid of slots, power supplies at one side and a front door;
  modular equipment goes into its first free slots and moves with the frame.
- **ConnectCAD Adapter Slot** (ConnectCAD Layout tool set): click equipment
  to open its front or rear and place slots for plug-in modules, one at a
  time or in rows and blocks; each one named for a socket of its device shows
  the adapter on that socket, in 3D, detail views and rack elevations.
- **ConnectCAD Make Rack Equipment Worksheet** (ConnectCAD Layout tool set):
  a click, a rack and the columns in your order, and a worksheet lists what's
  in the rack at each position from the top, its free units and totals.
- **ConnectCAD Calculate Cable Lengths** (Stage > ConnectCAD): circuits get a
  length from where their equipment stands in racks, with tails, swan-necks
  and the false floor; ones it can't work out are marked on the drawing.
- **ConnectCAD Cable Route** (a new tool set): draw cable paths at the cable
  heights you choose, rising and dropping where they change and joined into a
  network, and drop points where cables come out to equipment. Calculate
  Cable Lengths finds the shortest way through them.
- **ConnectCAD Analyze Cable Routes and Edit Cabling**: each cable path counts
  the circuits along it, circuits that can't be routed are listed and can be
  marked, and Edit Cabling lists the cables along a path or between two drop
  points, shows a cable's route, adds and deletes spare cables between drop
  points (pre-cabling, on a Spare Cabling layer), and keeps a longer route for
  cables with Select Alternative Route.
- **ConnectCAD Cable Pull Report**: a worksheet of the cables to pull along
  each cable route, by cable type, with how many, the longest and the total
  length, and each type's totals.
- **ConnectCAD Create Rack Elevation and Create Equipment Detail View**: front
  and rear views of the selected equipment racks (a row of them side by side in
  one view), or of single pieces of equipment at a detail scale, as viewports on
  a sheet layer, with the equipment, frames and modules named and the rack
  units numbered.
- **ConnectCAD Create Riser Sheet and Create Cabling Sheet**: a plan viewport
  of the cable network on a sheet layer, either with its cable paths tagged
  with their Cable Count or with the cables between each two places drawn as
  arcs or home runs.
- **ConnectCAD panel layouts**: Create Panel View draws the schematic's
  panel devices as rack-mount panels with their connectors tagged and the
  devices they link to written above; the Panel Connector tool places
  connectors one at a time or in lines and grids; a layout's Panel Builder
  lays out rows of connectors, and Create Schematic Devices makes a device
  from a layout.
- **ConnectCAD Connector Panel** (Schematics): input and output connectors
  of the custom panels at facilities boxes, named by their panel and port
  (CTP_BOX1, MIC01) and numbered on, placed singly or in a row, or in a
  circuit; Edit Device Array moves, renumbers and re-connectors several at
  once and gives them more circuits.
- **Create Labels** (Stage > ConnectCAD, or Lighting Paperwork): label
  sheets from a worksheet report, a label a row on Avery sheets for cables,
  equipment, devices or lighting devices, with each cable's ends, a QR code
  and a colour-coded number. Edit the page and labels in Object Info, what a
  label shows with Edit Label or the Color-Coded Linked Text and Linked QR
  Code tools, and export the pages to PDF.
- **ConnectCAD Settings** (Stage > ConnectCAD): a drawing's own signals,
  connectors, cables and cable lengths, its panel prefixes and sizes, the
  numbering system Number Cables starts on, number format for linear arrays,
  and automatic hopover, so crossing circuits hop each other as they're drawn.
- **Device Builder** (ConnectCAD Schematics): click where a device goes and
  describe it, make and model, sizes, rack units, power and weight and rows of
  sockets, with a preview; it's placed as a device and kept in your devices in
  this browser, to pick again by make and model.
- **Countertop** (Furniture/Fixtures) and **Focus Point** (Rigging): click a
  countertop's corners, its backsplash a line inside the first edges and its
  other corners optionally rounded; a click names and places a focus point,
  an octagon or locus with its name. Plain objects in plan.
- **Linear Material** (Detailing): board, gypsum board, plaster or stucco,
  plywood, built-up roof or corrugated deck drawn along a clicked path, its
  thickness on the path's left past an offset, stippled in the detail types.
  Plain objects, grouped.
- **Rigging Load** (Rigging): click where a point load hangs, a drag along
  the rigging turning its label across or 45° to it, or click a distributed
  load's path; weights in lb or kg, a distributed load's per foot or metre
  (500/10 spreads 500 over 10 units) or its total, labelled with its weights
  and length. Plain objects in plan, grouped.
- **Framing Member** (Detailing): drag a member's span, drawn solid, as its
  centre line, by its width or both, each end square or mitred, a rafter's
  bearing inset and overhang run past its clicks, its label above it. Plain
  objects in plan, grouped.
- **Structural Member** (Building Shell): click a column's section (steel,
  concrete or wood), or a linear or polyline member drawn its breadth wide,
  aligned on its clicks, its ends run on, cut back or mitred, with caps and
  centre marks. Plain objects in plan.
- **Title Block Border** (Dims/Notes): click to place an ISO, ARCH, ANSI or
  custom sheet's border at the layer's scale, its zones lettered and
  numbered in the margins, with grid extensions, crop marks and a title block
  (project, sheet title, drawn by, date, scale, sheet number). Plain objects,
  grouped.
- **Photometer** and **Photometric Grid** (Rigging): click where the light should
  be read, or three clicks for a grid, and each point shows its footcandles or
  lux from every instrument, coloured by thresholds you set. A grid can tilt for
  a raked stage. Click Refresh after moving a light. It uses Rodeo's own beam
  model, not photometric files, so treat the numbers as estimates.
- **Video Camera** (Visualization): click where it stands and click the way it
  faces. Object Info sets its lens and focal length (or angle of view), camera
  body, format, pan, tilt and roll, stand and height, and how its field of view
  shows in plan. Activate Camera (or a double-click) looks through it in 3D;
  Aim Camera pans it toward your next click. Its lenses and bodies are Rodeo's
  generic ones.
- **Equipment Summary Key** (Rigging): click to place a table of the lighting
  devices and plug-in objects in the drawing with their counts, and if you like
  the gels, gobos and circuits in use. Filter it to one position in Object Info,
  choose what it lists with Items and Elements, and click Refresh after changes.
- **Hanging Position** (Rigging, and Stage > Lighting): select pipes, trusses or any
  geometry and use Convert to Hanging Position, or place a position showing a symbol
  with the tool. It's named, its devices take the name, and Object Info renames them,
  sets their trim, numbers them with Auto Number, and inserts a summary of what hangs
  on it. The Lighting Device tool outlines the position it's over and hangs a new device
  on it. Stage > Lighting > Auto Number Positions numbers them all. Moving a position
  doesn't carry its devices, but Select Lighting Devices picks them to move together.
- **Spotlight Numbering** (Stage > Lighting, and Stage > ConnectCAD): number
  lighting devices, or any plug-in object or record, in one or more fields at
  once: unit numbers, channels, DMX addresses by footprint into the next
  universe, with prefixes, letters, steps and limits. Selected objects are
  numbered left to right, top to bottom or zigzag; with none selected, click
  them one by one.
- **Focus Lighting Devices Along Path** (Rigging): select some lighting devices,
  then click a shape or draw a path. Each beam lands on the closest point or is
  spaced evenly along it, previewed as you go. Preferences can mark each spot with
  a focus point.
- **Lighting Device** (Rigging): click where one of 22 generic instruments
  hangs, then where it focuses, with its channel, unit number, colour and
  purpose labelled round it; Automatic Numbering counts unit numbers and
  channels on by their increments. Generic outlines, or any symbol in the
  drawing (Symbol in Object Info), rather than library symbols. A plug-in
  object that Object Info edits and the Stage menu reads.
- **Convert To Lighting Device** and **Replace Lighting Devices** (Stage >
  Lighting): turn selected symbols into lighting devices that show them, aimed
  as they were turned; swap selected devices, or all of them, for another
  generic type or one of the drawing's symbols, keeping their data.
- **Label Legend Manager** and **Assign Legend to Lighting Devices** (Stage >
  Lighting): label legends that pick which fields a device shows (15 of them),
  where round it, in which container, right-reading or turning with it, and at
  what size; the active one goes on new devices, and Use Legend in Object Info
  changes one device's. Create Label Legend from Lighting Device makes a new
  legend from one device's labels.
- **A lighting device's right-click menu**: select the devices of its type, at
  its position, or its hanging position; take it off its position; swap two
  selected devices (each takes the other's place, unit number and position,
  and its circuit, dimmer and patch unless they're ticked to move with it); and
  Refresh Lighting Devices (⌘/). A hanging position's selects the devices on it.
- **Lighting Accessory** (Rigging): click a lighting device to add barn doors, a top
  hat, a color scroller or one of 9 other generic accessories, or Apply to Selection for
  all the selected devices. The device draws it in plan and carries its weight; Remove
  takes it off.
- **Stage menu**: lighting design and theatre set design, from venue to
  paperwork, kept in the drawing. New Venue…, Linesets…, Lighting Section…;
  Sightlines (Audience…, Seat Coverage Map, Masking Solver…, Seating Rake
  Solver…); Scenes (a palette of scenes to go to and scrub through with
  collision warnings, Shift Plot…, Spike Sheet…); Scene Shop (New Flat…, New
  Platform…, Cut List…, Model Box Cut Sheet…); Lighting (Show Beam Pools, Light
  Coverage Map…, Wash Planner…, Looks, Show Beams in 3D, Gel and Paint
  Matrix…, DMX Patch…); Lighting Paperwork (Paperwork…, Patch…, USITT ASCII and MVR, Focus
  Cards…, Magic Sheet…, Inventory and Equipment List…, which sets the
  equipment in the drawing against vendors' and venues' inventories); Loads
  and Power (Load Check…, Power Balance…);
  Visualization (Manage Scenes…, which saves and recalls every lighting
  device's color, position and focus with the channel levels, and Animate
  Scenes…, a movie of the fade from one scene to another, and Set Spotlight
  Rendering Options…, the shadows, lit fog, sky and light levels for a lit
  stage in one place); and Show Audit…. The Theatre tool set has Stage Origin, Focus Instrument and
  Spike Mark. Light and load figures are estimates for planning.
- **Lighting device data**: File > Export > Export Lighting Device Data… writes every instrument's fields as tab-delimited text for Lightwright or a spreadsheet, UID first, choosing the fields with All, User, None and saved sets. File > Import > Import Lighting Device Data… reads such a file (or CSV, or an Excel sheet) back: pick the Unique ID Field, AutoLink or link the columns, and the matched instruments update in one undo step. Rows that match none come in as new instruments below the drawing.
- **Ganging** (Rigging): click two or more lighting devices, the last with a
  double-click or Enter, then where the two-fer's label goes: a line from
  each device to one joining line, square, rounded or curved at its outer
  corners, labelled with the shared channel, dimmer or circuit, in a circle
  if wanted. Plain objects, grouped.
- **Leader Line Simple** and **Leader Line** (Basic): click a shoulder and a
  leader with the Attributes palette's arrow, or click where a leader points
  and where it meets a level shoulder on the text's side, its own arrow, dot
  or slash at the point. Open polygons with real line markers.
- **Torsion Spring - Front** and **Torsion Spring - End** (Machine
  Components): close-wound coils with a leg up or down at each end, in front
  of, behind or beside them; or the coils' ring with two tangent legs at their
  deflections, plain, bent a quarter, half or three-quarter turn, or looped.
  Plain objects, grouped.
- **Distributor** and **Electrical Component** (Rigging): click a power
  distributor's rectangle with its outputs numbered along it, its ID counting
  on and an optional output length circle; or a power source, input,
  overcurrent protector, output or consumer glyph. Plain objects, grouped.
- **Hyperlink** (Dims/Notes): click to insert a link to a webpage, a saved
  view or a sheet layer, drawn as its label beside a chain link, or a QR code
  of any text or URL. Cmd-click it with the Selection tool (or Open Link on
  its right-click menu or in Object Info) to follow it; Object Info edits it.
  A Hyperlink plug-in object.
- **Section-Elevation Line** (Dims/Notes): click a straight or broken cut
  line with a numbered bubble past each end, past its start only, or on its
  middle for an elevation, looking left or right; optionally gapped, its
  bubbles scaled. Plain objects, grouped.
- **Flyover**, **Translate View** and **Walkthrough** (Visualization, and
  beside Pan and Zoom): set what a drag does in the 3D view, showing it when
  picked in Top/Plan. Flyover turns the view about its centre, a clicked
  origin or the selection's middle, at the sensitivity its Preferences set;
  Translate View slides the view or moves it in and out; Walkthrough stands
  the viewer at the Viewer Height in perspective, then walks, looks around
  or rides up and down.
- **Align and Distribute** (Rigging): with lighting devices or other
  objects selected, click a guide line and they move onto it: aligned
  square onto it, or distributed evenly between its ends, evenly inside
  them, or at an interval from its start.
- **Dimensions** (D): horizontal, vertical or (with Shift) aligned linear
  dimensions; chains (key 2: each further click dimensions on from the last
  point along the same line) and baselines (key 3: every dimension from the
  first point, the lines stacked outwards), finished with Enter or a
  double-click; ordinates (key 4: click the datum, place the line, then click
  each point for its distance from the datum); and (keys 5, 6, 7) radial,
  diameter and angular ones, with architectural ticks, sized for the layer scale and put in the "Dimension"
  class. Linear, chain and baseline dimensions are Vectorworks dimension
  objects when the drawing has a plain linear one to copy: a copy of the one
  in the text size most share, its extension lines, dimension line and value
  redrawn for the new points with its spacing, text and markers (a chain or
  baseline is a group of them). Otherwise, and for the other kinds, they are
  a group of lines and text, the way an exploded Vectorworks dimension
  looks. Selected, a linear dimension object (one drawn plainly, as most
  are) shows a Dimension section in Object Info: the length it measures, its
  angle, its start and end points, its offset and its value. A change
  redraws its lines and value in its own standard, one undo step; moving a
  point or turning it leaves the dimension line where it was (or as far from
  the start point, when it turns), and its value measures again unless it
  said something else. Dimension objects aren't associative; they are
  untested in Vectorworks.
- **Chain dimensions on the right-click menu**: right-click a chain's
  witness line for Split Dimension (two chains meeting there, the second
  selected) or Delete Witness Line (the dimensions either side become one,
  its value measured again; at an end, the end dimension goes); right-click
  a dimension in it (its line, markers or value) for Split Dimension (that
  dimension goes, the chains either side stay) or Edit Dimension (the chain
  opened with that dimension selected, for Object Info). Add Dimension(s),
  on a chain or a linear dimension on its own, takes clicks where new
  witness lines end: one between two splits that dimension there, one past
  an end adds a dimension to it (a lone dimension becomes a chain);
  double-click or Enter ends, Backspace takes back the last. A chain left
  with one dimension is that dimension on its own. One undo step each (each
  click, for Add Dimension(s)). Delete Dimension isn't there yet.
- **Arc Length Dimension** (Dims/Notes): click a circle or arc where the
  stretch starts, click where it ends, then move out (or in) and click to
  place a dimension arc about the same centre with the stretch's length.
  Witness lines run square to the stretch's chord (key 1; along radii past a
  half turn) or along its radii (key 2); a small arc over the value shows it
  measures along an arc (key 3) or not (key 4). On a circle the stretch is the
  side the pointer is on. Grouped lines, arcs and text in the "Dimension"
  class, as the Dimension tool's angular dimensions are.
- **Slope Dimension** (Dims/Notes): drag along a slope, or click its two
  ends. Rise over Run (key 1) sets a right triangle on the line, its level
  side labelled with the base (12 by default) and its upright side with the
  rise; Ratio (key 2) sets base:run over the line (1:2), Percent (key 3) and
  Degrees (key 4) the slope as those. Preferences hold the two bases, Rise
  over Run's Scale Factor and Draw Roof Surface, which adds the line itself,
  dashed in the drawing's first dashed line type.
- **Feature Control Frame** (Dims/Notes): a click places a GD&T frame, its
  left end there, or a press dragged turns it. Preferences hold its
  geometric characteristic (fourteen, drawn as lines and circles rather than
  font glyphs), Composite Box, the tolerance with a diameter symbol, a
  material condition (M, L or S), Statistical Tolerance and a Projected
  Tolerance Zone with its height (in the frame or under it), and up to three
  datum references with their own material conditions.
- **Geom Dim and Tol Note** (Dims/Notes): a click places a hole or taper
  note, or press where its arrow points and drag to its shoulder for a
  leader. Round, square, counterbore and countersink holes with their size
  and depth (or angle), conical and flat tapers as a ratio, or a depth
  alone, the symbols drawn as lines; each value with no tolerance, ±, + over
  −, or its limits stacked or in a line, to a set precision, in decimal
  inches in a feet-and-inches drawing.
- **Welding Sym-Fillet, -Flange, -Groove, -Misc and -Slot-Plug** (Dims/Notes),
  each in an AWS and an ISO version: click the joint, then where the arrow
  meets the reference line. Preferences hold what each side of the line says
  (sizes, lengths and pitch, groove symbol and angle, flange radius, spot,
  seam, stud or surfacing, plug or slot), ISO's configuration with its
  dashed identification line, finish contour and method, stagger, a tail
  with up to three note lines, weld all around and a field weld flag.
- **Eyedropper** (I): click to pick up an object's attributes and class,
  Option-click to apply them (Shift+Option also applies the class), Cmd-click
  to use them for new objects.
- **Attribute Mapping**: lays the selected object's hatch, tile or gradient.
  Drag the square to move the fill, the first circle to turn it (and scale a
  tile or a gradient), the second to skew a tile or a hatch; Shift keeps the
  first axis to 15° steps and the second square to it. The fill follows the
  drag and is one undo step; Esc abandons it. An object without a fill
  mapping gets one, copied from another in the file. Right-click an object
  whose hatch has been laid this way for New Hatch from Locally Mapped
  Hatch: a new hatch, named in a dialog, with the laying in its lines,
  which the object takes (its mapping set back) and others can use.
- **Visibility** (Basic): click an object to show, gray or hide its class
  (1) or its layer (2): Show 3, Gray 4, Hide 5. Option-click sets every
  other class or design layer instead, which leaves the one clicked alone on
  screen when hiding. The active layer stays shown. Each click is one undo
  step.
- **Tape measure** (N): length, angle and ΔX/ΔY between two points, or in
  Multiple Segment mode the length of a clicked path, segment by segment
  with its running total (double-click or Enter ends it). Object
  Info shows the length, area and perimeter of the selected object.
- **Dimension Tape** (Dims/Notes): click its start and end (or drag), then
  where it lies: a line with hash marks, subdivisions between them and each
  mark's distance from 0, counted from its start or its middle, either way.
- **Protractor** (Dims/Notes): click the angle's vertex, a point along one
  side, then move to the other: an arc between the sides with the angle the
  smaller way round, the larger one and the sides' directions under it. A
  click freezes it; Shift keeps a side to 15° steps; Esc clears.
- **Zoom** (⇧Z): click to zoom in, Option-click to zoom out, drag a box.
- **Repeat Last Command** (Edit menu, and both right-click menus): runs again
  the last command run from a menu, its key or a right-click, greyed when it
  doesn't apply now. Edit > Recent Commands lists the last ten, latest first,
  to run one again. Commands of the File, Window and Help menus, Undo, Redo
  and the clipboard's aren't repeated; the list lasts while the page is open.
- **Create Similar Object** (Edit menu, and the right-click menu): makes the
  tool that draws the selected object the active one, with that object's
  attributes for new objects and its class as the active class. The Wall,
  Slab, Door, Window and plug-in tools copy the kind it is (or say they
  can't, keeping theirs), the Symbol tool places its symbol, the Text tool
  takes its justification and size on paper, the Light tool its kind.
  Groups and 3D objects have no tool to ready.
- **Activate Class** and **Create Class Using Object Attributes…** (the
  right-click menu on an object, selected or not): the first makes the
  object's class the active class; the second asks a name for a new class
  (with Edit properties after creation to change its attributes first),
  gives it the object's fill, pen, line style, weight and opacities, and
  puts the object in it taking them from the class. One undo step.
- **Update Class Attributes from Object…** (the same menu): gives a class
  already there the object's fill, line style, pen colour, line weight or
  opacity, those ticked, and with Assign puts the object in the class taking
  them from it. One undo step.
- **Active Layer Scale…** (the right-click menu off any object): the Layer
  Scale dialog, with the usual architectural, engineering and metric scales
  or 1:n typed, for the active design layer or, with All Layers, every one.
- **Duplicate** (the right-click menu on a layer or class in the
  Navigation palette, and a button in the Organization dialog): a layer comes with its scale, elevation, view or
  page and a copy of everything on it, just after it in the stacking
  order; a class with its attributes, texture, text style and visibility.
  The copy is made active, with its name ready to edit.
- **Force Select** (the right-click menu over an object that a click
  can't select, because it is on another visible design layer or in a
  visible class that isn't active): makes the object's layer and class
  active where it needs to and selects it. **Activate Layer** and
  **Activate Class** beside it only make its layer or class the active one.
- **Select Coincident Objects…** (the right-click menu over an object): lists
  every object a click there could pick, topmost first, with its place in
  the stacking order, kind and name; those picked are selected as they are
  picked, and OK keeps them. Holding J (the Coincident Selection key, as
  Vectorworks keys it) while the Selection tool clicks opens it there too.
- **Select Objects of Same Symbol** (the right-click menu over a symbol
  instance): selects every instance of that symbol on the active layer, or
  in the group or symbol being edited.
- **Convert Arc to Radius Polyline** (the right-click menu over a polyline
  with arc vertices): makes its arc (fillet) vertices radius vertices, which
  lie on the curve, so dragging one reshapes its arc; fillets on one circle
  become one radius vertex. The curve stays as it was. One undo step.
- **Select Similar** (Edit menu, and a Basic tool): selects the objects like
  one, matching on the attributes ticked in Select Similar Preferences (the
  tool's preferences): object type, class, symbol definition and plug-in
  (the defaults), fill style, colours and opacity, pen style, colours,
  thickness and opacity, font, size, style, alignment and text style, a
  wall's or slab's style and thickness, and line end markers, each group
  with an All box; kept per browser. The menu command adds the objects like
  the selected ones; the tool selects those like the one clicked, among the
  layer's (Select any Object, 1) or the ones selected (Current Selection,
  2), Shift adding to the selection; **Select Connected
  Objects** adds every line, open polyline or polygon and partial arc that
  meets a selected one end to end, and those that meet them, on the layer
  or in the group being edited. **Invert Selection** selects what Select All
  would that isn't selected, and lets go of what is; **Previous Selection**
  brings back the selection before this one, and again goes further back,
  through the last 20 (on another layer it makes that layer active).
  **Custom Selection…**
  selects the objects on the active layer that meet every criterion set:
  type, class, symbol, fill colour, pen colour or line weight, each "is" or
  "is not" one of the values the layer has. It replaces, adds to or removes
  from the selection.
- **Snapping**: endpoints, midpoints, centres, intersections, points on
  objects and the grid, with a label at the cursor. While a line, polyline,
  polygon, double line, dimension or measurement is drawn from a point, the
  points where it would touch a circle or arc (tangent) or meet a straight
  edge square (perpendicular) snap too. Then there are smart points: rest
  the cursor on a point snap for a moment to acquire it (a small cross marks
  the last four), then away from objects the cursor lines up with it
  horizontally or vertically along a dashed guide, or runs on along the
  extension of a slanted edge that ends there. Each kind turns on and
  off in the Snapping palette, whose Snap Settings… button sets the snap
  radius and a fixed grid spacing (or one that follows the zoom). Shift
  constrains angles to 15°. The data bar shows live coordinates, length and angle; Tab lets you
  type exact values. Window > Data Bar Options shows it always or only once
  Tab is pressed, below the cursor or above it, and lets a number typed
  while it shows start its first field (keypad numbers too, the main keys
  only, or neither, the default, so the 3 key keeps showing the 3D view).
  It shows each tool's own fields (length and angle, ΔX and ΔY, or the
  radius), those and ΔX and ΔY, or those and the point's X and Y too; Tab
  past the last one shown brings out the rest unless turned off. A typed X
  or Y places the point there, else a typed ΔX or ΔY, else the tool's own
  fields. The Snap Loupe, as Vectorworks keys it: Z over the
  drawing opens a round window magnifying it 4× at the pointer (Z again
  doubles it, up to 64×), where snap points too close to pick come apart;
  with the pointer in it the tools get the point under it there, snapped as
  finely, a click acting on it and closing the window. Escape, a click
  outside or a zoom or pan closes it without acting. G over the drawing sets
  a SmartCursor datum, as Vectorworks keys it: a temporary origin, marked
  with a small circle, that the data bar's and status bar's X and Y are
  measured from (typed ones too) and the cursor lines up with; G over it
  releases it. Data Bar Options can bring the bar out, ready to type, as a
  datum is set. F opens Quick Search (Tools menu), as Vectorworks keys it:
  Search Everything, which finds the menus' commands, the tools and the
  Quick Preferences (set in place there) with the drawing's layers,
  classes, views, symbols and objects. Fillet's key is ⇧F and
  Connect/Combine's ⇧J, leaving F and J to Vectorworks' uses. Smart Point Settings (right-click the Snapping palette's
  Smart points button, or Tools > Smart Point Settings…) set how long a rest
  acquires a smart point or sets a datum, and a datum offset whose points
  along the datum's extensions snap. While the Selection tool moves things,
  the data bar shows how far, and where the dragged point is from the datum.
- **Grid**: show/hide it from the grid button at the foot of the drawing or with Cmd+';
  Cmd+Shift+' toggles snapping to it.
- **Rulers** (View > Rulers): rulers along the top and left of the drawing,
  marked in the document's units at the zoom (feet and inches in feet or
  inches, the other units as plain numbers in the unit), with a mark on each
  following the pointer; the bars over the drawing move clear of them. Not in
  3D or in exports; this browser keeps the choice.
- **Undo/redo** for every edit, pan/zoom, fit, zoom to selection; View >
  Previous View and Next View step back and forth through the views shown
  (a zoom or pan counts once it has settled). View > Fit to Objects (⌘6)
  fits the selection, or everything when nothing is selected, in the plan or
  the 3D view. View > Fit to Page Area fits a sheet's page in the window, and Normal Scale shows the drawing as large as
  it prints at the active layer's scale. Line weights keep their width
  on screen at any zoom; View > Zoom Line Thickness draws them at their size
  on paper instead, so they thicken as the drawing is zoomed in (as printed
  at actual size; this browser keeps the choice; exports are unaffected).
- **Export and print**: PDF (vector, one page per layer at its scale, or
  fitted to A4–A0, Letter or Tabloid; choose the layers and whether hidden
  classes print; images and viewport renders as images, each written once,
  JPEG as it is and PNG with its transparency; text in Helvetica, bold or
  oblique as it is, narrow fonts set narrow; a sheet layer prints on its own
  page, 1:1, unless a paper size is picked), File > Print (⌘P), File > Page
  Setup… (a sheet layer's page: an ARCH, ISO or US size or a custom one, for
  one sheet or all; drawn as an outline centred on the sheet's origin), File >
  Document Settings > Units… (the length unit, from millimetres to miles or
  feet and inches, with its area and volume units; nothing moves, lengths show
  and are typed in the new unit), DXF (R12, in the document's units), SVG,
  Export EPSF (the layers shown on one page at the active layer's scale, as
  Encapsulated PostScript: vector line work, fills and Helvetica text, see-through
  colours mixed with white, images and drop shadows left out), Export Metafile
  (the same page as a Windows enhanced metafile, .emf, its text in Arial)
  and Export Image File… (PNG, JPEG, TIFF or BMP at a typed resolution and
  the layer scale, all the visible objects or the part the window shows, in
  colour, greyscale or black and white, PNG and TIFF optionally on a
  transparent background). File > Export OBJ and
  Export glTF write the 3D model of the design layers the 3D view shows (in
  metres, y up; an object per mesh under its layer, with its colour and
  opacity). Export IFC writes the same model as IFC4 for BIM tools: a storey
  per design layer, each object a wall, slab, roof, door, window, stair,
  column, beam or railing when its plug-in name says so (else a building
  element proxy), its triangles as coloured tessellated face sets in
  millimetres, each storey placed at its layer's elevation, and each object's
  records (a plug-in's parameters too) as property sets, which ArchiCAD and
  Revit show as properties; materials and openings are not carried over.
  Export Rhino 3DM writes a Rhino file in millimetres: a Rhino layer per
  design layer with a sublayer per class, each object's pieces as meshes in
  their colours, and the 2D linework that stands for nothing in 3D (lines,
  rectangles, polygons, polylines, arcs, circles, and text as text dots
  sized in points by its layer's scale) at its layer's elevation. Export FBX writes binary FBX 7.4 (centimetres, y up, a null
  per layer holding a mesh per object, a material per colour) for Blender,
  3ds Max, Maya, Unity and Unreal. Export Collada (SketchUp) writes COLLADA
  1.4.1 in metres, z up, a node per layer and object, which SketchUp's
  File > Import and Blender read at full size with its colours. Export PLY writes binary PLY in
  metres, z up, with vertex colours. Export
  3DS writes it for older 3D packages (metres, z up, a material per colour,
  objects numbered and split at the format's 65535 vertices). Export STL…
  writes it for 3D printing, as Vectorworks' Export STL does: the selected
  objects on the active layer (all of it when nothing there is selected), the
  active layer, or every visible design layer, binary or ASCII, in
  millimetres with z up, as the 3D view draws curved surfaces (no colours).
  Export USD… writes the same model as Universal Scene Description, as
  Vectorworks' Export USD does: organized by layer or by texture (combining
  each texture's objects into one mesh, if asked), each object with its name,
  type, id, class and layer (and its records' values, if asked) as `vw:`
  attributes, colours and textures as UsdPreviewSurface materials, as a
  .usdz package or as text (.usda, or .usd holding text; with textures, a
  zipped folder of the scene and its images). Metres, y up. No binary .usdc
  and no IFC data; Export USDZ (AR)… stays for AR viewers.
  Export KML… writes it for Google Earth: at the drawing's georeferenced place,
  or at a reference point's latitude and longitude typed in, a folder per layer
  and a placemark per object. It's plain polygons in the objects' colours, with
  no textures or KMZ, and it hasn't been opened in Google Earth itself.
  File > Export >
  Export Worksheet… saves one of the drawing's worksheets (the selected
  worksheet image's, else the first) as tab-delimited text, as CSV with
  commas or semicolons, in UTF-8, as DIF or SYLK (in Windows-1252, as Excel
  reads them), or as an Excel workbook (.xlsx, plain numbers as numbers): the
  values as last calculated, database
  rows as their objects' rows (as on a sheet), a merged cell's text in its
  first cell. Export Database… saves every record of one record format the
  drawing's objects hold, a row per object and a column per field, as
  tab-delimited text or CSV, with the field names first when ticked. File > Import > Import Worksheet… (or a dropped .csv, .tsv,
  .dif, .slk or .xlsx) brings any of those back as a new worksheet named
  after the file, which opens in the worksheet editor: a workbook of several
  sheets asks which (Excel Import Options), plain numbers become number cells
  with their decimals, and a workbook keeps its bold, alignment and column
  widths, its dates as text and its formulas' last calculated values (a
  formula saved without one is left empty, and said so). Text files are read
  as UTF-8, or Windows-1252 when they aren't; Excel 97–2004 (.xls) workbooks
  aren't read yet, nor is a reference to the file kept. Like Create Report,
  the worksheet copies its settings and font from one the drawing has, so a
  drawing with none can't import one yet. File > Publish… exports chosen sheets and layers at once: one PDF
  with a page each, or a PDF, SVG or DXF file each, written into a folder
  where the browser can (else downloaded in turn). Saved views publish to
  PDF too, a page each after the layers: what opening the view would show
  (its layers and classes, with its display options and, when its
  Visibility box is ticked, its visibility), cropped to the area it shows
  on the canvas at its present size. Publishing sets keep a choice under a
  name, per drawing, in this browser.
- **DXF import**: lines, polylines (with bulges), circles, arcs, ellipses,
  text, points (as 2D loci) and block inserts; each DXF layer becomes a class, and the import is
  one undo step.
- **PDF import**: one page's line work and fills as lines and polygons (holes
  kept) in the drawing's nearest colours at their line weights, and its text
  as text objects on their baselines, angles and sizes; at the page's paper
  size at a chosen scale (the layer's by default), as one group and one undo
  step. Form XObjects are followed; pictures, shadings and clipping are left
  out and counted. The reader (`web/src/import/pdf.ts`, no dependencies)
  finds objects by scanning, so damaged cross-reference tables don't matter;
  encrypted files are refused.
- **Python scripts** (Plug-ins > Run Script…, and Tools > Plug-ins as in
  Vectorworks): Python written for Vectorworks runs on the open drawing in a
  window that keeps the script in this browser, opens and saves `.py` files,
  and shows what it prints, with a failing line linked. It runs in Pyodide in
  a Web Worker (fetched from jsDelivr the first time, about 11 MB) with a `vs`
  module of 157 of Vectorworks' calls: drawing (Rect, Oval, Arc, Poly,
  BeginPoly with ArcTo, CurveTo and CurveThrough, Locus, CreateText,
  BeginGroup…), walking the drawing by handle (FSActLayer, NextObj,
  ForEachObject and Count with search criteria, ForEachObjectInLayer), reading
  and setting geometry, class, name, attributes, records and selection,
  moving, turning, scaling, mirroring and duplicating, layers and classes, and
  the dialogs (StrDialog and the others wait for the answer where the browser
  can pause WebAssembly, as Chrome can). The script works on a copy of the
  drawing taken as it starts, so it sees its own changes; they are applied
  when it ends, as one undo step, and a script that fails or is stopped
  changes nothing. Calls Rodeo lacks say so by name. Lengths are in the
  drawing's units (inches for feet and inches); colours are the drawing's
  nearest palette colour; attributes a script hasn't set on a new object read
  as 0 until it ends.
- **Vectorscript** in the same window (a `.vs` or `.px` file, or a script
  that starts with PROCEDURE or FUNCTION): translated to Python in the worker
  (`web/src/features/python/vscriptModule.ts`) and run on the same calls by
  their Vectorscript names. Nested procedures and functions keep their
  variables in frame objects, so a nested routine reaches its parent's and a
  VAR argument is a reference to a variable, array element or record field;
  arrays keep their own bounds, records and arrays copy on assignment, and
  lengths written with `'` and `"` become the drawing's units. The vs
  procedures that hand values back through VAR parameters (GetBBox, GetUnits…)
  fill the variables from what the Python call returns, and search criteria
  written out (`((T=RECT) & (SEL=TRUE))`) are passed as text. Errors are given
  at the Vectorscript's own lines. {$INCLUDE}, WITH and GOTO are refused.
- **Script palettes** (Window > Script Palettes): named palettes of Python
  scripts and Vectorscripts, shown a section each in the Script Palettes
  palette; double-click a script to run it on the open drawing (one undo
  step; an error opens an alert with its line). Right-click a palette to add
  a script in the Script Editor or import one from a file, or to rename or
  delete it; right-click a script to edit, rename, duplicate, export or delete
  it. Vectorworks keeps script palettes in the drawing; Rodeo keeps them in
  this browser, the same for every drawing.
- **Export Script and Import Script** (File > Export, File > Import): the
  drawing written as a Vectorscript that draws its design layers' 2D objects
  again, in their classes and stacking order with their names, attributes and
  turns (`web/src/features/python/exportScript.ts`), and a script file run in
  the Run Script window. The script's header counts what it leaves out
  (symbols, plug-in objects, 3D, images, sheet layers) and what it writes
  plainer (hatches and dashes as solid), and it refuses to run in a drawing
  of other units, since its coordinates are in the drawing's own.

The format library in `web/src/core` has no DOM dependencies:

```ts
import { openVwx } from "./src/core/index.ts";

const session = openVwx(bytes, "drawing.vwx");
const layer = session.doc.layers()[0];
session.addObject(layer.id, { kind: "line", a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } });
session.renameLayer(layer.id, "Plan");
session.undo();
const out = session.doc.toBytes();
```

There is also a Node command line for the same library:

```bash
npm run vwx -- info drawing.vwx
npm run vwx -- layers drawing.vwx
npm run vwx -- svg drawing.vwx out.svg
npm run vwx -- dxf drawing.vwx out.dxf
npm run vwx -- pdf drawing.vwx out.pdf [--layer NAME ...]
npm run vwx -- roundtrip drawing.vwx
```

## Python tool

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

## Layout

| Path | What it does |
|---|---|
| `web/src/core/` | format library: container, Snappy, records, geometry, attributes, document model, edit session with undo |
| `web/src/app/` | editor UI: canvas renderer, tools, panels, file I/O, the 3D view |
| `web/src/import/`, `web/src/export/` | the other formats: DWG, DXF, PDF, IFC, Revit, Archicad, SketchUp, meshes |
| `web/src/features/` | self-contained features (agents, collaboration, plug-ins, search, stage, ...) |
| `web/src/platform/` | the editor's side of the server's API |
| `web/scripts/vwx.ts` | Node command line |
| `web/vendor/` | generated third-party builds (rvt-rs) |
| `server/` | accounts, cloud drawings, collaboration, billing; `server/scripts/` holds its tests |
| `cloudrender/` | the GPU render worker (Modal) |
| `openvwx/`, `tests/` | Python reader, edits, SVG, viewer, and its tests |
| `docs/` | the server's API and environment, and how to run your own |
| `brand/` | the Rodeo logo and icons |
| `FORMAT.md` | the format notes: start here to contribute |
| `PARITY.md` | the checklist of Vectorworks features and Rodeo's progress |

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
