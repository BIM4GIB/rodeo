// Composition root: owns the session lifecycle (open, change, save, export),
// builds the tools, renderer and panels, and wires global listeners.

import { PLAN_VIEW, blobSource, bytesSource, openVwxStream, setTurnSteps, withHeldImages, type ChangeEvent, type EditSession, type LayerView } from "../core/index.ts";
import { blankDrawing } from "../core/blank.ts";
import { exportDxf as toDxf } from "../export/dxf.ts";
import { pageEmf } from "../export/emf.ts";
import { pageEps } from "../export/eps.ts";
import { layersPage, paperScale, exportPdf as toPdf, type DrawnPage } from "../export/pdf.ts";
import { exportSvg as toSvg } from "../export/svg.ts";
import { exportIfc } from "../export/ifc.ts";
import { exportGlb, exportObj, MODEL_FORMAT_NAMES, type ModelFormat } from "../export/model3d.ts";
import { export3ds } from "../export/threeds.ts";
import { attempt, reconcile, setActiveLayer, setSelection, zoomBy, zoomToSelection } from "./commands.ts";
import { flatOf, modelOf } from "../export/scene3d.ts";
import { rhinoLib } from "../import/rhino3dm.ts";
import { Palettes } from "./dock.ts";
import { byId, nextPaint, nextTask } from "./dom.ts";
import { chooseSaveTarget, downloadBlob, installFileDrop, pickFile } from "./fileio.ts";
import { inflater } from "./inflate.ts";
import { documentBlob, documentBytes, holdOptions, saveSnapshot, writeToFile } from "./writeOut.ts";
import { floating3d, mountFloatingPanes, redrawFloating, type PlanAt } from "./floatingPanes.ts";
import { createSymbolDialog, duplicateArrayDialog } from "./arrayDialog.ts";
import { installAutosave } from "./autosave.ts";
import { type RecentEntry, loadRecent, openRecentEntry, rememberRecent } from "./recent.ts";
import { note, reportFailure } from "./reports.ts";
import { askPdfOptions, printPdf } from "./exportDialog.ts";
import { importDroppedDwg, importDroppedDxf, importDwgFile, importDxfFile, openDwgBytes } from "./dxfImport.ts";
import { installCrosshair } from "./crosshair.ts";
import { drawRulers, installRulers } from "./rulers.ts";
import { drawOriginMarker } from "./origin.ts";
import { installAppearance } from "./appearance.ts";
import { glide, stopGlide } from "./glide.ts";
import { syncPlanRotation } from "./planRotation.ts";
import { keep3d, last3d, onPrefs, prefs, TURN_STEPS } from "./prefs.ts";
import { showLoading, slowLoading } from "./loading.ts";
import { exportImageFile } from "./pngExport.ts";
import { publishDialog } from "./publish.ts";
import { importImageFiles, importImages, isImageName } from "./imageImport.ts";
import { pasteAsBitmap } from "./images.ts";
import { PALETTE_ICON } from "./icons.ts";
import { exportAdvice, importMesh, importMeshFile, meshFormat } from "./meshImport.ts";
import { revitModelDrawing, revitSummary, showRevitFile } from "./revitFile.ts";
import type { RevitDrawing } from "./revitImport.ts";
import { isRevitModelName, isRevitName } from "../import/rvt.ts";
import type { ArchicadDrawing } from "./archicadImport.ts";
import { archicadModelDrawing, archicadSummary, isArchicadName } from "./plnImport.ts";
import { importWorksheet, isWorksheetFile } from "./worksheetImport.ts";
import { importShapefileFiles } from "./shapefileImport.ts";
import { canCut2DSection, cut2DSection, cut3DSection } from "./cutSection.ts";
import { SectionTool } from "./tools/section.ts";
import { HatchTool } from "./tools/hatch.ts";
import { saveViewDialog } from "./saveView.ts";
import { PlaceAtTool } from "./tools/placeAt.ts";
import { AddDimensionsTool } from "./tools/addDimensions.ts";
import { RotatePlanTool } from "./tools/rotatePlan.ts";
import { DividingTool } from "./tools/dividing.ts";
import { AlignLeadersTool } from "./tools/alignLeaders.ts";
import { Rotate3DCentreTool } from "./tools/rotate3dCentre.ts";
import { RoofFaceAxisTool } from "./tools/roofFaceAxis.ts";
import { RenderBitmapTool } from "./tools/renderBitmap.ts";
import { roofFaceDialog } from "./roofFace.ts";
import { startDividingLines } from "./dividingLines.ts";
import { startAlignLeaders } from "./leaderLines.ts";
import { rotate3DDialog } from "./rotate3d.ts";
import { chooseHatch } from "./hatchCommand.ts";
import { coincidentAt, installCoincidentKey } from "./coincident.ts";
import { exportStlDialog } from "./stlExport.ts";
import { exportKmlDialog } from "./kmlExport.ts";
import { exportUsdDialog } from "./usdExport.ts";
import { importPdf, importPdfFile } from "./pdfImport.ts";
import { importMetafile, importMetafileFile, isMetafile } from "./emfImport.ts";
import { openContextMenu } from "./menu.ts";
import { confirmDialog, mountMenuBar } from "./menubar.ts";
import { drawingRows, mountDocTabs, type DocTab, type DocTabActions } from "./docTabs.ts";
import { mountMenuStrip } from "./menuStrip.ts";
import { mountPanels } from "./panels/navigation.ts";
import { resourceViewRows, symbolNameOf } from "./panels/resources.ts";
import { attributeUtilityRows } from "./attributeCommands.ts";
import { snappingPalette } from "./panels/snapping.ts";
import { workingPlanesPalette } from "./workingPlanes.ts";
import { visualizationPalette } from "./panels/visualization.ts";
import { Renderer } from "./renderer.ts";
import { Scene } from "./scene.ts";
import { installShortcuts } from "./shortcuts.ts";
import { installSmartOptions, openSmartOptions } from "./smartOptions.ts";
import { Snapper } from "./snap.ts";
import { setViz, store, type ToolId } from "./state.ts";
import { mountSymbolBar, registerSymbolEditor } from "./symbolEdit.ts";
import { mountGroupBar } from "./exitGroup.ts";
import { mountStatusBar } from "./statusbar.ts";
import { mountViewControl } from "./viewControl.ts";
import { installTheme } from "./theme.ts";
import { errorMessage, toast } from "./toast.ts";
import { basicPalette, mountTopBar, setToolHelp, toolDisplayRows, toolSetsPalette } from "./toolbar.ts";
import { toolSetsDialog } from "./toolSetsDialog.ts";
import { PanTool, ToolController, type ToolEnv, type ToolOverlay } from "./tools.ts";
import { SelectTool, forceSelect, forceSelectTarget, selectForMenu } from "./tools/select.ts";
import { hiddenObjects, onHiddenChange, withoutHidden } from "./hiddenObjects.ts";
import { mountUnhideButton } from "./objectVisibility.ts";
import { CircleTool, LineTool, RectTool, RoundRectTool } from "./tools/draw.ts";
import { ParkingAlongPathTool, ParkingAreaTool, RailingTool, StakeTool } from "./tools/paths.ts";
import { FenceTool } from "./tools/fence.ts";
import { CurbTool } from "./tools/curb.ts";
import { ExistingTreeTool } from "./tools/existingTree.ts";
import { ParkingSpacesTool } from "./tools/parkingSpaces.ts";
import { HedgerowTool } from "./tools/hedgerow.ts";
import { GradeTool } from "./tools/grade.ts";
import { VisualZoneTool } from "./tools/visualZone.ts";
import { SiteContourTool } from "./tools/siteContour.ts";
import { MassingModelTool } from "./tools/massingModel.ts";
import { SiteLabelTool } from "./tools/siteLabels.ts";
import { SiteSculptTool } from "./tools/siteSculpt.ts";
import { SiteModifierTool } from "./tools/siteModifier.ts";
import { PipingRunTool } from "./tools/piping.ts";
import { HvacStraightDuctTool, HvacElbowTool, HvacFlexDuctTool, HvacVerticalDuctTool, HvacTransitionTool, HvacSplitterTool, HvacDamperTool, HvacDiffuserTool, HvacOutletTool } from "./tools/hvac.ts";
import { GisStakeTool, GraticuleTool, GreatCircleTool, SurveyPointTool } from "./tools/gis.ts";
import { AdjacencyMatrixTool, AdjacencyScoreTool, SpaceLinkTool, StackingDiagramTool } from "./tools/adjacency.ts";
import { SpaceTool } from "./tools/space.ts";
import { QuarterArcTool } from "./tools/quarterArc.ts";
import { RoadCurvedTool, RoadPolyTool, RoadStraightTool, RoadTeeTool } from "./tools/roads.ts";
import { RopeStanchionTool, StageDeckTool, StagePlugTool, StageRampTool, StageStepsTool } from "./tools/stage.ts";
import { BlendedScreenTool, LedScreenTool, SoftGoodsTool, SpeakerArrayTool, SpeakerTool, TelevisionTool, VideoScreenTool } from "./tools/screens.ts";
import { RackRulerTool } from "./tools/rackRuler.ts";
import { TriangleTool } from "./tools/triangle.ts";
import { PolygonTool, PolylineTool } from "./tools/poly.ts";
import { TextEditor, TextTool } from "./tools/text.ts";
import { ArcTool } from "./tools/arc.ts";
import { EyedropperTool } from "./tools/eyedropper.ts";
import { AttributeMappingTool } from "./tools/attrmap.ts";
import { FilletTool } from "./tools/fillet.ts";
import { MeasureTool } from "./tools/measure.ts";
import { CommDeviceTool, IncandescentFixtureTool, ReceptacleTool, SwitchTool } from "./tools/mep.ts";
import { ControllerTool, DesignZoneTool, DripOutletTool, HydrozoneTool, IrrigationPipeTool, OutletTool, PointOfConnectionTool, SystemComponentTool, ValveTool } from "./tools/irrigation.ts";
import { CablePathTool, CableTool } from "./tools/cables.ts";
import { HopOverTool } from "./tools/hopOver.ts";
import { CountertopTool, FocusPointTool } from "./tools/fixtures.ts";
import { AlignDistributeTool } from "./tools/alignDistribute.ts";
import { BridleTool, CurvedTrussTool, HoistOriginTool, HoistTool, LightingPipeTool, MotherGridTool, PipeLadderTool, RiggingLoadTool, RiggingPointTool, StraightTrussTool } from "./tools/rigging.ts";
import { DimensionTapeTool } from "./tools/dimTape.ts";
import { HoleNoteTool } from "./tools/holeNote.ts";
import { ProtractorTool } from "./tools/protractor.ts";
import { VisibilityTool } from "./tools/visibility.ts";
import { SelectSimilarTool } from "./tools/similar.ts";
import { OffsetTool } from "./tools/offset.ts";
import { SymbolTool } from "./tools/symbol.ts";
import { LightTool } from "./tools/light.ts";
import { CameraTool } from "./tools/camera.ts";
import { FlyoverTool, navigationFor, onShow3d, TranslateViewTool, WalkthroughTool } from "./tools/navigate3d.ts";
import { HeliodonTool } from "./tools/heliodon.ts";
import { WallTool } from "./tools/wall.ts";
import { SlabTool } from "./tools/slab.ts";
import { WallJoinTool } from "./tools/walljoin.ts";
import { PluginInsertTool } from "./tools/pluginInsert.ts";
import { WallInsertTool } from "./tools/wallInsert.ts";
import { LocusTool } from "./tools/locus.ts";
import { ChamferTool } from "./tools/chamfer.ts";
import { ClipTool } from "./tools/clip.ts";
import { FixedPointResizeTool, ShearTool } from "./tools/fixedPoint.ts";
import { ReshapeTool } from "./tools/reshape.ts";
import { ConnectTool } from "./tools/connect.ts";
import { DoubleLinePolygonTool, DoubleLineTool } from "./tools/doubleline.ts";
import { FreehandTool } from "./tools/freehand.ts";
import { MoveByPointsTool } from "./tools/moveby.ts";
import { OvalTool } from "./tools/oval.ts";
import { RegularPolygonTool } from "./tools/regpoly.ts";
import { SpiralTool } from "./tools/spiral.ts";
import { ZoomTool } from "./tools/zoom.ts";
import { ConeTool, ExtrudedPolygonTool, ExtrudedRectTool, HemisphereTool, SphereTool } from "./tools/solids.ts";
import { ArcLengthTool, DimensionTool } from "./tools/dimension.ts";
import { CalloutTool } from "./tools/callout.ts";
import { LeaderLineSimpleTool, LeaderLineTool } from "./tools/leader.ts";
import { SectionLineTool } from "./tools/sectionLine.ts";
import { HyperlinkTool } from "./tools/hyperlink.ts";
import { PhotoGridTool, PhotometerTool } from "./tools/photometer.ts";
import { VideoCameraTool } from "./tools/videoCamera.ts";
import { ChainExtrudeTool } from "./tools/chainExtrude.ts";
import { EquipmentKeyTool } from "./tools/equipmentKey.ts";
import { FocusAlongPathTool } from "./tools/focusAlongPath.ts";
import { DeformTool, mountDeformBar } from "./tools/deform.ts";
import { ExtractTool, mountExtractBar } from "./tools/extract.ts";
import { mountProjectBar, ProjectTool } from "./tools/project.ts";
import { AnalysisTool, mountAnalysisBar } from "./tools/analysis.ts";
import { LoftSurfaceTool, mountLoftBar } from "./tools/loftSurface.ts";
import { AlignPlaneTool, mountAlignPlaneBar } from "./tools/alignPlane.ts";
import { mountPushPullBar, OffsetEdgeTool, PushPullTool } from "./tools/pushPull.ts";
import { Locus3DTool, mountLocus3d } from "./tools/locus3d.ts";
import { mountPoly3dBar, Poly3DTool } from "./tools/poly3d.ts";
import { ChamferEdgeTool, FilletEdgeTool, mountSolidEditBar, ShellSolidTool, TaperFaceTool } from "./tools/solidEdit.ts";
import { RevisionCloudTool } from "./tools/cloud.ts";
import { WeldingSymbolTool } from "./tools/welding.ts";
import {
  BenchmarkTool,
  CenterMarkTool,
  DataTagTool,
  DetailCalloutTool,
  DrawingLabelTool,
  FeatureControlFrameTool,
  InteriorElevationTool,
  LegendTool,
  NorthArrowTool,
  ScaleBarTool,
  SectionMarkerTool,
  SlopeDimensionTool,
  SymmetryLabelTool,
} from "./tools/markers.ts";
import { FramingMemberTool } from "./tools/framing.ts";
import { StructuralMemberTool } from "./tools/members.ts";
import { LinearMaterialTool } from "./tools/linearMaterial.ts";
import { AnchorTool, BoltTool, BreakLineTool, InsulationTool, LumberTool, NailTool, PlantTool, RepetitiveUnitTool, ScrewTool, SteelSectionTool, Steel3DTool, StippleTool, WeldTool } from "./tools/detailing.ts";
import { BulbFlatTool, ShaftBreak2Tool, ShaftBreakTool } from "./tools/structural.ts";
import { GridLineTool, ReferenceMarkerTool } from "./tools/references.ts";
import { GeneralNotesTool, RedlineTool } from "./tools/notes.ts";
import { TitleBlockBorderTool } from "./tools/sheetBorder.ts";
import { LightingDeviceTool } from "./tools/lightingDevice.ts";
import { GangingTool } from "./tools/ganging.ts";
import { LightingAccessoryTool } from "./tools/lightingAccessory.ts";
import { StageOriginTool } from "../features/theatre/stageTool.ts";
import { DistributorTool, ElectricalComponentTool } from "./tools/power.ts";
import { ElevatorTool, EscalatorTool, RampTool, SimpleStairTool } from "./tools/circulation.ts";
import { CotterPin3DTool, WingNutDin3DTool, WingNutA3DTool, WingNutB3DTool, WingNutC3DTool, WingNutD3DTool, RetainingRingAsme3DTool, RetainingRingDin3DTool, RetainingWasherDin3DTool, EyeBolt3DTool, SwingBolt3DTool, SwingEyeBolt3DTool, TBolt3DTool, UBolt3DTool, JBolt3DTool, ThumbScrew3DTool, CarriageBolt3DTool, LagScrew3DTool, WoodScrew3DTool, SheetMetalScrew3DTool, BoltAndNutInchTool, BoltAndNutMmTool, AcornNut3DTool, AcornNutTool, ClevisPinInch3DTool, ClevisPinMetric3DTool, ClevisPinDin3DTool, DowelPin3DTool, ParallelPin3DTool, TaperPinInch3DTool, TaperPinDin3DTool, LargeRivet3DTool, SmallRivet3DTool, RivetDin3DTool, TubularRivet3DTool, HexCapNut3DTool, KnurledNutDin3DTool, KnurledNutInch3DTool, CarriageBoltTool, ClevisPinDinTool, ClevisPinInchTool, ClevisPinMetricTool, CotterPinTool, DowelPinTool, EyeBoltTool, FastenerTool, HexCapNutTool, JBoltTool, KnurledNutDinTool, KnurledNutInchTool, LagScrewTool, LargeRivetTool, ParallelPinTool, RetainingRingAsmeTool, RetainingRingDinTool, RetainingWasherDinTool, RivetDinTool, SheetMetalScrewTool, SmallRivetTool, SwingBoltTool, SwingEyeBoltTool, TaperPinDinTool, TaperPinInchTool, TBoltTool, ThumbScrewTool, TubularRivetTool, UBoltTool, WingNutATool, WingNutBTool, WingNutCTool, WingNutDTool, WingNutDinTool, WoodScrewTool } from "./tools/fasteners.ts";
import { DrilledHole3DTool, TappedMm3DTool, TappedIn3DTool, SpurGear3DTool, GearRack3DTool, Sprocket3DTool, LinearChain3DTool, CircularChain3DTool, OffsetLink3DTool, Pulley3DTool, BevelGear3DTool, Worm3DTool, WormGear3DTool, Key3DTool, WoodruffKey3DTool, Shaft3DTool, BallBearing3DTool, RollerBearing3DTool, NeedleBearing3DTool, TaperedBearing3DTool, ThrustBearing3DTool, LockNut3DTool, PillowBlock3DTool, FlangedBearing23DTool, FlangedBearing43DTool, CompressionSpring13DTool, CompressionSpring23DTool, ConicalSpring3DTool, DieSpring3DTool, ExtensionSpring3DTool, TorsionSpring3DTool, BellevilleSpring3DTool, BallBearingTool, DrilledHoleTool, CircularChainTool, GearRackTool, HolePatternTool, LinearChainTool, KeywayTool, NeedleBearingTool, RollerBearingTool, TaperedBearingTool, ThrustBearingTool, LockNutTool, OffsetLinkTool, BevelGearTool, WormTool, WormGearTool, ShaftTool, PillowBlockTool, FlangedBearing2Tool, FlangedBearing4Tool, PulleyTool, KeyTool, WoodruffKeyTool, CompressionSpring1Tool, CompressionSpring2Tool, ConicalSpringTool, DieSpringTool, ExtensionSpringFrontTool, ExtensionSpringEndTool, TorsionSpringFrontTool, TorsionSpringEndTool, BellevilleSpringTool, ScrewThreadTool, SlotTool, SprocketTool, SpurGearTool, TappedHoleTool } from "./tools/machine.ts";
import {
  BathShowerTool,
  CabinetTool,
  CompartmentSinkTool,
  CustomCabinetTool,
  CeilingGridTool,
  ClothesRodTool,
  DeskTool,
  FireplaceTool,
  GrabBarTool,
  SeatingSectionTool,
  ShelvingTool,
  TableChairsTool,
  ToiletStallTool,
} from "./tools/planning.ts";
import { ColumnTool, HardscapeTool, LandscapeAreaTool, ParkingTool, PilasterTool, PropertyLineTool, StairTool } from "./tools/site.ts";
import { SplitTool } from "./tools/split.ts";
import { TrimTool } from "./tools/trim.ts";
import { MirrorTool } from "./tools/mirror.ts";
import { RotateTool } from "./tools/rotate.ts";
import { View } from "./view.ts";
import { installViewHistory } from "./viewHistory.ts";
import {
  livePane,
  livePlanPane,
  mountPanes,
  multiPane,
  onPanes,
  onPanesReset,
  paneCount,
  paneKind,
  pictureOf,
  setLivePane,
  setLivePlanPane,
  setPaneKind,
  setPaneLayout,
  startView,
  type PaneKind,
} from "./viewPanes.ts";
import { mountModeBar, mountViewBar } from "./viewbar.ts";
import type { CameraState, PaneLook, RenderMode, View3D, ViewPreset } from "./view3d.ts";
import { mountWelcome, recentSource } from "./welcome.ts";
import {
  appStarted,
  documentChanged,
  documentSource,
  editMade,
  extensionPalettes,
  fileIn,
  leaveRefusal,
  mountExtensionChrome,
  readOnlySession,
  registerOverlay,
  view3dCreated,
  type DocumentSource,
} from "./ext.ts";

/** quiet time after an edit before the 3D model is rebuilt */
const REBUILD_3D_DELAY_MS = 400;
/** how long the panes' pictures wait for a pause in changes before they are drawn again */
const PICTURE_DELAY_MS = 120;
/** what a plan pane's picture draws besides the drawing: no tool's marks */
const PICTURE_OVERLAY: ToolOverlay = { moveDelta: () => null, fillPreview: () => null, drawOverlay: () => {} };

function baseName(fileName: string): string {
  return fileName.replace(/\.(vwx|sta)$/i, "");
}

/** What came of opening a drawing: open, cancelled (or refused, or open already), or the error the user was told. */
type Opened = "open" | "cancelled" | { readonly error: string };

/** Tells the features of a file the user gave, once it has opened or could not (ext.ts fileIn). */
function tellFileIn(file: Blob | Uint8Array, name: string, opened: Opened): void {
  if (opened === "open") fileIn(file, name);
  else if (opened !== "cancelled") fileIn(file, name, opened.error);
}

/** the regions that measure in feet and inches */
const IMPERIAL_REGIONS = new Set(["US", "LR", "MM"]);

/** Whether this browser's language names a region that measures in feet and inches (en-US does). */
function imperialRegion(): boolean {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return region !== undefined && IMPERIAL_REGIONS.has(region);
  } catch {
    // an unparsable language tag: millimetres
    return false;
  }
}

/** Vectorworks' render mode numbers (a design layer's saved view) for the 3D view's modes, and back */
const CODE_OF_MODE: Record<RenderMode, number> = { wireframe: 0, hidden: 6, dashed: 7, sketch: 6, shaded: 11, textured: 11, realistic: 11, pathtraced: 11 };
const MODE_OF_CODE = new Map<number, RenderMode>([
  [0, "wireframe"],
  [6, "hidden"],
  [7, "dashed"],
  [11, "shaded"],
]);

/**
 * A drawing open in a tab, and what the window showed of it when another tab came to the front:
 * it comes back as it was left. The front drawing's live state is in the store (sync() copies it
 * here).
 */
interface OpenDrawing {
  session: EditSession;
  name: string;
  handle: FileSystemFileHandle | null;
  readonly source: DocumentSource | null;
  fileSize: number;
  untitled: boolean;
  overwriteConfirmed: boolean;
  layerId: string | null;
  /** null until it has been in front: the class active then carries over */
  classIndex: number | null;
  selection: ReadonlySet<string>;
  /** null until it has been in front: it opens fitted */
  view: { cx: number; cy: number; scale: number } | null;
}

/** Tools a command takes up for its clicks: each hands back to the tool used before the command. */
const CLICK_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(["hatch", "dividing", "alignleaders", "rotate3dcentre", "roofaxis"]);

export class App {
  readonly view = new View();
  readonly scene = new Scene();
  readonly snap = new Snapper(this.scene);
  private readonly canvas = byId<HTMLCanvasElement>("canvas");
  private readonly text: TextEditor;
  private readonly controller: ToolController;
  /** the tool Cut 2D and 3D Section hand back to, and which of them the clicks are for */
  private sectionFrom: ToolId = "select";
  /** the tool to go back to once Modify > Hatch… or Create Dividing Lines… has its clicks */
  private clicksFrom: ToolId = "select";
  private sectionKind: "2d" | "3d" = "2d";
  private readonly renderer: Renderer;
  private detachSession: (() => void) | null = null;
  /** cancels the drawing being opened, while one is (see openReading) */
  private cancelOpening: (() => void) | null = null;
  /** created the first time the 3D view is shown (three.js loads then) */
  private view3d: View3D | null = null;
  /** where each view pane's 3D view was left, by pane, while another has the live view */
  private readonly paneCams = new Map<number, CameraState>();
  /** the last arrangement's change, put in place */
  private panesApplied: Promise<void> = Promise.resolve();
  /** each 3D view pane's render mode and projection, by pane, the live one's being the view's own */
  private readonly paneLooks = new Map<number, PaneLook>();
  private picturesTimer = 0;
  /** the next frame of the Path Traced panes' refining */
  private refineFrame = 0;
  /** the 3D view's lookVersion the panes' pictures were drawn at */
  private picturedAt = -1;
  /** where each plan pane's view was left, by pane, while another has the live plan */
  private readonly planViews = new Map<number, { cx: number; cy: number; scale: number }>();
  /** what draws each plan pane's picture, by pane */
  private readonly planPictures = new Map<number, { view: View; renderer: Renderer }>();
  private planPicturesTimer = 0;
  /** how the 3D view draws the model; it outlives the view, which is built on first use */
  private renderMode3d: RenderMode = "shaded";
  /** the 3D view's model no longer matches the document */
  private stale3d = true;
  /** the model was built while the 3D view was hidden (for a floating pane): its first showing frames it */
  private unframed3d = false;
  /** whether the 3D view has shown the open drawing, so saving keeps the view it was left in */
  private shown3d = false;
  /** set while saving writes the active layer's view, which needs no new 3D model */
  private savingView = false;
  private rebuild3dTimer = 0;
  /** the open drawing came from a template and has not been saved: Save As offers its untitled name */
  private untitled = false;
  /** numbers the untitled drawings of this window, as Vectorworks does */
  private untitledCount = 0;
  /** the open drawings, in tab order */
  private readonly drawings: OpenDrawing[] = [];
  private autosave: ReturnType<typeof installAutosave> | null = null;
  /** the drawing the window shows, one of `drawings` */
  private shown: OpenDrawing | null = null;
  /** draws the tab strip again */
  private redrawTabs: () => void = () => {};

  constructor() {
    // the 3D view as it was last left, when Preferences > 3D remembers it
    const last = last3d();
    if (last && RENDER_MODES.includes(last.mode as RenderMode)) this.renderMode3d = last.mode as RenderMode;
    if (last && last.projection !== store.viz3d.projection) setViz({ projection: last.projection });
    applyTurnSteps();
    this.text = new TextEditor(byId("text-host"), this.view);
    const env: ToolEnv = {
      view: this.view,
      scene: this.scene,
      snap: this.snap,
      text: this.text,
      requestDraw: () => this.requestDraw(),
    };
    this.controller = new ToolController(env, this.canvas, [
      new SelectTool(env),
      new PanTool(env),
      new LineTool(env),
      new RectTool(env),
      new CircleTool(env),
      new PolygonTool(env),
      new TriangleTool(env),
      new PolylineTool(env),
      new TextTool(env),
      new ArcTool(env),
      new QuarterArcTool(env),
      new RotateTool(env),
      new MirrorTool(env),
      new SymbolTool(env),
      new LocusTool(env),
      new LightTool(env),
      new CameraTool(env),
      new FlyoverTool(env),
      new TranslateViewTool(env),
      new WalkthroughTool(env),
      new HeliodonTool(env),
      new WallTool(env),
      new WallJoinTool(env),
      new SlabTool(env),
      new PluginInsertTool(env),
      new WallInsertTool(env, "door", "Door"),
      new WallInsertTool(env, "window", "Window"),
      new EyedropperTool(env),
      new AttributeMappingTool(env),
      new MeasureTool(env),
      new DimensionTapeTool(env),
      new ProtractorTool(env),
      new SectionTool(env, (line) => {
        // back to the tool before, then the cut
        this.controller.setTool(this.sectionFrom);
        if (line && this.sectionKind === "3d") cut3DSection(line.a, line.b, line.keepLeft);
        else if (line) cut2DSection(line.a, line.b, line.keepLeft, this.scene, this.view);
      }),
      new HatchTool(env, () => this.controller.setTool(this.clicksFrom)),
      new DividingTool(env, () => this.controller.setTool(this.clicksFrom)),
      new AlignLeadersTool(env, () => this.controller.setTool(this.clicksFrom)),
      new Rotate3DCentreTool(env, () => this.controller.setTool(this.clicksFrom)),
      new RoofFaceAxisTool(env, () => this.controller.setTool(this.clicksFrom)),
      new RenderBitmapTool(env),
      new PlaceAtTool(env),
      new AddDimensionsTool(env),
      new RotatePlanTool(env),
      new VisibilityTool(env),
      new SelectSimilarTool(env),
      new OffsetTool(env),
      new FilletTool(env),
      new TrimTool(env),
      new SplitTool(env),
      new ConnectTool(env),
      new DimensionTool(env),
      new ArcLengthTool(env),
      new CalloutTool(env),
      new LeaderLineSimpleTool(env),
      new LeaderLineTool(env),
      new HyperlinkTool(env),
      new RevisionCloudTool(env),
      new BreakLineTool(env),
      new InsulationTool(env),
      new RepetitiveUnitTool(env),
      new SteelSectionTool(env),
      new Steel3DTool(env),
      new LumberTool(env),
      new LinearMaterialTool(env),
      new FramingMemberTool(env),
      new StructuralMemberTool(env),
      new BulbFlatTool(env),
      new ShaftBreakTool(env),
      new ShaftBreak2Tool(env),
      new BoltTool(env),
      new ScrewTool(env),
      new NailTool(env),
      new AnchorTool(env),
      new CarriageBoltTool(env),
      new LagScrewTool(env),
      new CotterPin3DTool(env),
      new WingNutDin3DTool(env),
      new WingNutA3DTool(env),
      new WingNutB3DTool(env),
      new WingNutC3DTool(env),
      new WingNutD3DTool(env),
      new RetainingRingAsme3DTool(env),
      new RetainingRingDin3DTool(env),
      new RetainingWasherDin3DTool(env),
      new EyeBolt3DTool(env),
      new SwingBolt3DTool(env),
      new SwingEyeBolt3DTool(env),
      new TBolt3DTool(env),
      new UBolt3DTool(env),
      new JBolt3DTool(env),
      new ThumbScrew3DTool(env),
      new CarriageBolt3DTool(env),
      new LagScrew3DTool(env),
      new WoodScrew3DTool(env),
      new SheetMetalScrew3DTool(env),
      new DrilledHole3DTool(env),
      new TappedMm3DTool(env),
      new TappedIn3DTool(env),
      new BoltAndNutInchTool(env),
      new BoltAndNutMmTool(env),
      new WoodScrewTool(env),
      new SheetMetalScrewTool(env),
      new WeldTool(env),
      new DrilledHoleTool(env),
      new TappedHoleTool(env, "tappedmm"),
      new TappedHoleTool(env, "tappedin"),
      new SlotTool(env),
      new HolePatternTool(env),
      new ScrewThreadTool(env),
      new KeywayTool(env),
      new SpurGearTool(env),
      new SpurGear3DTool(env),
      new GearRack3DTool(env),
      new Sprocket3DTool(env),
      new LinearChain3DTool(env),
      new CircularChain3DTool(env),
      new OffsetLink3DTool(env),
      new Pulley3DTool(env),
      new BevelGear3DTool(env),
      new Worm3DTool(env),
      new WormGear3DTool(env),
      new Key3DTool(env),
      new WoodruffKey3DTool(env),
      new Shaft3DTool(env),
      new BallBearing3DTool(env),
      new RollerBearing3DTool(env),
      new NeedleBearing3DTool(env),
      new TaperedBearing3DTool(env),
      new ThrustBearing3DTool(env),
      new LockNut3DTool(env),
      new PillowBlock3DTool(env),
      new FlangedBearing23DTool(env),
      new FlangedBearing43DTool(env),
      new CompressionSpring13DTool(env),
      new CompressionSpring23DTool(env),
      new ConicalSpring3DTool(env),
      new DieSpring3DTool(env),
      new ExtensionSpring3DTool(env),
      new TorsionSpring3DTool(env),
      new BellevilleSpring3DTool(env),
      new GearRackTool(env),
      new SprocketTool(env),
      new LinearChainTool(env),
      new CircularChainTool(env),
      new OffsetLinkTool(env),
      new BallBearingTool(env),
      new RollerBearingTool(env),
      new NeedleBearingTool(env),
      new TaperedBearingTool(env),
      new ThrustBearingTool(env),
      new LockNutTool(env),
      new PillowBlockTool(env),
      new FlangedBearing2Tool(env),
      new FlangedBearing4Tool(env),
      new PulleyTool(env),
      new BevelGearTool(env),
      new WormTool(env),
      new WormGearTool(env),
      new ShaftTool(env),
      new ClevisPinInch3DTool(env),
      new ClevisPinMetric3DTool(env),
      new ClevisPinDin3DTool(env),
      new DowelPin3DTool(env),
      new ParallelPin3DTool(env),
      new TaperPinInch3DTool(env),
      new TaperPinDin3DTool(env),
      new LargeRivet3DTool(env),
      new SmallRivet3DTool(env),
      new RivetDin3DTool(env),
      new TubularRivet3DTool(env),
      new AcornNut3DTool(env),
      new HexCapNut3DTool(env),
      new KnurledNutDin3DTool(env),
      new KnurledNutInch3DTool(env),
      new ClevisPinInchTool(env),
      new ClevisPinMetricTool(env),
      new ClevisPinDinTool(env),
      new CotterPinTool(env),
      new DowelPinTool(env),
      new ParallelPinTool(env),
      new TaperPinInchTool(env),
      new TaperPinDinTool(env),
      new LargeRivetTool(env),
      new SmallRivetTool(env),
      new RivetDinTool(env),
      new TubularRivetTool(env),
      new AcornNutTool(env),
      new HexCapNutTool(env),
      new KnurledNutDinTool(env),
      new KnurledNutInchTool(env),
      new WingNutDinTool(env),
      new WingNutATool(env),
      new WingNutBTool(env),
      new WingNutCTool(env),
      new WingNutDTool(env),
      new RetainingRingAsmeTool(env),
      new RetainingRingDinTool(env),
      new RetainingWasherDinTool(env),
      new FastenerTool(env),
      new EyeBoltTool(env),
      new JBoltTool(env),
      new SwingBoltTool(env),
      new SwingEyeBoltTool(env),
      new TBoltTool(env),
      new ThumbScrewTool(env),
      new UBoltTool(env),
      new KeyTool(env),
      new WoodruffKeyTool(env),
      new CompressionSpring1Tool(env),
      new CompressionSpring2Tool(env),
      new ConicalSpringTool(env),
      new DieSpringTool(env),
      new ExtensionSpringFrontTool(env),
      new ExtensionSpringEndTool(env),
      new TorsionSpringFrontTool(env),
      new TorsionSpringEndTool(env),
      new BellevilleSpringTool(env),
      new TableChairsTool(env),
      new DeskTool(env),
      new ShelvingTool(env),
      new ClothesRodTool(env),
      new BathShowerTool(env),
      new GrabBarTool(env),
      new FireplaceTool(env),
      new ToiletStallTool(env),
      new CabinetTool(env),
      new CustomCabinetTool(env),
      new CompartmentSinkTool(env),
      new RailingTool(env),
      new CeilingGridTool(env),
      new SeatingSectionTool(env),
      new SpaceTool(env),
      new SpaceLinkTool(env),
      new AdjacencyMatrixTool(env),
      new AdjacencyScoreTool(env),
      new StackingDiagramTool(env),
      new HardscapeTool(env),
      new LandscapeAreaTool(env),
      new HedgerowTool(env),
      new SiteModifierTool(env),
      new GradeTool(env),
      new VisualZoneTool(env),
      new SiteSculptTool(env),
      new SiteContourTool(env),
      new SiteLabelTool(env),
      new MassingModelTool(env),
      new PipingRunTool(env),
      new HvacStraightDuctTool(env),
      new HvacElbowTool(env),
      new HvacFlexDuctTool(env),
      new HvacVerticalDuctTool(env),
      new HvacTransitionTool(env),
      new HvacSplitterTool(env),
      new HvacDamperTool(env),
      new HvacDiffuserTool(env),
      new HvacOutletTool(env),
      new GraticuleTool(env),
      new GreatCircleTool(env),
      new SurveyPointTool(env),
      new GisStakeTool(env),
      new ExistingTreeTool(env),
      new ParkingSpacesTool(env),
      new PropertyLineTool(env),
      new ParkingTool(env),
      new StakeTool(env),
      new FenceTool(env),
      new CurbTool(env),
      new RoadStraightTool(env),
      new RoadCurvedTool(env),
      new RoadTeeTool(env),
      new RoadPolyTool(env),
      new ParkingAreaTool(env),
      new ParkingAlongPathTool(env),
      new StageDeckTool(env),
      new StagePlugTool(env),
      new StageStepsTool(env),
      new StageRampTool(env),
      new RopeStanchionTool(env),
      new SoftGoodsTool(env),
      new TelevisionTool(env),
      new VideoScreenTool(env),
      new BlendedScreenTool(env),
      new LedScreenTool(env),
      new SpeakerTool(env),
      new SpeakerArrayTool(env),
      new RackRulerTool(env),
      new ReceptacleTool(env),
      new SwitchTool(env),
      new CommDeviceTool(env),
      new IncandescentFixtureTool(env),
      new StraightTrussTool(env),
      new CurvedTrussTool(env),
      new LightingPipeTool(env),
      new PipeLadderTool(env),
      new RiggingPointTool(env),
      new HoistTool(env),
      new HoistOriginTool(env),
      new BridleTool(env),
      new MotherGridTool(env),
      new RiggingLoadTool(env),
      new LightingDeviceTool(env),
        new PhotometerTool(env),
        new VideoCameraTool(env),
        new PhotoGridTool(env),
        new EquipmentKeyTool(env),
        new FocusAlongPathTool(env),
        new ChamferEdgeTool(env),
        new FilletEdgeTool(env),
        new ShellSolidTool(env),
        new TaperFaceTool(env),
        new PushPullTool(env),
        new OffsetEdgeTool(env),
        new DeformTool(env),
        new ExtractTool(env),
        new ProjectTool(env),
        new AnalysisTool(env),
        new LoftSurfaceTool(env),
        new AlignPlaneTool(env),
        new Poly3DTool(env),
        new Locus3DTool(env),
      new GangingTool(env),
      new LightingAccessoryTool(env),
      new StageOriginTool(env),
      new DistributorTool(env),
      new ElectricalComponentTool(env),
      new CablePathTool(env),
      new CableTool(env),
      new HopOverTool(env),
      new FocusPointTool(env),
      new AlignDistributeTool(env),
      new CountertopTool(env),
      new OutletTool(env),
      new IrrigationPipeTool(env),
      new ValveTool(env),
      new PointOfConnectionTool(env),
      new ControllerTool(env),
      new SystemComponentTool(env),
      new DripOutletTool(env),
      new DesignZoneTool(env),
      new HydrozoneTool(env),
      new ColumnTool(env),
      new PilasterTool(env),
      new ChainExtrudeTool(env),
      new StairTool(env),
      new SimpleStairTool(env),
      new RampTool(env),
      new ElevatorTool(env),
      new EscalatorTool(env),
      new PlantTool(env),
      new SectionMarkerTool(env),
      new SectionLineTool(env),
      new InteriorElevationTool(env),
      new DetailCalloutTool(env),
      new DrawingLabelTool(env),
      new ReferenceMarkerTool(env),
      new GridLineTool(env),
      new TitleBlockBorderTool(env),
      new RedlineTool(env),
      new GeneralNotesTool(env),
      new BenchmarkTool(env),
      new NorthArrowTool(env),
      new ScaleBarTool(env),
      new DataTagTool(env),
      new LegendTool(env),
      new SymmetryLabelTool(env),
      new CenterMarkTool(env),
      new SlopeDimensionTool(env),
      new FeatureControlFrameTool(env),
      new HoleNoteTool(env),
      new WeldingSymbolTool(env, "weldfilletaws"),
      new WeldingSymbolTool(env, "weldfilletiso"),
      new WeldingSymbolTool(env, "weldflangeaws"),
      new WeldingSymbolTool(env, "weldflangeiso"),
      new WeldingSymbolTool(env, "weldgrooveaws"),
      new WeldingSymbolTool(env, "weldgrooveiso"),
      new WeldingSymbolTool(env, "weldmiscaws"),
      new WeldingSymbolTool(env, "weldmisciso"),
      new WeldingSymbolTool(env, "weldslotplugaws"),
      new WeldingSymbolTool(env, "weldslotplugiso"),
      new StippleTool(env),
      new ChamferTool(env),
      new DoubleLineTool(env),
      new DoubleLinePolygonTool(env),
      new RegularPolygonTool(env),
      new FreehandTool(env),
      new OvalTool(env),
      new RoundRectTool(env),
      new SpiralTool(env),
      new MoveByPointsTool(env),
      new ClipTool(env),
      new ShearTool(env),
      new FixedPointResizeTool(env),
      new ReshapeTool(env),
      new ZoomTool(env),
      new ExtrudedRectTool(env),
      new ExtrudedPolygonTool(env),
      new SphereTool(env),
      new HemisphereTool(env),
      new ConeTool(env),
    ]);
    this.renderer = new Renderer(this.canvas, this.view, this.scene, this.controller);
    installViewHistory(this.view);
    installSmartOptions(this.canvas, (id) => this.controller.setTool(id));
    setToolHelp((id) => this.controller.helpOf(id));
    this.controller.onMiddleClick = (x, y) => openSmartOptions(x, y);
  }

  start(): void {
    const setTool = (id: ToolId): void => this.controller.setTool(id);
    installTheme();
    mountTopBar(
      {
        save: () => void this.save(),
        exportPdf: () => void this.exportPdf(),
        exportImage: () => void exportImageFile(this.scene, this.view),
        exportSvg: () => this.exportSvg(),
        exportDxf: () => this.exportDxf(),
        print: () => void this.print(),
      },
      setTool,
    );
    const panels = mountPanels(this.scene, this.view, setTool);
    // one sidebar, as Vectorworks packs its palettes: Object Info with Attributes as a tab above
    // Navigation with Resources (and Agents) as tabs, on the right; the tools are in the top bar, and
    // the closed palettes wait in the docks' rails, the left dock down to its rail so the drawing has
    // the rest of the window (Window > Workspaces > Two Sidebars puts Navigation back on the left)
    const palettes = new Palettes(byId("workspace"), [
      { id: "basic", title: "Tools", menuTitle: "Basic", side: "left", icon: PALETTE_ICON.tools, hidden: true, body: basicPalette(setTool), menu: toolDisplayRows },
      {
        id: "toolsets",
        title: "Tool Sets",
        side: "left",
        icon: PALETTE_ICON.toolSets,
        hidden: true,
        body: toolSetsPalette(setTool),
        menu: () => [...toolDisplayRows(), "-", { label: "Edit Tool Sets…", run: () => void toolSetsDialog() }],
      },
      { id: "objectInfo", title: "Object Info", side: "right", icon: PALETTE_ICON.objectInfo, fill: true, weight: 420, body: panels.objectInfo, tabbed: "oip" },
      { id: "attributes", title: "Attributes", side: "right", icon: PALETTE_ICON.attributes, tabOf: "objectInfo", body: panels.attributes, menu: attributeUtilityRows },
      { id: "navigation", title: "Navigation", side: "right", icon: PALETTE_ICON.navigation, fill: true, weight: 360, body: panels.navigation, tabbed: "navigation" },
      {
        id: "resources",
        title: "Resources",
        menuTitle: "Resource Manager",
        side: "right",
        icon: PALETTE_ICON.resources,
        tabOf: "navigation",
        fill: true,
        body: panels.resources,
        menu: resourceViewRows,
      },
      { id: "snapping", title: "Snapping", side: "right", icon: PALETTE_ICON.snapping, hidden: true, body: snappingPalette() },
      {
        id: "visualization",
        title: "Visualization",
        side: "right",
        icon: PALETTE_ICON.visualization,
        hidden: true,
        body: visualizationPalette(),
        tabbed: "visualization",
      },
      { id: "workingPlanes", title: "Working Planes", side: "right", icon: PALETTE_ICON.workingPlanes, hidden: true, body: workingPlanesPalette() },
      ...extensionPalettes(),
    ]);
    // the drawing and the top bar's ends follow the docks' widths (a folded dock's strip is too narrow for an end)
    const topbar = byId("topbar");
    const syncDocks = (): void => {
      const { left, right, top, bottom } = palettes.insets();
      document.documentElement.style.setProperty("--dock-left", `${left}px`);
      document.documentElement.style.setProperty("--dock-right", `${right}px`);
      // a gap between a top docking bar and the drawing, as the top bar leaves one
      document.documentElement.style.setProperty("--dock-top", top > 0 ? `${top + 8}px` : "0px");
      document.documentElement.style.setProperty("--dock-bottom", `${bottom}px`);
      topbar.classList.toggle("left-dock", left > 0 && !palettes.isNarrow("left"));
      topbar.classList.toggle("right-dock", right > 0 && !palettes.isNarrow("right"));
    };
    palettes.onChange(syncDocks);
    syncDocks();
    byId("btn-snapping").addEventListener("click", (e) => {
      (e.currentTarget as HTMLElement).blur();
      palettes.toggle("snapping");
    });
    // the open drawings' tabs, over the drawing once there are two
    const tabActions: DocTabActions = {
      tabs: () => this.tabs(),
      select: (i) => {
        const d = this.drawings[i];
        if (d) this.switchDrawing(d);
      },
      close: (i) => void this.closeDrawing(this.drawings[i] ?? null),
      newDrawing: () => void this.newDrawing(),
    };
    this.redrawTabs = mountDocTabs(byId("stage"), tabActions);
    const menuBar = mountMenuBar(byId<HTMLButtonElement>("btn-menu"), {
      scene: this.scene,
      view: this.view,
      palettes,
      actions: {
        newDrawing: () => void this.newDrawing(),
        newFromTemplate: () => void this.newFromTemplate(),
        open: () => void this.openPicker(),
        close: () => void this.closeDrawing(),
        closeAll: () => void this.closeAll(),
        drawingRows: () => drawingRows(tabActions),
        save: () => void this.save(),
        saveAs: () => void this.saveAs(),
        saveCopyAs: () => void this.saveCopyAs(),
        saveAsTemplate: () => void this.saveCopyAs(true),
        saveAll: () => void this.saveAll(),
        anyUnsaved: () => this.anyUnsaved(),
        exportDxf: () => this.exportDxf(),
        exportSvg: () => this.exportSvg(),
        exportEps: () => this.exportEps(),
        exportEmf: () => this.exportEmf(),
        exportPdf: () => void this.exportPdf(),
        exportImage: () => void exportImageFile(this.scene, this.view),
        exportModel: (format) => void this.exportModel(format),
        exportStl: () => void exportStlDialog(this.layers3d()),
        exportUsd: () => void exportUsdDialog(this.layers3d()),
        exportKml: () => void exportKmlDialog(this.layers3d()),
        publish: () => {
          if (store.session) void publishDialog(withoutHidden(store.session.doc), store.fileName, baseName(store.fileName), store.activeLayerId, panels.savedViews.pages());
        },
        importDxf: () => void importDxfFile(this.scene, this.view),
        importDwg: () => void importDwgFile(this.scene, this.view),
        importImage: () => importImageFiles(this.view),
        importPdf: () => importPdfFile(this.scene, this.view),
        importMetafile: () => importMetafileFile(this.scene, this.view),
        importMesh: (format) => importMeshFile(format, this.scene, this.view),
        importShapefile: () => importShapefileFiles(this.scene, this.view),
        cutSection: (kind) => this.startSection(kind),
        hatch: () => void this.startHatch(),
        dividingLines: () => this.startDividing(),
        alignLeaders: () => void this.startLeaders(),
        rotate3D: () => this.startRotate3D(),
        roofFace: () => void this.startRoofFace(),
        pasteAsBitmap: () => void pasteAsBitmap(this.view),
        print: () => void this.print(),
        fit: () => this.fit(true),
        fitObjects: () => this.fitObjects(),
        toggle3d: () => this.toggle3d(),
        standardView: (preset) => void this.standardView(preset),
        topPlan: () => this.topPlan(),
        renderMode: () => this.renderMode3d,
        setRenderMode: (mode) => this.setRenderMode(mode),
        duplicateArray: () => void duplicateArrayDialog(this.scene),
        createSymbol: () => void createSymbolDialog(this.scene),
        saveView: () => void saveViewDialog(panels.savedViews),
        activateObjectInfo: () => {
          palettes.show("objectInfo");
          // once it shows, its first field takes the keyboard
          requestAnimationFrame(() => panels.objectInfo.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)")?.focus());
        },
        openRecent: (entry) => void this.openRecent(entry),
        revert: () => void this.revert(),
        fileInfo: () => void import("./fileInfo.ts").then((m) => m.fileInfoDialog(this.untitled)),
      },
    });
    mountViewBar({
      view: this.view,
      scene: this.scene,
      controller: this.controller,
      savedViews: panels.savedViews,
      fit: () => this.fit(true),
      fitObjects: () => this.fitObjects(),
      toggle3d: () => this.toggle3d(),
      standardView: (preset) => void this.standardView(preset),
      topPlan: () => this.topPlan(),
      renderMode: () => this.renderMode3d,
      setRenderMode: (mode) => this.setRenderMode(mode),
    });
    mountModeBar(this.controller);
    mountStatusBar();
    // the Onscreen View Control: a cube in the drawing's corner, turned as the view is
    mountViewControl(byId("stage"), {
      view3d: () => this.view3d,
      standardView: (preset) => this.standardView(preset),
      lookAlong: async (toward) => {
        if (!store.view3d) await this.show3d();
        if (store.view3d) this.view3d?.lookAlong(toward);
      },
      topPlan: () => this.topPlan(),
      show3d: async () => {
        if (!store.view3d) await this.show3d();
      },
      zoom: (factor) => {
        if (store.view3d) this.view3d?.zoomBy(factor);
        else zoomBy(this.view, factor);
      },
    });
    // the bars over the drawing: shown, moved and rolled up as the palettes' layout keeps them
    palettes.addBar("viewbar", byId("viewbar"));
    palettes.addBar("modebar", byId("modebar"));
    palettes.addBar("snapbar", byId("snapbar"));
    // the top bar's groups, shown and hidden by a right-click on it or Window > Top Bar
    palettes.addTopGroup("view", byId("tb-view"));
    palettes.addTopGroup("tools", byId("tb-tools"));
    palettes.addTopGroup("undo", byId("tb-undo"));
    palettes.addTopGroup("zoom", byId("vb-zoom"));
    // the menu bar's row of titles over the top bar, shown and hidden as its groups are
    const strip = byId("menu-strip");
    mountMenuStrip(strip, () => menuBar.menus());
    palettes.addTopGroup("menus", strip);
    for (const bar of [topbar, strip]) {
      bar.addEventListener("contextmenu", (e) => {
        if ((e.target as Element).closest("input, select, textarea")) return;
        e.preventDefault();
        openContextMenu(palettes.topRows(), e.clientX, e.clientY);
      });
    }
    // the pills over the drawing are for the 2D drawing of an open document
    const stage = byId("stage");
    store.on("viz3d", () => {
      this.view3d?.setViz(store.viz3d);
      this.view3d?.setDashes(this.dashes3d());
      keep3d({ mode: this.renderMode3d, projection: store.viz3d.projection });
    });
    // hiding or showing objects builds the 3D again without them, or with them
    onHiddenChange(() => {
      this.stale3d = true;
      if (this.seen3d) this.update3d();
    });
    mountUnhideButton(byId("canvas-wrap"));
    // a new 3D conversion resolution builds the 3D again
    onPrefs(() => {
      if (!applyTurnSteps()) return;
      this.stale3d = true;
      if (this.seen3d) this.update3d();
    });
    store.on(["session", "view3d"], () => {
      stage.classList.toggle("no-doc", !store.session);
      stage.classList.toggle("is-3d", store.view3d);
    });
    // Flyover, Translate View and Walkthrough set what a left drag does in the 3D view, showing it first
    let standing: number | null = null;
    const steer = async (picked: boolean): Promise<void> => {
      const n = navigationFor(store.tool);
      stage.classList.toggle("steering", n !== null);
      if (n && store.session && !store.view3d) await this.show3d();
      const v = this.view3d;
      if (!v) return;
      v.setNavigation(n?.nav ?? "orbit", n?.sensitivity);
      if (n?.objectCentre) v.orbitAboutObjects(this.withParts(store.selection));
      if (n?.viewerHeight == null) {
        standing = null;
        return;
      }
      // the viewer stands up when the tool is picked or its height changes, not as its modes change
      if (!picked && standing === n.viewerHeight) return;
      standing = n.viewerHeight;
      if (store.viz3d.projection !== "perspective") setViz({ projection: "perspective" });
      const layer = store.session?.doc.layers().find((l) => l.id === store.activeLayerId);
      v.standAt(layer?.elevation ?? 0, n.viewerHeight);
    };
    store.on("tool", () => void steer(true));
    store.on("modes", () => void steer(false));
    onShow3d(() => void steer(true));
    mountWelcome(byId("welcome"), {
      openPicker: () => void this.openPicker(),
      newDrawing: () => void this.newDrawing(),
      newFromTemplate: () => void this.newFromTemplate(),
      openBytes: (bytes, name) => void this.openDocument(bytes, name, null),
      openRecent: (entry) => void this.openRecent(entry),
    });
    mountExtensionChrome(
      { head: byId("welcome-head-slot"), open: byId("welcome-open-slot"), main: byId("welcome-main-slot"), foot: byId("welcome-foot-slot") },
      recentSource,
      topbar.querySelector<HTMLElement>(".tb-left")!,
      topbar.querySelector<HTMLElement>(".tb-right")!,
    );
    // an open dock is never narrower than the top bar's end over it, so their edges line up: the end
    // is measured with only its buttons to go by whenever one of them changes size
    const fitEnds = (): void => {
      for (const side of ["left", "right"] as const) {
        const end = topbar.querySelector<HTMLElement>(`.tb-${side}`)!;
        const kept = end.style.width;
        end.style.width = "0px";
        const px = end.getBoundingClientRect().width;
        end.style.width = kept;
        palettes.setFloor(side, px);
      }
    };
    const endSizes = new ResizeObserver(fitEnds);
    for (const el of topbar.querySelectorAll(".tb-side > :not(.spacer)")) endSizes.observe(el);
    installShortcuts({
      controller: this.controller,
      view: this.view,
      actions: {
        fit: () => this.fit(true),
        toggle3d: () => this.toggle3d(),
      },
      menuShortcut: (e) => menuBar.shortcut(e),
    });
    // a right-click on the drawing selects what is under it, as a click does, and opens its menu
    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!store.session) return;
      const rect = this.canvas.getBoundingClientRect();
      const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const under = selectForMenu(this.scene, this.view, at);
      const hidden = under === null ? forceSelectTarget(this.scene, this.view, at) : null;
      const behind = hidden === null ? null : { id: hidden, select: () => forceSelect(this.scene, hidden) };
      const coincident = under === null ? [] : coincidentAt(this.scene, this.view, at);
      // a right-click within a few pixels of a vertex is on it
      const pick = { at: this.view.toWorld(at.x, at.y), tol: 6 / this.view.scale };
      menuBar.drawing(e.clientX, e.clientY, under, behind, coincident, pick);
    });
    installCoincidentKey(this.canvas, this.scene, this.view);
    // pictures dropped on an open drawing are imported together, as Import Image File(s) does
    installFileDrop((file, handle, all) => {
      const pictures = all.filter((f) => isImageName(f.name));
      if (store.session && isImageName(file.name)) void importImages(pictures, this.view);
      else void this.openFile(file, handle);
    });
    void loadRecent();
    this.autosave = installAutosave({ openDocument: async (bytes, name) => (await this.openDocument(bytes, name, null)) === "open" ? store.session : null });
    window.addEventListener("beforeunload", (e) => {
      if (store.session?.dirty || this.drawings.some((d) => d.session.dirty)) {
        e.preventDefault();
        e.returnValue = "";
      }
    });

    // display modes and the active class decide which objects can be snapped to
    store.on(["display", "class"], () => this.snap.invalidate());
    store.on(["session", "file", "selection", "layer", "class", "tool", "snap", "view", "display", "attrs"], () =>
      this.requestDraw(),
    );
    store.on(["layer", "display"], () => this.view3d?.setVisibleLayers(this.layers3d()));
    // a rotated plan shows on design layers; a sheet layer or a symbol being edited shows unrotated
    store.on("layer", () => {
      if (!syncPlanRotation(this.view)) return;
      store.emit("view");
      this.requestDraw();
    });
    new ResizeObserver(() => this.renderer.resize()).observe(byId("canvas-wrap"));
    // Window > View Panes: the plan and 3D views in two, three or four panes
    mountPanes(byId("canvas-wrap"), {
      resized: () => this.renderer.resize(),
      activate: (i) => (paneKind(i) === "plan" ? this.activatePlanPane(i) : this.activatePane(i)),
      placed: () => {
        this.queuePictures(true);
        this.queuePlanPictures();
      },
    });
    onPanes(() => (this.panesApplied = this.applyPanes()));
    // Reset Multiple View Panes: the live 3D view back to its pane's standard view too, once it's shown
    onPanesReset(() => void this.panesApplied.then(() => livePane() >= 0 && this.view3d?.setView(startView(livePane()))));
    // View > Multiple View Panes > Create Floating View Pane: more views of the drawing, floating over it
    mountFloatingPanes(stage, {
      scene: this.scene,
      view: this.view,
      showing3d: () => store.view3d,
      look: () => this.look(),
      model3d: () => this.model3d(),
      takePlan: (at) => void this.takeFloatingPlan(at),
      take3d: (state) => void this.takeFloating3d(state),
    });
    stage.classList.toggle("two-panes", multiPane());
    // the plan panes' pictures follow the drawing, not the live plan's zoom
    store.on(["session", "file", "selection", "layer", "class", "display", "attrs"], () => this.queuePlanPictures());
    // with several panes, a click in the inactive live plan or live 3D pane makes it active, and does nothing else
    const activate =
      (to3d: boolean) =>
      (e: PointerEvent): void => {
        if (!multiPane() || store.view3d === to3d || (to3d ? livePane() : livePlanPane()) < 0) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        store.view3d = to3d;
        store.emit("view3d");
        this.requestDraw();
      };
    this.canvas.addEventListener("pointerdown", activate(false), true);
    byId("view3d-host").addEventListener("pointerdown", activate(true), true);
    registerSymbolEditor({ enter: (index) => this.enterSymbol(index), annotate: (id) => this.enterAnnotations(id), exit: () => this.exitSymbol() });
    mountSymbolBar(byId("canvas-wrap"));
    mountGroupBar(byId("canvas-wrap"));
    mountSolidEditBar(byId("canvas-wrap"));
    mountLoftBar(byId("canvas-wrap"));
    mountAlignPlaneBar(byId("canvas-wrap"));
    mountPushPullBar(byId("canvas-wrap"));
    mountDeformBar(byId("canvas-wrap"));
    mountExtractBar(byId("canvas-wrap"));
    mountProjectBar(byId("canvas-wrap"));
    mountAnalysisBar(byId("canvas-wrap"));
    mountPoly3dBar(byId("canvas-wrap"));
    mountLocus3d();
    installCrosshair(this.canvas, byId("canvas-wrap"));
    installRulers(byId("stage"), () => this.requestDraw());
    registerOverlay(drawRulers);
    registerOverlay(drawOriginMarker);
    installAppearance();
    store.emit("session", "file");
    appStarted({
      scene: this.scene,
      view: this.view,
      palettes,
      controller: this.controller,
      canvas: this.canvas,
      requestDraw: () => this.requestDraw(),
      openDocument: async (bytes, name, options) => void (await this.openDocument(bytes, name, null, options?.replace ?? false, options?.source ?? null)),
      documentBytes: async () => (store.session ? documentBytes(store.session) : null),
      fit: () => this.fit(),
      show3d: async () => {
        // several panes, none of them 3D: the active one becomes the 3D view
        if (multiPane() && livePane() < 0) await this.turnActivePane("3d");
        else if (!store.view3d) await this.show3d();
        // the model waits for a pause in the edits (onDocChange): a look or render asked for now has the edits made so far
        clearTimeout(this.rebuild3dTimer);
        this.update3d();
        return this.view3d;
      },
      view3d: () => this.view3d,
      show2d: () => this.topPlan(),
      renderMode: () => this.renderMode3d,
      setRenderMode: (mode) => this.setRenderMode(mode),
      setTool,
      setToolFrom: (id, obj) => this.controller.setToolFrom(id, obj),
      save: () => this.save(),
    });
  }

  /** Modify > Edit Symbol: draws definition `index` alone, as the active layer, fitted in the window. */
  private enterSymbol(index: number): void {
    const s = store.session;
    if (!s) return;
    // from one symbol to another, Exit Symbol still goes back to where the first was opened
    // annotations being edited are left first: a symbol opens over the drawing, not over them
    if (store.symbolEdit?.viewport) this.exitSymbol();
    const from = store.symbolEdit?.from ?? { layerId: store.activeLayerId, cx: this.view.cx, cy: this.view.cy, scale: this.view.scale };
    const id = s.doc.openSymbol(index);
    if (!id) {
      toast("That symbol definition is no longer in the drawing.", "info");
      return;
    }
    const layer = from.layerId ? this.scene.layer(from.layerId) : undefined;
    store.symbolEdit = {
      index,
      from,
      // drawn at the scale of the layer it was opened from, as line weights and text sizes depend on it
      layer: { id, name: symbolNameOf(s.doc, index), title: "", kind: "design", scale: layer?.kind === "design" ? layer.scale : 1, visibility: "visible", objectCount: 0 },
    };
    this.switchedSymbol(id);
    this.fit();
  }

  /**
   * Edit Annotations: a sheet viewport's annotations as the active layer, at the viewport's scale,
   * over what the viewport shows, the picture staying where it was on screen.
   */
  private enterAnnotations(viewportId: string): void {
    const s = store.session;
    const vp = s?.doc.viewport(viewportId);
    const sheet = s && vp ? s.doc.object(viewportId)?.layerId : undefined;
    if (!s || !vp || !sheet || store.symbolEdit) return;
    const id = s.doc.openAnnotations(viewportId);
    if (!id) {
      toast("That viewport has no annotations to open.", "info");
      return;
    }
    const k = vp.scale;
    const from = { layerId: sheet, cx: this.view.cx, cy: this.view.cy, scale: this.view.scale };
    const name = vp.name.trim() || "Viewport";
    store.symbolEdit = {
      index: -1,
      viewport: viewportId,
      from,
      // annotations are at the viewport's scale, as a design layer at it is
      layer: { id, name, title: "", kind: "design", scale: k, visibility: "visible", objectCount: 0 },
    };
    this.switchedSymbol(id);
    this.view.cx = from.cx * k;
    this.view.cy = from.cy * k;
    this.view.scale = from.scale / k;
    store.emit("view");
  }

  /** Exit Symbol (or Exit Viewport Annotation): back to the layer and view the symbol was opened from. */
  private exitSymbol(): void {
    const e = store.symbolEdit;
    if (!e) return;
    store.session?.doc.openSymbol(null);
    store.session?.doc.openAnnotations(null);
    store.symbolEdit = null;
    this.switchedSymbol(e.from.layerId);
    this.view.cx = e.from.cx;
    this.view.cy = e.from.cy;
    this.view.scale = e.from.scale;
    store.emit("view");
  }

  /** After opening or leaving a symbol: redraw everything, with `layerId` active and nothing selected. */
  private switchedSymbol(layerId: string | null): void {
    this.scene.invalidate({ kind: "all", ids: [] });
    this.snap.invalidate();
    this.controller.cancel();
    store.activeLayerId = layerId;
    store.editGroupId = null;
    store.selection = new Set<string>();
    reconcile();
    store.emit("session", "layer", "selection");
  }

  requestDraw(): void {
    this.text.reposition();
    this.renderer.requestDraw();
  }

  /** View > Fit to Objects: the selection fitted in the window (the 3D view keeping its direction), or with nothing selected the visible drawing. */
  fitObjects(): void {
    if (store.selection.size === 0) this.fit(true);
    else if (store.view3d && this.view3d) this.view3d.fitObjects(this.withParts(store.selection));
    else zoomToSelection(this.scene, this.view);
  }

  /** Objects `ids` and every object inside them, as the 3D view names the parts it draws. */
  /** Line Render Options' dash style for Dashed Hidden Line, in mm at the active design layer's scale; null for the view's own dashes. */
  private dashes3d(): readonly number[] | null {
    const style = store.viz3d.lineRender.dashStyle;
    const layer = store.session?.doc.layers().find((l) => l.id === store.activeLayerId);
    return style < 0 ? this.scene.dashPattern(style, layer?.kind === "design" ? layer.scale : 1) : null;
  }

  private withParts(ids: ReadonlySet<string>): Set<string> {
    return new Set([...ids, ...this.scene.expand(ids).map((e) => e.obj.id)]);
  }

  /** Fits the visible drawing in the window, moving there as Preferences say when `animate`; keeps the scale when nothing is drawn. */
  fit(animate = false): void {
    if (store.view3d && this.view3d) {
      this.view3d.fit();
      return;
    }
    const b = this.scene.drawnBounds(store.activeLayerId);
    const change = (): void => {
      if (b) {
        this.view.fit(b);
      } else {
        this.view.cx = 0;
        this.view.cy = 0;
      }
    };
    if (animate) glide(this.view, change);
    else {
      stopGlide();
      change();
      store.emit("view");
    }
    this.requestDraw();
  }

  private async openPicker(): Promise<void> {
    try {
      const picked = await pickFile(false, true);
      if (picked && /\.dwg$/i.test(picked.name)) await this.openDwg(picked.file, picked.name);
      else if (picked && isRevitModelName(picked.name)) await this.openRevitModel(new Uint8Array(await picked.file.arrayBuffer()), picked.name);
      else if (picked && isRevitName(picked.name)) await showRevitFile(new Uint8Array(await picked.file.arrayBuffer()), picked.name, this.view);
      else if (picked && isArchicadName(picked.name)) await this.openArchicadModel(picked.file, picked.name);
      else if (picked) tellFileIn(picked.file, picked.name, await this.openDocument(picked.file, picked.name, picked.handle));
    } catch (err) {
      toast(`Could not open the file: ${errorMessage(err)}`);
    }
  }

  /**
   * File > New and the hub's New drawing: a blank drawing (blank.ts), in feet and inches where this
   * browser's region measures in them and millimetres elsewhere, opens as "Untitled n" as a
   * template does.
   */
  private async newDrawing(): Promise<void> {
    try {
      await this.openUntitled(blankDrawing(imperialRegion() ? "ftin" : "mm"));
    } catch (err) {
      toast(`Could not start a drawing: ${errorMessage(err)}`);
    }
  }

  /** A .dwg opened with File > Open, or dropped with no drawing open: its objects in a new, untitled drawing. */
  private async openDwg(file: Blob, name: string): Promise<void> {
    await openDwgBytes(new Uint8Array(await file.arrayBuffer()), name, () => this.newDrawing(), this.scene, this.view);
  }

  /** Opens `data` as the next "Untitled n", with no file behind it: Save asks where it goes. */
  private async openUntitled(data: Uint8Array | Blob): Promise<void> {
    const before = store.session;
    await this.openDocument(data, `Untitled ${this.untitledCount + 1}.vwx`, null);
    if (store.session === before) return;
    this.untitledCount++;
    this.untitled = true;
  }

  /**
   * A Revit project opens as a new drawing of its model (revitFile.ts), named for the project, with
   * no file behind it: Save asks where it goes. The loading card says each step of the import, and
   * its X stops it. Once open, a note says what came in and what was drawn as boxes or left out.
   */
  private async openRevitModel(bytes: Uint8Array, fileName: string): Promise<void> {
    const before = store.session;
    let made: RevitDrawing | null = null;
    const opened = await this.openReading(fileName, async (say, signal) => {
      const drawing = await revitModelDrawing(bytes, fileName, (step) => say(`${step}…`), signal);
      made = drawing;
      return { data: drawing.bytes, name: `${drawing.name.replace(/[\\/:*?"<>|]+/g, "-")}.vwx`, handle: null };
    });
    tellFileIn(bytes, fileName, opened);
    if (store.session === before || !made) return;
    this.untitled = true;
    toast(revitSummary(made), "info");
  }

  /** Opens the Archicad project `file` (named `fileName`) as a new drawing of its model, made off the page; says what came in. */
  private async openArchicadModel(file: Blob, fileName: string): Promise<void> {
    const before = store.session;
    let made: ArchicadDrawing | null = null;
    const opened = await this.openReading(fileName, async (say, signal) => {
      const drawing = await archicadModelDrawing(file, fileName, (step) => say(`${step}…`), signal);
      made = drawing;
      return { data: drawing.bytes, name: `${drawing.name.replace(/[\\/:*?"<>|]+/g, "-")}.vwx`, handle: null };
    });
    tellFileIn(file, fileName, opened);
    if (store.session === before || !made) return;
    this.untitled = true;
    toast(archicadSummary(made), "info");
  }

  /**
   * File > New from Template…: a template (.sta, or any drawing) opens as "Untitled n", with no
   * file behind it, so the template stays as it was and Save asks where the new drawing goes.
   */
  private async newFromTemplate(): Promise<void> {
    try {
      const picked = await pickFile(true);
      if (picked) await this.openUntitled(picked.file);
    } catch (err) {
      toast(`Could not open the template: ${errorMessage(err)}`);
    }
  }

  /** A file dropped on the window: a .dxf, .dwg, .pdf, .emf or 3D model (.obj, .glb, .gltf, .3ds, .stl, .ifc, .usd, .3dm, .fbx, .dae, .kmz, .blend, .ply, .skp) is imported into the open drawing (a DWG or model into a new one when none is open), a .csv, .tsv, .dif, .slk or .xlsx as a worksheet, a Revit project opens as a drawing of its model (a family's or template's details are shown), anything else is opened (with its handle, when the browser gave one). */
  private async openFile(file: File, handle: Promise<FileSystemFileHandle | null>): Promise<void> {
    if (/\.dxf$/i.test(file.name)) {
      await importDroppedDxf(file, this.scene, this.view);
      return;
    }
    if (/\.dwg$/i.test(file.name)) {
      if (store.session) await importDroppedDwg(file, this.scene, this.view);
      else {
        try {
          await this.openDwg(file, file.name);
        } catch (err) {
          toast(`Could not read ${file.name}: ${errorMessage(err)}`);
        }
      }
      return;
    }
    if (/\.pdf$/i.test(file.name)) {
      await importPdf(file, this.scene, this.view);
      return;
    }
    if (isMetafile(file.name)) {
      await importMetafile(file, this.scene, this.view);
      return;
    }
    if (meshFormat(file.name)) {
      // a model dropped with no drawing open comes into a new, untitled one
      if (!store.session) await this.newDrawing();
      await importMesh(file, this.scene, this.view);
      return;
    }
    if (isRevitName(file.name)) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (isRevitModelName(file.name)) await this.openRevitModel(bytes, file.name);
        else await showRevitFile(bytes, file.name, this.view);
      } catch (err) {
        toast(`Could not read ${file.name}: ${errorMessage(err)}`);
      }
      return;
    }
    if (isArchicadName(file.name)) {
      await this.openArchicadModel(file, file.name);
      return;
    }
    const advice = exportAdvice(file.name);
    if (advice) {
      toast(`${advice}.`, "info");
      return;
    }
    if (isWorksheetFile(file.name)) {
      await importWorksheet(file);
      return;
    }
    try {
      tellFileIn(file, file.name, await this.openDocument(file, file.name, await handle));
    } catch (err) {
      toast(`Could not read ${file.name}: ${errorMessage(err)}`);
    }
  }

  /**
   * Opens a drawing in a tab of its own, or in place of the front one when `inPlace` (Revert,
   * which has asked about the changes, or the same drawing moved, as Save to Cloud does).
   */
  async openDocument(
    data: Uint8Array | Blob,
    name: string,
    handle: FileSystemFileHandle | null,
    inPlace = false,
    source: DocumentSource | null = null,
  ): Promise<Opened> {
    return this.openReading(name, async () => ({ data, name, handle }), inPlace, source);
  }

  /** File > Open Recent and the hub's Recent list: the overlay shows from the click, while the file is read. */
  private async openRecent(entry: RecentEntry): Promise<void> {
    let file: Blob | null = null;
    const opened = await this.openReading(entry.name, async () => {
      const read = await openRecentEntry(entry);
      file = read?.file ?? null;
      return read && { data: read.file, name: read.name, handle: read.handle };
    });
    if (file) tellFileIn(file, entry.name, opened);
  }

  /**
   * Opens a drawing behind the loading overlay: `read` gives its bytes or file, name and handle, or
   * null when it cannot be read (having said why). The file is read a slice at a time and decoded
   * in workers (inflate.ts), the bar showing how far it has got. The overlay's X cancels the open,
   * and so does starting another: the read stops at its next slice, but the parse after it cannot
   * stop midway, so a drawing cancelled then is parsed on and dropped. It opens in a tab of its
   * own, except that one from the same source as an open tab (a cloud file opened again, a live
   * drawing reloaded) takes that tab's place, asking first about its unsaved changes, and a file
   * open already brings its tab to the front. `read` can say what it is doing on the overlay
   * (`say`), and hears of a cancel through `signal`. Resolves with what came of it.
   */
  private async openReading(
    label: string,
    read: (
      say: (text: string) => void,
      signal: AbortSignal,
    ) => Promise<{ data: Uint8Array | Blob; name: string; handle: FileSystemFileHandle | null } | null>,
    inPlace = false,
    source: DocumentSource | null = null,
  ): Promise<Opened> {
    // the front drawing stays open behind the new one: it must be one that can be left now
    const why = inPlace ? null : leaveRefusal();
    if (why) {
      toast(why, "info");
      return "cancelled";
    }
    this.sync();
    const replacing = inPlace ? this.shown : this.tabOfSource(source);
    if (
      !inPlace &&
      replacing?.session.dirty &&
      !(await confirmDialog("Unsaved changes", `Discard unsaved changes to ${baseName(replacing.name)}?`, "Discard"))
    ) {
      return "cancelled";
    }
    this.cancelOpening?.();
    let cancelled = false;
    const reading = new AbortController();
    const cancel = (): void => {
      cancelled = true;
      reading.abort();
      done();
    };
    const done = showLoading(`Opening ${label}…`, cancel);
    this.cancelOpening = cancel;
    let name = label;
    let size = 0;
    try {
      const file = await read((text) => done.label(text), reading.signal);
      if (!file || cancelled) return "cancelled";
      name = file.name;
      size = file.data instanceof Uint8Array ? file.data.length : file.data.size;
      const open = inPlace || replacing || !file.handle ? null : await this.tabOfHandle(file.handle);
      if (cancelled) return "cancelled";
      if (open) {
        done();
        this.switchDrawing(open);
        toast(`${baseName(file.name)} is open already.`, "info");
        return "cancelled";
      }
      await nextPaint();
      if (cancelled) return "cancelled";
      const src = file.data instanceof Uint8Array ? bytesSource(file.data) : blobSource(file.data);
      const session = await openVwxStream(src, file.name, {
        ...inflater(),
        ...holdOptions(file.data, file.handle),
        onProgress: (f) => done.progress(f),
        signal: reading.signal,
      });
      // a click on the X during the parse runs now
      await nextTask();
      if (cancelled) return "cancelled";
      done();
      this.attach(session, file.name, file.handle, size, source, replacing);
      if (file.handle) void rememberRecent(file.handle);
      return "open";
    } catch (err) {
      if (cancelled) return "cancelled";
      toast(`Could not open ${name}: ${errorMessage(err)}`);
      reportFailure("open", err, { mb: Math.round((size / 1048576) * 10) / 10, source: source?.kind ?? "file" });
      return { error: errorMessage(err) };
    } finally {
      done();
      if (this.cancelOpening === cancel) this.cancelOpening = null;
    }
  }

  /** File > Revert: reopens the drawing from its file, dropping the changes made since it was saved. */
  private async revert(): Promise<void> {
    const handle = store.handle;
    if (!handle || !store.session?.dirty) return;
    const ok = await confirmDialog("Revert", `Revert to the saved ${store.fileName}? The changes since it was saved are lost.`, "Revert");
    if (!ok) return;
    try {
      const file = await handle.getFile();
      await this.openDocument(file, file.name, handle, true);
    } catch (err) {
      toast(`Could not revert: ${errorMessage(err)}`);
    }
  }

  /** View > Standard Views: the 3D view (built when needed) seen from a standard direction; with several panes, the active pane's. */
  private async standardView(preset: ViewPreset): Promise<void> {
    if (multiPane() && store.session) return this.turnActivePane("3d", preset);
    if (!store.view3d) await this.show3d();
    if (store.view3d) this.view3d?.setView(preset);
  }

  /** Model > Cut 2D Section and Cut 3D Section: on the 2D drawing, the section tool takes the line and side clicked, then hands back. */
  private startSection(kind: "2d" | "3d"): void {
    if (!canCut2DSection()) {
      toast(`Cut ${kind === "3d" ? "3D" : "2D"} Section works on 3D objects, symbols and plug-in objects: select them first.`, "info");
      return;
    }
    this.sectionKind = kind;
    if (store.view3d) this.toggle3d();
    if (this.controller.activeId !== "section2d") this.sectionFrom = this.controller.activeId;
    this.controller.setTool("section2d");
  }

  /** Modify > Hatch…: once a hatch is chosen, the Hatch tool takes its origin and turn on the 2D drawing, then hands back. */
  private async startHatch(): Promise<void> {
    if (!(await chooseHatch())) return;
    if (store.view3d) this.toggle3d();
    if (!CLICK_TOOLS.has(this.controller.activeId)) this.clicksFrom = this.controller.activeId;
    this.controller.setTool("hatch");
  }

  /** Modify > Drafting Aids > Create Dividing Lines…: the Dividing Lines tool takes its two clicks on the 2D drawing, then hands back. */
  private startDividing(): void {
    if (!startDividingLines()) return;
    if (store.view3d) this.toggle3d();
    if (!CLICK_TOOLS.has(this.controller.activeId)) this.clicksFrom = this.controller.activeId;
    this.controller.setTool("dividing");
  }

  /** Modify > Align > Align/Distribute Leader Lines…: once the dialog is set, the Leader Lines tool takes the reference line's two clicks on the 2D drawing, then hands back. */
  private async startLeaders(): Promise<void> {
    if (!(await startAlignLeaders())) return;
    if (store.view3d) this.toggle3d();
    if (!CLICK_TOOLS.has(this.controller.activeId)) this.clicksFrom = this.controller.activeId;
    this.controller.setTool("alignleaders");
  }

  /** Modify > Rotate 3D…: for Next Mouse Click, the center is clicked on the 2D drawing, then the tool hands back. */
  private startRotate3D(): void {
    void rotate3DDialog(this.scene, () => {
      if (store.view3d) this.toggle3d();
      if (!CLICK_TOOLS.has(this.controller.activeId)) this.clicksFrom = this.controller.activeId;
      this.controller.setTool("rotate3dcentre");
    });
  }

  /** AEC > Roof Face…: once the dialog is set, the Roof Face tool takes the axis' clicks on the 2D drawing, then hands back. */
  private async startRoofFace(): Promise<void> {
    if (!(await roofFaceDialog())) return;
    if (store.view3d) this.toggle3d();
    if (!CLICK_TOOLS.has(this.controller.activeId)) this.clicksFrom = this.controller.activeId;
    this.controller.setTool("roofaxis");
  }

  /** View > Standard Views > Top/Plan: back to the 2D drawing; with several panes, the active pane becomes a plan. */
  private topPlan(): void {
    if (multiPane() && store.session) void this.turnActivePane("plan");
    else if (store.view3d) this.toggle3d();
  }

  /**
   * The view a drawing's active design layer was saved in, if a 3D one: the 3D view takes its
   * direction, eye or centre, projection and render mode. Returns whether it did.
   */
  private lookAsLayer(): boolean {
    const layer = store.session?.doc.layers().find((l) => l.id === store.activeLayerId);
    const v = layer?.kind === "design" ? layer.view : undefined;
    if (!this.view3d || !v || (v.projection !== "perspective" && v.projection !== "orthogonal")) return false;
    const projection = v.projection === "perspective" ? "perspective" : "orthogonal";
    // the view takes it at once, through the viz3d topic
    if (store.viz3d.projection !== projection) setViz({ projection });
    const mode = MODE_OF_CODE.get(v.renderMode);
    if (mode && !(mode === "shaded" && this.renderMode3d === "textured")) this.setRenderMode(mode);
    this.view3d.lookAs({ toward: v.toward, at: v.at, perspective: projection === "perspective" });
    return true;
  }

  /**
   * Saves the view with the active design layer, as Vectorworks does, so it opens there: the 3D
   * view's while it shows, else Top/Plan once the 3D view has shown this drawing (a layer's saved
   * 3D view stays as it was while it hasn't).
   */
  private storeLayerView(): void {
    const s = store.session;
    const layer = s?.doc.layers().find((l) => l.id === store.activeLayerId);
    if (!s || !layer?.view || layer.kind !== "design" || !this.view3d || !this.shown3d) return;
    let view: LayerView = PLAN_VIEW;
    if (store.view3d) {
      const v = this.view3d.currentView();
      view = { projection: v.perspective ? "perspective" : "orthogonal", renderMode: CODE_OF_MODE[this.renderMode3d], right: v.right, up: v.up, toward: v.toward, at: v.at };
    } else if (layer.view.projection === "plan") {
      return;
    }
    this.savingView = true;
    try {
      attempt("Save the layer's view", (session) => session.setLayerView(layer.id, view));
    } finally {
      this.savingView = false;
    }
  }

  /** View > Rendering: how the 3D view draws the model, kept for when it is built. */
  private setRenderMode(mode: RenderMode): void {
    this.renderMode3d = mode;
    this.view3d?.setMode(mode);
    keep3d({ mode, projection: store.viz3d.projection });
    store.emit("view3d");
  }

  /** View > 3D View: shows or hides the 3D view of the visible design layers; with several panes, turns the active pane into the other kind. */
  toggle3d(): void {
    if (multiPane() && store.session) {
      void this.turnActivePane(store.view3d ? "plan" : "3d");
      return;
    }
    if (store.view3d) {
      this.view3d?.hide();
      store.view3d = false;
      store.emit("view3d");
      this.requestDraw();
    } else {
      void this.show3d();
    }
  }

  private async show3d(): Promise<void> {
    if (!store.session) return;
    const done = showLoading("Building the 3D model…");
    try {
      await nextPaint();
      const v = await this.create3d();
      // a model built for a floating pane while the view was hidden is framed too
      const reframe = this.stale3d || this.unframed3d;
      this.unframed3d = false;
      this.update3d();
      v.show();
      // a drawing's first 3D view is the one its active layer was saved in, if any
      const fresh = !this.shown3d;
      this.shown3d = true;
      if (!(fresh && this.lookAsLayer()) && reframe) v.setView("iso");
      store.view3d = true;
    } catch (err) {
      this.view3d?.hide();
      store.view3d = false;
      toast(`The 3D view could not start: ${errorMessage(err)}`);
    } finally {
      done();
    }
    store.emit("view3d");
  }

  /** The 3D view, made (not shown) the first time it is wanted. Throws when WebGL is unavailable. */
  private async create3d(): Promise<View3D> {
    if (!this.view3d) {
      const { View3D } = await import("./view3d.ts");
      this.view3d = new View3D(byId("view3d-host"));
      this.view3d.setInsets(this.view.insets);
      this.view3d.setMode(this.renderMode3d);
      this.view3d.setViz(store.viz3d);
      this.view3d.setDashes(this.dashes3d());
      this.view3d.onPick = (id, additive) => this.pick3d(id, additive);
      this.view3d.afterRender.add(() => this.queuePictures());
      view3dCreated(this.view3d);
    }
    return this.view3d;
  }

  /** For a floating 3D pane: the 3D view with the drawing's current model, built if need be without being shown; null without WebGL. */
  private async model3d(): Promise<View3D | null> {
    if (!store.session) return null;
    const done = this.stale3d ? showLoading("Building the 3D model…") : () => {};
    try {
      await nextPaint();
      const v = await this.create3d();
      v.prepare();
      this.update3d();
      return v;
    } catch (err) {
      toast(`The 3D view could not start: ${errorMessage(err)}`);
      return null;
    } finally {
      done();
    }
  }

  /** A floating plan pane's view in the live plan: the plan is made the active view first (with several panes, the live plan's pane, or the active pane turned into one). */
  private async takeFloatingPlan(at: PlanAt): Promise<void> {
    if (store.view3d) {
      if (!multiPane()) this.toggle3d();
      else if (livePlanPane() >= 0) this.setActive3d(false);
      else await this.turnActivePane("plan");
    }
    stopGlide();
    this.view.setCenterAndScale(at.cx, at.cy, at.scale);
    store.emit("view");
    this.requestDraw();
  }

  /** A floating 3D pane's view in the live 3D view: shown first (with several panes, the live 3D view's pane made active, or the active pane turned into one). */
  private async takeFloating3d(state: CameraState): Promise<void> {
    if (!store.view3d) {
      if (!multiPane()) await this.show3d();
      else if (livePane() >= 0 && this.view3d?.visible) this.setActive3d(true);
      else await this.turnActivePane("3d");
    }
    if (store.view3d) this.view3d?.setCameraState(state);
  }

  /** True while the 3D view is drawn: shown alone, or in its pane beside the plan. */
  private get live3d(): boolean {
    return store.view3d || (multiPane() && !!this.view3d?.visible);
  }

  /** True while the 3D model is seen: in the live 3D view, or in a floating pane. */
  private get seen3d(): boolean {
    return this.live3d || floating3d();
  }

  /**
   * Window > View Panes: several panes show the 3D view beside the plan (built now if it isn't yet)
   * when any of them is a 3D one, the active pane staying active, the other panes starting from
   * their standard views; one pane hides the 3D view unless it is the active one.
   */
  private async applyPanes(): Promise<void> {
    byId("stage").classList.toggle("two-panes", multiPane());
    this.paneCams.clear();
    this.planViews.clear();
    // the new 3D panes start in the render mode and projection shown, each changing on its own after
    this.paneLooks.clear();
    for (let i = 0; i < paneCount(); i++) if (paneKind(i) === "3d") this.paneLooks.set(i, this.look());
    if (!store.session) return;
    if (multiPane()) {
      if (livePane() < 0) {
        // every pane a plan: no 3D view
        this.view3d?.hide();
        this.setActive3d(false);
      } else if (this.view3d?.visible) {
        this.update3d();
      } else {
        const plan = !store.view3d;
        await this.show3d();
        // no WebGL: back to one pane (show3d has said why)
        if (!this.view3d?.visible) {
          setPaneLayout("single");
          return;
        }
        if (plan) this.setActive3d(false);
      }
      // every pane a 3D view: one of them is active
      if (livePlanPane() < 0) this.setActive3d(true);
      this.queuePictures(true);
      this.queuePlanPictures();
    } else {
      // one pane: no pictures, and no renderer for Path Traced ones
      this.refinePictures([]);
      this.view3d?.releasePanes();
      if (!store.view3d && this.view3d?.visible) this.view3d.hide();
    }
    this.requestDraw();
  }

  /** Makes the live 3D view's pane the active one, or the live plan's. */
  private setActive3d(on: boolean): void {
    if (store.view3d === on) return;
    store.view3d = on;
    store.emit("view3d");
  }

  /** The render mode and projection the 3D view shows now. */
  private look(): PaneLook {
    return { mode: this.renderMode3d, projection: store.viz3d.projection };
  }

  /**
   * A click in a 3D pane showing a picture: the live 3D view moves there, the pane it leaves
   * keeping its view and look as a picture; the pane becomes the active one.
   */
  private activatePane(i: number): void {
    if (!this.view3d?.visible || !pictureOf(i)) return;
    this.leave3d();
    setLivePane(i);
    this.take3d(i);
    store.view3d = true;
    store.emit("view3d");
  }

  /** Keeps the live 3D view's camera and look for the pane it is leaving. */
  private leave3d(): void {
    const v = this.view3d;
    const j = livePane();
    if (!v?.visible || j < 0) return;
    this.paneCams.set(j, v.cameraState());
    this.paneLooks.set(j, this.look());
  }

  /** The live 3D view, now in pane `i`, looks from where that pane's view was left (its standard view the first time), in its render mode and projection. */
  private take3d(i: number): void {
    const v = this.view3d;
    if (!v?.visible || i < 0) return;
    const host = byId("view3d-host");
    const cam = this.paneCams.get(i) ?? v.presetState(startView(i), host.clientWidth, host.clientHeight);
    const look = this.paneLooks.get(i) ?? this.look();
    // the View bar and the Visualization palette show the pane's own; the view takes them at once
    if (look.projection !== store.viz3d.projection) setViz({ projection: look.projection });
    if (look.mode !== this.renderMode3d) this.setRenderMode(look.mode);
    v.setCameraState(cam);
  }

  /**
   * A click in a plan pane showing a picture: the live plan moves there, at the zoom and place that
   * pane's view was left, the pane it leaves keeping its view as a picture; the pane becomes the
   * active one.
   */
  private activatePlanPane(i: number): void {
    if (!pictureOf(i)) return;
    this.leavePlan();
    setLivePlanPane(i);
    this.takePlan(i);
    store.view3d = false;
    store.emit("view3d", "view");
    this.requestDraw();
  }

  /** Keeps the live plan's zoom and place for the pane it is leaving. */
  private leavePlan(): void {
    const j = livePlanPane();
    if (j >= 0) this.planViews.set(j, { cx: this.view.cx, cy: this.view.cy, scale: this.view.scale });
  }

  /** The live plan, now in pane `i`, at the zoom and place that pane's view was left (as it is, the first time). */
  private takePlan(i: number): void {
    const at = this.planViews.get(i);
    if (at) this.view.setCenterAndScale(at.cx, at.cy, at.scale);
  }

  /**
   * With several panes, Top/Plan, 3D View and the standard views act on the active pane: it becomes
   * a plan, starting as the live plan is, or a 3D view seen from `preset` (isometric when none),
   * and takes the live view of its kind; the live view of the other kind it held moves to another
   * pane of that kind, when there is one.
   */
  private async turnActivePane(kind: PaneKind, preset?: ViewPreset): Promise<void> {
    const i = store.view3d ? livePane() : livePlanPane();
    if (i < 0) return;
    if (paneKind(i) === kind) {
      if (kind === "3d" && preset) this.view3d?.setView(preset);
      return;
    }
    if (kind === "plan") {
      this.leavePlan();
      this.paneCams.delete(i);
      this.paneLooks.delete(i);
      setPaneKind(i, "plan");
      if (livePane() >= 0) this.take3d(livePane());
      else this.view3d?.hide();
      store.view3d = false;
    } else {
      if (!this.view3d?.visible) {
        await this.show3d();
        if (!this.view3d?.visible) return;
      }
      this.leave3d();
      setPaneKind(i, "3d");
      this.paneLooks.set(i, this.look());
      this.takePlan(livePlanPane());
      this.view3d.setView(preset ?? "iso");
      store.view3d = true;
    }
    store.emit("view3d", "view");
    this.requestDraw();
    this.queuePictures(true);
    this.queuePlanPictures();
  }

  /** Draws the pictures of the 3D panes without the live view again, soon, when what they show has changed (or `force`). */
  private queuePictures(force = false): void {
    const v = this.view3d;
    if (!multiPane() || !v?.visible || (!force && v.lookVersion === this.picturedAt)) return;
    clearTimeout(this.picturesTimer);
    this.picturesTimer = window.setTimeout(() => this.drawPictures(), PICTURE_DELAY_MS);
  }

  private drawPictures(): void {
    const v = this.view3d;
    if (!multiPane() || !v?.visible) return;
    this.picturedAt = v.lookVersion;
    const refining: number[] = [];
    let traced = false;
    for (let i = 0; i < paneCount(); i++) {
      const canvas = pictureOf(i);
      if (!canvas || paneKind(i) !== "3d") continue;
      const look = this.paneLooks.get(i) ?? this.look();
      if (look.mode === "pathtraced") traced = true;
      if (this.picturePane(v, i, canvas, look)) refining.push(i);
    }
    // the Path Traced panes' own renderer goes once none is left
    if (!traced) v.releasePanes();
    this.refinePictures(refining);
  }

  /** Draws pane `i`'s picture; true while it is still refining (Path Traced). */
  private picturePane(v: View3D, i: number, canvas: HTMLCanvasElement, look: PaneLook): boolean {
    // a pane not yet used frames the visible model afresh in its standard view
    return v.picture(this.paneCams.get(i) ?? v.presetState(startView(i), canvas.clientWidth, canvas.clientHeight), canvas, look);
  }

  /** The Path Traced panes still refining take a sample more each frame, until they have their samples. */
  private refinePictures(panes: readonly number[]): void {
    cancelAnimationFrame(this.refineFrame);
    if (panes.length === 0) return;
    this.refineFrame = requestAnimationFrame(() => {
      const v = this.view3d;
      if (!multiPane() || !v?.visible) return;
      this.refinePictures(
        panes.filter((i) => {
          const canvas = pictureOf(i);
          return canvas !== null && paneKind(i) === "3d" && this.picturePane(v, i, canvas, this.paneLooks.get(i) ?? this.look());
        }),
      );
    });
  }

  /** Draws the pictures of the plan panes without the live plan again, soon. */
  private queuePlanPictures(): void {
    if (!multiPane()) return;
    clearTimeout(this.planPicturesTimer);
    this.planPicturesTimer = window.setTimeout(() => this.drawPlanPictures(), PICTURE_DELAY_MS);
  }

  private drawPlanPictures(): void {
    if (!multiPane()) return;
    for (let i = 0; i < paneCount(); i++) {
      const canvas = pictureOf(i);
      if (!canvas || paneKind(i) !== "plan" || !canvas.clientWidth || !canvas.clientHeight) continue;
      let pic = this.planPictures.get(i);
      if (!pic) {
        const view = new View();
        pic = { view, renderer: new Renderer(canvas, view, this.scene, PICTURE_OVERLAY) };
        this.planPictures.set(i, pic);
      }
      // a pane not yet used shows the plan as the live plan does now
      let at = this.planViews.get(i);
      if (!at) {
        at = { cx: this.view.cx, cy: this.view.cy, scale: this.view.scale };
        this.planViews.set(i, at);
      }
      pic.view.setCenterAndScale(at.cx, at.cy, at.scale);
      pic.renderer.renderNow(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio || 1);
    }
  }

  /** Gives the 3D view the current document's model when it is out of date. */
  private update3d(): void {
    const session = store.session;
    if (!this.view3d || !session || !this.stale3d) return;
    // hidden objects aren't in it (View > Hide Selected Objects)
    const hidden = hiddenObjects();
    const model = session.doc.model3d();
    this.view3d.setModel(hidden.size ? model.filter((m) => !hidden.has(m.objectId)) : model, session.doc.resources());
    this.view3d.setLights(session.doc.lights3d());
    // the dash style's dashes, as this drawing has them
    this.view3d.setDashes(this.dashes3d());
    this.view3d.setVisibleLayers(this.layers3d());
    this.stale3d = false;
    if (!this.view3d.visible) this.unframed3d = true;
    if (floating3d()) redrawFloating("3d");
  }

  /** Design layers the 3D view shows: those the plan shows, or every visible one while a sheet layer is active. */
  private layers3d(): Set<string> {
    let layers = this.scene.drawnLayers(store.activeLayerId).filter((l) => l.kind === "design");
    if (!layers.length) layers = this.scene.layers().filter((l) => l.kind === "design" && l.visibility !== "hidden");
    return new Set(layers.map((l) => l.id));
  }

  /** A click in the 3D view selects the object, making its layer active. */
  private pick3d(id: string | null, additive: boolean): void {
    const obj = id ? store.session?.doc.object(id) : null;
    if (!obj) {
      if (!additive) setSelection([]);
      return;
    }
    if (obj.layerId !== store.activeLayerId) setActiveLayer(obj.layerId);
    const next = new Set(additive ? store.selection : []);
    if (additive && next.has(obj.id)) next.delete(obj.id);
    else next.add(obj.id);
    setSelection(next);
  }

  /** A drawing just read and parsed: it goes in a tab of its own, or in place of `replacing` (when that is still open), and comes to the front fitted in the window. */
  private attach(
    session: EditSession,
    name: string,
    handle: FileSystemFileHandle | null,
    fileSize: number,
    source: DocumentSource | null,
    replacing: OpenDrawing | null,
  ): void {
    if (source?.readOnly) session = readOnlySession(session, () => toast("This drawing is view only"));
    this.stash();
    const d: OpenDrawing = {
      session,
      name,
      handle,
      source,
      fileSize,
      untitled: false,
      overwriteConfirmed: false,
      layerId: null,
      classIndex: null,
      selection: new Set<string>(),
      view: null,
    };
    const at = replacing ? this.drawings.indexOf(replacing) : -1;
    if (at >= 0) {
      this.autosave?.forget(this.drawings[at].session);
      this.drawings[at] = d;
    }
    else this.drawings.push(d);
    this.autosave?.track(session, () => ({
      name: store.session === session ? store.fileName : d.name,
      size: store.session === session ? store.fileSize : d.fileSize,
    }));
    this.present(d);
  }

  /** Shows `d` in the window: its active layer, class, selection and view as it was left, or fitted when it is new. */
  private present(d: OpenDrawing): void {
    this.shown = d;
    document.body.classList.toggle("read-only", !!d.source?.readOnly);
    this.detachSession?.();
    this.detachSession = d.session.onChange((e) => this.onDocChange(e));
    store.session = d.session;
    store.fileName = d.name;
    store.handle = d.handle;
    store.fileSize = d.fileSize;
    store.overwriteConfirmed = d.overwriteConfirmed;
    this.untitled = d.untitled;
    store.activeLayerId = d.layerId;
    if (d.classIndex !== null) store.activeClassIndex = d.classIndex;
    store.symbolEdit = null;
    store.editGroupId = null;
    store.editVertex = null;
    store.preselect = null;
    store.selection = d.selection;
    this.scene.setDocument(d.session.doc);
    this.snap.invalidate();
    this.controller.cancel();
    reconcile();
    this.stale3d = true;
    this.shown3d = this.live3d;
    if (this.live3d) {
      this.update3d();
      if (!this.lookAsLayer()) this.view3d?.setView("iso");
    }
    syncPlanRotation(this.view);
    if (d.view) {
      stopGlide();
      this.view.setCenterAndScale(d.view.cx, d.view.cy, d.view.scale);
      store.emit("view");
      this.requestDraw();
    } else {
      this.fit();
    }
    // several panes: the first drawing opened shows its 3D views beside the plan
    this.paneCams.clear();
    this.planViews.clear();
    if (multiPane() && !this.view3d?.visible) void this.applyPanes();
    store.emit("session", "file", "layer", "class", "selection");
    documentChanged(d.session, d.source);
  }

  /** Copies what the window shows of the front drawing (its name, file, layer, class, selection and view) into its tab. */
  private sync(): void {
    const d = this.shown;
    if (!d) return;
    d.name = store.fileName;
    d.handle = store.handle;
    d.fileSize = store.fileSize;
    d.overwriteConfirmed = store.overwriteConfirmed;
    d.untitled = this.untitled;
    // a symbol being edited stands in for the layer it was opened from
    const from = store.symbolEdit?.from;
    d.layerId = from ? from.layerId : store.activeLayerId;
    d.classIndex = store.activeClassIndex;
    d.selection = from ? new Set<string>() : store.selection;
    d.view = from ? { cx: from.cx, cy: from.cy, scale: from.scale } : { cx: this.view.cx, cy: this.view.cy, scale: this.view.scale };
  }

  /** Before another drawing comes to the front: the tool's work in progress ends in this one, a symbol being edited is left, and its tab keeps the rest. */
  private stash(): void {
    if (!this.shown) return;
    this.controller.cancel();
    if (store.symbolEdit) this.exitSymbol();
    this.sync();
  }

  /** A tab clicked, or Window > Drawings: brings `d` to the front as it was left, unless the front one can't be left now. */
  private switchDrawing(d: OpenDrawing): void {
    if (d === this.shown || !this.drawings.includes(d)) return;
    const why = leaveRefusal();
    if (why) {
      toast(why, "info");
      return;
    }
    this.stash();
    this.present(d);
  }

  /**
   * File > Close and a tab's ×: closes a drawing (the front one by default), asking first when it
   * has unsaved changes. The tab to its right comes to the front, or the one before; closing the
   * last goes back to the start page.
   */
  private async closeDrawing(d: OpenDrawing | null = this.shown): Promise<void> {
    if (!d) return;
    this.sync();
    if (d === this.shown) {
      const why = leaveRefusal();
      if (why) {
        toast(why, "info");
        return;
      }
    }
    if (d.session.dirty && !(await confirmDialog("Unsaved changes", `Close ${baseName(d.name)} and discard its unsaved changes?`, "Discard"))) return;
    const i = this.drawings.indexOf(d);
    if (i < 0) return;
    this.drawings.splice(i, 1);
    this.autosave?.forget(d.session);
    if (d !== this.shown) {
      this.redrawTabs();
      return;
    }
    this.controller.cancel();
    const next = this.drawings[Math.min(i, this.drawings.length - 1)];
    if (next) this.present(next);
    else this.clearWindow();
  }

  /**
   * File > Close All: closes every open drawing, those behind first, asking about each with
   * unsaved changes; one kept open (Cancel) stops it there.
   */
  private async closeAll(): Promise<void> {
    const order = [...this.drawings.filter((d) => d !== this.shown), ...(this.shown ? [this.shown] : [])];
    for (const d of order) {
      await this.closeDrawing(d);
      if (this.drawings.includes(d)) return;
    }
  }

  /** The last drawing closed: the window goes back to the start page. */
  private clearWindow(): void {
    this.shown = null;
    this.detachSession?.();
    this.detachSession = null;
    document.body.classList.remove("read-only");
    if (this.view3d?.visible) this.view3d.hide();
    store.view3d = false;
    store.session = null;
    store.fileName = "";
    store.handle = null;
    store.fileSize = 0;
    store.overwriteConfirmed = false;
    this.untitled = false;
    store.symbolEdit = null;
    store.editGroupId = null;
    store.editVertex = null;
    store.preselect = null;
    this.scene.setDocument(null);
    this.snap.invalidate();
    reconcile();
    this.stale3d = true;
    this.shown3d = false;
    this.paneCams.clear();
    this.planViews.clear();
    store.emit("session", "file", "layer", "class", "selection", "view3d");
    documentChanged(null, null);
    this.requestDraw();
  }

  /** The open drawings as their tabs show them. */
  private tabs(): DocTab[] {
    this.sync();
    return this.drawings.map((d) => ({
      name: baseName(d.name),
      title: d.source?.label ? `${d.name} · ${d.source.label}` : d.name,
      dirty: d.session.dirty,
      front: d === this.shown,
    }));
  }

  /** The open drawing that came from `source` (the same kind and id), if any. */
  private tabOfSource(source: DocumentSource | null): OpenDrawing | null {
    if (source?.id === undefined) return null;
    return this.drawings.find((d) => d.source?.kind === source.kind && d.source.id === source.id) ?? null;
  }

  /** The open drawing whose file is `handle`, if any. */
  private async tabOfHandle(handle: FileSystemFileHandle): Promise<OpenDrawing | null> {
    this.sync();
    for (const d of this.drawings) {
      try {
        if (d.handle && (await d.handle.isSameEntry(handle))) return d;
      } catch {
        // a handle that can no longer be read is not the same file
      }
    }
    return null;
  }

  private onDocChange(e: ChangeEvent): void {
    this.scene.invalidate(e);
    this.snap.invalidate();
    reconcile();
    // a layer's saved view changes no geometry
    if (this.savingView) {
      store.emit("session");
      return;
    }
    this.stale3d = true;
    // rebuilding a big model takes a moment: wait for a pause in the edits
    if (this.seen3d) {
      clearTimeout(this.rebuild3dTimer);
      this.rebuild3dTimer = window.setTimeout(() => this.update3d(), REBUILD_3D_DELAY_MS);
    }
    store.emit("session");
    const session = store.session;
    if (session) editMade(session, e, () => store.session === session);
  }

  async save(): Promise<void> {
    const session = store.session;
    if (!session) return;
    const source = documentSource();
    if (source?.readOnly) {
      toast("This drawing is view only");
      return;
    }
    if (source?.save) {
      // an upload takes a while: an edit made meanwhile isn't in it, so the drawing stays unsaved
      let editedSince = false;
      const off = session.onChange(() => (editedSince = true));
      try {
        const started = performance.now();
        const bytes = await documentBytes(session);
        const ms = performance.now() - started;
        if (ms > 1000) note(`File > Save: writing the drawing out took ${(ms / 1000).toFixed(1)} s`);
        await source.save(bytes);
        if (store.session === session && !editedSince) session.markSaved();
        store.emit("session", "file");
      } catch (err) {
        toast(`Save failed: ${errorMessage(err)}`);
      } finally {
        off();
      }
      return;
    }
    const handle = store.handle;
    if (!handle) {
      await this.saveAs();
      return;
    }
    if (!store.overwriteConfirmed) {
      if (!(await confirmDialog("Save", "Overwrite the original file?", "Overwrite"))) return;
      store.overwriteConfirmed = true;
    }
    this.storeLayerView();
    await this.writeFile(session, handle, true, () => {
      if (store.session === session) session.markSaved();
      store.emit("session", "file");
    });
  }

  /**
   * Writes the drawing to `handle`'s file (writeToFile), with the loading overlay up while a big
   * one takes its time: its X stops the save, leaving the file as it was. `saved` runs once it is
   * written, unless the drawing changed meanwhile (those changes aren't in it). Returns whether it
   * was written.
   */
  private async writeFile(session: EditSession, handle: FileSystemFileHandle, follow: boolean, saved: () => void): Promise<boolean> {
    let edited = false;
    const off = session.onChange(() => (edited = true));
    const stop = new AbortController();
    const overlay = slowLoading(`Saving ${baseName(handle.name)}…`, () => stop.abort());
    try {
      await writeToFile(session, handle, { follow, onProgress: (f) => overlay.progress(f), signal: stop.signal });
      if (!edited) saved();
      return true;
    } catch (err) {
      if (!stop.signal.aborted) toast(`Save failed: ${errorMessage(err)}`);
      return false;
    } finally {
      overlay.done();
      off();
    }
  }

  async saveAs(): Promise<void> {
    const session = store.session;
    if (!session) return;
    const suggested = this.untitled ? store.fileName : `${baseName(store.fileName)}-edited.vwx`;
    try {
      const target = await chooseSaveTarget(suggested);
      if (!target) return;
      this.storeLayerView();
      if (target.kind === "handle") {
        const written = await this.writeFile(session, target.handle, true, () => {
          if (store.session === session) session.markSaved();
        });
        if (!written) return;
        if (store.session === session) {
          store.handle = target.handle;
          store.fileName = target.handle.name;
          store.overwriteConfirmed = true;
          this.untitled = false;
        }
        void rememberRecent(target.handle);
      } else {
        await saveSnapshot(session, async () => downloadBlob(suggested, await documentBlob(session)), () => {
          if (store.session === session) session.markSaved();
        });
      }
      store.emit("session", "file");
    } catch (err) {
      toast(`Save failed: ${errorMessage(err)}`);
    }
  }

  /**
   * File > Save a Copy As…: the drawing as it stands to a file of its own, while the window goes
   * on working on the file it had, unsaved changes and all. Save as Template… (`template`) does
   * the same to a .sta, which New from Template… starts drawings from.
   */
  async saveCopyAs(template = false): Promise<void> {
    const session = store.session;
    if (!session) return;
    const suggested = template ? `${baseName(store.fileName)}.sta` : `${baseName(store.fileName)} copy.vwx`;
    try {
      const target = await chooseSaveTarget(suggested, template);
      if (!target) return;
      this.storeLayerView();
      if (target.kind === "handle") {
        if (!(await this.writeFile(session, target.handle, false, () => undefined))) return;
      } else {
        downloadBlob(suggested, await documentBlob(session));
      }
      const copy = target.kind === "handle" ? target.handle.name : suggested;
      toast(`Saved ${template ? "a template" : "a copy"} as ${copy}; you're still working on ${baseName(store.fileName)}.`, "info");
    } catch (err) {
      toast(`Save failed: ${errorMessage(err)}`);
    }
  }

  /** Whether an open drawing has changes to save. */
  anyUnsaved(): boolean {
    return this.drawings.some((d) => d.session.dirty);
  }

  /**
   * File > Save All: saves each open drawing with unsaved changes as Save would (asking where for
   * one never saved), the front one first, then brings back the one that was in front.
   */
  async saveAll(): Promise<void> {
    const front = this.shown;
    const unsaved = this.drawings.filter((d) => d.session.dirty).sort((a, b) => Number(b === front) - Number(a === front));
    if (!unsaved.length) {
      toast("Every open drawing is saved.", "info");
      return;
    }
    for (const d of unsaved) {
      if (!this.drawings.includes(d)) continue;
      if (d !== this.shown) {
        this.switchDrawing(d);
        // the front one couldn't be left (a tool's work in progress, say): stop here
        if (this.shown !== d) return;
      }
      await this.save();
    }
    if (front && this.shown !== front) this.switchDrawing(front);
    const left = this.drawings.filter((d) => d.session.dirty).length;
    if (left) toast(`${left} drawing${left === 1 ? " is" : "s are"} still unsaved.`, "info");
  }

  exportDxf(): void {
    const session = store.session;
    if (!session) return;
    // a big drawing's pictures are read back from its file for the export (withHeldImages)
    void withHeldImages(session.doc, () => {
      const text = toDxf(withoutHidden(session.doc));
      downloadBlob(`${baseName(store.fileName)}.dxf`, new Blob([text], { type: "application/dxf" }));
    }).catch((err: unknown) => toast(`DXF export failed: ${errorMessage(err)}`));
  }

  exportSvg(): void {
    const session = store.session;
    if (!session) return;
    const layerIds = this.scene.drawnLayers(store.activeLayerId).map((l) => l.id);
    void withHeldImages(session.doc, () => {
      const text = toSvg(withoutHidden(session.doc), layerIds);
      downloadBlob(`${baseName(store.fileName)}.svg`, new Blob([text], { type: "image/svg+xml" }));
    }).catch((err: unknown) => toast(`SVG export failed: ${errorMessage(err)}`));
  }

  /**
   * The page Export EPSF and Export Metafile write: the layers the drawing shows, together at the
   * active layer's scale. Null, said in a message, when nothing is drawn on them.
   */
  private exportPage(): DrawnPage | null {
    const session = store.session;
    if (!session) return null;
    const drawn = this.scene.drawnLayers(store.activeLayerId);
    const active = drawn.find((l) => l.id === store.activeLayerId) ?? drawn[0];
    const page = active ? layersPage(withoutHidden(session.doc), drawn.map((l) => l.id), paperScale(active)) : null;
    if (!page) toast("Nothing is drawn on the layers shown, so there's nothing to export.", "info");
    return page;
  }

  /** Says how many images an EPSF or metafile export left out, when it left any. */
  private imagesLeftOut(file: string, count: number): void {
    if (count > 0) toast(`Exported ${file} without its ${count} ${count === 1 ? "image" : "images"}: this format is written with vector objects only.`, "info");
  }

  /** File > Export > Export EPSF: the layers the drawing shows on one page, at the active layer's scale. */
  exportEps(): void {
    try {
      const page = this.exportPage();
      if (!page) return;
      const name = baseName(store.fileName);
      const eps = pageEps(page, name);
      downloadBlob(`${name}.eps`, new Blob([eps.text], { type: "application/postscript" }));
      this.imagesLeftOut(`${name}.eps`, eps.imagesLeftOut);
    } catch (err) {
      toast(`EPSF export failed: ${errorMessage(err)}`);
    }
  }

  /** File > Export > Export Metafile: the same page as Export EPSF, as a Windows enhanced metafile (EMF). */
  exportEmf(): void {
    try {
      const page = this.exportPage();
      if (!page) return;
      const name = baseName(store.fileName);
      const emf = pageEmf(page, name);
      downloadBlob(`${name}.emf`, new Blob([emf.bytes], { type: "image/emf" }));
      this.imagesLeftOut(`${name}.emf`, emf.imagesLeftOut);
    } catch (err) {
      toast(`Metafile export failed: ${errorMessage(err)}`);
    }
  }

  /**
   * File > Export OBJ, glTF, IFC, 3DS, Rhino 3DM, FBX, Collada, PLY and SketchUp: the 3D model of the
   * design layers the 3D view shows. A Rhino file also takes their 2D linework, so it may hold that alone.
   * The writers of the newer formats (and Rhino's WebAssembly) load when one is first used.
   */
  async exportModel(format: ModelFormat): Promise<void> {
    const session = store.session;
    if (!session) return;
    const layers = this.layers3d();
    const doc = withoutHidden(session.doc);
    const flat = format === "3dm" ? flatOf(doc, layers) : [];
    if (!doc.model3d().some((m) => layers.has(m.layerId) && m.triangles.length > 0) && flat.length === 0) {
      toast(format === "3dm" ? "No 3D objects or 2D linework on the visible design layers." : "No 3D objects on the visible design layers.", "info");
      return;
    }
    const done = format === "3dm" ? showLoading("Writing the Rhino file…") : format === "skp" ? showLoading("Writing the SketchUp file…") : () => {};
    try {
      await nextPaint();
      const name = baseName(store.fileName);
      if (format === "obj") downloadBlob(`${name}.obj`, new Blob([exportObj(doc, layers)], { type: "model/obj" }));
      else if (format === "ifc") downloadBlob(`${name}.ifc`, new Blob([exportIfc(doc, layers, store.fileName)], { type: "application/x-step" }));
      else if (format === "3ds") downloadBlob(`${name}.3ds`, new Blob([export3ds(doc, layers) as BlobPart], { type: "application/x-3ds" }));
      else if (format === "3dm") {
        const [{ export3dm }, rhino] = await Promise.all([import("../export/rhino.ts"), rhinoLib()]);
        const names = new Map(doc.layers().map((l) => [l.id, l.name]));
        downloadBlob(`${name}.3dm`, new Blob([export3dm(modelOf(doc, layers, true), flat, names, rhino) as BlobPart], { type: "model/vnd.3dm" }));
      } else if (format === "fbx") {
        const { exportFbx } = await import("../export/fbx.ts");
        downloadBlob(`${name}.fbx`, new Blob([exportFbx(modelOf(doc, layers, true)) as BlobPart], { type: "application/octet-stream" }));
      } else if (format === "dae") {
        const { exportCollada } = await import("../export/collada.ts");
        downloadBlob(`${name}.dae`, new Blob([exportCollada(modelOf(doc, layers, true))], { type: "model/vnd.collada+xml" }));
      } else if (format === "ply") {
        const { exportPly } = await import("../export/ply.ts");
        downloadBlob(`${name}.ply`, new Blob([exportPly(modelOf(doc, layers)) as BlobPart], { type: "application/octet-stream" }));
      } else if (format === "skp") {
        const { exportSkp } = await import("../export/skp.ts");
        const skp = exportSkp(doc, layers);
        downloadBlob(`${name}.skp`, new Blob([skp.bytes as BlobPart], { type: "application/vnd.sketchup.skp" }));
        const n = skp.texturesLeftOut;
        if (n) toast(`Exported ${name}.skp with ${n === 1 ? "one texture" : `${n} textures`} as colour: SketchUp keeps PNG and JPEG images only.`, "info");
      } else downloadBlob(`${name}.glb`, new Blob([await exportGlb(doc, layers)], { type: "model/gltf-binary" }));
    } catch (err) {
      toast(`${MODEL_FORMAT_NAMES[format]} export failed: ${errorMessage(err)}`);
    } finally {
      done();
    }
  }

  /** File > Export PDF…: asks which layers and page options, then downloads the PDF. */
  async exportPdf(): Promise<void> {
    const session = store.session;
    if (!session) return;
    const options = await askPdfOptions(session.doc, {
      title: "Export PDF",
      okLabel: "Export",
      activeLayerId: store.activeLayerId,
    });
    if (!options) return;
    try {
      const bytes = await withHeldImages(session.doc, () => toPdf(withoutHidden(session.doc), options));
      downloadBlob(`${baseName(store.fileName)}.pdf`, new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
    } catch (err) {
      toast(`PDF export failed: ${errorMessage(err)}`);
    }
  }

  /** File > Print…: the same dialog with a Print button; the PDF then goes to the print dialog. */
  async print(): Promise<void> {
    const session = store.session;
    if (!session) return;
    const options = await askPdfOptions(session.doc, {
      title: "Print",
      okLabel: "Print",
      activeLayerId: store.activeLayerId,
    });
    if (!options) return;
    try {
      printPdf(await withHeldImages(session.doc, () => toPdf(withoutHidden(session.doc), options)));
    } catch (err) {
      toast(`Print failed: ${errorMessage(err)}`);
    }
  }
}

/** the render modes the 3D view draws in, to check a kept one against */
const RENDER_MODES: readonly RenderMode[] = ["shaded", "textured", "wireframe", "hidden", "dashed", "sketch", "realistic", "pathtraced"];

/** the 3D conversion resolution last given to the core */
let turnStepsSet = 0;

/** Gives the core Preferences' 3D conversion resolution; whether it changed. */
function applyTurnSteps(): boolean {
  const steps = TURN_STEPS[prefs().resolution3d];
  if (steps === turnStepsSet) return false;
  turnStepsSet = steps;
  setTurnSteps(steps);
  return true;
}
