# Branches, compare and merge

Branches let you try a change to a cloud drawing without touching it, see exactly what changed, and merge it back. They work on drawings saved to the cloud; everyone who has the drawing has the same role on its branches.

## Branches

### New Branch…

**File › Branches › New Branch…** starts a branch from Main's latest saved version, or from the latest version of the branch you're on, named as you like. Rodeo saves your changes first. The branch opens in a tab of its own and its name shows beside the drawing's name. A branch is a drawing like any other: it saves, keeps versions, and can be edited live with others.

A branch started from another branch carries that branch's work too when it is merged into Main.

### Switch Branch

**File › Branches › Switch Branch**, or the chip beside the drawing's name, opens Main or another branch.

### Rename Branch… and Delete Branch…

**File › Branches › Rename Branch…** renames the open branch. **File › Branches › Delete Branch…** deletes it and its versions; Main is not changed. The owner, or whoever started the branch, can delete it. Deleting a drawing deletes its branches.

**Limits:** a drawing can have 20 branches. Branches don't count towards your plan's number of drawings; their versions count towards its storage. Branches don't show in the list of cloud drawings: open them from their drawing.

## Compare

### Compare…

**File › Branches › Compare…** compares the open drawing with Main, another branch, where the branch started, a saved version, or a .vwx file. Unchanged objects fade; added ones are drawn in green, changed ones in amber, and removed ones come back as red ghosts, each boxed. In the 3D view, changed objects are boxed in the same colours.

The Compare palette counts the changes and lists them by layer and kind, then layers, classes, symbols and resources, and document settings. Click a change to select it and zoom to it. The slider fades between the drawing now and the other version. **Refresh** compares again after you edit; **Stop Comparing** ends it.

**Limits:** drawings over 200 MB can't be compared yet. Changes are found per object: an edit inside a group or symbol shows as a change to that group or symbol.

## Merge requests

### New Merge Request…

On a branch, **File › Branches › New Merge Request…** asks for a title and a description, and shows how much changed since the branch started. The request shows in the **Merge Requests** palette for everyone on the drawing.

### Reviewing

**File › Branches › Merge Requests** lists the requests. Open one to read it, discuss it (comments are the branch's own; **Open in Crit Mode** shows those pinned on the drawing), **Review Changes** (the branch compared with where it started), and **Approve** it. Reviewers, editors and the owner can approve; an approval made before the branch changed again says so.

### Merge…

**Merge…** combines the branch into Main object by object, using the version both started from. Objects changed on only one side are taken from that side; objects changed on both sides are listed for you to keep Main's or take the branch's. If Main changes while you merge, Rodeo merges again with your choices; if someone is editing Main live, it waits for their changes to be saved. Main gets a new version named "Merged" and the branch's name, and everyone with Main open sees it.

### Update from Main…

**File › Branches › Update from Main…** merges Main's latest changes into the open branch the same way.

**Limits:** document settings and layer settings changed on both sides keep Main's. When both sides added classes, symbols or names, the branch's are renumbered; a viewport or worksheet the branch added then isn't carried over, and the merge says so. Stacking order changes come from the side that made them; if both reordered a layer, Main's order stands. Drawings over 200 MB can't be merged yet.

## Blame

### Blame

**File › Branches › Blame** outlines every object on the active layer in the colour of the person who last changed it, from the drawing's saved versions. The palette lists the people; click one to select their objects. With an object selected it says who changed it last and when, and opens that version or compares it with the one before.

**Limits:** Rodeo reads up to the last 30 versions; changes older than those show as "or earlier". A version is credited to whoever saved it, so in a live session an autosave can carry others' changes.
