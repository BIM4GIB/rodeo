# Sheets, viewports and worksheets

This page covers viewports on sheets and their data visualisations, worksheets and reports, and the title block borders and section lines placed on sheets.

## Viewports

### Create Viewport…

**View › Create Viewport…** makes a plan viewport on a sheet, of the design layers and at the scale chosen, in blank drawings too.

### Create Detail Viewport…

**View › Create Detail Viewport…** makes a viewport of a detail from a closed shape drawn round it, on a design layer or on a sheet over a plan viewport. It is named by its drawing and sheet numbers, with a callout round the crop and a drawing label under it.

### Create Section Viewport…

**View › Create Section Viewport…** cuts the 3D model along a Section-Elevation Line, or a plain line or polyline, and draws what it sees on a sheet. Select the line first. The cut is filled in each object's colour with a heavier outline, and the edges beyond it are drawn where nothing nearer hides them.

Look sets which side of the line, as drawn, the view faces; a section line's arrows set it for you. Display extents beyond cut plane draws what lies beyond, as far as the limit (0 for no limit); untick it to draw the cut alone. The viewport is named by its drawing and sheet numbers, with a drawing label under it.

**Limits:** the drawing is made once, as the model is then, and isn't kept up to date. A line with corners is cut straight from its first point to its last. Only what lies across the line's length is drawn. The section line's bubbles aren't renumbered, and there are no render modes or section styles.

### How viewports draw

Plan viewports draw the design layers they list, live (edits on a design layer show on every sheet), with the viewport's class overrides and grayed layers. Section, elevation and detail viewports draw their cached drawings, with a cached Renderworks render under their line work.

Both are placed at the viewport's scale and rotation and cropped as on the sheet, with their annotations (dimensions, tags, grid bubbles) where Vectorworks puts them. Edges Vectorworks hides and crop objects (often filled white) are left out. Drawings are cropped to the crop object's shape (polygons, rounded rectangles), annotations to the box.

PDF and SVG exports of a sheet include its plan drawings, cropped to their viewports.

### Moving and editing a viewport

Click a viewport's drawing to select the viewport and drag to move it, drawing, annotations and all.

Object Info edits a viewport's:

- scale (the drawing and its annotations rescale about the box's centre)
- crop edges
- which design layers it shows, and their visibility
- class overrides

### Edit Annotations

**Edit Annotations** (right-click a viewport, or double-click it) opens its annotations as the active layer at the viewport's scale, over what it shows. Every tool draws and snaps there, the viewport's drawing included. **Exit Viewport Annotation** goes back to the sheet.

### Data visualisation

A plan viewport applies the data visualisations it lists. It redraws the objects that match their criteria (plug-in type, layer, class, story, object type for slabs) with the fill and pen of their value: for every object, by class or by object style or by material. For example:

- wall cabinets dashed with no fill
- floor slabs hatched by finish
- shading devices in a highlight colour
- framing hidden on a ceiling plan
- lower floors greyed on a roof plan
- steel columns black

Section, elevation and detail viewports apply theirs to the drawing they cache, piece by piece by class and material (cut framing greyed under its batt insulation on a wall section).

Fills can be none, solid, a pattern or a hatch; pens none, solid or a line type. Exports show them too.

## Worksheets

### Worksheets on sheets

Schedules placed on sheets (door, window and steel schedules, drawing lists) are drawn from their cached cell values: database rows expanded and sorted, merged cells, fills, bold headers, and dimensions, areas and counts formatted as the worksheet says. They can be moved.

### Edit Worksheet…

A worksheet's text and number cells can be edited in a grid. Open it with **Tools › Reports › Edit Worksheet…**, a worksheet's Resources tile, or a double-click on it on a sheet. The changes go in together as one undo step.

**Limits:** formula cells and database rows show their last results, read-only.

### Create Report…

**Tools › Reports › Create Report…** makes a new worksheet listing objects from the selection, the active layer, or the visible or all design layers, optionally only those meeting Custom Selection's criteria.

It has the columns chosen: type, name, class, layer, area, perimeter, length and their record and plug-in fields. It is sorted and optionally summarized with counts and sums.

**Limits:**

- It holds the values as they are now (formulas can't be written yet).
- It is made from a worksheet the drawing has, so a drawing with none can't have one yet.

## Title blocks and section lines

### Title Block Border

With the **Title Block Border** tool (Dims/Notes), click to place an ISO, ARCH, ANSI or custom sheet's border at the layer's scale. Its zones are lettered and numbered in the margins, with grid extensions, crop marks and a title block (project, sheet title, drawn by, date, scale, sheet number). The border is plain objects, grouped.

### Section-Elevation Line

With the **Section-Elevation Line** tool (Dims/Notes), click a straight or broken cut line with a numbered bubble past each end, past its start only, or on its middle for an elevation, looking left or right. It is optionally gapped, its bubbles scaled. The line is plain objects, grouped.
