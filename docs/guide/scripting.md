# Scripts

This page covers running Python scripts and Vectorscripts written for Vectorworks, script palettes, writing a drawing out as a script, and the format library and Node command line behind Rodeo.

## Running scripts

### Python scripts

Python written for Vectorworks runs on the open drawing from **Plug-ins › Run Script…**, and from **Tools › Plug-ins** as in Vectorworks. It runs in a window that:

- keeps the script in this browser
- opens and saves `.py` files
- shows what it prints, with a failing line linked.

The script runs in Pyodide in a Web Worker (fetched from jsDelivr the first time, about 11 MB) with a `vs` module of more than 400 of Vectorworks' calls:

- drawing: Rect, Oval, Arc, Poly, BeginPoly with ArcTo, CurveTo and CurveThrough, Poly3D, BeginPoly3D with Add3DPt, Locus, CreateText, BeginGroup…
- walking the drawing by handle: FSActLayer, NextObj, ForEachObject and Count with search criteria, ForEachObjectInLayer
- reading and setting geometry, class, name, attributes, records and selection
- moving, turning, scaling, mirroring and duplicating
- layers and classes: a class's fill, pen, line weight and opacity (SetClFPat, SetClLW, GetClFillFore…), RenameClass, DelClass, Class and Layer Options, CreateLayer, a layer's scale, elevation and visibility
- the attributes new objects take: FFillPat, FPenSize, FFillFore…
- text: SetTextSize, SetTextFont with GetFontID, SetTextStyle, SetTextJust, SetTextOrientation, TextFont and TextFace for new texts… A text is styled as a whole, so a call's run of characters styles all of it.
- math, strings, vectors and 2D geometry: Sqrt, Num2StrF, SubString, Ang2Vec, Vec2Ang, CrossProduct, LineLineIntersection, CircleCircleInters, PtInPoly, Centroid…
- the dialogs: StrDialog and the others wait for the answer where the browser can pause WebAssembly, as Chrome can.

The script works on a copy of the drawing taken as it starts, so it sees its own changes. They are applied when it ends, as one undo step, and a script that fails or is stopped changes nothing.

Lengths are in the drawing's units (inches for feet and inches), and colours are the drawing's nearest palette colour. What a script draws takes the Attributes palette's settings for new objects, and the ones the script sets, as in Vectorworks.

**Limits:**

- Calls Rodeo lacks say so by name.
- Attributes on a new object that neither the script nor the Attributes palette set read as 0 until it ends.
- A layer's thickness isn't kept: it reads 0.

### Vectorscript

**Vectorscript** runs in the same window: a `.vs` or `.px` file, or a script that starts with PROCEDURE or FUNCTION. It is translated to Python in the worker (`web/src/features/python/vscriptModule.ts`) and run on the same calls by their Vectorscript names.

- Nested procedures and functions keep their variables in frame objects, so a nested routine reaches its parent's, and a VAR argument is a reference to a variable, array element or record field.
- Arrays keep their own bounds, and records and arrays copy on assignment.
- Lengths written with `'` and `"` become the drawing's units.
- The vs procedures that hand values back through VAR parameters (GetBBox, GetUnits…) fill the variables from what the Python call returns.
- Search criteria written out (`((T=RECT) & (SEL=TRUE))`) are passed as text.
- A POINT argument can be a VECTOR variable or x and y, and a point or vector a call returns fills a VECTOR's x, y and z.
- Errors are given at the Vectorscript's own lines.

**Limits:** `{$INCLUDE}`, WITH and GOTO are refused.

### Script palettes

**Window › Script Palettes** holds named palettes of Python scripts and Vectorscripts, shown a section each in the Script Palettes palette.

- Double-click a script to run it on the open drawing (one undo step; an error opens an alert with its line).
- Right-click a palette to add a script in the Script Editor or import one from a file, or to rename or delete it.
- Right-click a script to edit, rename, duplicate, export or delete it.

Vectorworks keeps script palettes in the drawing; Rodeo keeps them in this browser, the same for every drawing.

### Custom Tool/Attribute

**Tools › Custom Tool/Attribute…** saves a way of drawing as a script. Select one object to record its attributes, or nothing to record what new objects are drawn with, and pick the tool to draw with first.

The **Custom Tools** dialog ticks what's recorded, in four groups, each with **All**:

- **Fill Attributes:** style, foreground and background colour, and opacity.
- **Pen Attributes:** style, foreground and background colour, and line weight.
- **Text Attributes:** size and alignment (from a text object, or the Text tool's).
- **Other Attributes:** class, layer and the active tool.

Choose **Create VectorScript** or **Create Python Script**, then name it. It goes in a script palette. Double-click it there to set all of that again, ready to draw.

Any script that sets attributes, text size, the class, the layer or the tool (with `SetTool`) leaves them set after it runs, as in Vectorworks. `PushAttrs` and `PopAttrs` put attributes back.

## Drawings as scripts

### Export Script and Import Script

**Export Script** (**File › Export**) writes the drawing as a Vectorscript that draws its design layers' 2D objects again, in their classes and stacking order with their names, attributes and turns (`web/src/features/python/exportScript.ts`).

- The script's header counts what it leaves out (symbols, plug-in objects, 3D, images, sheet layers) and what it writes plainer (hatches and dashes as solid).
- It refuses to run in a drawing of other units, since its coordinates are in the drawing's own.

**Import Script** (**File › Import**) runs a script file in the Run Script window.

### Export Simple VectorScript (3D only)

**Export Simple VectorScript (3D only)** (**File › Export**) writes the 3D objects on the visible design layers as a plain script of 3D polygons, one per flat face and grouped by object, in Front view or the current view, for other programs to read. It runs back in Rodeo too.

## The format library and command line

The format library in `web/src/core` has no DOM dependencies:

```ts
import { openVwx } from "./src/core/index.ts";

const session = openVwx(bytes, "drawing.vwx");
const layer = session.doc.layers()[0];
session.addObject(layer.id, { kind: "line", a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } });
session.renameLayer(layer.id, "Plan");
session.undo();
const out = session.doc.toBytes();
```

There is also a Node command line for the same library:

```bash
npm run vwx -- info drawing.vwx
npm run vwx -- layers drawing.vwx
npm run vwx -- svg drawing.vwx out.svg
npm run vwx -- dxf drawing.vwx out.dxf
npm run vwx -- pdf drawing.vwx out.pdf [--layer NAME ...]
npm run vwx -- roundtrip drawing.vwx
```
