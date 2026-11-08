# 3D view, lights and rendering

This page covers the 3D view: opening it, moving around, standard views and projections, render modes, lights, cameras and the sun, rendering pictures, panoramas and animations, and working planes.

## Opening the 3D view

Open the 3D view with **View › 3D View**, the 3D button or key <kbd>3</kbd>. **View › Standard Views**, **View › Rendering** and **View › Projection**, or the top bar's **Standard views**, **Render mode** and **More view options** pop-ups, pick the direction, the render mode and the projection. Top/Plan goes back to the plan. In a split, these and the 3 key make the plan or 3D pane of that kind the active one instead (see [View panes](workspace.md#view-panes)).

### What the 3D view shows

The 3D view shows the visible design layers as a shaded model at their elevations:

- walls, slabs, roofs, extrudes and other solids, rebuilt from their cached edges
- extrudes saved without cached edges (most plug-in objects' parts), swept from their profile, holes included
- multiple extrudes saved without them, lofted through their profiles
- solids Rodeo makes, drawn from their operands (a subtraction cut)
- symbols
- plug-in objects' parts, placed where the plug-in is (doors and windows in their walls)
- 3D polygons, meshes and the site model's terrain

It shows RenderWorks textures. Image textures are mapped at their real size, and others are shown in their preview's colour; "by class" textures come from the class. Untextured faces take their fill colour as the plan paints it.

Large models (3–4 million triangles) build in a few seconds.

### The layer's saved view

The active design layer's saved view opens with the drawing: a layer saved in a perspective, an isometric or an elevation shows it, with its render mode, the first time the 3D view is shown. Saving stores the 3D view's camera, projection and render mode on the active layer (or Top/Plan, when the plan is showing).

## Moving around

### Orbit, pan and zoom

Orbit, pan and zoom to the cursor; click a face to select its object. The selection shows highlighted in the 3D view, objects in groups as they are in plan (see [Render modes](#render-modes)). Double-click a point to orbit about it.

### Walking with the keys

With the view focused, <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or the arrows walk through the model, and <kbd>Q</kbd> and <kbd>E</kbd> go down and up. <kbd>Shift</kbd> goes faster.

### Flyover, Translate View and Walkthrough

The **Flyover**, **Translate View** and **Walkthrough** tools (Visualization tool set, and beside Pan and Zoom) set what a drag does in the 3D view, showing it when picked in Top/Plan:

- **Flyover** turns the view about its centre, a clicked origin or the selection's middle, at the sensitivity its Preferences set.
- **Translate View** slides the view or moves it in and out.
- **Walkthrough** stands the viewer at the Viewer Height in perspective, then walks, looks around or rides up and down.

### Onscreen View Control

The Onscreen View Control (**View › Onscreen View Control**) is a cube in a corner of the drawing that turns as the view does:

- Click a face, edge or corner for that view (the one shown already goes to the opposite one).
- Drag it to turn the 3D view, or scroll over it to zoom.
- The 2D/3D toggle on its Top face goes to Top/Plan or back to the 3D view.
- Its menu button (or the View menu) shows or hides it, its axes and its cube, and moves it to any corner.

With several view panes it sits in the active pane's corner.

### Rotate 3D View and Set 3D View

**View › Rotate 3D View…** turns the view by typed angles about the screen's horizontal, its upright and the drawing's z axis.

**View › Set 3D View…** looks from a typed viewer position to a typed look-to point (x, y and a height above the active layer's elevation), opening the 3D view from the plan. Its fields start at the camera, or, from the plan, at eye height at the window's foot looking to its middle.

## Views and projections

### Standard views

The standard views are:

- Top, Bottom, Front, Back, Left and Right
- the eight isometrics: Right, Left, Right Rear and Left Rear, from above or, as the Lower ones, from below

### Projections

**View › Projection**, or **More view options › Projection** in the top bar, picks Orthogonal or a perspective:

- **Narrow**, **Normal** and **Wide Perspective** see 20°, 35° and 60° from the picture's top to its bottom.
- **Set Custom Perspective…** takes any angle from 5° to 120°.
- **Two-Point Perspective** keeps the eye level, so uprights stay upright as the view turns.
- The **Oblique** projections (**Cavalier** and **Cabinet**, at 45° or 30°) keep the front true and draw depth slantwise, full length or half.
- **2D Plan** goes back to the plan.

In a perspective, the camera stands nearer or further back so the model keeps its size. A 3D projection picked from the plan opens the 3D view in it.

### Rotate Plan

**View › Rotate Plan** turns the plan on screen and leaves the drawing where it is. Click the centre, then click along the line that will lie level (<kbd>Shift</kbd> for 15° steps), or choose **More view options › Set Plan Rotation…** and type an angle. While the plan is rotated, the top bar shows its angle in a box beside **More view options**, and typing a new angle there turns the plan. **Rotated Top/Plan** (<kbd>⌘5</kbd>) and **Standard Views** swap between it and the true Top/Plan.

While the plan is rotated:

- The grid, rulers, snap to grid, Shift angles, marquee, selection handles and arrow keys go with the view.
- Rectangle, Rounded Rectangle, Oval, Text, Symbol and the part-placing tools lay theirs square to the screen; the rest lie square to the drawing.
- Saved views, the data bar and Object Info, exports and prints keep to the drawing's own axes, and sheet layers and symbol editing show unrotated.

**Limits:** the rotation lasts for the session and isn't saved in the file.

## Display

### Render modes

**View › Rendering**, or the top bar's **Render mode** pop-up (greyed out while no 3D view is on screen), picks how the model is drawn:

- **Wireframe**
- **Hidden Line**
- **Dashed Hidden Line**
- **Sketch**: hidden line drawn as two pencil strokes per edge on paper
- **Shaded**
- **Textured**
- **Realistic**, **Path Traced** or **AI Render** (see Rendering, below)

A selected object is drawn highlighted over the model in every mode, in the selection colour that **Preferences › Appearance** sets: its edges, faint where other faces hide them, and its visible faces tinted, except in Wireframe. In Realistic, Path Traced and AI Render only its edges show, all of them.

### Shaded Options

**View › Rendering › Shaded Options…** (also at the foot of the top bar's Render mode pop-up) sets:

- whether Shaded draws textures (on at first; off, a textured face shows its fill colour) and colours (off: white faces)
- whether it draws the edges
- whether it casts shadows (the Visualization palette's switch), on the objects or on the ground under the model only
- how sharp the shadows are (Low to Very High shadow maps)

The options are kept in this browser for every drawing. **Textured** is Shaded with textures always on.

### Line Render Options

**Line Render Options…** gives Dashed Hidden Line one of the document's dash styles, at the active layer's scale, and sets the hidden edges' shade, from the edges' grey to white.

## Lights, cameras and the sun

### Visualization palette

The Visualization palette (**Window › Palettes**), in Lights and Cameras tabs, sets:

- the projection
- the sun: a headlight with the view, or a Heliodon sun for a latitude, date, solar time and north, with shadows
- the ambient light
- a clip cube (also **View › Clip Cube**) that cuts the model to X, Y and Z ranges

These belong to the window, not the file.

### Cameras

The Visualization palette's Cameras list holds the drawing's Renderworks cameras, on design layers or belonging to sheet viewports. Clicking one opens the 3D view through it, from its eye to its look-to point with its view angle (or orthogonal, as the camera is set). Orbiting then turns about the look-to point; a standard view or fit goes back to the usual lens.

With the 3D view open, a camera's **Match View** button points it the way the view looks, from the view's eye toward the point it orbits (its lens stays), as one undo step. Moves carry a camera's eye and look-to point with it.

### Camera tool

With the **Camera** tool (Visualization tool set), press where a Renderworks camera stands and drag to the point it looks at, or click to look north 5 m. The camera goes on the active layer at its Preferences' eye height above the layer (1600 mm), looking level, named "Camera n" and selected, in one undo step. It copies its lens, projection and plan drawing from a camera the drawing has.

**Limits:** a drawing without a camera can't take one yet.

### Light objects

The Visualization palette's Lights list holds the drawing's light objects (point, spot and directional, in light-fixture symbols too; a Heliodon's sun is left to the Lighting settings) with their colour and brightness. Clicking one selects what holds it. A light the drawing places itself turns on and off from its row.

The lights light the 3D view, spots in their cones, the 16 nearest where the view looks (chosen again as it settles), unless "Light the model with them" is off.

While the sun casts shadows, so do the 2 spots, the point light and the directional light nearest where the view looks. Their shadows are drawn again only when the model, the layers shown, the render mode or the clip cube change.

Selected, a light shows a Light section in Object Info, where each change is one undo step:

- whether it is on
- kind (directional, point or spot)
- brightness and colour
- where it is: X, Y and Z, on its layer, Z above it, or in its symbol
- where it shines: a spot's pan, clockwise from north, and tilt below level; a directional light's azimuth and elevation, where it comes from, as the sun's
- a spot's spread and beam

A spot's or directional light's **Set Light to View** aims it the way the view looks, and **Set View to Light** turns the 3D view to look the way it shines. Both are on its right-click menu too, with **Turn On** or **Turn Off**.

Moves (Move, nudges, Move 3D) and Duplicate take light objects too. A light-fixture symbol's lights change in Edit Symbol, for every instance, and a plug-in's are redrawn from its parameters, so they don't change on their own.

### Light tool

The **Light** tool (Visualization tool set) places a point light, a spot or a directional light (keys <kbd>1</kbd> to <kbd>3</kbd>) at its Preferences' elevation above the layer, a spot or directional one shining straight down. Dragging from where it goes aims it: a spot at the point the drag ends on the layer's floor, and a directional light that way, 45° down. A new light copies its colour, brightness and cone from one the drawing has.

Plan draws the drawing's own light objects as amber marks a fixed size on screen: rays round a point light, a spot's beam and a directional light's arrow the way they shine (a dot when straight down), faint when off. A click selects one and a drag moves it; a light-fixture symbol's lights show in Edit Symbol.

**Limits:** a drawing without a light can't take one yet.

### Heliodon tool

Click with the **Heliodon** tool (Visualization tool set) to place a Heliodon, the sun for a place, a date and a time. It is copied from one the drawing has and is left selected, in one undo step. Preferences set the latitude (south negative), month, day and solar time a new one has.

Selected, a Heliodon shows a Sun section in Object Info:

- its latitude, date and solar time
- its longitude and daylight saving, which set it
- its time zone
- the sun's altitude and azimuth, and the sunrise and sunset by its clock

A change, there or to those parameters in its record, writes the figures it shows again as Vectorworks does, prints its label's time and date again and turns its lights to shine from the sun (level when it is below the horizon). The rest of its plan drawing stays as it was. "Light the 3D view" puts the 3D view's sun where the Heliodon's is.

**Limits:** a drawing without a Heliodon can't take one yet.

### Set Sun Position

**View › Set Sun Position…** adds sunlight as a directional light. Give:

- the site's latitude and longitude
- its time zone
- page north (counter-clockwise)
- the date, the clock time and daylight saving

As you type, it shows the sun's azimuth from south and from north, its elevation and the true solar time. OK aims the selected directional lights at the sun, or adds one at the view's centre (copying a light the drawing has). A sun below the horizon is refused.

**View › Sun Study**, beside it, shows a bar over the 3D view that sets the date, the solar time between sunrise and sunset, the seasons, Play Day and Play Year, north and the place. **File › Export › Export Sun Study…** records the study's day as a movie (.mp4, or .webm where the browser can't make one) or an animated .gif, with the date and solar time on each frame.

### Set Lighting Options

**View › Set Lighting Options…** sets, in Vectorworks' groups:

- the path tracer's indirect lighting: None, 2, 3, 4 or 16 bounces after the first hit
- the Shaded view's ambient light: on or off, and its brightness, with 35 % as the usual
- the Realistic engine's ambient occlusion: on or off, and its strength
- every light object's emitter brightness

They are the same settings the Visualization and Render palettes show, kept on this machine.

## Rendering

### Realistic

The 3D view's **Realistic** mode draws the model each frame in physically based materials, lit by the Heliodon's sun (with soft shadows) and the sky, with ambient occlusion, bloom, fog and a filmic finish.

### Path Traced

**Path Traced** traces the light in the 3D view itself: light bouncing between surfaces, through glass, off mirrors and from the light objects. The path tracer builds its scene off the page's thread.

- While the view moves it keeps tracing, at a lower resolution, and steadies the picture by reusing what the frames before saw of each surface, so you orbit and walk inside the path-traced picture.
- Once the view rests it refines the full picture up to the preview's samples, denoised as it goes.

Where the browser has WebGPU (recent Chrome, Edge and Safari), the path tracer runs on it and denoises with Open Image Denoise, a neural denoiser that keeps edges and textures sharp; elsewhere it runs on WebGL. The Render palette's Quality section chooses (**Path tracer**: Auto, WebGPU or WebGL), and **While moving › Realistic** shows the Realistic picture while the view moves instead, for slow graphics cards.

**Limits:** the WebGL path tracer leaves out clear coats (the glossy top layer of tile, wood and glossy paint), which Realistic and the WebGPU path tracer show.

### AI Render

**AI Render** (**View › Rendering**, or **AI** in the Render palette) has an image model on Rodeo's server paint the 3D view as a finished render. While the view moves you see the Realistic picture; once it rests for a moment, that picture is sent to be painted and the painting fades in over it, usually within several seconds. Move again and the Realistic picture is back at once; come back to a view already painted and its painting shows again without painting it anew.

The Render palette's **AI** section sets:

- **Style**: photoreal daylight, golden hour, overcast, dusk with the lights on, night, after the rain, winter snow, a warm interior, a competition render, watercolour, a hand sketch or a white card model, or **My own words only**
- **Describe it**: your own words, added to the style's ("oak cladding, a birch grove behind")
- **Strength**: **Subtle** makes the model's own materials and light real; **Balanced** also adds a ground, sky and planting where the model shows none; **Creative** reads the style freely. The building, its openings and the camera always stay.
- **Paint each time the view rests**: off, the view is painted only with **Paint now**

**Paint now** paints the view as it is. **Open picture** opens the latest painting in the render viewer, to compare it with the Realistic picture it came from, save it or restyle it.

Each picture is paid for from your AI credit where Rodeo sells it; the AI section says what a picture costs, and the line under the modes counts the pictures and what they took this session. You need to be signed in.

**Limits:** the image model paints at about 1K, at the nearest of its shapes (16:9, 4:3, 1:1 and so on): the rest of the view stays Realistic. It may change small details, such as window bars or a railing's spacing, and can't be told to keep one exactly. Painting each rest stops after 30 pictures in a session until you press Paint now. View panes show the Realistic picture.

### Render palette

The Render palette (**View › Render Settings**, after Renderworks Style) has the 3D view's Realistic, Path Traced and AI modes at its top, with a line on what the one shown does, and sets:

- the sky (physical for the sun, a gradient, a solid colour or a studio), its haze and intensity
- a ground plane under a model that stands on level ground (a sloping site model is its own ground)
- the sun's date, time, intensity and softness
- the light objects' intensity
- exposure and tone (AgX, ACES Filmic or Neutral)
- fog: how far it hides, how it thins going up, its glow toward the sun
- two-point perspective and depth of field
- each material's finish: Auto guesses one from its texture's name and colour (wood, glass, metal, foliage and so on), each with its roughness, metalness, transmission, glow and tint to change
- the effects: ambient occlusion, bloom, vignette, contrast, saturation
- each material's library material (see Material library, below), with its scale and bump
- the quality: preview samples, bounces, denoise, the path tracer (WebGPU or WebGL) and what shows while the view moves
- in AI Render, the style, your words and the strength (see AI Render, above)

Its Cameras list looks through the drawing's cameras. The settings belong to the drawing on this machine, not the file.

### Material library

Rodeo comes with 34 scanned materials, free to use (CC0, from Poly Haven and ambientCG), each with its colour, bump (normal), roughness and, for metal, metalness maps at its real size:

- Wood: light oak floor, dark deck boards, herringbone parquet, weathered and grey board cladding, oak veneer
- Brick: red, pale, yellow stock and dark engineering brick
- Stone: rough stone wall, sandstone blocks, flagstone
- Concrete: polished, fair-faced and precast panels
- Plaster: smooth white plaster, rough render
- Tile: white wall tile, chequered and limestone floor tile
- Metal: corrugated iron, painted metal plate
- Paving: concrete pavers, cobblestones, asphalt
- Ground: lawn, leafy grass, gravel, sand
- Roofing: clay roof tiles, roof slates
- Fabric: cotton, tan leather

In the Render palette's Materials list, open a material and use **Library › Choose…** to pick one (search or browse by category). **Scale** makes it bigger or smaller than its real size and **Bump** sets how deep its relief looks; **Remove** goes back to the drawing's own texture. **Match library materials** gives every material Rodeo guessed as wood, brick, stone, concrete, plaster, tile, metal or fabric the closest library material in one go.

Library materials show in Realistic, Path Traced, Render Image and the cloud renders. They're laid on each face at their real size; a face with a texture keeps that texture's placement.

**Limits:** library materials belong to the Render palette's settings on this machine, like the other finishes: the drawing and the file keep their own textures, and Vectorworks doesn't see them. Each map is 1K, so a library material seen from very close looks soft.

### Renderworks styles

**View › Renderworks Style** (and the top bar's Render mode pop-up) applies one of Vectorworks' default styles by name:

- Preview
- Realistic Fast or Final
- Exterior, Interior or Exterior Night
- Render Style White Model

Each sets the render mode (Realistic, or Path Traced for Final) and the Render palette's sky, sun, light objects, exposure, effects, bounces and clay look at once. It stays checked until one of those changes.

**Limits:** Vectorworks doesn't publish its library styles' settings, so these are Rodeo's readings of their names; the file's own styles aren't read.

## Render Image and other exports

### Render Image

**File › Export › Render Image…** renders the current view, one camera or all of them:

- at HD, QHD, 4K UHD, 4K DCI, square, A4 at 300 dpi, the camera's shape or any size up to 8192 px a side
- with the Realistic engine (a 4K picture in a second) or path traced (64 to 4096 samples, with a time limit and denoise)
- or with an engine that starts from one of those: **AI** (below), or a plug-in's
- as PNG or JPEG

It shows its progress, with **Finish now** and **Cancel**, then shows the pictures to save or copy.

### AI pictures

Choose **AI — painted by an image model** as the Engine to have Rodeo's image model paint the picture as a finished render. **Start from** chooses the picture it paints: Realistic (quick) or path traced (truer light to start from). Then choose the **Style**, **Describe it** in your own words, the **Strength** (as in AI Render, above) and up to 4 **Variations** of each picture. The line under them says what the pictures will cost from your AI credit.

The picture it starts from is drawn at no more than 1536 px a side, and the image model paints at about 1K, whatever the size chosen.

### The render viewer

The finished pictures open over the editor: click one to see it at 100 %, use the strip or the arrow keys for the others, **Copy** or **Save** it.

- **Compare** shows a picture an engine made beside the one it started from: the picture it started from on the left of a line that follows the pointer.
- **Restyle with AI…** paints the picture shown again in another style, strength or words (an AI picture is painted again from the picture it came from). The new pictures join the strip.

### Render engines from plug-ins

A plug-in can add an engine to Render Image with `openvwx.render.engine` (**Help › Plug-in API…**): a bridge to another renderer, a render farm or a service. Its engine is listed after Rodeo's while the plug-in is turned on, with the fields it asks for. It gets either the built-in engine's picture or the visible model as glTF with the camera and the sun, and gives back its pictures.

Rodeo's repository has one for Blender in `integrations/blender`: a bridge that Blender runs on your computer, and the plug-in that sends it the model and camera and brings back Cycles' or EEVEE's picture.

**Limits:** a plug-in engine that takes the model gets its meshes, colours and opacity, not its textures, the Render palette's materials or its light objects. Enscape and D5 Render can't be bridged this way unless they let another program start a render.

### Batch rendering

**View › Rendering › Create Batch Render Job…** keeps Render Image's choices under a name, with the 3D view's view as it is then. **Start Batch Render…** renders the jobs chosen, in the order chosen, and downloads their pictures as one zip of a folder named for the date and time. <kbd>Esc</kbd> drops the job in hand and goes on.

**Duplicate**, **Edit** and **Delete** manage the jobs, which are kept for the file on this machine, not in it.

**Limits:** batch jobs and Export HDRI use the Realistic and path-traced engines, not AI or a plug-in's.

### Export HDRI

**File › Export › Export HDRI…** asks the same as Render Image (no format or cloud) and saves each picture as a Radiance .hdr file, linear and unclipped: fog, exposure and white balance applied, tone mapping and grading left to the imaging program. Several cameras' pictures come in one zip, and pictures go up to 16.8 megapixels.

### Export Panorama

**File › Export › Export Panorama…** makes a 360° picture from the 3D view's eye (Shaded, Realistic or Path Traced, up to 8192 × 4096). It is greyed out while no 3D view is on screen. It saves it as a .jpg, or as one .html page with the picture inside it, to look around in by dragging, the wheel or a pinch.

### Render Bitmap

The **Render Bitmap** tool (Visualization, after Heliodon) turns part of the view into a picture on the drawing.

1. Choose the tool. Its **Preferences** open the Render Bitmap Options:
   - **Mode**, any of the 3D view's render modes;
   - **Resolution (DPI)**, dots per inch on paper at the active layer's scale;
   - **Enable Alpha Transparency**, to leave the background clear.
2. Drag round the area to render, in Top/Plan or over the 3D view. A click without dragging takes the whole window.
3. The bitmap is placed on the active layer and selected. From the 3D view it goes where the same part of the screen is in Top/Plan, which is then shown.

Path Traced shows its progress; **Finish now** keeps the picture so far.

**Limits:**

- In Top/Plan the plan is drawn as it shows, whatever the mode.
- A bitmap is at most 8000 pixels a side; the resolution is lowered to fit.
- The drawing must already hold an image, as for Import Image.

### Create Animation

**Model › Create Animation** makes an animation path: a camera's route through the model, to play in the 3D view and make a movie of.

- **Create Orbit Path…** goes round a centre: the active layer plane, the working plane or the selection. Tick **Orthogonal Projection** for a view without perspective.
- **Create Spin Path** goes round the selection, over it and under it, so every side shows.
- **Create Walkthrough Path from Selection** follows the selected line, arc, polyline or polygon, which becomes the path. The camera stands at **Camera Height** above the layer and looks ahead.
- **Create Walkthrough Path from Saved Views…** goes from one saved view to the next. Add the views to **Walkthrough Path to Create** and put them in order with **Move Up** and **Move Down**. Only views saved in the 3D view, in perspective, are listed.

In plan the path shows a dot at each keyframe and the camera's wedge where **Time** puts it. In Object Info:

- **Play** and **Pause** run the camera along the path in the 3D view. **Time** moves it by hand, and **Skip Backward** and **Skip Forward** go to the ends.
- **Activate Camera View** looks through the camera. Moving the 3D view yourself stops it.
- **Previous Keyframe** and **Next Keyframe** pick a keyframe. Its **Speed** makes the camera faster or slower near it, and its **View Angle** widens or narrows the view.
- **Add Keyframe** adds one where the camera is, and **Delete Keyframe** removes the one picked.
- **Display Frames** marks each frame of the movie along the path.

The Reshape tool moves the path's points.

**Create Movie…**, in Object Info or on the path's right-click menu, records the movie. Set its duration, 24 to 60 fps, the render mode and quality, the whole of it or part, and a frame size up to 4K or your own. It's saved as an .mp4 (or a .webm where the browser can't make one).

**Limits:** Vectorworks sees the path as a plug-in object it doesn't have. The camera rides flat at its height rather than following floors and stairs, and walkthroughs come from 2D paths only. There's no 360° video, and no Realistic or Path Traced movies.

## Working planes

### Working Planes palette

The Working Planes palette (**Window › Palettes**, or the top bar's **More view options › Active Plane**) sets a working plane on a face: **Set on Face**, then click one in the 3D view. The plane lies on it, its x along the world's as near as the face allows, and the 3D view draws its grid there with red and green x and y axes.

- **Save** keeps it, by name, with the drawing's file name in this browser (double-click a row to rename it, × deletes it).
- Clicking a row makes it active.
- **Layer Plane** goes back to none.
- **Look At** turns the 3D view square onto it.

The palette shows the active plane's origin and whether it is level, upright (with its bearing) or tilted.

### Working Plane commands

**Modify › Working Plane** has Vectorworks' commands:

- **Set Working Plane**
- **Look at Working Plane**
- **Save Working Plane…**
- **Previous** and **Next Working Plane** (the last ten made active)
- **Align Working Plane with Current View** (its z toward the viewer), with **Layer Plane**, and its **X Axis with Layer Plane**
- **Rotate About X', Y' or Z' Left or Right 90°** and **Flip X', Y' or Z'** (Left is counter-clockwise looking from the axis's positive end), the origin kept

A plane changed so is unsaved until saved.

**Limits:** the 2D tools still draw on the layer plane, and the planes a drawing saves aren't read yet.
