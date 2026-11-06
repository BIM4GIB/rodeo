// The release log that ships with the editor: what each batch of work on main added, newest
// first, in the same shape as the announcements an admin posts (news.ts shows both). A body's
// first lines are its summary and its "- " lines the list of changes, both in the What's new
// window. Each release is dated noon UTC on the day it went to
// main, so it falls on that day in every time zone, with the minutes keeping a day's order. Its
// art names the line drawing at its head (banners.ts). Add a release at the top when a batch of
// work goes live.

import type { Announcement } from "../../platform/protocol.ts";
import type { Art } from "./banners.ts";

type Release = Announcement & { readonly art: Art };

const release = (date: string, id: string, title: string, body: string, art: Art): Release => ({
  id: `release-${date.slice(0, 10)}-${id}`,
  title,
  body,
  url: null,
  date,
  art,
});

export const RELEASES: readonly Release[] = [
  release(
    "2026-11-06T16:00:00Z",
    "revit-railings-curves",
    "Revit railings, basins and appliances come in",
    `More of a Revit model now comes in as Revit drew it, instead of see-through boxes.
- Railings are drawn from Revit's geometry; one that isn't read whole stays a box rather than coming in short.
- Basins and appliances with curved fronts and edges come in, such as rounded lavatories, washers, fridges and microwaves.
- RPC people and cars, which Revit keeps only as photos, are drawn as a plain figure or car body at their size, as RPC trees already were.
- A stair's own outline is no longer reported as left out: its flights and landings draw it.`,
    "walls",
  ),
  release(
    "2026-11-06T14:00:00Z",
    "revit-older-files",
    "Older Revit files and stairs come in",
    `Revit projects from Revit 2015 to 2022 now bring in the geometry Revit saved too, so their roofs, floors, columns, footings and furniture are no longer see-through boxes.
- Stairs in Revit 2022 files are drawn as Revit drew them: on a stair collection, 23 of 29 stairs now come in, where before every one was a box.
- Family instances turned off the model's axes, such as solar panels, come in as drawn.
- Floors and ceilings drawn from their sketch are solid instead of see-through.
- Railings and some curved fittings, such as basins and appliances, are still boxes.`,
    "walls",
  ),
  release(
    "2026-11-06T12:00:00Z",
    "revit-saved-geometry",
    "Much more of a Revit model comes in",
    `Revit projects saved in Revit 2023 to 2027 now bring in the geometry Revit saved for roofs, stairs, furniture, curtain wall mullions and panels, columns, footings and light fittings, where before most of these were see-through boxes.
- On Autodesk's sample house, the elements drawn as boxes fall from about 380 to about 60, and on a large tower model from 3,765 to 1,518.
- RPC trees, which Revit keeps only as photos, are drawn as a simple trunk and crown at their size instead of a big see-through box.
- Big models take a little longer to open while the extra geometry is read.
- Stairs in files from Revit 2022 and earlier are still boxes.`,
    "walls",
  ),
  release(
    "2026-11-05T12:50:00Z",
    "sketchup-many-edges",
    "Detailed SketchUp models come in",
    `SketchUp models with many loose edges now open instead of being turned away.
- Loose edges and guide points no longer count against the face limit, so a detailed model under 250,000 faces comes in whole.
- If a model has more than 250,000 loose edges and guide points, the extra ones are left out and counted in the import message, and the rest of the model still comes in.`,
    "furniture",
  ),
  release(
    "2026-11-05T12:45:00Z",
    "editing-together",
    "Editing together without undone changes",
    `People and agents editing one cloud drawing at once keep their changes.
- An agent's step that adds a class and draws no longer clashes with edits elsewhere in the drawing, and on a big drawing it goes out in kilobytes instead of hundreds of megabytes.
- Two people or agents adding classes, symbols or names at the same moment both keep theirs; a class both add under one name becomes one class.
- Only two changes to the same thing at once still clash, and the later one is undone with a message.`,
    "cursors",
  ),
  release(
    "2026-11-05T12:40:00Z",
    "tabs-agents",
    "Tabs, with an agent in each",
    `Work on several drawings at once: each opens in a tab, and each tab has an agent of its own.
- The tab strip now shows as soon as a drawing is open; its + starts a new drawing or opens one.
- Start an agent in one drawing, switch tabs and start another: both keep working.
- Each tab shows what its agent is doing: at work, waiting for you to bring the tab to the front, or finished.
- The Agents panel names the drawing its chat works in, and the agents at work in your other tabs.`,
    "agent",
  ),
  release(
    "2026-11-05T12:32:00Z",
    "agent-big-drawings",
    "Smoother agent sessions on big drawings",
    `Rodeo stays responsive while an agent works in a large drawing.
- The timelapse keeps only what each edit changed, so an agent's step no longer freezes the editor for a second or more while it is recorded, and its history takes kilobytes instead of hundreds of megabytes.
- Replaying the timelapse of a large drawing no longer fails.
- The agents keep their models light: ivy, leaves and stone get textures instead of hundreds of thousands of triangles, so what they build stays quick to edit.`,
    "speed",
  ),
  release(
    "2026-11-05T12:31:00Z",
    "shaded-textures",
    "Textures show in Shaded",
    `The 3D view's Shaded mode now draws textures from the start, as renders do.
- Turn them off in View > Rendering > Shaded Options… if a drawing has too many.
- Shaded Options are now remembered in your browser, for every drawing.`,
    "sphere",
  ),
  release(
    "2026-11-05T12:30:00Z",
    "agent-sign-in",
    "Connect Claude and ChatGPT by signing in",
    `Add Rodeo to Claude, Claude Code, Cursor or ChatGPT with its address and sign in: no token to copy.
- In Claude: Settings › Connectors › Add custom connector with https://rodeo.build/mcp. It works in claude.ai and the desktop and phone apps.
- In Claude Code: claude mcp add --transport http rodeo https://rodeo.build/mcp, then /mcp to sign in.
- Rodeo shows which app is asking and where it sends you before you press Allow.
- Window › Connect an Agent… lists the apps you connected and when each was last used, and Remove ends one at once.`,
    "agent",
  ),
  release(
    "2026-11-05T12:25:00Z",
    "branches",
    "Branches, compare and merge",
    `Try ideas on a branch of a cloud drawing, see exactly what changed, and merge it back.
- File › Branches › New Branch… starts a branch instantly; the chip beside the drawing's name switches between Main and its branches.
- Compare… shows the drawing against Main, a branch, a saved version or a file: added in green, changed in amber, removed as red ghosts, with an onion-skin slider and a list of every change.
- Merge requests with a description, discussion and approvals; Merge… combines the drawings object by object and asks only about objects changed on both sides.
- Blame colours every object by who last changed it.`,
    "cloud",
  ),
  release(
    "2026-11-05T12:24:00Z",
    "voice-commands",
    "Voice commands",
    `Hold Space, say what to do, and click to point while you speak: Rodeo's agent does it.
- "Move this door here", "make that wall 200 thicker", "what's on this layer?": the agent gets your words, the selection and the pins you dropped, and its changes undo in one step.
- Works in Chrome, Edge and Safari, and in Firefox and Brave, where Rodeo's server turns your speech into text.
- Needs you signed in, and uses AI credit as the Agents panel does. Tools › Voice Commands… sets the key, the language and the agent's model; touch screens get a microphone button.`,
    "agent",
  ),
  release(
    "2026-11-05T12:23:00Z",
    "connect-an-agent",
    "Connect your own agent",
    `Claude Code, Claude Desktop, Cursor and other AI agents can work in your open drawing while you watch.
- Window › Connect an Agent… makes a token and shows the line to paste into your agent.
- The agent reads, looks at, edits, builds, renders and exports with the Agents panel's tools, on its own AI account: no Rodeo credit.
- A pill in the top bar says what it is doing, with Stop and Resume, and keeps the files it made.
- npx -y @rodeo.build/cli mcp runs Rodeo for agents on files on your computer, no browser needed.`,
    "agent",
  ),
  release(
    "2026-11-05T12:22:00Z",
    "converter",
    "Convert files without opening them",
    `Rodeo converts CAD and 3D files: in your browser at rodeo.build/convert, or with one command.
- Drop Revit, DWG, DXF, SketchUp, IFC, Rhino, Archicad, Vectorworks and other files on rodeo.build/convert and download IFC, PDF, DXF, glTF, OBJ, STL, SketchUp, STEP and more. Nothing is uploaded.
- A preview shows what came in, in 3D or in plan, with its units, layers, objects and size.
- Open in Rodeo takes a converted file into the editor. File › Convert Files… opens the converter.
- npx @rodeo.build/cli convert model.rvt model.ifc converts on your own computer, a folder at a time with --to and --out.`,
    "announce",
  ),
  release(
    "2026-11-05T12:21:00Z",
    "gallery",
    "The Rodeo Gallery",
    `Publish a cloud drawing to the public gallery, and fork anyone's into your own drawings in one click.
- File › Publish to Gallery… puts a snapshot of the saved version in the gallery, with a title, tags, a cover and a licence (CC BY 4.0 unless you choose another).
- rodeo.build/gallery lists them by trending, newest or most forked, with search and tags; each has a viewer, Download and Fork.
- A fork keeps its credit: the top bar shows what it was forked from, and published forks show in the original's remix tree.
- Unpublish at any time; Report sends a drawing to Rodeo's admins.`,
    "announce",
  ),
  release(
    "2026-11-05T12:20:00Z",
    "embed-anywhere",
    "Embed drawings anywhere",
    `Share links are free for everyone, show a picture of the drawing wherever they are pasted, and drawings embed in any page.
- Pasted into Slack, Discord, iMessage, X or LinkedIn, a share link shows the drawing's name and a picture of it.
- Share… makes a still and a turning picture for each link, and gives the link, the embed code, a web component and Markdown.
- Embeds start in 2D or 3D, on a layer or sheet or from a view you choose, can turn slowly, and work on phones.
- Notion, Medium and Ghost can embed a link through oEmbed, and pages can steer an embed with messages.
- Shared drawings that allow downloads have Edit a Copy, and ?url= opens a public file from GitHub and similar sites.`,
    "cloud",
  ),
  release(
    "2026-11-04T12:19:00Z",
    "script-symbol-calls",
    "Script calls for symbols",
    `Python scripts and Vectorscripts can place symbols and read where they stand.
- Symbol places a symbol by name at a point, turned, on the active layer.
- GetSymLoc and GetSymRot read a symbol's or plug-in object's insertion point and rotation.
- SetActSymbol picks the Symbol tool's symbol, and SymbolToGroup turns an instance into a group.`,
    "announce",
  ),
  release(
    "2026-11-04T12:18:00Z",
    "script-criteria-functions",
    "Script criteria functions",
    `Python scripts and Vectorscripts can measure everything that matches search criteria.
- Area, Perim, Length, Width and Height add up the matching objects; XCenterN and YCenterN average them.
- LeftBoundN, RightBoundN, TopBoundN and BotBoundN give their extremes, and ObjectType their type.
- Area2Str, Str2Area, Volume2Str and Str2Volume write and read areas and volumes in the drawing's units.`,
    "announce",
  ),
  release(
    "2026-11-04T12:17:00Z",
    "script-shape-editing",
    "Script calls that reshape",
    `Python scripts and Vectorscripts can change shapes they're handed, and the selection.
- Move, add and delete a polygon's or polyline's vertices, open or close it: SetPolyPt, InsertVertex, DelVertex, SetPolylineVertex, SetPolyClosed.
- A line's ends, an arc's angles and a rounded rectangle's corners: SetSegPt1, SetArc, SetRRDiam.
- FlipHor, FlipVer, Scale, Forward, Backward, MoveFront and MoveBack on the selection.`,
    "announce",
  ),
  release(
    "2026-11-04T12:16:00Z",
    "script-text-calls",
    "Script calls for text",
    `Python scripts and Vectorscripts can read and style text objects.
- Size, font, bold, italic and underline, justification, angle and text style: SetTextSize, SetTextFont, SetTextStyle, SetTextJust, SetTextOrientation and more.
- TextFont, TextFace and TextRotate style the texts CreateText makes.
- Fixed: what a script prints now shows where you ran it, not where the first script ran.`,
    "announce",
  ),
  release(
    "2026-11-04T12:15:00Z",
    "script-classes-layers",
    "Script calls for classes and layers",
    `Python scripts and Vectorscripts can change classes, layers and the attributes new objects take.
- A class's fill, pen, line weight and opacity: SetClFPat, SetClLW, SetCLOpacityN, GetClFillFore and more.
- RenameClass, DelClass, Class and Layer Options, CreateLayer, and a layer's scale, elevation and visibility.
- What a script draws now takes the Attributes palette's settings, as in Vectorworks.`,
    "announce",
  ),
  release(
    "2026-11-04T12:14:00Z",
    "script-math-geometry",
    "More script calls",
    `Python scripts and Vectorscripts get Vectorworks' math, string, vector and 2D geometry calls, over 300 calls in all.
- Sqrt, Round, SubString, Num2StrF and the rest of the math and string calls.
- Vectors: Ang2Vec, Vec2Ang, CrossProduct, DotProduct, UnitVec and more.
- Geometry: LineLineIntersection, CircleCircleInters, PtOnLine, PtInPoly, Centroid and more.`,
    "announce",
  ),
  release(
    "2026-11-04T12:13:00Z",
    "custom-tool-attribute",
    "Custom Tool/Attribute",
    `Tools > Custom Tool/Attribute saves a way of drawing as a script.
- It records an object's fill, pen, opacity and line weight, text size and alignment, class, layer and the tool you're using.
- Double-click the script in its palette to set them all again, ready to draw.
- Scripts that set attributes or call SetTool now leave them set after they run, as in Vectorworks.`,
    "announce",
  ),
  release(
    "2026-11-04T12:12:00Z",
    "custom-modification-scripts",
    "Custom Modification and selection scripts",
    `Custom Selection can now write its search as a VectorScript or Python script, as Vectorworks does.
- The script is kept in a script palette: double-click it to make the same selection again.
- Tools > Custom Modification finds objects and changes their class, colours, line weight or opacity, now or as a script.
- Scripts run in Rodeo and export to Vectorworks.`,
    "announce",
  ),
  release(
    "2026-11-04T12:11:00Z",
    "generate-paperwork",
    "Generate Paperwork",
    `Stage > Lighting Paperwork > Generate Paperwork writes your lighting paperwork into the drawing as worksheets.
- Instrument Schedule, Channel Hookup and Dimmer Hookup, with the columns, order and widths you choose.
- Shop Order, Gobo Pull and a Color Cut List, by position if you like.
- Designer, event name and date in each page's header, and a magic sheet on its own layer.`,
    "announce",
  ),
  release(
    "2026-11-04T12:10:00Z",
    "import-image-files",
    "Import Image File(s)",
    `File > Import > Import Image File(s) brings in several pictures at once.
- One Image Import Options dialog for all of them: JPEG or PNG, with the size each makes.
- Import as black and white, or keep the alpha channel.
- Dropped pictures go through the same dialog and land in a row.`,
    "announce",
  ),
  release(
    "2026-11-04T12:09:00Z",
    "export-ascii-patch",
    "Export ASCII Patch",
    `File > Export > Export ASCII Patch writes your lighting patch for a console.
- Choose whether the console's existing patch is cleared.
- Multi-channel devices are patched in sequence.`,
    "announce",
  ),
  release(
    "2026-11-04T12:08:00Z",
    "color-palette-manager",
    "Color Palette Manager",
    `Tools > Utilities > Color Palette Manager keeps colour palettes of your own.
- Make palettes, blend and lighten colours, or import a drawing's colours.
- Active palettes show in every colour picker.`,
    "announce",
  ),
  release(
    "2026-11-04T12:07:00Z",
    "create-sheet-list",
    "Create Sheet List",
    `Tools > Reports > Create Sheet List makes an index of the drawing's sheets.
- Pick title blocks, add your own entries, reorder and edit them.
- Place it as text by two clicks, or make it a worksheet.`,
    "announce",
  ),
  release(
    "2026-11-04T12:06:00Z",
    "reset-view-panes",
    "Reset Multiple View Panes",
    `View > Multiple View Panes > Reset Multiple View Panes tidies a layout that's got out of hand.
- Back to four panes, dividers halfway, each in its standard view.
- Floating view panes close.`,
    "announce",
  ),
  release(
    "2026-11-04T12:05:00Z",
    "align-by-increment",
    "Align by Increment",
    `Modify > Align > Align by Increment… rounds the selected objects' positions.
- Put lighting devices on 6" marks, or anything on the snap grid.
- Align X, Y and Z by insertion point or centre, in one undo step.`,
    "announce",
  ),
  release(
    "2026-11-04T12:04:00Z",
    "render-bitmap",
    "Render Bitmap",
    `The Render Bitmap tool turns part of the view into a picture on the drawing.
- Drag round an area in Top/Plan or the 3D view, or click for the whole window.
- Its preferences set the render mode, the resolution and a clear background.`,
    "announce",
  ),
  release(
    "2026-11-04T12:03:00Z",
    "roof-face",
    "Roof Face",
    `AEC > Roof Face turns a closed shape into one sloping roof plane.
- Click its axis and the side that rises, or give the height of a second click.
- Change its angle, cuts and levels in Object Info, and cut holes with Clip Surface.`,
    "announce",
  ),
  release(
    "2026-11-04T12:02:00Z",
    "walkthrough-saved-views",
    "Walkthroughs from saved views",
    `Saved views made in the 3D view now keep the camera, and open in 3D through it.
- Model › Create Animation › Create Walkthrough Path from Saved Views… takes the camera from one to the next.
- Pick the views and their order in its two lists.`,
    "announce",
  ),
  release(
    "2026-11-04T12:01:00Z",
    "animation-paths",
    "Animation paths to play",
    `Model › Create Animation now makes an animation path that stays in the drawing.
- Play it in the 3D view, move along it with Time, or look through its camera.
- Add and delete keyframes, and set each one's speed and view angle.
- Create Movie… records it, now with a time range and your own frame size.`,
    "announce",
  ),
  release(
    "2026-11-04T12:00:00Z",
    "agents-parts-streaming",
    "Agents model products, and the chat streams smoothly",
    `The Agents chat keeps up with the agent as it works, and agents model products and machine parts as closed solids.
- The chat follows the newest message as it streams, an open Thinking block too; scroll up to read and the arrow at its foot brings you back
- While the agent thinks, a line shows what it is on, and once it's done how long it thought
- Agents build each part of a product (a housing, a bracket, a lid) as one closed solid with its holes, slots and pockets cut, ready to export as STL
- Solids joined and cut in 3D come out closed with far fewer faces, and a solid made by adding parts shows its own colour
- Agents colour objects and hide layers as Vectorworks does, and tell you what is wrong instead of retrying the same fix`,
    "agent",
  ),
  release(
    "2026-11-03T13:21:00Z",
    "delete-dimension",
    "Delete Dimension on chains",
    `Right-click a dimension in a chain and choose Delete Dimension.
- That dimension goes, and the ones after it move back to close the gap.
- Each keeps its length and value; a chain of two leaves a lone dimension.`,
    "announce",
  ),
  release(
    "2026-11-03T13:20:00Z",
    "associative-dimensions",
    "Dimensions that follow",
    `A linear dimension drawn between two objects' corners now follows them when they move or change shape.
- It measures again, and keeps its distance from them.
- Right-click it and choose Disassociate to let it stay put.`,
    "announce",
  ),
  release(
    "2026-11-03T13:19:00Z",
    "image-effects",
    "Image effects",
    `Right-click an image and choose Edit Image Effects… to adjust it with a live preview.
- Exposure, contrast, highlights, shadows, saturation, temperature, blur and sharpness, sepia and soft edges.
- Invert Colors, Auto-Level and Reset; several images at once.`,
    "announce",
  ),
  release(
    "2026-11-03T13:18:00Z",
    "update-viewports",
    "Update section and elevation viewports",
    `View › Update Selected Viewports and Update All Viewports redraw section, elevation and multiple-view viewports from the model as it is now.
- Right-click a viewport and choose Update to redraw just that one.
- Notes and dimensions you added in the viewport's annotations stay put.`,
    "announce",
  ),
  release(
    "2026-11-03T13:17:00Z",
    "duplicate-on-layers",
    "Duplicate title block borders on layers",
    `Right-click a title block border and choose Duplicate on Layers… to copy it to every layer you tick.
- The dialog lists the layers that don't have a title block border yet.
- On a sheet, the copy's sheet number and title become that sheet's.`,
    "announce",
  ),
  release(
    "2026-11-03T13:16:00Z",
    "multiple-viewports",
    "Create Multiple Viewports",
    `View > Create Multiple Viewports… (⇧⌘M) draws the model's Front, Top, side, Bottom, Back and isometric views as viewports on a sheet.
- Lay them out by first or third angle projection, lined up with Front.
- Pick any of the seven views and one scale for all of them.`,
    "announce",
  ),
  release(
    "2026-11-03T13:15:00Z",
    "horizontal-section",
    "Create Horizontal Section Viewport",
    `View > Create Horizontal Section Viewport… cuts the model level at a height and draws the plan it makes on a sheet.
- Walls and anything else the cut passes through are filled; what lies below is drawn in thin lines.
- Set the cut height above the active layer, and how far down to look.`,
    "announce",
  ),
  release(
    "2026-11-03T13:14:00Z",
    "interior-elevations",
    "Create Interior Elevation Viewport",
    `View > Create Interior Elevation Viewport… draws a room's walls as up to four elevations on a sheet.
- Select an Interior Elevation Marker, or a shape drawn round the room; each way it points becomes a North, East, South or West elevation.
- Each runs from wall to wall and floor to ceiling, with what stands in the room drawn in front of the wall.
- Section viewports now leave alone anything that only touches the cut, like a cupboard against the wall behind.`,
    "announce",
  ),
  release(
    "2026-11-03T13:13:00Z",
    "section-viewport",
    "Create Section Viewport",
    `View > Create Section Viewport… draws a section through the 3D model on a sheet.
- Select a Section-Elevation Line, or a plain line, and pick the side to look at; a section line's arrows choose it for you.
- What the line cuts is filled; what lies beyond is drawn in thin lines where nothing nearer hides it.
- It is named by drawing and sheet number, with a drawing label, and one undo takes it back.`,
    "announce",
  ),
  release(
    "2026-11-03T13:12:00Z",
    "iges-export",
    "Export IGES",
    `File > Export > Export IGES (3D only)… writes the 3D model as IGES 5.3, for CAD programs that take it.
- Objects whose faces close round them become solids; the rest become trimmed surfaces.
- Tick Export Solid as Trimmed Surfaces to make every face a surface of its own.
- Names, colours and layers carry over, in millimetres; curved surfaces go faceted as the 3D view draws them.`,
    "announce",
  ),
  release(
    "2026-11-03T13:11:00Z",
    "step-export",
    "Export STEP",
    `File > Export > Export STEP (3D only)… writes the 3D model for mechanical CAD programs.
- Each object becomes a solid where its faces close round it, else a set of surfaces, named and coloured as in Rodeo.
- Tick Export Solid as Trimmed Surfaces to make every face a body of its own.
- Design layers carry over as layers, in millimetres; curved surfaces go faceted as the 3D view draws them.`,
    "announce",
  ),
  release(
    "2026-11-03T13:10:00Z",
    "detail-viewports",
    "Create Detail Viewport",
    `View > Create Detail Viewport… turns a closed shape drawn round part of a plan into a viewport of just that part, at its own scale.
- Draw the shape on a design layer, or on a sheet over a plan viewport to blow up part of it.
- The viewport is named by its drawing and sheet numbers and placed beside what's already on its sheet.
- A callout bubble round the shape and a drawing label under the viewport are added for you.`,
    "announce",
  ),
  release(
    "2026-11-03T13:09:00Z",
    "simple-vectorscript-3d",
    "Export Simple VectorScript (3D only)",
    `File > Export > Export Simple VectorScript (3D only)… writes the 3D model as a plain script.
- Each flat face becomes a 3D polygon, each object's faces a group, in Front view or the view you're looking from.
- Other programs can read it, and Import Script runs it back into a drawing.
- Scripts can now draw 3D polygons themselves with Poly3D, or BeginPoly3D, Add3DPt and EndPoly3D.`,
    "announce",
  ),
  release(
    "2026-11-03T13:08:00Z",
    "lighting-device-menu",
    "Lighting device right-click menu",
    `Right-click a lighting device for Spotlight's own commands.
- Select the devices of the same type, at the same position, or the hanging position it's on.
- Swap two selected devices: they trade places, with the circuit, dimmer and patch staying or moving as you choose.
- Remove from Hanging Position, and Refresh Lighting Devices (⌘/) to redraw every device and position.`,
    "gears",
  ),
  release(
    "2026-11-03T13:07:00Z",
    "inventory-equipment-list",
    "Inventory and Equipment List",
    `Stage > Lighting Paperwork > Inventory and Equipment List… checks the equipment in a drawing against what you have.
- Make an inventory from a drawing of everything a vendor, venue or warehouse holds, and set each item's stock.
- Assign each item a source and see what's left, in red where there isn't enough.
- Put the list in a worksheet, and share inventories as .xml files.`,
    "records",
  ),
  release(
    "2026-11-03T13:06:00Z",
    "roof-framer",
    "Roof Framer",
    `AEC > Framing > Roof Framer… frames a selected roof in one step.
- Rafters down each slope, evenly spaced, with jack rafters at the hips and valleys.
- Ridges, hips and valleys where the slopes meet, with purlins and plates if you want them.
- Works on roofs opened from Vectorworks files as well as roofs made with Create Roof.`,
    "gears",
  ),
  release(
    "2026-11-03T13:05:00Z",
    "spotlight-render-options",
    "Spotlight rendering options",
    `Stage > Visualization > Set Spotlight Rendering Options… sets up the 3D view and renders for a lit stage in one dialog.
- Cast shadows, and Lit fog with how thick the haze is, so the lights' beams show in the air.
- The renders' sky, indirect lighting, ambient light and how bright the lights are.`,
    "camera",
  ),
  release(
    "2026-11-03T13:04:00Z",
    "light-scenes",
    "Lighting scenes",
    `Stage > Visualization > Manage Scenes… saves the lighting as a scene and brings it back.
- A scene keeps every lighting device's colour, position, height and focus point, and each channel's level, with a name, number, Up Time and Down Time.
- Go! puts a scene back in one step; Undo takes it off again.
- Animate Scenes… makes a movie of the fade from one scene to another, holding each as long as you say.`,
    "announce",
  ),
  release(
    "2026-11-03T13:03:00Z",
    "create-3d-from-2d",
    "Create 3D Object From 2D",
    `AEC > Machine Design > Create 3D Object From 2D turns the selected 2D machine parts into their 3D versions.
- Gears, sprockets, pulleys, bearings, springs, keys, chains, fasteners, holes and steel sections come out with the same sizes, where the 2D part is.
- Select several at once; one undo takes them all back.
- Parts placed from now on remember their settings for this. Anything else selected is deselected.`,
    "gears",
  ),
  release(
    "2026-11-03T13:02:00Z",
    "3d-properties",
    "3D Properties",
    `AEC > Machine Design > 3D Properties… measures the selected 3D objects: surface area, volume, radii of gyration and centre of mass.
- Calculate Mass Properties… takes a density or specific gravity, in pounds and inches or kilograms and metres, and adds the mass, weight and mass moments of inertia.
- Place a 3D locus at the centre of mass, place the list on the drawing, or save it as a text file.
- Model > Volumetric Properties… can now place the centre-of-mass locus too.`,
    "gears",
  ),
  release(
    "2026-11-03T13:01:00Z",
    "spring-calculator",
    "Spring Calculator",
    `AEC > Machine Design > Spring Calculator… works out a coil compression spring's rate and unit stress as you type.
- Give the outside or mean diameter, the wire diameter, and the solid height or number of active coils. The rest is filled in.
- Pick the type of ends and a wire material, or type a modulus. Results come in inches and pounds or in millimetres and newtons.
- Tick Place 2D or Place 3D spring and the Compression Spring 2 tool is ready to draw it with your next click.`,
    "gears",
  ),
  release(
    "2026-11-03T13:00:00Z",
    "dmx-patch",
    "DMX Patch",
    `Stage > Lighting > DMX Patch… lists every lighting device's channel, universe and DMX address, and shows where two devices clash.
- Problems are named in the list: an overlap, an identical patch, a conflict on the same address, or a device running past address 512. Find Next Conflict steps through them.
- Patch numbers the selected devices from a start channel, universe and address, moving each address on by the device's footprint. It asks before unpatching any device it would land on. Unpatch clears the selected ones.
- A diagram colours each universe's 512 addresses by problem. Drag a device in it to move it.`,
    "records",
  ),
  release(
    "2026-11-03T12:59:00Z",
    "legend-from-device",
    "Label legend from a lighting device",
    `Stage > Lighting > Create Label Legend from Lighting Device… makes a new label legend from a selected device's labels.
- A device with a legend gets a copy of it, named after the original with -1 on the end. A device using Rodeo's own labels gets a legend of the labels it currently shows.
- The device switches to the new legend, ready to edit in the Label Legend Manager.`,
    "records",
  ),
  release(
    "2026-11-03T12:58:00Z",
    "dimension-exterior-walls",
    "Dimension exterior walls in one go",
    `AEC > Dimension Exterior Walls… dimensions the outside of every building on a layer.
- On each side you get a chain through the doors and windows, then one through every corner and jog, then the overall size, each further out. A chain that adds nothing to the next one is left out.
- Measure to the outer faces or to the wall centrelines, and to the edges or centres of openings. Interior walls that meet the outside walls can be dimensioned too.
- Any span shorter than a limit you set is drawn in red, which helps you spot a wall slightly out of line. You can also choose to leave those spans out.`,
    "walls",
  ),
  release(
    "2026-11-03T12:57:00Z",
    "label-legends",
    "Label legends for lighting devices",
    `You can now choose what each lighting device's labels show, and where they go.
- Stage > Lighting > Label Legend Manager… keeps your drawing's label legends. Each one picks from 15 fields, such as channel, unit number, position, colour, gobo, dimmer, circuit, DMX address and wattage. For each field you set where it sits around the device, a container (circle, oval, rectangle, hexagon or diamond), whether it stays level, and its size.
- The active legend goes on lighting devices as you place them. Edit a legend and every device using it is redrawn.
- Assign Legend to Lighting Devices… and Use Legend in Object Info change the legend on devices you've already placed.`,
    "records",
  ),
  release(
    "2026-11-03T12:56:00Z",
    "revit-openings-symbols",
    "Revit doors cut their walls",
    `Revit projects now open with their doors and windows cut through their walls, and repeated families as symbols.
- A wall's doors and windows cut their openings through its 3D, and its plan is broken where they are, cut 1.2 m up as Revit's plans are.
- A wall whose profile was edited in Revit keeps its shape: its sloped top, gable or cut-outs.
- Archicad projects' doors and windows now cut their walls the same way.
- A family type placed more than once comes in as one symbol, placed wherever its instances stood, turned or flipped. Instances that differ, such as a door in a thicker wall, get a symbol each.
- Colours from the file are exact, added to the drawing's colours.
- The doors and windows aren't Rodeo door and window objects yet. Editing an imported wall's heights or ends stretches its openings with it.`,
    "filecheck",
  ),
  release(
    "2026-11-03T12:55:00Z",
    "3d-symbols",
    "Symbols travel through Rhino, FBX and Collada",
    `Symbols now go out to Rhino, FBX and Collada as one definition placed many times, and come back the same way, instead of as a copy at every place.
- Rhino exports write each symbol as a block and each instance as a block instance where it stands, turned, mirrored or scaled. Symbols inside symbols stay nested.
- Collada exports write each symbol once and place it at each instance, as SketchUp writes its components. FBX exports write each symbol's meshes once and share them between its instances, which Blender opens as linked duplicates.
- A Rhino file's blocks, a Collada file's instanced nodes and an FBX file's shared meshes (Blender's linked duplicates among them) now come in as symbols placed at each instance, keeping their names and colours.
- Blender 4 puts symbols inside symbols in a Collada file in the wrong place, as it does SketchUp's nested components. Use FBX for Blender.`,
    "furniture",
  ),
  release(
    "2026-11-03T12:54:00Z",
    "file-check-reports",
    "Report a file that came in wrong",
    `After you open or import a file, Rodeo asks whether it looks right, and one click reports it if not.
- The question comes a moment after a drawing, DWG, DXF, PDF, Revit or Archicad project, model or worksheet comes in, and straight away if it couldn't be read. Close it and it won't ask about that file again.
- Report a problem opens with a screenshot of the window and the file ticked, so we can open it ourselves and see what you saw. Untick either before sending.
- Pick what's wrong (objects missing, wrong place or size, colours, text, 3D, slow) and add a line about where, or send it with no words at all.
- Large files go up in parts, with how far along they are. Screenshots and files are seen only by the Rodeo team and deleted after 90 days.`,
    "camera",
  ),
  release(
    "2026-11-03T12:53:00Z",
    "sketchup-export",
    "Export SketchUp files",
    `File > Export SketchUp writes the 3D model of your visible design layers as a SketchUp file (.skp), in the format SketchUp used from 2013 to 2020.
- Each symbol becomes a component, defined once and placed where the drawing places it, turned, mirrored or scaled, inside other components too.
- Each object becomes a group named after it, and the groups inside it stay groups. A symbol placed on its own goes out as that component.
- Classes become tags, and a hidden class a hidden tag. Colours, see-through fills and PNG or JPEG textures become materials, each texture laid on its faces as the 3D view lays it.
- Walls, extrudes, solids and the other objects the 3D view draws as triangles go out as whole faces again, holes and all, with the edges across a curved surface softened so it reads smooth.
- 3D polygons go out as edges and 3D loci as guide points. Lights, text, dimensions and 2D objects are left out.`,
    "furniture",
  ),
  release(
    "2026-11-03T12:52:00Z",
    "archicad-projects",
    "Open Archicad projects",
    `Drop an Archicad project on Rodeo and it opens as a drawing, no Archicad and no IFC export needed.
- Drop a .pln project, .pla archive or .tpl template saved by Archicad 25 to 29, or pick it with File > Open. It opens as a new drawing named after the project.
- Each story becomes a story with its own design layer at the story's level, and each Archicad layer a class, hidden when the layer is.
- Straight walls come in as walls you can edit, on their centreline with their thickness and heights. Slabs come in at their outline and thickness.
- Roofs, meshes, morphs, beams, columns, curtain walls and curved or slanted walls come in as 3D, in their surfaces' colours.
- Floor plan lines, arcs, polylines, splines, fills, text, dimensions and zones come in as 2D in their pens' colours and weights.
- Doors, windows and objects come in at their size as see-through boxes, with their library part's parameters as records. Archicad keeps their shapes as GDL scripts, which Rodeo doesn't run yet, and doors and windows don't cut their walls yet.
- Hotlinked modules come in wherever they're placed.
- Lines, text, fills and dimensions drawn in sections, elevations, details and worksheets come in on hidden design layers of their own, and layouts' on sheet layers.
- Shells, stairs' and railings' 3D and cameras aren't brought in yet, and a note says how many were left out. Nor are the section and elevation cuts Archicad makes from the model.`,
    "filecheck",
  ),
  release(
    "2026-11-03T12:51:00Z",
    "event-create-room-views",
    "Event rooms and client views",
    `Two more commands under Stage > Event finish the event setup.
- Create Room puts walls around a selected shape, which marks the inside of the room, and adds a floor underneath. The walls can be plain at any thickness or use one of your drawing's wall styles. They meet at mitred corners and stand at the height you set.
- Create Views makes a Plan View sheet with a plan viewport of your layout, and a Rendered View sheet with a shaded isometric picture of the model. A brand-new drawing can't hold pictures yet, so in one of those you get the Plan View sheet only.`,
    "walls",
  ),
  release(
    "2026-11-03T12:50:00Z",
    "event-create-stage-stair-screen",
    "Build an event stage in a few clicks",
    `Stage > Event has three new commands for laying out an event.
- Create Stage fills a selected shape with standard stage decks, using stage plugs where the edge cuts them, and stands it up in 3D at the height you set. It can be simple blocks or decks on legs, with doubled-up legs removed where decks meet.
- Create Stair asks for a width and style, then places steps with two clicks. They meet the top of the stage behind them.
- Create Screen places a projection screen, LED screen or TV with two clicks: where it goes, then which way it faces.`,
    "solids",
  ),
  release(
    "2026-11-03T12:49:00Z",
    "convert-replace-lighting-devices",
    "Lighting devices from your own symbols",
    `Lighting devices can now show a symbol from your drawing in place of the generic outline.
- Stage > Lighting > Convert To Lighting Device turns selected symbols into lighting devices, where they were and aimed the way they were turned.
- Stage > Lighting > Replace Lighting Devices… swaps the selected devices, or all of them, for another generic type or one of the drawing's symbols. Channels, unit numbers, patch, colour and focus stay as they were.
- Each device's Symbol in Object Info picks a symbol or the generic outline, and its labels sit round whichever it shows.`,
    "records",
  ),
  release(
    "2026-11-03T12:48:00Z",
    "spotlight-numbering",
    "Spotlight Numbering",
    `Stage > Lighting > Spotlight Numbering… numbers lighting devices, or any plug-in object or record, in one or more fields at once.
- Pick the object type and the fields to number, each with its own start (numbers or letters), prefix, suffix and step, or the same value for all.
- Number DMX addresses by each device's footprint: when a universe is full, numbering moves on to the next one.
- Restart at a limit, or stop at one and set the numbering for the rest. Several objects can share each number.
- Selected objects are numbered left to right, top to bottom, or zigzag. With nothing selected, click them one by one; Shift-click repeats the last number.`,
    "records",
  ),
  release(
    "2026-11-03T12:47:00Z",
    "connectcad-adapter-slot",
    "Adapter slots",
    `The Adapter Slot tool (ConnectCAD Layout) puts slots for plug-in modules in equipment.
- Click an equipment item to open its front or rear, then click to place slots: one at a time, or a row or a block with Linear Array and Rectangular Array.
- Pick one of the device's sockets for each slot and it shows the adapter on that socket; slots with none show the type you give them, or a cross.
- Slots show in 3D, in equipment detail views and in rack elevations. Change or delete them from the same window, or from the item's Adapter Slots button in Object Info.`,
    "plug",
  ),
  release(
    "2026-11-03T12:46:00Z",
    "revit-models",
    "Open Revit projects",
    `Drop a Revit project on Rodeo and it opens as a drawing, no Revit and no IFC export needed.
- Drop a .rvt saved by Revit 2015 to 2027, or pick it with File > Open. It opens as a new drawing named after the project, in its units.
- Each level becomes a story with its own design layer at the level's height, and each Revit category a class: Walls, Floors, Doors, Windows, Furniture and the rest.
- Walls come in as walls you can edit, with their thickness, heights and layers. Floors come in at their outline and thickness, and rooms as their outline and name.
- Doors, windows, curtain walls, furniture, fixtures, ducts and pipes come in as 3D in their materials' colours.
- Every element keeps its Revit parameters as records: family, type, element ID, sizes, areas, volumes, constraints, marks, fire ratings and the rest.
- Some elements' shapes can't be read yet. They come in as see-through boxes, and a note says how many. Doors and windows don't cut their walls yet.
- A Revit family (.rfa) or template shows its version, category, types and thumbnail.`,
    "filecheck",
  ),
  release(
    "2026-11-03T12:45:00Z",
    "stage-lighting",
    "Stage lights that light up",
    `Lighting devices now light the 3D view and renders, and you can see their beams.
- Light On, colour, Brightness, Field and Beam Angle, and Pan and Tilt now take effect, with the light coming from the front of the fixture.
- Stage > Lighting > Dark Stage turns the sun off, darkens the sky and opens the exposure; turning it off puts back what you had.
- A Haze slider, in Visualization and the Render palette, shows each lit spot as a beam that stops at the first surface it hits.
- Object Info for a lighting device puts the light's settings first, groups the rest into Instrument, Patch, Load and Aim and Beam, and folds the long list under All Parameters.
- Agents can set the sun, sky, haze and exposure, switch, colour, dim and aim many lights at once, and frame looks and renders in perspective.
- A part placed tens of thousands of times, like a hoist's chain links, is drawn with fewer triangles, so a big rig's 3D view fits in memory.
- Drawings whose fills come from their classes, and Hidden Line viewports on sheets, now draw the way Vectorworks prints them.`,
    "reflection",
  ),
  release(
    "2026-11-03T12:44:00Z",
    "3d-names-colours-groups",
    "3D imports and exports keep names, colours and groups",
    `3D files you bring in and send out keep more of what's in them.
- Imported objects keep their names from the file, so a chair comes in called Chair. Names in a drawing must differ, so a second one becomes Chair 2.
- Colours in 3D files, SketchUp's included, come in exactly: a colour the drawing doesn't have is added to its colours instead of swapped for the nearest one.
- Rhino, FBX and Collada exports write each object in a group as an object of its own, with its own name, inside the group, and groups inside groups stay nested. Before, a whole group went out as one object.`,
    "furniture",
  ),
  release(
    "2026-11-03T12:43:00Z",
    "dwg-import",
    "Open AutoCAD DWG files",
    `Rodeo now reads AutoCAD's own .dwg files, with no need to save them as DXF first: every release from R13 to the 2018 format AutoCAD still saves today.
- Open one with File > Open or drop it on the start screen and it opens as a new drawing. File > Import DWG… brings one into the drawing you have open.
- Lines, arcs, circles, ellipses, polylines, splines, points, text, blocks (dynamic blocks too), dimensions, leaders, tables and hatches come in at the drawing's own size, each DWG layer becoming a class.
- Objects keep their colour (the nearest in your palette) and line weight. Solid and gradient hatches come in filled, patterned ones as their lines, and layers that are off or frozen become hidden classes. Dashed line types come across when your drawing already has a line type to copy.
- Multileaders, 3D solids, images and xrefs are left out for now, and the import says how many. A drawing with nothing in model space comes in from its paper space.
- DXF import gets all of this too, and more care besides: hidden parts of dynamic blocks stay hidden, splines drawn through points follow AutoCAD's curve, arc dimensions and tables now come in, and big drawings come in many times faster.`,
    "filecheck",
  ),
  release(
    "2026-11-03T12:42:00Z",
    "sketchup-import",
    "Open SketchUp files",
    `Drop a SketchUp model (.skp) on Rodeo, or choose File > Import SketchUp…, and it comes in as 3D meshes. There's no need to export it from SketchUp first.
- Reads models saved by SketchUp 6 to SketchUp 2025. We've tested files from SketchUp 6, 2013 to 2022 and 2025.
- Components become symbols, placed where the model places them, turned, mirrored or scaled. Groups stay groups with their names, and each tag becomes a class, so you can show and hide them as you did in SketchUp. A tag hidden in SketchUp comes in as a hidden class.
- Textures become Rodeo textures, laid on each face as SketchUp lays them, and colorized ones keep their colour. Colours and see-through materials come in too.
- Edges that aren't part of a face come in as 3D polygons, guides go in a Guides class, and images come in as faces showing their picture.
- A model of up to 250,000 faces comes in at once.
- Hidden geometry stays out, and so do text, dimensions, section planes and scenes. When the model comes in, Rodeo says what it left out.`,
    "furniture",
  ),
  release(
    "2026-11-03T12:41:00Z",
    "connectcad-status",
    "ConnectCAD Status palette",
    `Stage > ConnectCAD > ConnectCAD Status keeps a live list of the problems in your schematic while you work.
- Duplicate device names and numbers, circuits left loose and circuits joining different signals, errors first.
- Zoom to any of them: its layer comes up and its outline flashes. Step between the copies of a duplicate name.
- Ignore what you mean to leave as it is; it greys at the foot of the list until you restore it.
- Fix something and it drops off the list a moment later.`,
    "plug",
  ),
  release(
    "2026-11-03T12:40:00Z",
    "connectcad-equipment-detail",
    "Equipment detail views",
    `Stage > ConnectCAD Layout > Create Equipment Detail View draws the equipment you select face on, front and back, on a sheet layer.
- Each piece gets its own views, at a scale that suits it (1:5 for 19-inch gear): its panel and rack ears from the front, its body from behind, and its name below.
- A rack frame shows its slots, power supplies and the cards in them, each named.
- Rack elevations and detail views made on a sheet that already has views now go to the right of them instead of on top.`,
    "plug",
  ),
  release(
    "2026-11-03T12:39:00Z",
    "connectcad-rack-elevation",
    "Rack elevations",
    `Stage > ConnectCAD Layout > Create Rack Elevation draws the racks you select face on, front and back, on a sheet layer.
- Racks standing side by side go into one view, left to right as you'd see them; the rear view runs the other way.
- Each piece of equipment shows at its rack unit with its name, rack frames with their slots and power supplies, and the cards in them.
- Rack units are numbered up the post, and each rack's ID sits below it. The views are named with /F and /R, ready for a drawing set.`,
    "plug",
  ),
  release(
    "2026-11-03T12:38:00Z",
    "connectcad-cable-pull",
    "Cable Pull Report",
    `Stage > ConnectCAD > Cable Pull Report lists the cables to install along each cable route.
- Each row is a route between two drop points or racks with one cable type: how many cables, the longest, and their total length.
- At the bottom, each cable type's count and total length, for ordering cable in bulk.
- It follows the routes Edit Cabling keeps and includes spare cables.`,
    "plug",
  ),
  release(
    "2026-11-03T12:37:00Z",
    "connectcad-precabling",
    "Pre-cabling and alternative routes",
    `The Edit Cabling tool in the ConnectCAD Cable Route set can now plan cables before the schematic is finished.
- Add spare cables between two drop points: pick a cable type, how many, and which route they take. OK puts them on a Spare Cabling layer, numbered for their drop points (A-B-1, A-B-2…), and they count on the cable paths they run along.
- Select Alternative Route gives the cables you select a longer way round, B the next shortest after A, and so on. The route is kept, so cable counts, cable lengths and riser sheets follow it.
- Double-click a cable to see its route in its colour while the list stays open, change a spare cable's type, or delete spare cables you no longer need.`,
    "plug",
  ),
  release(
    "2026-11-03T12:36:00Z",
    "big-drawings",
    "Big drawings open faster and use far less memory",
    `Very large drawings now open in a few seconds and keep the page responsive while you work and save.
- A drawing is read a piece at a time and decoded on several of your computer's cores, with a progress bar and a Cancel button.
- In files of 256 MB or more, the parts Rodeo doesn't need to show the drawing (3D objects' cached data, and big pictures until they're drawn) stay in the file, so a drawing that took gigabytes of memory takes a fraction of it.
- Saving writes the file a piece at a time behind a progress bar, so a big drawing saves without stopping the page, and Cancel leaves the file as it was.
- If another app changes a big drawing's file while it's open here, saving says so rather than writing a damaged file.`,
    "speed",
  ),
  release(
    "2026-11-03T12:35:00Z",
    "connectcad-device-builder",
    "Device Builder",
    `The Device Builder tool in the ConnectCAD Schematics set makes a schematic device from a description.
- Click where the device goes, then fill in its make, model, name, tag, sizes, rack units, power and weight, and its sockets as rows: so many inputs or outputs of one signal and connector down one side, numbered from a name. A preview shows the device as you go.
- OK places it and keeps it in your devices, so next time you can pick it by make and model. Create Temporary Device places it without keeping it.
- The tool's Preferences set the device's minimum width, space at the top and bottom, the gap between socket rows, and whether long tags are shortened.`,
    "plug",
  ),
  release(
    "2026-11-03T12:34:00Z",
    "connectcad-settings",
    "ConnectCAD Settings",
    `Stage > ConnectCAD > ConnectCAD Settings… sets up a drawing's schematics before you start, and the settings are saved with it.
- Add your own signals, or change a built-in one's letter, colour category and connectors. Add connectors, cables and cable lengths, which a circuit's Cable and Cable Length are then chosen from in the Object Info palette.
- Set the jackfield, term panel and custom panel prefixes and how many ports each kind of panel holds, the numbering system Number Cables starts on, and how many digits a linear array's numbers get.
- Turn on automatic hopover and crossing circuits hop each other as they're drawn, the later one over the earlier.`,
    "plug",
  ),
  release(
    "2026-11-03T12:33:00Z",
    "connectcad-labels",
    "Cable and equipment labels",
    `Stage > ConnectCAD > Create Labels… turns a worksheet report into sheets of labels ready to print.
- Run a circuit or equipment report, then pick it and a label format: Avery sheets for cables (a pair of labels for each, with both ends, a QR code and an optional colour-coded number), equipment, devices or lighting devices. A preview shows the first label.
- The labels land on a sheet layer as one object a format. Change its page size, margins, pitch and copies in the Object Info palette, and press Update after the report changes.
- Edit Label… changes what each label shows, and the Color-Coded Linked Text and Linked QR Code tools add a code where you click in a label.
- Export to PDF… saves the pages to print.`,
    "plug",
  ),
  release(
    "2026-11-03T12:32:00Z",
    "rhino-fbx-collada-blender-ply",
    "Rhino, SketchUp, Blender and more",
    `Open models from other design and 3D apps, and send yours back to them.
- File > Import reads Rhino (.3dm), FBX, Collada (.dae and .kmz, which SketchUp exports), Blender (.blend) and PLY files. Each comes in at its own size and place, grouped by its layers or collections.
- A Rhino file's meshes and polysurfaces come in as meshes, and its curves, text and points as 2D objects in plan, in Rhino's colours.
- File > Export writes Rhino 3DM (with your 2D linework), FBX, Collada for SketchUp, and PLY.
- Export IFC now carries each storey's height and each object's records as properties that ArchiCAD and Revit show.
- Drop a model on the start screen and it opens in a new drawing. Drop an ArchiCAD, Revit or DWG file and Rodeo tells you what to export from that app instead.`,
    "solids",
  ),
  release(
    "2026-11-03T12:31:00Z",
    "connectcad-connector-panels",
    "Connector panels in schematics",
    `ConnectCAD's schematic tools now include Connector Panel, for the custom panels in facilities boxes around a venue.
- Place input or output connectors one at a time or in a row. Each is named by its box and port (BOX1, MIC01), and the numbers count on as you place them. Click on a circuit to put a connector in it.
- Edit Device Array in the Object Info palette moves several connectors to another box, renumbers them, changes their connector or gives them more circuits.
- Create Panel View picks them up, so you can draw the panel's front from the schematic.`,
    "plug",
  ),
  release(
    "2026-11-03T12:30:00Z",
    "connectcad-panel-layouts",
    "Connector panel layouts",
    `ConnectCAD can now draw the front of your connector panels.
- Stage > ConnectCAD > Create Panel View draws the panels in your schematic as rack-mount plates, with each connector tagged and the device it's patched to written above it. The writing follows the schematic as you rename things.
- The Panel Connector tool in the Layout tools puts connectors on a panel one at a time, in a line or in a grid, linking them to the device's sockets in turn.
- A panel's Panel Builder lays out rows of connectors for you, adding rack units when they don't fit, and Create Schematic Devices turns a panel you drew into a device in the schematic.`,
    "plug",
  ),
  release(
    "2026-11-03T12:29:00Z",
    "connectcad-sheets",
    "Riser and cabling sheets",
    `ConnectCAD can now put the cable network on sheets for the installers.
- Stage > ConnectCAD > Create Riser Sheet makes a viewport of the cable paths on a sheet layer and tags each path with how many cables it carries, or opens the viewport's annotations so you can tag the paths yourself.
- Create Cabling Sheet shows one floor, with the cables between each two places drawn as arcs between them or as home runs pointing to where they go. You choose how many are drawn as arcs.`,
    "plug",
  ),
  release(
    "2026-11-03T12:28:00Z",
    "connectcad-analyze-routes",
    "Which cables run where",
    `ConnectCAD can now tell you which circuits run along each cable path.
- Stage > ConnectCAD > Analyze Cable Routes routes every circuit through the cable paths and gives each path its Cable Count; circuits it can't route are listed, and Mark up Circuits marks them.
- The Edit Cabling tool lists the circuits along a cable path you click, or between two drop points, with which share a route and their lengths. Double-click one to see its route on the drawing, or make a worksheet of the list.`,
    "plug",
  ),
  release(
    "2026-11-03T12:27:00Z",
    "connectcad-cable-route",
    "Cable routes and drop points",
    `ConnectCAD has a new Cable Route tool set.
- Cable Route draws cable paths at the cable heights you pick, rising or dropping where the height changes; a path started or ended on another joins it, making a network.
- Drop Point places where cables come out to equipment, named A, B, C…, and can split a cable path it's put in. Equipment names its drop point in Object Info.
- Calculate Cable Lengths now follows the shortest way through the cable paths for equipment that isn't racked side by side, adding each drop point's slack.`,
    "plug",
  ),
  release(
    "2026-11-03T12:26:00Z",
    "connectcad-cable-lengths",
    "Cable lengths from racks",
    `Stage > ConnectCAD now has Calculate Cable Lengths.
- Circuits whose equipment is in racks get a Calculated Cable Length: the height between them in one rack, or down, under the false floor and along the row for racks side by side.
- Set the equipment tail, the swan-neck at patch panels and the false floor depth, for all circuits or the selected ones; a length you typed is kept.
- Circuits it can't work out are marked on the drawing, and the circuit reports show the calculated length.`,
    "plug",
  ),
  release(
    "2026-11-03T12:25:00Z",
    "connectcad-rack-worksheet",
    "Rack equipment worksheet",
    `The ConnectCAD Layout tool set now has Make Rack Equipment Worksheet.
- Click over a rack, choose the columns and drag them into order, and a worksheet lists what's in the rack at each position from the top.
- Rack frames come with their modules by slot, free units show as Free rows, and equipment below the rack comes last.
- Totals for power, BTU and weight, and the free units on each side.`,
    "plug",
  ),
  release(
    "2026-11-03T12:24:00Z",
    "connectcad-rack-frame",
    "ConnectCAD Rack Frame",
    `The ConnectCAD Layout tool set now has the Rack Frame tool.
- Click over a rack to put a frame or a tray in it at the first free unit, with a grid of slots, power supplies at one side and an optional front door.
- Equipment set to Modular goes into the first frame with room, one or more slots wide, numbered from the top left.
- Move the frame up or down the rack, or move the rack, and its modules go with it.
- Slots that run off the frame or onto another module are refused.`,
    "plug",
  ),
  release(
    "2026-11-03T12:23:00Z",
    "simpler-start",
    "A simpler start screen",
    `The start screen is now one small card over the editor, which waits faded behind it.
- Open, New and From template, then your recent drawings: this computer's and your cloud drawings in one list.
- Sign in from the card's corner before you open anything.
- What's new, Feedback and Donate are links at its foot.`,
    "workspace",
  ),
  release(
    "2026-11-03T12:22:00Z",
    "connectcad-create-equipment",
    "ConnectCAD Create Equipment",
    `Stage > ConnectCAD Layout > Create Equipment makes equipment for your schematic's devices.
- One equipment item for each device name on the layers you choose, linked to its devices.
- Each goes where its device's Room, Rack and Rack U say: in its rack, round its layout room's walls, or round the drawing.
- Locations the drawing doesn't have are listed first, so you can create the equipment anyway or leave it out.
- The device data its equipment keeps is now greyed in a device's Object Info.`,
    "plug",
  ),
  release(
    "2026-11-03T12:21:00Z",
    "connectcad-equipment-item",
    "ConnectCAD Equipment Item",
    `The ConnectCAD Layout tool set now has the Equipment Item tool.
- Click over a rack to put equipment in it at the first free unit from the top, on its front or rear, full or half width.
- Equipment moves and turns with its rack; drag it off to stand it alone, or onto a rack to put it in.
- Named after a schematic device, it takes the device's make and model, and keeps the device's size and location up to date.
- Racks now count the power and weight of the equipment in them.`,
    "plug",
  ),
  release(
    "2026-11-03T12:20:00Z",
    "connectcad-equipment-rack",
    "ConnectCAD Equipment Rack 3D",
    `The ConnectCAD Layout tool set now has the Equipment Rack 3D tool.
- Click where the middle of the rack's front goes, then click toward where it faces.
- Choose a 4-post or 2-post rack, a console, or an enclosure, with rails, side panels and doors in 3D.
- Changing the overall height keeps the mounting area in whole rack units.
- A rack takes the Room ID of the layout room it stands in.
- Its power and total weight add up the devices whose Rack is its Rack ID.`,
    "plug",
  ),
  release(
    "2026-11-03T12:19:00Z",
    "connectcad-layout-room",
    "ConnectCAD Layout Room",
    `A new ConnectCAD Layout tool set starts with the Layout Room tool, the room that equipment racks go in.
- Draw a room as a rectangle or a polygon. Its Room ID shows in its top left corner.
- Rooms can sit inside other rooms, and their IDs join with dots, such as MAIN.AV1.
- Turn off 2D only to see the room's walls up to its height in 3D.
- AEC > Create Objects from Shapes can turn closed shapes into layout rooms.
- The Rack Ruler has moved into this tool set.`,
    "plug",
  ),
  release(
    "2026-11-03T12:18:00Z",
    "connectcad-devices-from-list",
    "ConnectCAD devices from a list",
    `Create Devices from Worksheet builds a schematic's devices from an equipment list.
- Pick a worksheet, or a CSV or Excel file, and say which column holds the make, model, quantity, name and so on.
- Each row makes its quantity of devices, counting those the drawing already has.
- A new device of a make and model the drawing has comes with the same sockets.
- Other columns are kept in an Imported Device Data record on each device.`,
    "plug",
  ),
  release(
    "2026-11-03T12:17:00Z",
    "connectcad-lists",
    "ConnectCAD cable lists",
    `Three new ConnectCAD commands work from a cable list, such as one edited on site.
- Convert Report to List freezes a report worksheet as a list.
- Compare Cable List and Drawing marks numbers that differ and circuits missing from either side.
- Make Connections from List draws the circuits the list has and the drawing hasn't.
- A list can be a worksheet in the drawing, or a CSV or Excel file.`,
    "plug",
  ),
  release(
    "2026-11-03T12:16:00Z",
    "connectcad-transfer",
    "ConnectCAD Device eyedropper",
    `The Device tool can now copy one device's setup onto others, as Vectorworks' Pick Up and Apply modes do.
- Pick Up a device, then click another device or a selection to apply it.
- Sockets with the same name move to match, and the device's other sockets are added.
- Make, model, physical and location data come across; names and tags stay.
- Preferences: same make or model only, what to do with extra sockets, and records.`,
    "plug",
  ),
  release(
    "2026-11-03T12:15:00Z",
    "connectcad-hopover",
    "ConnectCAD HopOver",
    `HopOver now works on ConnectCAD circuits, and sits in the ConnectCAD Schematics tool set.
- Click a circuit where another crosses it: it hops over that circuit in a half circle.
- The hop is kept with the circuit and follows when either circuit or its devices move.
- Click the hop again to take it off; select a circuit first to give it priority.`,
    "plug",
  ),
  release(
    "2026-11-03T12:14:00Z",
    "connectcad-reroute",
    "ConnectCAD ReRoute Circuits",
    `New in the ConnectCAD Schematics tool set: the ReRoute Circuits tool.
- Select circuits, then click the one they should follow to bus them on its run.
- Display Breakout Nodes marks where each circuit joins and leaves the bus.
- Drag instead of clicking to space them a set distance apart, so they run parallel.`,
    "plug",
  ),
  release(
    "2026-11-03T12:13:00Z",
    "connectcad-adapter",
    "ConnectCAD Adapter",
    `New in the ConnectCAD Schematics tool set: the Adapter tool.
- Click a device's socket to put an adapter on it, with one socket or several (L, R).
- The socket's circuits move to the adapter, named by both sockets (OUT1-L).
- Adapters follow their device; drag one off and it shows a warning until you drop it on another socket.`,
    "plug",
  ),
  release(
    "2026-11-03T12:12:00Z",
    "connectcad-combine-panels",
    "ConnectCAD Combine and Split Panels",
    `New in Stage > ConnectCAD: Combine Panels and Split Panels.
- Combine Panels makes the selected ports of one panel a single device, with a row for each port.
- Split Panels turns a panel device back into one device a port.
- Circuits stay joined to their ports both ways.`,
    "plug",
  ),
  release(
    "2026-11-03T12:11:00Z",
    "connectcad-panels",
    "ConnectCAD term panels and jackfields",
    `New in the ConnectCAD Schematics tools: Term Panel, Jackfield and Linked Jackfield.
- Each places one port of a panel, video, audio, data, optical or DIN rail. A row of them counts its ports on.
- Ports of one panel share its name, such as JA1, and Check Drawing doesn't flag that. It warns of a port used twice.
- Click on a circuit to put a port in it. A term panel's port takes the circuit from either side.`,
    "plug",
  ),
  release(
    "2026-11-03T12:10:00Z",
    "connectcad-distribution-amplifier",
    "ConnectCAD distribution amplifiers",
    `New in the ConnectCAD Schematics tools: Distribution Amplifier.
- Place a video or audio DA: one input, with a loop-thru if you like, to as many outputs as you need.
- Click on a circuit to put the DA in it. The circuit runs to the DA's input and on from its first output.
- Linear Array places a numbered row. Change a DA's outputs or loop-thru in the Object Info palette.`,
    "plug",
  ),
  release(
    "2026-11-03T12:09:00Z",
    "connectcad-legend",
    "ConnectCAD signal legend",
    `New in the ConnectCAD Schematics tools: Legend.
- Click to place a key to the signals on the layer, then click again to set its angle.
- Each signal shows a sample of its circuit line in its colour, its name and how many circuits carry it.
- Change the title or hide the counts in the Object Info palette; Refresh Legend picks up circuits added since.`,
    "plug",
  ),
  release(
    "2026-11-03T12:08:00Z",
    "connectcad-socket-loop",
    "ConnectCAD socket loops",
    `New in the ConnectCAD Schematics tools: Socket Loop, and rows of sockets.
- Socket Loop joins two inputs side by side so the signal passes through to the next device. Click a looped socket to take the loop off.
- The second socket of a loop feeds the next device with the Connect tool, and its circuit runs round its own device.
- Socket and Socket Loop have a Linear Array mode: click where a row starts and where it ends to fill it with sockets or looped pairs.`,
    "plug",
  ),
  release(
    "2026-11-03T12:07:00Z",
    "connectcad-external",
    "ConnectCAD externals",
    `New in the ConnectCAD Schematics tools: External, for feeds to and from equipment outside the system.
- Click to place one, or switch to Linear Array and click twice for a numbered row of them.
- Choose Input, Output or Bi-Directional, and Left or Right External, in the tool bar.
- Give an external more circuits, a new signal or the other facing in the Object Info palette. Circuits already joined stay joined.
- Externals connect, check and report like devices.`,
    "plug",
  ),
  release(
    "2026-11-03T12:06:00Z",
    "connectcad-reports",
    "ConnectCAD reports",
    `New in Stage > ConnectCAD: five reports, each made as a new worksheet and opened.
- Current Layer and All Layers Circuit Report list every circuit by number, with its signal, cable and both ends.
- Current Layer Device Report lists the layer's devices with power, BTU and weight, and totals them by description.
- Device Connections Report shows where each socket on each device goes, or that it isn't connected.
- ConnectCAD Parts Report lists each device once and counts the parts by description.
- Reports keep the values as they are when made. In a drawing with no worksheet yet, the report shows in a dialog.`,
    "sheet",
  ),
  release(
    "2026-11-03T12:05:00Z",
    "connectcad-check",
    "Check a ConnectCAD drawing",
    `New in Stage > ConnectCAD:
- Connect Selected joins the facing sockets of the devices you select, all at once. With one device selected, click the device to connect it to.
- Check Drawing marks duplicate device names, socket names and cable numbers, circuits that have lost a socket, and circuits joining different signals. Select a markup to read the problem; Next Markup steps to its twin.
- Clear Markup takes the marks away.
- Renumber ConnectCAD Objects names the selected devices in order, by number or letter, with a prefix and delimiter you choose.`,
    "filecheck",
  ),
  release(
    "2026-11-03T12:04:00Z",
    "connectcad-schematics",
    "ConnectCAD schematics",
    `A new ConnectCAD Schematics tool set draws signal flow diagrams.
- Device draws a device's box: click its corners, or click twice for the usual size. Names count on (DEV1, DEV2…).
- Socket adds inputs (green), outputs (red) or both down a device's sides, each with a signal and a connector. Edit Sockets… in Object Info lists them all.
- Connect joins an output to an input: the circuit runs square between them, coloured by its signal, or through the corners you click. Multi Connect joins every free socket of a signal at once.
- Move a device and its circuits follow. Delete one and its circuits show a warning triangle.
- Stage > ConnectCAD > Number Cables numbers circuits by signal (V001, A001…), source device or one sequence; Clear Cable Numbers takes them off.`,
    "plug",
  ),
  release(
    "2026-11-03T12:03:00Z",
    "create-lectern",
    "Lecterns for events",
    `Stage > Event > Create Lectern… places a lectern on your stage.
- Pick one of five lecterns in the dialog, which shows it from the front, the side and above.
- Click where it stands, then click the way it faces the audience. It goes in as a symbol: its outline in plan, solids in 3D.
- Custom Attributes makes a new symbol under a name you type, coloured by a class or with its own fill, pen and texture.
- Over a stage built in 3D, the lectern stands on the stage's top.`,
    "furniture",
  ),
  release(
    "2026-11-03T12:02:00Z",
    "smooth-cloud-orbit",
    "Smoother 3D in cloud drawings",
    `Orbiting a large cloud drawing in 3D no longer stalls after every drag.
- To show collaborators where you point, Rodeo found the spot under your pointer whenever it rested over the model, even with no one else there; on a big model that froze the view for a tenth of a second each time.
- It now looks only while someone else in the drawing has 3D open.`,
    "speed",
  ),
  release(
    "2026-11-03T12:01:00Z",
    "video-camera",
    "Video cameras for events",
    `Visualization > Video Camera places a camera on a tripod or pedestal with a lens, a body and a picture format. Pan, tilt and zoom it in Object Info, show its field of view in plan, and click Activate Camera to see the shot in 3D.`,
    "camera",
  ),
  release(
    "2026-11-03T12:00:00Z",
    "agents-no-step-limit",
    "Agents keep going, and tidier side panels",
    `Agents now work until a job is done, and the top bar lines up with the side panels.
- An agent no longer stops after 60 steps to ask whether to carry on; Stop ends it whenever you like
- The Agents settings are gone: Rodeo picks the models, and agents always hand work to helpers when it helps
- A line now divides the top bar's ends from the open side panels beneath them, and a side panel is never narrower than the top bar's buttons above it`,
    "agent",
  ),
  release(
    "2026-11-02T13:45:00Z",
    "viewport-annotations",
    "Edit a viewport's annotations",
    `Right-click a sheet viewport and choose Edit Annotations, or double-click it: its annotations open at the viewport's scale over what it shows, so dimensions, notes and tags drawn there snap to the drawing and stay with the viewport. Exit Viewport Annotation goes back to the sheet.`,
    "section",
  ),
  release(
    "2026-11-02T13:44:00Z",
    "lighting-device-data",
    "Lighting data to and from Lightwright",
    `Swap instrument data with Lightwright and spreadsheets.
- File > Export > Export Lighting Device Data writes every instrument's fields as a tab-delimited file, UID first, with the fields you tick.
- File > Import > Import Lighting Device Data reads one back, or a CSV or Excel sheet: AutoLink matches its columns to fields, and you can link them by hand and save the links.
- Matching instruments update in one undo step; rows that match none come in as new instruments below the drawing.`,
    "records",
  ),
  release(
    "2026-11-02T13:43:00Z",
    "align-plane",
    "Lay objects on a working plane",
    `Put a 3D object down on any plane.
- The 3D Modeling set's Align Plane lays the selected objects on the active working plane, or the layer plane when none is set.
- Surface mode: click a face and the object turns to sit on the plane by that face.
- Three Points mode: click three points on the object; the first goes to the plane's origin, the second along its x axis, the third to its y side.
- Clicks near a corner snap to it, and the whole move is one undo step.`,
    "solids",
  ),
  release(
    "2026-11-02T13:42:00Z",
    "auto-hybrid",
    "Plans from 3D models",
    `Show any 3D model as a proper plan.
- Select 3D objects, then AEC > Create Auto Hybrid.
- Top/Plan shows where a cut plane slices them, with the edges below and above it; 3D views show the model as it is.
- 2D Appearance sets the cut's height and each part's class, fill and pen, and dashes the hidden lines.
- Modify > Edit Auto Hybrid opens the model to change; leaving it draws the plan again.`,
    "solids",
  ),
  release(
    "2026-11-02T13:41:00Z",
    "wall-framer",
    "Frame walls with studs",
    `Frame a building's walls in one go.
- AEC > Framing > Wall Framer frames the walls on the layers you tick, each wall class with its own stud spacing, lumber and plates.
- Studs and plates, with king studs, jacks, headers, cripples and sills round every door and window.
- The model goes on layers of its own: 3D, a plan, and an elevation of every wall.
- Take-off and wall info worksheets count the members and the sheets that cover them.`,
    "walls",
  ),
  release(
    "2026-11-02T13:40:00Z",
    "create-joists",
    "Frame a floor with joists",
    `Frame a floor in one go.
- Select a floor outline, and any stair openings inside it, then AEC > Framing > Create Joists.
- Click the way the joists run: they're previewed as you move, laid out at your spacing and cut to the rim members.
- Rims go round the edge, lapped or mitred, and headers ring each opening.
- Every member is drawn in plan and in 3D, with a Joist Take-Off worksheet counting them.`,
    "walls",
  ),
  release(
    "2026-11-02T13:39:00Z",
    "tree-survey-import",
    "Import a tree survey",
    `Bring an arborist's tree survey straight into the drawing.
- AEC > Existing Trees > Import Tree Survey File reads Excel workbooks and tab- or comma-delimited files.
- Map each column to a tree parameter or a location, with its unit. Columns are guessed from their names.
- Make existing trees, 2D loci or 3D loci, and keep any columns in a custom record.
- Latitude and longitude use the drawing's georeferencing.
- Save your column mapping to reuse it on the next survey.`,
    "site",
  ),
  release(
    "2026-11-02T13:38:00Z",
    "retaining-walls",
    "Retaining walls on a site",
    `Hold the ground back with a wall.
- Select connected walls or an extrude, then AEC > Terrain > Create Retaining Wall Site Modifier.
- Each side of the wall takes its own height, by the wall's top or bottom or the terrain, with a pad at its foot.
- Change heights by edge or by corner in Object Info, and Reshape moves its corners.
- Send to Surface now works on it and on massing models.
- Wall peaks and stepped walls aren't supported yet.`,
    "site",
  ),
  release(
    "2026-11-02T13:37:00Z",
    "massing-model",
    "Massing models",
    `Block out buildings on a site with the new Massing Model tool in Site Planning.
- Draw an outline, and get walls, floors and a hipped or flat roof to the height and floor count you set.
- Plan shows the roof or the footprint, with a label of the name and gross area.
- It can level a pad under itself and add grade limits round it on a site model.
- Reshape moves its corners. Create Objects from Shapes makes one from any closed shape.
- Custom roofs from a profile aren't done yet.`,
    "site",
  ),
  release(
    "2026-11-02T13:36:00Z",
    "site-labels-snapshots",
    "Contour labels and site snapshots",
    `Put contour labels exactly where you want them, and keep a second view of a site model that stays put while the model changes.
- AEC > Terrain > Add Contour Labels places a label wherever a line of clicks crosses a contour
- Edit Contour Labels drags a label along its contour, adds one on any contour, or deletes one
- Create a Snapshot in a site model's Object Info keeps it as it is now, until you click Unfreeze
- Snapshots have an opacity and, for coloured elevations or slopes, a legend with a title and an order`,
    "site",
  ),
  release(
    "2026-11-02T13:35:00Z",
    "site-model-editing",
    "Edit a site model's ground",
    `Crop a site model, sculpt its surface, cut swales and raise berms, and edit its contours. Each edit stays in the drawing as a modifier you can move or delete.
- AEC > Terrain > Edit Site Model Crop draws a border to reshape; the source data stays, so deleting the border brings the ground back
- Edit Existing or Proposed Surface: the Sculptor raises or lowers the ground by a drag or a typed distance, across a radius with soft falloff or on a single vertex, edge or triangle
- The same tool adds vertices and draws swales and berms with a width, a depth and a flat, rounded or sharp profile
- Edit Existing or Proposed Contours: pick a contour to reshape or move, or draw a new one at a set height`,
    "site",
  ),
  release(
    "2026-11-02T13:34:00Z",
    "site-path-modifiers",
    "Path site modifiers",
    `Carve a road or a path into a site model.
- Pathway Path takes a centre line and a width
- Boundary Path takes an outline and works out the centre line
- Longitudinal and transverse profiles set heights along and across it
- Fit to Surface lays it on the ground, and Reshape moves its corners`,
    "site",
  ),
  release(
    "2026-11-02T13:33:00Z",
    "site-modifiers-more",
    "More site modifiers",
    `Shape a site model with more than pads and limits.
- Pad with Retaining Edge draws the pad and the edge the grading stops at
- Aligned takes its corner heights from the pads and lines it touches
- Open Edge Line sets heights along a line that isn't closed
- Spoil Pile adds an even thickness, and Texture Bed paints the ground in its class's texture
- Apply To sends any of them to the existing or proposed surface
- Create Objects from Shapes turns selected shapes into any of them`,
    "site",
  ),
  release(
    "2026-11-02T13:32:00Z",
    "survey-input",
    "Survey input",
    `Survey points can now come straight into a drawing, ready to make a site model from.
- Import Survey File reads text files and Excel workbooks, in the usual point, northing, easting and elevation orders and units, and brings far-off coordinates to the origin.
- Grid Method Entry takes a grid of elevations off a paper map: type them in a table or paste a block from a spreadsheet.
- Stakes now hold their height, so a site model and the Grade tool can read them.`,
    "site",
  ),
  release(
    "2026-11-02T13:31:00Z",
    "zone-visual-influence",
    "Zone of Visual Influence",
    `Terrain can now show what can and can't be seen from a point on a site: pick the model and an eye height, click where you're standing, click again.
- The ground out of sight turns dark, in plan and in 3D, and a note says how much of the site that is.
- It reads the proposed surface, so a new pad or grade changes the answer when you run it again.
- Only the ground blocks the view for now, not buildings or plants.`,
    "site",
  ),
  release(
    "2026-11-02T13:30:00Z",
    "grade-tool",
    "Grade tool",
    `Site Planning has a Grade tool: click two ends, type any two of the elevations, the grade or the rise, and it draws the line with its slope, elevations and a downhill arrow.
- Grades that share an end share its elevation and move together, and a new end on a grade splits it.
- A grade can read its heights from a site model, or change the model at the next Update as a line of known heights.
- Its settings mark grades or elevations out of a range, and Create 3D Loci at Grade Points drops a point at each end.`,
    "site",
  ),
  release(
    "2026-11-02T13:29:00Z",
    "site-grading",
    "Site grading",
    `Site models now help you balance a site, not just draw it. Find where a slope from a pad meets the ground, or put in a pad that balances cut and fill.
- Create Grade Limits from Planar Pad puts limits a set distance from a pad, or where a batter slope meets the ground.
- Create Planar Pad from Grade Limits finds the level that makes cut and fill equal, with one slope or one per side.
- Site Model Section draws the existing and proposed ground along any line, with stations and elevations.
- Create Site Model Volume List reports each triangle's areas, volumes, cut and fill as a text file, worksheet or group.
- View > Show or Hide Site Modifiers clears them off the drawing and keeps what they did.`,
    "site",
  ),
  release(
    "2026-11-02T13:28:00Z",
    "site-model",
    "Site models",
    `Build terrain from survey points, shape it with pads and grade limits, and read off the cut and fill.
- AEC > Terrain > Site Model from Source Data triangulates selected 3D loci and 3D polygons; Site Model from Boundary makes a flat one inside a closed shape
- Six plan styles with contour labels, flow arrows and a cut and fill area, and ten 3D styles from mesh to layer cake, in Object Info or Site Model Settings
- The Site Modifiers tool in Site Planning draws Grade Limits and Planar Pads; a striped border says the model needs updating
- Object Info shows areas, volumes, cut, fill and net, and Send to Surface puts selected objects on the ground
- Vectorworks' own site models aren't changed; other modifiers, snapshots and sculpting aren't here yet`,
    "site",
  ),
  release(
    "2026-11-02T13:27:00Z",
    "adjacency",
    "Adjacency diagrams",
    `Space Planning can now plan which rooms belong together.
- Space Link joins two spaces, its line heavier the stronger their relationship
- Adjacency Score adds up each link's length times strength, so you can see a layout improve as you drag rooms
- Adjacency Matrix and Stacking Diagram lay out the spaces by relationship and by floor
- AEC > Space Planning > Import Adjacency Matrix builds it all from a spreadsheet
- Everything follows the spaces as they move, and undoes together`,
    "grid",
  ),
  release(
    "2026-11-02T13:26:00Z",
    "class-layer-mapping",
    "Class and Layer Mapping",
    `Tidy a drawing's classes and layers in one go.
- Tools > Class and Layer Mapping lists every class and design layer with the name it's to have.
- A new name renames it, another's name merges with that one, and a blank deletes it with the objects on it, after saying how many.
- Load and Save use Vectorworks' mapping files, so the same tidy-up works on similar drawings.
- It's one undo step.`,
    "workspace",
  ),
  release(
    "2026-11-02T13:25:00Z",
    "lighting-accessory",
    "Lighting accessories",
    `Barn doors, top hats and scrollers on your lighting devices.
- The Lighting Accessory tool in Rigging adds any of 12 generic accessories with a click, or to every selected device with Apply to Selection.
- A device draws them in plan: lens accessories in front of it, body ones a third of the way back, clamps and safety cables on its hanging point.
- Each adds its weight to the device's, so Total Hung Weight and Load Check count it. The weights are generic figures.
- Remove takes the last one off a device, or all of them off the selection.`,
    "grid",
  ),
  release(
    "2026-11-02T13:24:00Z",
    "hanging-position",
    "Hanging positions",
    `Name a place where lights hang, and its devices follow it.
- Stage > Lighting > Convert to Hanging Position turns pipes, trusses or any geometry into a named position, keeping the geometry or making a symbol of it. The Hanging Position tool in Rigging places more from a symbol.
- Devices take its name: those selected, loose ones in its box, and new ones placed on it, which it outlines as the Lighting Device tool passes over.
- Object Info renames its devices with it, sets their trim height, and inserts an Equipment Summary Key of just that position.
- Auto Number numbers its devices across the page from a start and increment, and Auto Number Positions does every position by its own settings.`,
    "grid",
  ),
  release(
    "2026-11-02T13:23:00Z",
    "blank-symbols",
    "Symbols in new drawings",
    `Symbols now work in a brand new drawing, and in any file that has none yet.
- Create Symbol used to refuse there because it had no symbol to copy settings from
- Placing, editing and replacing symbols, and bringing a model in as a symbol, work too
- These symbols haven't been opened in Vectorworks yet`,
    "shapes",
  ),
  release(
    "2026-11-02T13:22:00Z",
    "trees-from-loci",
    "Existing trees from loci",
    `Survey points can now become existing trees.
- AEC > Existing Trees > Create Existing Trees from Loci works on selected loci and symbols
- Map a record's fields to the tree's number, names, canopy, DBH and more, each with its own unit. The mapping is guessed from the field names to start
- Preserve Record keeps the survey data on the new tree
- Fields with no tree parameter, such as Height and Condition, stay in the record
- Also fixed: a new group could inherit a record attached to an existing group`,
    "site",
  ),
  release(
    "2026-11-02T13:21:00Z",
    "chain-extrude",
    "Chain Extrude",
    `A new Building Shell tool for awnings, cornices and crown moldings.
- Select a back shape and any shapes in front of it, then click a path. The back shape runs along it with mitred corners
- The front shapes repeat as ribs, centred along each side and on the corners' bisectors
- Object Info changes Flip, ribs, thickness, spacing, datum and elevation, and redraws it
- Draw New Path replaces the path, but the path can't be reshaped and the profile can't be edited afterward`,
    "walls",
  ),
  release(
    "2026-11-02T13:20:00Z",
    "shell-surfaces",
    "Shell Solid thickens surfaces",
    `Shell Solid now gives thickness to open surfaces and flat shapes, as well as hollowing solids.
- Click an open surface, or the line of a closed flat shape or 3D polygon. Shift-click chooses several
- The shell shows before it's made, and Inside or Outside sets which side it grows on
- Faces stay the set thickness apart over folds and curves; a thickness that would make a curved surface cross itself is refused
- Each result is a mesh, so its thickness can't be changed afterward`,
    "solids",
  ),
  release(
    "2026-11-02T13:19:00Z",
    "surface-array",
    "Surface arrays",
    `Model has Create Surface Array, for patterned panels, frameworks and curtain walls.
- Select a flat object or open surface for the base, and what to repeat on it.
- Set repetitions or a fixed size each way, with offset and shift factors, an origin and a rotation. The 3D view shows the array as you change them.
- Choose whether items at the edge overlap it, are left out, or are trimmed to it.
- Items stand along the surface's normal where they land, on either side of it.
- It makes a plain group, not an array you can edit later: undo and make it again, the dialog remembers its values.
- Text and images aren't repeated.`,
    "solids",
  ),
  release(
    "2026-11-02T13:18:00Z",
    "mesh-plan",
    "Meshes show in Top/Plan",
    `What the 3D Modeling tools make no longer vanishes when you go back to plan.
- A mesh draws from above, as its rims, sharp folds and the edges where it turns away.
- A click on those lines selects it, and dragging it moves them.
- A mesh in a symbol or plug-in, or grouped with a plan drawing, leaves plan to that drawing.
- A viewport's view of a mesh still shows nothing of it.`,
    "solids",
  ),
  release(
    "2026-11-02T13:17:00Z",
    "analysis-tool",
    "Measure and read curves in 3D",
    `The 3D Modeling set has the Analysis tool, in the 3D view.
- Proximity: click two solids, surfaces, curves or 3D loci. It marks where they come nearest with 3D loci and tells you how far apart that is.
- Where they cross it marks that instead: 3D loci for a curve, a 3D polygon for two solids.
- Interrogation: click a curve or surface and move along it to see its curvature circle in red and its tangent or normal in blue.
- Click again for its radius and curvature there, and add the circle, the line or 3D loci to the drawing.
- Curvature is worked out from neighbouring points, since curves are polylines and surfaces triangles here, so a corner in a polyline reads as a tight circle.`,
    "solids",
  ),
  release(
    "2026-11-02T13:16:00Z",
    "project-tool",
    "Project curves onto solids",
    `The Project tool sends a curve along its plane's normal through a solid or surface.
- Split cuts the object along the curve into a group of pieces
- Trim takes away the side you click
- Add stands a rib on a solid, upward, downward or both, until it meets the first face
- Open curves work for Split and Trim if both ends lie outside the object
- Results are meshes with no history, up to about 4,000 triangles`,
    "solids",
  ),
  release(
    "2026-11-02T13:15:00Z",
    "extract-tool",
    "Extract points, curves and surfaces",
    `The Extract tool takes geometry off a solid or surface and leaves the object as it was.
- Extract Point puts 3D loci at the start, end and middle of an edge, and at a circle's centre
- Extract Curve follows edges with 3D polygons
- Extract Iso-parametric Curves slices a face along or across at the click
- Extract Surface copies a face as an open mesh, or its outline with Create Planar Objects
- Shift-click to choose several, then Apply or press Enter
- Results are 3D polygons, 3D loci and meshes, not NURBS`,
    "solids",
  ),
  release(
    "2026-11-02T13:14:00Z",
    "locus-3d",
    "3D loci",
    `Mark points in space with the 3D Locus tool, and make them from survey data.
- Click to place one in Top/Plan or in the 3D view, on a face, a working plane or at an elevation
- Edit its X, Y and Z in Object Info
- AEC > Survey Input > 3D Polygons to 3D Loci puts one at each vertex, and 2D Polys to 3D Source Data can make them too
- Modify > Convert > Stake Object from 3D Locus turns them into labelled stakes
- 3D loci can only be clicked in Top/Plan for now`,
    "site",
  ),
  release(
    "2026-11-02T13:13:00Z",
    "deform-tool",
    "Twist, taper, bulge and bend solids",
    `The 3D Modeling set has the Deform tool, working right on the model in the 3D view.
- Twist Solid turns a solid about an axis, past a full turn if you like. Twist Face twists one face and the faces next to it, leaving the rest alone.
- Taper Solid and Bulge Solid scale a solid along its height, by the same ratio both ways or only along one direction.
- Bend Solid lays a solid round an arc along a spine you click, both ways or one way, for the spine's length or the whole object.
- Click to choose, click for the centre and the reference line, then move the pointer to preview it, or type the angle or ratio. A working plane, if you have one on, says where the centre goes.
The result is a mesh of many small faces, and can't be changed back by a number afterward.`,
    "solids",
  ),
  release(
    "2026-11-02T13:12:00Z",
    "push-pull-offset-edge",
    "Push and pull faces",
    `Two more tools in the 3D Modeling set, both working right on the model in the 3D view.
- Push/Pull. Click a face, move the pointer to see the change, and click to set it, or type the distance. Extrude Face adds a slab with square sides or cuts one in, on flat or curved faces, and raises a flat closed curve into a solid. Move Face slides a flat face, its neighbours running on to meet it and anything standing on it going along. Sub-Face does this to the part of a face a curve marks out.
- Offset Edge. Offsets an edge or a whole loop across a flat face or off it, as a 3D polygon. Turn on its Push/Pull mode to go straight on and push or pull what it marks out.
Results on solids are meshes, and don't keep a history of the push to edit later.`,
    "solids",
  ),
  release(
    "2026-11-02T13:11:00Z",
    "power-pack-fillet-stitch",
    "Fillet, stitch, extend and rebuild surfaces",
    `The rest of Model > 3D Power Pack's surface editing, working on meshes and 3D polygons.
- Create Fillet Surface rounds the corner between two open meshes with a circular, linear or blended section, and can trim them back to it
- Stitch and Trim Surfaces finds the volumes that crossing surfaces enclose, trims away the flaps and makes each a closed mesh
- Extend NURBS carries a 3D polygon past an end, or a mesh past an edge, straight on or following its curve
- Rebuild NURBS redraws 3D polygons and four-sided or tube-shaped meshes with a chosen number of points, showing the maximum deviation
- Extend, Rebuild and Fillet preview in orange in the 3D view while their dialogs are open`,
    "solids",
  ),
  release(
    "2026-11-02T13:10:00Z",
    "power-pack-surfaces",
    "Planar caps, drapes and unfolding",
    `Model > 3D Power Pack now makes and flattens surfaces.
- Create Planar Caps closes a solid's open ends, and Add Solids now joins meshes, so the caps and the solid become one closed mesh
- Create Surface from Curves fills one closed curve or open curves that meet end to end, flat, between four sides, or stretched across
- Create Drape Surface hangs a rectangular surface over the selected objects, down to a Plane Z Value
- Revolve with Rail turns a profile round an axis, its farthest point following a rail: a tent over a square, for one
- Unfold Surfaces lays developable surfaces out flat as polygons, a cylinder as a rectangle and two circles
- Results are meshes of flat pieces rather than NURBS surfaces`,
    "solids",
  ),
  release(
    "2026-11-02T13:09:00Z",
    "loft-surface",
    "Loft Surface and 3D Polygon",
    `The 3D Modeling tool set can now loft a shape through curves, and draw the curves to loft.
- Loft Surface goes through cross sections of any shape, with no rail, one rail or two.
- Click each curve in the 3D view, then Loft: reverse a curve or move its start, and choose Ruled, Closed, Create Solid and Keep Curves, with the 3D view showing the result as you go.
- 3D Polygon draws corner by corner, at an elevation in Top/Plan, or on a face or at that elevation in the 3D view.
- Rodeo has no NURBS, so curves stay polygons and the loft is a mesh of flat pieces.`,
    "solids",
  ),
  release(
    "2026-11-02T13:08:00Z",
    "solid-edge-tools",
    "Chamfer, fillet, shell and taper solids",
    `The 3D Modeling tool set can now change a solid's edges and faces, in the 3D view.
- Chamfer Edge and Fillet Edge cut a single edge, all of a cylinder's rim from one click, a face's edges or every edge.
- Shell Solid hollows a solid to a thickness, inside or outside, leaving the faces you click open.
- Taper Face leans a face by an angle, turning about where it meets a face you click first.
- Click to choose, Shift-click for more, drag to orbit, then Apply or press Enter.
- The result is a mesh you can edit again with these tools, but its setback or radius can't be changed afterward.`,
    "solids",
  ),
  release(
    "2026-11-02T13:07:00Z",
    "focus-along-path",
    "Focus lights along a path",
    `Focus a whole row of lights in one go.
- Select some lighting devices, choose Focus Lighting Devices Along Path in the Rigging tools, then click a shape or draw a path.
- Each beam lands on the closest point of the path, or the beams spread evenly along it.
- You see each beam and its centre line as you move, before anything changes.
- Preferences can mark each spot with a numbered focus point.`,
    "fasteners",
  ),
  release(
    "2026-11-02T13:06:00Z",
    "equipment-key",
    "Equipment Summary Key",
    `Put a table of your equipment right on the drawing for crews and clients.
- The Equipment Summary Key in the Rigging tools lists lighting devices by type and other plug-in objects, with how many of each and a total.
- Add summaries of the gels, gobos and circuits in use, with colour swatches for the gels.
- Filter a key to one hanging position, and it shows that position's height too.
- Items and Elements chooses what's listed, symbols included. Click Refresh after the drawing changes.`,
    "records",
  ),
  release(
    "2026-11-02T13:05:00Z",
    "photometers",
    "Photometer and Photometric Grid",
    `Read how much light lands where, from the lighting devices in your drawing.
- The Photometer in the Rigging tools shows the light at one point, in footcandles or lux depending on the drawing's units.
- The Photometric Grid shows readings across an area. Place it along its center line or its edge, and tilt it for a raked stage.
- Threshold Settings colours each reading, so dim and hot spots stand out.
- Click Refresh in Object Info after moving a light. The numbers come from Rodeo's own beam model, so treat them as estimates.`,
    "gears",
  ),
  release(
    "2026-11-02T13:04:00Z",
    "export-kml",
    "Export KML and a compass ring",
    `Send the 3D model to Google Earth, and see true north on the view cube.
- File > Export > Export KML writes the 3D objects at their place on the Earth, a folder for each layer and a placemark for each object.
- A georeferenced drawing's place fills in by itself. Otherwise type a reference point, its latitude and longitude and Page North.
- Z Height Offset lifts the model off the ground, and you can send the active layer or all the visible ones.
- In a georeferenced drawing the Onscreen View Control now has a compass ring with N at true north. Show Compass Ring turns it off.`,
    "site",
  ),
  release(
    "2026-11-02T13:03:00Z",
    "georeferencing",
    "Georeferencing and the GIS tools",
    `You can now place a drawing on the Earth and measure over it.
- File > Document Settings > Georeferencing sets where the origin is and the angle to true north, in a local system, UTM or Pseudo-Mercator.
- The new GIS tool set has Graticule, Great Circle, Survey Point and GIS Stake, and Modify > Move Geographic moves things to a latitude and longitude.
- Georeferencing is kept in this browser under the file's name, not in the file. There are no other coordinate systems or background maps yet.`,
    "site",
  ),
  release(
    "2026-11-02T13:02:00Z",
    "create-roof",
    "Create Roof",
    `AEC > Create Roof puts a roof over the walls or closed shape you've selected.
- It hips every edge, with valleys at inward corners, so L and T plans work. Click an edge in the dialog to make it a gable.
- Set the eave profile, thickness, pitch, bearing height, eave height and overhang, and Calculate works out any of those last four.
- The roof is a plain group of plan and solid, so to change it, make it again. There are no styles, dormers or skylights yet.`,
    "walls",
  ),
  release(
    "2026-11-02T13:01:00Z",
    "hvac",
    "HVAC ducts and fittings",
    `The MEP tool set can now lay out ductwork, in plan and in 3D.
- Straight Duct, Elbow Duct, Flex Duct, Vertical Duct, Transition, Splitter, Damper, Diffuser and Outlet.
- Rectangular or round, at the height you set, with an optional size label and a marker giving the height of the top and bottom.
- Fittings don't join up by themselves yet, and there are no flanges or insulation.`,
    "gears",
  ),
  release(
    "2026-11-02T13:00:00Z",
    "parking-spaces",
    "Parking Spaces tool",
    `Site Planning has a new Parking Spaces tool: click to place a whole row, or press and drag to turn it.
- Single bays, double bays or parallel spaces, at any angle, with a straight or angled header.
- Accessible spaces with their symbol and aisles, at either end of the row.
- Numbers, bumpers, and a choice of which stripes show, with the stripes and bumpers in 3D too.
- It's drawn as plain objects in a group, so to change a row, place it again.`,
    "site",
  ),
  release(
    "2026-11-02T12:59:00Z",
    "fasteners-holes-3d",
    "The rest of the fasteners in 3D, and holes to cut",
    `Every fastener with a 3D tool in Vectorworks now has one here, and the hole tools can cut a real solid.
- Cotter Pin, Wing Nuts, Retaining Rings and Washers, Eye, Swing, Swing Eye, T, U and J Bolts, Thumb Screw, Carriage Bolt, Lag Screw, Wood Screw and Sheet Metal Screw - 3D: a solid and its plan, from the same sizes as the 2D tool.
- Hole - Drilled and Hole - Tapped (Metric, Inch) - 3D: a solid hole with the mouth at the layer's level. Select it with a solid and choose Subtract Solids to cut it.
- There are no threads, or slots and recesses in screw heads, and a tapped hole is its tap drill's size.`,
    "fasteners",
  ),
  release(
    "2026-11-02T12:58:00Z",
    "bolt-and-nut",
    "Bolt and Nut tools",
    `Detailing has Bolt and Nut in inch and mm, a bolt through a joint with everything that goes on it.
- Hex or square bolts and nuts (inch), narrow, regular or wide washers, lock washers top and bottom
- The bolt's length follows the joint and its stack, in standard lengths, or you can type it
- Front, side, top and bottom views, with simplified, schematic or detailed threads, and a solid for 3D`,
    "fasteners",
  ),
  release(
    "2026-11-02T12:57:00Z",
    "machine-components-3d",
    "Machine components in 3D",
    `Twenty-nine new tools in the Machine Components set build solids, from the same Preferences as their 2D versions.
- Spur gears and sprockets have their real teeth, worms a real helical thread, and racks their tooth profile
- Bearings, pulleys, lock nuts and Belleville stacks are turned from their sections; pillow blocks and flanged bearings have their bolt holes and slots
- Compression, conical, die, extension and torsion springs are wire swept along their coils
- Each one places as a solid with its top view for plan, grouped. Bevel gears have no teeth, and keyways, spokes and bearing cages aren't modelled`,
    "gears",
  ),
  release(
    "2026-11-02T12:56:00Z",
    "fasteners-3d",
    "Pins, rivets and nuts in 3D",
    `Fifteen fasteners now have a 3D tool beside the 2D one, with the same sizes and Preferences.
- Clevis, Dowel, Parallel and Taper Pins; Large, Small, DIN and Tubular Rivets; Acorn, Hex Cap and Knurled Thumb Nuts.
- A click places a solid, with the fastener's top view showing in plan. Hex bodies keep their chamfers.
- There are no threads or knurling yet, and acorn and hex cap nuts are closed underneath.`,
    "fasteners",
  ),
  release(
    "2026-11-02T12:55:00Z",
    "plain-walls",
    "Walls and records on a blank drawing",
    `A new blank drawing can now draw walls and hold records, with nothing to copy them from.
- Plain walls, 4", 6", 8" and 1' thick and 8' high, or 100 to 300 mm and 2700 mm high in metric, for the Wall tool, Create Objects from Shapes and Create Walls from Spaces.
- They mitre, tee, join, change size and turn into rooms like any other wall. They're a single solid with no components, and haven't been opened in Vectorworks yet.
- New Record Format, Import Shapefile's attributes, and Space Data and Piping Run records now work in any drawing.`,
    "walls",
  ),
  release(
    "2026-11-02T12:54:00Z",
    "stage",
    "The Stage menu: lighting and set design",
    `A new Stage menu takes a show from an empty drawing to the paperwork, with lighting instruments that carry their own data.
- Draw a venue with its stage and seats, keep linesets, and draw a lighting section with beams and sightlines
- See how much of the stage every seat can see, and solve the masking and the seating rake from sightlines
- Keep a set's scenes, scrub between them with a warning when pieces would hit, and get a shift plot and spike sheet
- Draw flats and platforms with cut lists, and lay out a scale model box for a laser cutter
- Plan a wash, see beam pools and a lux map, set looks with cross-fades, and see beams in 3D
- Make instrument schedules, hookups, colour cuts, focus cards with QR codes and a magic sheet
- Patch and export to a console or MVR, check pipe loads and power across phases, and audit the whole show
- Light and load figures are estimates for planning, from typical values, and MVR hasn't been tried in other software yet`,
    "section",
  ),
  release(
    "2026-11-02T12:53:00Z",
    "space-planning",
    "Spaces from walls, and walls from spaces",
    `Plan rooms the way Vectorworks does, with a fuller Space tool and new commands in AEC > Space Planning.
- Click inside walls or pick the walls round a room, as well as drawing a rectangle or polygon
- Numbers count on as you go, through integers or letters, with name, occupant and area data on each space
- Create Spaces from Walls finds every room or the gross floor, and run again it reshapes them to moved walls
- Create Walls from Spaces makes exterior and interior walls, joined up, in the wall styles your drawing has
- Convert drawn shapes to spaces, and re-measure spaces after editing them with Update Spaces
- Spaces are grouped objects with their data in a record: there are no room finishes or 3D volumes yet`,
    "walls",
  ),
  release(
    "2026-11-02T12:52:00Z",
    "vegetation-line",
    "Vegetation lines round planting",
    `Show a massed planting with AEC > Plants > Vegetation Line, as Vectorworks does.
- Select overlapping shapes or plant symbols and get one line round their outer edge
- Follow the edge exactly, or draw it as a cloud with the arc sizes and billow you choose
- Keep the originals to reveal them by hiding the line's class, or delete them
- Symbols count as the ellipse their box holds, so an unusually shaped one is approximate`,
    "site",
  ),
  release(
    "2026-11-02T12:51:00Z",
    "piping-run",
    "Piping runs with material counts",
    `Draw conduit runs and see what they'll take, as Vectorworks does, with MEP's Piping Run tool or AEC > Electrical > Create Piping Runs for shapes you've drawn.
- Get the length, sections, couplings and elbows for each run, across as many runs as you need
- Use elbows at the corners, or bends at a radius you set
- Each run is tagged with its size and material, and any remarks
- The figures go in a record you can report on, in drawings that hold records
- They're worked out when the run is placed, and don't follow later reshaping`,
    "site",
  ),
  release(
    "2026-11-02T12:50:00Z",
    "existing-tree",
    "Existing trees on site plans",
    `Survey the trees on a site with Site Planning's Existing Tree tool, as Vectorworks does.
- Click to place a tree, or press and drag to turn it
- Mark each one to retain, remove or transplant, and colour it by significance
- Set its canopy, trunk, root zones and protection zone, including 12 x DBH
- Trees number themselves as you go, and a tag shows the number and names
- Drawn in plan as ordinary grouped objects: there's no 3D tree or species list yet`,
    "site",
  ),
  release(
    "2026-11-02T12:49:00Z",
    "steel-3d",
    "3D steel sections",
    `Place steel as solids, as Vectorworks' Angle - 3D, Channel - 3D and the rest do.
- Detailing > Steel Section - 3D: wide flange, channel, angle, tee, I-beam, rectangular, square and round tubing, and Z-section, on keys 1 to 9
- A click places it standing on the layer at the Length in its Preferences, and a press dragged turns it
- These are plain extrudes, so a later size change means placing a new one`,
    "solids",
  ),
  release(
    "2026-11-02T12:48:00Z",
    "create-viewport",
    "Create viewports on sheets",
    `Lay out your drawing on a sheet with View > Create Viewport…, as Vectorworks does.
- Name it, pick a sheet layer or make a new one, and set its scale and which design layers show, gray or hide
- It shows everything those layers draw, or just the box of a closed shape you've selected
- It stays live: edits to the drawing show on the sheet straight away
- Works in new blank drawings too. Viewports made this way are plans; sections and 3D views aren't made yet`,
    "section",
  ),
  release(
    "2026-11-02T12:47:00Z",
    "pillar",
    "Pillars and screens from shapes",
    `Stand a 2D shape up in one step, as Vectorworks' Pillar command does.
- AEC > Pillar…: the selected rectangles, circles, ovals and closed polygons become pillars of the height you give
- Lines, open polylines and arcs become flat screens, for movie screens and room dividers
- Pillars are plain extrudes and screens plain meshes, so walls don't join to them yet`,
    "solids",
  ),
  release(
    "2026-11-02T12:46:00Z",
    "redline-status",
    "Close out redlines",
    `Track redlines as they're dealt with, as Vectorworks' Redlines commands do.
- Text > Redlines > Pick up Redline: the selected redlines close, turning yellow with the date they were picked up
- Restore Redline opens them again, red and with the date they were made
- Show or Hide Redlines switches the Notes-Redlines class, where every new redline now goes
- Create Redline Status WS: a Redlines Status Report worksheet of the open and closed ones, with each one's layer, date and comment
- Pick up and Restore are on the right-click menu too
- These work on redlines drawn from now on; a drawing with no worksheet shows the report in a dialog`,
    "sheet",
  ),
  release(
    "2026-11-02T12:45:00Z",
    "steady-cloud-saves",
    "Steadier cloud saves",
    `Saving to the cloud no longer piles up on a slow connection, and a full plan now says so.
- One save runs at a time. A large drawing used to start another full save every 30 seconds while the first was still uploading
- File > Save writes the drawing out once, so the editor freezes for half as long on a large one
- When your plan has no room for another version, autosave tells you and stops trying, then starts again by itself once there is room. Your changes are kept until then
- File > Save on a full plan now says it failed. It used to look as if it had saved`,
    "cloud",
  ),
  release(
    "2026-11-02T12:44:00Z",
    "station-on-polyline",
    "Station points on a road line",
    `Stake a road's centerline, as Vectorworks' Station on Polyline does.
- AEC > Roads > Station on Polyline…: a labeled stake every 100 feet, at a partial interval between them, and at the line's end
- Curve data for each circular curve: its PC, PT, included angle, tangent, radius, length and chord
- Draw that data at each curve with its tangent guide lines, or list it in a worksheet`,
    "site",
  ),
  release(
    "2026-11-02T12:43:00Z",
    "conduit-sizing",
    "Conduit sizing",
    `Work out the conduit a set of wires needs, as Vectorworks' Conduit Sizing Calculator does.
- AEC > Electrical > Conduit Sizing Calc…: list the wires by type, size and number, or type any wire's area
- Pick the conduit type and how many share the wires
- It suggests the NEC fill percentage, which you can change
- It reports the actual diameter needed, the trade size and the fill at that size`,
    "gears",
  ),
  release(
    "2026-11-02T12:42:00Z",
    "rotate-plan",
    "Rotate the plan",
    `Turn the plan on screen to work along a slanted wall or site line, as Vectorworks' Rotate Plan does. The drawing itself doesn't move.
- View > Rotate Plan: click the center, then click along the line that should lie level; or type an angle in the View bar
- View > Rotated Top/Plan (⌘5) swaps between the rotated plan and the true one
- The grid, rulers, marquee, selection handles, Shift angles and arrow keys go with the view
- Rectangles, rounded rectangles, ovals, text and symbols you add lie square to the screen`,
    "viewcube",
  ),
  release(
    "2026-11-02T12:41:00Z",
    "big-autosave",
    "Bigger drawings in the cloud",
    `Drawings up to 1 GB save to the cloud, and autosave goes easier on big ones.
- The cloud takes drawings up to 1 GB, up from 400 MB
- Drawings over 100 MB autosave every 15 minutes instead of every 2, so the editor pauses less often
- Each autosave of a big drawing replaces the one before it, rather than keeping another full copy against your storage. File > Save still keeps every version
- Version History marks autosaves; Label… one to keep it
- Saving a drawing of several hundred MB no longer fails part way through the upload`,
    "cloud",
  ),
  release(
    "2026-11-02T12:40:00Z",
    "hedgerow",
    "Hedgerow tool",
    `Plant a hedge along a path in plan, as Vectorworks' Hedgerow tool does.
- Site Planning > Hedgerow: click the path's corners, or click back on the first one for a ring
- Centre it on the path or lay it to one side, with smooth or sharp corners
- Edge it with a single line, a plant cloud bulging out or in, or a rough plant line
- It reports its length, area and how many of each plant it takes`,
    "site",
  ),
  release(
    "2026-11-02T12:39:00Z",
    "script-palettes",
    "Script palettes",
    `Keep the scripts you use often a double-click away, as Vectorworks' script palettes do.
- Window > Script Palettes makes named palettes of Python scripts and Vectorscripts
- Double-click a script to run it on the open drawing, as one undo step
- Write them in the Script Editor, or import a .py or .vs file; rename, duplicate, export or delete them from the right-click menu
- Your script palettes are kept in this browser, for every drawing`,
    "code",
  ),
  release(
    "2026-11-02T12:38:00Z",
    "reset-all-plugins",
    "Reset All Plug-Ins",
    `Bring every plug-in object up to date with its plug-in in one go, as Vectorworks' Reset All Plug-ins does.
- Tools > Utilities > Reset All Plug-Ins draws each plug-in object again from its parameters
- Installed Vectorworks plug-ins use their current script, so an updated plug-in reaches the objects already placed
- A status window says how many were reset, which failed and why, and which were left as they were`,
    "plug",
  ),
  release(
    "2026-11-02T12:37:00Z",
    "projection-2d-plan",
    "2D Plan in Projection",
    `Switch between the plan and any 3D projection from one list, as Vectorworks' Projection menu does.
- View > Projection and the View bar's Projection pop-up now start with 2D Plan, ticked while the plan shows
- Picking Orthogonal, a perspective or an oblique projection from the plan opens the 3D view in it
- The View bar's Projection pop-up works in the plan too, not only in 3D`,
    "viewcube",
  ),
  release(
    "2026-11-02T12:36:00Z",
    "edit-crop",
    "Crop images",
    `Cut a picture down to the part you need, as Vectorworks' Edit Crop does.
- Modify > Edit Crop…, or right-click an image: draw a rectangle, circle or polygon over it and select both
- A rectangle crops it square; any other shape crops to its outline and leaves the rest clear
- The image keeps its scale, and the shape goes or stays as a frame
- With the image alone selected, trim a length off each side instead`,
    "marquee",
  ),
  release(
    "2026-11-02T12:35:00Z",
    "modify-by-record",
    "Modify by Record",
    `Let your data drive the drawing: colour, scale or extrude objects by a number in their records.
- Tools > Records > Modify by Record… colours objects along a gradient, by ranges or by value
- Resize scales each object by its value; Extrude makes it that tall
- Elevate 2D Polys turns polygons into 3D polygons at the height their record gives
- Works across the drawing or the selection, inside groups if you ask, in one undo step`,
    "records",
  ),
  release(
    "2026-11-02T12:34:00Z",
    "big-cloud-saves",
    "Big drawings save to the cloud",
    `Large drawings save to the cloud, and Rodeo keeps working through an update.
- Drawings over 100 MB now save to the cloud: they go up in parts, with a bar showing how far along
- A drawing too large for the cloud says so at once, instead of after a long wait
- Render Image and other tools no longer fail with "couldn't be downloaded" when Rodeo updates while your tab is open
- Rodeo now tells us about errors on its own, so we can fix them sooner. Your drawing is never sent`,
    "speed",
  ),
  release(
    "2026-11-02T12:33:00Z",
    "renderworks-styles",
    "Renderworks styles",
    `Pick a finished render look in one click, as Vectorworks' default styles offer.
- View > Renderworks Style: Preview, Realistic Fast and Final, for exteriors, interiors and exteriors at night
- Each sets the render mode, sky, sun, lights, exposure and quality together; Final styles path trace
- Render Style White Model shows the model in matte white
- The View bar's Render mode menu lists the styles too, the one in effect ticked`,
    "sphere",
  ),
  release(
    "2026-11-02T12:32:00Z",
    "edit-buttons",
    "Small edit buttons",
    `Keep the buttons over the drawing out of the way.
- Window > Edit Group and Object Visibility Options > Use Small Buttons shrinks Exit Group, Exit Symbol and Unhide Objects to their icons
- Use Large Buttons shows their labels again; the choice is kept in this browser
- Unhide Objects now sits under the View bar with the edit bars instead of on top of it`,
    "shapes",
  ),
  release(
    "2026-11-02T12:31:00Z",
    "lighting-options",
    "Lighting Options",
    `Set the model's lighting in one place, as Vectorworks does.
- View > Set Lighting Options… sets indirect light bounces, ambient light and ambient occlusion
- Emitter Brightness turns every light object up or down at once`,
    "sphere",
  ),
  release(
    "2026-11-02T12:30:00Z",
    "export-hdri",
    "Export HDRI",
    `Save a render as a lossless HDR file.
- File > Export > Export HDRI… renders the view or a camera and saves a Radiance .hdr
- The picture stays linear and unclipped, so you can grade it later without banding
- Fast or Photoreal, at any size up to 4096 × 4096`,
    "camera",
  ),
  release(
    "2026-11-02T12:29:00Z",
    "texture-menu",
    "Texture right-click commands",
    `Fix a texture's mapping in one click.
- Right-click a textured object, or a part in Object Info's Render tab
- Rotate Texture by 90°, Reset to Default Mapping or Remove Texture Override
- Expand All and Collapse All fold the Render tab's parts`,
    "solids",
  ),
  release(
    "2026-11-02T12:28:00Z",
    "replace-with-symbol",
    "Replace with Symbol",
    `Swap objects for a symbol in one go.
- Modify > Convert > Replace with Symbol… turns the selected objects into instances of a symbol you choose
- A locus's instance lands on its point, anything else's on its centre, in the same layer and class
- Keep the objects' records, add the symbol's own, or both`,
    "shapes",
  ),
  release(
    "2026-11-02T12:27:00Z",
    "camera-pane",
    "Camera view in a new pane",
    `Look through a camera while you keep working in the plan.
- Right-click a Renderworks camera and choose Open Camera View in New Pane
- A floating pane shows the camera's view, shaped like its picture
- It follows the camera as you move or re-aim it`,
    "camera",
  ),
  release(
    "2026-11-02T12:26:00Z",
    "batch-render",
    "Batch rendering",
    `Set up several renders, then make them all in one go.
- View > Rendering > Create Batch Render Job… keeps the view, engine, quality, size and format under a name
- Start Batch Render… renders the jobs you choose, in your order, and downloads the pictures as one zip
- Duplicate, edit or delete jobs there; Esc skips the job in hand`,
    "camera",
  ),
  release(
    "2026-11-02T12:25:00Z",
    "import-usd-binary",
    "Import binary USD",
    `Import USD now reads binary USD too.
- File > Import > Import USD… opens .usdc files and the .usdz packages Blender and most USD tools write
- The same meshes, materials and placement as from USD text`,
    "solids",
  ),
  release(
    "2026-11-02T12:24:00Z",
    "import-usd",
    "Import USD",
    `Bring USD models in as meshes.
- File > Import > Import USD… reads text USD (.usda, .usd) and .usdz packages that hold it
- Meshes come in where the file puts them, coloured by their materials and grouped by layer
- Re-scale it, redefine its up axis, offset it or bring it in as a symbol
- Binary USD isn't read yet`,
    "solids",
  ),
  release(
    "2026-11-02T12:23:00Z",
    "export-usd",
    "Export USD",
    `Send the model to USD apps such as Omniverse, Blender and Houdini.
- File > Export > Export USD… writes a .usdz package or USD text (.usda or .usd)
- Organize it by layer or by texture, and combine each texture's objects into one mesh if you like
- Each object keeps its name, type, class and layer, and its record data if you ask
- Colours and textures go as USD materials`,
    "solids",
  ),
  release(
    "2026-11-02T12:22:00Z",
    "set-sun-position",
    "Set Sun Position",
    `Light a model with the sun for a place, date and time.
- View > Set Sun Position… takes the site's latitude, longitude and time zone, page north, the date, the time and daylight saving
- It shows the sun's azimuth, elevation and true solar time as you type
- OK turns the selected directional lights to the sun, or adds a directional light where you are looking`,
    "site",
  ),
  release(
    "2026-11-02T12:21:00Z",
    "hatch-from-local-mapping",
    "New Hatch from Locally Mapped Hatch",
    `Keep a hatch you laid by hand as a hatch of its own.
- Right-click an object whose hatch you moved, turned or skewed with Attribute Mapping
- New Hatch from Locally Mapped Hatch saves it as a new hatch with that laying built in
- The object takes the new hatch and looks as before, and other objects can use it too`,
    "records",
  ),
  release(
    "2026-11-02T12:20:00Z",
    "locate-in-resource-manager",
    "Locate in Resource Manager",
    `Find the resource an object uses from its right-click menu.
- Right-click a symbol, or an object with a hatch, gradient, tile, line type, text style or texture
- Locate … in Resource Manager opens Resources with that resource selected and scrolled to
- A symbol becomes the one the Symbol tool places, without switching tools`,
    "records",
  ),
  release(
    "2026-11-02T12:19:00Z",
    "add-dimensions",
    "Add Dimension(s)",
    `Click more witness lines onto a chain dimension.
- Right-click a chain or a linear dimension and choose Add Dimension(s)
- Each click adds a witness line: inside the chain it splits that dimension, past an end it extends the chain
- Double-click or Enter ends, Backspace takes back the last one`,
    "grid",
  ),
  release(
    "2026-11-02T12:18:00Z",
    "chain-dimension-menu",
    "Chain dimension commands",
    `Right-click a chain dimension to split it or drop a witness line.
- On a witness line: Split Dimension makes two chains meeting there, Delete Witness Line joins the dimensions either side
- On a dimension: Split Dimension takes it out between two chains, Edit Dimension opens it alone in Object Info
- Joined dimensions measure again, and a chain left with one dimension is just that dimension`,
    "grid",
  ),
  release(
    "2026-11-02T12:17:00Z",
    "select-vertex-in-oip",
    "Select Vertex in Object Info",
    `Right-click a vertex to edit it by numbers.
- Right-click a polygon's or polyline's vertex and choose Select Vertex in Object Info Palette
- Object Info opens on its Shape tab at that vertex, ready to type its position, type or radius
- A selected polyline's arc vertex works too, at its handle off the curve`,
    "shapes",
  ),
  release(
    "2026-11-02T12:16:00Z",
    "light-to-view",
    "Set Light to View",
    `A light's right-click menu turns it on or off and lines it up with the view.
- Right-click a light: Turn On or Turn Off
- Set Light to View aims a spot or directional light the way the view looks
- Set View to Light turns the 3D view to look the way the light shines; both are Object Info buttons too`,
    "camera",
  ),
  release(
    "2026-11-02T12:15:00Z",
    "radius-smoothing",
    "Radius vertices",
    `Convert Arc to Radius Polyline now works as Vectorworks' does, and Radius Smoothing joins Poly Smoothing.
- Right-click a polyline with arc vertices: they become radius vertices on the curve, the curve unchanged
- Drag a radius vertex to reshape its arc; fillets on one circle become one radius vertex
- Modify > Smoothing is now Poly Smoothing, with Vectorworks' names and Radius Smoothing`,
    "shapes",
  ),
  release(
    "2026-11-02T12:14:00Z",
    "arc-to-radius-polyline",
    "Two right-click commands",
    `Right-click an arc or a symbol for two more Vectorworks commands.
- Convert Arc to Radius Polyline turns a circular arc or circle into a polyline of radius vertices
- Each vertex covers at most 90° of the curve, so its radius can be edited on its own
- Select Objects of Same Symbol selects every instance of the symbol right-clicked`,
    "shapes",
  ),
  release(
    "2026-11-02T12:13:00Z",
    "create-polys-from-walls",
    "Create Polys from Walls",
    `AEC > Create Polys from Walls… draws room and outline polygons from walls.
- Select walls and choose AEC > Create Polys from Walls…
- Net Area (Room) Polys fills each room the walls close; Gross Area Polys goes round their outside
- Door and window gaps are bridged, and a toast gives the total area
- Object Info names types in words: "3D polygon", not "3d-polygon"`,
    "walls",
  ),
  release(
    "2026-11-02T12:12:00Z",
    "validate-3d-data",
    "Validate 3D Data",
    `AEC > Terrain > Validate 3D Data checks 3D polygons before they become a site model.
- Select 3D polygons (or groups of them) and choose AEC > Terrain > Validate 3D Data
- It finds copies, points repeated in a row, points one above another and points used twice
- Delete or Remove corrects a problem in one step; Select picks the polygons to look at`,
    "site",
  ),
  release(
    "2026-11-02T12:11:00Z",
    "2d-polys-to-3d-source-data",
    "2D Polys to 3D Source Data",
    `AEC > Survey Input > 2D Polys to 3D Source Data… lifts drawn contours into 3D polygons at their elevations.
- Select the contours (polygons, polylines, lines, arcs, circles...) and give a start elevation and interval
- Set Elevation steps through them from the backmost, each highlighted: Up and Dn move it by the interval
- Delete the originals or keep them; the 3D polygons are ready as a site model's source data
- In Conductor Sizing Calc… the Size box now shows the wire size it works out`,
    "site",
  ),
  release(
    "2026-11-02T12:10:00Z",
    "conductor-sizing",
    "Conductor Sizing Calculator",
    `AEC > Electrical > Conductor Sizing Calc… sizes a wire run by its voltage drop.
- Choose what to work out: wire size, voltage drop, current, length of run, voltage, phase factor or resistivity
- Copper or aluminum, 18 AWG to 1000 kcmil, at the temperature you give
- The answer follows as you type, with the nearest AWG and the next size up for a wire size`,
    "plug",
  ),
  release(
    "2026-11-02T12:09:00Z",
    "simplify-3d-polygons",
    "Simplify 3D Polygons",
    `AEC > Terrain > Simplify 3D Polygons… thins out 3D polygons into copies.
- Select 3D polygons and choose AEC > Terrain > Simplify 3D Polygons…
- Give a tolerance and the layer the simplified copies go to; the originals stay as they are
- Copy and Paste now work on 3D polygons straight after Convert to 3D Polygons, Create Contours or Create Helix-Spiral makes them`,
    "solids",
  ),
  release(
    "2026-11-02T12:08:00Z",
    "helix-spiral",
    "Create Helix-Spiral",
    `Model > 3D Power Pack > Create Helix-Spiral… coils a 3D polygon round a path.
- Select lines, arcs, polygons, polylines or 3D polygons and choose Model > 3D Power Pack > Create Helix-Spiral…
- Give the turns or the pitch, the start and end radius (different for a spiral), the start angle and which way it turns
- Sweep a circle along the coil with Extrude Along Path to make a spring`,
    "solids",
  ),
  release(
    "2026-11-02T12:07:00Z",
    "section-solids",
    "Section Solids",
    `Model > Section Solids… cuts a solid with a plane or another solid.
- Select a solid and a flat 3D polygon larger than it, or a second solid, and choose Model > Section Solids… (⌥⌘T)
- The polygon cuts away the side its normal points to, a solid the part inside it; Reverse Direction cuts the other way
- What is left becomes a mesh, its cut faces in the sectioning object's colours`,
    "solids",
  ),
  release(
    "2026-11-02T12:06:00Z",
    "extrude-along-path",
    "Extrude Along Path",
    `Model > Extrude Along Path… sweeps a profile along a path.
- Select a closed shape and a line, arc, polygon, polyline or 3D polygon, and choose Model > Extrude Along Path… (⌥⌘X)
- Pick which is the path, an even scale toward its end and whether the profile stays upright: the two become one mesh`,
    "solids",
  ),
  release(
    "2026-11-02T12:05:00Z",
    "tapered-extrude",
    "Tapered Extrude",
    `Model > Tapered Extrude… extrudes shapes with leaning sides.
- Select rectangles, polygons, polylines, circles or ellipses and choose Model > Tapered Extrude… (⌥⌘U)
- Give the height and the taper angle: a positive angle leans the sides in, a negative one out`,
    "solids",
  ),
  release(
    "2026-11-02T12:04:00Z",
    "intersect-solids",
    "Intersect Solids",
    `Model > Intersect Solids keeps only where solids overlap.
- Select two or more extrudes, sweeps or solids and choose Model > Intersect Solids (⌥⌘I): they become one mesh of the volume they share
- Solids that don't all overlap are left as they are`,
    "solids",
  ),
  release(
    "2026-11-02T12:03:00Z",
    "aec-calculators",
    "Beam, belt and chain calculators",
    `The calculators from the AEC menu.
- AEC > Framing > Simple Beam Calculator… works out a beam's reactions, moments, shear, stress and deflection as you type, for simple, fixed, propped and cantilever beams
- AEC > Machine Design > Belt Length and Chain Length Calculators find a belt's or chain's length round two pulleys or sprockets, or the center distance it fits, and can place the data on the drawing
- AEC > Machine Design > Centroid… shows where a shape's centroid lies and can put a locus there
- AEC > Machine Design > Conversion Factors… and Solution of Triangles…`,
    "gears",
  ),
  release(
    "2026-11-02T12:02:00Z",
    "rotate-3d-commands",
    "Rotate 3D, Simplify Mesh and more commands",
    `More of the menu commands.
- Modify > Rotate 3D… turns 3D objects about the X, Y or Z axis of the layer or the working plane, about their middle, the working plane's centre or a point you click
- Modify > Unrotate 3D Objects turns tilted 3D objects back square to the layer
- Modify > Simplify Mesh… draws meshes with fewer faces and keeps their textures in place
- Modify > Join and Fillet, and Align/Distribute Leader Lines
- Edit > Paste as Bitmap and Text > Find-Replace Text
- View: Fit to Objects, Shaded Options and Line Render Options
- Model > Create Animation makes orbit, spin and walkthrough movies; File > Export > Export Panorama
- Tools > Compress Images makes the images in a drawing smaller`,
    "solids",
  ),
  release(
    "2026-11-02T12:01:00Z",
    "rigging-irrigation-event-tools",
    "Rigging, irrigation, event design and more tools",
    `Many more tools from the tool sets.
- Building Shell: Simple Stair, Ramp, Elevator, Escalator, Structural Member, Railing/Fence, Stake and Pilaster
- Event Design: Stage Deck, Stage Plug, Stage Steps, Stage Ramp, Rope and Stanchion, Soft Goods, Television, Video Screen, LED Screen, Blended Screen, Speaker and Speaker Array
- Rigging: Straight and Curved Truss, Lighting Pipe, Pipe Ladder, House Rigging Point, Hoist, Hoist Origin, Bridle, Mother Grid and Rigging Load
- Spotlight: Lighting Device, Focus Point, Cable Path and Cable, Distributor, Electrical Component, Ganging, and Align and Distribute
- Irrigation: Outlet, Drip Outlet, Pipe, Valve, Point of Connection, Controller, System Component, Design Zone and Hydrozone
- Site Planning: Parking Along Path, Parking Area, Roadways, Fence and Curb
- MEP: Receptacle, Switch, Comm Device and Incandescent Fixture
- Dims/Notes: Dimension Tape, Geom Dim and Tol Note, Title Block Border, Hyperlink, Section-Elevation Line and Leader Lines
- Detailing and more: Linear Material, Framing Member, Torsion Springs, Countertop, Compartment Sink, Custom Cabinet, Triangle and Quarter Arc
- ConnectCAD: Rack Ruler and HopOver; Visualization: Flyover, Translate View and Walkthrough`,
    "site",
  ),
  release(
    "2026-11-01T12:12:00Z",
    "welding-grid-redline",
    "Welding symbols, grid lines and redlines",
    `More Detailing and Dims/Notes tools.
- Welding symbols for fillet, flange, groove, slot or plug, and other welds, each in an AWS and an ISO version
- Grid Line draws structural grid lines with bubbles, parallel, radial or through corners, each taking the next label
- Reference Marker places a drawing and sheet bubble with a note, on a leader
- Redline rings a change in red and runs a leader to a dated tag saying who asked for it and who it's for
- General Notes places a titled block of numbered or lettered notes, in columns
- Detailing: Carriage Bolt, Lag Screw, Wood Screw, Sheet Metal Screw, Bulb Flat, Shaft Break and Shaft Break 2`,
    "grid",
  ),
  release(
    "2026-11-01T12:11:00Z",
    "agents-2d-to-3d",
    "Agents model in 3D from 2D drawings",
    `Ask an agent to turn a floor plan, an elevation or an axonometric sketch into a 3D model.
- It reads walls, doors, windows and rooms from a plan's line work, and measures axonometric drawings even when they aren't exact
- It builds walls with their openings, windows and doors, floors, roofs in tile, slate or thatch with dormers, chimneys and steps
- And the garden: lawns, paths, driveways, hedges, fences and trees
- It looks at its model from the drawing's own direction to check it
- It can model in any drawing, including a new blank one
- Fixed: an agent's answer could stop part way through`,
    "plan3d",
  ),
  release(
    "2026-11-01T12:10:00Z",
    "fasteners",
    "Fasteners",
    `A Fasteners tool set, drawn to the sizes in the ASME, ISO and DIN standards.
- The Fastener tool: bolts and screws (hex, socket head, flange, cap, machine, set and shoulder screws) with washers, lock washers and a nut, or nuts and washers on their own
- Pins: clevis, cotter, dowel, parallel and taper
- Rivets: large, small, DIN and tubular
- Acorn, hex cap, knurled thumb and wing nuts
- Retaining rings and retaining washers
- Eye, swing, swing eye, T-, U- and J-bolts, and thumb screws`,
    "fasteners",
  ),
  release(
    "2026-11-01T12:09:00Z",
    "machine-components",
    "Machine Components",
    `A new tool set of machine parts, each drawn from the sizes you set in its Preferences.
- Spur gears and racks, bevel gears, and worms with their worm gears
- Sprockets with linear, circular and offset-link roller chains, and pulleys
- Ball, roller, needle, tapered roller and thrust bearings, pillow blocks, flanged bearings and bearing lock nuts
- Keys and Woodruff keys
- Compression, conical, die, extension and Belleville springs
- Shafts built segment by segment in the Shaft Configuration dialog, with tapers, threads, keyways, grooves and wrench flats`,
    "gears",
  ),
  release(
    "2026-11-01T12:08:00Z",
    "vectorworks-plugins",
    "Vectorworks plug-ins",
    `Install the menu commands, tools and objects made with Vectorworks' Plug-in Manager, in Python or Vectorscript, and use them in Rodeo.
- Install a plug-in from its files or a zipped plug-in folder; it stays in this browser
- Commands and tools run from Plug-ins > Vectorworks Plug-ins, and a tool takes its clicks in the drawing
- Plug-in objects are placed with the Plug-in Insertion tool and draw again when you change them in Object Info
- An object that lays out its own Object Info shows that layout, with its dividers, lines of text, buttons, and greyed or hidden fields
- The dialogs a plug-in's script builds open as real dialogs
- Encrypted plug-ins can't be run`,
    "plug",
  ),
  release(
    "2026-11-01T12:07:00Z",
    "furniture-detailing",
    "Furniture, fixtures and detailing tools",
    `More of Vectorworks' tool sets.
- Furniture/Fixtures: Desk, Shelving Unit, Clothes Rod, Bath-Shower, Grab Bars, Fireplace, Toilet Stall, Ceiling Grid, Cabinet and Seating Section
- Detailing: steel tubing and I-beams, Z-sections, drilled and tapped holes, slots, hole patterns, screw threads and keyways
- Dims/Notes: Symmetry Label, Center Mark, Arc Length and Slope dimensions, and Feature Control Frame`,
    "furniture",
  ),
  release(
    "2026-11-01T12:06:00Z",
    "exports-file-health",
    "More exports, and a check-up for files",
    `New ways to get pictures and drawings out, and to see how a file is doing.
- Export Image File as PNG, JPEG, TIFF or BMP, and Export EPSF
- Export Metafile and Import Metafile
- Text > Convert Text to Polylines, Text Along Path and Convert Object to Dimension
- Shear and Fixed Point Resize tools, and Align/Distribute 3D
- File Info and Tools > Check File Health
- A floating view pane, and wide palettes that lay their sections out in columns`,
    "filecheck",
  ),
  release(
    "2026-11-01T12:05:00Z",
    "scripts",
    "Python and Vectorscript",
    `Plug-ins > Run Script runs scripts written for Vectorworks on the open drawing, right in your browser.
- Python, with a vs module of Vectorworks calls for objects, attributes, records, selection, layers, classes and dialogs
- Vectorscript, translated as it runs, with any error shown at the script's own line
- A script's changes are one undo step, and a script that fails or is stopped changes nothing
- File > Export > Export Script writes a drawing out as a Vectorscript, and Import Script runs one`,
    "code",
  ),
  release(
    "2026-11-01T12:04:00Z",
    "render-effects",
    "Render effects",
    `Realistic and Path Traced pictures gain the finishing touches.
- Shiny surfaces reflect the model, not only the sky
- Depth of field
- White balance, highlights and shadows, sharpening, fringing and grain
- Looks presets, clay mode and outlines`,
    "reflection",
  ),
  release(
    "2026-11-01T12:03:00Z",
    "selection-visibility",
    "Selection, visibility and drafting",
    `Commands for finding, showing and hiding what you need.
- Force Select, Activate Layer and Activate Class for objects a click can't select
- Hide Selected Objects, Show Selected Objects Only and Unhide; hidden objects stay out of viewports, exports and printing
- Quick Search (F), Select Coincident Objects, and duplicating a layer or class
- Modify > Join, Even Divide, Hatch and Create Dividing Lines
- Engineering and Volumetric Properties, Change One Field and Change All Fields, and Save as Template
- Align/Distribute, Export Database, Save View, and Window > Home Screen to come back to this page`,
    "marquee",
  ),
  release(
    "2026-11-01T12:02:00Z",
    "docking-view-cube",
    "Docking, the view cube and screen tips",
    `Palettes and views that work the way newer versions of Vectorworks do.
- A docking guide, palettes docked side by side in columns or to each other, and docking bars along the top and bottom
- Palette tabs pull out as palettes of their own, with a choice of icon, text or both on the tabs
- Data Bar options and the SmartCursor datum (G)
- The view cube in a corner of the drawing, with a 2D/3D toggle on its top face
- A Notification Center behind a bell on the status bar, and screen tips over tools and modes`,
    "viewcube",
  ),
  release(
    "2026-11-01T12:01:00Z",
    "views-sections-exchange",
    "Views, sections and file exchange",
    `More ways to look at a model and to trade files with other software.
- Bottom and all eight isometric views, two-point perspective, obliques, Set 3D View and Rotate 3D View
- Model > Cut 2D Section and Cut 3D Section
- Worksheets out to CSV, tab-delimited text, Excel, DIF and SYLK, and back in
- Import and export STL and Shapefiles; Save a Copy As and Save All
- View > Rulers, the Protractor and Visibility tools, Create Similar Object and the Select Similar tool
- Convert to Polylines, Simplify Polys, Rotate Each, Repeat Last Command and Align to Grid`,
    "section",
  ),
  release(
    "2026-11-01T12:00:00Z",
    "doors-windows",
    "Doors, windows and title blocks",
    `Openings go into walls.
- The Door and Window tools set a door or window in a wall, cutting its opening
- Click a door or window in a wall to pick it out, and slide it along the wall
- File > Title Block Manager edits the project and sheet data in your title blocks`,
    "door",
  ),
  release(
    "2026-10-31T12:07:00Z",
    "detailing-site",
    "Detailing, site and space planning tools",
    `New tool sets for details, sites and interiors.
- Detailing: Break Line, Insulation, Repetitive Unit, Steel Section, Lumber, Bolt, Weld, Screw, Nail and Anchor
- Dims/Notes markers: section-elevation, interior elevation, detail callout, drawing label and benchmark
- North Arrow, Scale Bar, Data Tag, Graphic Legend and Stipple
- Site Planning: Plant, Hardscape, Landscape Area, Property Line and Parking Space
- Column and Stair, and the Furniture/Fixtures and Space Planning tool sets
- Tools > Reports > Create Report, Create Color Chart and List Symbols`,
    "site",
  ),
  release(
    "2026-10-31T12:06:00Z",
    "view-panes-tabs",
    "View panes, document tabs and a tidier workspace",
    `See more at once, and keep the workspace out of the way.
- View panes: the plan and the 3D view side by side, stacked, or in three or four panes, each with its own view and render mode
- Document tabs: several drawings open at once
- The palettes in one sidebar, palette sections that fold, and docks that slide out on hover
- The View, Mode and Snapping bars move and roll up, and a Classic workspace keeps the tools in palettes
- A menu bar with every menu in a row
- The Working Planes palette, Quick Preferences and the Snap Loupe (Z)`,
    "panes",
  ),
  release(
    "2026-10-31T12:05:00Z",
    "cloud-renders",
    "Cloud renders",
    `Render Image can run on a cloud GPU instead of your computer, paid from your credit.
- A 4K path-traced picture takes under a minute
- Keep working while it renders, or choose Finish now or Cancel
- File > Export > Cloud Renders lists your jobs and their pictures
- A graphics reset on your own computer no longer saves a blank picture`,
    "cloud",
  ),
  release(
    "2026-10-31T12:04:00Z",
    "big-drawings",
    "Big drawings stay quick",
    `Huge drawings, with hundreds of thousands of objects, are much quicker to work in.
- Zooming a big drawing is fast
- Moving an object no longer freezes the editor, and dragging stays smooth
- An edit only redoes the part of the drawing it changed, so snapping straight after is quick too
- Opening a drawing shows its progress from the click, and you can cancel it`,
    "speed",
  ),
  release(
    "2026-10-31T12:03:00Z",
    "agents",
    "Agents",
    `An Agents panel where you ask for changes to your drawing in plain words.
- An agent reads, looks at and edits the drawing, renders views, runs commands and scripts, and imports and exports files
- It hands parts of a bigger job to helper agents
- The models run on Rodeo's server, so you don't need a key of your own
- Agents need a signed-in account and AI credit, topped up from your account`,
    "agent",
  ),
  release(
    "2026-10-31T12:02:00Z",
    "phone-new-drawing",
    "Rodeo on your phone, and File > New",
    `Rodeo now fits a phone screen, and you can start a drawing from nothing.
- On a phone the tools sit in a scrolling bar along the bottom, and palettes open one at a time from a Palettes button
- Menus step down into their submenus, and dialogs fit the screen with their buttons in reach
- The 3D view orbits, pinches and pans by touch
- File > New and New drawing open a blank drawing, in feet and inches or millimetres to suit where you are`,
    "phone",
  ),
  release(
    "2026-10-31T12:01:00Z",
    "rendering",
    "Realistic and Path Traced rendering",
    `The 3D view can now render.
- Realistic: materials lit by the sun and sky, with soft shadows, ambient occlusion, bloom and fog
- Path Traced: a path-traced picture that refines while the view is still
- The Render palette (View > Render Settings) sets the sky, ground, sun, lights, exposure, camera, materials and quality
- File > Export > Render Image renders the view or your cameras from HD up to 8K, as PNG or JPEG`,
    "sphere",
  ),
  release(
    "2026-10-31T12:00:00Z",
    "walls-slabs",
    "Draw walls, slabs and dimensions",
    `Building objects you can draw and edit, not only open.
- The Wall tool draws walls in the drawing's wall styles, mitred at corners and joined to walls already there
- The Slab tool, the Camera tool, the Heliodon tool and the Plug-in Insertion tool
- Linear dimensions as real dimension objects, edited in Object Info
- Edit a wall's ends, length, heights and style in Object Info, even with doors and windows in it
- Walls joined to a wall you move, turn or mirror follow it; the Wall Join tool makes T, L and X joins, and Split cuts walls
- AEC > Create Objects from Shapes: walls along a shape's sides, slabs over rectangles
- Design-layer viewports drawn in 2D and built in 3D`,
    "walls",
  ),
  release(
    "2026-10-30T12:05:00Z",
    "lights-cameras",
    "Lights, cameras and walls that move",
    `Light the model, look through its cameras, and move its walls.
- The Visualization palette lists the drawing's cameras and lights; look through a camera in the 3D view
- The Light tool, and lights that light the 3D view and cast shadows
- Walls move, turn, mirror and duplicate; slabs and roof faces move, lift, turn and duplicate
- Edit > Preferences in Vectorworks' panes, with Appearance
- A compact interface density and a Dense workspace, and docks that fold to a rail of palette icons
- Smart Options at the cursor, Duplicate Along Path, Format Text, Replace Font, and Previous and Next View`,
    "camera",
  ),
  release(
    "2026-10-30T12:04:00Z",
    "modelling",
    "Modelling in 3D",
    `Build and change 3D objects.
- Model > Extrude, Multiple Extrude and Sweep, and Add and Subtract Solids
- The 3D Modeling tools: Extruded Rectangle, Extruded Polygon, Sphere, Hemisphere and Cone
- Move, rotate, mirror, scale and copy 3D objects, and Modify > Move 3D
- Convert to 3D Polygons and Convert to Mesh, and Model > Create Contours
- Import OBJ, glTF, 3DS and IFC
- Edit symbols in place, and import symbols, textures, text styles and record formats from another file`,
    "solids",
  ),
  release(
    "2026-10-30T12:03:00Z",
    "meet-rodeo",
    "Meet Rodeo",
    `The editor has a name, Rodeo, and a logo to go with it.
- A start screen with Open and New, your recent drawings, your cloud drawings and news
- One Save menu with Save As, Save to Cloud, Export, Share, Publish and Print, and a top bar that always keeps Save and Sign in in view
- Report a bug or suggest a feature from the Help menu or the start screen`,
    "lasso",
  ),
  release(
    "2026-10-30T12:02:00Z",
    "resources-formats",
    "Resources, records and file formats",
    `Manage a drawing's resources and data, and swap files with other software.
- The Resource Manager creates, edits, imports, duplicates and deletes hatches, gradients, line types, text styles and record formats
- Text fonts and styles read, edited, drawn and exported
- Attach data records, edit record formats and worksheets, and check spelling
- Export OBJ, glTF, IFC and 3DS; publish saved views as PDF pages; import PDFs and images
- Stories and their levels, Page Setup, and Document Settings > Units
- Trace Bitmap, Purge, Batch Rename and File > New from Template`,
    "records",
  ),
  release(
    "2026-10-30T12:01:00Z",
    "accounts-cloud-collaboration",
    "Accounts, cloud drawings and live collaboration",
    `Sign in to keep drawings in the cloud and work on them together. Everything else still works without an account.
- Sign in with an email link, or with Google, Microsoft or GitHub
- Cloud drawings with version history, sharing, invites, public links and embeds
- Live collaboration in 2D and 3D, with everyone's cursors and selections, and layers you can check out
- Crit mode: pins, redlines, comment threads and voice notes
- Open and save with Google Drive and OneDrive
- Site Context: buildings, roads, water, trees and terrain contours from OpenStreetMap around your site
- Sun Study with GIF and video export, Timelapse, and USDZ export
- Touch and Apple Pencil on iPad, and an app you can install
- Rodeo Plus, a supporter plan that helps pay for hosting`,
    "cursors",
  ),
  release(
    "2026-10-30T12:00:00Z",
    "snapping-shortcuts",
    "Smarter snapping, and shortcuts you can change",
    `Faster, more precise drawing, set up the way you like.
- Snapping to smart points, extension lines, tangents and perpendiculars, with a snap radius and fixed grid spacing
- Change the key for any tool or menu command in Tool Shortcuts and Menu Shortcuts
- Rectangle, Polygon and Lasso selection, the Reshape tool, and reshaping by numbers in Object Info
- The Organization dialog for classes, layers, viewports and saved views, and Tools > Find and Modify
- Edit the workspace's tool sets and menus, and export and import workspaces
- A calmer look across the whole interface`,
    "snap",
  ),
  release(
    "2026-10-29T12:03:00Z",
    "workspace",
    "A workspace laid out like Vectorworks",
    `The editor's bars, palettes and menus follow Vectorworks, so your habits carry over.
- The View bar with standard views, render modes, saved views, and layer and class options
- The Mode bar with each tool's modes and preferences, and the Snapping palette
- Context menus, palette tabs, the Text menu and named workspaces
- Autosave with recovery, and Edit > Preferences
- The Clip tool, Custom Selection, Find and Replace, Callout and Revision Cloud
- File > Open Recent and Revert`,
    "workspace",
  ),
  release(
    "2026-10-29T12:02:00Z",
    "3d-sheets-viewports",
    "3D view, sheets and viewports",
    `See the model in 3D, and the sheets as they print.
- A 3D view of the model
- Sheet layers with live plan viewports, their annotations, and viewport editing
- Worksheets, data records, and data visualisations in viewports
- Wall component hatches, bitmap fill patterns, line markers and drop shadows drawn as Vectorworks draws them
- Section and detail sheets, and drop shadows in PDF exports`,
    "sheet",
  ),
  release(
    "2026-10-29T12:01:00Z",
    "everyday-commands",
    "The everyday drawing commands",
    `Four rounds of the commands you reach for every day.
- Menus with Vectorworks' shortcuts, move, rotate, mirror and scale, cut, copy and paste, snapping, and PDF export
- Symbols, text formatting, Offset, Fillet and printing
- Trim, Split, Connect/Combine, surfaces, arrays and dimensions
- Ellipses and more drawing tools, DXF import and PNG export`,
    "shapes",
  ),
  release(
    "2026-10-29T12:00:00Z",
    "vwx",
    "Open Vectorworks files in the browser",
    `The first version: open a Vectorworks .vwx drawing in your browser, edit it and save it back, with nothing to install.
- Layers, classes and 2D objects, selected on any visible layer, moved and reshaped by their grips, and edited inside groups
- Drawing tools, attributes and line types, undo and redo, grid and snapping
- Export to DXF and SVG`,
    "browser",
  ),
];
