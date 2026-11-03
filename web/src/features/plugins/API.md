# openvwx plug-in API

A plug-in is a JavaScript file that drives the drawing you have open. Write one in
the editor (**Plug-ins > Plug-in Manager… > New Plug-in**), import a `.js` file, or
start from the three examples that are installed turned off on first run. The same
reference is on the in-app pane: **Help > Plug-in API…**.

## Honesty, not a sandbox

Each plug-in runs in its own Web Worker. The worker has no page, no DOM, no
cookies and no storage of openvwx's to touch, and the network and storage entry
points (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts`,
`indexedDB`, `caches`) are replaced by stubs that throw before your code runs.
Every call into the drawing is checked against the API below. Web requests go
through `openvwx.fetch`, which asks you first.

This is about making plug-ins honest and their reach visible. It is **not a
security sandbox**: a determined script can still do what JavaScript allows inside
its worker, and a plug-in you do not trust should not be installed. Install only
plug-ins you trust.

## The header

The first lines of a plug-in name it. Each field is optional:

```js
// @name Number Selected Objects
// @description Adds text labels 1, 2, 3 ... at the centre of each selected object.
// @version 1.0
// @author Your name
```

`@name` is what the Manager and the Plug-ins menu show.

## Running and menu items

- **Run** (⌘↩) runs the code once: its top level, then each menu item it added with
  `openvwx.menu.add`, in order. The code in the editor runs whether or not it is saved.
- **Save** (⌘S) stores the code. A plug-in that is turned on starts again with it.
- A plug-in that is **turned on** starts when openvwx starts. Its top level runs
  then, so keep side effects inside menu items. Its menu items appear in the
  **Plug-ins** menu; a worker with menu items stays alive for them.
- Top-level code has the drawing only if one is open when it runs. Keep it to
  adding menu items.

```js
openvwx.menu.add("Count by Class", async () => {
  const layer = await openvwx.activeLayer();
  const objects = await openvwx.doc.objects(layer);
  await openvwx.ui.alert("Count", String(objects.length) + " objects");
});
```

Stop ends a run. Work a run leaves going (timers, unawaited promises) stops when
the run ends.

## Calls and data

Every call is asynchronous: `await` it. Arguments and results cross from the
worker as copies, so they must be plain data (numbers, strings, booleans, arrays,
plain objects, typed arrays). Functions cannot cross; a value that cannot be copied
is an error in the plug-in. Results from `openvwx.doc` are plain JSON-shaped
objects with the library's field names (`ObjectInfo`, `LayerInfo`, `ClassInfo`,
`SymbolInfo`, `LineType`, `ColorInfo`).

Object ids are the ids `openvwx.doc` gives you. A group's contents are listed on
their own, with `parentId` set to the group.

### `openvwx.doc` (reads)

| Call | Returns |
|---|---|
| `doc.info()` | document info: file name, versions, units |
| `doc.layers()` | every layer (`id`, `name`, `kind`, `scale`, `visibility`, `objectCount`) |
| `doc.classes()` | every class (`index`, `name`, `visibility`, `objectCount`) |
| `doc.objects(layerId?)` | the layer's objects; the active layer's when left out |
| `doc.object(id)` | one object, or `null` |
| `doc.selection()` | the selected objects |
| `doc.records(id)` | the plug-in parameters and attached records of an object |
| `doc.symbols()` | the symbol definitions |
| `doc.lineTypes()` | the dash styles |
| `doc.colors()` | the colour table (`index`, `css`, `name`) |

```js
const selected = await openvwx.doc.selection();
const colours = await openvwx.doc.colors();
```

### `openvwx.edit` (changes)

`openvwx.edit.<method>(...args)` runs one of these mutations of the drawing, with
the arguments the editor's own session takes. Each call is one undo step.

`addObject`, `deleteObjects`, `moveObjects`, `duplicateObjects`, `setGeometry`,
`setText`, `setTextStyle`, `setObjectClass`, `setObjectName`, `setObjectLayer`,
`setAttributes`, `transformObjects`, `arrangeObjects`, `groupObjects`,
`ungroupObjects`, `createLayer`, `renameLayer`, `setLayerVisibility`, `createClass`,
`renameClass`, `setClassVisibility`, `insertSymbol`, `replaceSymbol`,
`setRecordField`.

Anything else (undo, raw file access, deleting a layer, the other session calls) is
refused. A refused call is an error in the plug-in.

```js
const id = await openvwx.edit.addObject(layerId, { kind: "line", a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } });
await openvwx.edit.setAttributes([id], { fillPattern: 1, fillFore: 3 });
```

Shapes are the editor's `NewShape` values: `line`, `rect`, `roundrect`, `polygon`,
`polyline`, `arc`, `text` (`at`, `text`, `height`, where the height is the text size
in drawing units: 2.5 × the layer's scale is the Text tool's).

### `openvwx.edit.batch`

`openvwx.edit.batch([[method, ...args], ...])` applies several of the mutations above
as **one undo step**. Every step is checked before any runs, and if one fails, none
is applied.

```js
await openvwx.edit.batch([
  ["addObject", layerId, { kind: "text", at: { x: 0, y: 0 }, text: "A", height: 2.5 }],
  ["renameLayer", layerId, "Plan"],
]);
```

### Selection, zoom and layers

| Call | Does |
|---|---|
| `openvwx.select(ids)` | selects the objects on the active layer among `ids` (others are skipped); returns those selected |
| `openvwx.zoomTo(ids)` | fits the window to them; `false` if none has geometry |
| `openvwx.activeLayer()` | the active layer's id |
| `openvwx.setActiveLayer(id)` | makes a layer active |

## User interface (`openvwx.ui`)

| Call | Does |
|---|---|
| `ui.toast(text)` | a short message at the bottom of the window |
| `ui.alert(title, text)` | a dialog with one message; resolves when it is dismissed |
| `ui.prompt(title, fields)` | a dialog with fields; resolves to `{ name: value, … }`, or `null` when cancelled |
| `ui.progress(fraction, label)` | a progress bar, `fraction` from 0 to 1; `ui.progress(null)` hides it |

A field is `{ name, label?, type, options?, value? }` where `type` is `"text"` (the
default), `"number"`, `"select"` (its `options` are strings) or `"checkbox"`.

```js
const answers = await openvwx.ui.prompt("Fill", [
  { name: "tint", label: "Tint", type: "select", options: ["red", "blue"], value: "red" },
  { name: "count", label: "How many", type: "number", value: 3 },
]);
if (answers) openvwx.ui.toast(answers.tint + " x" + answers.count);
```

## Menu items (`openvwx.menu`)

`openvwx.menu.add(label, handler)` adds an item to the Plug-ins menu. The handler is
a function in your code; it runs when the item is chosen. The label is shown as it is written.

## Web requests (`openvwx.fetch`)

`openvwx.fetch(url, init)` sends an http or https request from the page on the
plug-in's behalf, with no cookies. `init` takes `method`, `headers` and `body` (text
or bytes). It resolves to `{ ok, status, statusText, url, headers, text, bytes }`.

The first request to each site asks **Allow {plug-in} to reach {site}?**. Your answer
is kept for that plug-in in its record. The site still sees your browser's address,
as with any web request. Requests to a site that does not allow cross-origin reads
will fail: the page cannot read them, the same as any web page.

## Console

`console.log`, `console.info`, `console.debug`, `console.warn` and `console.error`
go to the console pane of the editor when the code is run from there, or to the
page's console for a plug-in that runs in the background. An error shows its line in
the code, and a click on the line goes there.

## Script Console

**Window > Script Console…** runs a line at a time on the same API, in one worker
kept for the session. A line that is an expression gives its value, printed as
truncated JSON. Anything else runs as the body of an async function, so it needs its
own `return`:

```
› await openvwx.doc.selection()
› (await openvwx.doc.layers()).length
› const n = 3; return n * 2
```

Up and Down walk the history. A name assigned without `let`, `const` or `var` stays
for later lines; anything declared with them is forgotten after its line. **Restart**
stops the worker and forgets everything in it.

## Installing and sharing

Installed plug-ins live in this browser (IndexedDB `openvwx-plugins`, or
localStorage when IndexedDB is blocked, or for the visit alone when both are). Nothing
is uploaded. **Export** saves a plug-in's code as a `.js` file. **Import…** reads a
`.js` file and shows its header and the warning *Plug-ins run code you didn't write.
Only install ones you trust.* before it is installed, turned off.

## Limits

- Code is limited to 1 MB when imported.
- Undo, redo and the file itself are the editor's: a plug-in cannot save the drawing.
- `openvwx.select` only selects objects on the active layer, in the group being edited.
- Drawing-changing calls take effect in the open drawing; a plug-in that is turned on
  but has no drawing open gets errors from those calls.
- Plug-in code is not reviewed by openvwx.

## Checking the host

`check.ts` runs the host's pure parts against a real drawing, under Node:

```bash
cd web && npx tsx src/features/plugins/check.ts ../samples/sample.vwx
```

It covers reads, an edit, a batch that is one undo step, a refused batch, refused
calls, plain data, headers, and the worker's line numbers.
