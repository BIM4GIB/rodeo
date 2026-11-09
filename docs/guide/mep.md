# MEP: piping, ducts, electrical and irrigation

This page covers piping, ducts, electrical and communication devices, speakers, the AEC menu's electrical calculators, and irrigation.

## Piping

### Piping Run

With the **Piping Run** tool (MEP tool set), click a run's corners, or turn selected polygons and polylines into runs with **AEC › MEP › Create Piping Runs…**.

It works out the length, sections and couplings a run takes, and its elbows or bends, and tags it with its size and material. They're worked out once, when it's placed, and go in a Piping Run record.

## Ducts

### HVAC

The **HVAC** tools (MEP tool set) are **Straight Duct**, **Elbow Duct**, **Flex Duct**, **Vertical Duct**, **Transition**, **Splitter**, **Damper**, **Diffuser** and **Outlet**. Each places a plan and a solid at the height you set, in a group. Ducts can show a label with their size and a marker with the height of their top and bottom.

**Limits:**

- The help covers only the general idea, so their options are Rodeo's own.
- Fittings don't join up automatically.
- There are no flanges or insulation.

## Electrical devices and speakers

These tools draw plain objects in plan, grouped.

### Receptacle, Switch, Comm Device and Incandescent Fixture

With the **Receptacle**, **Switch**, **Comm Device** and **Incandescent Fixture** tools (MEP tool set), click to place an electrical or communication indicator, the same size on paper at any layer scale, its stem on the wall and a press dragged turning it off the wall, with its config label.

### Speaker

With the **Speaker** tool (Event Design tool set), click to place a speaker, its dispersion lines and the coverage shadow on the listening plane.

## Electrical calculations

### Conductor Sizing Calc…

**AEC › MEP › Conductor Sizing Calc…** works out a run's wire size, voltage drop, current, length, voltage, phase factor or resistivity from the rest, for copper or aluminum wire from 18 AWG to 1000 kcmil, as the values are typed.

### Conduit Sizing Calc…

**AEC › MEP › Conduit Sizing Calc…** lists the wires going in a conduit (by the NEC's Table 5, or any wire's area typed) and reports the actual size and the trade size of EMT, RMC, IMC, FMC, LFMC or PVC they need. It shares them over as many conduits as given, at the fill suggested by Table 1 or typed.

**Limits:** Vectorworks' wire database of manufacturers and part numbers isn't here.

## Irrigation

The Irrigation tool set's tools draw plain objects in plan, grouped.

### Outlets, pipes and valves

- **Outlet**: place spray, rotor or emitter outlets with their coverage one at a time, at a path's corners, spaced along it, or filling an area in rectangular or triangular rows.
- **Pipe**: click a main, lateral or drip line with its flow arrow and size.
- **Valve**, **Point of Connection** and **Controller**: place a valve, point of connection or controller with its name.

### Drip, components and zones

- **Drip Outlet**: click a drip line, or an area filled with rows of drip line.
- **System Component**: place a system component with its name.
- **Design Zone**: outline a design zone (its Zone ID counting on).
- **Hydrozone**: outline a hydrozone labelled with its water use and area.
