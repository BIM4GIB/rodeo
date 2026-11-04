# Files: opening, saving and tabs

This page covers opening and saving drawings, autosave, working with several drawings in tabs, starting new drawings and templates, and a drawing's units and file information. Bringing in other formats is covered in [Importing, exporting and printing](import-export.md).

## Opening and saving

### Open, Save and Open Recent

Open a `.vwx` file with **Open** or by dropping it on the window. **Open** also opens DWG files and Revit and Archicad projects as new drawings, as described in [Importing, exporting and printing](import-export.md). **Save** writes back to the same file where the browser allows it (Chrome/Edge File System Access API); otherwise it downloads a copy.

**File › Open Recent** lists the drawings opened or saved that way (the browser keeps their file handles, not the drawings). **File › Revert** reopens the saved file.

Edits made while a save or download is being prepared remain unsaved; save again to include them. A file whose settings extend beyond its available bytes is refused when opening.

### Saving shared drawings

A cloud upload that started outside the live session is refused if live edits arrive while it is uploading. Reopen the cloud drawing to see those edits before saving again.

If a shared edit cannot be applied, collaboration stops and asks you to keep a copy of your work and reopen the cloud drawing.

### Save a Copy As… and Save All

**File › Save a Copy As…** writes the drawing as it stands to a new file, while the window goes on working on its own.

**File › Save All** saves every open drawing with unsaved changes, asking where for one never saved.

### Autosave

While a drawing has unsaved changes, its own copy is kept in the browser every 5 minutes, including when another drawing tab is in front. Saving or explicitly discarding one drawing removes only its copy. **Edit › Preferences…** sets how often, or turns it off.

After a crash or a closed browser tab, Rodeo offers each kept drawing separately. **Open Copy** opens it in a drawing tab with unsaved changes; save it to keep those changes. Copies belonging to another open browser window are left alone. Older backups from before separate copies were supported can still be recovered.

**Limits:** drawings over 150 MB, and drawings with parts still held in another file, are not copied. Writing a copy takes as much memory again. If browser storage is full or blocked, the copy is tried again at the next interval. Some browsers may offer a copy that is still open elsewhere; in that case, its original backup is kept.

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
