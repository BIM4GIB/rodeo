# Layers and classes

This page covers design layers, sheet layers, stories and classes: making and editing them, their options and visibility, the Organization dialog, and saved views.

## Layers

### Design and sheet layers

Create design and sheet layers, rename them, set sheet titles, visibility (visible / grayed / hidden) and scale, drag them to reorder, and delete them.

### Layer options

Layer options, as Vectorworks has them:

- **Active Only**
- **Gray Others**
- **Gray/Snap Others**
- **Show Others**
- **Show/Snap Others**
- **Show/Snap/Modify Others**

Only the /Snap ones let the pointer snap to other layers, and only the last selects on them. They are in **View › Layer Options**, the View bar, the Navigation palette and the drawing's right-click menu, keyed <kbd>⌥⌘3</kbd> to <kbd>⌥⌘8</kbd>.

### Layer scale

**Active Layer Scale…** (the right-click menu off any object) opens the Layer Scale dialog, with the usual architectural, engineering and metric scales or 1:n typed, for the active design layer or, with All Layers, every one.

### Layer elevation

A layer's objects rise and fall with its elevation. What Rodeo places on a design layer goes at its height above the layer plus the layer's elevation, as Vectorworks keeps it:

- a light, camera, extrude, imported model or symbol on the layer at its elevation and above
- a new wall, slab, plug-in object or Heliodon as high above the layer as the one it copies is above its own
- objects pasted or moved to a layer at another elevation as high above it as they were above theirs

A design layer's elevation and story are set in the [Organization dialog](#the-organization-dialog).

## Classes

### Creating and editing classes

Create, rename and delete classes (objects move to "None"), set their visibility, and use the same class options as the layer options (**View › Class Options**, keyed <kbd>⇧⌥⌘3</kbd> to <kbd>⇧⌥⌘8</kbd>).

### Class Style

Objects take their fill, pen colour, line style, weight and opacity from their class where the file says so (teal grid lines and bubbles, white counter tops, tag fills), and Object Info's "From class" ticks switch each one.

A hidden or grayed class hides or grays everything inside a plug-in or symbol of that class. A group's or wall's contents keep to their own classes, and None-class geometry inside a symbol or plug-in follows its container.

Pens set to None or weight 0 draw no outline, as Vectorworks prints them. Rounded rectangles draw, and text inside plug-ins (tags on turned objects) reads the right way up.

### Editing a class's attributes

In the Organization dialog's classes tab, **Edit…** (or a double-click) sets a class's:

- line weight, line style, pen and fill colours, fill style and opacities, which objects using the class style draw with
- RenderWorks texture, which objects textured by class show in 3D
- text style, which texts set to Class Text Style follow

### Classes from objects

**Activate Class** and **Create Class Using Object Attributes…** are on the right-click menu on an object, selected or not. The first makes the object's class the active class.

The second asks a name for a new class (with Edit properties after creation to change its attributes first), gives it the object's fill, pen, line style, weight and opacities, and puts the object in it taking them from the class. One undo step.

**Update Class Attributes from Object…** (the same menu) gives a class already there the object's fill, line style, pen colour, line weight or opacity, those ticked, and with Assign puts the object in the class taking them from it. One undo step.

## Visibility

### Visibility lists

The View bar's layer and class visibility lists show each design layer or class as visible, grayed or hidden. They are searchable, a column head sets every listed row, and each change is one undo step.

### The Visibility tool

The **Visibility** tool (Basic tool set): click an object to show, gray or hide its class (1) or its layer (2): Show 3, Gray 4, Hide 5.

Option-click sets every other class or design layer instead, which leaves the one clicked alone on screen when hiding. The active layer stays shown. Each click is one undo step.

## The Organization dialog

**Tools › Organization…** (<kbd>⇧⌘O</kbd>) lists the classes, design layers and sheet layers on three tabs. Each is a dense searchable table of:

- visibility (a column head sets every listed row)
- name
- a design layer's scale or a sheet's title
- the object count

The tabs have New, Delete and the design layers' stacking order (**Move Up**, **Move Down**), and **Edit…** (or a double-click) for a class's attributes (see [Editing a class's attributes](#editing-a-classs-attributes)). Design layers also have their elevation and story there.

A fourth tab lists every viewport with its sheet, kind, and name and scale to edit.

Nothing changes until OK, which applies it all as one undo step.

### Stories and levels

A Stories tab names, suffixes, raises, adds and deletes the stories (a story's layers move with its elevation).

Its **Levels…** sets a story's levels: each a level type, an elevation above the story and the design layer at it, which sits at the story's elevation plus the level's. Levels can be added and removed.

The Navigation palette's Stories tab does the same with its **Edit…**, where each story's layers and levels are listed under it.

### Saved views tab

A fifth tab adds the current view, renames, deletes and reorders the saved views and sets which restore visibility. They are kept in the browser, outside the undo step.

## Duplicating layers and classes

**Duplicate** is on the right-click menu on a layer or class in the Navigation palette, and a button in the Organization dialog:

- A layer comes with its scale, elevation, view or page and a copy of everything on it, just after it in the stacking order.
- A class comes with its attributes, texture, text style and visibility.

The copy is made active, with its name ready to edit.

## Saved views

Saved views save the zoom, active layer and class, layer/class options and visibilities, and restore them per file. The View bar holds them.

**View › Save View…** names the current view and whether opening it restores layer and class visibility.

## Class and Layer Mapping

**Class and Layer Mapping** (Tools menu) gives each class and design layer the name it's to have:

- a new name renames it
- another's name merges it with that one
- a blank deletes it with its objects

Vectorworks' mapping files load and save.

To rename many classes, layers or stories at once, see Batch Rename in [The workspace](workspace.md#batch-rename).
