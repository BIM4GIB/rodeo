# Drawing, text and attributes

Drawing tools come first on this page: lines, shapes and curves, and the tools that move and reshape them. Then come text and notes, the attributes objects are drawn with (fills, hatches, line types, line markers and drop shadows) and markers.

## Lines and shapes

### Basic shapes

The **Line**, **Rectangle**, **Circle**, **Oval** (<kbd>B</kbd>) and **Regular Polygon** (<kbd>⇧G</kbd>) tools draw those shapes. **Rounded Rectangle** (<kbd>⇧R</kbd>) rounds the corners by a share of the shorter side, or by fixed radii set in its preferences.

### Polygon

The **Polygon** tool (<kbd>P</kbd>) has three modes (keys <kbd>1</kbd>–<kbd>3</kbd>):

- By vertices.
- **Inner Boundary**: a click inside an area the active layer's visible objects enclose makes a polygon of that area.
- **Outer Boundary**: a click makes a polygon of the outside of the outlines round it.

Resting over an area previews it.

### Triangle

The **Triangle** tool sits beside Polygon.

1. Click the first side.
2. Give the rest in Triangle Settings, as three sides, two sides and the angle between them, or two angles and the side between them.
3. Click the side of the first one it goes on.

### Double Line and Double Line Polygon

The **Double Line** tool (<kbd>W</kbd>) draws two parallel polylines with mitred corners, the path on the top, centre or bottom line, as lines, the polygon between them, or both. There is also **Double Line Polygon** (<kbd>⇧W</kbd>: the same, closed).

### 2D Locus

With **2D Locus**, a click places a reference point that snaps but doesn't print. DXF takes it as a POINT.

## Curves

### Arc

The **Arc** tool draws an arc four ways (keys <kbd>1</kbd>–<kbd>4</kbd>):

- by radius
- through three points
- a quarter arc between two points
- a tangent arc that leaves its start in a clicked direction

### Quarter Arc

**Quarter Arc**, beside Arc, draws a quarter circle or ellipse leaving its start the way the pointer first moves; Shift keeps it circular. It is a polyline, as Vectorworks lists quarter arcs.

### Polyline

The **Polyline** tool (<kbd>Y</kbd>) places each vertex as one of five kinds (keys <kbd>1</kbd>–<kbd>5</kbd>):

- a corner
- a bezier control point
- a cubic spline point the curve passes through
- an arc rounding the corner
- a point an arc passes through

### Spiral

The **Spiral** tool (<kbd>⇧S</kbd>: circle the centre to add loops) draws a smooth polyline.

### Freehand

In the **Freehand** tool (<kbd>U</kbd>), No Smoothing keeps the simplified corners; Low, Medium and High draw a smooth curve.

## Moving and reshaping

### Rotate and Mirror

**Rotate** works from a centre, a reference and an angle. **Mirror** works about an axis; Option keeps the original. Both turn text too.

### Move by Points

**Move by Points** (<kbd>⇧M</kbd>: from one point to another) moves the selection; Option or Copy mode moves a copy.

### Offset

**Offset** (<kbd>E</kbd>) makes parallel copies of lines, polylines, polygons, rectangles, circles and arcs at a typed distance.

### Fillet and Chamfer

**Fillet** (<kbd>F</kbd>) rounds the corner between two lines with a typed radius, trimming both. **Chamfer** (<kbd>Q</kbd>) cuts the corner with a line at two typed distances.

### Shear and Fixed Point Resize

The **Shear** and **Fixed Point Resize** tools sit beside Clip, as in Vectorworks. They work on the selected rectangles, rounded rectangles, polygons, circles and ovals (Shear on polylines too).

1. Click the point that stays fixed.
2. Press on the selection and drag, or click, move and click.

**Fixed Point Resize** stretches across and up about that point, each by how far the dragged point now lies from it against where it started (not from a start level or plumb with it). Past it, the selection is reversed. Shift keeps the proportions.

**Shear** skews the selection so the dragged point lands under the pointer. With Shift it goes straight across or up.

A shape that can't keep its kind becomes a polygon. Each change is one undo step.

## Text and notes

### Text

The **Text** tool places text on the point clicked. Its Mode bar modes set how the text sits on that point:

- justified left, centre or right (keys <kbd>1</kbd>–<kbd>3</kbd>)
- aligned top, top baseline, centre, bottom baseline or bottom

Rotated and justified text is drawn as Vectorworks lays it out, in its own font, bold, italic or underlined. A narrow font this machine lacks is drawn squeezed to its width.

Object Info edits the content, text style, font, bold, italic, underline, size (pt), rotation, justification and vertical alignment. The **Rotate** and **Mirror** tools turn text, and mirrored text stays readable.

### Format Text…

**Text › Format Text…** sets the font, any size in points, bold, italic, underline, justification and vertical alignment of every selected text at once. It shows Mixed where they differ and changes only what is changed, in one undo step.

### Capitalization

**Text › Capitalization** makes the selected texts UPPER CASE, lower case or Title Caps, in one undo step.

### Callout

To place a **Callout** (<kbd>⇧C</kbd>):

1. Click where the leader points.
2. Click where it meets the note.
3. Type the note.

The leader has an arrow, a dot or no marker, and a short shoulder. The note sits in no box, a box or a rounded box. Sizes are on paper and scale with the layer. A callout is a plain object (a group).

### Revision Cloud

The **Revision Cloud** tool (<kbd>⇧L</kbd>) draws a ring of outward arcs round a dragged rectangle or a clicked polygon. It is a plain object (a polygon).

### Leader lines

There are two leader tools (Basic):

- **Leader Line Simple**: click a shoulder and a leader, which gets the Attributes palette's arrow.
- **Leader Line**: click where a leader points and where it meets a level shoulder on the text's side; it gets its own arrow, dot or slash at the point.

Both draw open polygons with real line markers.

### Hyperlink

With the **Hyperlink** tool (Dims/Notes), click to insert a link to a webpage, a saved view or a sheet layer, drawn as its label beside a chain link, or a QR code of any text or URL.

Cmd-click it with the Selection tool (or choose Open Link on its right-click menu or in Object Info) to follow it. Object Info edits it. It is a Hyperlink plug-in object.

## Attributes

### The Attributes palette

The Attributes palette sets these for selected objects and, with nothing selected, for new objects:

- pen and fill colour, from the document's colour table (with its colour names)
- fill none/solid
- opacity
- line weight and line type

Line weights are drawn on the canvas.

For the selection it also sets:

- the **line markers** at each end of lines, arcs, polygons and polylines: none, arrow, dot or slash, their size on paper, and the angle of arrows and slashes
- the **drop shadow**: on or off, offset, angle, blur, opacity and colour

New objects can be given markers and a drop shadow too; each new object takes them in the same undo step that draws it.

**Tools › Options › Edit Marker List…** names the markers the palette's Start and End menus offer (style, size on paper and angle, in order). **Line Thickness…** names the weights its Line weight menu offers. Both lists are kept in this browser. A line whose marker isn't on the list shows its style, size and angle instead.

### Eyedropper

With the **Eyedropper** tool (<kbd>I</kbd>):

- Click to pick up an object's attributes and class.
- Option-click to apply them; Shift-Option-click also applies the class.
- Cmd-click to use them for new objects.

### Line types

Dash styles defined in the file (ISO and VW dashed styles) are drawn at the layer's scale and can be changed in Object Info. They are written to DXF (as LTYPE line types), SVG and PDF.

### Line markers

Arrowheads, dots and slashes (dimension ticks) at the ends of lines, arcs, polygons and polylines draw in the pen colour at their size on paper, scaled by the layer or viewport as dashes are. They print to PDF, SVG and PNG.

### Drop shadows

Objects with a drop shadow cast a soft shadow at its blur, distance, angle, colour and opacity, on paper (scaled by the layer or viewport). A plug-in, symbol or group casts one shadow from its whole drawing, and a plug-in's own opacity fades its drawing.

Shadows show on the canvas and in SVG and PNG exports (cast by the outlines and text those draw). PDF has no blur, so its shadows are layered copies of the outlines and text, stroked wider out to the blur radius and fading as they go.

## Fills and hatches

### How fills are drawn

- **Hatches** are drawn from the file's hatch definitions in their own ground and line colours, laid from each object's fill mapping and clipped to the shape. World-sized ones shrink with a viewport's scale; paper-sized ones (the wall component hatches: concrete, insulation, gypsum) keep their size on the sheet. PDF export fills them with their ground.
- **Tiles** are drawn from their motif (in the pen colour), laid and sized by each object's fill mapping (a batt's loops fill the insulation's depth), else at world size.
- **Gradients** are drawn as colour ramps laid out by each object's own mapping (direction, linear or radial), with their stops' opacity and midpoints.
- **Bitmap patterns** whose bits are known (the 2026 wall lattice) draw as 8×8 bitmaps in the fill's two colours, one bit to a screen pixel, and export to PDF as the colours' mix. The rest draw solid.

### Attribute Mapping

The **Attribute Mapping** tool lays the selected object's hatch, tile or gradient:

- Drag the square to move the fill.
- Drag the first circle to turn it (and scale a tile or a gradient).
- Drag the second circle to skew a tile or a hatch.

Shift keeps the first axis to 15° steps and the second square to it. The fill follows the drag and is one undo step; <kbd>Esc</kbd> abandons it. An object without a fill mapping gets one, copied from another in the file.

### New Hatch from Locally Mapped Hatch

Right-click an object whose hatch has been laid with Attribute Mapping for **New Hatch from Locally Mapped Hatch**. It makes a new hatch, named in a dialog, with the laying in its lines. The object takes the new hatch (its mapping set back) and others can use it.

### Hatch…

**Modify › Hatch…** fills one closed object with one of the drawing's hatches as plain lines.

1. Pick the hatch from a list with its preview.
2. Click where it starts.
3. Click again to turn it (Shift holds 15° steps).

The lines, cut to the outline and to their dashes, come as a group just above the object, in each line family's colour and weight. The hatch is drawn once, not tied to the object (Vectorworks' non-associative hatch). A hatch sized on the page is drawn at the layer's scale.

**Limits:** hatches needing more than 20,000 lines in the object are refused.

## Markers

The markers are in the Dims/Notes tool set. Each is a group of plain objects, with sizes on paper and numbers in Preferences.

**Limits:** Vectorworks's markers, tags and legends follow the viewports, objects and classes they name; these are drawn as they are when placed.

### Section-Elevation Marker

The **Section-Elevation Marker** draws a section line with a bubble past each end, its arrows looking to the line's left or right (keys <kbd>3</kbd> and <kbd>4</kbd>). In Elevation (key <kbd>2</kbd>) it draws one bubble looking from the first click toward the second.

### Interior Elevation Marker

The **Interior Elevation Marker** places a circle with an arrow each way and each look's number. A press dragged turns it.

### Detail Callout

The **Detail Callout** circles a detail dragged from its centre to its edge, and carries a leader on to its bubble.

### Drawing Label

The **Drawing Label** places the bubble, the title on a line and the layer's scale.

### Reference Marker

The **Reference Marker** places a bubble with the referenced drawing's number over its sheet's and a note under it. It sits on a leader (straight, an arc or a curve) from an arrowhead at the target to a shoulder.

Click the marker then the target, or the target then the marker (keys <kbd>1</kbd> and <kbd>2</kbd>).

### Grid Line

The **Grid Line** tool draws structural grid lines with a bubble holding the label past either end or both:

- Key <kbd>1</kbd>: straight, Shift in 15° steps from the last grid line.
- Key <kbd>2</kbd>: radial about a clicked centre.
- Key <kbd>3</kbd>: through clicked corners; double-click or <kbd>Enter</kbd> ends it.
- Key <kbd>4</kbd>, **Duplicate**: a copy of the last one moved across, offset or turned about its centre, to the pointer or by a set offset or angle.

Each takes the next label, stepped on as Vectorworks does (1.9 to 2.0, Z to AA, past letters not to include).

### Redline

A **Redline** rings a change in red, as a cloud, rounded or plain (dashed when the drawing has a dashed line type):

- Keys <kbd>1</kbd> and <kbd>2</kbd>: a box or an oval, by a drag or two clicks.
- Key <kbd>3</kbd>: clicked corners.
- Key <kbd>4</kbd>: a freehand stroke.

It then asks for the note, and a leader runs to a tag with the date and who authorised and was assigned it.

Redlines live in the Notes-Redlines class. **Text › Redlines** picks one up (it turns yellow with today's date), restores it, shows or hides them all, and makes a Redlines Status Report worksheet of the open and closed ones.

### General Notes

**General Notes** places a titled block of notes typed one a line, numbered or lettered with hanging indents, in one or more columns.

### Elevation Benchmark

The **Elevation Benchmark** marks a point with a quartered circle and its Y from the drawing's origin, for elevations drawn in 2D.

### North Arrow

The **North Arrow** points up on a click, or at the pointer when dragged.

### Scale Bar

The **Scale Bar** places four segments of a round length for the layer's scale, labelled in the drawing's units.

### Data Tag

With the **Data Tag** tool, press on an object and drag to where the tag goes. The tag shows its name, class, area or length (keys <kbd>1</kbd> to <kbd>4</kbd>).

### Graphic Legend

The **Graphic Legend** lists the classes used on the active layer, each swatch drawn in its class's attributes.

### Symmetry Label

For a **Symmetry Label**, drag the axis. It is crossed near each end by two short bars.

### Center Mark

With the **Center Mark** tool, click a circle, oval, rectangle or rounded rectangle to cross its centre with two lines. With Option/Alt, it crosses a rounded rectangle's nearest corner.
