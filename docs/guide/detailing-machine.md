# Detailing, machine parts and fasteners

This page covers the Detailing tool set's drafting tools and the Machine Components and Fasteners tool sets: gears, chains and pulleys, bearings and shafts, springs, fasteners and holes, and the Tools menu's Machine Design calculators. Machine components in 3D, like fasteners and holes, have "- 3D" tools beside the 2D ones, described at the end of each group.

## Detailing

The tools in this group are in the Detailing tool set. Vectorworks makes plug-in objects of Break Line, Insulation, Repetitive Unit, Steel Section, Lumber, Bulb Flat, Stipple and Weld; in Rodeo these are plain objects, grouped.

### Break Line, Insulation and Repetitive Unit

For the **Break Line** and **Insulation** tools, drag a line or click its two ends (<kbd>Shift</kbd> keeps it to 15° steps).

- **Break Line** draws the line with a zigzag break at its middle, its height on paper set in Preferences.
- **Insulation** draws a band of the thickness set in Preferences to the left of the line, centred on it or to its right (keys <kbd>3</kbd> to <kbd>5</kbd>). Batt (key <kbd>1</kbd>) draws it as one polyline of loops running end to end; Rigid (key <kbd>2</kbd>) as the band's outline crossed corner to corner, grouped.

**Repetitive Unit** lays bricks (key <kbd>1</kbd>) or blocks (key <kbd>2</kbd>) of the size in Preferences in courses along the line, every other course moved half a unit and the units cut at the line's ends.

### Steel Section, Lumber and Bulb Flat

**Steel Section** and **Lumber** place a section with a click, or with a press dragged to turn it.

- **Steel Section**: wide flange, channel, angle, tee, I-beam, rectangular, square or round tubing, or Z-section (keys <kbd>1</kbd> to <kbd>9</kbd>), sized in Preferences. **Steel Section - 3D** stands the same shapes up as solids of a Length.
- **Lumber**: a nominal size such as 2×4 at its dressed size, or a custom one; crossed for a continuous member or with one diagonal for blocking.

**Bulb Flat** places EN 10067's hot-rolled bulb flats (HP 120 x 6 to HP 430 x 20) or a custom size the same way, its section properties listed in Preferences, with a locus at its centroid or the centroid on the click if asked.

### Stipple

**Stipple** fills a dragged rectangle with dots, even (key <kbd>1</kbd>) or thinning across it (key <kbd>2</kbd>), at a density on paper set in Preferences.

### Weld

**Weld** draws a welding symbol. Click the joint, then where the arrow meets the reference line, which runs on away from the arrow. The symbol is a fillet (key <kbd>1</kbd>) or V-groove (key <kbd>2</kbd>) on the arrow side, the other side or both (keys <kbd>3</kbd> to <kbd>5</kbd>), and a circle for all around (Preferences).

### Linear Material

**Linear Material** draws board, gypsum board, plaster or stucco, plywood, built-up roof or corrugated deck along a clicked path, its thickness on the path's left past an offset, stippled in the detail types. Plain objects, grouped.

### Framing Member

With **Framing Member**, drag a member's span. It's drawn solid, as its centre line, by its width or both, each end square or mitred, a rafter's bearing inset and overhang run past its clicks, its label above it. Plain objects in plan, grouped.

## Gears, chains and pulleys

These tools are in the Machine Components tool set.

### Spur Gear and Spur Gear Rack

With **Spur Gear** and **Spur Gear Rack**, a click places one and a press dragged turns it.

A gear is seen from the front (key <kbd>1</kbd>), its involute teeth drawn (key <kbd>3</kbd>) or simplified to its outside and pitch circles (key <kbd>4</kbd>), or cut through its axis from the side (key <kbd>2</kbd>). Its Preferences hold:

- its pitch diameter, teeth, pressure angle (14.5°, 20° or 25°) and face width
- a web recess
- a hub standing out on both sides or one
- a bore with an ASME-sized or custom keyway
- holes through the web
- centre lines

They also show the module, diametral pitch and outside and root diameters for reference.

A rack is sized by module or diametral pitch, and seen from:

- **the front** (key <kbd>1</kbd>): every tooth, or two at each end with the tips' and roots' lines between, the roots filleted if asked
- **the top** (key <kbd>2</kbd>)
- **the side** (key <kbd>3</kbd>)

### Bevel Gears

With **Bevel Gears**, a click puts the pitch apex of a bevel gear and pinion there. They're cut through their axes (key <kbd>1</kbd>) with the pinion's axis turned the Shaft Angle from the gear's, or the gear is seen down its axis (key <kbd>2</kbd>).

Preferences set the module or diametral pitch, the face width, each member's teeth, mounting distance, hub, bore, keyway, recess and fillet, and whether to draw both, one, or a miter pair.

### Worm and Worm Gear

With **Worm** and **Worm Gear**, a click places a worm with its axis running right, or its gear, centred there; a press dragged turns it. Keys <kbd>1</kbd> to <kbd>5</kbd> pick the view:

- **the worm**: from the front with its threads wound round it, from either end, or cut across or along it
- **the gear**: from the front or back, cut through its axis with its rim hollowed to wrap round the worm, or from the side with or without hidden lines

Keys <kbd>6</kbd> and <kbd>7</kbd> switch the teeth between Detailed and Schematic. A negative Hub Projection sets the hub into the face.

### Sprocket and roller chains

A **Sprocket** for an ANSI or ISO roller chain is placed like a gear. It's seen from the front (key <kbd>1</kbd>) with its teeth in the ISO 606 tooth form, or from the side (key <kbd>2</kbd>) with a row of teeth for each strand. It shares the gear's hub, bore, recess and web hole Preferences.

A **Roller Chain - Linear** runs right from the click (a press dragged turns it). A **Roller Chain - Circular** wraps round a sprocket's pitch circle about the click, from a start angle, clockwise or counterclockwise. Both draw link plates and pins as seen from the side; placed on a sprocket's centre, a circular chain's rollers sit in its seats.

### Roller Chain - Offset Link

With **Roller Chain - Offset Link**, a click places one offset link of the chain size picked in Preferences, its roller end on the click and its pin end a pitch to the right. It's seen from the side (key <kbd>1</kbd>) or from above with its plates cranked (key <kbd>2</kbd>); a press dragged turns it.

### Pulley

A **Pulley** is placed like a gear, from the front or cut through its axis (keys <kbd>1</kbd> and <kbd>2</kbd>). Preferences hold:

- the outside diameter
- up to ten grooves, each a V of the angle, width and depth given with its bottom corners rounded to the groove radius (a small angle and a radius half the width make a round belt's groove)
- the gear's hub, bore, keyway and recess

The web is plain, has holes sized by a share of the room across the recess or by their diameter, or has spokes.

### Gears, chains and pulleys in 3D

Gears, racks, sprockets, chains, pulleys, bevel gears and worms each have a "- 3D" tool beside the 2D one, with the same sizes, placing a solid with its top view for plan. Spur gears and sprockets have real teeth, and worms a real helical thread.

**Limits:** bevel gears have no teeth, and keyways and spokes aren't modelled.

## Bearings and shafts

These tools are in the Machine Components tool set, except Keyway and the shaft breaks, which are in the Detailing tool set.

### Ball, roller and needle bearings

With **Ball Bearing**, **Roller Bearing** and **Needle Bearing**, a click places a bearing centred on it, seen down its axis (key <kbd>1</kbd>) or cut through it (key <kbd>2</kbd>); a press dragged turns it. Preferences hold:

- **the type**: single or double row, radial, angular, separable or self-aligning; a machined or drawn-cup needle bearing, its rows and inner ring
- the inside and outside diameters
- the width

The rings, grooves, ribs and rolling elements are proportioned from those. Show Detail off draws the simplified bearing of ISO 8826-1, its outline with an upright cross.

### Tapered Roller Bearing and Thrust Bearing

**Tapered Roller Bearing** (single row, or a double row back to back) is sized by both rings' widths, the space between rows and how far the inner ring stands out past the outer.

**Thrust Bearing** (single or double ball, or cylindrical roller, its washers grooved or flat) is sized by its thickness.

Both can show their retainers' side rings in section.

### Bearing Lock Nut

**Bearing Lock Nut** places a KM nut (KM0 to KM20) the same way, from the front with its four slots and, if asked, the tab washer behind it, or cut through its axis.

### Pillow Block and flanged bearings

With **Pillow Block**, **Flanged Bearing - 2 Hole** and **Flanged Bearing - 4 Hole**, a click places a mounted ball bearing unit centred on the shaft. It's seen down the shaft (key <kbd>1</kbd>), across it (key <kbd>2</kbd>) or, a pillow block, from above (key <kbd>3</kbd>); a press dragged turns it.

Preferences pick a UC204 to UC215 size from FYH's catalogue, or Use Custom Dimensions to type your own, and show the set screw, the grease fitting, and the centre and hidden lines.

### Shaft

With **Shaft**, a click puts a shaft's left end there with its axis running right; a press dragged turns it.

Preferences open the Shaft Configuration, where < Add, Add > and Delete build the shaft segment by segment (the current one red in the preview):

- **Segments**: straight, tapered or threaded (inch, metric, custom, Acme or bearing lock nut threads)
- **Ends**: each end plain, chamfered, flared or rounded
- **On straight segments**: a keyway (parallel or Woodruff, sized for the diameter), a groove and wrench flats

Threads show Simplified (ASME or ISO), Schematic or Detailed, with centre drills at either end.

### Key and Woodruff Key

With **Key** and **Woodruff Key**, a click places a key centred on it, from the front, top or side (keys <kbd>1</kbd> to <kbd>3</kbd>).

- **Key** takes a DIN 6885-1 or ASME B17.1 size, or a custom width and height, and a length.
- **Woodruff Key** takes a DIN 6888 or ASME B17.2 size, its Preferences showing how deep the keyseat goes into the shaft and the hub.

### Keyway and Shaft Break

These are in the Detailing tool set. Vectorworks makes plug-in objects of them; in Rodeo they're plain objects, grouped.

- **Keyway** draws a shaft (key <kbd>1</kbd>) or bore (key <kbd>2</kbd>) cut across with its keyway, the key a standard size for the diameter.
- **Shaft Break** draws a round shaft's break, solid or hollow, of the diameter and width in Preferences, on a click (a press dragged turns it).
- **Shaft Break 2** draws one at each end of a shortened shaft, a click on each.

### Bearings and shafts in 3D

Keys, shafts, bearings and mounted units each have a "- 3D" tool beside the 2D one, with the same sizes, placing a solid with its top view for plan.

**Limits:** keyways, set screws and cages aren't modelled.

## Springs

These tools are in the Machine Components tool set.

### Compression springs

With **Compression Spring 1** and **2**, **Conical Compression Spring** and **Die Spring**, a click places one end of a spring, its axis running right for the working length (a press dragged turns it). Preferences hold:

- the wire
- the diameters
- the solid height or the active coils
- the kind of ends
- the hand of the spiral

Keys <kbd>1</kbd> to <kbd>5</kbd> show the front coils, the rear coils or both, solid; a section through the axis; or the zigzag ISO 2162-1 draws for a spring.

### Extension springs

**Extension Spring - Front** is placed like the compression springs, its coils close wound at the free length and spread over the working length, with a full loop or an open hook at each end seen face on or edgewise. Show All Coils off draws three coils at each end.

**Extension Spring - End** draws the spring seen down its axis, its far loop at right angles if asked.

### Belleville Spring

**Belleville Spring** places a stack of disc springs nested, or in groups facing alternately down and up, cut through its axis (key <kbd>1</kbd>), or one seen down its axis (key <kbd>2</kbd>).

### Torsion springs

- **Torsion Spring - Front**: close-wound coils with a leg up or down at each end, in front of, behind or beside them.
- **Torsion Spring - End**: the coils' ring with two tangent legs at their deflections, plain, bent a quarter, half or three-quarter turn, or looped.

Plain objects, grouped.

### Springs in 3D

Springs each have a "- 3D" tool beside the 2D one, with the same sizes, placing a solid with its top view for plan. They have real coils.

## Fasteners

Most of these tools are in the Fasteners tool set; Bolt and Nut and the bolts and screws at the end are in the Detailing tool set.

### Fastener

The **Fastener** tool is one tool for screws, shoulder screws, set screws, nuts, plain washers and spring lock washers in ASME inch, ASME metric, ISO or DIN sizes, chosen on the Tool bar with the view (front, side, top or bottom).

- **Screws and bolts** come with hex, heavy hex, square, flange, socket head, flat and button socket, and slotted machine screw heads, with washers and lock washers under the head and washers, a lock washer and a nut at the bearing length. Their length can keep to standard steps or follow the nut.
- **Set screws** come with a hex or spline socket, a slot or a square head and a cup, flat, dog, half dog, oval or cone point at each standard's sizes.
- **Shoulder screws** come by the shoulder's diameter and length.
- **Nuts** come hex, heavy, thick, flat, jam, slotted or castle, square or machine screw as each standard lists them, ISO's hex styles plain or washer faced.
- **Washers** come in each standard's series (narrow to wide, small to large, regular to hi-collar).

### Pins

The **Pins** come in their standard sizes:

- **Clevis Pin** (Inch, Metric, DIN)
- **Cotter Pin** (Inch)
- **Dowel Pin** (Inch)
- **Parallel Pin** (DIN)
- **Taper Pin** (Inch, DIN)

A click places one, a press dragged turns it; keys <kbd>1</kbd> to <kbd>5</kbd> pick the view:

- **a clevis pin**: from the top down its split pin hole, from the side, or end on at its head or body
- **a cotter pin**: from the front with its prongs bent at the grip length, from either end, above or below

Preferences keep lengths to the standard ones when asked.

### Rivets

- **Large Rivet (Inch)**, **Small Rivet (Inch)** and **Rivet (DIN)** stand head up with the head's bearing face on the click, in each standard's diameters and heads (button, high button, cone, pan, flat, truss, round, flat round, mushroom, flat and oval countersunk), with an optional second head at the far end. Key <kbd>2</kbd> looks down on the head.
- **Tubular Rivet (DIN)** lies along its axis from its head, its far end set into a flange and the unset tube dashed past it.

### Nuts

- **Acorn Nut (Inch)**, with a low or high crown, and **Hex Cap Nut (DIN)**: from the front, side or top.
- **Knurled Thumb Nut (DIN)** and **(Inch)**: from the front, with or without the knurl, or the top.

Each stands crown or head up with its bearing face on the click.

### Wing nuts

**Wing Nut (DIN)** and **Wing Nut - Type A, B, C and D (Inch)** come in their styles (moderate, high, low wings; die cast hollow wings; stamped strip with a large base), from the front, side or top, wings up with the bearing face on the click.

### Retaining rings and washers

- **Retaining Ring (ASME)**: a basic internal or external ring, heavy duty external, basic or reinforced E-ring or C-ring in metric sizes.
- **Retaining Ring (DIN)**: for bores or shafts, regular or heavy.
- **Retaining Washer (DIN 6799)**: by groove size.

Each is centred on the click with its gap down, or seen edge on as a section or solid, with a locus at its centre if asked.

### Bolts

**Eye Bolt** (plain, shoulder or bent), **Swing Bolt**, **Swing Eye Bolt**, **T-Bolt**, **U-Bolt** and **J-Bolt** come on any UNC or ISO coarse thread, from the front, side, top or bottom, the thread drawn in any of the shaft's styles.

Eye bolts follow ASME B18.15 and swing eye bolts DIN 444. A J-bolt can carry a hex or square nut, a lock washer and a narrow, regular or wide washer at its bearing length, its anchor left or right.

### Thumb screws

**Thumb Screw (Inch)** comes in ASME B18.17's Type A and B, regular or heavy, #6 to 1/2 in, with a plain, cup/flat, dog, oval or cone point, from the front, side or top. Lengths can keep to the standard's increments.

### Bolt and Nut

The **Bolt and Nut** tools (Detailing tool set), inch and mm, place a bolt through a joint with its washers, lock washers and nut in standard sizes, in any of four views, with a solid for 3D. The length follows the joint or is typed.

### Detailing bolts, screws, nails and anchors

These are in the Detailing tool set. Vectorworks makes plug-in objects of them; in Rodeo they're plain objects, grouped.

- **Bolt** draws a hex-head bolt from the side, the line running from under the head to the tip, its diameter in Preferences.
- **Screw**, **Nail** and **Anchor** draw those fasteners from the side, dragged from the head to the tip, their diameter in Preferences.

**Carriage Bolt** and **Lag Screw** are each placed with a click (a press dragged turns it) in Front, Side, Top or Bottom (keys <kbd>1</kbd> to <kbd>4</kbd>), their series, type, size and length in Preferences.

- **Carriage Bolt** places ASME B18.5's inch round head bolts (plain, short or regular square neck) or ASME B18.5.2.2M's and DIN 603's metric square neck bolts.
- **Lag Screw** places ASME B18.2.1's hex or square inch lag screws or B18.2.3.8M's metric ones, threaded to a gimlet point.

**Wood Screw** and **Sheet Metal Screw** are placed the same way, each slotted, cross or square recessed.

- **Wood Screw** places ASME B18.6.1's inch or DIN 95 to 97's metric flat, oval, pan and round head wood screws.
- **Sheet Metal Screw** places ASME B18.6.4's inch or ISO's metric tapping screws with flat, oval, truss, pan, hex or hex washer heads and point A, AB or B.

### Fasteners in 3D

These each have a "- 3D" tool beside the 2D one, with the same sizes. A click places a solid with its top view for plan, grouped.

- Clevis, Dowel, Parallel and Taper Pins
- Large, Small, DIN and Tubular Rivets
- Acorn, Hex Cap and Knurled Thumb Nuts

These have them too:

- Cotter Pins
- Wing Nuts
- Retaining Rings and Washers
- Eye, Swing, Swing Eye, T, U and J Bolts
- Thumb Screws
- Carriage Bolts
- Lag, Wood and Sheet Metal Screws

**Limits:**

- In the first list there are no threads, knurling or split pin holes, and acorn and hex cap nuts are closed underneath.
- In the second list, heads have no slots or recesses, and swing and thumb heads are flat plates.

## Holes and threads

Hole - Drilled, Hole - Tapped, Slot, Hole Pattern and Screw Threads are in the Detailing tool set. Vectorworks makes plug-in objects of them; in Rodeo they're plain objects, grouped.

### Hole - Drilled

**Hole - Drilled** places a hole seen from the top (key <kbd>1</kbd>) or cut through its axis (key <kbd>2</kbd>), plain, counterbored or countersunk (keys <kbd>3</kbd> to <kbd>5</kbd>), through or blind with its drill point (Preferences).

### Hole - Tapped

**Hole - Tapped (Metric)** and **(Inch)** do the same for a coarse thread chosen in Preferences, drawn as ISO 6410 shows threads.

### Slot

For a **Slot**, click each end, then click for its width.

### Hole Pattern

**Hole Pattern** places round, tapped or slotted holes (keys <kbd>3</kbd> to <kbd>5</kbd>) in rows and columns (key <kbd>1</kbd>) or round a bolt circle (key <kbd>2</kbd>).

### Screw Threads

**Screw Threads** draws an external thread from the side, simplified, schematic or detailed (keys <kbd>1</kbd> to <kbd>3</kbd>).

### Holes in 3D

Hole - Drilled and Hole - Tapped (Metric, Inch) - 3D place a real sweep of the hole, mouth at the layer's level and running down, for Subtract Solids ([3D modeling](3d-modeling.md)) to cut from a solid. The sweep sits beside its 2D drawing for plan, not grouped with it.

**Limits:** a tapped hole is its tap drill's size, with no thread.

## Machine Design calculators

These are in **Tools › Machine Design**.

### Belt Length and Chain Length

The **Belt Length** and **Chain Length** calculators work out a belt's or roller chain's length round two pulleys or sprockets, or the center distance a given length fits. Either can place its data as text on the drawing.

### Centroid…

**Centroid…** finds one closed 2D object's centroid, with a locus there if asked.

### Conversion Factors…

**Conversion Factors…** converts between 93 units of 13 quantities.

### Solution of Triangles…

**Solution of Triangles…** solves a triangle from three sides, two sides and an angle, or two angles and a side, with both answers where two triangles fit.

### Spring Calculator…

**Spring Calculator…** works out a compression spring's rate and unit stress from its diameters, wire and coils, and has the [Compression Spring 2](#compression-springs) tool ready to draw it.

### Create 3D Object From 2D

**Create 3D Object From 2D** makes the selected 2D machine parts' 3D versions, from the settings each part keeps in a 'Rodeo Machine Part' record.
