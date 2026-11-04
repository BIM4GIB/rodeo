# The workspace

This page covers Rodeo's window and how to arrange it: the bars and palettes, moving around the drawing, snapping, preferences, workspaces and view panes, and the Tools, Text and Window menu commands that go with them.

## Layout

### The window

The workspace is laid out after Spline's editor and is dark by default. **View › Theme** sets Dark, Light or System, and **View › Dark Canvas** inverts the drawing's ink and paper.

Full-height side panels flank the drawing, which sits in an inset card, beside one sidebar on the right packed as Vectorworks packs its palettes:

- Object Info (Shape, Data and Render tabs), with Attributes as a tab of it.
- Below it, Navigation (Layers, Classes, Stories, Sheets, Viewports and Saved Views tabs), with Resources and Agents as its tabs.

The left side is down to its rail of palette icons, so the drawing has the rest of the window. **Window › Workspaces › Two Sidebars** puts Navigation back on the left and Attributes under Object Info.

### The top bar

The top bar holds:

- the Menu button (every menu)
- the file's name
- 2D or 3D, with the standard views and render mode
- the tools in groups (each shows its last used tool; its caret drops the rest)
- undo
- the zoom (type a percentage)
- Export (PDF, image files, SVG, DXF, Print)
- Save

A right-click on the top bar (or **Window › Top Bar**) shows or hides its groups:

- **Menu Bar**: File, Edit, View, Modify … Help in a row over the top bar. A press on a title drops its menu, and moving over the others while one is down switches to theirs, as a native menu bar does. Never on a phone.
- **2D, 3D and Views**
- **Tools**: hiding the tools brings their palettes out.
- **Undo and Redo**
- **Zoom**

### The View bar

Over the drawing, the View bar pill holds:

- the active layer and its scale, and the active class, with the layer and class options and visibility lists (see [Layers and classes](layers-classes.md))
- the saved views
- the active working plane

**Window › View Bar Options** shows the View bar:

- in its regular size
- compact (tighter, without the layer's scale)
- auto-hidden (a short mark where it is till the pointer comes near)

**Show View Bar Group Labels** puts Layer, Class and Views captions in it.

### The foot of the drawing

At the foot of the drawing are the cursor's position, the Mode bar, and the snap and grid toggles, whose ⋯ opens the Snapping palette, with the Notification Center's bell beside them.

### The Mode bar

The Mode bar shows the active tool, its modes, its preferences, the step to take and its keys. Modes include:

- Dimension's linear, chain, baseline, ordinate, radial, diameter and angular
- Offset by distance or through a point
- Fillet and Chamfer alone, splitting or trimming the lines
- Mirror and Rotate on a copy
- Zoom In or Out
- the Eyedropper's Pick Up and Put Down
- Regular Polygon inscribed, circumscribed or by edge
- Split by point or line, or Line Trim
- Connect/Combine's single, dual and combining modes, chosen by number keys
- the Selection tool's rectangle, polygon or lasso marquee and interactive scaling

When the canvas is too narrow for every mode, the tool shows its icon alone and each mode group drops its modes from one button.

### Notification Center

The Notification Center's bell holds every alert of the session (notes and errors, each with its time), newest first, a count of those not yet seen (red when one is an error), and Clear All. **Window › Notification Center** opens it too.

### Screen tips

Screen tips work as Vectorworks shows them. Rest the pointer on a tool for its name and key, the tool set it is in and how to use it (the Mode bar's help, with the keys it takes), or on a mode for its tool and group. Along a row the next tip comes at once, and a press or a key puts it away.

### Right-click menus

Right-click:

- the drawing for what applies to the selection (or, on empty space, paste, select, zoom and grid)
- a layer, class or viewport row for its own commands
- a palette's title to roll it up, close, dock, float or tab it. The Tools and Tool Sets palettes also offer Small Icons, Large Icons or Icons and Names there, and Resources small, medium or large thumbnails or a list.

### Smart Options display

The Smart Options display (<kbd>\`</kbd> (backquote), a middle click that doesn't pan, or **Window › Smart Options**) brings the palettes to the cursor, so the docks can stay folded or hidden. It is a ring around the active tool whose segments open these beside it:

- **Tools**: Basic and every tool set
- **Snaps**: the Snapping palette's toggles
- **View**: zoom, previous and next views, 3D, standard views, rendering and the grid
- **Layers**: the active layer and class

Choosing a tool or command closes it, as do Escape and a click elsewhere. Arrow keys move between the segments.

### Folding palette sections

Inside Object Info, Attributes and Visualization, a click on a section's heading folds the section to its heading (Option-click folds or opens every section of the palette). It stays folded as the selection changes, kept per browser.

### The Agents panel

**Window › Agents** opens the Agents tab beside Navigation. Ask in plain words for anything in the drawing: the agent reads, looks at and changes it while you watch, and hands parts of big jobs to helper agents. Sign in to use it; where the server sells AI credit, it needs some.

The chat follows the newest message as it streams. Scroll up to read back and it stays where you put it; the round arrow at its foot brings you back to the latest. While the agent thinks, its Thinking line shows what it is on: click it to read the whole of it.

Agents model buildings and gardens from parts, and products and machine parts (housings, brackets, lids) as one closed solid each, with their holes, slots and pockets cut, ready to export as STL.

**Limits:** conversations are kept in this browser only.

## Navigating: zoom, pan and undo

### Zoom

The **Zoom** tool (<kbd>⇧Z</kbd>): click to zoom in, Option-click to zoom out, or drag a box.

### Undo/redo

Undo/redo works for every edit, pan/zoom, fit and zoom to selection. **View › Previous View** and **Next View** step back and forth through the views shown (a zoom or pan counts once it has settled).

### Fitting the view

- **View › Fit to Objects** (<kbd>⌘6</kbd>) fits the selection, or everything when nothing is selected, in the plan or the 3D view.
- **View › Fit to Page Area** fits a sheet's page in the window.
- **Normal Scale** shows the drawing as large as it prints at the active layer's scale.

### Line thickness on screen

Line weights keep their width on screen at any zoom. **View › Zoom Line Thickness** draws them at their size on paper instead, so they thicken as the drawing is zoomed in (as printed at actual size). This browser keeps the choice; exports are unaffected.

## Snapping, grid and rulers

### Snap points

Rodeo snaps to endpoints, midpoints, centres, intersections, points on objects and the grid, with a label at the cursor.

While a line, polyline, polygon, double line, dimension or measurement is drawn from a point, the points where it would touch a circle or arc (tangent) or meet a straight edge square (perpendicular) snap too.

Shift constrains angles to 15°.

### Smart points

Rest the cursor on a point snap for a moment to acquire it (a small cross marks the last four). Then, away from objects, the cursor lines up with it horizontally or vertically along a dashed guide, or runs on along the extension of a slanted edge that ends there.

**Smart Point Settings** (right-click the Snapping palette's Smart points button, or **Tools › Smart Point Settings…**) set how long a rest acquires a smart point or sets a datum, and a datum offset whose points along the datum's extensions snap.

### The Snapping palette

Each kind of snap turns on and off in the Snapping palette, whose **Snap Settings…** button sets the snap radius and a fixed grid spacing (or one that follows the zoom).

### The data bar

The data bar shows live coordinates, length and angle; <kbd>Tab</kbd> lets you type exact values.

**Window › Data Bar Options** sets:

- whether it shows always or only once Tab is pressed
- whether it shows below the cursor or above it
- whether a number typed while it shows starts its first field: keypad numbers too, the main keys only, or neither (the default, so the 3 key keeps showing the 3D view)

It shows each tool's own fields (length and angle, ΔX and ΔY, or the radius), those and ΔX and ΔY, or those and the point's X and Y too. Tab past the last one shown brings out the rest unless turned off.

A typed X or Y places the point there, else a typed ΔX or ΔY, else the tool's own fields.

While the Selection tool moves things, the data bar shows how far, and where the dragged point is from the datum.

### Snap Loupe

The Snap Loupe, as Vectorworks keys it: <kbd>Z</kbd> over the drawing opens a round window magnifying it 4× at the pointer (<kbd>Z</kbd> again doubles it, up to 64×), where snap points too close to pick come apart.

With the pointer in it, the tools get the point under it there, snapped as finely, a click acting on it and closing the window. Escape, a click outside or a zoom or pan closes it without acting.

### SmartCursor datum

<kbd>G</kbd> over the drawing sets a SmartCursor datum, as Vectorworks keys it: a temporary origin, marked with a small circle, that the data bar's and status bar's X and Y are measured from (typed ones too) and the cursor lines up with. <kbd>G</kbd> over it releases it.

Data Bar Options can bring the bar out, ready to type, as a datum is set.

### Grid

Show or hide the grid from the grid button at the foot of the drawing or with <kbd>⌘'</kbd>. <kbd>⇧⌘'</kbd> toggles snapping to it.

### Rulers

**View › Rulers** shows rulers along the top and left of the drawing, marked in the document's units at the zoom (feet and inches in feet or inches, the other units as plain numbers in the unit), with a mark on each following the pointer. The bars over the drawing move clear of them. This browser keeps the choice.

**Limits:** not in 3D or in exports.

## Hiding and naming objects

### Hiding objects

The View menu has:

- **Hide Selected Objects**
- **Show Selected Objects Only**
- **Unhide Objects**
- **Object Visibility…**: show, show only or hide the objects meeting criteria, as Custom Selection sets them.

Hidden objects aren't drawn, selected or snapped to, in plan, 3D or viewports, nor exported or printed, until **Unhide Objects** or the button the drawing shows. They stay hidden while the drawing is open, not in the saved file.

### Naming objects

Object Info names any object. Names are unique in a drawing; emptied, the object has none.

## Preferences

### The Preferences dialog

**Edit › Preferences…** (<kbd>⌘,</kbd>) has Vectorworks 2026's panes beside a list, kept in the browser:

- **General**: the interface theme, a black background.
- **Edit**: whether Duplicate offsets its copies a grid step or leaves them on the originals; whether the mouse wheel zooms or scrolls the drawing, Shift scrolling sideways and ⌘ or Ctrl zooming (a pinch always zooms).
- **Display**: zoomed line thickness; Show other objects while in editing modes, which while a group is edited draws the rest of the drawing grayed, or without it neither draws nor snaps to it.
- **Session**: tool help in the Mode bar.
- **3D**: the 3D conversion resolution, how finely circles and ellipses in extrude and sweep profiles become faces, from Low to Very High; whether the 3D view opens with the render mode and projection last used.
- **Autosave**.
- **Interactive**: a full-screen cursor; the selection box, which sets how near a click picks, and the snap box, the snap radius, each shown at the pointer if wished; pre-selection highlighting, the Selection tool outlining what a click would pick once the pointer rests; animated view transitions, Fit, Zoom to Selection, saved views and Previous and Next View easing there over the time and with the motion chosen, any pan or zoom by hand stopping one.
- **Appearance**, Vectorworks' Interactive Appearance Settings: the colours of the selection (its outline, handles and the tools' previews), pre-selection, the snap indicators (markers, their names, smart points and the snap box) and the cursor (crosshairs and the selection box, else dark on white and light on black), with Restore Defaults.

### Quick Preferences

The View bar's Quick Preferences pop-up lists the preferences turned on and off most, each checked while on. At first these are:

- **Black Background**
- **Zoom Line Thickness**
- **Show Grid**
- **Snap to Grid**
- **Full-Screen Cursor**
- **Offset Duplicates**
- **Pre-selection Highlighting**

Its **Customize…** picks from those, Snap to Objects, the selection and snap boxes, animated views, wheel zooming, showing other objects while editing, tool help, keeping the 3D render mode, autosave and Compact Interface, kept in the browser and with workspaces. **Preferences…** opens the dialog.

## Arranging palettes

### Moving and docking palettes

Panels stay configurable. Drag a palette by its title to another place in a side panel, to the other side or out to float, or onto another palette's title to make it a tab there (drag the tab out to separate it). Roll it up, close it, resize the side panels and split the height between palettes.

As in Vectorworks, a docking guide shows while a palette is dragged:

- Over a docked palette, squares put it above, below, as a tab, or in a new column to its left or right. The side panel widens by the palette's width, a blue band showing where. A handle between columns resizes them, and a column left empty goes, the panel narrowing again.
- A square at each side of the drawing docks it at the end of that side's panel.
- Option or Ctrl held keeps it floating.

### Palette tabs

As in Vectorworks 2027, a tab of Object Info (Shape, Data, Render) or Navigation (Layers, Classes and the rest) dragged off its strip comes out as a palette of its own, to float or dock anywhere. A palette's title bar menu also undocks any of its tabs into a floating palette of its own.

Tabs out of the same palette connect into one, and go back when dropped on it, closed, or docked back from its title bar menu ("Dock Data here", "Dock all tabs here").

A tab dragged along the strip moves along it, and "Lock tabs" in that menu holds them where they are. Its Tab Style shows a palette's tabs as icons, names, or both (icons alone fit Navigation's six tabs in half the width).

### Docking bars at the top and bottom

Vectorworks 2027's docking bars run along the drawing's top and bottom too. A palette dragged to that edge (or sent there from its title bar menu's Send to) stands in the bar beside the others there, the drawing making room.

A handle between two palettes shares the width out, the bar's inner edge sets its height, and rolled up, the bar is just its palettes' titles.

A palette that wide (or floating or docked wider than two columns of fields) lays its sections side by side, so Object Info or Visualization in a short bar shows what a sidebar stacks.

### Floating palettes

Floating palettes dock to each other too. Drag one over another and the docking guide's top or bottom square puts it above or below, the two then one floating card that moves by its top palette's title. **Window › Palette Options › Floating Palettes Can Dock to Each Other** turns this off.

### Dock rails

Along each dock's window edge runs a rail of icons, one per palette of that side, closed ones too:

- The left rail has Tools, Tool Sets, Navigation and Resources, which starts as a tab of Navigation.
- The right rail has Object Info, Attributes, Snapping, Visualization and the cloud palettes.

A click on an icon opens a closed palette, brings a rolled-up one or a tab behind another into view, or closes one in view, and a right-click offers its title bar's menu. A dot marks the open ones out of view. A dock with every palette closed is just its rail.

### Folding and auto-hiding docks

The rail's fold button, **Window › Fold Left Dock** and **Fold Right Dock**, or a double-click on a dock's inner edge or the rail's empty part fold a dock to its rail (36 px). An icon then opens its palette beside the rail, over the drawing, until the next click elsewhere or Escape.

Of a 1440 × 900 window, the drawing gets:

| Docks | Drawing area |
| --- | --- |
| As it starts (one sidebar) | 1108 × 844 px |
| Two sidebars open | 864 × 844 px |
| Both folded | 1352 × 844 px |

Auto-hiding a dock (the pin on its rail, **Window › Auto-Hide Left Dock** or **Auto-Hide Right Dock**, or a title bar's menu) folds it the same way, but a palette slides out while the pointer rests on its icon and back once the pointer leaves it, so the drawing keeps the whole width until a palette is wanted.

**Window › Palette Options › Auto-Hide Docked Palettes** does it to both docks at once, and **Auto-Hide Floating Palettes** rolls each floating palette up to its title bar while the pointer is elsewhere, unrolling it as the pointer comes back.

### Showing and hiding palettes

The Window menu shows each palette again (including Tools and Tool Sets, Vectorworks' grids of tool buttons), hides them all, rolls them up, toggles the View, Mode and Snapping bars and resets the arrangement, which is kept per browser.

**Window › Palettes** lists every palette by its Vectorworks name, each tab of Object Info, Navigation and Visualization too (Shape, Data, Render, Design Layers, Classes, Sheet Layers, Saved Views, Lights, Cameras…). Choosing one brings it to the front, or closes it when it is in view.

**Hide Enabled Palettes** (<kbd>⇧⌘P</kbd>) puts them all away and back.

**Activate Object Info Palette** (also in the drawing's right-click menu) brings Object Info up with its first field taking the keyboard.

### Moving the bars over the drawing

The bars over the drawing move and roll up too:

- Drag a bar's grip (its dots) to put it anywhere over the drawing.
- Click the grip to roll the bar up to its name (the Mode bar to its tool's icon).
- Double-click it to put the bar back.
- Or use the arrow keys on it.

**Window › Reset Bars** puts them all back.

## Workspaces

### Built-in workspaces

- **Window › Workspaces › Standard** goes back to the one sidebar.
- **Window › Workspaces › Two Sidebars** goes to Spline's two.
- **Window › Workspaces › Classic** puts the tools in the Tools and Tool Sets palettes down the left, as Vectorworks keeps them, instead of the top bar, with the menu titles over it.
- **Window › Workspaces › Dense** arranges everything as Compact Interface does at once: compact rows, narrower docks, the menu bar's row of titles and the smaller palettes as tabs (Resources with Navigation; Attributes, Snapping and Visualization together with Object Info) for 1146 × 838 px (860 without the menu titles).

### Compact Interface and full screen

**Window › Compact Interface** packs the top bar, palette titles, rows and fields as tightly as Vectorworks does.

**Window › Use Full Screen** gives the window the whole screen, without the browser's bars.

### Saving and sharing workspaces

**Window › Workspaces** saves the palette arrangement, the view panes and the Quick Preferences list under a name and switches between them. It exports the current arrangement and tool and menu shortcuts as a workspace file, and imports one (kept as a workspace and switched to).

**Window › Palettes › Save Palette Positions** keeps the arrangement in the saved workspace in use (with a built-in one, it asks for a new workspace's name).

### Menus and tool sets

**Window › Workspaces › Menus…** rearranges the menu bar: new menus, names, order, commands or submenus moved between menus or taken out (still running from their shortcuts). Workspaces keep it.

**Window › Workspaces › Tool Sets…** rearranges the Tool Sets palette: new sets, names, order, which tools each holds. Workspaces keep them.

### Shortcuts

**Window › Workspaces › Tool Shortcuts…** sets the key of every tool (a letter, or Shift and a letter).

**Menu Shortcuts…** sets the combination of every menu command, pressed with ⌘, and ⇧ or ⌥ if wanted. The menus, tooltips and **Help › Keyboard Shortcuts** follow it.

## View panes

### Splitting the drawing area

**Window › View Panes** (or the View bar's View panes pop-up, or **View › Multiple View Panes**) splits the drawing area into two, three or four panes, all drawn at once and kept up to date as the drawing is edited, each a plan or a 3D view.

A new arrangement has the plan in the first and a 3D view in each of the others (Front, Right and an isometric view to start with):

- Two panes put the plan beside the 3D view or above it.
- With three or four, the plan's pane is the large one, on the left, the right, the top or below, and the small panes share the other side evenly.
- **Four Panes** alone are two by two.

The menu pictures each arrangement. Other commands:

- **Split Horizontally** and **Split Vertically** cut the active pane in two (the new half showing what it showed).
- **Close Active View Pane** gives its room to its neighbours.
- **Enable Multiple View Panes** goes to one pane and back to the last arrangement of several.
- **Single Pane** goes back to the one view.
- **Reset Multiple View Panes** goes back to Four Panes, the dividers halfway and each pane in its standard view, and closes the floating panes.

Every pane shows the same layers, classes and clip cube, so **Use Same Visibilities in All Panes** is always on.

### The active pane

The active pane is ringed in the accent. The render mode, the zoom and Fit act on it, and Top/Plan, 3D View (the View bar's 2D and 3D) and the standard views turn it into a plan or a 3D view, so two plans can show the drawing at different zooms, or every pane a 3D view. A click in another pane makes that one active (the click does nothing else).

The live plan, for drawing and editing, is in the plan pane last made active, and the live 3D view, for orbiting, picking and walking, in the 3D pane last made active. Every other pane shows the drawing from its own view, kept as it was left and drawn again as the drawing or the look changes.

### Render modes in panes

Each 3D pane keeps its own render mode and projection. The View bar's Render mode and Projection set the live pane's, and the pane the live view moves to takes its own back (a new arrangement starts every pane in the one shown).

A Realistic pane without the live 3D view shows the render feature's picture through its own camera, Shaded until that has loaded.

A Path Traced one refines a path-traced picture of its own, a sample a frame up to the Render palette's preview samples (512 at most), on a renderer the panes share, so the live view isn't drawn again meanwhile. The panes refine one at a time, each showing a Realistic picture until its turn, and start over as their camera, size, the model or the settings change.

### Resizing panes

The dividers drag (each pane keeps at least 15%), and a double-click on one shares the area evenly. The arrangement, what each pane shows included, is kept in this browser and with saved and exported workspaces.

### Floating view panes

**View › Multiple View Panes › Create Floating View Pane** opens another view of the drawing in a window of its own over the drawing area, showing what the active view shows (the plan, or the model from where the live 3D view looks).

- Its view button or right-click menu turns it into Top/Plan or any standard 3D view.
- A drag pans the plan or orbits the model (Shift- or middle-drag pans the model), and the wheel zooms.
- A double-click or **Show in Main View** gives its view to the live plan or 3D view.
- Its title bar moves it, its corner resizes it, and its buttons fit the drawing in it, roll it up and close it.

The 3D ones are drawn in **View › Rendering**'s mode (Path Traced as a still Realistic picture), and their model is kept up to date with the 3D view hidden.

A Renderworks camera's right-click menu has **Open Camera View in New Pane**: a floating pane looking through the camera, its picture the camera's shape, in its projection, following the camera as it is moved or re-aimed until the pane's own view is turned.

**Limits:** nothing is drawn or picked in a floating pane; the panes close with their drawing and aren't saved.

## Menus at a glance

Rodeo has File, Edit, View, Modify, Model, AEC, Tools, Text, Window and Help menus, with the usual Vectorworks shortcuts. This section covers the Tools and Text menu commands not described elsewhere on this page; **Tools › Organization…** and the other layer and class commands are in [Layers and classes](layers-classes.md).

### Quick Search

<kbd>F</kbd> opens Quick Search (Tools menu), as Vectorworks keys it: Search Everything, which finds the menus' commands, the tools and the Quick Preferences (set in place there) with the drawing's layers, classes, views, symbols and objects.

Fillet's key is <kbd>⇧F</kbd> and Connect/Combine's <kbd>⇧J</kbd>, leaving <kbd>F</kbd> and <kbd>J</kbd> to Vectorworks' uses.

### Find and Modify

**Tools › Find and Modify…** finds objects with Custom Selection's criteria and changes every one found at once, as one undo step. It changes:

- class
- fill or pen colour
- line weight
- opacity
- the symbol shown
- or the layer

### Check File Health

**Tools › Check File Health…** runs the tests of Vectorworks' File Health Check that Rodeo can, each at a limit kept in this browser, and lists what fails:

- objects far from the origin
- outlying objects
- polygons with many vertices
- transparent symbols
- groups of 3D polygons
- hatch levels
- texture sizes
- the colour count
- Class Options at Show Others

The issues ticked are located, deleted or resolved (Simplify Polys on the polygons), and show as resolved when the dialog reopens.

### Compress Images

**Tools › Compress Images…** saves the selected bitmap images, or all of them, again as JPEGs to make the file smaller, leaving those that are JPEGs already, have clear parts or wouldn't get smaller.

### Text menu

The Text menu sets the selected text's:

- **font**: the file's own, or a common one, added to the file's font list
- **size**: **Text › Size › Set Size…** types any size in points
- **style**: plain, bold, italic, underline
- **justification** and **vertical alignment**
- or a **text style** from the file (its font, size and alignment), or the one the text's class names (Class Text Style)

**Convert Text to Polylines** turns each selected text into a group of filled polylines tracing its characters as the drawing shows them.

**Text Along Path…** sets a single-line text's letters along a selected line, polyline, arc or circle (as they are, or stretched to the path's length; above or below it), grouped with the path.

**Find-Replace Text** finds the next text object, record field or worksheet cell holding a string (selecting and zooming to it, on its layer) or replaces it there:

- in the selected objects or everywhere
- on the active, visible or every layer
- case-sensitive, whole words

Each replace is one undo step, and its settings are kept.

**Check Spelling** steps through the words a British or American English dictionary doesn't know, with suggestions, to ignore, change (here or everywhere) or add to the browser's own word list, and makes the changes as one undo step.

## Utilities

### Purge

**Tools › Utilities › Purge…** removes these, each kind with its count, as one undo step:

- symbol definitions placed nowhere (or only inside other unused ones)
- classes nothing uses (with those only the purged definitions used)
- coincident duplicates (an unnamed object identical to an earlier one in the same layer or group)

A name a plug-in, worksheet or data visualization holds as text keeps its symbol or class, and so does any class a style might use.

### Batch Rename

**Tools › Utilities › Batch Rename…** renames many classes, design layers, sheet layers (numbers or titles), stories or resources at once, with:

- find and replace
- case
- a prefix and suffix
- a running number (before, after or instead of the name, as wide as the start is typed)

The new names are previewed row by row with clashes marked, and applied to the ticked rows as one undo step. Names can swap, and story levels follow their layers' new names.

### Replace Font

**Tools › Utilities › Replace Font…** swaps one font for another in every text object on the drawing's layers and every text style (the list shows what each font is used by), as one undo step.

### Reset All Plug-Ins

**Tools › Utilities › Reset All Plug-Ins** draws every plug-in object again from its parameters with its plug-in's current script (installed Vectorworks plug-ins and Hyperlinks), then reports how many were reset, failed or left.

**Limits:** Vectorworks' own plug-ins stay as they were last drawn.

### Change Symbol Attrs

**Tools › Utilities › Change Symbol Attrs…** puts the objects of the symbol definitions in a folder (with its subfolders), in no folder or in all of them in one class, taking the class's fill, pen colour, line style, line weight and opacity as chosen, the rest kept or set to the Attributes palette's for new objects.

Every instance follows, after a confirmation naming how many definitions change, as one undo step (a mesh's faces go with it).

### Create Color Chart

**Tools › Utilities › Create Color Chart…** draws the drawing's colour palette on the active layer as a grouped chart of swatches sixteen to a row, each palette index under its swatch when asked, sized on paper as text is, in one undo step.

### List Symbols

**Tools › Utilities › List Symbols…** saves a text file of the symbol folders, each with its definitions or the folders alone, indented a tab a level.

## Origin

### Locate Internal Origin

**Tools › Origin › Locate Internal Origin** brings the window to the internal origin (0, 0) in Top/Plan, zoomed out as far as the drawing needs to stay in sight, and marks it for a few seconds.

### Center Drawing on Internal Origin

**Tools › Origin › Center Drawing on Internal Origin…** says how far the farthest object is from it and will be. It then moves every object on the design layers, hidden ones too, so the drawing's middle is on it, in one undo step. The sheets' plan viewports go on showing the same parts, and the window moves with it.

It refuses, saying why, while the drawing has elevation, section or 3D viewports or design-layer viewports (how their views would follow isn't known) or objects that can't be moved yet.

**Limits:** a user origin isn't read or kept, so coordinates change, and saved views stay where they were.
