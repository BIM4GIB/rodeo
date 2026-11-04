# Stage, lighting and rigging

This page covers the Stage menu for lighting and theatre set design, the Event Design and Rigging tool sets, lighting devices and their paperwork, and photometrics and cameras.

## The Stage menu

The Stage menu holds lighting design and theatre set design, from venue to paperwork, kept in the drawing. Its commands and submenus:

- **New Venue…**, **Linesets…** and **Lighting Section…**
- **Sightlines** (**Audience…**, **Seat Coverage Map**, **Masking Solver…**, **Seating Rake Solver…**)
- **Scenes** (a palette of scenes to go to and scrub through with collision warnings, **Shift Plot…**, **Spike Sheet…**)
- **Scene Shop** (**New Flat…**, **New Platform…**, **Cut List…**, **Model Box Cut Sheet…**)
- **Lighting** (**Show Beam Pools**, **Light Coverage Map…**, **Wash Planner…**, **Looks**, **Show Beams in 3D**, **Gel and Paint Matrix…**, **DMX Patch…**)
- **Lighting Paperwork** (**Paperwork…**, **Patch…**, **USITT ASCII and MVR**, **Focus Cards…**, **Magic Sheet…**, and **Inventory and Equipment List…**, which sets the equipment in the drawing against vendors' and venues' inventories)
- **Loads and Power** (**Load Check…**, **Power Balance…**)
- **Visualization**:
  - **Manage Scenes…** saves and recalls every lighting device's color, position and focus with the channel levels.
  - **Animate Scenes…** makes a movie of the fade from one scene to another.
  - **Set Spotlight Rendering Options…** sets the shadows, lit fog, sky and light levels for a lit stage in one place.
- **Show Audit…**

**Limits:** light and load figures are estimates for planning.

### The Theatre tool set

The Theatre tool set has **Stage Origin**, **Focus Instrument** and **Spike Mark**.

## Event design

These tools are in the Event Design tool set, and the commands in the Stage › Event menu.

### Stage Deck, Stage Plug, Stage Steps, Stage Ramp and Rope and Stanchion

Click to place a deck (its middle on the point) or steps or a ramp (the middle of their top on the point), a press dragged turning them.

- **Stage Deck**: rectangular or round decks with railings on the sides chosen and their legs at the Reference Spacing.
- **Stage Plug**: click a plug's outline.
- **Stage Steps**: treads, stringers, railings and an UP or DN arrow.
- **Stage Ramp**: a ramp's run from its rise and pitch.
- **Rope and Stanchion**: click a barrier's path, for stanchions along the path with belts, ropes or chains between.

Plain objects in plan, grouped.

### Soft Goods, Television, Video Screen and LED Screen

- **Soft Goods**: click a path for a pleated curtain or border (its opening, pipe, track and drape breaks) or a pipe-and-drape run on uprights and base plates.
- **Television**, **Video Screen** and **LED Screen**: click to place a television, a screen with its frame, support and projector, or a row of LED modules on their base structure, a press dragged turning them to face the pointer, with the coverage zone viewers can see a screen from.

Plain objects in plan, grouped.

### Blended Screen

**Blended Screen** places a wide video screen with the projectors that share its image, as many overlapping areas as cover it at their aspect, each projector its throw away with its cone, or the screen alone (key <kbd>1</kbd>). Plain objects in plan, grouped.

### Create Stage, Create Stair and Create Screen

- **Stage › Event › Create Stage**: lay a selected shape with standard stage decks, the pieces its edge cuts as smaller decks or stage plugs, each standing in 3D to the stage height (a block, or a top on legs, fewer where neighbours meet).
- **Create Stair**: click where steps meet the stage and the way they come down, fitted to the stage's height.
- **Create Screen**: pick a projection screen, LED screen or television and click it in place.

### Create Lectern

1. Choose **Stage › Event › Create Lectern** and pick one of five lecterns in a dialog that shows it from the front, the side and above.
2. Click where it stands.
3. Click the way it faces the audience.

It's a hybrid symbol of the lectern's name, made once and placed again. Custom Attributes makes a new symbol coloured by a class or with its own fill, pen and texture. Over a stage built in 3D (as Create Stage builds one) it stands on the stage's top.

### Create Room and Create Views

- **Stage › Event › Create Room**: walls round a selected shape (the room's inside), plain or in one of the drawing's wall styles, mitred at the corners, on a floor.
- **Create Views** then makes a Plan View sheet with a plan viewport and a Rendered View sheet with a Shaded isometric picture of the model (taken when the command runs).

### Speaker Array

With **Speaker Array**, click to place a bumper with up to three kinds of line-array box hung under it, each splayed down from the one above; a press dragged turns it. It shows:

- its Column ID
- rigging guides for one or two hoists
- the widest spread's dispersion lines
- a tick where each box aims at the listening plane, and the coverage they share there

Plain objects in plan, grouped.

### Rack Ruler

With **Rack Ruler**, click beside an equipment rack and toward its top for a ruler numbered in rack units, a tick at each, with their heights in the drawing's units every five. Plain objects, grouped.

## Rigging

These tools are in the Rigging tool set.

### Truss, pipes, rigging points and hoists

- **Straight Truss**: drag a box, triangle or ladder truss in its sections (a short last one red).
- **Curved Truss**: place a curved one round a point.
- **Lighting Pipe**: click a pipe's path with its end markers and tick marks.
- **Lighting Pipe Ladder**: drag a ladder flat or standing.
- **House Rigging Point** and **Hoist**: place a rigging point or a hoist with its ID and X/Y label.

Plain objects in plan, grouped.

### Hoist Origin

With **Hoist Origin**, click to place a named hoist origin. A hoist whose Origin names it measures its X/Y label from it.

### Bridle and Mother Grid

- **Bridle**: click a two leg, three leg or reversed bridle's connection and legs, each leg labelled with its length and angle from the bridle's heights.
- **Mother Grid**: click a mother grid's truss between two hoists, a third hoist at its connection.

Plain objects in plan, grouped.

### Rigging Load

With **Rigging Load**, click where a point load hangs, a drag along the rigging turning its label across or 45° to it, or click a distributed load's path.

Weights are in lb or kg; a distributed load takes its weight per foot or metre (500/10 spreads 500 over 10 units) or its total. It's labelled with its weights and length. Plain objects in plan, grouped.

### Cable Path and Cable

Click a **Cable Path**'s corners, sharp or rounded by its fillet radius. A **Cable** clicked onto a path:

- follows it to the point nearest the next click
- is sized into the fewest stock cable parts, with a connector mark where each meets the next
- is labelled with its run ID and length

Plain objects in plan, the cable grouped.

### Distributor and Electrical Component

- **Distributor**: click a power distributor's rectangle with its outputs numbered along it, its ID counting on and an optional output length circle.
- **Electrical Component**: a power source, input, overcurrent protector, output or consumer glyph.

Plain objects, grouped.

## Lighting devices

The tools here are in the Rigging tool set, and the commands in **Stage › Lighting**.

### Lighting Device

With the **Lighting Device** tool, click where one of 22 generic instruments hangs, then where it focuses. Its channel, unit number, colour and purpose are labelled round it; Automatic Numbering counts unit numbers and channels on by their increments.

It shows generic outlines, or any symbol in the drawing (Symbol in Object Info), rather than library symbols. It's a plug-in object that Object Info edits and the Stage menu reads.

### Convert To Lighting Device and Replace Lighting Devices

- **Stage › Lighting › Convert To Lighting Device** turns selected symbols into lighting devices that show them, aimed as they were turned.
- **Stage › Lighting › Replace Lighting Devices** swaps selected devices, or all of them, for another generic type or one of the drawing's symbols, keeping their data.

### Hanging Position

**Hanging Position** is both a Rigging tool and a Stage › Lighting command. Select pipes, trusses or any geometry and use **Convert to Hanging Position**, or place a position showing a symbol with the tool.

It's named, and its devices take the name. Object Info:

- renames them
- sets their trim
- numbers them with Auto Number
- inserts a summary of what hangs on it

The Lighting Device tool outlines the position it's over and hangs a new device on it. **Stage › Lighting › Auto Number Positions** numbers them all.

**Limits:** moving a position doesn't carry its devices, but **Select Lighting Devices** picks them to move together.

### A lighting device's right-click menu

- select the devices of its type, at its position, or its hanging position
- take it off its position
- swap two selected devices: each takes the other's place, unit number and position, and its circuit, dimmer and patch unless they're ticked to move with it
- **Refresh Lighting Devices** (<kbd>⌘/</kbd>)

A hanging position's right-click menu selects the devices on it.

### Lighting Accessory

With **Lighting Accessory**, click a lighting device to add barn doors, a top hat, a color scroller or one of 9 other generic accessories, or use Apply to Selection for all the selected devices. The device draws it in plan and carries its weight; Remove takes it off.

### Focus Point

With **Focus Point**, a click names and places a focus point, an octagon or locus with its name. Plain objects in plan.

### Focus Lighting Devices Along Path

With the **Focus Lighting Devices Along Path** tool, select some lighting devices, then click a shape or draw a path. Each beam lands on the closest point or is spaced evenly along it, previewed as you go. Preferences can mark each spot with a focus point.

### Ganging

With **Ganging**, click two or more lighting devices, the last with a double-click or <kbd>Enter</kbd>, then where the two-fer's label goes. It draws a line from each device to one joining line, square, rounded or curved at its outer corners, labelled with the shared channel, dimmer or circuit, in a circle if wanted. Plain objects, grouped.

### Align and Distribute

With the **Align and Distribute** tool and lighting devices or other objects selected, click a guide line and they move onto it:

- aligned square onto it
- distributed evenly between its ends
- evenly inside them
- at an interval from its start

### Label legends

In **Stage › Lighting**, **Label Legend Manager** and **Assign Legend to Lighting Devices** handle label legends. A legend picks:

- which fields a device shows (15 of them)
- where round it
- in which container
- right-reading or turning with it
- at what size

The active one goes on new devices, and Use Legend in Object Info changes one device's. **Create Label Legend from Lighting Device** makes a new legend from one device's labels.

## Lighting paperwork and data

### Spotlight Numbering

**Spotlight Numbering**, in **Stage › Lighting** and **Stage › ConnectCAD**, numbers lighting devices, or any plug-in object or record, in one or more fields at once: unit numbers, channels, DMX addresses by footprint into the next universe, with prefixes, letters, steps and limits.

Selected objects are numbered left to right, top to bottom or zigzag; with none selected, click them one by one.

### Equipment Summary Key

With the **Equipment Summary Key** tool (Rigging tool set), click to place a table of the lighting devices and plug-in objects in the drawing with their counts, and if you like the gels, gobos and circuits in use. Filter it to one position in Object Info, choose what it lists with Items and Elements, and click Refresh after changes.

### Lighting device data

**File › Export › Export Lighting Device Data…** writes every instrument's fields as tab-delimited text for Lightwright or a spreadsheet, UID first, choosing the fields with All, User, None and saved sets.

**File › Import › Import Lighting Device Data…** reads such a file (or CSV, or an Excel sheet) back:

1. Pick the Unique ID Field.
2. AutoLink or link the columns.

The matched instruments update in one undo step. Rows that match none come in as new instruments below the drawing.

### Export ASCII Patch

**File › Export › Export ASCII Patch…** writes the patch as a USITT ASCII file that lighting consoles import. Choose whether the console clears its existing patch first.

Each device goes from its channel to its Dimmer, or to its DMX address when the Dimmer isn't a number. A device of several channels is patched one after another: channel 6 on dimmer 20 with 4 channels patches 6 to 20, 7 to 21, 8 to 22 and 9 to 23. Devices with no channel number are left out, and the message names them.

## Photometrics and cameras

### Photometer and Photometric Grid

With **Photometer** and **Photometric Grid** (Rigging tool set), click where the light should be read, or three clicks for a grid. Each point shows its footcandles or lux from every instrument, coloured by thresholds you set. A grid can tilt for a raked stage. Click Refresh after moving a light.

**Limits:** it uses Rodeo's own beam model, not photometric files, so treat the numbers as estimates.

### Video Camera

With **Video Camera** (Visualization tool set), click where it stands and click the way it faces. Object Info sets:

- its lens and focal length (or angle of view)
- camera body
- format
- pan, tilt and roll
- stand and height
- how its field of view shows in plan

Activate Camera (or a double-click) looks through it in 3D; Aim Camera pans it toward your next click.

**Limits:** its lenses and bodies are Rodeo's generic ones.
