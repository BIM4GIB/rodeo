# The .vwx file format (Vectorworks 2018+): working notes

Reverse-engineered from one file: saved by Vectorworks 2022 SP3 (internal
version 27.0.3, build 636848), originally created in VW 2018 (23.0.2). Facts
marked **confirmed** were checked against the whole file (every record parses,
geometry renders correctly). Facts marked **likely** fit the data but could not
be checked in Vectorworks itself.

All multi-byte values are little-endian unless stated otherwise.

## 1. Container

| Offset | Type | Meaning | |
|---|---|---|---|
| 0x00 | u32 **BE** | settings block length (0x9e0) | confirmed |
| 0x08 | u32 **BE** | settings block offset (0x94) | confirmed |
| 0x0c | u16 **BE** + ASCII | `VW23.0.2 VW27.0.3`: created-with / saved-with versions | likely |
| 0x20 | ASCII | serial / licence string | likely |
| 0x3a | ASCII | `VectorWorks` signature | confirmed |
| 0x50 | u32 **BE** | build number (636848) | confirmed |
| 0x54 | u32 **BE** | **total file size**, must be updated on save | confirmed |
| 0x58, 0x5c | u32 **BE** | unknown; preserved as-is | |
| 0x60 | ASCII | `BUILD: 636848` | confirmed |
| 0x94 | bytes | settings block (units "Millimeters", area/volume units, display prefs); first u32 is its own length | confirmed |
| 0x94 + 0xfc | f64 × 2 | in the settings block: the document's page, width then height in inches (Letter's printable area, 8.14 × 10.65, in every demo; A1 in a private sample); where design layers' page sits is not known | likely |
| 0x1ac | f64 | the length unit in an inch: 25.4 for Millimeters; 1 for Feet & Inches, which counts in inches | confirmed (a private sample in millimetres, every demo in feet and inches) |
| 0x1b4, 0x1bc | f64 | the area unit in a square inch and the volume unit in a cubic inch (0.0254² for Square Meters, 1/144 for Square Feet; 0.0254³ and 1/1728 for cubic) | confirmed |
| 0x1c4 | u16 | 2 for Feet & Inches, 0 for millimetres | likely |
| 0x1c6 | UTF-16 × 21 | the length unit's name ("Millimeters", "Feet & Inches"), zero-ended; a shorter name leaves the end of a longer one after its zero | confirmed |
| 0x1f0, 0x202, 0x214 | UTF-16 × 9 each | the unit's mark ("mm"; `"` for feet and inches), the feet mark (`'`) and the separator between feet and inches (`-`); the last two are empty in millimetres | confirmed |
| 0x226, 0x242, 0x260 | u16 | inches in a foot, and its square and cube, for feet and inches (12, 144, 1728); 1 in millimetres | likely |
| 0x228, 0x246 | UTF-16 × 13 each | the unit squared and cubed (" sq mm", " cu mm"; " sq ft" and " cu ft" for feet and inches) | confirmed |
| 0x264 – 0x276 | u16s | differ between the two unit sets seen (rounding and display options, probably); left as they are | |
| 0x278, 0x2a2 | UTF-16 × 21, × 13 | the area unit's name and mark ("Square Meters", " sq m") | confirmed |
| 0x2c0, 0x2ea | UTF-16 × 21, × 13 | the volume unit's name and mark ("Cubic Meters", " cu m"); the units end at 0x304 | confirmed |
| 0x94 + len | chunks | body, see below | confirmed |

The units rows are file offsets inside the settings block; they are the same in
every file seen (2023 to 2026). openvwx takes the unit's name from 0x1c6 when
it is printable, zero-ended text, the size at 0x1ac is positive, and a unit
it knows has its own size there; otherwise it falls back to the first word in
the block. File > Document Settings > Units writes 0x1ac to 0x304 for one of
nine units (millimetres to kilometres, inches, feet, feet and inches, yards,
miles), with the area and volume units openvwx shows for it, and leaves the
fields from 0x264 to 0x276 alone (written by openvwx, unconfirmed in VW).
The change is one undo step, and collaboration and timelapses carry it as a
header patch beside the record splice (`WireOp.header`); two header changes
made at the same time clash.

**Body**: repeated `[u32 compressed_size][raw Snappy block]` until end of file.
Each Snappy block decompresses to 1 MiB (the last one is shorter).
Concatenated, they form the **record stream** (9.2 MB for a 3.5 MB file).
Chunk boundaries do not line up with records. Any valid Snappy encoding is
accepted when reading; openvwx re-encodes with its own compressor and the
stream round-trips byte-for-byte.

## 2. Record stream

The stream is a flat sequence of records, laid end to end with no gaps
(56,923 in the sample). Every record starts with a 0x50-byte header:

| Offset | Type | Meaning | |
|---|---|---|---|
| +0x00 | u64 | record size including header | confirmed |
| +0x08 | u64 | next-sibling marker: 0 = last in list, else constant `0x05792ca4`. In a list closed by a terminator the terminator carries the 0 and the item before it keeps the marker (every terminator in the sample is 0; every symbol definition, the last of each folder too, has the marker) | confirmed |
| +0x10 | u64 | aux-list pointer: non-zero exactly when the record has attached aux records; values are unique | likely |
| +0x19 | u8 | **object type** (table below) | confirmed |
| +0x1a | u16 | **name index** into the name table (0 = unnamed) | confirmed |
| +0x1f | u8 | flags (0x40 / 0x41 / 0x48 / 0xc0 seen); copied unchanged on clone. 0x40 is on almost every record. In the sample 0x80 is on every rectangle and text of one container and nowhere else, 0x01 on about a quarter of lines and polygons in some 30 containers, 0x08 on lines and polygons inside groups; none of them tracks object locking yet | |
| +0x20 | u32 | **class index** into the name table | confirmed |
| +0x24 | u16 | **by-class flags** of drawables: which attributes come from the class (§6) | confirmed (2023 and 2026) |
| +0x26 | u64 | **owner pointer**: heap address of the parent at save time | confirmed |
| +0x38 | 16 B | object GUID (UUID, little-endian fields) | confirmed |
| +0x50 | … | type-specific body | |

### Rebuilding the tree

Records do **not** store their own address, but every child stores its
parent's address at +0x26, so siblings share an owner value. Records are
written in pre-order:

```
parent
  aux records (attached data; last one has next=0)
  child records (the last real child still has next≠0: the terminator follows it)
  terminator (type 0), closing a container's child list
```

Algorithm (see `records.build_tree`): keep a stack of (owner, parent).
For each record, if its owner is on top of the stack it's a sibling. If the
owner is deeper in the stack, pop back to it. If the owner is new, the
**previous record** is the parent; push. A type-0 record pops its list.
This reproduces a consistent tree for all 56,923 records.

**Aux part vs. objects.** A child list starts with attached aux records, and
the first record with next=0 ends that part, unless it is the terminator (a
list with objects but no aux records). Everything after it is objects. One
exception: symbol definitions (16) and plug-in objects (86) keep some groups
of drawn geometry in their aux part, so drawn types (2, 3, 5, 6, 10, 11, 14,
15, 21, 86) count as objects wherever they appear.

### Writing new records (what openvwx does; works in openvwx, unconfirmed in VW)

* Clone an existing record of the same type (with its aux children) as a
  template, give every cloned record a new GUID, and give a fresh unique
  value to +0x10 wherever the template's was non-zero.
* The root of the clone takes the parent's child-list owner (the +0x26 value
  shared by the parent's existing children) and next≠0. Each container inside
  the clone gets a fresh, unused address for its own children.
* Insert objects just before the container's terminator. All objects in a
  list carry next≠0, so no neighbour has to change.
* Deleting a subtree needs no other change for the same reason.
* Size fields (+0x00) must match the new length; nothing else stores offsets
  (the container is re-chunked on save).
* A new polyline (21) writes each vertex's kind into the kind byte of its
  vertex word (1 bezier, 2 cubic, 3 arc, 4 point on arc; an open polyline's
  ends stay corners). An arc vertex writes its radius at +20 when one is given
  (an edited one keeps its own), else 0 (as large as fits); a point-on-arc
  vertex caches the radius of the circle through it and its neighbours at +20.
  A cubic vertex writes the control point it is drawn from at +20 (y) and +28
  (x), placed as Vectorworks places it (see type 21 in the table); moving,
  turning, scaling or mirroring a polyline carries its controls with the
  vertices, which leaves them where placing them again would. Rewriting the vertices sets every edge's 0x80 bit, so hidden edges
  are shown again.
* Simplify Polys takes vertices out of a polygon (5), polyline (21) or 3D
  polygon (25) and keeps the rest byte for byte: the record up to its first
  vertex, then each kept vertex's whole entry (16, 36 or 24 bytes), the count
  (+0x8e; +0xd0 in a 3D polygon) and size following, and the box (+0x68; a 3D
  polygon's 3D box at +0x9c too) set to the kept vertices' (as every one of
  the samples' 9,229 polygons, 3,876 polylines and 119,952 3D polygons has
  it, curved polylines included, and every record ends after its vertices).
  A polyline corner joining a shown and a hidden edge stays, so each edge
  keeps its 0x80 bit; a textured 3D polygon keeps its second vertex, since its
  texture is laid along its first edge (§7.1). Read back and reopened in
  openvwx; not yet checked in Vectorworks.
* A new extrude (24) copies an extrude in the drawing (one saved without a
  body and holding only TDMD aux records, when there is one), keeping its
  TDMD aux records (its texture parts set to none) and terminator. It takes
  the profile's class, attribute block, by-class flags and material (+0x88),
  an identity frame (rows at +0xcc, offset +0x114 zero), the profile's bounds
  as its plan box and as its 3D box from z 0 to the height, and holds the
  profile record itself (next≠0) before the terminator. It has no body (114):
  every extrude on a design layer in the demos has one, but those inside
  groups, plug-ins and solids often don't (see §7, 3D). A drawing with no
  extrude gets a built-in one: the 324-byte header with header flags 0x40,
  0x11 at +0x2f, 0x6000 as the u32 at +0x98 (14,882 of the four demo
  drawings' 15,297 extrudes) and at +0x12c the 24 bytes most of them share
  (12 zeros, f64 3.175, u32 0x44); then the two TDMD aux records every one
  of them holds, SCDT (the same 41-byte body in all 15,297) and the commonest
  ttwr (289 bytes, its texture part none), each with 0x12 at +0x2f; then an
  88-byte terminator. Multiple extrudes, sweeps and solids are made from it
  as from one of the drawing's. Read back and reopened in openvwx (a wall
  extrude with a window subtracted shows its hole); not yet checked in
  Vectorworks.
* A new multiple extrude (38) is a new extrude's records with the type byte
  (+0x19) set to 38: in the demos the two kinds' headers (324 bytes each)
  differ in no other byte that is the same across every bodiless one of
  either kind. It takes the backmost profile's class, attributes and
  material, the profiles' joint bounds as its plan box and 3D box (z 0 to the
  height), and holds the profiles in stacking order (the first at the bottom,
  as in the demos' bodies). It leaves out the 306-byte type-42 record every
  saved multiple extrude has, which lists its profiles' corners at the bottom
  and top heights (the second profile's at the bottom, the first's at the
  top, in every demo one whose profiles differ), as a new extrude's profile
  leaves out the 42 that lists its vertices at both heights (2023 demo: all
  5,193 2D shapes holding a 42 are extrude profiles but for 7 sweep
  profiles; 2025: all 413); like a new extrude it has no body.
* A new solid (84, Add Solids and Subtract Solids) is a new extrude's
  records with a 386-byte header: the extrude's 324 bytes with the type byte
  set to 84 (in the demos the first 324 bytes of both kinds differ in no
  other byte the same across all of either, but the record size at +0x00),
  then 62 bytes that are 0 but for +0x17c = 1 (in every solid in the demos),
  the operation at +0x17d (1 add, 3 subtract, §3D) and a u32 at +0x17e of all
  1s (1,221 of the 2023 demo's 1,319 adding or subtracting solids; small
  numbers in the rest, unknown). It takes the backmost operand's class,
  attributes and material, an identity frame, and as its plan and 3D box
  the bounds of what the 3D view draws of its operands (of the first alone
  for a subtraction); the operands follow its TDMD records in stacking
  order, the backmost first. Like a new extrude it has no body.

### Top level

The root has two lists back to back:

1. **Document data**: aux data (76), header/prefs (33), **name table (55)**,
   symbol library (54 → symbol folders 92 → symbol definitions 16), class
   list (57 → classes 94, record formats 47, …), …, ending with type 80 (next=0).
2. **Layer list**: the layers (31) in stacking order, then a terminator.
   Each layer and everything under it is one contiguous run of records, so
   reordering layers means permuting those runs.

## 3. Name table (type 55)

```
+0x58  u32 count
+0x5c  count × { u32 index; u32 byte_len; UTF-16LE name[byte_len/2] }
```

Holds classes, symbols, record formats, line types, hatches… (235 entries).
Objects point at it via the header's name index (+0x1a) and class index
(+0x20). Layer names are **not** in it; they are stored inline (see below).

Layers still have name indices (e.g. 334, 183) that are missing from the
table, so the index space is shared. To add a class, openvwx takes an index
above the highest one used anywhere in the file (2092 in the sample; the
table's own maximum is only 1811), appends `{index, name}` to the table, and
inserts a cloned class record (94) with that name index into the class list
(57). Deleting a class moves records whose class index (+0x20) points at it
to "None", then removes the record and the table entry.

Naming an object (a viewport's name is its object name) works the same way:
an unnamed object (+0x1a = 0) takes a fresh index and a new table entry; a
named one has its entry rewritten, unless another record points at the same
index, when it takes a fresh one instead; clearing the name sets +0x1a to 0
and drops an entry nothing else uses. Names are unique across the table.

## 4. Object types

| Type | Object | Body layout (offsets from record start) | |
|---|---|---|---|
| 0 | terminator | none | confirmed |
| 2 | line | +0x68 `y1 x1 y2 x2` (f64) | confirmed |
| 3 | rectangle | +0x68 bbox `top left bottom right` (axis-aligned bounds of the turned rectangle); +0x88 u32 material (below); +0x8c origin `(y, x)`, the rectangle's own bottom-left corner; +0x9c / +0xa4 its x axis stored (sin, cos), (0, 1) unrotated; +0xac width; +0xb4 height. Corners are origin + s·(cos, sin) + t·(−sin, cos) for s in [0, w], t in [0, h]. Door and window plug-ins leave some frames stale (sized ×90); the bbox is right, so a frame that does not span it is ignored, except in an extrude's profile, where the extrude's own 3D box settles it: in the 2023 demo it fits the bbox for 24 of the 27 profiles whose frame doesn't span theirs, and the frame for 3 (bodied: the body agrees) | confirmed (88 sample rects turned by 2e-6 rad match the bbox exactly; the opposite sign misses by 2e-3) |
| 5 | polygon | +0x68 bbox, not always the vertices' (below); +0x8d u8 closed; +0x8e u16 n; +0x90 n × `(y, x)` f64; record ends after the vertices | confirmed |
| 6 | arc/circle | +0x68 bbox; +0x90 start pt; +0xa0 end pt; +0xb0 center `(y,x)`; +0xc0 start°, +0xc8 sweep° (QuickDraw angles; math start = 90 − qd start, math sweep = −qd sweep; start pt is at the math start angle). Ellipses and elliptical arcs use the same record: the bbox is the whole ellipse's, so its half-sizes are the x and y radii, and the angles are relative to that box (45° points at its corner), i.e. parametric. Ellipses written this way decode and round-trip here; not yet checked in Vectorworks | confirmed (circles), likely (ellipses) |
| 10 | text | §4.1 | confirmed |
| 13 | rounded rectangle | laid out as a rectangle (+0x68 bbox, +0x8c origin `(y, x)`, +0xac width, +0xb4 height), then f64 corner diameters at +0xbc / +0xc4 (taken as y, x; equal in every sample). Viewport crops and the 2026 tags (diameter a third of the height, as published). Every sample's is upright: a turned one is written with a turned rectangle's frame (+0x9c / +0xa4) and each diameter scaled with the side it lies along (+0xc4 with the width, +0xbc with the height), unconfirmed against one Vectorworks turned | likely |
| 11 | group | +0x68 plan bbox (top, left, bottom, right), ±DBL_MAX when it has no plan drawing; +0x9c 3D bbox stored `x1 y1 z1 x0 y0 z0`, ±DBL_MAX when it has no 3D content (groups of plan drawing; see **Top/Plan** below); aux records, children, terminator | confirmed (2026 door plug-ins: a hinge-marker group's 3D box is the leaf's face, 711 × 0 × 2032, its plan box the line that face makes) |
| 14 | image | +0x68 bbox; +0xd4 / +0xdc top-left origin `(x, y)`; +0xec / +0xf4 width and height in world units; +0x128 / +0x12c u32 pixel width and height, +0x130 u32 depth (32); +0x13a a QuickTime image description, little-endian, 0x56 bytes: its length, the codec's four-character code stored back to front (`gepj`, ` gnp`), vendor `lppa`, quality 0x200, u16 pixel width and height at +0x15a / +0x15c, 16.16 resolutions (72 or 300 dpi), the stream's length at +0x166, frame count 1, the codec's name as a Pascal string at +0x16c ("Photo - JPEG", "PNG"), depth 32 at +0x18c, colour table −1; then the PNG/JPEG stream from +0x190, the record padded to an even length. An 8-bit picture has depth 8 and colour table 0, and its description is 0x85e bytes: a 0x808-byte QuickTime colour table follows (u32 seed, u16 flags, u16 count 255, 256 entries of u16 index and u16 red, green, blue), and the stream starts at +0x13a plus the description's length (+0x998). Such a picture whose fill is none has its white clear (every 8-bit picture in the 2022 and 2025 test files is a palette PNG of a tree or plant with fill none, the photos and logos beside them JPEGs with a solid fill); openvwx draws it so by marking the palette's white entries clear (a tRNS chunk), as Vectorworks is understood to openvwx adds images (File > Import Image…, Edit > Paste as Picture) by copying an image record of the file and writing these fields (a 32-bit description, whatever the copied record's depth) | confirmed (layout, all six images in the 2026 sample; 8-bit pictures in 46 of 262 images across four 2022–2026 files); adding not yet checked in Vectorworks |
| 15 | symbol instance | +0x68 bbox (cache); +0x8e u16 symbol name index; +0x96 4×3 f64 matrix: 3×3 linear part as row vectors (x' = x·m00 + y·m10), then the translation (x, y, z) at +0xde / +0xe6 / +0xee; +0x100 x/y/z scale. Definitions are in symbol coordinates (insertion point 0,0); the sample's two instances are identity with zero translation and their bbox equals the matrix applied to the union of the definition's objects' stored bboxes. openvwx keeps a definition's bbox and its instances' in step with edits inside it only where they followed these rules before the edit | likely (no moved or rotated instance in the sample) |
| 16 | symbol definition | name via header name index; +0x68 bbox = union of its objects' stored bboxes (22 of 23 in the sample; the other holds only a plug-in object whose stored bbox is 100 times the definition's, and the definition's matches the plug-in's drawing). One of the aux children is an empty group (11) holding only aux records, which object lists show as a group; 7 aux children (types 11, 119, 76 in varying order), then the objects (owner = the terminator's +0x26), then a terminator; bytes past +0xcc look like stale heap data. Lives in the resource library (54), at its top level or in a folder (92). openvwx creates new ones by cloning a top-level definition's record, aux records and terminator (one with no records attached and no drawing in its aux groups when there is one; any drawing in the aux groups it keeps is left out, their boxes written empty: ±DBL_MAX in plan and 3D, as all 176 empty aux groups of the sample and the 2023 demo store them) | confirmed (layout), likely (what VW needs) |
| 9 | 3D locus | 0x7e bytes: the header and attribute block (constant in the demos: `02 00 00 00 02 00 01 01 00 01 01 01 00 01 64 64`, then a 1 at +0x64), then three f64 at +0x66 to the end of the record, taken as its point `(x, y, z)` as a 3D polygon's. All ten in the demos, under symbols and a group, hold zeros there, so the order is by analogy and unconfirmed. openvwx writes these. |
| 17 | 2D locus | 0x78 bytes: the header and attribute block (constant in the demos: `02 00 00 00 01 00 01 01 00 01 01 01 00 01 64 64`, then zeros), then its point `(y, x)` at +0x68, laid out as a line's first point. Header flags 0x40 and by-class 0. Most carry aux records (76 and 48), one in each demo none; parents are layers and groups. openvwx copies a locus of the file, or writes this layout when the file has none. A sweep may hold one beside its profile, as its axis (§3D) | confirmed (the point's order by the six demo sweeps that hold one: each one's 3D box is centred on its x) |
| 18 | worksheet | §7.2 | confirmed (2023 tables match the published sheets row for row) |
| 21 | polyline | like polygon, but 36-byte vertices: `y, x (f64), u32 kind, f64 radius, f64` (a cubic vertex's +20 and +28 are its control point, y then x); kind = (word >> 8) & 0xff: 0 corner, 1 bezier, 2 cubic (a point the curve passes through: drawn as a bezier vertex at its control point, a quadratic from the previous vertex, or the midpoint of the two controls when that one bends too, to the next likewise; Vectorworks starts each control on its vertex, then makes 5 rounds, all controls at once, of c += 4/3·(v − (m0 + 2c + m1)/4), m0 and m1 the ends of the bend, which leaves 3⁻⁵ of the first gap), 3 arc (a fillet tangent to both edges, of the radius at +20; 0 is the largest that fits, reaching the nearer neighbour or half way to one that curves too), 4 a point on an arc from the previous vertex to the next (+20 caches its radius); bit 0x80 of the word set = the edge to the next vertex is drawn (clear on hidden edges: section viewports use them for hatch strokes and outlines whose closing edge is not drawn); record ends after the vertices | likely (kinds), confirmed (2: the 69 cubic vertices in the 2023, 2024 and 2026 demo files hold the controls this places, to 1e-12, and their bounds match; none has a cubic neighbour, so runs of them are likely; 0x80: the long diagonals in the demo files' section viewports all leave a vertex without it; 4: the radius of the circle through the three vertices matches +20; 3: the batt tile's loops round its corners as the published sections print them) |
| 25 | 3D polygon | +0x68 plan box (1,311 of the 2023 demo's 1,318 match their points); +0x8d u8 closed; +0x9c 3D box, highs then lows as a group's (the z range there in all 979 that aren't flat); +0xd0 u16 n; +0xd2 n × `(x, y, z)` f64, in the frame of the layer or group holding it, heights as in the model (the layer's elevation is already in them, §5); the record ends there. openvwx writes new ones (Convert to 3D Polygons, Create Contours, whose open ones have 0 at +0x8d, and add3DPolygons) from one of the drawing's, or, when the file has none, from a built-in head (plain attributes, header flags 0x40, 0x11 at +0x2f as in 59,744 of the 2023 demo's 59,976, closed), with both boxes fitted, +0x10 cleared and no aux records, and moves, turns, mirrors and scales them through their points in plan, refitting both boxes. Top/Plan draws one as its outline seen from above, edges only | confirmed |
| 29 | a design-layer viewport's layer entry | §7, **Design-layer viewports** | confirmed |
| 40 | mesh | +0x68 plan box; +0x9c 3D bbox as a 3D polygon's; +0xd0 u32 vertex count; +0xd4 28-byte vertices `(x, y, z)` f64 + 4 flag bytes, in the frame of the layer or group holding it. Faces are type-41 children after its aux records (TDMD dictionaries: every mesh has a "ttwr" texture one), each with its own attributes and texture, and a terminator ends them. +0 is the record's length; the u64s at +0x8c and +0x94 look like memory addresses saved with it. The 4 bytes after each point are 00 01 00 00 on every vertex of 138 of the 197 meshes and 01 01 00 00 on 55's (meaning not known). openvwx moves, turns, mirrors and scales a mesh through its vertices, refitting both boxes, and writes new ones (Convert to Mesh, imports, addMeshes) with a mesh of the drawing's record up to its points, the 138's vertex bytes and no aux records. When the file has no mesh it writes a built-in one with what every mesh in the 2023 and 2026 demos shares: header flags 0x41, 0x11 at +0x2f (the faces' and terminator's too), the u32 at +0xcc all 1s, a solid fill (pattern 1) and plain pen; faces as below with flags 0x40, and an 88-byte terminator with no flags at +0x1f. Read back and reopened in openvwx; not yet checked in Vectorworks | confirmed (all 197 meshes in the demos) |
| 41 | mesh face | +0 its length; +0x68 plan box and +0x9c 3D box as a 3D polygon's, both left empty (±DBL_MAX, the 3D box's highs below its lows) in the 40,419 faces with 1 at +0x8d, while the other 1,772 have 0 there and a 3D box round their corners; +0xcc u16 corner count; +0xce u32 vertex numbers, counted from 1. Faces are convex (openvwx draws each as a fan from its first corner). Every face has the mesh's class (all 197 meshes), the mesh's attributes in 193, and its next mark set; 214 hold a 121 record. openvwx writes them as the 40,419 are, of at most 10 corners | confirmed (42,191 faces, 3–10 sides) |
| 66 | hatch definition | +0x51 u8 flags: bit 0 set, the lengths are paper sizes (a layer or viewport at 1:n draws the hatch n times larger); clear, world sizes (a viewport's drawing shrinks them with its scale). +0x54 u16 colour index of the hatch's ground; +0x56 u16 line count; +0x58 60-byte lines: base, period (along the line; its length is the dash repeat) and offset to the next parallel line, each stored `(y, x)`, dash fraction (1 = solid), all f64 with lengths in inches; then u16 colour index at +56 and u8 pen weight in mils at +58 (+59 a pad byte); the record ends after the lines. Children: two 119 previews (256 and 64 px PNGs of the pattern) and in some an aux 76 tagged "SGAT" (its tags); its parent is a type-65 record in the sample. A hatched object draws in these colours, not its own fill colours. openvwx writes an edited hatch's changed lines only (an unchanged line keeps its 60 bytes, so 11 of 11 sample hatches write back byte for byte), draws its previews anew at the sizes it had, and makes a new one by copying a hatch's records (without its tags unless duplicating) | confirmed (drawn hatches match the names, e.g. "Wood Flooring 3in": lines 3" apart, "Exterior Deck Boards 3in Horiz": horizontal boards; the 2023 wall components print their concrete, insulation and gypsum hatches on their own grounds at paper size, whatever the objects' fill colours) |
| 108 | tile fill | repeat vectors stored `(y, x)` f64 at +0x5a and +0x6a; the motif is ordinary objects in type-11 child groups, in world units (mm), drawn in the pen colour. A rectangle with a weight-0 pen frames the repeat cell and is not printed | confirmed ("Wall Insulation Batt": a 6" repeat across the batt; its frame never prints) |
| 109 | text style | always 110 bytes: +0x52 u16 font (its place in the font list, as a text's), +0x58 f64 size in inches (points ÷ 72), +0x62 u8 vertical and +0x63 u8 horizontal alignment (a text's values, §4.1); +0x56, +0x57, +0x60, +0x61 and +0x64 unknown (+0x56, +0x57 and +0x64 are 1 in all 10 demo styles; +0x60 and +0x61 are 0xff in 8 and 0, 1 in the other 2); two 119 previews as children (256 and 64 px PNGs of "ABCD", "abcd" and "0123" in the style's font, centred, black on clear). Texts name it by its name index (§4.1), classes at their +0xb8 (§5). openvwx edits the four known fields in place, draws the previews anew, and makes a new one by copying a style's records, or in a drawing with none, from a hatch's or gradient's header and previews with the unknown bytes as most demo styles have them | confirmed (the 499 texts in the 2026 demo that name one of its 4 styles all have that style's font and alignment) |
| 120 | gradient fill | +0x52 u16 stop count; +0x54 24-byte stops: f64 position (0..1), f64 midpoint (where the blend to the next stop is half way, as a fraction of the gap), u16 R, G, B (0..255), u16 opacity (0..100). Each object lays it out with its type-121 child | confirmed (the cover sheet's fades to clear match the published sheet) |
| 121 | fill mapping (child of a filled object) | 136 bytes: three points stored `(y, x)` at +0x50, +0x60, +0x70 in the object's coordinates; +0x86 u16 gradient shape: 1 linear (from the first point to the second), 2 radial (centred on the first, radius to the second). For tiles and hatches the second and third points are the ends of the pattern's two axes; their length does not set a hatch's size (the 2023 walls' axes are 25.4 or 1219.2 mm long, and print the same), but it does a tile's: one repeat cell, the one centred on the tile's origin, spans the parallelogram from the first point along both axes, the first taking the tile's more nearly horizontal repeat. A few stale ones lie far off their object. openvwx gives an object without one a copy of another, first among its aux records, where the file's own sit | likely (gradients drawn this way match; hatches are laid from the origin along the axes; every batt in the section caches spans exactly 0 to 1 of its second axis, whose length keeps the cell's 59.5:152.4 ratio, and prints one loop across its depth) |
| 97 | texture (RenderWorks) | +0x5a f64 image size in inches; image via its 48 → 93 → 119 children (PNG/JPEG); the 119 preview stands in when there is no image. The 48's format names the shader: "NNAMaxon Image Color" holds the image shown, "NNAMaxon Image Mask Transparency" a mask that cuts it out (black clear, white solid; image props and Laubwerk plants, 67 of a private sample's 279 textures), and comes before it. Lives in the class list (57), at its top level or in a folder (92). Its children are previews (119), tagged type-76 records and its shaders' settings as 48 records of data record formats (§7.3); none holds the texture's own name index, and classes name it by that index. openvwx imports one from another file by copying its records, pointing each 48 at the drawing's format of the same name, or a copy of the other file's when the drawing has none. A texture Vectorworks makes from one image (16 in the four JohnMosbyHwy demos) is 97 → 119 (256 px preview), 119 (64 px), 48 "NNAMaxon Image Color" (i32s 1, 41, 1, 4, 1, then the image's average R, G, B, then a boolean true), 93 → 119 (the image), 48 "NNAPreview Object Options" (8, 2, 1, 1, then a dimension: twice the image size) and 48 "NNAShadow Options" (8, 1, 1, true, true); its 93 holds f64s 0, 0, height/2, 0, height/2, width − 1 (pixels) and the size in inches from +0x50, then bytes 1, 1 (other textures' 93s hold other numbers there: meaning not known). openvwx makes new ones so (SketchUp import), with the shader formats as the demos define them (field names kept only where every file has the same, stale bytes left out) in a TMFH list it starts at the top of the class list when the drawing has none; read back by openvwx, not yet opened in Vectorworks | likely |
| 114 | 3D body (extrude, sweep, solid, wall/slab cache) | +0x5a u16 section count; +0x60 u32 offsets; section 0 points `(x, y, z)` (in the owner's own frame for extrudes and sweeps, in its parent's for multiple extrudes and solid additions, §3D), 13 curves, 14 lines (edges), 19 Parasolid XT (not decoded). Faces are rebuilt from the edges (see §7) | likely |
| 122 | viewport (on a sheet; none sits on a design layer in any sample, where design-layer viewports are plug-ins, below) | §7 | confirmed |
| 31 | layer | see §5 | confirmed |
| 33 | document header / preferences | | |
| 47 | record format (data record definition) | §7.3 | confirmed |
| 48 | record (data attached to an object; a plug-in's parameters) | §7.3 | confirmed (every record in the four demo years reads) |
| 56 | worksheet image (a worksheet placed on a sheet) | §7.2 | confirmed |
| 60 / 61 | worksheet database block / its sort order | §7.2 | confirmed |
| 63 | dimension | always 848 bytes. +0x68 bbox: its drawing and its two measured points; the points stored `(y, x)` at +0x9e / +0xa6 and +0xae / +0xb6, the second further along the line than the first; +0xbe f64 how far the dimension line lies from the first point along the left-hand normal (-u.y, u.x) of +0xc6 / +0xce, the unit direction `u` it runs in, `(y, x)` (a horizontal or vertical one keeps x or y there whatever way its points lie; an aligned one, theirs); +0xe6 f64 and +0x10e f64 sizes that follow the dimension standard (76.2 and 135.47 in most demo dimensions), +0xee to +0x10d an empty box (±DBL_MAX). No flag for constrained against aligned was found in the record or its aux. Aux: 76 (a 121-byte one holding an id in every dimension; in 2024 and later often a nested 63 too; 110 record data). A plain linear one's children: an extension line from each point (starting a gap off it, on the side the dimension line is, a point on the line counting as the negative side, and running past the line), the dimension line's run past each extension line (before the first along `u`, after the second), the dimension line itself foot to foot (the only one with markers, 125), then a group holding its value text. See **Linear dimensions** below | confirmed (the Dover Dam demos 2023, 2024 and 2026: the dimension line lies where the points, offset and direction put it in 742 of 746, 3,312 of 3,316 and 7,617 of 7,631 dimensions; the text reads along `u` in 99 %, and is the length in the document's units in 94 %; the box is the drawing's and the points' in all but 1 % (those, the drawing's alone); the whole drawing matches that layout in 470 of 492 and 3,902 of 3,944 plain linear dimensions in 2023 and 2026, the rest having extension lines dragged off their points) |
| 54 / 92 | symbol library / folder | | likely |
| 55 | name table | §3 | confirmed |
| 57 | class list | also holds record formats (47) and the folders (92) of textures, tiles and gradients | confirmed |
| 68 | wall | +0x68 plan box (§4.2; ±DBL_MAX in the 2026 demo's walls, and the view's box on a layer saved in a 3D view); +0x9e the ends of its control line, `(y, x)` f64 each, laid out as a dimension's measured points; +0xbf f64 thickness; +0xc7, +0xd7, +0xe7 f64 top and +0xcf, +0xdf, +0xef f64 bottom, z in the model, the layer's elevation in them (§5) (the first pair the wall's own, the others nearly always the same); +0xf7 u32 the name index of its wall style (127). Children: aux records (76, 69 components, 110, 116, 124, 91), then its plan drawing (polygons, lines, polylines, loci), a group of bodies and its solid additions (§7, Walls in 3D), and the doors and windows in it (86) | likely (the Dover Dam demos, 2023 to 2026: the line lies inside the wall's 3D in 191 of 246, 180 of 237, 178 of 235 and 146 of 201 walls; the thickness is the 3D's width across 136 of 149, 120 of 129, 118 of 127 and 68 of 77 walls along x or y; the top and bottom match it in 70 to 92 %; doors, joins and components set off from the line account for the rest) |
| 71 | slab: the 2023 demo's sloped roofs, fascias and ceilings, and the component pieces inside slab plug-ins and inside other slabs | aux 69 components; +0x104 u32 the name index of its style (a type-102 slab style; 0 inside plug-ins); children a polygon (the outline), a slab per component with its polyline, and an overlay group | confirmed (2023: the three roof slabs name the standing seam roof style, the fascias and ceilings theirs) |
| 71 | slab, continued: the fields | 309 bytes in every demo year. +0x9c three plan points `(y, x)` f64: on a roof face its eave line's two ends and a point up its slope; +0xcc f64 thickness; +0xd4 and +0xf8 f64 heights, z above its layer; its body (114, with Parasolid data) is an aux child in its parent's coordinates, so it moves with the slab as a solid addition's does | likely (the 2023 demo's flat pieces: the thickness is the 3D's height in 86 of 98, +0xd4 and +0xf8 its bottom in 86 and 90; the later demos' 9 roof faces: the three points within 2 m of the 3D in 8 or 9) |
| 76 | aux data, sub-tagged by a 4-char code at +0x50 (`TDMD`, `NCSW`, `NCVS`, `NCLS`, `lgdr`, `xsae`, …) | | |
| 80 | end of document-data list; body is the classic 256-entry palette, RGB16 × 3 per entry from +0x50 | likely |
| 86 | plug-in object (parametric) | +0x68 bbox (often not the drawing's: some types store other bounds); +0xf0 4×3 f64 matrix laid out as a symbol instance's (row vectors, translation at +0x138 / +0x140), in all four demo years. Children hold the cached 2D drawing (its text drawn right way up: turned past 90° up to 270° by the matrix, as tags on plug-ins turned half a turn are, it turns half a turn about its own box, as published) in the plug-in's own coordinates, placed by that matrix, as are its 3D parts (§7, 3D), z included; aux-position groups can be part of it (a title block logo). Moving one moves its bbox and translation only. Its parameters are a type-48 record (§7.3). A design-layer viewport is one, with type-29 children (§7) | confirmed (title block logos, room labels, grid bubbles and site trees land in place; of the turned plug-ins, 237 match their bbox read as row vectors against 37 transposed) |
| 94 | class | §6 | confirmed |
| 101 | drop shadow (aux child of the object that casts it) | always 112 bytes: +0x50 u8 1 = the shadow is drawn (0 keeps the settings unused); +0x54 f64 blur radius and +0x5c f64 offset, paper inches; +0x64 f64 angle°, the direction the shadow falls, counter-clockwise from +x; +0x6c u16 colour index; +0x6e u8 opacity %. Defaults 0.1, 0.05, 135°, black, 75 %. See **Drop shadows** below | confirmed (2023 demo against its published PDF: the cover title falls below right at 315°, the 45 site trees left at 163°); which of the two f64s is the blur is likely only (equal in every shadow drawn) |
| 119 | preview image (PNG/JPEG at +0xea) | u32 width at +0x7c and height at +0x80; from +0x94 a QuickTime image description: its size (u32: 0x56, or 0x66 when a 16-byte "gama" atom follows it), the codec at +0x98 (`png ` or `jpeg`, stored backwards), the size again as u16 at +0xb4 and +0xb6, 72 dpi, u32 image length at +0xc0, the compressor's name as a 32-byte Pascal string at +0xc6 ("PNG", "Photo - JPEG"; stale bytes often follow it), u16 depth at +0xe6 (32, or 24 for some JPEGs) and −1 at +0xe8. An 8-bit image has depth 8 and 0 at +0xe8, and a 0x808-byte colour table after the description (its size then 0x85e, the image at +0x8f2; 121 of 4,103 in four 2022–2026 files). The image follows the description; when the record's length would be odd, one pad byte ends it (its value can be anything). Hatches and gradients keep two (256 and 64 px square), line types a 256 square and a 128 by 32 (PNG or JPEG). The byte at +0x7b tells a texture's large preview (2) and small one (1) from its image (0) in all 16 of the demos' image textures | confirmed (85 of 85 previews in the sample end where the description and length say; written back with their own PNG, all 85 match but for the pad byte) |
| 127 | wall style | named by its header name index; children its components (69), aux records (76) and a preview (119) | likely (2023: 38 styles; every wall on a layer names one, and walls naming the same style share one thickness, 37 of 37) |
| 125 | line markers (aux child of a line, polygon, arc or polyline) | always 100 bytes: two 10-byte markers, the start's (first point) at +0x50 and the end's (last point) at +0x5a; no child, no markers. Each: +0 u8 style (0 filled closed arrow, 2 filled dot, 3 slash; others not drawn); +1 u8 unknown; +2 u16 size in 1/16384 inch on paper (0x0800 = 0.125"): an arrow's length tip to base along the line, a slash's whole length, a dot's diameter; +4 u8 angle°: each side of an arrow against the line (its base is 2·size·tan(angle) wide), a slash's turn from the line, counter-clockwise; +5, +6 u8 unknown; +7 u8 1 = drawn (0, 0xff, 0x6d and the rest hide it); +8 u16 width (a dot's equals its size, else 0). See **Line markers** below | confirmed (2023 demo against its published PDF: 106 of 106 visible arrows, 1 of 1 dot, 1,492 of 1,492 dimension slashes) |

Named by their header name index, so their role is fairly clear: 66 hatch
definitions (layout above; 29 in the Dover Dam demo, 11 unused ones in a private
sample), 96 line types (dash styles, see §4.2), 18 worksheet (a drawing
issue sheet), 74 font list (see §4.1). A fill pattern −n (§4.2) names the
hatch, tile or gradient resource whose name index is n.

Unidentified types in the sample: 26–28, 39, 43, 44, 62, 65, 69, 70,
77–79, 88, 102, 107, 112, 123, 124, 127. (102 holds the slab styles slabs
(71) name; 107 those of slab plug-ins.)

**Stored bounds.** A polygon's or polyline's bbox (+0x68) is not always its
vertices': 1,703 of the 19,390 in the 2023 demo differ, and 991 lie
elsewhere altogether, among them the sloped roof slabs' faces and imported
site linework, while the vertices draw where the published sheets print
them. openvwx takes their bounds from the vertices (polylines' flattened
curves), so the drawing is culled, hit and hatched where it is; a hatch
laid only over the stored box covered one band of the roof.

**Line markers** (type 125, confirmed). An arrow's tip sits on the end
point, pointing out of the shape along it: along the first or last segment
of a polygon or polyline (closed ones too, from their first and last
vertex), along the tangent at an arc's ends. Dots and slashes are centred
on the end point. Markers draw in the object's pen colour, arrows and dots
filled; openvwx strokes slashes at the pen's weight and leaves markers out
where the pen draws nothing. Their sizes are paper sizes, like line-type
dashes: a design layer or plan viewport at 1:n draws them n times larger in
its own units, and annotations inside a viewport, already on the sheet, at
size. openvwx skips markers of size 0 (some 2023 polygons have arrows
marked drawn with size 0). Plug-in objects (86) carry type-125 children as
well; openvwx draws only the markers of the geometry in their cached
drawing. openvwx writes markers into the object's type-125 record, adding
one ahead of its drop shadow (101) when it has none, as the samples order
them (76, 125, 101): the header copied from a type-125 record in the file,
both ends Vectorworks' hidden default arrow (1/8", 15°, +5 and +6 = 2)
until set. A shown marker gets +7 = 1, a hidden one +7 = 0; its other
settings stay.

**Linear dimensions** (type 63, layout confirmed; written ones unconfirmed
in VW). With `u` the dimension's direction (+0xc6), `n` = (-u.y, u.x), `d`
its offset (+0xbe) and `g`, `o`, `e` the standard's gap, overshoot and
run-on (76.2, 152.4 and 76.2 mm in most demo dimensions): each point `p`'s
foot `f` is its projection onto the line through the first point along `u`,
moved `d` along `n`; its extension line runs from `p + s·g·n` to
`f + s·o·n`, `s` the side of `p` the foot is on (−1 when it is on `p`); the
runs past are `f₁ − e·u` to `f₁` and `f₂` to `f₂ + e·u`; the dimension line
`f₁` to `f₂`. The value's box is centred on the dimension line's middle
along it and set off it towards the text's own up (it reads left to right,
or upwards), 231 mm to the box's top in most demo dimensions. openvwx makes
a new linear dimension by copying a plain one (aux records only of type 76
on it and its text group; nothing else attached) in the text size most
share, design-layer ones first, then annotations' and plug-ins': it writes
the points, offset and direction, redraws the five lines from the copied
one's own gap, overshoot and run-on, sets the value with the copied text's
size and alignment so its box sits as the copied one's does, and fits the
group's box and the dimension's (drawing and points). The demos have no
dimension on a design layer; the one copied comes from a viewport
annotation or plug-in at its own scale, so its spacing and text size are
that scale's. Editing a plain linear dimension redraws it the same way from
its own spacing and value: its new points (the second kept further along
`u`, the two swapped when not), direction and offset written, its lines laid
again, its value sized and set as it was beside the middle of its line, and
its box and its group's fitted. A value that stays the same keeps its own
characters' widths and is moved and turned with the line; a new one is laid
out with widths Rodeo estimates. Redrawn unchanged (43 of the 2023 demo's
470 plain ones), the lines stay within 0.0001 mm and the value where it was.

**Drop shadows** (type 101, confirmed). An object whose type-101 child has
its flag set casts a blurred copy of itself, offset by the distance along
the angle, in the shadow's colour and opacity, under it. Sizes are paper
sizes, as marker sizes are: the site trees' 0.5" shadows reach four times
as far, against the trees, in the 1:192 site plan as on their 1:48 layer. A
plug-in, symbol or group with a shadow casts it from its whole drawing as
one shape, so overlapping parts do not darken it twice. Of the 378 type-101
records in the 2023 demo, 46 are set (a title text and 45 tree plug-ins);
the other 332 carry the defaults unused. The type-101 record is always
the last of the aux part (next = 0), groups' too, where objects follow it.
openvwx sets the flag and the settings in place, and for an object without
one appends a record holding the defaults there (the header copied from one
in the file; +0x10 of the object made non-zero, as for any record with aux
records).

**Container opacity.** A plug-in's own fill and pen opacity apply to its
cached drawing on top of the drawing's own: the 2023 site trees are plug-ins
at 65 % whose canopy polygons are at 100 %, and the published site plan
shows the canopies at 65 % over their shadows.

**Top/Plan.** A polygon or polyline (5, 21) that is open but has a fill
paints it as if closed; its pen leaves out the closing edge. Plug-in
outlines often are such polylines: the 2023 kitchen counters are a slab
plug-in whose dark component lies under a white open top outline, and they
print white. A plug-in or symbol with 2D geometry besides its 3D solids
(extrudes 24, 3D polygons 25, sweeps 34, multiple extrudes 38, meshes 40,
solid additions 84, generic solids 113) prints only that 2D part: the
cabinet plug-ins keep their footprint beside the extruded panels of their
3D model, whose profiles, drawn flat, land up to a metre outside it, where
the published plan shows bare floor. Every plug-in with 3D solids in the
2023 demo has 2D geometry too. Instances (15) of symbols that hold no 2D
geometry are 3D parts as well: in 2026 the door plug-ins place their
hardware as all-3D symbols, which would otherwise print as crossed boxes.
2D objects can belong to the 3D model too, drawn on a vertical plane: a
group that holds part of a 3D model has 3D bounds that rise (above), and a
2D object in it that reaches outside the group's plan bounds, or an area
flattened to a line, stands on such a plane and Top/Plan sees it edge on.
Doors and casement windows hold their hinge markers so, on the leaf, for
elevations (2023: 76 lines; 2026: 145 lines and polygons, in doors,
windows, door-and-window assemblies and cabinets), and a sectional sofa
symbol a side-view line; drawn flat, they stand out of the wall or land
beside the sofa, and the published plans print none of them. The plan parts
of the same plug-ins lie inside the bounds, whose union they are, and the
groups of plan drawing have no 3D bounds, or flat ones (stair treads, site
modifiers). A 3D solid outside such a container prints
as wireframe: its profile without a fill (an extruded cabinet on a design
layer prints as an outline).

### 4.1 Text record (type 10)

| Offset | Meaning | |
|---|---|---|
| +0x68 | bbox; height = lines × 1.14 × text size, width = sum of advances | confirmed |
| +0xa8 | origin `(y, x)`, placed by the justification (top-left in about a third of the sample) | confirmed |
| +0xb8 / +0xc0 | f64 baseline direction `(sin, cos)`; 138 of 320 sample texts are turned (7 at 90°, several at ±84–88° and 1–4°) | confirmed |
| +0xe8 | u8 vertical alignment: 1 top, 3 centre, 5 bottom (2 / 4 top / bottom baseline, by Vectorworks' menu order; not in the sample) | confirmed |
| +0xe9 | u8 horizontal justification: 1 left, 2 centre, 3 right | confirmed |
| +0xf6 | u16 character count n | confirmed |
| +0xea, +0x102, +0x104 | often repeat n (style-run lengths?); openvwx updates them when they equal the old n. +0x100 is the line count below, which equals n only by chance (a two-character text on two lines); updating it as a count moved the size's place, and new texts in blank drawings of other than two characters lost their size until 2026-10-31 | likely |
| +0x100 | u16 number of laid-out lines (wrapped paragraphs count every line) | confirmed |
| +0x108 | (lines − 1) × u16: the character index each line after the first starts at | confirmed |
| +0x108 + 2·(lines − 1) | two f64 point sizes, size ÷ (0.3528 mm × layer scale), mostly the same twice; both 0 in some texts. openvwx scales them with the size | confirmed (the ratio, in all four files) |
| +0x118 + 2·(lines − 1) | u16 font: its place in the font list (type 74), from 0 | confirmed (each text's advances fit Arial or Arial Narrow as this says, for all but a few bold ones in four files: 2 fonts in the demos, 3 in the sample) |
| +0x11a + 2·(lines − 1) | u16 style bits: 1 bold, 2 italic, 4 underline (worksheet cells' bits, §8) | confirmed for bold (wider advances); 3 is on the narrow texts the 2023 demo's PDF sets in Arial Narrow Bold Italic; 4 is on one text, with plain advances |
| +0x11e + 2·(lines − 1) | f64 text size in world units = point size × 0.3528 mm × layer scale (moves with the line table) | confirmed (every text in the 2023 and 2026 demos and a private sample) |
| +0x126 + 2·(lines − 1) | i32 text style: the name index of a text style (type 109), 0 for none, −2 likely its class's text style (the class record's +0xb8) | confirmed (502 texts in the 2026 demo name one, 3 hold −2) |
| +0x132 … | 10-byte entries (f64, u16): tab stops or style data; often stale heap bytes | |
| end − 10n | n × f64 per-character advance (world units), then n × UTF-16LE characters; newlines are `\r` | confirmed |

The bbox is the axis-aligned bounds of the turned text box: width along the
baseline, height lines × 1.14 × size, placed about the origin by the two
alignment bytes. 288 of the 320 sample texts reproduce their bbox exactly from
these fields (the rest carry stale bounds).

**Font list** (type 74, a root record): u16 count at +0x50, then 518-byte
entries from +0x52, each u16 0, u16 font id, the name in UTF-16LE
(NUL-terminated, zero-padded to +0x202), u16, u8 1, u8 (the record ends with
the last entry; the u16 and the last u8 vary). The ids differ from file to file
for the same font (69 "Arial", 412 "Helvetica", 80 "Arial Narrow" in the sample;
33 "Arial", 44 "Arial Narrow" in the 2023 demo), and no text holds one: a text
names its font by its place in the list (+0x118 above). openvwx adds a font the
list lacks as a new last entry, id one above the largest, u8 1, the rest 0.

### 4.2 Common attribute block (drawables)

| Offset | Meaning | |
|---|---|---|
| +0x50 | i32 line style: 0 none (no outline), 2 solid, −n = the line type whose name index is n (see below) | confirmed |
| +0x54 | u16 line weight in mils (10 = 0.254 mm; 0 on most text) | likely |
| +0x56 / +0x58 | u16 fill foreground / background colour | likely |
| +0x5a / +0x5c | u16 pen foreground / background colour (coloured dashed lines vary here) | likely |
| +0x5e / +0x5f | u8 fill / pen opacity, 0–100 | likely |
| +0x64 | i16 fill pattern: 0 none, 1 solid, 2 and up an 8×8 bitmap pattern from the application's own table (see below), −n the hatch/tile/gradient resource with name index n | confirmed |

**Material** (confirmed). Rectangles, arcs, polygons, polylines, extrudes,
3D polygons, solids and plug-ins (types 3, 5, 6, 21, 24, 25, 84, 113, 86)
hold a u32 at +0x88: the name index of the material resource (type 19) they
are made of, 0 for none. Lines, text and bodies use the slot otherwise. A
wall (68) has none itself; its component pieces do (2023: 2,960 polygons,
350 polylines, 131 rectangles, 203 extrudes, 1,161 solids, every non-zero
value a material; a material's own 2D fill, a fill resource's −n, is an i16 at +0x52 in 18 of the 2023 demo's materials). The components are a type-69 aux child of walls, wall,
slab and roof styles, roof faces and slabs: +0x50 u16 count, then 0x126-byte
blocks with the name (zero-ended UTF-16) at +0, the class name index at +0x90
(0 = the wall's), the material at +0x94, two f64 edge offsets at +0x98 /
+0xa0, and fills (i16, −n a hatch, tile or gradient) at +0xf4 and +0xf8: all
998 fill-resource values in the 2023 demo's 859 component blocks sit at those
two. Not every negative value there is a fill: 121 more at +0xf8 name no fill
resource (117 match a worksheet's name index, 4 nothing), so Rodeo leaves
those bytes as they are. A structural member's material is also its `MemberMaterial` parameter,
and its 2D fill piece carries it at +0x88.

**Bitmap fill patterns** (likely). A fill pattern of 2 or more picks an 8×8
bitmap: set bits in the fill foreground colour, clear ones in the background.
The bits are not in the file; Vectorworks keeps the table in the application
(the type 79 record's 36 patterns, identical in 2023 and 2026, are not it).
Pattern 35 is a diamond lattice, rows `88 05 02 05 88 50 20 50`, read off a
published 2026 sheet where wall components use it; it prints at about 1/216 in
per bit. Pattern 2 is not QuickDraw's all-set black: black-on-white shapes
with it print white, so it draws like 1. Older files hardly use either; the
2026 demo has about 14,000 objects on 2 and 230 on 35.

**Colours** (confirmed against the classic palette). Attribute colour values
index the **document colour table**, a root aux record tagged `TDMD` with
subtag `NDCD`:

```
+0x50  "TDMD", u16 5, "NDCD"
+0x5a  u16 section count (10)
+0x5c  u32 size of the section data
+0x60  count x { u16 id; u32 offset }   offsets are relative to +0x60
section: u16 element type (8 = 4 bytes, 1 = byte), u32 count, data
```

| Section | Contents |
|---|---|
| 1 | one u32: number of colours in use (1350) |
| 2, 3, 4, 5 | float32 C, M, Y, K (0..1), one per colour index (1376 slots) |
| 6 | u8 per colour (1 = document colour?) |
| 7 | u32 per colour: byte offset of its name in the pool (section 10) |
| 8 | u32 per colour: byte length of its name including the 2-byte terminator (2 = unnamed) |
| 9 | one u32: bytes of the pool in use (2956 of 3094) |
| 10 | UTF-16LE name pool ("Gray 30%", "Black", "White", …), indexed by colour (270 "Gray 30%" is #b3b3b3) |

RGB = 255 × (1 − C)(1 − K), etc. Index 256 is (0,0,0,0) white and 257 is
(0,0,0,1) black: the default fill and pen on almost every object. Entry 286
converts to #000011, exactly entry 1 of the classic RGB16 palette stored in
the type-80 record, which is how the CMYK reading was confirmed.

**Line types** (dash styles) are type-96 records beside the class records
(under the type-57 list), named through the name table: style −13 is the
record with name index 13, "ISO-02 Dashed". Each has two type-119 children
holding PNG previews.

| Offset | Meaning | |
|---|---|---|
| +0x58 | f64 −1 in every sample record | unknown |
| +0x60 | u8 0 or 1 (maybe "scale with line weight") | unknown |
| +0x61 | u8 n, number of dash/gap entries (2, or 4 for dash-dot) | likely |
| +0x62 | 11 × f64 slots: n alternating dash and gap lengths in paper inches; unused slots repeat the first entry (in 6 of the sample's 7; the seventh leaves them 0) | likely |
| +0xba | 168 bytes, 0 in four of the sample's 7; in the other three (those with +0x60 = 0) an f64 equal to the first dash at +0xba, and in one 2.5433 at +0xca | unknown |

openvwx edits a line type by writing n and the slots (unused ones repeating
the first entry) and keeps the bytes after them; 7 of 7 write back byte for
byte unchanged. Its two previews are drawn anew at their own sizes.

The sample defines 7: ISO-02 Dashed [0.15, 0.12], VW-01 Short Dashed
[1/12, 1/24], ISO-10 Dashed Dotted [0.185, 0.12, 0.15, 0.155], and four
more. On a design layer at 1:s a dash of d inches is d × 25.4 × s mm in
world units, the same paper-to-world rule as text size.

### Coordinate conventions (confirmed)

Inherited from MiniCAD/QuickDraw: **points are stored (y, x)**, bounding boxes
are **(top, left, bottom, right)** with y up, and arc angles are QuickDraw
angles (0° = 12 o'clock, clockwise). Units are document units (mm here).
Free space inside records often holds uninitialised heap bytes (e.g. ASCII
text from other allocations), so ignore anything outside known fields.

## 5. Layer record (type 31)

| Offset | Meaning | |
|---|---|---|
| +0xd8 | i16 visibility: 0 visible, −1 hidden, 2 grayed | likely |
| +0xf4 | u16 name index of the design layer's story (a type-76 record of that name), 0 for none | confirmed (2023: every layer of a floor names it, e.g. 1-* First Floor; 2026 the same, 56 layers 0) |
| +0xf8 | f64 scale denominator (48, 100, 50, 200; sheet layers 1) | confirmed |
| +0x14c | 3 × f64, varies per layer (extent?) | |
| +0x168 | 3 × 3 f64 matrix M, row by row, of the layer's saved view: its columns are the screen's right, up and toward-the-viewer directions in the model, so model = M · (screen − t); the identity in Top/Plan | likely (orthonormal in every layer of all four demo years and a private sample; the identity on every sheet layer and every layer saved in Top/Plan) |
| +0x1b0 | f64 × 3 t, mm: −M·t is a perspective view's eye, or the point an orthogonal view is centred on; 0 in Top/Plan | likely (the 2023 perspective's eye sits at eye height at the edge of the house and opening it shows the interior; an isometric's eye lies far out along its view direction; orthogonal centres fall inside the model) |
| +0x1c8 | u8 projection of the saved view: 6 Top/Plan (every sheet layer), 0 orthogonal, 1 perspective | likely |
| +0x1ca | u8 render mode of the saved view: 0 wireframe (always in Top/Plan), 11 OpenGL (every 3D view in the demos); 6 hidden line and 7 dashed hidden line as Vectorworks' scripting numbers them, not seen in the files | likely |
| +0x1fc | f64 elevation of a design layer (mm); +0x20e in 2025 and 2026 files. Objects are saved at their heights in the model, the elevation already in them, so 3D adds nothing for it: in the 2023 demo each story's walls, slabs, symbols and lights start at their layer's elevation (the basement layer's at −1,524 run −1,524 to 0, a ceiling layer's lights hang just under its 2,743), and two private 2025 samples do the same (floors as far apart as their layers, hedges at the terrain's height on a layer at it). Rodeo writes what it places the same way: a new object at its height above its layer plus the elevation (a light, a camera's matrix and eye, an extrude, sweep or multiple extrude, an imported mesh, a symbol instance's z; Create Contours' level planes), and a copy of one on another layer (a wall, slab, plug-in or Heliodon it copies, a paste, Move to Layer) as high above this layer as it was above its own; Create Symbol puts the objects in the definition at their heights above the layer and the instance at its elevation | confirmed |
| +0x23c | u8 layer kind: 1 design, 2 sheet, 3 viewport annotations, and the top-level copies of a referenced file's layers (§7, **Design-layer viewports**) | confirmed |
| +0x246 | f64 × 2 a sheet layer's page (Page Setup), width then height in inches, moving with the kind byte; the page is centred on the sheet's origin | likely (every sheet layer holds one: 36 × 24 in all 141 demo sheets, A1 in a private sample's; on 110 of the 141 demo sheets and both of the private sample's sheets with content, the drawing lies inside that page centred on the origin, the rest reaching off it with stray objects) |
| +0x292 | `u32 len + UTF-16` name (design) or sheet number (sheet) | confirmed |

The kind byte and the strings move by 18 bytes in Vectorworks 2025 files and
16 in 2026; openvwx finds the shift per record (the first even shift where the
kind is 1–3 and both strings fit).
| … | `u32 len + UTF-16` sheet title (empty for design layers) | confirmed |
| end | u32 trailer | |

Renaming changes the record length; only the record's own size field needs
updating. Besides the record itself, only a story's levels (§5.1) store a
design layer's name; openvwx renames them with the layer.

### 5.1 Stories (type 76 `YRTS`)

Confirmed in the four demo files that have stories (2023 to 2026, five each;
the others have none) and only read and written back here, not yet checked in
Vectorworks.

Each story is a type-76 record tagged `YRTS` at +0x50; its name is the header
name index, which design layers name at +0xf4 (§5). The stories are the
children of one type-76 record tagged `LRTS` (84 bytes: the header and the
tag), under the class list's root; every demo file has one, empty in files
without stories, and an empty one has 0 at +0x10. As in any list, the children
are those whose new owner value follows the list record (§2), the last with a
0 next mark. From +0x54 a story holds a tree laid out as the data
visualisations' (§7.4): a node is u16 kind, u32 length from its start, fields
until a u32 0, then child nodes to its end; a field is u32 length and the
bytes; strings are FF FE, UTF-16LE and 00 00.

| Node | Fields | |
|---|---|---|
| root, kind 0 | none; one child | confirmed |
| story, kind 0x1100 | [0] suffix (string), [1] f64 elevation, mm; one child, the levels | confirmed |
| levels, kind 2 | [0] u32 count; one child per level, of kind 0, 1, 2… in order | confirmed |
| level | [0] level type (`Finish Floor`, `Top of Slab`…), [1] f64 elevation above the story, [2] the name of the design layer at the level (empty string for none), [3] u32 the level's id, [4] [5] u32 (not decoded: 1 and 209 on the 2023 slab and footing levels, 1 and 0 on 2026's, 0 and 0 on the others) | confirmed; [3] likely (unique among a story's levels in all ten 2023 and 2026 stories, not across them, and not in order: one story's run 0–7 skips 2; a new level takes the story's highest plus one, and 0 and 0) |

A design layer on a story is stored at its own elevation (+0x1fc): the story's
plus the level's, for each layer a level names (the story's other layers sit
at elevations of their own). Bytes after the
tree (95 or 105 in three of the five) are stale copies of level nodes, kept as
they are. The tree writes back byte for byte in all twenty demo stories.
Deleting or renaming a demo story is refused: 34 other records name each
story as text (data visualisations test a story by name, §7.4).

## 6. Class record (type 94)

| Offset | Meaning | |
|---|---|---|
| header +0x1a | name index | confirmed |
| +0x52 / +0x54 | u16 fill foreground / background colour | likely |
| +0x56 / +0x58 | u16 pen foreground / background colour | confirmed (grid lines take the Grid class's teal) |
| +0x5a | i32 line style (as §4.2: 0 none, 2 solid, −n a line type) | confirmed |
| +0x5e | u8 line weight, mils | confirmed |
| +0x60 | fill pattern | likely |
| +0x65 / +0x66 | u8 fill / pen opacity | likely |
| +0xb6 | i16 visibility: 0 visible, −1 hidden, 2 grayed | likely |
| +0x9e | i32 RenderWorks texture name index (0 none), used by objects set to "by class" | confirmed (2023 and 2026) |
| +0xb8 | i32 text style name index (type 109; 0 none), which texts set to the class's text style follow | likely (7 of 139 classes in the 2023 demo and 7 of 159 in 2026 name one, nothing else there; in 2026 the 3 texts holding −2 are in such a class, and 114 texts name their class's style directly) |
| +0x68 / +0x72 | the class's start and end line markers, 10 bytes each, laid out as in type 125 | likely (every class in the 2023 demo has them hidden; openvwx ignores them) |

openvwx edits a class's attributes, texture and text style (Organization >
Edit…) by writing the fields above in place, at the offsets it reads them
from (the texture as the i32 at +0x9e, a type 97 name index or 0; the text
style as the i32 at +0xb8, a type 109 name index or 0); the class record's
length does not change and objects keep their by-class flags, so every object
taking a group from the class draws with the new value. Not yet checked by
reopening in Vectorworks.

**By class.** An object's header +0x24 u16 says which attributes it takes
from its class ("Class Style"). For each set bit the object's own value is a
stale placeholder (weight 0, style 0, black on white, opacity 0 or 100) and
the class's applies:

| Bit | Attributes | Evidence |
|---|---|---|
| 3 (0x8) | line weight | weight 0 on 100% of objects with it set |
| 4 (0x10) | pen colours (fore and back) | pen fore at the default on 100% of shapes whose class differs |
| 5 (0x20) | line style | style 0 on every text and 88% of shapes with it set |
| 6 (0x40) | fill: pattern and both colours | 2023 counter tops (class solid white) occlude the floor stipple; 2026 tags (pattern 0 of their own, bit 2 clear) are filled |
| 9 (0x200) | fill and pen opacity | 2024–2026 objects with it clear keep their own odd opacities (47, 49, 86) |

Bits 2, 7, 8 and 10 are not drawn here (likely markers, drop shadow, text
style); 0xffff sets every bit. Setting an attribute clears its bit, keeping
the rest of its group as drawn. Grid lines (bits 3–5) come out teal and
dashed, grid bubbles and tags (0xffff) take their class's teal fill, as
published.

**No outline.** A shape draws no outline when its line style is 0 or its
weight is 0: the published PDFs leave out the borders of the grid bubbles and
tags, whose class pen is solid at weight 0.

**Containers.** A plug-in, symbol or viewport whose class is hidden hides
everything inside it, whatever their own classes (a Space plug-in in a hidden
class hides its occupancy fill, a light-fixture symbol vanishes); a grayed one
grays it. Groups (11) and walls (68) do not: their contents keep to their own
classes. The 2023 demo's A1.2 viewport hides the structural-wall class, yet
the exterior walls print, their component lines and fills (component
classes) and the doors in them included; it hides the class of the groups
inside the folding doors, and the panels inside still print. Inside a
plug-in, symbol or viewport, an object in the None class goes by its
container alone, and so does a None-class container inside another: A1.3's
viewport hides None, yet the toilets, basins and tubs (None geometry in
symbols of visible fixture classes) print, and so do the None-class texts in
its wall tags.

A viewport's class list governs what it shows of its design layers: A1.2
hides the space-label tag class of the design layer, whose labels print only
from the viewport's annotations, and A5.2's detail viewports show the notes
class their callouts are in. (Read one entry off, as openvwx once did, the
list hid the notes and showed the design layer's labels as well.)

## 7. Viewports, 3D and rendering data

**Viewport (122).** A section, elevation or 3D viewport caches its drawing as
type-11 groups of ordinary objects in the coordinates of its view: the section
plane's, with the view's rotation already applied. A plan viewport (identity
view matrix) caches none; its drawing is the design layers it lists, drawn
live through the rotation at +0x8c, the shift and the scale, and cropped to
the box. Each group says what it holds in one of its aux records (76), by a
reversed four-letter tag at +0x50:

| Tag | Group | Coordinates |
|---|---|---|
| `onna` (with `mnna`) | annotations | sheet × scale, no shift |
| `porc` | crop object (a rectangle, rounded rectangle, polygon, or nothing) | sheet × scale, no shift |
| `vlei` | interior elevation marker | sheet × scale, no shift |
| `hccb`, `hcsc`, `ncsp` | cached drawing (lines and hatches of a section or elevation) | view, through the shift |
| `hcac` | cached render: an image record (14, a PNG with alpha in the demos) the size of the crop, at the render's resolution (150 dpi in the 2023 demo), or empty when not rendered. Stored after the cached lines; the published sheets paint it first, under them | view, through the shift |
| `ntcs` | section line | not settled |
| `lted` | the detail callout a detail viewport was made from (a Detail Callout plug-in; not printed) | — |

The crop object only bounds what the viewport shows and is never printed:
73 of the 108 crop objects in the 2023 demo are filled solid white, yet the
published section sheets show the drawing they would cover, with no outline.
openvwx crops the drawing to the crop object's outline (42 polygons, 13
rounded rectangles and one polyline in 2023, all in section and detail
viewports; plan viewports there use rectangles) and the annotations to the
box only.

Annotations are at sheet position × scale with no shift: in 2023 their texts
match the published A1.2 on 144 of 147 only so, and every annotation group in
all four demo years fits its box only so, while every cached drawing group
fits only through the shift. Crop rectangles equal the box × scale when the
box is just the crop; the box is otherwise wider (it takes in the annotations
too).

| Offset | Meaning | |
|---|---|---|
| +0x68 | f64 × 4 crop box on the sheet: top, left, bottom, right (mm) | confirmed |
| +0x8c | 3 × 3 f64 plan rotation, design → view, row vectors as symbol matrices (translation in the last row) | likely (only two turned viewports in the demos, both 30°) |
| +0xd4 | f64 × 2 shift: view point p lands on the sheet at (p + shift) / scale | confirmed (all four demo years: plan, section, elevation and detail viewports) |
| +0x238 | 3 × 3 f64 view matrix, contiguous; identity for plan views. At +0x23e in 2026 files | confirmed (1,179 viewports, all four years) |
| +0x2cc | f64 scale (48 for 1:48); at +0x2de in 2025 files and +0x2e4 in 2026 | confirmed |
| +0x338 | layer and class list (below); at +0x33c in 2024, +0x34e in 2025, +0x354 in 2026 files | confirmed |

The list: a header `u16 0, u16 layers, u16 classes`, then one 8-byte entry
per layer and per class: `u16 name index, i16 0, i16 visibility (0 visible,
−1 hidden, 2 grayed), u16 flags`. The layers are the design layers the
viewport shows (a first-floor plan lists the first-floor layers and the grid;
the second floor adds a first-floor layer grayed, which the published plan
shows in gray; the site plan lists the site layer first); the classes are its
class overrides. The list
ends at the end of the record, which is how it is found. Every class list's
first entry is None, and the last ends the record exactly, which settles
where entries start: read from two bytes later, each name takes the
visibility of the entry before it (and the site plan loses its site layer,
the foundation plan its footings).

Moving a viewport moves its box and its shift (shift += move × scale), and
its annotations and crop by move × scale; its drawing stays in view
coordinates. openvwx changes the scale about the box's centre c: the box
shrinks by old / new, shift += c × (new − old), annotations move by
c × (new − old), and the type-31 annotation layer child's scale follows when
it matched. Unlisted design layers are hidden in the viewport; openvwx adds a
layer or class override as a new 8-byte entry (flags 1) and bumps the count.

A new plan viewport (`createViewport`) copies a plan viewport of the drawing's,
less the objects in its annotation and crop groups, and writes the box, an
identity rotation, the shift (box centre × scale − the design point there), the
scale and the list. A drawing with none gets built-in records: the 122 at the
+0x2cc/+0x338 layout, then an annotation group (`onna`, `mnna`), a crop group
(`porc`) and a terminator. Rodeo reads these back; Vectorworks hasn't opened one.

Worksheet images (56) and record data (47/48): §7.2, §7.3.

Detail viewports on a wall-section sheet share one section's cache and differ
only in shift and crop.

**Design-layer viewports.** A viewport on a design layer is not a 122 but a
plug-in object (86) whose parameters (48) are of the format
`NNA_DesignLayerViewport`: fLockPosition, fHasCrop, fProject2D, fSource (the
file it shows, or "Current Document"), fDescription, fPlanarObjs,
fCropVisible and fDetailLevel, with fPhase and four fLowDetail… fields from
2026. It is the only plug-in with type-29 children, which is how openvwx
knows one. Its matrix at +0xf0 (§4, 86) places what it shows on its own
layer as it places a plug-in's parts, z included, and its +0x68 box is the
union of its entries' boxes, unplaced (7 of the 8 in the samples; the 2023
demo's is a few metres stale). Its children: TDMD dictionaries (`0SHC`,
`ASOB`, `ldom`, `ccDT`, `SCDT`, `pvld`), one or two empty groups (11), one
tagged `porc` for its crop (empty in all 8: none sets fHasCrop), then

* an aux record tagged `TVLD`: +0x56 u16 1 when it shows another file, 0 for
  the current document; +0x58 u16 that file's reference number n (below; 0
  for the current document); +0x5a u16 layer count, +0x5c u16 class count;
  +0x5e `pvld`; from +0x72 one 8-byte entry per layer, then per class, as a
  sheet viewport's list has them: u32 name index, i16 visibility (0 visible,
  −1 hidden, 2 grayed), then byte 1 and a byte that is 0 on classes and
  varies on layers. The record ends after the entries (all 8). The classes
  are its class overrides; a class it does not list keeps the drawing's
  visibility;
* its parameters (48) and a TDMD `ttwr`;
* one type-29 record per layer it shows: every layer the list does not hide,
  and no other (a private 2025 sample: 55 entries for the 69 layers its four
  viewports list, 14 hidden; the demos: 1 or 2 of 13); then the terminator.

Type 29, 246 bytes: +0x50 attribute block; +0x68 box of the layer's content
(top, left, bottom, right) in the coordinates of the file shown, ±DBL_MAX
when empty, and not always right (7 of a private sample's 55 are empty, one
of them for a layer of 149 objects); +0x8c 4×3 f64 matrix, the identity in
all 60 entries of the samples; +0xec u32 the layer's name index; +0xf0 flags,
0x80 fProject2D and 0x40 fPlanarObjs (0xc0 in 6 of the 8; the one with
fProject2D off has 0x40, the 2023 demo's, with fPlanarObjs off, 0x80). Its
children are TDMD dictionaries (`ldom`, `ASOB`).

A file shown from another is copied into the drawing: its layers become
top-level layers named `NNA#n_` and the layer's name, of kind 3 and hidden,
holding its objects at the other file's coordinates (44 in a private sample,
13 in each demo; the 2024 demo's hold only the one shown), and its classes
`NNA#n_` classes, which the list's class entries name. The prefix's n is the
reference number in `TVLD` (all 8). A current-document viewport names the
drawing's own layers.

The placement is right in 3D: the 2024–2026 demos' viewport lowers the
highway file's site model by 111,467.8 mm, which lands it on the copy of that
site model the drawing's own Site layer holds (the same 3D box to the
millimetre in 2026). In a private sample a building shown from another file is
turned and raised, which sets its ground floor on the referenced terrain
among the site's hedges and furniture; a current-document viewport there
raises the drawing's own building layers by the same height to the same
floor.

openvwx draws a design layer's viewports under the layer's own objects: the
layers each shows, through its matrix, grayed when the list or the
viewport's class grays them, hidden with its class. A sheet viewport that
shows such a layer shows the viewport's layers in it too, with its class
overrides (the site plan, A0.1, of the 2023 and 2026 demos, where the
drawing's own Site layer is hidden in 2026; five of a private sample's sheets), and
3D builds them in place. It ignores the entries' matrices, crops, fProject2D
and fPlanarObjs, and the detail and phase fields.

**3D.** Bodies (114) hold points and edges; openvwx rebuilds planar faces by
grouping edges into planes, tracing half-edge loops, resolving holes by
nesting, and triangulating, and builds ruled faces between twin curves. A
body whose edges are only three or more meridians from one pole to another
and closed rings round them is swept round the axis through the poles instead,
each meridian's height and distance from the axis blending into the next's (a
private 2025 sample's 80 existing trees: canopies of four meridians and two
rings, as edges with no faces; likely).
Points within 0.005 of each other on every axis are one vertex, and planes
within 0.00005 of each other in each component of their normal and within
their tolerance in offset are one plane, wherever the body lies, so a body moved with
its object rebuilds the same faces (2023 demo: 368 of 374 solid additions
the same after a move, 5 more within 1% of their area; a turn or mirror
leaves about 95% the same, nearly all of the rest within 1%).
Extrudes, sweeps, multiple extrudes and solid additions (24, 34, 38, 84) carry
an owner matrix: three rows at +0xcc (the images of the x, y and z axes) and
the offset at +0x114. What they hold (an extrude's profile, a solid's operands)
and their 3D box at +0x9c (`x1 y1 z1 x0 y0 z0`) are in that frame. Their
bodies' points are not always: an extrude's or sweep's are, but a multiple
extrude's or solid addition's are already in its parent's coordinates (2023
demo: all 81 bodied multiple extrudes and 752 solid additions whose frame
isn't the identity fit their plan box that way and none through their frame;
2026: 4 and 1,086), so openvwx draws those as they are and moves their points
with them. Their
plan box at +0x68 is that box's eight corners as the matrix places them (2023
demo: 4,664 of 4,779 extrudes, all 7 sweeps, all 92 multiple extrudes, 2,179
of 2,726 solid additions). Every such matrix there is a turn, or a turn and a
mirror (177 of 7,604); none scales. openvwx moves them by their offset and
plan box, turns and mirrors them through their matrix with the plan box
fitted to the turned 3D box, and leaves what they hold as it is. It scales
extrudes and multiple extrudes only: seen in the extrude's frame (the frame's transpose, the plan
scale with z kept, the frame), a scale must keep the profile's plane and the
axis apart, as it does for any scale of an upright extrude and for an even one
of an extrude lying on its side. The profile then takes the plane's part, the
3D box's heights the axis's part, the frame keeps its turn and its offset
moves, and the body (114) goes, the one aux record bodiless extrudes lack
(2023 demo: bodied ones keep 91, the TDMD dictionaries and the rest beside
it, as bodiless ones do). A multiple extrude's profiles all take the plane's
part and its 3D box their joint bounds; its body goes too, and it is lofted
from then on: scaled 1.5 × 0.7 in plan, each of the 12 bodied ones in the
2023, 2024 and 2026 demos that can be picked (the rest are in plug-ins) lofts
to its old body put through the scale, bounds and surface area alike. The
type-42 records, a multiple extrude's own and its profiles', keep their old
corners. It raises them by their offset's z (3D polygons and meshes by
their points' z and 3D box, groups by their 3D box, symbol instances and
plug-ins by their matrix's z offset at +0x96 + 88 and +0xf0 + 88), as
Convert to Group does to what a raised symbol or plug-in holds. Top/Plan draws an extrude's profile through the plan part of its
frame (the first two rows and the offset), at the plane its body starts from
(+0xc4, its 3D box's low z). An upright extrude's profile then lands on its
stored plan box wherever it did without the frame, and on 133 more in the
2023 demo (506 more in 2026); 3,186 of the 3,304 tilted ones fall inside
theirs, against 191 without the frame. A few stored plan boxes are stale: 30 extrudes on the 2023
demo's layers keep one metres from their body, so picking and moving go by
the 3D box through the frame instead. Symbol instances use their 4 × 3
matrix at +0x96, and plug-in objects (86) the 4 × 3 matrix at +0xf0 (§4),
for their 3D as for their 2D drawing: their own bodies, the solids, extrudes
and groups they hold, and a site model's terrain are all in the plug-in's
coordinates. Placed so, 2,192 of the 2023 demo's 3,195 bodied 3D parts of
plug-ins on its layers fall inside the plug-in's own 2D drawing as plan places
it (padded by a tenth of its size), against 479 as stored (2026: 4,671 of
5,791, against 764); in walls 799 of 964 (1,483 of 1,690), against 23 (26). A
plug-in's own body (only in walls, on these layers) meets its drawing in 6 of
6, 9 of 9 and 6 of 6 cases in 2023, 2024 and 2026, and in none as stored. The matrix's z
puts all 60 doors and windows in the 2023 demo's walls within their wall's
height (54 of 60 in 2026), against 24 (21) without it.

Extrudes are often saved without a body: 3,381 of 4,779 in the 2023 demo,
4,979 of 9,692 in 2026. Most are operands of a solid that has one; the rest are
mostly plug-in objects' parts. openvwx sweeps the profile (the extrude's first
drawable child, in its own frame) from its 3D box's low z to its high z. A
polyline's holes are the polylines and polygons inside it (an outline with
holes keeps its own closed flag at 0); an open polygon or polyline extrudes
closed, as it fills. On extrudes that do have a body, the sweep has the body's
bounding box for 1,371 of 1,373 with a profile (4,662 of 4,709 in 2026) and its
surface area within a fifth for 1,366 (4,705); most of the rest have curved
profiles, which the body tessellates differently. A multiple extrude (38) holds
306-byte type-42 records with no bounds (one in each bodiless one, 6 to 147 in
bodied ones), its body if it has one, its aux records, and then its profiles:
two rectangles or polygons in every demo, in its own frame, the first at its 3D
box's low z and the last at its high z, their points paired in order. 11 in the
2023 demo have no body, all inside groups; openvwx lofts those through their
profiles (more than two evenly between; unequal point counts split the longer
edges, opposite windings turn round, and each ring starts where it twists
least against the one below). Lofted so, every bodied multiple extrude in the
2023, 2024 and 2026 demos (81, 4 and 4) has its body's bounding box and surface
area, and every bodiless one lands on its plan box. A solid (84) says how it
combines its operands at +0x17d: 1 adds them, 3 takes the later ones from the
first, and 26 has none (generic solids, Parasolid only). The body of every
two-operand one with 1 whose operands' bounds tell spans both (23 in the 2023
demo, 174 in 2026); with 3 it lies inside the first (716 of 1,050 in 2023;
the operands of most of the rest are solids whose own bounds don't place
them). 8 and 9 (two operands, the body inside the second's bounds), 16, 17
and 19 (one operand) aren't identified. Its operands are in its own frame.
openvwx draws a solid without a body (only those it makes) from its
operands: an addition as they are, a subtraction by cutting the first with
the rest (BSP trees, after csg.js, over at most 4,000 triangles; past that
the first uncut), each operand's triangles first turned to face outward.
Drawn so without their bodies, all 378 bodied two-extrude subtractions in
the 2023 demo (623 in 2026) have their body's bounding box, 276 (547) its
surface area within 2% and nearly all the rest within a fifth (curved
profiles, tessellated more finely in the body); 57 of 58 additions (89 of
90) have its bounding box.

A sweep (34) has an extrude's header and 32 bytes more (356 in every
demo): f64s at +0x140 and +0x150 (0 in all 69 sweeps of the 2023, 2024 and
2026 demos: its start angle and pitch, in some order), the segment angle at
+0x148 (5.625, 10 or 20) and the arc at +0x158 (360, or 180), and a u32 at
+0x160 that is all ones in the 2023 demo's two without a body (9 of the 69
have none) and a small number or 0 in those with one. Its profile, its first
drawable child after the aux records (among which a bodied sweep keeps its
body), is in its own frame, and turns about a line parallel to its y axis:
through the 2D locus (17) the sweep holds beside it, at the locus's x (six of
the 69 hold one, some with the profile wholly to one side), or without one
through the profile's left edge (its plan box's x0). Every sweep's 3D box is
centred on that line across the turn. A point dx right of the line goes to
(x0 + dx sin θ, y, −dx cos θ) for θ from 0 to the arc: the 180° sweeps' bodies
fill the half on the profile's side, centred on the profile's own plane,
which settles the turn for 180° and 360° but not which way a smaller arc
starts. openvwx draws every sweep whose start and pitch are 0 that way, in
segments of its segment angle, with or without a body (its body's curved
faces don't rebuild: drawn so, three of the five bodied 2023 sweeps showed
1 to 8% of the lathe's area, and the one whose body rebuilds whole has the
lathe's surface area within 0.1%). 68 of the 69 then fill their 3D box
within 1%, and the other reaches 95% of its box's radius, centred on it.
Scaled evenly in plan (Scale Objects), a sweep whose axis stands upright
keeps its segments: its frame's offset takes the scale, the profile's points
take it across the axis and keep their height along it (as an extrude keeps
its height), its 3D box with them, and it drops its body, with 0xffffffff at
+0x160 as a bodiless one. A scale that isn't the same all round the axis
(any plan scale of a sweep lying down, or an uneven one) is refused for now. Model > Sweep makes them
bodiless like the demos' (an extrude's aux records, the profile, 0xffffffff
at +0x160), the profile stood up (frame rows x, z and −y, offset
(0, the profile's middle y, −its low y)) so it stands on the layer and turns
about the upright through its left edge.

Meshes (40)
are drawn face by face with each face's own colour and texture. A design
layer's elevation is not added to what it holds: objects are saved at their
heights in the model (§5).

**A plain wall** (what Rodeo writes, unconfirmed in Vectorworks; a drawing with
none to copy starts from it). A 256-byte wall record holding only the fields
named in §4 under 68 (the demos' are over 2,000 bytes, most of it not understood), with a
filled polygon for its plan drawing and a group holding one body: 12 straight
edges, each with its own two points in section 0, entered in section 14, and no
Parasolid section, so its faces come from its edges. It has no aux records,
components or solid additions, and all its children carry next≠0.

**Walls in 3D** (confirmed, 2023 and 2026). A wall (68) holds its 3D twice:
a group child (11) of bodies, per component one solid plus zero-thickness
quads on the component's faces and centre line, and one solid addition (84)
per component holding that component's fill, class, material and texture.
The component solids are the same triangles in both (2023: 246 walls, 11,885
triangles in the components, 12,669 in the groups), so drawing both makes
every wall face fight for the same pixels in two colours; openvwx draws the
components and keeps the group only for walls without them. Moving a wall
shifts its box, its control line, its plan drawing, the points of the bodies
its group caches (not their Parasolid section, as for solid additions' bodies)
and its doors and windows; lifting one shifts its six heights and the same 3D.
Turning or mirroring one puts the same through the transform, the group's
boxes by their corners (it holds only bodies, which have no plan box to fit
it to); mirrored, its line's ends swap, so the components keep the side its
drawing and 3D show them on. A plug-in object turns by its matrix, each axis
row's plan part and the origin through the turn, its parameters left as they
are (a camera's eye and look-to point excepted). Mirroring one puts the
mirror into its matrix the same way, as Vectorworks saves mirrored ones: in
the 2023 demo 20 doors, 12 windows, a data tag and a batt insulation have a
matrix whose plan part mirrors (its z axis kept), and in the 2026 demo 14
framing members, 11 tapered extrudes, 4 data tags and a batt insulation. A
door or window set in a wall has its x axis along or against the wall's
line from start to end, mirrored or not, and the 2023 demo's doors take all
four ways (9, 8, 6 and 4); a mirrored wall swaps its ends, so each goes from
one of them to another. Cameras and Heliodons, which look or shine one way,
don't mirror. A slab mirrors its three points, outline, components and body:
the demos' slabs turn their points either way (3 and 5 on layers) and wind
their outlines either way, so neither is a rule a mirror breaks.
Editing a wall's ends moves each point of its plan drawing and its bodies
(the group's and the solid additions', which are aux records) with the end
it lies at, keeping how far it lies from that end along and across the
line; the line's ends are written at +0x9e. An end holds the points within
four times the wall's reach across the line of it (a tee's cut reaches
1/tan 15° times it), stopping short of the doors and windows set in it.
They are plug-in objects and symbols directly below the wall (63 on the
2023 demo, in 37 of its 205 walls; 61 in 36 of the 2026 demo's 201), their
matrices in the drawing's frame, turned with the line. They, their openings
in its drawing and bodies, and the points between its ends where walls meet
it or it breaks (19 and 62 walls without doors) keep their place from the
end that stays put, the start when both move: one plan transform, the
line's turn and that end's shift, moves them all. Where a door lies along
the wall is the box round its plan drawing (lines, rectangles, polygons,
arcs, loci and polylines, through its groups) through its matrix; its
stored box is its own frame's, its groups' and extrudes' reach metres past
it, and an extrude's profile is in the extrude's frame. One wholly within
an end's reach (an end cap) goes with that end. An end that moves can't
have one reaching over it, nor pass through one: 201 of the 2023 demo's
walls take a longer start and end (4 doors reach over an end) and 195 of
the 2026 demo's (11 ends refuse), whose walls also keep groups of lines,
some as aux records, moved with them.
Its heights map every z through the stretch from the old bottom and top to
the new (Object Info shows and takes them above the layer, and writes them
with its elevation in, §5): the six heights (its top and bottom, then likely each end's), the
group's and solid additions' 3D boxes and the bodies' points. With doors or
windows in it, every z below its top keeps its height above the bottom, so
the openings keep their sills and heads, those at its top go with it, and
the doors and windows rise with the bottom; its six heights must then be
its top and bottom alone (2 and 4 such walls on the demos slope over their
doors), and its top can't come down through an opening. Boxes are refitted
only where they were what they hold: a 2023 wall's own box is never its
drawing's (off by 0.1 to over 10 m), and its group's and solid additions'
seldom their bodies', so they stay as they are. Likely; untested in
Vectorworks.
A wall follows one it is mitred to: exactly two walls' ends within 1 mm of
each other on one layer or in one group, each end cut straight across (its
points there within 1 mm of a line lying along the wall from its end by k
times how far across it, and m) along the line through where their left
faces cross and where their right faces cross, a face being the least or
most any of a wall's points lies across its line (the bisector of the turn
when the lines lie alike in both), or both square in a straight run. 72 of
the 2023 demo's corners are, and 92 of the 2026 demo's; three or more
walls meet at 14 and 5 points, and the rest are tees, butts or cut
otherwise (Vectorworks' join records aren't read). A wall lying on another
with the same ends, top and bottom (a copy made in place) can't be told from
it, so it takes no wall along; the demos' 29 walls sharing a line with
another are stacked at other heights, none alike. When a wall's end moves
(in Object Info, or the wall dragged, nudged, moved, turned or mirrored),
the end of the wall mitred to it there goes to the same point, as setting its ends would take
it, and every corner of a wall that moved, turned or followed is mitred
again: each end's points slide along their wall from the old cut to the
new. A straight run, a turn past 150° or a cut reaching past a wall's
middle leaves it square, as the Wall tool does. An end brought within a
door's trim of the door (a wall point more than 1 mm outside the door's
drawing, at 4 sides of the demos' 121 doors and windows) is no longer read
as cut straight, so that corner doesn't follow again. A wall's solid
additions take a move in their frame's offset (they hold nothing in it),
their bodies in the drawing's coordinates, so a moved wall still reshapes.
Likely; untested in Vectorworks.
A wall tees into another's side when, on one layer or in one group, its
line ends between the other's ends and its points at that end all lie
beside the other's side, between its faces (within 1 mm), its other end
beyond the face nearer it, the two crossing at 15° or more. Vectorworks
runs the line to the met wall's middle and each component (its lines,
polygons and bodies) to its own depth, short of the middle; the Wall
tool's tee runs it to the face, cut along it. The 2023 demo has 53 such
ends and the 2026 demo 62. The met wall's own plan drawing is saved cleaned
up there: at 47 of the 2023 demo's 53, its face lines stop at the teeing
wall's sides and its component polygons turn back into it between them
(where the other's components run in), so no line crosses the joint (2
keep a line across, 3 have both, 1 none on that face). Rodeo's tees and X
joins leave the met wall's drawing as it is. Split walls (Rodeo's Split)
are two walls whose ends meet at one point, square, on one line; how
Vectorworks keeps a wall it splits isn't known. When the met wall moves, turns, mirrors or
follows a corner, each point at the teeing wall's end slides along its
line until it lies as deep behind the met wall's face toward it as it lay
behind the face it met (the same face unless a mirror or a turn has
brought the other round), so every component stays as deep in it, the
line's end and an end cap going with them; a turn leaving them under 15°,
or bringing the met wall down on the teeing wall's far end, refuses. A
mirror swaps a wall's ends (so its components stay on the side its
drawing shows them), so the wall mitred at what was its start meets its
end. Likely; untested in Vectorworks.
Walls meet a wall's end in two more ways, at heights it stands at too: their
line's end at the same point (within 1 mm) without the mitre Rodeo cuts, three
or more there or two cut as Vectorworks cuts its own corners (the 2023 demo
has 101 such ends: 62 of two, 39 of three or more), or butted, their end
alone within its end zone between its faces and not a tee (33). When the
wall moves, turns or mirrors, an end at its point goes to where its end
went and a butted one as the end did (along and across it, across the other
way under a mirror), each keeping its cut, so the joint stays closed; how
Vectorworks then cleans the joint up isn't known. Walls stacked on it at
other heights (their height ranges not overlapping) stay.
A new wall is a copy of a straight wall on a design layer whose plan drawing
(lines, polygons, polylines and loci only) and 3D all lie on the cross lines
through its two ends, with no doors, windows or symbols in it: square ends,
without the joins that mitre most walls (the demos have 19, 14 and 10 such
kinds by style, thickness and height in 2023, 2024 and 2026). Rodeo stretches the copy from
its line onto the new one, along the line only, so the thickness and
components keep their width: the line, the drawing, the group's bodies and
boxes, and its solid additions, whose frames are bare in these walls (the
identity at the origin, nothing in them: their bodies are in the wall's
coordinates), so their 3D boxes take the stretch by their corners. A lift
(Move 3D, a layer's elevation, a copy onto a raised layer) keeps those
frames bare too and raises their 3D boxes, their bodies going up with the
wall's: Vectorworks keeps them bare at any elevation (15 of the 2023 demo's
19 wall kinds Rodeo can copy are on raised layers). The
copy's name is cleared and its class set; its aux records and the bodies'
Parasolid sections stay the template's. Untested in Vectorworks.
A door or window placed with the Door and Window tools is copied with the
wall it is set in, since Rodeo can't cut an opening. Of the 254 doors,
windows and other objects set in the demos' walls, 158 have no point of
their wall's drawing or bodies between 1 and 60 mm past their plan drawing
along the wall (the jambs lie on it), and the rest have points up to 59 mm
past it (a trim, or another wall's tee nearby); 101 are set alone in their
wall. A copy comes from one set alone in a straight wall on a design
layer whose six heights are its top and bottom alone, both ends cut straight
across, with every point between its ends within 60 mm of the insert's
drawing and no end point among them. That wall is copied whole (the door
with it, unnamed) into the place of a straight wall of the same style,
thickness and faces with nothing set in it and no points between its ends:
turned and shifted onto its line so the door's middle lies where clicked,
then its start and its end moved onto the wall's one at a time (what lies
between keeping its place from the end that stays), each end cut as the
wall's was, and its heights mapped as a wall holding doors takes new ones.
It keeps the wall's name, class and attached records (most demo walls hold
an IFC record of two fields, their values differing wall to wall), the
copied wall's aux records otherwise, and the old wall goes. As the faces and
cuts are the wall's own, the walls mitred or teed to it stay as they were.
Untested in Vectorworks.
A door, window or symbol set in a straight wall slides along it with its
opening: the wall's points between its ends within 60 mm of its plan drawing
along the line (its drawing's lines, polygons and polylines and its bodies'
points) and the insert move by the slide, the rest of the wall staying. The
opening must be told apart, so no other insert's drawing and no wall teeing
in lies within 60 mm of it, and no end point; and it must stay so, short of
the wall's other points, the other inserts and the tees by 2 mm. The insert's
matrix takes the slide in its origin, its own drawing being in its frame.
Untested in Vectorworks.
Walls drawn in one run are mitred where they meet: as every point of such a
wall lies on one of its two ends, each point at the joined end moves along
the wall by its distance across the line (left positive) times tan(turn/2),
less at the end of the wall coming in and more at the start of the one going
out, so both ends lie on the bisector of the corner and their faces meet
there (walking a wall from its end to its start turns both its along and its
across, so a wall already drawn meeting the corner with its start takes the
same factor). A wall ending on another's side between its ends (a tee) runs
only to the face of that wall nearer its own other end, the faces taken
from how far the other's plan drawing reaches across its line, and its end
is cut along that face: each point moves along it by its distance across
times −(n·f)/(u·f), u its direction, n its left normal, f the face's normal.
The wall met is left as it is (its face line still crosses the joint), and
a tee is refused when the walls cross at under 15°. The drawing's points and the bodies' points move alike; the group's
and solid additions' boxes are fitted to their bodies and the wall's own box
grows to hold the cut. How Vectorworks records a join between two walls
isn't known, so none is written: Vectorworks may square the ends again when
it rebuilds them.
Its aux records stay as they are: its `TDMD` ones (its texture parts) hold
numbers near the line in about a quarter of the 2023 walls, not explained yet.
Untextured faces
take their fill as Top/Plan paints it, with class attributes resolved: a
hatch's ground, not the object's fill background, which hatch-filled
components often leave black.

**Site model terrain** lives in aux records (76) of the site model plug-in,
tagged at +0x50:

| Tag | Contents |
|---|---|
| `pNIT` | u32 version at +0x54; points from +0x58, 32-byte `(x, y, z, pad)` or, in newer files, 40-byte `(x, y, z, u32, u32, z)` |
| `eNIT` | one f64 per point, so its length gives the point count (and hence the stride) |
| `tNIT` | 51-byte triangles from +0x58: 3 × i64 point indices, 3 × i64 neighbours, 3 flag bytes |

The plug-in's own body is only its bounding box, and `DMT` records hold a 2D
topology without heights.

Hardscapes, landscape areas and site modifiers hold the same `pNIT`/`tNIT`
records, but theirs are not what they show: in a private 2025 sample whose
terrain lies well above zero, 18 hardscapes and 24 landscape areas hold one,
and those looked at lie flat between 0 and 91 mm while their slab meshes,
extrudes and plants stand at the terrain's height. openvwx draws a TIN only for the site model (`DTM6`)
and builds the others from their parts (confirmed in that file and the 2026
demo).

**Groups a plug-in keeps but does not show** are marked by an aux record
(76) among the group's own: an 84-byte one whose tag at +0x50 names the
group, or a TDMD dictionary of a telling kind. Stored backwards:

| Tag | Group | |
|---|---|---|
| `gorp` (prog) | profile group: what the plug-in is rebuilt from. A plant's symbol at 0 while the plant itself (an instance among its parts, and a `gles` copy) stands on the terrain; a door's handle symbol unplaced at the door's origin; a door-and-window assembly's frame and mullion plug-ins, the panels it shows being its other parts; a tapered extrude's profile; a massing model 5.9 m below itself; a landscape area's plant mix, one of each at its origin, its scattered plants being another group. In a plant symbol's plant, the image prop at its own size (2 m for a plant shown 500 mm tall), the plant showing a copy at its set height beside it; 22 of a private sample's 107 such symbols, placed nowhere, keep no copy | likely (a private 2025 sample: 25 plants, 31 landscape areas, 141 massing models; 2026 demo: 17 doors, 15 assemblies) |
| `gtap` (patg) | path group: a path plug-in's path, 2D, in the plug-in's frame: a hardscape's, landscape area's or massing model's outline, a plant's or hedgerow's run, a curb's line. Its first corner is the plug-in's origin for most. openvwx reads it as the object's path (VwxDocument.pluginPath), Reshape moves it, and drawing a plug-in again keeps it | likely (a private 2025 sample: every one of its hardscapes, landscape areas, massing models, plants, hedgerows and curbs) |
| TDMD `htap` (path) | a hardscape's or landscape area's boundary draped on the terrain, as a 3D polygon; 4 of a private sample's hardscapes have 4 or 5 corners left at 0 where draping failed. Every one of the 36 with such a group has other 3D | likely |
| `gles` (selg) | selection group: a copy of what the plug-in shows, or a box round it (a plant's tree, a hardscape's whole thickness as one extrude, a Laubwerk plant's ring and box), which Vectorworks doesn't draw: the Dover Dam demo's published PDF shows its Laubwerk plants with no ring | likely |
| `gchw`, `ggcw` | in doors and windows: a box the size of the opening | not known |

openvwx leaves profile groups and draped paths out of 3D, and selection groups
out of plan and 3D where the plug-in shows something else there; the rest it
still builds.

**Placing a slab** copies a slab plug-in (`Slab`, parameters `Style`,
`Bounding`, `Texture Set`, `Height`: none holds the outline, which is its
first polyline) whose outline is a rectangle and whose parts are only
polylines, polygons, groups, slab pieces (71) and bare solid additions (the
2023 demo's pieces are slabs, the 2026 demo's solid additions), with its 3D
inside the outline in plan. Its parts are stretched in the plug-in's own
frame along the outline's two sides about its first corner, the pieces'
three points, boxes and bodies with them; the plug-in then turns and moves
as a whole (by a quarter turn at most, to the axis nearest its first side)
onto the rectangle drawn, and its box is its parts' as the matrix places
them. The 2023, 2024 and 2026 demos offer 6, 9 and 6 such kinds by style
and thickness; each lands on its rectangle in plan and 3D to 0.01 mm.
Untested in Vectorworks.

**Placing a plug-in object** copies one the drawing has, as Duplicate does
(every object record unnamed), on the layer, then turns it about its
insertion point (the matrix's translation) and sets it down: the matrix's
rows and translation and its box go through the turn (§4, 86), and its
drawing and 3D, in its own frame, follow. Its parameters are the copy's as
they are. The 2023 and 2026 demos' 16 kinds on design layers each place,
turn and reopen this way. Untested in Vectorworks.

**Renderworks cameras** are plug-in objects (86) whose parameters' format is
named `RenderWorks Camera`; a sheet viewport's camera sits in a group inside
the viewport. Its view is in the parameters, in the model's frame (mm):
`__Point3DCameraX/Y/Z` the eye and `__Point3DLookToX/Y/Z` the point looked
at; `ViewAngle` the angle across the picture in degrees, `AspectCustom` its
width over its height, `Projection` (`Perspective`), `Name`. The eye's z is
the matrix's z (§4, 86) plus `CameraZPos`; the `__CameraCorner_*` points
give the picture's corners a `LineLength` ahead, whose half-width there
spans half the `ViewAngle` (65.1° against 65.0°), so the angle is across the
width. Likely (the 2024 and 2025 demos' one camera each: its eye lies inside
the model, 1.5 m above its matrix's z).

The plug-in stands where the camera does, turned the way it looks: the
matrix's translation is the eye's x and y, its rotation the pan toward the
look-to point in plan, and `LookToZPos` the look-to point's z less the
matrix's z. `LineLength` is the plan distance from the eye to the look-to
point; `ControlPoint02` lies on that line a quarter of the way along and
`ControlPoint01` off it, so both scale with the distance. The plug-in's box
is its children's boxes placed by its matrix. Rodeo writes these when it
points a camera, and puts a move or turn through the matrix and the
`__Point3D*` points (and a lift to the matrix's z) when it moves, turns or
duplicates one; `__LookToXPos/YPos` and
`Tilt` (0, though the view tilts 4°) are unexplained and left as they are.
Likely, from the same two cameras.

A new camera is a copy of one the drawing has, the plug-in and its
children (its records, parameters and plan drawing), with no name of its
own (+0x1a 0), the matrix's z its layer's elevation (§5) so its heights
above the layer are all in `CameraZPos` and `LookToZPos`, and `Name` and
`__PrevName` set to "Camera n" and `__Active` false (likely whether the
view is looking through it, so it isn't copied).
It is then pointed as above. The `__CameraCorner_*` points stay the
original's: Rodeo doesn't write them yet, and the copy reopens with its new
eye and look-to point. Untested in Vectorworks.

**Light objects (81)** are 396 bytes in every demo, with an attribute block
and plan box (§4.2) and then: +0x8c its position `(x, y, z)` f64; +0xa4 u8 1
when on (0 in the Heliodons' own lights, whose copies in their groups are 1);
+0xa6 colour `(r, g, b)` f64 0..1 (1, 0.98, 0.96 for a warm white); +0xbe
f64 brightness, 1 = 100 %; +0xcc f64 (100 to 4000: lumens?) and +0xd4 f64
a colour temperature in kelvin (2700, 3000, 3400); +0xe2 u16 kind, 0
directional, 1 point, 2 spot (Vectorscript's numbers); +0xe4 a directional
light's direction and +0xfe a spot's, unit `(x, y, z)` f64; +0x116 and
+0x11e f64 a spot's spread and beam, radians (70° and 30°, 85° and 45°: the
spread is always the wider). In the demos they sit in symbol definitions
(light fixtures, placed 75 to 134 times in each large demo) and Heliodons,
whose lights are directional along the sun. Likely (every placed light lands
inside the model, 85 to 93 % of the spots aiming down; the Heliodons' lights
are kind 0, the bare bulbs 1 with default directions, the downlights 2).
openvwx writes the on byte, kind, colour, brightness, spread and beam in
place (Object Info's Light section), leaving the lumens and kelvin fields as
they were; whether Vectorworks then lights by the colour or the temperature
is not known. A move shifts the plan box and the position's x and y, and a
lift its z; aiming writes a unit vector into the direction the kind reads.
The position's order is `(x, y)` as written above, not the plan box's
`(y, x)`. Likely: in two demos' small boxes (the fixtures', under 500 mm),
read so it lies inside 15 of 16 and at the centre of 7; read the other way,
inside 13. A new light (the Light tool) is a copy of one the drawing has, a
fixture's in preference to a Heliodon's, with its position (its z the
layer's elevation plus the height above it), kind, direction and on byte
written and its plan box carried along as a move would. The
fixtures' lights have a white pen (colour 256), so plan draws light objects
in a colour of its own rather than their pen's.

**Heliodons** are plug-in objects (86) named `Heliodon`, their sun in the
parameters: `__Latitude` (degrees, positive) with `__NorthSouth` `N` or `S`,
`__Longitude` with `__EastWest`, `StdMeridian` the time zone (`GMT -05:00
...`), `DaylightSavings`, `UseSolarTime`, `Month` (`June`), `Day` (`21`) and
`Time` (`16:30`, solar time when `UseSolarTime` is set, else clock time). It
writes what it works out from them alongside: `SolarTime`, `SolarAltitude`
(`61° 39' `, a trailing space), `SolarAzimuth` (`226° 16' [133° 44' west]`:
from north clockwise, then the angle from north to the east or west),
`Sunrise` and `Sunset` (clock time) and `__C4DHours`, `__C4DMinutes`,
`__C4DDay` and `__C4DMonth` (1 to 12, the solar time and date again). Its
directional lights (81) inside shine away from the sun:
`(-sin az cos alt, -cos az cos alt, -sin alt)`, level when the sun is below
the horizon; turning the plug-in doesn't turn north. The demos' altitudes and
azimuths agree to a hundredth of a degree with the usual declination
(`-23.44° cos(360°(n + 10)/365)`) and hour-angle sums, and the sunrises and
sunsets to the minute with the sun's centre 0.833° down, the time zone's
meridian against the longitude and the equation of time
(`9.87 sin 2B - 7.53 cos B - 1.5 sin B`, `B = 360°(n - 81)/364`) taken in.
Likely (six Heliodons in each of two demos; set to their own sun again,
every shown figure comes back the same but one azimuth a minute out, and the
older demo's `__C4D` hours and minutes, which differ there, and the lights
turn under 0.01°). Rodeo writes these
and the lights when a Heliodon's sun is set.

Its plan drawing is a compass with an `N` and one label, a text (10) among
its children whose lines are `Time`, the `City` (empty in most) and
`Day. Month` (`21. June`), as every demo Heliodon's are. Rodeo prints the
label's first and last lines again when they still read as the parameters
did, leaving the city line and the rest of the drawing; which time the
label shows when `UseSolarTime` is off is not known (Rodeo prints `Time`).
The plug-in's own box isn't its drawing's as the matrix places it (off by
1.5 to 6 m in the 2023 demo, empty in 2026), so it stays as it was.
Setting the longitude writes `__Longitude` and `__EastWest`, and daylight
saving `DaylightSavings`; a clock `Time` then stays and the sun moves.
`StdMeridian` names the zone as `GMT -05:00 ...`, followed by text from a
list Rodeo doesn't have. A new Heliodon is a copy of one the drawing has.
Untested in Vectorworks.

**Typed dictionaries** (`TDMD` aux, also used for the colour table, §4.2):
4-char kind at +0x56, u16 entry count at +0x5a, u32 end at +0x5c, then
`(u16 key, u32 offset)` entries from +0x60 (offsets from +0x60); each value
is u16 type (8 = i32, 1 = byte, 6 = f64), u32 count, values. Kind `ttwr`
is an object's RenderWorks texture, one value per texture part under each
key: 1 the part's id (3 the whole object; walls hold 3, 7, 8 and 14–17,
slabs 3 and 14–16, solids 3, 7, 8 and 14–18, plug-ins 3, 10 and 20), 2 i32 0,
3 the texture's name index (−1 none, 0 by class: the class record's +0x9e),
4 a byte (often 0xcd, memory never written), 5 the mapping (i32: 0, 3 or 7
in the demos), 6 six f64 per part (offset across and up in mm, scale across
and up, rotation in radians, and a length: 1000 by default), 7 twelve f64
per part (three axes and an origin), 8 one i32 0. A dictionary can hold no
parts (key 8 alone: 470 extrudes in the 2023 demo); some lack key 8. The
directory has a spare zero entry after the last and the values end 6 zero
bytes before the record's end, at the u32 at +0x5c; rebuilt from the values
read, 9,168 of the 9,224 dictionaries of keys 1–8 in the 2023 demo come out
byte for byte (the others place their first value elsewhere). openvwx edits
a part's texture, offset, scale and rotation in place, and writes a new
dictionary with the whole object's part for a 3D object that has none or an
empty one, mapped as most objects of its type in the drawing are.
Mapping 5 is UV: a mesh (Laubwerk plants) holds its texture in a part of
its own with mapping 5 (part 4; its whole-object part 3 has none), and its
UV map in a TDMD of kind `TeMe` (stored `eMeT`): key 1 a normal per vertex
(3 f64), key 2 `(u, v)` per vertex (2 f64, fractions of the image, v up),
key 3 two i32 per face: the texture part it shows, front and back (4, 5
or 6 in the plants, whose dictionaries hold parts 3–6), key 4 one i32 (3),
key 5 one f64 (50), key 6 three f64 (the vertex count, then two numbers not
worked out: they aren't sums of the points, normals, areas or (u, v)), key 7
twelve f64 (an unturned frame at the origin) in all 46 of the 2026 JohnMosbyHwy
demo's. openvwx writes new UV-mapped meshes (SketchUp import) so, with one
texture in part 4, a vertex for each distinct corner, (u, v) and face normal,
0 for key 6's unknowns, and the map before the ttwr among the aux records, as
the plants have them; read back, simplified and drawn by openvwx, not yet
opened in Vectorworks. Mapping 0 on a
3D polygon is a plane in the polygon's own frame: origin its first vertex,
x along its first edge, y against its normal, z up its face; key 7's axes
and origin are given in that frame, and the image spans the texture's size
× scale across and that × the image's height over width up. Every image prop's panel in a private sample (about
5,000) comes out exactly 0..1 across and up so.
Objects without their own texture show their container's.

### 7.2 Worksheets (18) and worksheet images (56)

A worksheet and each of its database blocks (type-60 children) hold a grid
laid out the same way:

| Part | Layout |
|---|---|
| counts | u16 columns, u16 rows (worksheet +0xc0, block +0x8c) |
| table | from worksheet +0x22a or block +0x98: 8-byte entries `u32 flags, u32 offset` (from the table start − 8): one per column, then per row its header and one per cell (offset 0 = empty), then one whose offset is the record's end |
| column | u16 1, u16 width (points), u16 left |
| row | u16 kind (2 plain, 4 database, 3 database subrow), u16 height (points), u16 top, u16; a database row goes on with u32 the name index of its block, u16 subrow count, u32 criteria length, the criteria |
| cell format | +0x02 u8 alignment (0 general, 1 left, 2 right, 3 centre); +0x06 u16 font size; +0x08 u16 style (1 bold, 2 italic); +0x0a u8 number format (0 general, 5 dimension, 11 area, …); +0x0b u8 accuracy (decimal places, or fractions of 1/2ⁿ inch); +0x0d u8 wrap; +0x11 u8 merged, then u16 top, bottom, left, right (1-based); +0x1b u8 filled, +0x1c u16 fill colour |
| worksheet cell value | at +0x6a: u8 kind (0 text, 1 formula, 2 number), u8, u32 length, 34 bytes of cached result (u8 0 = f64, 7 = i32, value at +2), then the text (UTF-16; an empty cell keeps 2 zero bytes), the number or the formula tokens |
| number cell | its tail is 14 bytes: u16 0x065a, the value as an 80-bit x87 extended float, u16 0x0690 (all 33 in the sample rebuild byte for byte) |
| block cell value | at +0x6a: u8 kind (5 text: u32 characters then UTF-16; 0 f64; 7 i32) |

A block's type-61 child lists its subrows in display order: u32 count + 1,
then u16 1-based subrow numbers. Cached numbers are in document units.

A worksheet image (56) on a sheet shows the grid with database header rows
left out and their subrows in their place, each subrow cell in its header
cell's format: +0x68 its bounds (top, left, bottom, right, mm), +0x8c u32 the
worksheet's name index, +0x90 the whole grid's frame, +0xb0 f64 scale (a point
is 25.4 / 72 mm × scale). The frame equals the bounds up to 2025; in 2026 it
can be taller, the bounds showing the first rows only. Not decoded: cell
borders (four 10-byte entries at +0x24…+0x42), text colour, font, vertical
alignment, formula tokens (the cached results serve). openvwx draws each image
as its cells' fills and texts (no borders: the published sheets show none).

openvwx makes a worksheet (Tools > Reports > Create Report) by copying one of
the file's with its children (the type-62 and type-112 records every sample
worksheet has, not decoded) but its database blocks, and laying a new grid:
the header kept but the counts and the u16s at +0xa8…+0xb8, set to 1, 1, 0
three times (taken to be the active cell and selection, at A1: 4 of the 50
sample worksheets have exactly these, the rest name other cells); the items
straight after the table in its order (as in all 50); 6-byte columns; 8-byte
plain rows, their last u16 the source's first plain row's; every entry's flags
0 (as all 364 columns, 50 end entries, 282 of 284 plain rows and all 2,169
text and number cells of plain rows have them); each cell in a plain text
cell's format, unmerged and unfilled.
It reads back, and survives a save, in openvwx; not yet checked in Vectorworks.

### 7.3 Record formats (47) and records (48)

A record format (47) defines a data record; a plug-in object's parameters are
one too:

| Offset | Meaning |
|---|---|
| +0x50 | u16 field count |
| +0x58 | u16: 1 for a plug-in's parameters, 0 for a data record |
| +0x5a | u16 flags: bit 0 is set on most plug-in formats, not all (the cabinets, framing members and break lines lack it) |
| +0x60 | 136 bytes per field: u16 type, u16 value offset, u16, u16 number format, then the field name (UTF-16, zero-ended) |

Its own type-48 child holds the defaults. A record (48) under an object holds
values for one format:

| Offset | Meaning |
|---|---|
| +0x50 | u16 name index of its format |
| +0x54 | u16 n: the field count, or 0 |
| +0x56 | n bytes, one per field |
| +0x56 + n | the values, each at its field's offset from here |

Values by field type: integer (1, 16, 23–27, 29, 30) i32; boolean (2) and
colour (28) u16; number (3), dimension (7, 10, 11), angle (20), area (21) and
volume (22) f64 plus 2 spare bytes, dimensions in mm; text (4, 14), choice
(8, 9), class (18) and layer (19) a u32 byte length and a u32 offset (from the
same start) into a UTF-16 pool after the fixed values. Some records keep stale
bytes after the pool. A plug-in object's parameters are its 48 child whose
format has 1 at +0x58: every plug-in object in the four demo years has
one at most (a few have none), and its format's name is the plug-in's. Every record in the four demo years reads this
way (3,247 in the 2023 Dover Dam file, 7,954 in 2026). openvwx writes numbers
in place and rebuilds the pool (and the record's size) for text.

In a private sample every data record format (47 of them) is exactly
0x60 + 136 × fields bytes long; each field's third u16 is 0 and its value
offset follows the fields before it in order (sizes as above); dimensions
have number format 5. Every record's per-field bytes and its u16 at +0x52 are
0, and some keep a true boolean as a value other than 1. A few formats have a
tagged type-76 child (`FSBT`, then UTF-16 text after a byte-order mark) or
type-119 children besides their defaults; openvwx copies neither. A new format
is a copy of one with only its defaults under it, with new fields laid out as
above; editing a format rewrites its field table and every record of it, a kept
field keeping its definition and, unchanged, its value's bytes (all 47 rebuild
byte for byte).

Formats sit in the class list (57) or in a type-76 list tagged `TMFH`; the
formats of textures' shader settings are data record formats in the latter
(about 20 to a demo file, 9 of them needed by the 2026 demo's textures).
Their field names can differ between files (one demo file's are another
language's, some left blank) while the types and value offsets are the same;
openvwx compares two same-named formats by kind, field types and offsets only
when bringing a texture in.

Attached records sit in their object's aux list (before its first record
without a next mark), mixed with aux records of type 76 in no fixed order in
the demo files. openvwx attaches one as a copy of its format's default record,
ahead of any drop shadow (101), which Vectorworks keeps last; detaching removes
it, moves the end mark to the record before it when it was last, and clears the
object's +0x10 when no aux record is left.

### 7.4 Data visualisations

A data visualisation redraws the objects that match its criteria with the
fill and pen of their value. The document keeps them all in one aux record
(76) tagged `rOSC` at +0x50, a tree from +0x54. A node is u16 kind, u32
length (from its start), fields up to a u32 0, then child nodes to its end;
a field is u32 length and bytes, and strings are `FF FE`, UTF-16LE, `00 00`.
The root's first child holds the visualisations, as kind-1 nodes:

| Field | Meaning |
|---|---|
| 0 | GUID, as text (`8-4-4-4-12` hex digits) |
| 1 | name |
| 2 | what the values are: "" (all objects, one value `<All Objects>`), `C` (class name), `OSTYLE` (object style), `MATERIAL` |
| 14 | criteria (below) |

Their kind-0 children are the values: field 1 enabled (byte), 3 the value,
7 fill (0 none, 1 solid, 2 pattern, 3 hatch, 7 unchanged), 8 and 9 fill
foreground and background as `"r,g,b"` (a solid fill is 9), 14 the
pattern's index, 16 pen (0 none, 1 solid, 3 line type, 4 unchanged), 17 its
colour, 27 the hatch's name, 28 the line type's name, 33 a texture's name
(32 says whether it changes). Fields 34–45 look like opacities and a drop
shadow; they are not read.

Criteria are u16 tokens in postfix; token 0 is followed by a zero-ended
UTF-16 string. A test is a field (0x328 plug-in type, 0x305 layer, 0x306
class, 0x332 story, 0x327 object type), an operator (0x65b `=`, 0x2a3 for
classes), the name's index and the name; 0x647 ends it and 0x648 ORs the
two before. A story test matches the objects on the layers that name the
story (§5, +0xf4). The object type test takes one u16 code of the
application's own: 0x1fd (509) is the slab (71), which the floor finish
visualisations test for beside the Slab plug-in, listing the roof slabs'
styles among their values; no other code appears in the demos. A slab's
object style is the one named at its +0x104. The
tokens around them (0x29a, 0x296, 0x302, 0x319, 0x31d, 0x32b, 0x64f at the
start, 0x64f 0x2a5 0x690 at the end) vary with where it looks: in symbols,
plug-ins, viewports.

A viewport lists the ones it applies in a `TDMD` aux record of kind `cSCV`
(§7): key 2 is a byte array of their GUIDs, 16 bytes each in the order the
text writes them. openvwx applies them to plan viewports in that order: an
object takes the first whose criteria it meets and that has an enabled
value for it, and a value that changes nothing it draws (a texture) passes
to the next. A plug-in or symbol is tested before what it holds and
decides for all of it; what a plug-in draws is never tested on its own;
groups and walls decide nothing for what they hold. A plug-in's object
style is the name index in its parameters' `Style` field (a slab plug-in's names its slab style).

Evidence, 2023: A1.2's wall cabinets print dashed in a line type with no
fill, and its floors carry the hatch of their finish; the roof plan prints
the lower floors' objects white with grey pens by story, its green roof in
the finish's sand stipple and its sloped roof slabs in standing seams 12"
apart across every face (by the slab type test); A2.5's key plan
prints its steel columns solid black by material; A5.2's first wall
section prints its cut framing grey by material, its batt insulation's loops
over the grey; A5.1's shading
devices print in the visualisation's pink (blue in 2026); A1.7's floor
slabs and joists vanish and its exposed beams print white with black pens.

Section, elevation and detail viewports list theirs the same way, and they
restyle the copy the viewport caches: each cut piece by its own class and
material (+0x88 of a polygon or polyline, §6), its annotations untouched. A
solid colour given to a tile-filled piece becomes the ground the tile is
drawn on; the tile stays.

## 8. Open questions

* Data visualisations by object type codes other than 0x1fd (slabs), and
  whether a material visualisation restyles a wall's component
  lines and outline, which carry no material; the criteria's
  scope tokens; the opacity and drop-shadow fields. Whether one applied to
  design layers is stored anywhere.
* Line markers (type 125): what bytes +1, +5 and +6 of a marker hold (a
  thickness or "by line weight" setting, perhaps), what the type-125
  children of plug-in objects (86) do, and markers by class: classes hold
  the same 20 bytes (§6), but none in the samples shows any and no by-class
  bit for them is known.
* Why the 2023 detail sheet (A5.2) prints the cut concrete of its first and
  third wall sections solid #777777 while the second prints the cached
  hatch (Concrete CIP HF on its #eeeeee ground): the three viewports cache
  the same pieces with the same attributes, apply no visualisation that
  names concrete, and their records differ only in title and class list.
* Design-layer viewports (§7): what a type-29 entry's matrix does (the
  identity in all 60 in the samples), how a crop is stored (none in the
  samples), and what the varying last byte of a `TVLD` layer entry means.
* Where a 2D object of a 3D model keeps its plane: the hinge markers'
  coordinates are in the leaf's plane, but no record found so far places
  that plane, so openvwx can tell such objects apart (Top/Plan) but not
  draw them in 3D or in elevations.

* Header u32s at 0x58 / 0x5c, and the settings block beyond its page and units
  (the rounding fields at 0x264 – 0x276 and the display preferences).
* Terminator payload (u64 at +0x50, close to but not equal to stream offsets).
* How the active layer is referenced: by name index, by GUID, or by saved
  pointer. Viewports name their layers and classes by name index (§7), and
  symbol instances their definition (+0x8e).
* What the 7 aux records of a symbol definition hold (insertion options,
  thumbnails?); new definitions copy them from an existing one.
* Colour table section 6, Parasolid data (free-form surfaces show only their
  edges), the site model's NURBS drape (113), what a hatch's axis length means,
  and how a tile's mapping places a cell when the tile's repeats are not
  axis aligned (the demos have one tile), the hatch flags
  other than bit 0 (gypsum sets 0x80, the world-sized library hatches 0x08),
  the bits of bitmap fill patterns other than 35, and what pattern 2 is, what the
  viewport list's flags mean, why some
  plug-ins' +0x68 bounds do not match their drawing, the section-line group
  (`ntcs`) of a viewport, worksheet cell borders and text colour, fill by
  class.
* Text: the baseline-alignment values 2 and 4 are inferred, not observed; what
  the font list's u16 and last u8 per entry are; whether the 10-byte entries
  after the size carry style runs (one font for the whole text is all that is
  read and written).
* Whether a class or layer count is cached anywhere (creating and deleting
  classes and layers re-reads cleanly in openvwx, but VW may keep a count).
* Whether the active layer / active class are stored by pointer or name index
  (deleting the active layer might confuse Vectorworks).
* Whether Vectorworks accepts files edited by openvwx (renamed/reordered
  layers, new objects cloned from templates, new classes and layers). They
  re-read cleanly in both the TypeScript and Python readers; they still need
  opening in Vectorworks or the free Vectorworks Viewer.
