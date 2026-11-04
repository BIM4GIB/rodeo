# Symbols and plug-in objects

This page covers symbols, the Resources panel that holds them with the drawing's other resources, plug-in objects such as doors, windows and title blocks, the data records attached to objects, and the textures set on an object's parts.

## Symbols

### Placing a symbol

Resources lists the file's symbol definitions by folder with previews and search. Pick one and the **Symbol** tool (<kbd>K</kbd>) places it with a live preview, with a click or (Click and Rotate) a click and then a second click for its rotation, Shift in 15° steps.

### Symbol instances

Instances are drawn through their placement matrix and can be moved, rotated and mirrored. Object Info shows the definition and replaces it with another.

### Create Symbol…

**Modify › Create Symbol…** turns the selection into a new definition and puts an instance in its place.

**Symbols in new drawings.** Create Symbol and the rest of the symbol commands now work in a blank drawing, where they used to refuse for lack of a symbol to copy from.

**Limits:** these symbols haven't been opened in Vectorworks yet.

### Editing a symbol

**Modify › Edit Symbol** (or double-click an instance, or **Edit Symbol** on its Resources tile) opens the definition in place of the layers, at its insertion point, for every tool to edit. Each change reaches every instance and undoes as usual.

**Exit Symbol** (the bar over the drawing, Modify, or <kbd>⌘]</kbd>) goes back to the layer and view it came from.

## Resources

### Locating a resource from the drawing

Right-click an object on the drawing for **Locate Symbol** (or Hatch, Gradient, Tile, Image Fill, Line Type, Text Style, Worksheet, Texture) in Resource Manager: one row for each resource it uses, which shows Resources with that tile selected and scrolled to. A symbol becomes the one the Symbol tool places, without switching tools.

### Renaming, duplicating and deleting

Right-click a tile in Resources to rename any resource, to duplicate or delete a symbol definition, or to delete a worksheet or a data record format (its records going from the objects that have one).

**Limits:**

- A definition, worksheet, hatch, gradient, line type or text style still in use somewhere isn't deleted.
- A resource whose name other records hold as text (plug-in parameters, worksheet formulas, data visualizations) or a plug-in's parameter format isn't renamed or deleted, since those would not follow.

### Hatches

Hatches are edited in Resources too (**Edit Hatch…**, or a double-click on the tile):

- the ground colour
- whether the sizes are on the printed page or in the world
- the levels of parallel lines with their angle, spacing, shift along the line, dash, start point, colour and weight

A preview follows each change. **New Hatch…**, **Duplicate…** and **Delete…** sit beside it.

### Gradients, line types and text styles

These are edited the same way:

- **Gradients:** their stops' position, colour, opacity and midpoint.
- **Line types:** dash and gap lengths on the printed page.
- **Text styles:** font, size in points and alignment, with a sample line. Editing one restyles the texts that follow it, by name or through their class, keeping a size they set apart in proportion.

### New resources

The panel's + button makes a new hatch, gradient, line type, text style or record format. A drawing with no gradient or text style yet gets its first from a hatch's frame.

### Importing resources from another file

The + button's **Import from Another File…** (or **File › Import Resources…**) lists another .vwx file's symbols, textures, hatches, gradients, simple line types, text styles and data record formats to tick. One whose name the drawing already uses comes in as Name-2, replaces the drawing's own of that kind (a replaced symbol's instances draw its new contents), or stays out, as chosen.

- **A symbol** brings the symbols nested in it and the classes, line types, hatches, gradients, text styles, record formats and textures (those its 3D objects show) it uses that the drawing lacks. The drawing's own of the same name are used as they are.
- **A texture** brings its shaders' images and settings and the shader record formats the drawing lacks (one it has must hold the same kinds of field in the same places).
- **A record format** that replaces the drawing's keeps the values of the fields both have, of the same kind, in the records already attached.

Colours are matched to the drawing's palette (the nearest when it lacks one), previews are drawn anew, and the imports are one undo step.

**Limits:**

- Symbols holding plug-in objects are listed with the reason they can't come in yet.
- A record format with fields a new format can't have yet (choice fields, say) is listed with the reason.

## Plug-in objects

### How plug-in objects draw

Plug-in objects (doors, windows, title blocks, spaces, grids, plants…) draw their cached 2D geometry placed by their own matrix, and can be moved.

As in Top/Plan, one that has a 2D drawing shows only that, not its 3D parts (a cabinet's footprint, not its panels, nor the hinge markers doors keep on their leaves for elevations). 3D solids elsewhere draw as wireframe (an extrude's profile placed by the extrude's own frame, where its body starts; a 3D polygon as its outline seen from above), and open polygons and polylines with a fill are filled.

### Parameters in Object Info

Object Info lists a plug-in's parameters and any data records attached to an object (text, numbers, dimensions, choices, checkboxes) and edits them.

### Plug-in Insertion tool

The **Plug-in Insertion** tool (the Insertion tool set) places plug-in objects of any kind the drawing has on its design layers (columns and beams, plants, cabinets, stairs, grid axes, railings, spaces…). Press where its insertion point goes and drag to turn it (Shift in 15° steps), or click to keep the turn of the one it copies. Preferences picks the kind.

The copy keeps that object's class, parameters and drawing, since Rodeo can't redraw a plug-in from its parameters.

**Limits:** tags, section lines, cameras and Heliodons (their own tools place them), site models and design layer viewports aren't offered.

### Title Block Manager

**File › Title Block Manager…** edits the title blocks' data: project data on all of them, sheet data on the sheets ticked (several at once, differing values shown as Varies). Their drawn text follows where it shows a value exactly, and Sheet Number and Sheet Title rename the sheet, all in one undo step.

**Limits:** revision data isn't edited yet.

### Duplicate on Layers

Right-click a title block border and choose **Duplicate on Layers…** to copy it to other layers. The dialog lists every layer that has no title block border yet. Tick the ones to copy it to, or use **Select/Deselect All**. Each copy lands where the original stands. On a sheet layer, the copy's Sheet Number and Sheet Title become that sheet's.

**Limits:** it works on title block borders from Vectorworks files, not on the borders Rodeo's own Title Block Border tool draws. Sheet data is always filled in, whatever the border's own setting.

## Data records

### Attaching and detaching records

Object Info's Data tab attaches a record of any of the document's data record formats (holding the format's default values) and detaches one.

**Tools › Records › Attach Record…** attaches one to every selected object without it, in one undo step, and **Detach Record…** takes a format's records off them.

### Change One Field… and Change All Fields…

**Change One Field…** and **Change All Fields…** set a record's values on the symbol definitions in a symbol folder, at the top level or everywhere, which symbols placed afterwards start with.

### Merge Record Formats… and Split Record Format…

**Merge Record Formats…** puts one format's fields on the end of another's, the objects' values going with them, and deletes the first.

**Split Record Format…** moves the fields ticked to a new format, every object with the source format's record gaining one of the new format with its values.

### Modify by Record…

**Modify by Record…** reads a field's number on each object (across the drawing or the selection, in groups if asked) and, in one undo step:

- colours the objects by it (along a gradient, by ranges or by value, on the fill's or pen's colours)
- scales them by it
- extrudes them that high or raises polygons to 3D polygons at it

### Making and editing record formats

**Tools › Records** makes new data record formats and edits them (also from a format's Resources tile): fields of text, integers, numbers, dimensions and checkboxes with their defaults, added, renamed, moved and removed. The objects' records keep their values in the fields kept.

## Textures on objects

### Render tab

Object Info's Render tab lists an object's texture parts (the whole object, and by number the further parts walls, slabs, solids and some plug-ins hold). It sets each one's texture (none, the class's or one of the drawing's) and its offset, scale and rotation. A 3D object without parts takes a texture on the whole of it.

### Texture commands

Right-clicking a part's heading there, or a textured object in the drawing (every textured part of it), gives these, each one undo step:

- **Rotate Texture by 90°**
- **Reset to Default Mapping** (no offset, scale 1, no rotation)
- **Remove Texture Override** (None; from the drawing, the whole object's texture only)

The heading's menu also folds or opens every part (**Expand All**, **Collapse All**).
