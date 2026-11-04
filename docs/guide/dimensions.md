# Dimensions and measuring

This page covers the dimension tools and their right-click commands, GD&T and welding symbols, and the tools for measuring a drawing: the tape measure, dimension tape and protractor.

## Dimensions

### Dimension tool

The **Dimension** tool (<kbd>D</kbd>) draws:

- **Linear** dimensions: horizontal, vertical or (with Shift) aligned.
- **Chains** (key <kbd>2</kbd>): each further click dimensions on from the last point along the same line.
- **Baselines** (key <kbd>3</kbd>): every dimension from the first point, the lines stacked outwards.
- **Ordinates** (key <kbd>4</kbd>): click the datum, place the line, then click each point for its distance from the datum.
- **Radial, diameter and angular** dimensions (keys <kbd>5</kbd>, <kbd>6</kbd>, <kbd>7</kbd>).

Chains and baselines are finished with <kbd>Enter</kbd> or a double-click. Dimensions have architectural ticks, are sized for the layer scale and are put in the "Dimension" class.

### Dimension objects

Linear, chain and baseline dimensions are Vectorworks dimension objects when the drawing has a plain linear one to copy. Each is a copy of the one in the text size most share, its extension lines, dimension line and value redrawn for the new points with its spacing, text and markers (a chain or baseline is a group of them).

Otherwise, and for the other kinds, they are a group of lines and text, the way an exploded Vectorworks dimension looks.

### Editing a dimension in Object Info

Selected, a linear dimension object (one drawn plainly, as most are) shows a Dimension section in Object Info:

- the length it measures
- its angle
- its start and end points
- its offset
- its value

A change redraws its lines and value in its own standard, in one undo step. Moving a point or turning it leaves the dimension line where it was (or as far from the start point, when it turns), and its value measures again unless it said something else.

**Limits:** dimension objects are untested in Vectorworks.

### Associative dimensions

A linear dimension drawn from a corner of one object to a corner of the same or another object follows them. Move or reshape the objects and the dimension moves with them, stays as far from them, and measures again. If the value says something of its own, that stays. When objects overlap, the top one is used.

The link breaks when you move the dimension by itself, or delete an object it measures. Right-click the dimension and choose **Disassociate** to break it yourself.

**Limits:** it works one way: moving the dimension doesn't move the objects, as it does in Vectorworks. Only single linear dimensions follow, not chains, baselines, ordinates or radial, diameter and angular ones. Walls and dimensions across layers don't, and there's no setting to turn it off. Vectorworks sees them as plain dimensions.

### Chain dimensions on the right-click menu

Right-click a chain's witness line for:

- **Split Dimension**: two chains meeting there, the second selected.
- **Delete Witness Line**: the dimensions either side become one, its value measured again. At an end, the end dimension goes.

Right-click a dimension in it (its line, markers or value) for:

- **Split Dimension**: that dimension goes, and the chains either side stay.
- **Delete Dimension**: that dimension goes, and the ones after it move back to close the gap. Each keeps its length and value.
- **Edit Dimension**: the chain opened with that dimension selected, for Object Info.

**Add Dimension(s)**, on a chain or a linear dimension on its own, takes clicks where new witness lines end:

- One between two splits that dimension there.
- One past an end adds a dimension to it (a lone dimension becomes a chain).

Double-click or <kbd>Enter</kbd> ends; <kbd>Backspace</kbd> takes back the last.

A chain left with one dimension is that dimension on its own. Each command is one undo step (each click, for Add Dimension(s)).

**Limits:** after Delete Dimension, the dimensions that moved back no longer line up with what they measured. Vectorworks only says the rest adjust, so this is Rodeo's reading.

### Arc Length Dimension

To use the **Arc Length Dimension** tool (Dims/Notes):

1. Click a circle or arc where the stretch starts.
2. Click where it ends.
3. Move out (or in) and click to place a dimension arc about the same centre with the stretch's length.

On a circle the stretch is the side the pointer is on. Its modes:

- Key <kbd>1</kbd>: witness lines run square to the stretch's chord (along radii past a half turn).
- Key <kbd>2</kbd>: witness lines run along its radii.
- Key <kbd>3</kbd>: a small arc over the value shows it measures along an arc.
- Key <kbd>4</kbd>: no arc over the value.

The result is grouped lines, arcs and text in the "Dimension" class, as the Dimension tool's angular dimensions are.

### Slope Dimension

With the **Slope Dimension** tool (Dims/Notes), drag along a slope, or click its two ends. Its modes:

- **Rise over Run** (key <kbd>1</kbd>): sets a right triangle on the line, its level side labelled with the base (12 by default) and its upright side with the rise.
- **Ratio** (key <kbd>2</kbd>): sets base:run over the line (1:2).
- **Percent** (key <kbd>3</kbd>): sets the slope as a percent.
- **Degrees** (key <kbd>4</kbd>): sets the slope in degrees.

Preferences hold the two bases, Rise over Run's Scale Factor and Draw Roof Surface, which adds the line itself, dashed in the drawing's first dashed line type.

## GD&T and welding symbols

### Feature Control Frame

With the **Feature Control Frame** tool (Dims/Notes), a click places a GD&T frame, its left end there, or a press dragged turns it. Preferences hold:

- its geometric characteristic (fourteen, drawn as lines and circles rather than font glyphs)
- Composite Box
- the tolerance with a diameter symbol
- a material condition (M, L or S)
- Statistical Tolerance
- a Projected Tolerance Zone with its height (in the frame or under it)
- up to three datum references with their own material conditions

### Geom Dim and Tol Note

With the **Geom Dim and Tol Note** tool (Dims/Notes), a click places a hole or taper note, or press where its arrow points and drag to its shoulder for a leader. It notes:

- round, square, counterbore and countersink holes with their size and depth (or angle)
- conical and flat tapers as a ratio
- a depth alone

The symbols are drawn as lines. Each value has no tolerance, ±, + over −, or its limits stacked or in a line, to a set precision. In a feet-and-inches drawing the values are in decimal inches.

### Welding symbols

The **Welding Sym-Fillet, -Flange, -Groove, -Misc and -Slot-Plug** tools (Dims/Notes) each come in an AWS and an ISO version. Click the joint, then where the arrow meets the reference line.

Preferences hold:

- what each side of the line says (sizes, lengths and pitch, groove symbol and angle, flange radius, spot, seam, stud or surfacing, plug or slot)
- ISO's configuration with its dashed identification line
- finish contour and method
- stagger
- a tail with up to three note lines
- weld all around
- a field weld flag

## Measuring

### Tape measure

The **Tape Measure** tool (<kbd>N</kbd>) gives the length, angle and ΔX/ΔY between two points. In Multiple Segment mode it gives the length of a clicked path, segment by segment with its running total; double-click or <kbd>Enter</kbd> ends it.

Object Info shows the length, area and perimeter of the selected object.

### Dimension Tape

With the **Dimension Tape** tool (Dims/Notes), click its start and end (or drag), then where it lies. It draws a line with hash marks, subdivisions between them and each mark's distance from 0, counted from its start or its middle, either way.

### Protractor

To use the **Protractor** tool (Dims/Notes):

1. Click the angle's vertex.
2. Click a point along one side.
3. Move to the other side.

It shows an arc between the sides with the angle the smaller way round, and the larger one and the sides' directions under it. A click freezes it; Shift keeps a side to 15° steps; <kbd>Esc</kbd> clears.
