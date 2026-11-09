# Selecting and editing

This page covers selecting objects, moving and reshaping them, cutting, copying and duplicating, groups, the Modify menu's commands for arranging, combining, converting and dividing objects, trimming and splitting, and the commands that repeat what you did or ready a tool from a selected object.

## Selecting objects

### Clicking and marquee selection

Click any object on a visible layer to select it (its layer becomes active), or shift-click.

Select with a box: drag it rightwards for what is inside, leftwards for what it touches. You can also select with a polygon clicked point by point or a freehand lasso (the Selection tool's Marquee modes): what is inside, or with Option what it touches.

### Select Similar

**Select Similar** (Edit menu, and a Basic tool) selects the objects like one, matching on the attributes ticked in Select Similar Preferences (the tool's preferences):

- object type, class, symbol definition and plug-in (the defaults)
- fill style, colours and opacity
- pen style, colours, thickness and opacity
- font, size, style, alignment and text style
- a wall's or slab's style and thickness
- line end markers

Each group has an All box, and the choices are kept per browser.

The menu command adds the objects like the selected ones. The tool selects those like the one clicked, among the layer's (Select any Object, 1) or the ones selected (Current Selection, 2), Shift adding to the selection.

### Select Connected Objects

**Select Connected Objects** adds every line, open polyline or polygon and partial arc that meets a selected one end to end, and those that meet them, on the layer or in the group being edited.

### Invert Selection

**Invert Selection** selects what Select All would that isn't selected, and lets go of what is.

### Previous Selection

**Previous Selection** brings back the selection before this one, and again goes further back, through the last 20. On another layer it makes that layer active.

### Custom Selection…

**Custom Selection…** selects the objects on the active layer that meet every criterion set: type, class, symbol, fill colour, pen colour or line weight, each "is" or "is not" one of the values the layer has. It replaces, adds to or removes from the selection.

**Execute** chooses when that happens:

- **Execute Immediately** selects the objects now.
- **Create VectorScript** or **Create Python Script** writes the search as a script instead, names it and keeps it in a script palette (one is made if you have none). Double-click it there to make the same selection again, or use **Export Script** to take it to Vectorworks.

A script can search by type, class and symbol. Searches by colour or line weight, and searches inside a group being edited, are Execute Immediately only.

### Force Select

**Force Select** is in the right-click menu over an object that a click can't select, because it is on another visible design layer or in a visible class that isn't active. It makes the object's layer and class active where it needs to and selects it.

**Activate Layer** and **Activate Class** beside it only make its layer or class the active one.

### Select Coincident Objects…

**Select Coincident Objects…** (the right-click menu over an object) lists every object a click there could pick, topmost first, with its place in the stacking order, kind and name. Those picked are selected as they are picked, and OK keeps them.

Holding <kbd>J</kbd> (the Coincident Selection key, as Vectorworks keys it) while the Selection tool clicks opens it there too.

### Select Objects of Same Symbol

**Select Objects of Same Symbol** (the right-click menu over a symbol instance) selects every instance of that symbol on the active layer, or in the group or symbol being edited.

## Moving, scaling and reshaping

### Moving and scaling with the mouse

Move the selection by dragging or with the arrow keys. Scale it by the eight handles round the selection (Interactive Scaling): a single object, or several together. Shift keeps the proportions.

### Reshaping with grips

Reshape an object by dragging its grips: line ends, polygon/polyline vertices, rectangle corners, and a circle's centre and radius. A curved polyline's grips are its own vertices, so its curves survive.

### Editing in Object Info

You can also duplicate and delete objects, change their class, layer and attributes, and edit their text and coordinates in Object Info.

For a polygon or polyline, Object Info steps through the vertices (◀ ▶). The one shown is filled on the drawing, and a right-click on a vertex offers **Select Vertex in Object Info Palette** to step to it. There you can:

- type each one's position, a polyline vertex's type and an arc vertex's radius
- add or delete one
- open or close the outline (a polyline's hidden edges are drawn again once it is edited)

An extrude or a multiple extrude shows its footprint, X, Y, Width and Depth from its lower left corner, and its Bottom. X, Y, Width, Depth and Bottom can be typed. Height is shown but can't be typed yet. Several objects selected move by the Offset X and Offset Y typed, with the **Move** button.

### Reshape tool

The **Reshape** tool (<kbd>⇧V</kbd>, under Selection) reshapes the selected lines, polygons and polylines:

- **Move Vertices** picks vertices with a box or clicks (Shift adds), across several objects at once, and dragging a picked one moves them all. Delete removes the picked ones.
- **Move Edge** drags an edge with both its vertices.
- **Change Vertex** makes a vertex a corner, Bezier or arc vertex (a polygon becomes a polyline).
- **Add Vertex** drags a new one of that type out of an edge's midpoint.
- **Delete Vertex** clicks them away.

Each change is one undo step.

### Convert Arc to Radius Polyline

**Convert Arc to Radius Polyline** (the right-click menu over a polyline with arc vertices) makes its arc (fillet) vertices radius vertices, which lie on the curve, so dragging one reshapes its arc. Fillets on one circle become one radius vertex. The curve stays as it was. One undo step.

## Cut, copy and paste

You can cut, copy, paste and paste in place, also between files, through the system clipboard. Paste and Paste in Place are greyed out until something has been copied, in this window or another open in this browser.

Walls, slabs, plug-in objects and lights cut, copy and paste within their drawing: onto another design layer as high above it as they were, not onto sheets. Plug-in objects and lights also go into symbols.

**Limits:** another drawing doesn't take walls, slabs, plug-in objects or lights yet, as they name its resources in ways not all known.

## Duplicating

### Duplicate Array

**Duplicate Array** (Edit menu) makes linear, rectangular grid or circular copies, optionally turned, in one undo step.

### Duplicate Along Path

**Duplicate Along Path** (Edit menu): select the objects and a line, polyline, polygon, rectangle, arc or circle, and copies go along it. They are a number spread from the start offset to its end (or round a closed path), or a distance apart. The centre of the objects is on the path and, with Tangent to Path, they are turned with it.

One undo step; the copies are selected.

## Groups

### Group and ungroup

Group and ungroup are in the Modify menu. Group bounds are updated when their contents change.

### Editing inside a group

Double-click a group to edit the objects inside it. <kbd>Esc</kbd> twice, the Exit Group button over the drawing or a double-click on empty space leaves. Or <kbd>⌘</kbd>-click to select an object inside its groups directly.

**Window › Edit Group and Object Visibility Options** sets whether <kbd>Esc</kbd> <kbd>Esc</kbd> leaves, and whether the Exit Group, Exit Symbol and Unhide Objects buttons are large (icon and label) or small (the icon alone, the label in its tooltip).

### Top Level

**Modify › Top Level** leaves every group open at once (and the symbol being edited).

## Repeating commands and similar objects

### Repeat Last Command

**Repeat Last Command** (Edit menu, and both right-click menus) runs again the last command run from a menu, its key or a right-click. It is greyed when it doesn't apply now.

**Edit › Recent Commands** lists the last ten, latest first, to run one again.

Commands of the File, Window and Help menus, Undo, Redo and the clipboard's aren't repeated. The list lasts while the page is open.

### Create Similar Object

**Create Similar Object** (Edit menu, and the right-click menu) makes the tool that draws the selected object the active one, with that object's attributes for new objects and its class as the active class:

- The **Wall**, **Slab**, **Door**, **Window** and plug-in tools copy the kind it is (or say they can't, keeping theirs).
- The **Symbol** tool places its symbol.
- The **Text** tool takes its justification and size on paper.
- The **Light** tool takes its kind.

Groups and 3D objects have no tool to ready.

## Arranging, rotating and aligning

These are Modify menu commands.

### Stacking order

Send objects to front/back and forward/backward.

### Rotate 90° and flip

Rotate the selection 90°, or flip it. Rotated rectangles stay rectangles, and rounded ones keep their corners, stretched with the sides they lie along when they scale.

### Rotate Each Left 90° and Rotate Each Right 90°

**Rotate Each Left 90°** and **Rotate Each Right 90°** turn each selected object a quarter about the centre of its own bounds instead, so each stays where it was.

### Rotate…

**Modify › Rotate…** rotates by a typed angle.

### Rotate 3D…

**Modify › Rotate 3D…** turns the selection by a typed angle about the X, Y or Z axis of the layer plane or the working plane, through the working plane's centre, the middle of the selection's 3D box or a clicked point. About the layer's Z axis everything turns; about any other only 3D objects do.

### Unrotate 3D Objects

**Modify › Unrotate 3D Objects** (<kbd>⇧⌘0</kbd>) turns the selected extrudes, sweeps, multiple extrudes and solids back to the layer's axes, however they were turned in plan or in 3D, each about the middle of its 3D box, and symbols holding 3D about their insertion point, in one undo step.

**Limits:** mirrored or stretched ones stay as they are, and objects inside selected groups aren't reached.

### Move and scale by typed values

Scale and move objects by typed values. **Modify › Move 3D…** raises or lowers 3D objects too.

### Align to Grid

**Align to Grid** puts each selected object's upper-left corner on the nearest point of the snap grid, in one undo step.

### Align by Increment

**Modify › Align › Align by Increment…** rounds each selected object's position, for example to put lighting devices on 6" marks along a pipe.

1. Select the objects and choose the command.
2. Tick the axes to align along: **X**, **Y** and **Z**.
3. Set **Round to the nearest**, or tick **Use snap grid** to put X and Y on the snap grid.
4. Click **OK**.

Each object moves by its insertion point, or its centre if it has none. **Shift+click** sets what a Shift-click on the command does: align at once with the last settings, or show the dialog.

**Limits:** Z goes by the middle of the object in 3D, not a symbol's insertion height; objects with nothing in 3D keep their height.

### Align/Distribute…

**Modify › Align › Align/Distribute…** aligns or distributes across and up the window at once, by edges, centres, insertion points or equal gaps. A selected locus or the object right-clicked stays put.

### Align/Distribute 3D…

**Align/Distribute 3D…** does so along X, Y and Z for the objects that show in 3D, on the layer plane's axes or the working plane's.

### Align/Distribute Leader Lines…

**Align/Distribute Leader Lines…** lines up the shoulder points or the label points of the selected callouts and leader lines on a reference line drawn next, every label under the topmost's when both are ticked. It turns their target lines parallel to the topmost's or spaces their shoulder lines evenly, the callout's note going with its label point.

## Walls, slabs, plug-in objects and 3D objects

### Walls

Walls move, turn, mirror and duplicate too (dragging, arrow keys, Move, Move 3D, Rotate, Flip, Duplicate), with their plan drawing, their 3D and the doors and windows in them.

Object Info shows a selected wall's style, thickness, height (its bottom and top), length and the ends of its control line, and sets them.

### Changing a wall's style

A wall's Style in Object Info offers each style and thickness the drawing has a plain wall in. Choosing one puts a copy of that wall on the same control line:

- at the wall's own heights, in its class and place
- its corners mitred again to the new faces
- its ends cut along a face kept
- walls teeing into it slid onto its new faces, as far into it for its width as they went into the old

**Limits:** a wall holding doors or windows can't change style yet.

### Walls joined to a moved wall

A wall dragged, nudged, moved, turned or flipped takes along:

- a wall mitred to it at a corner of two (its end follows, and the corners are mitred again)
- a wall meeting its side at a tee (its end slides along its own line, as deep in it as it was)

A copy made in place on a wall takes none along.

### Plug-in objects

[Plug-in objects](symbols-plugins.md) (doors, windows, furniture, tags, cameras) turn, mirror and duplicate, a camera keeping its view (cameras and Heliodons don't mirror), and so do walls holding them.

### Slabs and roof faces

Slabs and roof faces move, lift, turn, mirror and duplicate the same way, with their outline, components and 3D. Object Info shows their style and thickness.

### 3D objects

3D objects (extrudes, sweeps, solids, 3D polygons and meshes) move, rotate, mirror, duplicate and copy like 2D ones, a pasted one keeping its textures and material where the drawing has them by name.

Extrudes and multiple extrudes scale in plan too: the profiles take the scale in the extrude's own plane and the height stays, as a 3D polygon's does. Sweeps turning about an upright axis scale evenly in plan.

**Limits:** not yet extrudes tilted against the scale; solids don't scale yet.

## Trim, split, connect and clip

### Trim

The **Trim** tool (<kbd>X</kbd>) removes the piece of a line, polyline, polygon, rectangle or arc between the nearest crossings either side of the click.

### Split

The **Split** tool (<kbd>S</kbd>) cuts an object in two at the clicked point, or:

- in Line Split mode, cuts everything a dragged line crosses wherever it crosses (a polygon or rectangle cut across becomes two closed polygons)
- in Line Trim mode, cuts the same way and then deletes the pieces on the side you click

### Splitting walls

A straight wall clicked with Split, or crossed by its line, becomes two walls where the point lies along its line:

- each part square there
- its far end keeping its corner
- the walls teeing into it staying with the part they meet

**Limits:** walls with doors, windows or symbols set in them, or drawn with more than their two ends, aren't split yet; nor where another wall meets the side.

### Connect

The **Connect** tool (<kbd>J</kbd>) extends or shortens the clicked end of a line or arc to meet another object, or in its dual modes moves the clicked ends of two lines or arcs to where they meet. Dual Object Combine joins two lines met that way into one polyline.

### Clip

The **Clip** tool (<kbd>⇧X</kbd>) cuts the selected closed shapes by a dragged rectangle:

- **Exclusion** cuts away what is inside it.
- **Inclusion** keeps only what is inside.
- **Split** keeps both as separate objects.

## Surfaces and joins

### Add, Clip and Intersect Surface

Add, Clip and Intersect Surface work on closed shapes (rectangles, polygons, closed polylines, circles and ellipses). A result with holes is one polygon with the holes joined in by a zero-width cut, since polygons here have no holes of their own.

### Combine into Surface

**Combine into Surface** adds a polygon of the area the selected lines, arcs and outlines enclose together (crossings found, loose ends ignored; one for each separate set), keeping the pieces.

### Join

**Join** (Modify menu, <kbd>⌘J</kbd>; **Join (No Trim)**, <kbd>⇧⌘J</kbd>) makes two lines, or two straight walls, meet where their lines cross.

Lines are extended, or cut back by their shorter part (No Trim only extends). Walls meet in a mitred corner, or with No Trim in a tee where one runs past the other.

### Join and Fillet

**Join and Fillet** (**Modify › Join**, <kbd>⌥⌘J</kbd>): four lines making two double lines are joined in an L or a T with rounded corners at the **Fillet** tool's radius (asked for the first time when the Fillet tool hasn't set one).

An L's inner lines round at the radius and its outer ones a width further out, about one centre. In a T the line that ends rounds into the near line of the other, which opens between the fillets.

**Limits:** crossing double lines, and a radius too big for the lines, are refused.

## Compose, Decompose, Convert, Smoothing

### Compose

**Compose** joins lines, polylines and arcs that meet end to end into a polyline (or a polygon when the chain closes).

### Decompose

**Decompose** breaks shapes into their edges.

### Converting to polygons and lines

**Convert** turns rectangles, polylines and arcs into polygons, or turns them and polygons into the lines of their outlines (**Convert to Lines**; arcs and circles sampled).

**Convert Copy to Polygons** and **Convert Copy to Lines** leave the originals and convert copies of them, just above.

### Convert to Polylines

**Convert to Polylines** turns rectangles, polygons, circles, circular arcs and rounded rectangles into polylines that trace them exactly, their corners and curves editable vertices. A circle becomes four arc vertices round its square; an arc runs through its middle.

**Limits:** ellipses and elliptical corners stay, as a polyline's arcs can't trace them.

### Convert Object to Dimension

**Convert Object to Dimension** turns lines into linear dimensions measuring them and circular arcs into angular dimensions of the angle they span, in place.

### Convert to Group

**Convert to Group** (<kbd>⌘K</kbd>) turns symbols into groups of their contents, placed, turned, scaled and raised as the symbol was. It turns plug-in objects into groups of their drawing as it shows:

- in the plug-in's class
- with its shadow and opacity
- its text the right way up
- its 3D parts placed and raised as the plug-in placed them

Plug-in objects inside either stay plug-ins, placed with the rest.

**Limits:** not yet plug-ins whose 3D is a body or terrain of their own, such as site models, or symbols and plug-ins tilted or stretched in 3D that hold 3D objects.

### Convert to 3D Polygons

**Convert to 3D Polygons** turns 3D objects, symbols and plug-in objects into groups of closed 3D polygons, one per flat face they show in 3D (the triangles of each face merged; a face with a hole stays as its triangles), each drawn as the part it came from.

It needs a 3D polygon in the drawing to copy settings from.

### Convert to Mesh

**Convert to Mesh** turns each 3D object, symbol or plug-in object into one mesh of those faces (the flat faces it shows in 3D) sharing their corners (cut into convex faces of at most ten corners, as the demo files' are), each face drawn as the part it came from and the object's texture on the whole mesh.

It needs a mesh in the drawing to copy settings from.

### Replace with Symbol…

**Replace with Symbol…** turns the selected objects into instances of a symbol chosen from the drawing's definitions, each in the object's layer and class:

- a locus's on its point
- a symbol keeping its placement
- anything else on the centre of its bounds

The objects' data records are kept or dropped, and the definition's records added or not. It asks to confirm, is one undo step and needs a symbol in the drawing to copy settings from.

### Poly Smoothing

**Poly Smoothing** makes every vertex of the selected polygons and polylines one of these, from a polyline's own vertices rather than its drawn curve:

- a corner
- a bezier control point
- a cubic spline point (Cubic Spline Smoothing: a curve through every vertex)
- an arc as large as fits

**Radius Smoothing** rounds the corners as Arc Smoothing does, with a radius vertex on each curve.

## Simplifying meshes, polygons and 3D data

### Simplify Mesh…

**Simplify Mesh…** draws the selected meshes (and those in selected groups, plug-in objects and symbols) with fewer faces, collapsing edges by least change of shape at the Quality set, with Preview giving the number of faces. Borders, creases and a UV map's seams keep their place and the texture stays put.

### Simplify Polys…

**Drafting Aids › Simplify Polys…** takes corner vertices from the selected polygons, polylines and 3D polygons, by maximum deviation (the outline stays within it of where it was; 0 takes collinear vertices) or minimum distance (those at or within it of a neighbour go; 0 takes coincident ones).

Start and end vertices, a polyline's curves and the corners beside them stay, each object keeps its id, class and records, and a toast says how many went. One undo step.

### Simplify 3D Polygons…

**AEC › Terrain › Simplify 3D Polygons…** does the same by deviation to copies of the selected 3D polygons, put on the layer chosen, leaving the originals as they are.

### Validate 3D Data

**Validate 3D Data** checks selected 3D polygons as [site model](site.md) source data, with buttons to correct or select each:

- copies
- polygons of under 2 points
- points repeated in a row
- points one above another or in several places

### 2D Polys to 3D Source Data…

**AEC › Survey Input › 2D Polys to 3D Source Data…** makes contours drawn as polygons, polylines, lines, rectangles, arcs, circles or ellipses into 3D polygons at their elevations.

It takes a start elevation and interval, then Set Elevation steps through them from the backmost (Up and Dn by the interval, or the same height as the last), and the originals are deleted or kept. One undo step.

## Dividing objects

What Arc into Segments…, Line into Segments… and Even Divide… make takes the object's class and attributes and is left selected.

### Arc into Segments…

**Arc into Segments…** draws the selected arcs, circles and ovals again as straight segments of equal length along them, by their number or the longest one may be, as a polygon or a line per segment, leaving the arcs.

### Line into Segments…

**Line into Segments…** divides the selected lines into equal segments, placing loci between them, breaking the line, or both, and keeps the line or not.

### Even Divide…

**Even Divide…** splits the selected lines, arcs and circles into equal lines or arcs, and rectangles into a grid of equal rectangles (a turned one's turned with it), keeping the original or not.

### Create Dividing Lines…

**Create Dividing Lines…**, with two lines selected, takes a click where new lines start and one where they end, then a number of divisions. It divides the space between the two evenly: out from where they cross, or alongside them when parallel (loci when both clicks are on one guide).

## Attributes and guides

### Attributes by class and default attributes

- **Attributes › Make All Attributes by Class** gives the selected objects every attribute group from their classes.
- **Remove by Class Settings** keeps what each draws with as its own.
- **Set Default Attributes** saves a default set: the one selected object's attributes, which new objects are then drawn with, or with nothing selected what the Attributes palette sets for new objects.
- **Use Default Attributes** gives the selected objects that set or puts the palette back to it.

The set is kept while the drawing is open. The Attributes palette's title bar menu has the same four.

### Guides

**Modify › Guides › Make Guide** puts the selected objects in the class Guides (made when the drawing has none). **Show Guides** is a ticked toggle for the class's visibility, **Select Guides** selects the guides on the active layer, and **Delete All Guides** deletes every one.

## Images

### Trace Bitmap

**Trace Bitmap** (Modify menu) turns the selected image into vector objects, reading it in black and white at a brightness threshold (the dark or the light parts as ink). It makes filled outlines, one polygon per patch of ink with its holes, or centrelines down the middle of its lines, for scanned line work.

The result is grouped over the image, in one undo step. Specks and how closely the paths follow the pixels are settings.

**Limits:** pictures over 2000 pixels across are traced at that size.

### Edit Crop

**Edit Crop** (Modify menu, or right-click an image): draw a rectangle, circle, oval or closed polygon over an image, select both, and the picture is cut to it. It is cut square to a level rectangle, or to the outline of any other shape with the rest left clear. The image shrinks to what's kept, at the same scale, and the shape goes or stays as a frame.

With the image alone selected, it trims a length off each side. One undo step.

**Limits:** unlike Vectorworks, the crop can't be edited later: the pixels outside are gone (Undo brings them back).

### Edit Image Effects

Right-click an image and choose **Edit Image Effects…**, or click **Image Effects…** in Object Info, to adjust the picture. With several images selected, they all take the same effects.

- **Exposure**, **Contrast**, **Highlights** and **Shadows** set how light it is. Shadows to the right darkens the dark parts.
- **Saturation** sets how strong the colours are, and **Temperature** turns it bluer or redder.
- **Blur and Sharpness** blurs to the left and sharpens to the right.
- **Sepia** tints it brown, and **Soft Edges** fades it out toward its sides.
- **Invert Colors** makes a negative, **Auto-Level** picks Exposure and Contrast for you, and **Reset** puts every slider back.

The preview shows the first image as you go. **Apply** changes the pictures in one undo step.

**Limits:** the effects are worked into the pixels, so they can't be turned off or changed later, as Vectorworks allows (Undo brings the picture back). There are no saved sets of effects, and they work on images only, not on image resources, textures, backgrounds or viewports. The sliders follow Vectorworks' descriptions, not its exact formulas.
