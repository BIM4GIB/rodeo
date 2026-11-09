# Files: opening, saving and tabs

This page covers opening and saving drawings, autosave, working with several drawings in tabs, starting new drawings and templates, and a drawing's units and file information, sharing and embedding drawings. Bringing in other formats is covered in [Importing, exporting and printing](import-export.md).

## Opening and saving

### Open, Save and Open Recent

Open a `.vwx` file with **Open** or by dropping it on the window. **Open** also opens DWG files and Revit and Archicad projects as new drawings, as described in [Importing, exporting and printing](import-export.md). **Save** writes back to the same file where the browser allows it (Chrome/Edge File System Access API); otherwise it downloads a copy.

Files saved by Vectorworks 2018 or later open as they are. A file saved by Vectorworks 2013 opens converted to the current format, its 2D only: lines, shapes, text, symbols, plug-in objects as drawn, layers, sheets and classes. Its 3D objects, images, worksheets, textures and plug-ins' data come in empty or are left out, and **Save** asks where to write, so the 2013 file stays as it was. Files from Vectorworks 2014 to 2017 are untested, and older ones are refused with the year they were saved in.

**File › Open Recent** lists the drawings opened or saved that way (the browser keeps their file handles, not the drawings). **File › Revert** reopens the saved file.

### Save a Copy As… and Save All

**File › Save a Copy As…** writes the drawing as it stands to a new file, while the window goes on working on its own.

**File › Save All** saves every open drawing with unsaved changes, asking where for one never saved.

### Autosave

While a drawing has unsaved changes, a copy is kept in the browser every 5 minutes, and offered back when Rodeo starts after a crash or a closed tab. **Edit › Preferences…** sets how often, or turns it off.

**Limits:** drawings over 150 MB are not copied, since writing one out takes as much memory again.

### Restore a cloud version

**File › Version History** lists the saved versions of a cloud drawing. Choose **Restore** on an older version to make a new current version from it. Once the restore succeeds, everyone in the live session reloads that version.

If the restore is refused because there is no room on the owner's plan, or the server cannot save it, the current version and pending live edits stay intact. Make room or resolve the error before trying again.

## Sharing and embedding

### Editing together

A cloud drawing shared with editors is edited live: everyone's changes, and their agents', show as they are made. Changes to different things all stand, wherever they are in the drawing, so an agent can build while you move things elsewhere. Two people or agents adding classes, symbols or names at the same moment both keep theirs. A class both add under one name becomes one class holding what each put in it; a name both give to different things gets "(2)" on the later one.

Only two changes to the same thing at the same moment clash, such as two renames of one class: the later one is undone, with a message saying so.

**Limits:** when a change of yours is made again because someone else's came first, Undo can't take it back, nor what you did before it. A Rodeo page open since before an update stops editing live and asks to be reloaded.

### Share links

**File › Share › People and Links…** on a cloud drawing you own or edit makes public view-only links. Anyone with the link sees the drawing in 2D and 3D in their browser without an account. With **Allow download** they can also download it, or **Edit a Copy** as a drawing of their own. Pasted into Slack, Discord, iMessage, X or LinkedIn, a link shows the drawing's name, who shared it and a picture of it. **Revoke** turns a link off at once.

### Previews

Each link has a still picture and, when its embed starts in 3D, a turning one. Rodeo makes them from what you see the first time a link's panel opens with the drawing open, or when you press **Make Preview**; **Update Preview** makes them again after the drawing changes, and the dialog says when it has.

### Embedding a drawing

Under a link, **Embed and preview** sets how an embed starts: in 2D or 3D, on a layer or sheet, fitted or from the view you see now, turning slowly, light or dark, and with full, minimal or no controls. Copy the **Embed** code (an iframe) into a web page, the **Web component** (`<rodeo-viewer>`, which sizes itself to the page), the **Viewer link** for Notion's /embed block, or **Markdown** (a picture that opens the drawing, for READMEs). An embed has 2D and 3D, Fit, Turn, Full screen and **Open in Rodeo**, and works on phones.

### Opening a file from a web address

`https://rodeo.build/?url=` followed by a file's address opens a public drawing in any format Rodeo reads, such as `https://rodeo.build/?url=https://github.com/you/house/blob/main/house.vwx`. `https://rodeo.build/?embed&url=…` shows it in an embed. Your browser fetches the file, not Rodeo's server, so the site must allow it, as raw files on GitHub do.

**Limits:** previews don't update by themselves when the drawing changes. An embed loads the whole editor, so its picture shows first and the drawing a few seconds later. In 2D an embed pans and zooms but doesn't select. WordPress needs a plug-in that allows Rodeo's embeds, and Notion and Medium show a link card until they list Rodeo as a provider. Files opened from an address must be under 300 MB, and nothing an embed changes is saved.

## Tabs

Each drawing opened goes in a tab of its own, so you can work on several at once. A strip of tabs shows over the drawing while one is open, and each comes back to the front as it was left (layer, class, selection, view and undo). A dot on a tab means unsaved changes.

- The **+** at the end of the strip starts a new drawing, or opens one (**New Drawing**, **New from Template…**, **Open…**, **Open Recent**).
- A click brings a tab to the front; a middle-click closes it; <kbd>←</kbd> and <kbd>→</kbd> move between tabs once one has the focus.
- **File › Close** or a tab's × closes one, asking first about unsaved changes, and about an agent at work in it.
- **File › Close All** closes them all (Cancel on one stops there).
- **Window › Drawings** lists them.
- **Window › Show Document Tabs** hides the strip.
- **Window › Home Screen** brings the start screen back over the drawing (Back to drawing or <kbd>Esc</kbd> returns).

Each drawing has an agent of its own in the Agents panel, and they work at the same time: see [The Agents panel](workspace.md#the-agents-panel). A tab shows what its agent is doing: a spinner while it works, an amber pause when it is waiting for the tab to come to the front, and a spark when it finished while you were in another tab (red if it stopped with an error).

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

## The Gallery

### Publish to Gallery…

**File › Share › Publish to Gallery…** puts a cloud drawing in the public gallery at [rodeo.build/gallery](https://rodeo.build/gallery). Only the drawing's owner can publish it; a drawing that isn't in the cloud asks to be saved there first.

Give it a title, a description, up to six tags and the name to credit, choose a licence (CC BY 4.0 unless you choose CC BY-SA 4.0, CC BY-NC 4.0 or CC0) and a cover: the drawing, or the 3D view as it is on screen.

The gallery shows a snapshot of the version you publish, saved first if it has unsaved changes. Later changes stay private until you open the dialog again and choose **Publish This Version**. The same dialog changes the details, replaces the cover or unpublishes it.

Everything in the published version is public, hidden layers and classes too. Earlier versions, comments and the people you share the drawing with stay private.

### Browsing and forking

Anyone can browse the gallery without an account: search, pick a tag, and sort by Trending, Newest or Most forked. A drawing's page has a viewer (**Look round**), **Open in Rodeo** and **Download .vwx**.

**Fork** copies the drawing into your cloud drawings (signing in first if needed) and opens it. The original doesn't change. Your copy keeps its credit: the top bar shows **Fork of** and the original's title, and its credit and licence on hover. If you publish your fork, it can only use a licence the original's allows, and it shows in the original's remixes.

### Unpublishing and reporting

Unpublish from the dialog or the drawing's gallery page. Its page goes at once; forks people have already made stay theirs, with their credit. Deleting the drawing or your account unpublishes it too.

**Report this drawing** on a gallery page sends it to Rodeo's admins. A drawing that several people report is taken out of the gallery until an admin looks.

**Limits:** drawings over 100 MB can't be published. Forks count towards your plan's drawings and storage. Only the owner is credited, not others who edited the drawing.
