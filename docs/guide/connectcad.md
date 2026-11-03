# ConnectCAD: signal flow and racks

This page covers ConnectCAD: the schematic tools for devices, sockets, panels and circuits, the drawing commands that connect and check them, reports and cable lists, the layout tools for rooms, racks and equipment, cable routing, labels, and ConnectCAD Settings.

## Schematic tools

### Devices, sockets and circuits

With the **ConnectCAD Schematics** tools (**Device**, **Socket**, **Terminator**, **Connect**) and **Stage › ConnectCAD**, you:

- draw devices
- add input and output sockets down their sides
- connect them with circuits coloured by signal that keep to their sockets as devices move
- number cables by signal letter, source device or sequence, and clear them.

### Device Builder

With the **Device Builder** (ConnectCAD Schematics tool set), click where a device goes and describe it, with a preview: make and model, sizes, rack units, power and weight and rows of sockets. It's placed as a device and kept in your devices in this browser, to pick again by make and model.

### Device eyedropper

The **Device eyedropper** (ConnectCAD Schematics' Device tool) lets you **Pick Up** a device and **Apply** it to others, or to a selection:

- same-named sockets take its sockets' settings and places
- its other sockets are added
- they take its make, model, physical and location data
- their own sockets are kept or deleted as asked.

### Socket Loop

**Socket Loop** (ConnectCAD Schematics tool set) loops two inputs side by side so the signal passes through to the next device. The **Socket** and **Socket Loop** tools also place a whole row down a device's side in Linear Array.

### Adapter

With **Adapter** (ConnectCAD Schematics tool set), click a device's socket to put an adapter on it: a breakout's L and R or one socket of another connector. The socket's circuits move to it, and it follows its device. Dragged off, it shows a warning until dropped on another socket.

### External

**External** (ConnectCAD Schematics tool set) places the system's links to equipment outside it, one at a click or a numbered row in Linear Array, left or right facing, with as many circuits as asked in the Object Info palette. They connect, check and report like devices.

### Distribution Amplifier

**Distribution Amplifier** (ConnectCAD Schematics tool set) places video or audio DAs, one input (looped through if asked) to several outputs, one at a click or a numbered row. A click on a circuit puts the DA in it, splitting the circuit at its input and first output.

### Term Panel, Jackfield and Linked Jackfield

**Term Panel**, **Jackfield** and **Linked Jackfield** (ConnectCAD Schematics tool set) place one port of a panel at a click, or a row of them, named by panel (JA1) and numbered on. A term panel's port takes a circuit either way, and a click on a circuit puts the port in it.

### Connector Panel

**ConnectCAD Connector Panel** (ConnectCAD Schematics tool set) places input and output connectors of the custom panels at facilities boxes, named by their panel and port (CTP_BOX1, MIC01) and numbered on: singly or in a row, or in a circuit. **Edit Device Array** moves, renumbers and re-connectors several at once and gives them more circuits.

### HopOver

With **HopOver** (ConnectCAD Schematics tool set), click a line where another crosses it and it hops over the other in a half circle, up or down: a true arc in the polyline it becomes. A ConnectCAD circuit keeps its hop over the circuit crossing it, which follows as either moves, and a circuit selected first takes priority.

### ReRoute Circuits

With **ReRoute Circuits** (ConnectCAD Schematics tool set), the selected circuits follow the circuit clicked, bussed on its run with breakout nodes if asked, or a dragged distance apart so they run parallel.

### Legend

**Legend** (ConnectCAD Schematics tool set) draws a key to the signals on a schematic layer: each a sample of its circuit line in its colour, its name and how many circuits carry it. **Refresh Legend** reads the layer again.

## Drawing commands

### Connecting, checking and renumbering

The ConnectCAD drawing commands are in **Stage › ConnectCAD**:

- **Connect Selected** joins selected devices' facing sockets at once, or joins them to the device clicked.
- **Check Drawing** marks duplicate names and numbers, loose circuits and mismatched signals as markup in its own class.
- **Clear Markup**.
- **Renumber ConnectCAD Objects** names selected devices in order.

The ConnectCAD Status palette lists the same issues as you work, with buttons to zoom to each and to ignore it.

### Combine Panels and Split Panels

**Combine Panels** (**Stage › ConnectCAD**) makes the selected ports of one panel one device with a row each, and **Split Panels** makes a panel device a device a port, their circuits kept.

## Reports and lists

### Reports

The ConnectCAD reports (**Stage › ConnectCAD**) each come as a new worksheet (shown in a dialog in a drawing that has no worksheet yet):

- circuit reports for the active layer or every layer
- a device report with totals
- a device connections report
- a parts report.

### Cable lists

For ConnectCAD cable lists (**Stage › ConnectCAD**), a list is a worksheet, or a CSV or Excel file.

- **Convert Report to List** freezes a report as a list.
- **Compare Cable List and Drawing** marks numbers that differ and circuits missing from either.
- **Make Connections from List** draws the circuits a list has and the drawing hasn't.

### Devices from a list

To make ConnectCAD devices from a list, **Create Devices from Worksheet** (**Stage › ConnectCAD**) makes the quantity of each make and model a device list asks for, counting the drawing's own first and copying their sockets. Columns are assigned by heading, and the rest are kept in an Imported Device Data record.

### Labels

**Create Labels** (**Stage › ConnectCAD**, or Lighting Paperwork) makes label sheets from a worksheet report: a label a row on Avery sheets for cables, equipment, devices or lighting devices, with each cable's ends, a QR code and a colour-coded number.

- Edit the page and labels in Object Info.
- Edit what a label shows with Edit Label or the **Color-Coded Linked Text** and **Linked QR Code** tools.
- Export the pages to PDF.

## Layout and racks

### Layout Room

**ConnectCAD Layout Room** (ConnectCAD Layout tool set) draws a rectangle or polygon room with its Room ID, and a 3D wireframe unless 2D only. Nested rooms name their contents MAIN.AV1. **Create Objects from Shapes** makes them too.

The **Rack Ruler** now sits in this tool set.

### Equipment Rack 3D

**ConnectCAD Equipment Rack 3D** (ConnectCAD Layout tool set) draws 4-post and 2-post racks, consoles and enclosures in plan and 3D, with rails, side panels and doors.

- Overall sizes keep whole rack units.
- A rack takes its Room ID from the layout room it's in.
- It takes power and weight from the equipment and devices racked in it.

### Equipment Item

With **ConnectCAD Equipment Item** (ConnectCAD Layout tool set), click over a rack and equipment goes in at the first free unit, front or rear, full or half width. It moves with its rack, leaves it when dragged off, and keeps the schematic devices of its name up to date (make, model, size, location).

### Create Equipment

**ConnectCAD Create Equipment** (**Stage › ConnectCAD Layout**) makes equipment for each device name on the chosen layers, linked to its devices. It's placed in its rack at its unit (or below the rack), round its layout room's walls, or round the drawing. Missing locations are listed first.

### Rack Frame

**ConnectCAD Rack Frame** (ConnectCAD Layout tool set) puts a frame or tray in a rack with a grid of slots, power supplies at one side and a front door. Modular equipment goes into its first free slots and moves with the frame.

### Adapter Slot

With **ConnectCAD Adapter Slot** (ConnectCAD Layout tool set), click equipment to open its front or rear and place slots for plug-in modules, one at a time or in rows and blocks. Each one named for a socket of its device shows the adapter on that socket, in 3D, detail views and rack elevations.

### Rack equipment worksheet

With **ConnectCAD Make Rack Equipment Worksheet** (ConnectCAD Layout tool set), a click, a rack and the columns in your order, and a worksheet lists what's in the rack at each position from the top, its free units and totals.

### Rack elevations and equipment detail views

**ConnectCAD Create Rack Elevation** and **Create Equipment Detail View** draw front and rear views of the selected equipment racks (a row of them side by side in one view), or of single pieces of equipment at a detail scale, as viewports on a sheet layer. The equipment, frames and modules are named and the rack units numbered.

### Panel layouts

ConnectCAD panel layouts are drawn with these:

- **Create Panel View** draws the schematic's panel devices as rack-mount panels with their connectors tagged and the devices they link to written above.
- The **Panel Connector** tool places connectors one at a time or in lines and grids.
- A layout's **Panel Builder** lays out rows of connectors.
- **Create Schematic Devices** makes a device from a layout.

## Cable routing

### Cable paths and drop points

**ConnectCAD Cable Route** (a new tool set) draws cable paths at the cable heights you choose, rising and dropping where they change and joined into a network, and drop points where cables come out to equipment.

### Calculate Cable Lengths

With **ConnectCAD Calculate Cable Lengths** (**Stage › ConnectCAD**), circuits get a length from where their equipment stands in racks, with tails, swan-necks and the false floor. Ones it can't work out are marked on the drawing. **Calculate Cable Lengths** finds the shortest way through the cable paths.

### Analyze Cable Routes and Edit Cabling

With **ConnectCAD Analyze Cable Routes** and **Edit Cabling**, each cable path counts the circuits along it, and circuits that can't be routed are listed and can be marked.

**Edit Cabling**:

- lists the cables along a path or between two drop points
- shows a cable's route
- adds and deletes spare cables between drop points (pre-cabling, on a Spare Cabling layer)
- keeps a longer route for cables with **Select Alternative Route**.

### Cable Pull Report

**ConnectCAD Cable Pull Report** makes a worksheet of the cables to pull along each cable route, by cable type, with how many, the longest and the total length, and each type's totals.

### Riser and cabling sheets

**ConnectCAD Create Riser Sheet** and **Create Cabling Sheet** draw a plan viewport of the cable network on a sheet layer, either with its cable paths tagged with their Cable Count or with the cables between each two places drawn as arcs or home runs.

## ConnectCAD Settings

**ConnectCAD Settings** (**Stage › ConnectCAD**) holds a drawing's own:

- signals, connectors, cables and cable lengths
- its panel prefixes and sizes
- the numbering system Number Cables starts on
- number format for linear arrays
- automatic hopover, so crossing circuits hop each other as they're drawn.
