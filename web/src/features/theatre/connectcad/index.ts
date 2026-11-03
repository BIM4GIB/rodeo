// Joins the Stage menu's ConnectCAD section: Connect Selected, Number Cables, Clear Cable Numbers and
// Renumber ConnectCAD Objects (dialogs.ts), Combine and Split Panels (schematic.ts), Check Drawing
// and Clear Markup (markup.ts), the ConnectCAD Status palette (statusPalette.ts), Calculate Cable Lengths (cableLengths.ts), the report worksheets (reports.ts), the cable list commands
// (lists.ts), and the ConnectCAD Schematics tools (tools.ts), which make the devices (distribution
// amplifiers and panels among them) and circuits of schematic.ts and the legend of legend.ts; and the
// ConnectCAD Layout section: Create Equipment (createEquipment.ts), and Create Rack Elevation and Create
// Equipment Detail View (rackElevation.ts), with the layout tools (layoutTools.ts),
// and the ConnectCAD Cable Route tools (cableRouteTools.ts), which draw cable paths and drop points (cableRoute.ts),
// with Analyze Cable Routes and the Edit Cabling tool (cableAnalysis.ts) and Create Riser Sheet and
// Create Cabling Sheet (cableSheets.ts); and connector panel layouts, made by Create Panel View
// (panelLayout.ts) and the Panel Connector tool (panelTools.ts); and Create Labels (labels.ts), with the
// Color-Coded Linked Text and Linked QR Code tools (labelTools.ts); and ConnectCAD Settings (settings.ts),
// the drawing's defaults for all of these; and the Device Builder tool (builder.ts).

import type { EditSession } from "../../../core/index.ts";
import { attempt, setEditGroup } from "../../../app/commands.ts";
import { store } from "../../../app/state.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import { addStageRows, addStageTools } from "../registry.ts";
import { clearCableNumbers, connectSelected, editDeviceArray, editSockets, numberCables, renumberObjects } from "./dialogs.ts";
import { checkDrawing, clearMarkup } from "./markup.ts";
import { openConnectcadStatus } from "./statusPalette.ts";
import { circuitReport, connectionsReport, deviceReport, partsReport } from "./reports.ts";
import { calculateCableLengths } from "./cableLengths.ts";
import { compareCableList, convertReportToList, createDevicesFromWorksheet, makeConnectionsFromList } from "./lists.ts";
import { createEquipment } from "./createEquipment.ts";
import { DeviceBuilderTool } from "./builder.ts";
import { connectcadSettings } from "./settings.ts";
import { combinePanels, deviceArrayEditor, socketEditor, splitPanels } from "./schematic.ts";
import { AdapterSlotTool, EquipmentItemTool, EquipmentRackTool, LayoutRoomTool, RackFrameTool, RackWorksheetTool } from "./layoutTools.ts";
import "./layoutRoom.ts";
import "./equipmentRack.ts";
import "./equipmentItem.ts";
import "./cableRoute.ts";
import { CableRouteTool, DropPointTool } from "./cableRouteTools.ts";
import { analyzeCableRoutes, cablePullReport, EditCablingTool } from "./cableAnalysis.ts";
import { createCablingSheet, createRiserSheet } from "./cableSheets.ts";
import { createPanelView } from "./panelLayout.ts";
import { createEquipmentDetailView, createRackElevation } from "./rackElevation.ts";
import { PanelConnectorTool } from "./panelTools.ts";
import { createLabels } from "./labels.ts";
import { ColorCodedTextTool, LinkedQrTool } from "./labelTools.ts";
import { AdapterTool, ConnectorPanelTool, ConnectTool, DeviceTool, ReRouteTool, DistributionAmpTool, ExternalTool, JackfieldTool, LinkedJackfieldTool, TermPanelTool, LegendTool, SocketLoopTool, SocketTool, TerminatorTool } from "./tools.ts";

const open = (): boolean => store.session !== null;
const run = (job: () => Promise<void>) => () => void job().catch((err: unknown) => toast(errorMessage(err)));

socketEditor.open = (deviceId, socketId) => void editSockets(deviceId, socketId).catch((err: unknown) => toast(errorMessage(err)));
deviceArrayEditor.open = (deviceId) => void editDeviceArray(deviceId).catch((err: unknown) => toast(errorMessage(err)));

const selection = (): boolean => open() && store.selection.size > 0;

/** Combine Panels or Split Panels on the selection, the devices made selected. */
function panelCommand(label: string, job: (s: EditSession, ids: readonly string[]) => string[]): void {
  const r = attempt(label, (s) => s.batch(() => job(s, [...store.selection])));
  if (r) setEditGroup(null, r.value);
}

addStageRows("ConnectCAD", () => [
  { label: "ConnectCAD Settings…", enabled: open, run: run(connectcadSettings) },
  "-",
  { label: "Connect Selected", enabled: selection, run: connectSelected },
  { label: "Check Drawing…", enabled: open, run: run(checkDrawing) },
  { label: "ConnectCAD Status", enabled: open, run: openConnectcadStatus },
  { label: "Clear Markup", enabled: open, run: clearMarkup },
  "-",
  { label: "Number Cables…", enabled: open, run: run(numberCables) },
  { label: "Clear Cable Numbers", enabled: open, run: run(clearCableNumbers) },
  { label: "Renumber ConnectCAD Objects…", enabled: selection, run: run(renumberObjects) },
  { label: "Combine Panels", enabled: selection, run: () => panelCommand("Combine Panels", combinePanels) },
  { label: "Split Panels", enabled: selection, run: () => panelCommand("Split Panels", splitPanels) },
  "-",
  { label: "Calculate Cable Lengths…", enabled: open, run: run(calculateCableLengths) },
  { label: "Analyze Cable Routes", enabled: open, run: run(analyzeCableRoutes) },
  { label: "Create Riser Sheet…", enabled: open, run: run(createRiserSheet) },
  { label: "Create Cabling Sheet…", enabled: open, run: run(createCablingSheet) },
  { label: "Create Panel View…", enabled: open, run: run(createPanelView) },
  { label: "Current Layer Circuit Report", enabled: open, run: run(() => circuitReport(true)) },
  { label: "All Layers Circuit Report", enabled: open, run: run(() => circuitReport(false)) },
  { label: "Current Layer Device Report", enabled: open, run: run(deviceReport) },
  { label: "Device Connections Report", enabled: open, run: run(connectionsReport) },
  { label: "ConnectCAD Parts Report", enabled: open, run: run(partsReport) },
  { label: "Cable Pull Report", enabled: open, run: run(cablePullReport) },
  { label: "Create Labels…", enabled: open, run: run(createLabels) },
  "-",
  { label: "Convert Report to List…", enabled: open, run: run(convertReportToList) },
  { label: "Compare Cable List and Drawing…", enabled: open, run: run(compareCableList) },
  { label: "Make Connections from List…", enabled: open, run: run(makeConnectionsFromList) },
  { label: "Create Devices from Worksheet…", enabled: open, run: run(createDevicesFromWorksheet) },
]);

addStageRows("ConnectCAD Layout", () => [
  { label: "Create Equipment…", enabled: open, run: run(createEquipment) },
  { label: "Create Rack Elevation…", enabled: selection, run: run(createRackElevation) },
  { label: "Create Equipment Detail View…", enabled: selection, run: run(createEquipmentDetailView) },
]);

addStageTools((env) => [new DeviceTool(env), new DeviceBuilderTool(env), new ExternalTool(env), new DistributionAmpTool(env), new TermPanelTool(env), new JackfieldTool(env), new LinkedJackfieldTool(env), new ConnectorPanelTool(env), new AdapterTool(env), new SocketTool(env), new SocketLoopTool(env), new TerminatorTool(env), new ConnectTool(env), new ReRouteTool(env), new LegendTool(env), new LayoutRoomTool(env), new EquipmentRackTool(env), new EquipmentItemTool(env), new RackFrameTool(env), new AdapterSlotTool(env), new RackWorksheetTool(env), new PanelConnectorTool(env), new ColorCodedTextTool(env), new LinkedQrTool(env), new CableRouteTool(env), new DropPointTool(env), new EditCablingTool(env)]);
