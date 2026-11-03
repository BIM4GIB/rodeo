# 3D modelling

This page covers making and editing 3D objects: the Model menu's extrudes, sweeps, solids, sections and properties, the 3D Modeling tools, and 3D Power Pack surfaces.

## Extrudes and sweeps

### Extrude

**Model › Extrude…** (<kbd>⌘E</kbd>) turns the selected rectangles, rounded rectangles, polygons, polylines, circles and ellipses into extrudes of the height given (in the document's units), standing on their layer. Each holds its shape as its profile, with the shape's class, attributes and material, and no texture.

It needs an extrude in the drawing to copy settings from. New extrudes are saved without a cached body, as Vectorworks saves the parts of most plug-in objects.

**Limits:** whether Vectorworks rebuilds one on opening isn't confirmed.

### Multiple Extrude

**Model › Multiple Extrude…** (<kbd>⌥⌘E</kbd>) makes one multiple extrude of the height given through two or more of the shapes Extrude takes, on one layer or group: the backmost at the bottom and the frontmost at the top (more evenly between). It takes the backmost's class, attributes and material. It too copies settings from an extrude and has no cached body.

### Tapered Extrude

**Model › Tapered Extrude…** (<kbd>⌥⌘U</kbd>) asks for a height and a taper angle and replaces each of the shapes Extrude takes by a mesh whose sides lean in by the angle (out when it is negative). Its top is the profile moved in by the height times the angle's tangent. A taper that closes a profile up before the top is refused.

Vectorworks makes an editable Tapered Extrude plug-in object.

### Extrude Along Path

**Model › Extrude Along Path…** (<kbd>⌥⌘X</kbd>) takes two objects: a closed shape as the profile, and a line, arc, polygon, polyline or 3D polygon as the path. It replaces them by a mesh of the profile swept along the path, centred on it and square to it, mitred at the corners, optionally growing evenly to a scale factor at the path's end. **Lock Profile Plane** keeps the profile upright.

Vectorworks makes an editable Extrude Along Path object.

### Sweep

**Model › Sweep…** stands each of the shapes Extrude takes up on its layer and turns it about the upright through its left edge, through the arc given, in segments of the angle given. It copies settings from an extrude and has no cached body, as Vectorworks saves some sweeps.

The 3D view draws every sweep turned from its profile, about the 2D locus it holds where it has one. Top/Plan shows a standing sweep's profile edge-on, as it does a standing extrude's.

### Chain Extrude tool

The Building Shell tool set has **Chain Extrude**. Select a profile, a back shape and any shapes in front of it, then click a path. The back shape runs along it with mitred corners, and the front ones repeat as ribs along the sides and at the corners.

Object Info changes Flip, ribs, thickness, spacing, datum and elevation, and **Draw New Path** replaces the path.

**Limits:** it can't be reshaped, and its profile can't be edited afterward.

## Solids and booleans

### Add Solids and Subtract Solids

**Model › Add Solids** and **Subtract Solids** turn two or more selected extrudes, multiple extrudes, sweeps and solids on one layer or group into one solid that adds them, or takes the others from the backmost. The 3D view draws it from them, cutting a subtraction. It copies settings from an extrude and has no cached body.

Add Solids now takes meshes too, such as the caps Create Planar Caps makes (see 3D Power Pack, below).

### Intersect Solids

**Model › Intersect Solids** (<kbd>⌥⌘I</kbd>) replaces the same kind of selection by a mesh of the volume they all enclose, in the backmost's class and attributes. It refuses solids that don't all overlap.

Vectorworks makes an editable solid; the kind it saves for one isn't known.

### Section Solids

**Model › Section Solids…** (<kbd>⌥⌘T</kbd>) cuts a solid or mesh with a flat 3D polygon, taking away the part on its normal's side, or with another solid, taking away the part inside it (reversed, the other side or only the inside). What is left becomes a mesh, the cut faces in the sectioning object's attributes.

Vectorworks makes an editable solid section.

## Cutting sections

### Cut 2D Section

**Model › Cut 2D Section** slices the selected 3D objects, symbols and plug-in objects as Vectorworks Fundamentals does:

1. Click the section line's start and end across them (<kbd>Shift</kbd> for 15° steps).
2. Click the side to keep.

The upright plane through the line cuts them, and the slice goes onto a new design layer named Section, at the active layer's scale, seen from the side given up. Each object's cut faces become polygons with the attributes of the part they cut (holes kept), grouped per object in its class, standing on the line's start with heights as they are in 3D.

The model stays as it was, the whole cut is one undo step, and <kbd>Esc</kbd> gives up.

**Limits:** only the cut itself is drawn, not the model beyond it.

### Cut 3D Section

**Model › Cut 3D Section** takes the same clicks and keeps what of each object lies on the chosen side, where it was, on a new design layer named 3D Section. Each object becomes a mesh closed by a face over the cut (holes kept), each face drawn as the part it came from, with the object's texture. Objects wholly on the other side are left out, and the model stays.

Vectorworks keeps solids; Rodeo makes meshes, so, like Convert to Mesh, it needs a mesh in the drawing to copy settings from.

## Surfaces and meshes

### Meshes in Top/Plan

A mesh, the kind of object the 3D Modeling tools make, now draws in Top/Plan from above, as its rims, sharp folds and the edges where it turns away. A click on those lines picks it. One in a symbol or plug-in, or grouped with a plan drawing, leaves plan to that.

### Surface arrays

**Model › Create Surface Array** repeats the selected items in a grid across a flat object or open surface, also selected. Its dialog sets:

- **Origin**
- **Pattern Rotation**
- **Repetition**
- **Offset**
- **Shift**
- **Edge Conditions**

The 3D view shows the array as they change.

**Limits:** it makes a plain group, not an editable array object, and a surface has no U and V here, so the grid is laid on the plane it faces most and carried onto it.

## 3D Power Pack

### Create Helix-Spiral

**Model › 3D Power Pack › Create Helix-Spiral…** replaces each selected line, arc, polygon, polyline or 3D polygon by a 3D polygon coiling round it:

- by turns or pitch
- from a start radius to an end radius (a spiral when they differ)
- from a start angle, and either way round

**Extrude Along Path** takes the coil as a path, to make springs.

Vectorworks makes an editable helix-spiral object.

### Create Contours

**Create Contours…** cuts the selected 3D objects, symbols and plug-in objects with planes level with the layer or square to its x or y axis, from a first plane every interval either way. Each cut becomes a 3D polygon, closed where it goes all the way round, drawn as the part it cuts. Each object's contours are grouped after it, and the object stays.

Like Convert to 3D Polygons, it needs a 3D polygon in the drawing to copy settings from.

### Creating surfaces

**Model › 3D Power Pack** makes these surfaces:

- **Create Planar Caps**: flat meshes over a solid's open ends, joined by Add Solids, which now takes meshes.
- **Create Surface from Curves**: from one closed curve, or open curves meeting end to end.
- **Create Drape Surface**: a rectangular height field over any objects, down to a Plane Z Value.
- **Revolve with Rail**: a profile about an axis, following a rail, from three selected curves.
- **Unfold Surfaces**: developable surfaces as polygons, one per surface between creases. A surface curved two ways is refused.

To repeat items across a surface, see Surface arrays.

**Limits:** results are meshes of flat pieces, not NURBS surfaces.

### Editing surfaces

The 3D Power Pack edits surfaces with:

- **Create Fillet Surface**: a rolling ball between two open meshes, circular, linear or blended, optionally trimming them.
- **Stitch and Trim Surfaces**: a closed mesh for each volume crossing surfaces enclose.
- **Extend NURBS**: a 3D polygon past an end or a mesh past an edge, linear or smooth.
- **Rebuild NURBS**: 3D polygons and four-sided or tube meshes, with a chosen number of points and a live maximum deviation.

**Limits:** Trim Type and interpolated surfaces aren't offered for 3D Power Pack surface editing.

## 3D Modeling tools

These tools are in their own tool set, 3D Modeling: Extruded Rectangle, Extruded Polygon, Sphere, Hemisphere, Cone, Chamfer Edge, Fillet Edge, Shell Solid, Taper Face, Push/Pull, Offset Edge, Deform, Loft Surface, 3D Polygon, Align Plane and Analysis.

The meshes they make draw in plan as described under Meshes in Top/Plan.

### Extruded Rectangle and Extruded Polygon

The **Extruded Rectangle** and **Extruded Polygon** tools draw as the Rectangle and Polygon tools do and make an extrude of the height in their Preferences (a metre at first).

### Sphere, Hemisphere and Cone

The **Sphere**, **Hemisphere** and **Cone** tools go from the centre out to the radius, as the Circle tool does, and make sweeps turned a full turn about their upright axis: a sphere centred on the layer's plane, and a hemisphere and a cone (its height in Preferences) standing on it.

Like **Model › Extrude** and **Sweep…**, the Extruded Rectangle, Extruded Polygon, Sphere, Hemisphere and Cone tools copy settings from an extrude already in the drawing; each is one undo step.

### Edit a solid's edges and faces

**Chamfer Edge**, **Fillet Edge**, **Shell Solid** and **Taper Face** work in the 3D view, which they show when picked:

1. Click an edge or face of a solid (Shift-click for more; a drag still orbits).
2. Set the setback, radius, thickness or angle in the bar over the view.
3. Press **Apply** or <kbd>Enter</kbd>.

What each one does:

- **Chamfer Edge** and **Fillet Edge** take a single edge, its tangent chain (all of a cylinder's rim from one click), a face's edges, or all of them.
- **Shell Solid** hollows inside or outside, leaving the clicked faces open. For open meshes and flat shapes, see Shell Solid on surfaces.
- **Taper Face** turns a face about where it meets a face or plane you click first.

The result is a mesh in the solid's place, and can be edited again by these tools.

**Limits:** the result's setback or radius can't be changed afterward as in Vectorworks: PARITY.md lists the limits.

### Shell Solid on surfaces

Shell Solid also thickens open meshes and closed flat shapes. Click one (Shift for several), then **Apply** or <kbd>Enter</kbd>; **Inside** goes against the normal and **Outside** along it. Each becomes a closed mesh of that thickness.

**Limits:** the thickness can't be changed afterward, and a flat 2D shape keeps only its outline, not its holes.

### Push/Pull and Offset Edge

The **Push/Pull** tool adds or cuts a slab on a face, flat or curved, moves a flat face with its neighbours running on, and works on the part of a face a curve marks out.

The **Offset Edge** tool offsets an edge or loop across a flat face as a 3D polygon and can go straight on to push or pull it.

Both preview in the 3D view as the pointer moves, or take a typed distance.

**Limits:** results on solids are meshes with no history to edit later, for both Push/Pull and Offset Edge.

### Deform

To twist, taper, bulge or bend solids in the 3D view, or twist one face and its neighbours, use **Deform**. It has **Symmetric** and **Finite Length** as in Vectorworks.

**Limits:** the result is a mesh of small faces rather than a generic solid.

### Loft Surface and 3D Polygon

The **Loft Surface** tool makes a mesh through cross sections, with no rail, one rail or two:

1. Pick it and click each curve in the 3D view (3D polygons, or 2D shapes on the active layer).
2. Press <kbd>Enter</kbd> or **Loft**.

The Loft Creation dialog sets each curve's **Reverse** and **Start**, and **Ruled**, **Closed**, **Create Solid** and **Keep Curves**, with the 3D view showing the result as they change.

The **3D Polygon** tool draws those curves: corner by corner in Top/Plan at the Elevation in its Preferences, or in the 3D view on a face or at that Elevation.

**Limits:** Rodeo has no NURBS, so the curves stay polygons and the loft a mesh: PARITY.md lists the limits.

### Align Plane

To lay the selected 3D objects on the active working plane (or the layer plane), use **Align Plane**. Either:

- click a face to lay it on the plane, or
- click three points that go to the plane's origin, its x axis and its y side.

Clicks near a solid's corner take the corner. It's one undo step.

Working planes are set in the Working Planes palette: see [3D view, lights and rendering](3d-view-rendering.md).

### Analysis

The **Analysis** tool works in the 3D view:

- **Proximity** takes two objects (solids, surfaces, curves or 3D loci), marks where they come nearest with 3D loci and says how far apart that is. Where they cross it marks the crossing instead, with loci for a curve and a 3D polygon for two solids.
- **Interrogation** takes a curve or surface and shows how it bends under the pointer, the curvature circle in red and the tangent or normal in blue. A click gives the numbers and can add those to the drawing.

**Limits:** curvature comes from neighbouring points, as Rodeo's curves are polylines and its surfaces triangles, so it's close on a smooth faceted shape, and a corner in a polyline reads as a tight circle.

## 3D loci, Extract and Project

### 3D Locus

To place 3D reference points in Top/Plan or the 3D view, on a face, a working plane or at an elevation, use **3D Locus**. Edit their X, Y and Z in Object Info. Make them from 3D polygons or 2D contours, and turn them into stakes.

**Limits:** the record's point order comes from demos that are all at the origin, so it isn't confirmed against a file with loci elsewhere.

### Extract

To take 3D loci, curves, iso-parametric curves or surfaces off the edges and faces of a solid or surface, leaving it as it was, use **Extract**.

**Limits:** Rodeo has no NURBS kernel, so edges and iso-curves are worked out from the triangles, and the results are 3D polygons, 3D loci and open meshes.

### Project

To project a 2D object or 3D polygon along its plane's normal to split a solid or surface, trim it, or stand a rib on a solid, use **Project**.

**Limits:** the results are meshes with no history, and it's limited to about 4,000 triangles.

## Measuring

Each of these commands can place its list as text where the drawing is clicked next, or save it as a text file, and place a locus at the centroid or centre of mass.

### Engineering Properties

**Model › Engineering Properties…** measures one closed 2D object (and, with a locus selected too, its moments about the locus), in the units chosen:

- area
- perimeter
- centroid
- the second moments about the centroid
- the polar and principal moments
- the section moduli
- the radii of gyration

### Volumetric Properties

**Model › Volumetric Properties…** gives the surface area, volume and centre of mass of the selected 3D objects, the volume only when their faces close round one.

### 3D Properties

**AEC › Machine Design › 3D Properties…** adds, for the same selection, their radii of gyration and, from a density or specific gravity, their mass, weight and mass moments of inertia.
