// The top bar: the file's name, the tools in groups, and Save with a caret that
// drops the export, share and print rows, as Spline's editor bar. Also the tool
// palettes, Tools and Tool Sets, for those
// who want Vectorworks' grid of tool buttons (Window > Palettes). As in
// Vectorworks' workspace editor, the tool sets can be rearranged (Window >
// Workspaces > Tool Sets…), and the palettes show small icons, large icons or
// icons with names (their title bar's menu); both are kept per browser and go
// with saved and exported workspaces.

import { byId, h } from "./dom.ts";
import { appContext } from "./ext.ts";
import { PALETTE_ICON, TOOL_ICON, UI_ICON } from "./icons.ts";
import { menuButton, type Item, type Row } from "./menu.ts";
import { allMenus } from "./menubar.ts";
import { store, type ToolId } from "./state.ts";
import { onToolKeys, toolKeyLabel } from "./toolKeys.ts";
import { screenTip, type ScreenTip } from "./screenTips.ts";

export interface ToolbarActions {
  save(): void;
  exportPdf(): void;
  exportImage(): void;
  exportSvg(): void;
  exportDxf(): void;
  print(): void;
}

/** A tool button; its key comes from the tool shortcuts (toolKeys.ts), which can change. */
export interface ToolDef {
  readonly id: ToolId;
  readonly label: string;
  readonly separatorBefore?: boolean;
}

const BASIC: readonly ToolDef[] = [
  { id: "select", label: "Select" },
  { id: "reshape", label: "Reshape" },
  { id: "pan", label: "Pan" },
  { id: "zoom", label: "Zoom" },
  { id: "text", label: "Text" },
  { id: "line", label: "Line", separatorBefore: true },
  { id: "doubleline", label: "Double Line" },
  { id: "dlpolygon", label: "Double Line Polygon" },
  { id: "rect", label: "Rectangle" },
  { id: "roundrect", label: "Rounded Rectangle" },
  { id: "circle", label: "Circle" },
  { id: "arc", label: "Arc" },
  { id: "quarterarc", label: "Quarter Arc" },
  { id: "freehand", label: "Freehand" },
  { id: "polyline", label: "Polyline" },
  { id: "polygon", label: "Polygon" },
  { id: "triangle", label: "Triangle" },
  { id: "regpoly", label: "Regular Polygon" },
  { id: "oval", label: "Oval" },
  { id: "spiral", label: "Spiral" },
  { id: "locus", label: "2D Locus" },
  // transform tools act on the selection, so they sit apart from the drawing tools
  { id: "mirror", label: "Mirror", separatorBefore: true },
  { id: "rotate", label: "Rotate" },
  { id: "moveby", label: "Move by Points" },
  { id: "eyedropper", label: "Eyedropper" },
  { id: "attrmap", label: "Attribute Mapping" },
  { id: "visibility", label: "Visibility" },
  { id: "selectsimilar", label: "Select Similar" },
  { id: "offset", label: "Offset" },
  { id: "fillet", label: "Fillet" },
  { id: "chamfer", label: "Chamfer" },
  { id: "trim", label: "Trim" },
  { id: "clip", label: "Clip" },
  { id: "shear", label: "Shear" },
  { id: "fpresize", label: "Fixed Point Resize" },
  { id: "split", label: "Split" },
  { id: "connect", label: "Connect" },
];

interface ToolSet {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly tools: readonly ToolDef[];
}

const TOOL_SETS: readonly ToolSet[] = [
  {
    id: "dims",
    label: "Dims/Notes",
    icon: UI_ICON.dims,
    tools: [
      { id: "dimension", label: "Dimension" },
      { id: "arclength", label: "Arc Length Dimension" },
      { id: "slopedim", label: "Slope Dimension" },
      { id: "measure", label: "Tape Measure" },
      { id: "dimtape", label: "Dimension Tape" },
      { id: "protractor", label: "Protractor" },
      { id: "callout", label: "Callout" },
      { id: "leadersimple", label: "Leader Line Simple" },
      { id: "leaderline", label: "Leader Line" },
      { id: "hyperlink", label: "Hyperlink" },
      { id: "cloud", label: "Revision Cloud" },
      { id: "secmarker", label: "Section-Elevation Marker" },
      { id: "secline", label: "Section-Elevation Line" },
      { id: "intelev", label: "Interior Elevation Marker" },
      { id: "detailcallout", label: "Detail Callout" },
      { id: "drawlabel", label: "Drawing Label" },
      { id: "refmarker", label: "Reference Marker" },
      { id: "gridline", label: "Grid Line" },
      { id: "redline", label: "Redline" },
      { id: "generalnotes", label: "General Notes" },
      { id: "tbborder", label: "Title Block Border" },
      { id: "benchmark", label: "Elevation Benchmark" },
      { id: "northarrow", label: "North Arrow" },
      { id: "scalebar", label: "Scale Bar" },
      { id: "datatag", label: "Data Tag" },
      { id: "legend", label: "Graphic Legend" },
      { id: "symmetry", label: "Symmetry Label" },
      { id: "centermark", label: "Center Mark" },
      { id: "fcf", label: "Feature Control Frame" },
      { id: "gdtnote", label: "Geom Dim and Tol Note" },
      { id: "weldfilletaws", label: "Welding Sym-Fillet (AWS)" },
      { id: "weldfilletiso", label: "Welding Sym-Fillet (ISO)" },
      { id: "weldflangeaws", label: "Welding Sym-Flange (AWS)" },
      { id: "weldflangeiso", label: "Welding Sym-Flange (ISO)" },
      { id: "weldgrooveaws", label: "Welding Sym-Groove (AWS)" },
      { id: "weldgrooveiso", label: "Welding Sym-Groove (ISO)" },
      { id: "weldmiscaws", label: "Welding Sym-Misc (AWS)" },
      { id: "weldmisciso", label: "Welding Sym-Misc (ISO)" },
      { id: "weldslotplugaws", label: "Welding Sym-Slot-Plug (AWS)" },
      { id: "weldslotplugiso", label: "Welding Sym-Slot-Plug (ISO)" },
    ],
  },
  {
    id: "detailing",
    label: "Detailing",
    icon: TOOL_ICON.insulation,
    tools: [
      { id: "breakline", label: "Break Line" },
      { id: "insulation", label: "Insulation" },
      { id: "repunit", label: "Repetitive Unit" },
      { id: "steel", label: "Steel Section" },
      { id: "steel3d", label: "Steel Section - 3D" },
      { id: "lumber", label: "Lumber" },
      { id: "linearmaterial", label: "Linear Material" },
      { id: "framing", label: "Framing Member" },
      { id: "bulbflat", label: "Bulb Flat" },
      { id: "shaftbreak", label: "Shaft Break" },
      { id: "shaftbreak2", label: "Shaft Break 2" },
      { id: "bolt", label: "Bolt" },
      { id: "screw", label: "Screw" },
      { id: "nail", label: "Nail" },
      { id: "anchor", label: "Anchor" },
      { id: "carriagebolt", label: "Carriage Bolt" },
      { id: "carriagebolt3d", label: "Carriage Bolt - 3D" },
      { id: "lagscrew", label: "Lag Screw" },
      { id: "lagscrew3d", label: "Lag Screw - 3D" },
      { id: "boltnutinch", label: "Bolt and Nut - inch" },
      { id: "boltnutmm", label: "Bolt and Nut - mm" },
      { id: "woodscrew", label: "Wood Screw" },
      { id: "woodscrew3d", label: "Wood Screw - 3D" },
      { id: "sheetmetalscrew", label: "Sheet Metal Screw" },
      { id: "sheetmetalscrew3d", label: "Sheet Metal Screw - 3D" },
      { id: "weld", label: "Weld" },
      { id: "stipple", label: "Stipple" },
      { id: "drilledhole", label: "Hole - Drilled" },
      { id: "drilledhole3d", label: "Hole - Drilled - 3D" },
      { id: "tappedmm", label: "Hole - Tapped (Metric)" },
      { id: "tappedmm3d", label: "Hole - Tapped (Metric) - 3D" },
      { id: "tappedin", label: "Hole - Tapped (Inch)" },
      { id: "tappedin3d", label: "Hole - Tapped (Inch) - 3D" },
      { id: "slot", label: "Slot" },
      { id: "holepattern", label: "Hole Pattern" },
      { id: "screwthread", label: "Screw Threads" },
      { id: "keyway", label: "Keyway" },
    ],
  },
  {
    id: "machine",
    label: "Machine Components",
    icon: TOOL_ICON.spurgear,
    tools: [
      { id: "spurgear", label: "Spur Gear" },
      { id: "spurgear3d", label: "Spur Gear - 3D" },
      { id: "gearrack", label: "Spur Gear Rack" },
      { id: "gearrack3d", label: "Spur Gear Rack - 3D" },
      { id: "sprocket", label: "Sprocket" },
      { id: "sprocket3d", label: "Sprocket - 3D" },
      { id: "chainlinear", label: "Roller Chain - Linear" },
      { id: "chainlinear3d", label: "Roller Chain - Linear - 3D" },
      { id: "chaincircular", label: "Roller Chain - Circular" },
      { id: "chaincircular3d", label: "Roller Chain - Circular - 3D" },
      { id: "offsetlink", label: "Roller Chain - Offset Link" },
      { id: "offsetlink3d", label: "Roller Chain - Offset Link - 3D" },
      { id: "bevelgear", label: "Bevel Gears" },
      { id: "bevelgear3d", label: "Bevel Gears - 3D" },
      { id: "worm", label: "Worm" },
      { id: "worm3d", label: "Worm - 3D" },
      { id: "wormgear", label: "Worm Gear" },
      { id: "wormgear3d", label: "Worm Gear - 3D" },
      { id: "shaft", label: "Shaft" },
      { id: "shaft3d", label: "Shaft - 3D" },
      { id: "ballbearing", label: "Ball Bearing" },
      { id: "ballbearing3d", label: "Ball Bearing - 3D" },
      { id: "rollerbearing", label: "Roller Bearing" },
      { id: "rollerbearing3d", label: "Roller Bearing - 3D" },
      { id: "needlebearing", label: "Needle Bearing" },
      { id: "needlebearing3d", label: "Needle Bearing - 3D" },
      { id: "taperedbearing", label: "Tapered Roller Bearing" },
      { id: "taperedbearing3d", label: "Tapered Roller Bearing - 3D" },
      { id: "thrustbearing", label: "Thrust Bearing" },
      { id: "thrustbearing3d", label: "Thrust Bearing - 3D" },
      { id: "locknut", label: "Bearing Lock Nut" },
      { id: "locknut3d", label: "Bearing Lock Nut - 3D" },
      { id: "pillowblock", label: "Pillow Block" },
      { id: "pillowblock3d", label: "Pillow Block - 3D" },
      { id: "flanged2", label: "Flanged Bearing - 2 Hole" },
      { id: "flanged23d", label: "Flanged Bearing - 2 Hole - 3D" },
      { id: "flanged4", label: "Flanged Bearing - 4 Hole" },
      { id: "flanged43d", label: "Flanged Bearing - 4 Hole - 3D" },
      { id: "pulley", label: "Pulley" },
      { id: "pulley3d", label: "Pulley - 3D" },
      { id: "key", label: "Key" },
      { id: "key3d", label: "Key - 3D" },
      { id: "woodruffkey", label: "Woodruff Key" },
      { id: "woodruffkey3d", label: "Woodruff Key - 3D" },
      { id: "compspring1", label: "Compression Spring 1" },
      { id: "compspring13d", label: "Compression Spring 1 - 3D" },
      { id: "compspring2", label: "Compression Spring 2" },
      { id: "compspring23d", label: "Compression Spring 2 - 3D" },
      { id: "conicalspring", label: "Conical Compression Spring" },
      { id: "conicalspring3d", label: "Conical Comp Spring - 3D" },
      { id: "diespring", label: "Die Spring" },
      { id: "diespring3d", label: "Die Spring - 3D" },
      { id: "extspringfront", label: "Extension Spring - Front" },
      { id: "extspring3d", label: "Extension Spring - 3D" },
      { id: "extspringend", label: "Extension Spring - End" },
      { id: "torsionfront", label: "Torsion Spring - Front" },
      { id: "torsion3d", label: "Torsion Spring - 3D" },
      { id: "torsionend", label: "Torsion Spring - End" },
      { id: "belleville", label: "Belleville Spring" },
      { id: "belleville3d", label: "Belleville Spring - 3D" },
    ],
  },
  {
    id: "fasteners",
    label: "Fasteners",
    icon: TOOL_ICON.clevisinch,
    tools: [
      { id: "fastener", label: "Fastener" },
      { id: "clevisinch", label: "Clevis Pin (Inch)" },
      { id: "clevisinch3d", label: "Clevis Pin (Inch) - 3D" },
      { id: "clevismetric", label: "Clevis Pin (Metric)" },
      { id: "clevismetric3d", label: "Clevis Pin (Metric) - 3D" },
      { id: "clevisdin", label: "Clevis Pin (DIN)" },
      { id: "clevisdin3d", label: "Clevis Pin (DIN) - 3D" },
      { id: "cotterpin", label: "Cotter Pin (Inch)" },
      { id: "cotterpin3d", label: "Cotter Pin (Inch) - 3D" },
      { id: "dowelpin", label: "Dowel Pin (Inch)" },
      { id: "dowelpin3d", label: "Dowel Pin (Inch) - 3D" },
      { id: "parallelpin", label: "Parallel Pin (DIN)" },
      { id: "parallelpin3d", label: "Parallel Pin (DIN) - 3D" },
      { id: "taperpininch", label: "Taper Pin (Inch)" },
      { id: "taperpininch3d", label: "Taper Pin (Inch) - 3D" },
      { id: "taperpindin", label: "Taper Pin (DIN)" },
      { id: "taperpindin3d", label: "Taper Pin (DIN) - 3D" },
      { id: "rivetlarge", label: "Large Rivet (Inch)" },
      { id: "rivetlarge3d", label: "Large Rivet (Inch) - 3D" },
      { id: "rivetsmall", label: "Small Rivet (Inch)" },
      { id: "rivetsmall3d", label: "Small Rivet (Inch) - 3D" },
      { id: "rivetdin", label: "Rivet (DIN)" },
      { id: "rivetdin3d", label: "Rivet (DIN) - 3D" },
      { id: "rivettubular", label: "Tubular Rivet (DIN)" },
      { id: "rivettubular3d", label: "Tubular Rivet (DIN) - 3D" },
      { id: "acornnut", label: "Acorn Nut (Inch)" },
      { id: "acornnut3d", label: "Acorn Nut (Inch) - 3D" },
      { id: "hexcapnut", label: "Hex Cap Nut (DIN)" },
      { id: "hexcapnut3d", label: "Hex Cap Nut (DIN) - 3D" },
      { id: "knurleddin", label: "Knurled Thumb Nut (DIN)" },
      { id: "knurleddin3d", label: "Knurled Thumb Nut (DIN) - 3D" },
      { id: "knurledinch", label: "Knurled Thumb Nut (Inch)" },
      { id: "knurledinch3d", label: "Knurled Thumb Nut (Inch) - 3D" },
      { id: "wingdin", label: "Wing Nut (DIN)" },
      { id: "wingdin3d", label: "Wing Nut (DIN) - 3D" },
      { id: "winga", label: "Wing Nut - Type A (Inch)" },
      { id: "winga3d", label: "Wing Nut - Type A (Inch) - 3D" },
      { id: "wingb", label: "Wing Nut - Type B (Inch)" },
      { id: "wingb3d", label: "Wing Nut - Type B (Inch) - 3D" },
      { id: "wingc", label: "Wing Nut - Type C (Inch)" },
      { id: "wingc3d", label: "Wing Nut - Type C (Inch) - 3D" },
      { id: "wingd", label: "Wing Nut - Type D (Inch)" },
      { id: "wingd3d", label: "Wing Nut - Type D (Inch) - 3D" },
      { id: "ringasme", label: "Retaining Ring (ASME)" },
      { id: "ringasme3d", label: "Retaining Ring (ASME) - 3D" },
      { id: "ringdin", label: "Retaining Ring (DIN)" },
      { id: "ringdin3d", label: "Retaining Ring (DIN) - 3D" },
      { id: "washerdin", label: "Retaining Washer (DIN)" },
      { id: "washerdin3d", label: "Retaining Washer (DIN) - 3D" },
      { id: "eyebolt", label: "Eye Bolt" },
      { id: "eyebolt3d", label: "Eye Bolt - 3D" },
      { id: "jbolt", label: "J-Bolt" },
      { id: "jbolt3d", label: "J-Bolt - 3D" },
      { id: "swingbolt", label: "Swing Bolt" },
      { id: "swingbolt3d", label: "Swing Bolt - 3D" },
      { id: "swingeyebolt", label: "Swing Eye Bolt" },
      { id: "swingeyebolt3d", label: "Swing Eye Bolt - 3D" },
      { id: "tbolt", label: "T-Bolt" },
      { id: "tbolt3d", label: "T-Bolt - 3D" },
      { id: "thumbscrew", label: "Thumb Screw (Inch)" },
      { id: "thumbscrew3d", label: "Thumb Screw (Inch) - 3D" },
      { id: "ubolt", label: "U-Bolt" },
      { id: "ubolt3d", label: "U-Bolt - 3D" },
    ],
  },
  {
    id: "furniture",
    label: "Furniture/Fixtures",
    icon: TOOL_ICON.tablechairs,
    tools: [
      { id: "tablechairs", label: "Table and Chairs" },
      { id: "desk", label: "Desk" },
      { id: "shelving", label: "Shelving Unit" },
      { id: "clothesrod", label: "Clothes Rod" },
      { id: "bathshower", label: "Bath-Shower" },
      { id: "grabbars", label: "Grab Bars" },
      { id: "fireplace", label: "Fireplace" },
      { id: "toiletstall", label: "Toilet Stall" },
      { id: "cabinet", label: "Cabinet" },
      { id: "customcab", label: "Custom Cabinet" },
      { id: "countertop", label: "Countertop" },
      { id: "compsink", label: "Compartment Sink" },
      { id: "railing", label: "Railing/Fence" },
      { id: "ceilinggrid", label: "Ceiling Grid" },
      { id: "seating", label: "Seating Section" },
    ],
  },
  {
    id: "spaceplanning",
    label: "Space Planning",
    icon: TOOL_ICON.space,
    tools: [
      { id: "space", label: "Space" },
      { id: "spacelink", label: "Space Link" },
      { id: "adjacencymatrix", label: "Adjacency Matrix" },
      { id: "adjacencyscore", label: "Adjacency Score" },
      { id: "stackingdiagram", label: "Stacking Diagram" },
    ],
  },
  {
    id: "siteplanning",
    label: "Site Planning",
    icon: TOOL_ICON.plant,
    tools: [
      { id: "plant", label: "Plant" },
      { id: "hardscape", label: "Hardscape" },
      { id: "massingmodel", label: "Massing Model" },
      { id: "landscape", label: "Landscape Area" },
      { id: "hedgerow", label: "Hedgerow" },
      { id: "sitemodifier", label: "Site Modifiers" },
      { id: "grade", label: "Grade" },
      { id: "existingtree", label: "Existing Tree" },
      { id: "propline", label: "Property Line" },
      { id: "parking", label: "Parking Space" },
      { id: "parkingspaces", label: "Parking Spaces" },
      { id: "parkingarea", label: "Parking Area" },
      { id: "parkingpath", label: "Parking Along Path" },
      { id: "stake", label: "Stake" },
      { id: "fence", label: "Fence" },
      { id: "curb", label: "Curb" },
      { id: "roadstraight", label: "Roadway (Straight)" },
      { id: "roadcurved", label: "Roadway (Curved)" },
      { id: "roadtee", label: "Roadway (Tee)" },
      { id: "roadpoly", label: "Roadway (Poly)" },
    ],
  },
  {
    id: "gis",
    label: "GIS",
    icon: TOOL_ICON.graticule,
    tools: [
      { id: "graticule", label: "Graticule" },
      { id: "greatcircle", label: "Great Circle" },
      { id: "surveypoint", label: "Survey Point" },
      { id: "gisstake", label: "GIS Stake" },
    ],
  },
  {
    id: "event",
    label: "Event Design",
    icon: TOOL_ICON.stagedeck,
    tools: [
      { id: "stagedeck", label: "Stage Deck" },
      { id: "stageplug", label: "Stage Plug" },
      { id: "stagesteps", label: "Stage Steps" },
      { id: "stageramp", label: "Stage Ramp" },
      { id: "ropestanchion", label: "Rope and Stanchion" },
      { id: "softgoods", label: "Soft Goods" },
      { id: "television", label: "Television" },
      { id: "videoscreen", label: "Video Screen" },
      { id: "blendedscreen", label: "Blended Screen" },
      { id: "ledscreen", label: "LED Screen" },
      { id: "speaker", label: "Speaker" },
      { id: "speakerarray", label: "Speaker Array" },
    ],
  },
  {
    id: "connectcad",
    label: "ConnectCAD Schematics",
    icon: TOOL_ICON.ccdevice,
    tools: [
      { id: "ccdevice", label: "Device" },
      { id: "ccdevicebuilder", label: "Device Builder" },
      { id: "ccexternal", label: "External" },
      { id: "ccda", label: "Distribution Amplifier" },
      { id: "cctermpanel", label: "Term Panel" },
      { id: "ccjack", label: "Jackfield" },
      { id: "cclinkedjack", label: "Linked Jackfield" },
      { id: "ccconnectorpanel", label: "Connector Panel" },
      { id: "ccadapter", label: "Adapter" },
      { id: "ccsocket", label: "Socket" },
      { id: "ccsocketloop", label: "Socket Loop" },
      { id: "ccterminator", label: "Terminator" },
      { id: "ccconnect", label: "Connect" },
      { id: "ccreroute", label: "ReRoute Circuits" },
      { id: "hopover", label: "HopOver" },
      { id: "cclegend", label: "Legend" },
    ],
  },
  {
    id: "connectcadlayout",
    label: "ConnectCAD Layout",
    icon: TOOL_ICON.cclayoutroom,
    tools: [
      { id: "cclayoutroom", label: "Layout Room" },
      { id: "ccrack", label: "Equipment Rack 3D" },
      { id: "ccequip", label: "Equipment Item" },
      { id: "ccrackframe", label: "Rack Frame" },
      { id: "ccadapterslot", label: "Adapter Slot" },
      { id: "ccrackws", label: "Make Rack Equipment Worksheet" },
      { id: "ccpanelconnector", label: "Panel Connector" },
      { id: "cclabelcolor", label: "Color-Coded Linked Text" },
      { id: "cclabelqr", label: "Linked QR Code" },
      { id: "rackruler", label: "Rack Ruler" },
    ],
  },
  {
    id: "connectcadroute",
    label: "ConnectCAD Cable Route",
    icon: TOOL_ICON.cccableroute,
    tools: [
      { id: "cccableroute", label: "Cable Route" },
      { id: "ccdroppoint", label: "Drop Point" },
      { id: "cceditcabling", label: "Edit Cabling" },
    ],
  },
  {
    id: "mep",
    label: "MEP",
    icon: TOOL_ICON.receptacle,
    tools: [
      { id: "receptacle", label: "Receptacle" },
      { id: "switch", label: "Switch" },
      { id: "commdevice", label: "Comm Device" },
      { id: "incandescent", label: "Incandescent Fixture" },
      { id: "pipingrun", label: "Piping Run" },
      { id: "hvacduct", label: "HVAC Straight Duct" },
      { id: "hvacelbow", label: "HVAC Elbow Duct" },
      { id: "hvacflex", label: "HVAC Flex Duct" },
      { id: "hvacvertical", label: "HVAC Vertical Duct" },
      { id: "hvactransition", label: "HVAC Transition" },
      { id: "hvacsplitter", label: "HVAC Splitter" },
      { id: "hvacdamper", label: "HVAC Damper" },
      { id: "hvacdiffuser", label: "HVAC Diffuser" },
      { id: "hvacoutlet", label: "HVAC Outlet" },
    ],
  },
  {
    id: "rigging",
    label: "Rigging",
    icon: TOOL_ICON.trussstraight,
    tools: [
      { id: "trussstraight", label: "Straight Truss" },
      { id: "trusscurved", label: "Curved Truss" },
      { id: "lightingpipe", label: "Lighting Pipe" },
      { id: "pipeladder", label: "Lighting Pipe Ladder" },
      { id: "rigpoint", label: "House Rigging Point" },
      { id: "hoist", label: "Hoist" },
      { id: "hoistorigin", label: "Hoist Origin" },
      { id: "bridle", label: "Bridle" },
      { id: "mothergrid", label: "Mother Grid" },
      { id: "riggingload", label: "Rigging Load" },
      { id: "cablepath", label: "Cable Path" },
      { id: "cable", label: "Cable" },
      { id: "distributor", label: "Distributor" },
      { id: "eleccomponent", label: "Electrical Component" },
      { id: "hangingposition", label: "Hanging Position" },
      { id: "lightdevice", label: "Lighting Device" },
      { id: "lightaccessory", label: "Lighting Accessory" },
      { id: "ganging", label: "Ganging" },
      { id: "focuspoint", label: "Focus Point" },
      { id: "focusalongpath", label: "Focus Lighting Devices Along Path" },
      { id: "photometer", label: "Photometer" },
      { id: "photogrid", label: "Photometric Grid" },
      { id: "equipmentkey", label: "Equipment Summary Key" },
      { id: "aligndistribute", label: "Align and Distribute" },
    ],
  },
  {
    id: "theatre",
    label: "Theatre",
    icon: TOOL_ICON.stageorigin,
    tools: [
      { id: "stageorigin", label: "Stage Origin" },
      { id: "focusinstrument", label: "Focus Instrument" },
      { id: "spikemark", label: "Spike Mark" },
    ],
  },
  {
    id: "irrigation",
    label: "Irrigation",
    icon: TOOL_ICON.outlet,
    tools: [
      { id: "outlet", label: "Outlet" },
      { id: "dripoutlet", label: "Drip Outlet" },
      { id: "irrpipe", label: "Pipe" },
      { id: "valve", label: "Valve" },
      { id: "poc", label: "Point of Connection" },
      { id: "controller", label: "Controller" },
      { id: "syscomponent", label: "System Component" },
      { id: "designzone", label: "Design Zone" },
      { id: "hydrozone", label: "Hydrozone" },
    ],
  },
  {
    id: "insertion",
    label: "Insertion",
    icon: UI_ICON.insertion,
    tools: [
      { id: "symbol", label: "Symbol Insertion" },
      { id: "plugin", label: "Plug-in Insertion" },
    ],
  },
  {
    id: "buildingshell",
    label: "Building Shell",
    icon: TOOL_ICON.wall,
    tools: [
      { id: "wall", label: "Wall" },
      { id: "walljoin", label: "Wall Join" },
      { id: "door", label: "Door" },
      { id: "window", label: "Window" },
      { id: "slab", label: "Slab" },
      { id: "column", label: "Column" },
      { id: "stair", label: "Stair" },
      { id: "simplestair", label: "Simple Stair" },
      { id: "ramp", label: "Ramp" },
      { id: "elevator", label: "Elevator" },
      { id: "escalator", label: "Escalator" },
      { id: "pilaster", label: "Pilaster" },
      { id: "structmember", label: "Structural Member" },
      { id: "chainextrude", label: "Chain Extrude" },
    ],
  },
  {
    id: "visualization",
    label: "Visualization",
    icon: PALETTE_ICON.visualization,
    tools: [
      { id: "light", label: "Light" },
      { id: "camera", label: "Camera" },
      { id: "videocamera", label: "Video Camera" },
      { id: "flyover", label: "Flyover" },
      { id: "translateview", label: "Translate View" },
      { id: "walkthrough", label: "Walkthrough" },
      { id: "heliodon", label: "Heliodon" },
      { id: "renderbitmap", label: "Render Bitmap" },
    ],
  },
  {
    id: "modeling3d",
    label: "3D Modeling",
    icon: UI_ICON.cube,
    tools: [
      { id: "extrect", label: "Extruded Rectangle" },
      { id: "extpoly", label: "Extruded Polygon" },
      { id: "sphere", label: "Sphere" },
      { id: "hemisphere", label: "Hemisphere" },
      { id: "cone", label: "Cone" },
      { id: "poly3d", label: "3D Polygon" },
      { id: "locus3d", label: "3D Locus" },
      { id: "chamferedge", label: "Chamfer Edge" },
      { id: "filletedge", label: "Fillet Edge" },
      { id: "shellsolid", label: "Shell Solid" },
      { id: "taperface", label: "Taper Face" },
      { id: "pushpull", label: "Push/Pull" },
      { id: "offsetedge", label: "Offset Edge" },
      { id: "deform", label: "Deform" },
      { id: "extract", label: "Extract" },
      { id: "project", label: "Project" },
      { id: "analysis", label: "Analysis" },
      { id: "loftsurface", label: "Loft Surface" },
      { id: "alignplane", label: "Align Plane" },
    ],
  },
];

const SET_KEY = "openvwx.toolset";
const GROUP_KEY = "openvwx.toolgroup.";
const SETS_KEY = "openvwx.toolsets.v1";
const DISPLAY_KEY = "openvwx.tooldisplay";

/** How the tool palettes show their tools. */
export type ToolDisplay = "small" | "large" | "named";
const DISPLAYS: readonly { readonly id: ToolDisplay; readonly label: string }[] = [
  { id: "small", label: "Small Icons" },
  { id: "large", label: "Large Icons" },
  { id: "named", label: "Icons and Names" },
];

/** A tool set as arranged in Window > Workspaces > Tool Sets…: its name and its tools, in order. */
export interface ToolSetConfig {
  readonly id: string;
  readonly label: string;
  readonly tools: readonly ToolId[];
}

const ALL_TOOLS: readonly ToolDef[] = [...BASIC, ...TOOL_SETS.flatMap((s) => s.tools)];

/**
 * The top bar's tools: a button per group, showing the group's last used tool; its caret drops the rest.
 * The tools everyone uses come first (moving round, drawing, changing what is drawn, annotating),
 * then architecture and interiors, 3D modelling and its lights and cameras, the site, and the stage,
 * each group led by its most used tool. The specialist sets (machine parts, fasteners, welding and
 * tolerances, MEP, ConnectCAD, irrigation, GIS, rigging detail) are in the Tool sets button's menu.
 */
const TOP_GROUPS: readonly (readonly ToolId[] | "-")[] = [
  ["select", "reshape"],
  ["pan", "zoom", "flyover", "translateview", "walkthrough"],
  "-",
  ["line", "doubleline", "freehand"],
  ["rect", "roundrect"],
  ["circle", "arc", "quarterarc", "oval", "spiral"],
  ["polyline", "polygon", "triangle", "regpoly", "dlpolygon"],
  ["text", "callout", "leadersimple", "leaderline", "datatag", "generalnotes", "legend", "cloud", "redline", "hyperlink"],
  ["symbol", "plugin", "locus"],
  "-",
  ["moveby", "rotate", "mirror", "offset", "shear", "fpresize"],
  ["fillet", "chamfer", "trim", "split", "connect", "clip"],
  ["eyedropper", "attrmap", "visibility", "selectsimilar"],
  "-",
  ["dimension", "arclength", "slopedim", "measure", "dimtape", "protractor"],
  ["secmarker", "secline", "intelev", "detailcallout", "drawlabel", "refmarker", "gridline", "tbborder", "benchmark", "northarrow", "scalebar", "symmetry", "centermark"],
  "-",
  ["wall", "walljoin"],
  ["door", "window"],
  ["slab", "column", "pilaster", "structmember"],
  ["stair", "simplestair", "ramp", "railing", "elevator", "escalator"],
  ["tablechairs", "desk", "shelving", "clothesrod", "bathshower", "grabbars", "fireplace", "toiletstall", "cabinet", "customcab", "countertop", "compsink", "ceilinggrid"],
  "-",
  ["extrect", "extpoly", "sphere", "hemisphere", "cone", "poly3d", "locus3d"],
  ["pushpull", "chamferedge", "filletedge", "shellsolid", "taperface", "offsetedge", "deform", "loftsurface", "chainextrude"],
  ["light", "camera", "heliodon", "videocamera", "renderbitmap"],
  "-",
  ["plant", "existingtree", "hardscape", "massingmodel", "landscape", "hedgerow", "sitemodifier", "grade", "propline", "parking", "parkingspaces", "parkingarea", "parkingpath", "stake", "fence", "curb", "roadstraight", "roadcurved", "roadtee", "roadpoly"],
  "-",
  ["stagedeck", "stageplug", "stagesteps", "stageramp", "seating", "ropestanchion", "softgoods", "television", "videoscreen", "blendedscreen", "ledscreen", "speaker", "speakerarray"],
  ["lightdevice", "lightaccessory", "focuspoint", "hangingposition", "lightingpipe", "pipeladder", "trussstraight", "trusscurved", "hoist"],
];

/** Every tool the top bar's groups hold. */
const IN_TOP_BAR = new Set<ToolId>(TOP_GROUPS.flatMap((g) => (g === "-" ? [] : g)));

/** Tools a command takes up for its clicks, on no palette. */
const COMMAND_TOOLS: readonly ToolDef[] = [
  { id: "section2d", label: "Cut Section" },
  { id: "hatch", label: "Hatch" },
  { id: "dividing", label: "Dividing Lines" },
  { id: "alignleaders", label: "Leader Lines" },
  { id: "rotate3dcentre", label: "Rotate 3D" },
  { id: "roofaxis", label: "Roof Face" },
  { id: "placeat", label: "Place" },
  { id: "adddims", label: "Add Dimensions" },
  { id: "visualzone", label: "Zone of Visual Influence" },
  { id: "sitesculpt", label: "Surface Sculpting" },
  { id: "sitecontour", label: "Site Model Contour" },
  { id: "sitelabels", label: "Contour Labels" },
  { id: "spotnumber", label: "Spotlight Numbering" },
  { id: "rotateplan", label: "Rotate Plan" },
];

/** Every tool with its name, for the mode bar. */
export function toolDef(id: ToolId): ToolDef | undefined {
  return allTools().find((t) => t.id === id) ?? COMMAND_TOOLS.find((t) => t.id === id);
}

/** Every tool, in the order of the Basic palette and then the tool sets as they come. */
export function allTools(): readonly ToolDef[] {
  return ALL_TOOLS;
}

// ---- tool sets and how the palettes show tools ----------------------------

export function defaultToolSets(): ToolSetConfig[] {
  return TOOL_SETS.map((s) => ({ id: s.id, label: s.label, tools: s.tools.map((t) => t.id) }));
}

/** Tool sets read back from storage or a workspace file: named sets of known tools, each tool once; null when unusable. */
export function readToolSets(raw: unknown): ToolSetConfig[] | null {
  if (!Array.isArray(raw)) return null;
  const known = new Set<string>(ALL_TOOLS.map((t) => t.id));
  const seen = new Set<string>();
  const out: ToolSetConfig[] = [];
  for (const s of raw as unknown[]) {
    const set = s as Partial<ToolSetConfig> | null;
    if (!set || typeof set.id !== "string" || typeof set.label !== "string" || !set.label.trim() || !Array.isArray(set.tools)) return null;
    const tools = set.tools.filter((t): t is ToolId => typeof t === "string" && known.has(t) && !seen.has(t));
    for (const t of tools) seen.add(t);
    if (tools.length) out.push({ id: set.id, label: set.label.trim(), tools });
  }
  return out.length ? out : null;
}

export function readToolDisplay(raw: unknown): ToolDisplay | null {
  return DISPLAYS.some((d) => d.id === raw) ? (raw as ToolDisplay) : null;
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // storage blocked: the defaults
    return null;
  }
}

function keep(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked: kept for this visit
  }
}

function parsed(text: string | null): unknown {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

let toolSetList: ToolSetConfig[] = readToolSets(parsed(stored(SETS_KEY))) ?? defaultToolSets();
let display: ToolDisplay = readToolDisplay(stored(DISPLAY_KEY)) ?? "large";
const setListeners = new Set<() => void>();
document.documentElement.dataset.toolDisplay = display;

export function toolSets(): readonly ToolSetConfig[] {
  return toolSetList;
}

/** Puts tool sets in place (null: the defaults) and keeps them for the next visit. */
export function setToolSets(next: readonly ToolSetConfig[] | null): void {
  toolSetList = (next && readToolSets(next)) || defaultToolSets();
  const custom = toolSetChanges() !== null;
  keep(SETS_KEY, custom ? JSON.stringify(toolSetList) : null);
  for (const fn of setListeners) fn();
}

/** The tool sets when they differ from the defaults, for a workspace; null when they don't. */
export function toolSetChanges(): ToolSetConfig[] | null {
  return JSON.stringify(toolSetList) === JSON.stringify(defaultToolSets()) ? null : toolSetList.map((s) => ({ ...s, tools: [...s.tools] }));
}

export function toolDisplay(): ToolDisplay {
  return display;
}

export function setToolDisplay(next: ToolDisplay): void {
  display = next;
  document.documentElement.dataset.toolDisplay = next;
  keep(DISPLAY_KEY, next === "large" ? null : next);
}

/** The tool palettes' own title bar rows: small icons, large icons, or icons with names. */
export function toolDisplayRows(): Row[] {
  return DISPLAYS.map((d): Row => ({ label: d.label, checked: () => display === d.id, run: () => setToolDisplay(d.id) }));
}

/** A set's icon: its own for the sets openvwx starts with, else its first tool's. */
function setIcon(set: ToolSetConfig): string {
  return TOOL_SETS.find((s) => s.id === set.id)?.icon ?? TOOL_ICON[set.tools[0]];
}

/**
 * A grid of tool buttons for a tool palette; the button of the active tool is pressed. `dispose`
 * stops it following the tool and its keys, for a grid that is rebuilt.
 */
function toolGrid(tools: readonly ToolDef[], setTool: (id: ToolId) => void): { el: HTMLElement; dispose: () => void } {
  const grid = h("div", { cls: "tool-grid pal-tools", attrs: { role: "toolbar" } });
  const buttons = new Map<ToolId, HTMLButtonElement>();
  const offs: (() => void)[] = [];
  for (const t of tools) {
    if (t.separatorBefore) grid.append(h("div", { attrs: { role: "separator" } }));
    const key = h("kbd", { cls: "tool-key" });
    const btn = h(
      "button",
      { cls: "tool", attrs: { "data-tool": t.id, "aria-label": t.label } },
      h("span", { cls: "tool-icon", html: TOOL_ICON[t.id] }),
      h("span", { cls: "tool-name", text: t.label }),
      key,
    );
    const syncKey = (): void => {
      key.textContent = toolKeyLabel(t.id);
    };
    syncKey();
    screenTip(btn, () => toolScreenTip(t.id));
    offs.push(onToolKeys(syncKey));
    btn.addEventListener("click", () => {
      // so Space keeps working for panning instead of re-pressing the button
      btn.blur();
      setTool(t.id);
    });
    grid.append(btn);
    buttons.set(t.id, btn);
  }
  const sync = (): void => {
    for (const [id, btn] of buttons) {
      const on = id === store.tool;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    }
  };
  offs.push(store.on("tool", sync));
  sync();
  return { el: grid, dispose: () => offs.forEach((off) => off()) };
}

/** The Basic palette's body. */
export function basicPalette(setTool: (id: ToolId) => void): HTMLElement {
  return toolGrid(BASIC, setTool).el;
}

/** The Tool Sets palette's body: a button per set over the chosen set's tools, rebuilt when the sets are rearranged. */
export function toolSetsPalette(setTool: (id: ToolId) => void): HTMLElement {
  const root = h("div", { cls: "toolsets" });
  let current = stored(SET_KEY) ?? "";
  let grids: { el: HTMLElement; dispose: () => void }[] = [];
  let choose: (id: string) => void = () => {};
  const build = (): void => {
    for (const g of grids) g.dispose();
    const sets = toolSets();
    const byId = new Map(sets.map((s) => [s.id, toolGrid(s.tools.map((id) => toolDef(id)!), setTool)]));
    grids = [...byId.values()];
    const host = h("div");
    const setButtons = sets.map((s) => {
      const btn = h("button", {
        cls: "tool",
        html: setIcon(s),
        title: s.label,
        attrs: { type: "button", "aria-label": s.label, "data-set": s.id },
      });
      btn.addEventListener("click", () => {
        btn.blur();
        choose(s.id);
      });
      return btn;
    });
    choose = (id: string): void => {
      current = id;
      for (const btn of setButtons) {
        const on = btn.dataset.set === id;
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-pressed", String(on));
      }
      host.replaceChildren(byId.get(id)?.el ?? "");
      keep(SET_KEY, id);
    };
    root.replaceChildren(h("div", { cls: "tool-grid toolset-strip", attrs: { role: "tablist", "aria-label": "Tool sets" } }, ...setButtons), host);
    choose(sets.some((s) => s.id === current) ? current : sets[0].id);
  };
  // a set's tool chosen by its key brings the set forward
  store.on("tool", () => {
    const set = toolSets().find((s) => s.tools.includes(store.tool));
    if (set && set.id !== current) choose(set.id);
  });
  setListeners.add(build);
  build();
  return root;
}

/**
 * The Smart Options display's tools: a tab for Basic and for each tool set over the chosen one's
 * tools, opening on the set that holds the active tool; rebuilt when the sets are rearranged.
 */
export function toolPicker(setTool: (id: ToolId) => void): { el: HTMLElement; front: () => void } {
  const root = h("div", { cls: "tool-picker" });
  let grids: { el: HTMLElement; dispose: () => void }[] = [];
  let choose: (id: string) => void = () => {};
  let sets: { id: string; tools: readonly ToolId[] }[] = [];
  const build = (): void => {
    for (const g of grids) g.dispose();
    const all = [{ id: "basic", label: "Basic", tools: BASIC.map((t) => t.id) }, ...toolSets()];
    sets = all;
    const byId = new Map(all.map((s) => [s.id, toolGrid(s.tools.map((id) => toolDef(id)!), setTool)]));
    grids = [...byId.values()];
    const host = h("div");
    const tabs = all.map((s) => {
      const tab = h("button", { cls: "picker-tab", text: s.label, attrs: { type: "button", role: "tab", "data-set": s.id } });
      tab.addEventListener("click", () => choose(s.id));
      return tab;
    });
    choose = (id: string): void => {
      for (const tab of tabs) tab.setAttribute("aria-selected", String(tab.dataset.set === id));
      host.replaceChildren(byId.get(id)?.el ?? "");
    };
    root.replaceChildren(h("div", { cls: "picker-tabs", attrs: { role: "tablist", "aria-label": "Tool sets" } }, ...tabs), host);
    choose(all[0].id);
  };
  setListeners.add(build);
  build();
  // brings forward the set holding the active tool, as the display opens
  return { el: root, front: () => choose((sets.find((s) => s.tools.includes(store.tool)) ?? sets[0]).id) };
}

function label(id: ToolId): string {
  return toolDef(id)?.label ?? id;
}

/** How a tool says what to do as it starts (its Mode bar help), set by the app once its tools are made. */
let toolHelp: (id: ToolId) => string = () => "";

export function setToolHelp(help: (id: ToolId) => string): void {
  toolHelp = help;
}

/** A tool's screen tip: its name and key, the tool set it is in and how to use it. */
export function toolScreenTip(id: ToolId): ScreenTip {
  const set = BASIC.some((t) => t.id === id) ? "Basic" : toolSets().find((s) => s.tools.includes(id))?.label;
  return { title: label(id), keys: toolKeyLabel(id) || undefined, note: set ? `${set} tool set` : undefined, detail: toolHelp(id) || undefined };
}

/** A tool's menu row: its icon, name and key, ticked while it is the tool. */
function toolRow(id: ToolId, setTool: (id: ToolId) => void): Row {
  return { label: label(id), icon: TOOL_ICON[id], keys: toolKeyLabel(id) || undefined, checked: () => store.tool === id, run: () => setTool(id) };
}

/** One top bar group: the button of its current tool, and a caret dropping the group when it has more. */
function toolGroup(tools: readonly ToolId[], setTool: (id: ToolId) => void): HTMLElement {
  const key = GROUP_KEY + tools[0];
  let current = tools[0];
  try {
    const saved = localStorage.getItem(key) as ToolId | null;
    if (saved && tools.includes(saved)) current = saved;
  } catch {
    // storage blocked: the group's first tool
  }
  const btn = h("button", { cls: "tool", attrs: { type: "button" } });
  screenTip(btn, () => toolScreenTip(current));
  btn.addEventListener("click", () => {
    // so Space keeps working for panning instead of re-pressing the button
    btn.blur();
    setTool(current);
  });
  const group = h("div", { cls: tools.length > 1 ? "tb-tool has-more" : "tb-tool" }, btn);
  if (tools.length > 1) {
    const more = h("button", {
      cls: "tb-tool-more",
      html: UI_ICON.caret,
      title: "More tools",
      attrs: { type: "button", "aria-label": `More tools like ${label(tools[0])}` },
    });
    menuButton(more, () => tools.map((id) => toolRow(id, setTool)));
    group.append(more);
  }
  const sync = (): void => {
    if (tools.includes(store.tool) && store.tool !== current) {
      current = store.tool;
      try {
        localStorage.setItem(key, current);
      } catch {
        // storage blocked: the choice lasts for this visit
      }
    }
    const on = store.tool === current;
    btn.innerHTML = TOOL_ICON[current];
    btn.setAttribute("aria-label", label(current));
    btn.setAttribute("aria-pressed", String(on));
    group.classList.toggle("active", on);
  };
  store.on("tool", sync);
  onToolKeys(sync);
  sync();
  return group;
}

/** The top bar's tools, in groups, and the Tool sets button after them. */
function mountTools(setTool: (id: ToolId) => void): void {
  const row = byId("tb-tools");
  row.append(...TOP_GROUPS.map((g) => (g === "-" ? h("div", { cls: "tb-sep", attrs: { role: "separator" } }) : toolGroup(g, setTool))));
  scrollTools(row);
  mountToolSets(setTool);
}

/**
 * The tool row scrolls where it is too wide for the room between the bar's ends, or for a phone's
 * bar along the bottom. Its edges fade where more tools lie beyond them (the classes set the fades'
 * width in styles.css), the scroll buttons either side of it show, each greyed out once the row is
 * at its end (styles.css leaves them out for a finger, which swipes), and the active tool is
 * brought into view when it changes. Where the row fits, none of this shows.
 */
function scrollTools(row: HTMLElement): void {
  const back = byId<HTMLButtonElement>("btn-tools-back");
  const ahead = byId<HTMLButtonElement>("btn-tools-ahead");
  back.innerHTML = CHEVRON_LEFT;
  ahead.innerHTML = CHEVRON_RIGHT;
  for (const [button, sign] of [[back, -1], [ahead, 1]] as const) {
    button.addEventListener("click", () => {
      // so Space keeps working for panning instead of re-pressing the button
      button.blur();
      row.scrollBy({ left: sign * row.clientWidth * 0.8, behavior: "smooth" });
    });
  }
  const fades = (): void => {
    const start = row.scrollLeft > 1;
    const end = row.scrollLeft < row.scrollWidth - row.clientWidth - 1;
    row.classList.toggle("more-start", start);
    row.classList.toggle("more-end", end);
    back.disabled = !start;
    ahead.disabled = !end;
  };
  // whether the row overflows is measured without the scroll buttons, as their room may be all it lacks
  const fit = (): void => {
    back.hidden = true;
    ahead.hidden = true;
    const scrolls = row.scrollWidth > row.clientWidth + 1;
    back.hidden = !scrolls;
    ahead.hidden = !scrolls;
    fades();
  };
  row.addEventListener("scroll", fades, { passive: true });
  // a frame later, as showing or hiding the scroll buttons resizes the row again
  new ResizeObserver(() => requestAnimationFrame(fit)).observe(row);
  // after the groups have shown the active one, so it is the one to bring in
  store.on("tool", () => {
    const on = row.querySelector<HTMLElement>(".tb-tool.active");
    if (!on) return;
    const box = row.getBoundingClientRect();
    const r = on.getBoundingClientRect();
    if (r.left < box.left + 8 || r.right > box.right - 8) {
      row.scrollTo({ left: row.scrollLeft + (r.left + r.width / 2) - (box.left + box.width / 2), behavior: "smooth" });
    }
  });
  fit();
}

/**
 * The Tool sets button at the tool row's end: a submenu per tool set, as Window > Workspaces >
 * Tool Sets… arranges them, each tool with its icon and key, and a row that opens the Tool Sets
 * palette. It is pressed while the tool is one that only the tool sets hold.
 */
function mountToolSets(setTool: (id: ToolId) => void): void {
  const btn = byId<HTMLButtonElement>("btn-toolsets");
  btn.innerHTML = `${PALETTE_ICON.toolSets}${UI_ICON.caret}`;
  menuButton(btn, () => [
    ...toolSets().map((set): Row => ({ label: set.label, icon: setIcon(set), items: set.tools.map((id) => toolRow(id, setTool)) })),
    "-",
    { label: "Show Tool Sets Palette", run: () => appContext()?.palettes.show("toolsets") },
  ]);
  const sync = (): void => {
    btn.classList.toggle("active", !IN_TOP_BAR.has(store.tool) && toolSets().some((s) => s.tools.includes(store.tool)));
  };
  store.on("tool", sync);
  setListeners.add(sync);
  sync();
}

/** The caret's chevron, down. */
const CHEVRON = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** The tool row's scroll buttons' chevrons, left and right. */
const CHEVRON_LEFT = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 3 4.5 6 7.5 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHEVRON_RIGHT = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3 7.5 6 4.5 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** A file's name without its extension: a short one with a letter in it, so "Plan 2.1" keeps its ".1". */
function baseName(name: string): string {
  return name.replace(/\.(?=[a-z0-9]*[a-z])[a-z0-9]{1,5}$/i, "");
}

/**
 * The rows of Save's caret, read as it opens: the File menu's save rows, then its export, share
 * and print rows, with a separator between the groups. A row the File menu lacks is left out.
 */
function saveCaretRows(): Row[] {
  const rows = allMenus().find((m) => m.title === "File")?.rows ?? [];
  const pick = (label: string): Row | undefined => rows.find((r): r is Item => r !== "-" && r.label === label);
  const groups: (Row | undefined)[][] = [
    ["Save", "Save As…", "Save to Cloud…", "Save to Google Drive…", "Save to OneDrive…"].map(pick),
    [pick("Export"), pick("Share…"), pick("Publish…"), pick("Print…")],
  ];
  const out: Row[] = [];
  for (const group of groups) {
    const found = group.filter((r): r is Row => r !== undefined);
    if (found.length === 0) continue;
    if (out.length > 0) out.push("-");
    out.push(...found);
  }
  return out;
}

/** The top bar: the file's name and whether it has unsaved changes, the tools, and Save with its menu. */
export function mountTopBar(actions: ToolbarActions, setTool: (id: ToolId) => void): void {
  mountTools(setTool);
  const save = byId<HTMLButtonElement>("btn-save");
  save.addEventListener("click", () => {
    save.blur();
    actions.save();
  });
  const saveMore = byId<HTMLButtonElement>("btn-save-menu");
  saveMore.innerHTML = CHEVRON;
  menuButton(saveMore, saveCaretRows);

  const sync = (): void => {
    const s = store.session;
    const name = byId("file-name");
    name.textContent = s ? baseName(store.fileName) : "Rodeo";
    name.title = s ? store.fileName : "";
    byId("dirty-dot").hidden = !(s && s.dirty);
    save.disabled = !s;
    saveMore.disabled = !s;
    document.title = s ? `${store.fileName} · Rodeo` : "Rodeo";
  };
  store.on(["session", "file"], sync);
  sync();
}
