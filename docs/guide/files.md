# Files: opening, saving and tabs

This page covers opening and saving drawings, autosave, working with several drawings in tabs, starting new drawings and templates, and a drawing's units and file information. Bringing in other formats is covered in [Importing, exporting and printing](import-export.md).

## Opening and saving

### Open, Save and Open Recent

Open a `.vwx` file with **Open** or by dropping it on the window. **Open** also opens DWG files and Revit and Archicad projects as new drawings, as described in [Importing, exporting and printing](import-export.md). **Save** writes back to the same file where the browser allows it (Chrome/Edge File System Access API); otherwise it downloads a copy.

If opening or saving stops with a drawing-worker error, try the command again. When this happens during a save, the previous file stays unchanged and your edits stay unsaved; keep the drawing open until a save succeeds.

**File › Open Recent** lists the drawings opened or saved that way (the browser keeps their file handles, not the drawings). **File › Revert** reopens the saved file.

### Save a Copy As… and Save All

**File › Save a Copy As…** writes the drawing as it stands to a new file, while the window goes on working on its own.

**File › Save All** saves every open drawing with unsaved changes, asking where for one never saved.

### Autosave

While a drawing has unsaved changes, a copy is kept in the browser every 5 minutes, and offered back when Rodeo starts after a crash or a closed tab. **Edit › Preferences…** sets how often, or turns it off.

**Limits:** drawings over 150 MB are not copied, since writing one out takes as much memory again.

## Tabs

Each drawing opened goes in a tab of its own. Once two are open, a strip of tabs shows over the drawing, and each comes back to the front as it was left (layer, class, selection, view and undo).

- **File › Close** or a tab's × closes one, asking first about unsaved changes.
- **File › Close All** closes them all (Cancel on one stops there).
- **Window › Drawings** lists them.
- **Window › Show Document Tabs** hides the strip.
- **Window › Home Screen** brings the start screen back over the drawing (Back to drawing or <kbd>Esc</kbd> returns).

## New drawings and templates

### New

**File › New** (New drawing on the start screen) starts a blank drawing, "Untitled 1": one design layer and the class None, in feet and inches where the browser's region measures in them and millimetres elsewhere (**File › Document Settings › Units** changes that).

Its lines, rectangles, polygons, polylines, arcs, text and groups are written from Rodeo's own records rather than copied from the drawing.

**Limits:** whether Vectorworks opens a drawing started this way is not yet confirmed.

### New from Template…

**File › New from Template…** opens a Vectorworks template (`.sta`, or any `.vwx`) as a new drawing in the same way, leaving the template as it was. **Save** asks where the new drawing goes.

### Save as Template…

**File › Save as Template…** writes the drawing as a `.sta` for that (**New from Template…**), while the window goes on working on its own file.

## Units and file information

### Units

**File › Document Settings › Units…** sets the length unit, from millimetres to miles or feet and inches, with its area and volume units. Nothing moves: lengths show and are typed in the new unit.

### File Info

**File › File Info…** lists the open file's name, size, the Vectorworks versions and build it names, its units and what it holds.
