# The workspace

This page covers Rodeo's window and how to arrange it: the bars and palettes, moving around the drawing, snapping, preferences, workspaces and view panes, and the Tools, Text and Window menu commands that go with them.

## Layout

### The window

The workspace is laid out after Spline's editor and is dark by default. **View › Appearance** sets the theme (Dark, Light or System), and its **Dark Canvas** row inverts the drawing's ink and paper.

Full-height side panels flank the drawing, which sits in an inset card, beside one sidebar on the right packed as Vectorworks packs its palettes:

- Object Info (Shape, Data and Render tabs), with Attributes as a tab of it.
- Below it, Navigation (Layers, Classes, Stories, Sheets, Viewports and Saved Views tabs), with Resources and Agents as its tabs.

The left side is down to its rail of palette icons, so the drawing has the rest of the window. **Window › Workspaces › Two Sidebars** puts Navigation back on the left and Attributes under Object Info.

### The top bar

The top bar holds:

- the Menu button (every menu)
- the file's name
- **2D**, **3D** and **Split**: the plan alone, the 3D view alone, or the plan and the 3D view in panes, as last arranged
- the **Standard views**, **Render mode** and **View panes** pop-ups, and **More view options**: Projection, Active Plane, Rotate Plan, Set Plan Rotation… and Quick Preferences
- the tools in groups by discipline (each shows its last used tool; its caret drops the rest), scrolled with ‹ and › when they don't fit
- the **Tool sets** button, which drops every tool set's tools and opens the Tool Sets palette
- **Undo** and **Redo**
- **Fit to Window** and the zoom (type a percentage of the 2D plan)
- **Save**, with a caret that holds Save As, Export, Share, Publish and Print

A greyed-out row in a menu says why under it while the pointer rests on it (on a phone, once it is tapped), and its tooltip says the same.

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

The active working plane is in the top bar's **More view options › Active Plane**.

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

When the canvas is too narrow for every mode, the tool shows its icon alone and each mode group drops its modes from one button. When the step has no room for its hint, the hint's key chips go first, from the last, and then the step ends in an ellipsis. The whole hint is the bar's tooltip.

### Notification Center

The Notification Center's bell holds every alert of the session (notes and errors, each with its time), newest first, a count of those not yet seen (red when one is an error), and Clear All. **Window › Notification Center** opens it too.

### Screen tips

Screen tips work as Vectorworks shows them. Rest the pointer on a tool for its name and key, the tool set it is in and how to use it (the Mode bar's help, with the keys it takes), or on a mode for its tool and group. Along a row the next tip comes at once, and a press or a key puts it away.

### Right-click menus

Right-click:

- the drawing for what applies to the selection (or, on empty space, paste, select, zoom and grid)
- a layer, class or viewport row for its own commands
- a palette's title to roll it up, close, dock, float or tab it. The Tools and Tool Sets palettes also offer Small Icons, Large Icons or Icons and Names there, and Resources small, medium or large thumbnails or a list.

A greyed-out row in a right-click menu says why under it, as a menu's rows do (see [The top bar](#the-top-bar)).

### Touch screens and phones

On a touch screen a finger is the main pointer, and the bars change to suit it:

- Undo, Redo, Esc, Delete and the Shift and Option latches are the quick keys, a column at the drawing's right edge, not part of the top bar.
- The top bar's microphone is hidden. The round microphone at the drawing's lower right is the one that starts voice commands.
- The tool row has no ‹ and › buttons: a swipe scrolls it, and its faded edges show that more tools lie beyond.
- A dock is at least as wide as the top bar's end over it, up to 35% of the window's width (see [Folding and auto-hiding docks](#folding-and-auto-hiding-docks)).

On a phone, a window 560 px wide or less:

- The tools are a bar along the bottom, with the **Tool sets** button at its end.
- The top bar holds the Menu, 2D, 3D and Split, **Palettes** and Save. Save's caret is left out, so Save As, Export and Print are in **File**, and crit mode is in **View › Crit Mode**.
- The quick keys lie in a row above the Mode bar at the drawing's lower left, and the round microphone at its lower right.
- The palettes are one bottom sheet, opened from the **Palettes** button.

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

Available credit excludes reservations for running agent requests and cloud renders. Each reservation is counted once and released when its request finishes.

The chat follows the newest message as it streams. Scroll up to read back and it stays where you put it; the round arrow at its foot brings you back to the latest. While the agent thinks, its Thinking line shows what it is on: click it to read the whole of it.

Agents model buildings and gardens from parts, and products and machine parts (housings, brackets, lids) as one closed solid each, with their holes, slots and pockets cut, ready to export as STL.

Each open drawing has its own chat, so agents can work in several drawings at once. The panel shows the one for the drawing in front. The line under the chat's title names its drawing, and lists the agents at work in your other tabs: click one to bring its drawing to the front. Start an agent in one drawing, switch to another tab and start a second, and both keep going.

An agent behind another tab goes on reading, editing, building, running scripts, looking at the plan and exporting in its own drawing. What needs the window (looking in 3D, rendering, changing the view, running a menu command, importing a file) waits until you bring its drawing to the front; its tab shows an amber pause and a note says so. While an agent is looking in 3D or rendering, its drawing stays in front until it is done (or you stop it). When an agent finishes in a drawing you aren't looking at, a note says so and its tab keeps a spark until you open it. Closing a drawing whose agent is at work asks first, and stops the agent.

The conversations list names the drawing each one was in.

**Limits:** conversations are kept in this browser only. An agent's edits to a live cloud drawing (one shared with others) wait until that drawing is in front, as its changes go out live from there. Voice commands work in the drawing in front when you speak.

### Connect an Agent

**Window › Connect an Agent…** (also in your account menu) lets Claude, ChatGPT, Claude Code, Cursor or another AI agent work in your open drawing while you watch. The agent uses its own AI account, so it takes none of your Rodeo credit.

**Sign in from your agent.** Give the agent Rodeo's address, `https://rodeo.build/mcp`, and it sends you to Rodeo to sign in:

- **Claude** (claude.ai and the Claude desktop and phone apps): Settings › Connectors › Add custom connector, paste the address and press Connect. Once added, it works in all of them. On a Team or Enterprise plan, an owner adds it first.
- **Claude Code**: run `claude mcp add --transport http --scope user rodeo https://rodeo.build/mcp`, then type `/mcp`, choose rodeo and sign in.
- **Cursor**: add `{"mcpServers":{"rodeo":{"url":"https://rodeo.build/mcp"}}}` to `~/.cursor/mcp.json` and sign in when Cursor asks.
- **ChatGPT**: with developer mode on, create a connector with the address and choose OAuth.

Rodeo's page shows which app is asking, where it will send you back, and what it will be able to do. An app Rodeo can't check is marked **not verified by Rodeo**. An app on your own computer, such as Claude Code, is marked too: allow it only if you just started connecting it. Press **Allow** and you're back in the app.

**Or make a token**, for agents that take a header instead: name it, press **Create Token**, and paste the line the dialog shows into your agent.

The agent works in the drawing in front of the Rodeo tab you used last, with the Agents panel's tools: it reads the drawing, looks at the plan and the model, edits, builds in 3D, renders, exports and runs scripts. Each edit is one undo step. Files it exports are downloaded in your browser; full-size renders wait in the agent menu. It can give Rodeo a small file to import.

While an agent works, a pill in the top bar names it and says what it is doing; click it for its recent calls and files. **Stop** halts the call in progress and refuses the agent's calls until you press **Resume**.

The dialog lists the apps you connected and your tokens, with when each was last used and by which app. **Remove** one and it loses access at once. Rodeo keeps only fingerprints of tokens, so it can't show one again: make a new one if you lose it. A connected app unused for 60 days is disconnected by itself.

**Limits:** an agent's calls need a Rodeo tab open and signed in, and Rodeo draws only while its tab is on screen, so keep it visible. If you sign in with an emailed link while connecting, open the link in the same browser; on a phone, signing in with Google, Microsoft or GitHub is simplest. Agents can't open files on your computer from Rodeo: they give it files of up to 4 MB.

## Voice commands

### Talking to Rodeo

Hold <kbd>Space</kbd> still for a moment and a bubble opens by the pointer: say what to do and let go. Rodeo's agent does it: "rotate this 90", "move this door here", "make that wall 200 thicker", "what's on this layer?". The card that follows shows its answer, what the command cost, **Undo**, and **Continue in Agents**, which opens the conversation in the Agents panel; <kbd>⌘Z</kbd> undoes the agent's changes in one step. A follow-up within ten minutes carries on the same conversation. Pressing Space and dragging straight away still pans.

Voice commands need you signed in, and use AI credit as the Agents panel does; without enough credit, holding the key offers a top-up before anything is recorded. The first time, Rodeo says where your speech goes. **Turn on voice** asks to use the microphone, and **Not now** turns voice off; **Tools › Voice Commands…** turns it on again.

### Pointing while you speak

While you hold the key, a click drops a numbered pin, snapped as the tools snap, labelled with what is under it. "This" and "that" mean the objects under the pins (or the selection), "here" and "there" the places, in the order you clicked: "move this door here", "copy these three times along here, 1200 apart". The bubble marks each pointing word with its pin, and the agent is told what each one points at. A drag still pans (in 3D it orbits). <kbd>Backspace</kbd> takes the last pin away, <kbd>Enter</kbd> sends, <kbd>Esc</kbd> cancels.

### What the agent gets

Your words, the selected objects (their names, classes and layers), the pins and what is under them, and what the view shows. It works as the Agents panel does, on its fast model unless the settings choose the panel's.

### Firefox and Brave

Firefox has no speech recognition of its own, and Brave's often doesn't answer. There Rodeo's server turns your speech into text: the browser records while you hold the key, and when you let go the bubble says "Turning speech into text…" before the agent starts (<kbd>Esc</kbd> stops it). It uses a little AI credit, shown on the card. When Firefox asks for the microphone, tick **Remember this decision**, or it asks each time. In other browsers, **Speech to text** in the settings can choose Rodeo's server too.

### Touch and mouse

With a mouse, the microphone button in the top bar starts listening. On a touch screen that button is hidden, and the round one at the drawing's lower right does the job. Tap the drawing to drop pins and tap the microphone again to send, or press and hold it while you speak.

### Voice settings

**Tools › Voice Commands…** turns voice on or off and sets the key to hold (Space, the right Option or Alt key, or only the microphone button), the language, the speech to text (automatic, the browser's, or Rodeo's server), the agent's model (fast, or the Agents panel's) and, in Chrome where it can, speech recognised on this computer so no audio leaves it.

**Limits:** every command goes to the agent, so it takes a few seconds and needs a sign-in and AI credit. Chrome sends speech to Google, Edge to Microsoft and Safari to Apple unless it is recognised on the computer; Rodeo gets only the words. With Rodeo's speech to text the words show only after you let go, a command is at most 30 seconds, and the recording is passed to the speech model once and not kept. A pause before a pan opens the microphone briefly; nothing is sent when nothing is said.

## Navigating: zoom, pan and undo

### Zoom

The **Zoom** tool (<kbd>⇧Z</kbd>): click to zoom in, Option-click to zoom out, or drag a box.

The zoom field at the top bar's right end sets the 2D plan's zoom as a percentage. It is greyed out while only the 3D view shows, and its tooltip says so.

### Undo/redo

Undo/redo works for every edit, pan/zoom, fit and zoom to selection. Its buttons are at the right of the top bar's tools (on a touch screen, on the quick keys). **View › Previous View** and **Next View** step back and forth through the views shown (a zoom or pan counts once it has settled).

### Fitting the view

- **View › Fit to Objects** (<kbd>⌘6</kbd>) fits the selection, or everything when nothing is selected, in the plan or the 3D view.
- **View › Fit to Page Area** fits a sheet's page in the window.
- **Normal Scale** shows the 2D plan as large as it prints at the active layer's scale.

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

**Window › Data Bar Options** has:

- **Use Floating Data Bar Only When Tab Key Is Pressed**, a toggle: ticked, the bar shows only once Tab is pressed
- **Show Floating Data Bar Above SmartCursor Cues**, a toggle: off, the bar shows below the cursor
- **Allow Numeric Keypad Entry for Instant Data Bar Activation**, **Do Not Allow Numeric Keypad Entry for Instant Data Bar Activation** or **Do Not Allow Instant Data Bar Activation** (the default, so the 3 key keeps showing the 3D view): whether a number typed while the bar shows starts its first field, from keypad numbers too, the main keys only, or neither
- **Show Only Primary Fields on Data Bar**, **Show Primary and Secondary Fields on Data Bar** or **Show Primary, Secondary, and Cursor Location Fields on Data Bar**: which fields it shows
- **Auto Cycle to Non-Displayed Fields When Tabbing Past Last Field**, a toggle, on at first
- **Show Floating Data Bar After Datum Creation**, a toggle, off at first

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

### Language

Rodeo's interface comes in English, Bahasa Indonesia, Deutsch, Español, Français, Italiano, Nederlands, Polski, Português (Brasil), Tiếng Việt, Türkçe, Русский, Українська, 日本語, 简体中文, 繁體中文 and 한국어. It starts in your browser's language when it has it, and otherwise in English. To change it, use the globe at the end of the start screen's footer, or the Language list in **Edit › Preferences…** › General. The change is immediate, keeps the open drawing as it is, and is remembered in this browser; the gallery and the converter follow it.

Menus, tools, palettes, dialogs, messages (the server's too), What's New and the converter and gallery pages are translated, and the agents in the Agents panel reply in the interface's language. Your drawing's own text (layer, class and resource names, record fields, worksheets, text objects) stays as it was written, and files you save or export are the same whatever the interface's language.

**Limits:** the translations were made with AI and not every language has been read through by a native speaker yet; corrections are welcome (see "Translating Rodeo" in CONTRIBUTING.md). Right-to-left languages (Arabic, Hebrew, Persian) aren't offered yet. Text added since a language was last updated shows in English until it is translated. Messages put together from several parts sometimes read stiffly.

### The Preferences dialog

**Edit › Preferences…** (<kbd>⌘,</kbd>) has Vectorworks 2026's panes beside a list, kept in the browser:

- **General**: the interface theme, the language, a black background.
- **Edit**: whether Duplicate offsets its copies a grid step or leaves them on the originals; whether the mouse wheel zooms or scrolls the drawing, Shift scrolling sideways and ⌘ or Ctrl zooming (a pinch always zooms).
- **Display**: zoomed line thickness; Show other objects while in editing modes, which while a group is edited draws the rest of the drawing grayed, or without it neither draws nor snaps to it.
- **Session**: tool help in the Mode bar.
- **3D**: the 3D conversion resolution, how finely circles and ellipses in extrude and sweep profiles become faces, from Low to Very High; whether the 3D view opens with the render mode and projection last used.
- **Autosave**.
- **Interactive**: a full-screen cursor; the selection box, which sets how near a click picks, and the snap box, the snap radius, each shown at the pointer if wished; pre-selection highlighting, the Selection tool outlining what a click would pick once the pointer rests; animated view transitions, Fit, Zoom to Selection, saved views and Previous and Next View easing there over the time and with the motion chosen, any pan or zoom by hand stopping one.
- **Appearance**, Vectorworks' Interactive Appearance Settings: the colours of the selection (its outline, handles, the tools' previews and its highlight in the 3D view), pre-selection, the snap indicators (markers, their names, smart points and the snap box) and the cursor (crosshairs and the selection box, else dark on white and light on black), with Restore Defaults.

### Quick Preferences

The top bar's **More view options › Quick Preferences** lists the preferences turned on and off most, each checked while on. At first these are:

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

A tab dragged along the strip moves along it, and "Lock tabs" in that menu holds them where they are. Its Tab Style shows a palette's tabs as icons, names, or both (icons alone fit Navigation's six tabs in half the width). A tab with no room left goes to a ⋯ **More Tabs** menu at the strip's end, so no tab is cut short.

### Docking bars at the top and bottom

Vectorworks 2027's docking bars run along the drawing's top and bottom too. A palette dragged to that edge (or sent there from its title bar menu's Send to) stands in the bar beside the others there, the drawing making room.

A handle between two palettes shares the width out, the bar's inner edge sets its height, and rolled up, the bar is just its palettes' titles.

A palette that wide (or floating or docked wider than two columns of fields) lays its sections side by side, so Object Info or Visualization in a short bar shows what a sidebar stacks.

### Floating palettes

Floating palettes dock to each other too. Drag one over another and the docking guide's top or bottom square puts it above or below, the two then one floating card that moves by its top palette's title. **Window › Palette Options › Floating Palettes Can Dock to Each Other** turns this off.

### Dock rails

Along each dock's window edge runs a rail of icons, one for each palette of that side that is open, used every day, or has been opened before:

- The left rail has Tools and Tool Sets.
- The right rail has Object Info, Attributes, Navigation, Resources, Snapping, Visualization, Working Planes and Agents, with any others opened before.

Resources and Agents are tabs of Navigation, and each has an icon of its own. The other palettes, the cloud ones among them, wait behind the ⋯ **More Palettes** button under the icons until they are opened once. A right-click on the icon of a palette that isn't used every day offers **Move to More Palettes**, which takes its icon off the rail again.

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

On a touch screen, a dock is at least as wide as the top bar's end over it, up to 35% of the window's width, so that the end's buttons fit.

### Showing and hiding palettes

The Window menu shows each palette again (including Tools and Tool Sets, Vectorworks' grids of tool buttons), hides them all, rolls them up, toggles the View, Mode and Snapping bars and resets the arrangement, which is kept per browser.

**Window › Palettes** lists every palette by its Vectorworks name, each tab of Object Info, Navigation and Visualization too (Shape, Data, Render, Design Layers, Classes, Sheet Layers, Saved Views, Lights, Cameras…). Choosing one brings it to the front, or closes it when it is in view. Object Info is also ⌘I, which shows or hides it.

A window narrower than 900 px starts with the palettes put away, the docks' rails with them, for that visit only. Showing a palette from the Window menu brings the rails back. Widening the window, or the next wide visit, brings back the saved arrangement.

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

**Window › Workspaces › Tool Sets…** rearranges the Tool Sets palette: new sets, names, order, which tools each holds. It also arranges the **Tool sets** button's menu at the end of the top bar's tools. Workspaces keep them.

### Shortcuts

**Window › Workspaces › Tool Shortcuts…** sets the key of every tool (a letter, or Shift and a letter).

**Menu Shortcuts…** sets the combination of every menu command, pressed with ⌘, and ⇧ or ⌥ if wanted. The menus, tooltips and **Help › Keyboard Shortcuts** follow it.

## View panes

### Splitting the drawing area

**View › Multiple View Panes** (or the top bar's **View panes** pop-up) splits the drawing area into two, three or four panes, all drawn at once and kept up to date as the drawing is edited, each a plan or a 3D view.

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

**Use Same Visibilities in All Panes** is greyed out: every pane shows the same layers, classes and clip cube.

Each pane has a chip in its top-left corner: "Plan", or "3D" with the standard view its camera is in ("3D · Right Isometric"), "3D" alone once the camera has left it. Its menu has **Show Plan Here**, **Show 3D Here**, the standard views (for a 3D pane) and **Close Pane**.

### The active pane

The active pane is ringed in the accent. The render mode, the zoom and Fit act on it. Top/Plan, 3D View (or the 3 key) and the standard views make the active pane one of their kind, a plan pane or a 3D pane, and only when no pane is of that kind does the active pane turn into one. A chip's **Show Plan Here** or **Show 3D Here** turns its pane into one or the other, so two plans can show the drawing at different zooms, or every pane a 3D view. The top bar's 2D and 3D buttons show one view alone and leave the split; **Split** brings the panes back as last arranged.

A click in a pane showing a picture makes it the active one, and does nothing else. A click in the other live pane, the plan or the 3D view, makes it active and then does what a click there does.

The live plan, for drawing and editing, is in the plan pane last made active, and the live 3D view, for orbiting, picking and walking, in the 3D pane last made active. Every other pane shows the drawing from its own view, kept as it was left and drawn again as the drawing or the look changes.

### Render modes in panes

Each 3D pane keeps its own render mode and projection. The top bar's **Render mode** pop-up and **View › Rendering** make the live 3D pane active, then set its render mode, and **More view options › Projection** sets the live pane's projection. The pane the live view moves to takes its own back (a new arrangement starts every pane in the one shown). A pane's picture doesn't show the selection; the live 3D view does.

A Realistic pane without the live 3D view shows the render feature's picture through its own camera, Shaded until that has loaded.

A Path Traced one refines a path-traced picture of its own, a sample a frame up to the Render palette's preview samples (**Output › Live view**, 512 at most), on a renderer the panes share, so the live view isn't drawn again meanwhile. The panes refine one at a time, each showing a Realistic picture until its turn, and start over as their camera, size, the model or the settings change.

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

### Custom Modification

**Tools › Custom Modification…** is Find and Modify with Vectorworks' **Execute** choice:

- **Execute Immediately** changes the objects found now, as Find and Modify does.
- **Create VectorScript** or **Create Python Script** writes a script that finds the objects and makes the changes. It's named and kept in a script palette, so a double-click there does it again on whatever meets the criteria then.

A script can change the class, fill and pen colour, line weight and opacity. Changing the symbol shown or the layer is Execute Immediately only.

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

### Color Palette Manager

**Tools › Utilities › Color Palette Manager…** (also at the foot of every colour picker) keeps palettes of your own beside the drawing's colours.

- Tick a palette's **Active** box to offer it in the colour pickers. **Colors in Active Document**, the drawing's own colours, is always there.
- **New…**, **Edit…**, **Duplicate** and **Delete** manage the custom palettes. **Cancel** undoes all of it.

Editing a palette, you can:

- Name it, and add or edit colours with **New…** and **Edit…**.
- Take colours from another palette with **Get…**, or from another .vwx file with **Import…**.
- **Lighten** or **Darken** the colours picked.
- Make up to 1000 colours between two picked with **RGB Blend…** or **HSV Blend…**.
- Sort the list by **Color** or **Name**, or drag colours into another order.

In a colour picker, choose an active palette above the swatches. A colour taken from it is added to the drawing's colours and applied in one undo step.

**Limits:**

- Palettes are kept in this browser, not in the drawing or your account.
- Vectorworks' standard palettes aren't included.
- **Purge Unused** isn't offered.

### List Symbols

**Tools › Utilities › List Symbols…** saves a text file of the symbol folders, each with its definitions or the folders alone, indented a tab a level.

## Origin

### Locate Internal Origin

**Tools › Origin › Locate Internal Origin** brings the window to the internal origin (0, 0) in Top/Plan, zoomed out as far as the drawing needs to stay in sight, and marks it for a few seconds.

### Center Drawing on Internal Origin

**Tools › Origin › Center Drawing on Internal Origin…** says how far the farthest object is from it and will be. It then moves every object on the design layers, hidden ones too, so the drawing's middle is on it, in one undo step. The sheets' plan viewports go on showing the same parts, and the window moves with it.

It refuses, saying why, while the drawing has elevation, section or 3D viewports or design-layer viewports (how their views would follow isn't known) or objects that can't be moved yet.

**Limits:** a user origin isn't read or kept, so coordinates change, and saved views stay where they were.
