# Site and landscape

This page covers site models, grading, planting, hardscape, roads and parking, surveyed trees and georeferencing. The tools here are all in the Site Planning tool set.

## Site model and terrain

### Site Model

Select 3D loci and 3D polygons and choose **AEC › Terrain › Site Model from Source Data**, or select a closed shape for a flat one from **Site Model from Boundary**.

Plan shows:

- contours (smoothed, coloured by elevation or slope, or triangles)
- labels
- flow arrows
- a cut and fill area

3D shows a mesh, a grid, columns, contours or a layer cake.

**Send to Surface** puts what's selected on the ground.

**Limits:** Vectorworks' own site models aren't changed.

### Editing a site model

These are in **AEC › Terrain**:

- **Edit Site Model Crop**
- **Edit Existing or Proposed Surface** (the Sculptor, Add Vertex and Swale/Berm)
- **Edit Existing or Proposed Contours**

Each edit stays a site modifier you can move, reshape or delete, and the ground follows at Update. Sculpting is on the plan with a vertical drag.

### Contour labels and snapshots

**AEC › Terrain › Add Contour Labels** adds labels along a line of clicks. **Edit Contour Labels** moves, adds and deletes them one at a time.

**Create a Snapshot** in a site model's Object Info keeps a second picture of the ground that stays as it is until you unfreeze it, with an opacity and, for coloured elevations or slopes, a legend.

### Zone of Visual Influence

**AEC › Terrain › Zone of Visual Influence** shows what can't be seen from a point above a site model, as dark ground in plan and 3D, with the share of the site it covers.

## Grading and site modifiers

### Site Modifiers

Draw Grade Limits and Planar Pads with the **Site Modifiers** tool, set their elevation and slope in the Data tab, and **Update**. The model wears a striped border until you do, then shows cut, fill and volumes in Object Info.

### Grading commands

These are in **AEC › Terrain**:

- **Create Grade Limits from Planar Pad** finds where a batter slope from a pad meets the ground.
- **Create Planar Pad from Grade Limits** places a level pad that balances cut and fill.
- **Site Model Section** draws existing and proposed profiles with their grid and stations.
- **Create Site Model Volume List** reports each triangle's areas and volumes as a text file, group or worksheet.

**View › Show or Hide Site Modifiers** switches their class.

### Grade

The **Grade** tool takes two clicks and Grade Settings: any two of the elevations, a grade, a ratio or the change give the slope.

Ends in one place share their elevation and move together, and an end on a grade splits it. Update, the checks for grades or elevations out of range, a site model's heights, and changing the model as a line of known heights all work on the whole network.

**AEC › Terrain › Create 3D Loci at Grade Points** drops a point at each end.

### Retaining walls

**AEC › Terrain › Create Retaining Wall Site Modifier** makes, from connected walls or an extrude, a modifier that holds the ground at one height on one side of the wall and another on the other, with a pad at its foot. Set each edge by the wall's top or bottom or the terrain; change heights by edge or by corner in Object Info.

**Limits:** wall peaks and stepped walls aren't done, since their format isn't known.

### More Site Modifiers

More Site Modifiers, each one able to apply to the existing or proposed surface:

- **Pad with Retaining Edge**
- **Aligned** (its corners take the height of what they touch)
- **Open Edge Line**
- **Spoil Pile**
- **Texture Bed**

**Create Objects from Shapes** makes them from selected shapes too.

## Massing models

### Massing Model

With the **Massing Model** tool, draw an outline and get a building shell with walls, floors and a hipped or flat roof. Plan shows its roof or footprint with a name and gross area label, in classes you choose. With **Use Site Modifiers** it levels a pad under itself and adds grade limits round it.

**Limits:** custom roofs from a profile and the floor usage worksheet function aren't done.

## Planting

### Plant

With the **Plant** tool, click to place a plant in plan: a scalloped (key <kbd>3</kbd>) or round (key <kbd>4</kbd>) canopy of the spread in Preferences round a crossed trunk. In Row (key <kbd>2</kbd>), drag a line to place plants along it at the spacing in Preferences, each its own group.

**Limits:** Vectorworks' plant objects carry a plant record; these are plain objects.

### Hedgerow

With the **Hedgerow** tool, click each corner of its path, a double-click or <kbd>Enter</kbd> ending it open, a click on the first corner making it a ring.

It's a band its width wide, centred on the path or to its left or right, the outside of its corners rounded with Smooth corners. Its edge is one of:

- a single line
- a plant cloud (billows bulging out or in, varying in size)
- a rough plant line

Afterwards it reports its length, area and how many of each plant it takes (by length or area, up to seven plants by percentage). Plain objects in plan, grouped.

### Vegetation Line

**AEC › Plants › Vegetation Line** draws one line round selected shapes and plant symbols that overlap, following their outer edge or as a cloud of arcs, to show a massed planting. Symbols count as the ellipse their box holds.

## Hardscape, paths and boundaries

### Hardscape, Landscape Area and Property Line

With the **Hardscape**, **Landscape Area** and **Property Line** tools, drag a rectangle (key <kbd>1</kbd>) or click a polygon's corners (key <kbd>2</kbd>; a double-click, <kbd>Enter</kbd> or the first corner closes it).

- **Hardscape** gets a border inside its outline and square paving joints laid from the drawing's origin (width, spacing and angle in Preferences).
- **Landscape Area** gets a cloud boundary (or the outline as drawn) with its name and area.
- **Property Line** gets each side's bearing and length beside it.

### Pathway and Boundary Paths

Pathway and Boundary Paths are in Site Planning's Site Modifiers. Draw a centre line with a width, or an outline whose centre line is worked out for you.

Set heights along it and across it with longitudinal and transverse profiles, as tables with a small drawing, or **Fit to Surface**. The site model takes it at its next update. **Reshape** moves its corners.

### Fence

With the **Fence** tool, click each corner of its path as for [Railing/Fence](interiors.md). It's drawn in plan as one of:

- its line alone
- the line with square or round posts
- in full detail: its posts (fixed or equal spacing, corner posts lined up with either segment or between), rails, board or panel infill on its face side, gravel board and the footers hidden below grade

### Curb

With the **Curb** tool, click each corner of its front edge. It's drawn in plan as one of:

- its front edge
- front and back lines
- in full detail: its units and joints, mitred corners and the foundation hidden under it

## Roads and parking

### Roadway (Straight), Roadway (Curved) and Roadway (Tee)

- **Roadway (Straight)**: drag a straight road's centre line.
- **Roadway (Curved)**: click to place a curved road (its radius, width and sweep, left or right, in Preferences), a press dragged turning it.
- **Roadway (Tee)**: click to place a tee (a throat widening through fillets into the road across it), a press dragged turning it.

They draw the paving, the curbs either side and the joints where sections meet, with loci at the arcs' centres: plain objects in plan, grouped.

### Roadway (Poly), Parking Along Path and Parking Area

With the **Parking Along Path**, **Parking Area** and **Roadway (Poly)** tools, click each corner of a path, a double-click or <kbd>Enter</kbd> ending it, a click on the first corner closing it.

- **Parking Along Path** stands stalls square to each run on its left, right or both, numbered.
- **Parking Area** fills an outline with double rows of stalls about header stripes, at the row and space angles and lane width in Preferences.
- **Roadway (Poly)** runs the paving and its curbs along the centre line, a closed path making a ring road.

Plain objects in plan, grouped.

### Parking Space

With the **Parking Space** tool, drag along the curb for a row of stalls to its left, at 90°, 60° or 45° (keys <kbd>1</kbd> to <kbd>3</kbd>), their width and depth in Preferences.

### Parking Spaces

With the **Parking Spaces** tool, click to place a row of stalls along a header stripe, or press and drag to turn it. Its Preferences choose:

- Single Bay, Double Bay or Parallel
- the number and size of spaces
- their angle
- a straight or angled header
- accessible spaces with their symbol and aisles
- which stripes show
- numbering
- bumpers
- 3D stripes

It's drawn as plain objects in a group, so to change one, place it again.

### Station on Polyline…

**AEC › Roads › Station on Polyline…** stakes the selected line every 100' (30.48 m) and at a partial interval, each labeled with its station. It can draw each circular curve's data and tangent guide lines, or list them in a worksheet (made from one the drawing already has).

The stakes are the Stake tool's default look as grouped 2D objects, not site-model stakes.

## Existing trees and surveys

### Existing Tree

With the **Existing Tree** tool, click to place a surveyed tree, or press and drag to turn it. Its Preferences set:

- its names
- **Action** (Retain, Remove, Transplant Original or Proposed)
- **Significance**
- number
- canopy
- DBH
- root zones and protection zone

It's drawn in plan as a group of plain objects named by its number.

**Limits:** there's no 3D tree, species list or worksheet data.

### Existing trees from loci

**AEC › Existing Trees › Create Existing Trees from Loci** turns selected loci or symbols into existing trees, mapping a survey record's fields to the tree's parameters with their units. **Preserve Record** keeps the record on the tree.

**Limits:** a tree only has the parameters the Existing Tree tool draws, so Height and Condition stay in the record, and saved mapping sets aren't there.

### Import Tree Survey File

**AEC › Existing Trees › Import Tree Survey File** brings in a spreadsheet or delimited survey as existing trees, 2D loci or 3D loci. Map each column to a tree parameter or a location (X/Y/Z, coordinate pairs, latitude and longitude), set its unit, and keep the columns you choose in a custom record.

**Limits:** Height and Condition aren't done: they stay in the record, since Rodeo's trees don't hold them, as in [Existing trees from loci](#existing-trees-from-loci).

### Survey Input

**AEC › Survey Input** reads survey points in two ways, either way as 3D loci or stakes a site model takes as source data:

- **Grid Method Entry** types elevations over a grid.
- **Import Survey File** reads survey points from a text file or an Excel workbook.

### Stake

With the **Stake** tool, click to place a stake, or press and drag to where its label goes, with a leader line back to it. Poly-Vertex (key <kbd>2</kbd>) places one at each corner clicked.

It draws its indicator in Vectorworks' eight styles and its label (ID, elevation, description or coordinates from the drawing's origin) in one of six bubbles, the ID stepping on with each.

## GIS and georeferencing

### Georeferencing

Place a drawing on the Earth with **File › Document Settings › Georeferencing** (local, UTM or Pseudo-Mercator, kept in this browser). Then use **Graticule**, **Great Circle**, **Survey Point**, **GIS Stake** and **Modify › Move Geographic**. The Onscreen View Control gets a compass ring.

**Limits:** other coordinate systems and background maps aren't there.
