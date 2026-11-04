// Menu bar in the top bar: File, Edit, View, Modify, Model, AEC, Tools, Text, Window and Help, built from
// the panels in menu.ts and arranged as Window > Workspaces > Menus… set them. Items
// show their shortcut, toggles show a check mark, and items that do not apply are
// disabled. The drawing's context menu and the shortcuts take their commands from the
// rows as built, wherever Menus… put them. Also holds the in-page dialog shell (showDialog)
// that Move, Scale and the export dialog share.

import type { Pt } from "../core/index.ts";
import type { ModelFormat } from "../export/model3d.ts";
import type { MeshImportFormat } from "./meshImport.ts";
import { h } from "./dom.ts";
import { IS_MAC, menuButton, openContextMenu, shortcutText, type Item, type Row } from "./menu.ts";
import { combinationOf, registerMenus, rowForKeys, withMenuKeys } from "./menuKeys.ts";
import { arrangeMenus, registerMenuLayout } from "./menuLayout.ts";
import { UI_ICON } from "./icons.ts";
import {
  alignSelection,
  alignToGrid,
  arrangeSelection,
  canFitToPage,
  copySelection,
  cutSelection,
  deleteObjects,
  distributeSelection,
  duplicateSelection,
  editSelectedGroup,
  exitEditGroup,
  exitToTopLevel,
  fitToPage,
  flipSelection,
  groupSelection,
  moveBy,
  moveBy3D,
  unrotate3D,
  normalScale,
  paste,
  pasteInPlace,
  redo,
  rotateBy,
  rotateEachBy,
  invertSelection,
  scaleBy,
  selectAll,
  selectedGroup,
  setActiveLayer,
  setSelection,
  toggleGrid,
  toggleSnapGrid,
  toggleSnapObjects,
  undo,
  ungroupSelection,
  ZOOM_STEP,
  zoomBy,
  zoomToSelection,
  type AlignEdge,
} from "./commands.ts";
import { canCenterDrawing, canLocateOrigin, centerDrawingOnOrigin, locateInternalOrigin } from "./origin.ts";
import { editMarkerListDialog, lineThicknessDialog } from "./optionLists.ts";
import { canConvertToDimension, convertToDimensionSelection } from "./convertToDimension.ts";
import {
  canAddDimensions,
  canSplitDimension,
  chainPartAt,
  deleteWitnessLine,
  editDimension,
  splitDimension,
  startAddDimensions,
} from "./chainDimension.ts";
import { canJoin, joinSelection } from "./join.ts";
import { canJoinFillet, joinAndFillet } from "./joinFillet.ts";
import { canSimplifyMesh, simplifyMeshDialog } from "./simplifyMesh.ts";
import { canHatch } from "./hatchCommand.ts";
import { setSunPosition } from "./sunPosition.ts";
import { canExportWorksheet, exportWorksheetDialog } from "./worksheetExport.ts";
import { importWorksheetFile } from "./worksheetImport.ts";
import { exportShapefileDialog } from "./shapefileExport.ts";
import { set3dViewDialog } from "./set3dView.ts";
import { rotate3dViewDialog } from "./rotate3dView.ts";
import {
  canCompose,
  canConvertToGroup,
  canConvertTo3DPolygons,
  canConvertToLines,
  canConvertToPolygons,
  canConvertToPolylines,
  canDecompose,
  canSelectConnected,
  canSmooth,
  composeSelection,
  convertToGroupSelection,
  convertTo3DPolygonsSelection,
  convertToMeshSelection,
  convertToPolylinesSelection,
  canConvertToMesh,
  canExtrude,
  canMultiExtrude,
  canAddSolids,
  canCombineSolids,
  combineSolidsSelection,
  intersectSolidsSelection,
  taperedExtrudeSelection,
  extrudeSelection,
  multiExtrudeSelection,
  sweepSelection,
  canCreateContours,
  contourSelection,
  convertCopyToLinesSelection,
  convertCopyToPolygonsSelection,
  convertToLinesSelection,
  convertToPolygonsSelection,
  decomposeSelection,
  isSmoothed,
  selectConnectedObjects,
  smoothSelection,
} from "./compose.ts";
import { canCut2DSection, canCut3DSection } from "./cutSection.ts";
import { addSurface, clipSurface, hasClosedSelection, intersectSurface } from "./surfaces.ts";
import { canCombineIntoSurface, combineIntoSurface } from "./boundary.ts";
import { canSelectSimilar, isSymbolInstance, selectSameSymbol, selectSimilar } from "./selectSimilar.ts";
import { canConvertArc, convertArcToRadiusPolyline } from "./radiusPolyline.ts";
import { locateResource, RESOURCE_NAME, resourcesOf } from "./locateResource.ts";
import { canMakeLocalHatch, newHatchFromLocal } from "./localHatch.ts";
import { canAimLight, canSwitchLight, lightOf, setLightToView, setViewToLight, switchLight } from "./lightView.ts";
import { showVertexInObjectInfo } from "./panels/objectInfo.ts";
import { canCreateSimilar, createSimilar } from "./createSimilar.ts";
import { canCreateObjectsFromShapes, createObjectsFromShapesDialog } from "./aec.ts";
import { canExtrudeAlongPath, extrudeAlongPathDialog } from "./extrudeAlongPath.ts";
import { canCreateTreesFromLoci, treesFromLociDialog } from "./treesFromLoci.ts";
import { canSectionSolids, sectionSolidsDialog } from "./sectionSolids.ts";
import { canCreateHelixSpiral, helixSpiralDialog } from "./helixSpiral.ts";
import {
  canDrapeSurface,
  canExtendNurbs,
  canFilletSurface,
  canPlanarCaps,
  canRebuildNurbs,
  canRevolveWithRail,
  canStitchAndTrim,
  canSurfaceFromCurves,
  canUnfoldSurfaces,
  drapeSurfaceDialog,
  extendNurbsDialog,
  filletSurfaceDialog,
  planarCapsSelection,
  rebuildNurbsDialog,
  revolveWithRailSelection,
  stitchAndTrimSelection,
  surfaceFromCurvesSelection,
  unfoldSurfacesSelection,
} from "./powerPack.ts";
import { canMakeGradeLoci, gradeLociCommand } from "./grade.ts";
import { canAnalyseView, zoneOfVisualInfluenceDialog } from "./siteView.ts";
import { gridMethodEntry, importSurveyFileDialog } from "./surveyInput.ts";
import { createRetainingWall, retainingSelected } from "./retainingWall.ts";
import { importTreeSurveyDialog } from "./treeSurveyImport.ts";
import { canListVolumes, canMakeLimits, canMakePad, canMakeSection, gradeLimitsFromPadDialog, hasSiteModifiers, padFromGradeLimitsDialog, siteModelSectionDialog, siteModifiersShown, siteVolumeListDialog, toggleSiteModifiers } from "./siteCommands.ts";
import { canMakeBoundaryModel, canMakeSiteModel, canSendToSurface, hasSiteModel, sendToSurface, siteModelFromBoundaryDialog, siteModelFromSourceDialog, updateSiteModels, editSiteCrop, isSiteModel, siteModelSelected, startLabelEdit, startSiteEdit } from "./siteModel.ts";
import { canSimplify3DPolygons, simplify3DPolygonsDialog } from "./simplify3DPolygons.ts";
import { conductorSizingDialog } from "./conductorSizing.ts";
import { conduitSizingDialog } from "./conduitSizing.ts";
import { canCreatePipingRuns, createPipingRuns } from "./tools/piping.ts";
import { canMakeVegetationLine, vegetationLineDialog } from "./vegetationLine.ts";
import { importAdjacencyMatrixDialog } from "./adjacencyImport.ts";
import { canCreateSpacesFromPolys, createSpacesFromPolys, createSpacesFromWallsDialog, createWallsFromSpacesDialog, hasSpaces, updateSpacesDialog } from "./spaces.ts";
import { canPlaceStations, stationOnPolylineDialog } from "./stationOnPolyline.ts";
import { canPickUpRedline, canRestoreRedline, pickUpRedlines, restoreRedlines } from "./redlines.ts";
import { canMakePillar, pillarDialog } from "./pillar.ts";
import { canCreateViewport, createViewportDialog } from "./createViewport.ts";
import { canMakeSourceData, polysTo3DSourceDataDialog } from "./polysTo3DSourceData.ts";
import { canPolygonsToLoci, canStakesFromLoci, polygonsToLociDialog, stakesFromLociDialog } from "./lociCommands.ts";
import { canCreateSurfaceArray, surfaceArrayDialog } from "./surfaceArray.ts";
import { canValidate3DData, validate3DDataDialog } from "./validate3DData.ts";
import { canCreatePolysFromWalls, createPolysFromWallsDialog } from "./createPolysFromWalls.ts";
import { canDimensionExteriorWalls, dimensionExteriorWalls } from "./dimensionExteriorWalls.ts";
import { canCreateJoists, createJoistsDialog } from "./createJoists.ts";
import { canFrameWalls, wallFramerDialog } from "./wallFramer.ts";
import { canFrameRoof, roofFramerDialog } from "./roofFramer.ts";
import { canCreateAutoHybrid, createAutoHybrid, editAutoHybrid, isAutoHybrid, selectedAutoHybrid } from "./autoHybrid.ts";
import { canCreateRoof, createRoofDialog } from "./createRoof.ts";
import { canMoveGeographic, georeferencingDialog, moveGeographicDialog } from "./georef.ts";
import { beltLengthDialog, chainLengthDialog, conversionFactorsDialog, solutionOfTrianglesDialog, springCalculatorDialog } from "./calculators.ts";
import { simpleBeamDialog } from "./simpleBeam.ts";
import { customSelectionDialog } from "./customSelection.ts";
import { findModifyDialog } from "./findModify.ts";
import { organizationDialog } from "./organization.ts";
import { canSetUpPage, pageSetup } from "./pageSetup.ts";
import { unitsDialog } from "./unitsDialog.ts";
import { purgeDialog } from "./purge.ts";
import { batchRenameDialog } from "./batchRename.ts";
import { replaceFontDialog } from "./replaceFont.ts";
import { changeSymbolAttrsDialog } from "./changeSymbolAttrs.ts";
import { colorChartDialog } from "./colorChart.ts";
import { listSymbolsDialog } from "./listSymbols.ts";
import { canDuplicateAlongPath, duplicateAlongPathDialog } from "./duplicateAlongPath.ts";
import { hasNextView, hasPreviousView, nextView, previousView } from "./viewHistory.ts";
import { importResources } from "./resourceImport.ts";
import { canTraceBitmap, traceBitmapDialog } from "./traceBitmap.ts";
import { canEditCrop, editCropDialog, isCroppableImage } from "./imageCrop.ts";
import { disassociate, isAssociated } from "./assocDimensions.ts";
import { canSimplifyPolys, simplifyPolysDialog } from "./simplifyPolys.ts";
import { followHyperlink, isHyperlink } from "./hyperlink.ts";
import { canMakeAllByClass, canRemoveByClass, canSetDefaultAttributes, canUseDefaultAttributes, setAllByClass, setDefaultAttributes, useDefaultAttributes } from "./attributeCommands.ts";
import { arcIntoSegmentsDialog, canArcIntoSegments, canEvenDivide, canLineIntoSegments, evenDivideDialog, lineIntoSegmentsDialog } from "./segments.ts";
import { rulersShown, toggleRulers } from "./rulers.ts";
import { canEditWorksheet, editWorksheet } from "./worksheetEditor.ts";
import { createReportDialog } from "./createReport.ts";
import { isTitleBlock } from "./titleBlockData.ts";
import { titleBlockManager } from "./titleBlockManager.ts";
import { canCreateRecordFormat, editRecordFormatRows, newRecordFormat } from "./recordFormatEditor.ts";
import { alignDistributeDialog, alignDistributeRows } from "./alignDistribute.ts";
import { alignDistribute3dDialog } from "./alignDistribute3d.ts";
import { showHome } from "./welcome.ts";
import { canExportDatabase, exportDatabaseDialog } from "./exportDatabase.ts";
import { canCentroid, canEngineeringProperties, centroidDialog, engineeringPropertiesDialog } from "./engineeringProperties.ts";
import { threeDPropertiesDialog } from "./threeDProperties.ts";
import { canCreate3DFrom2D, create3DObjectFrom2D } from "./tools/partRecord.ts";
import { canVolumetricProperties, volumetricPropertiesDialog } from "./volumetricProperties.ts";
import { canMergeRecordFormats, canSplitRecordFormat, mergeRecordFormatsDialog, splitRecordFormatDialog } from "./mergeSplitRecords.ts";
import { attachRecordDialog, canAttachRecord, canDetachRecord, detachRecordDialog } from "./attachRecord.ts";
import { canReplaceWithSymbol, replaceWithSymbolDialog } from "./replaceWithSymbol.ts";
import { textureRows } from "./textureMapping.ts";
import { canPreviousSelection, previousSelection } from "./selectionHistory.ts";
import { canDeleteAllGuides, canHideGuides, canMakeGuide, canSelectGuides, canShowGuides, deleteAllGuides, makeGuide, selectGuides, showGuides } from "./guides.ts";
import { docTabsShown, setDocTabsShown } from "./docTabs.ts";
import { annotatableViewport, editAnnotations, editSymbol, exitSymbol, selectedSymbol } from "./symbolEdit.ts";
import { smartPointSettingsDialog, snapSettingsDialog } from "./panels/snapping.ts";
import { canRotatePlan, planRotated, startRotatePlan, toggleRotatedPlan } from "./planRotation.ts";
import { viewControlRows } from "./viewControl.ts";
import { displayModeRows } from "./displayModes.ts";
import { canHideObjects, canHideSelected, canUnhide, hideSelectedObjects, objectVisibilityDialog, showSelectedObjectsOnly, unhideObjects } from "./objectVisibility.ts";
import { openNotificationCenter } from "./notifications.ts";
import { activateClassOf, canActivateClassOf, canCreateClassFrom, canUpdateClassFrom, createClassFrom, updateClassFrom } from "./classFromObject.ts";
import { activeLayerScaleDialog, canSetActiveLayerScale } from "./layerScale.ts";
import { selectCoincidentDialog } from "./coincident.ts";
import { canCreateDividingLines } from "./dividingLines.ts";
import { canAlignLeaders } from "./leaderLines.ts";
import { canChangeSymbolFields, changeAllFieldsDialog, changeOneFieldDialog } from "./symbolFields.ts";
import { type RecentEntry, recentRows } from "./recent.ts";
import type { Palettes } from "./dock.ts";
import type { Scene } from "./scene.ts";
import { setViz, setZoomLineThickness, store } from "./state.ts";
import { formatLengthValue, lengthSuffix, millimetresPerUnit, parseLength } from "./units.ts";
import type { View } from "./view.ts";
import { preferencesDialog } from "./prefsDialog.ts";
import { textMenuRows } from "./textMenu.ts";
import { darkCanvas, setDarkCanvas, themeRows } from "./theme.ts";
import { projectionRows, renderModeRows, standardViewRows, type View3dActions } from "./viewbar.ts";
import { paneRows } from "./viewPanes.ts";
import { lookAtPlane, workingPlaneMenuRows } from "./workingPlanes.ts";
import { exitGroupOptionRows } from "./exitGroup.ts";
import { dataBarOptionRows } from "./databar.ts";
import { savePalettePositions, workspaceRows } from "./workspaces.ts";
import { openSmartOptions } from "./smartOptions.ts";
import { extensionContextRows, extensionMenus } from "./ext.ts";
import { toast } from "./toast.ts";
import { renderStyleRows } from "../features/render/styles.ts";
import "./menubar.css";
import "./dialogs.css";

export interface MenuActions extends View3dActions {
  /** File > New: a blank drawing, untitled */
  newDrawing(): void;
  /** File > New from Template…: a template (or any drawing) opened as a new, untitled drawing */
  newFromTemplate(): void;
  open(): void;
  /** File > Close: closes the drawing in front, asking first about unsaved changes */
  close(): void;
  /** File > Close All */
  closeAll(): void;
  /** Window > Drawings: the open drawings, the front one checked */
  drawingRows(): Row[];
  /** File > Open Recent: opens a listed drawing, read through its handle */
  openRecent(entry: RecentEntry): void;
  /** File > Revert: reopens the saved file, dropping the changes since */
  revert(): void;
  /** File > File Info…: what the active file is and holds */
  fileInfo(): void;
  save(): void;
  saveAs(): void;
  /** File > Save a Copy As… */
  saveCopyAs(): void;
  /** File > Save as Template…: a copy of the drawing as a .sta template */
  saveAsTemplate(): void;
  /** File > Save All */
  saveAll(): void;
  /** whether an open drawing has unsaved changes */
  anyUnsaved(): boolean;
  exportDxf(): void;
  exportSvg(): void;
  /** File > Export > Export EPSF */
  exportEps(): void;
  /** File > Export > Export Metafile */
  exportEmf(): void;
  exportPdf(): void;
  /** File > Export > Export Image File… */
  exportImage(): void;
  /** File > Export OBJ, glTF, IFC, 3DS, Rhino 3DM, FBX, Collada (SketchUp) and PLY: the 3D model the 3D view shows */
  exportModel(format: ModelFormat): void;
  /** File > Export STL…: the 3D model, or the active layer's or selection's part of it */
  exportStl(): void;
  /** File > Export KML…: the 3D model on the Earth, for Google Earth */
  exportKml(): void;
  /** File > Export USD…: the 3D model as USD, organized by layer or texture */
  exportUsd(): void;
  /** File > Publish…: chosen layers as one PDF or a file each */
  publish(): void;
  /** File > Import DXF… */
  importDxf(): void;
  /** File > Import DWG… */
  importDwg(): void;
  /** File > Import Image… */
  importImage(): void;
  /** File > Import PDF… */
  importPdf(): void;
  /** File > Import > Import Metafile… */
  importMetafile(): void;
  /** File > Import OBJ…, glTF…, 3DS…, STL…, IFC…, USD…, Rhino 3DM…, FBX…, Collada (SketchUp)…, Blender…, PLY… and SketchUp… */
  importMesh(format: MeshImportFormat): void;
  /** File > Import Shapefile… */
  importShapefile(): void;
  /** Model > Cut 2D Section and Cut 3D Section: the line and side are clicked on the drawing */
  cutSection(kind: "2d" | "3d"): void;
  /** Modify > Hatch…: the hatch is chosen in a dialog, then its origin and turn clicked on the drawing */
  hatch(): void;
  /** Modify > Drafting Aids > Create Dividing Lines…: their start and end are clicked, then the divisions given */
  dividingLines(): void;
  /** Modify > Align > Align/Distribute Leader Lines… */
  alignLeaders(): void;
  /** Modify > Rotate 3D…: with Next Mouse Click, the center is clicked on the drawing */
  rotate3D(): void;
  /** Edit > Paste as Bitmap */
  pasteAsBitmap(): void;
  print(): void;
  fit(): void;
  /** View > Fit to Objects: the selection, or every visible object with none selected */
  fitObjects(): void;
  /** View > 3D View */
  toggle3d(): void;
  /** Edit > Duplicate Array… */
  duplicateArray(): void;
  /** Modify > Create Symbol… */
  createSymbol(): void;
  /** View > Save View… */
  saveView(): void;
  /** Window > Palettes > Activate Object Info Palette: Object Info shown, its first field focused */
  activateObjectInfo(): void;
}

export interface MenuDeps {
  readonly scene: Scene;
  readonly view: View;
  readonly palettes: Palettes;
  readonly actions: MenuActions;
}

interface MenuDef {
  readonly title: string;
  readonly rows: readonly Row[];
}

/** the menus as built, with their default keys */
let builtMenus: readonly MenuDef[] = [];

/** The menus with each command's key as Menu Shortcuts… set it, each command remembered as it runs. */
function keyedMenus(): MenuDef[] {
  return withExtensionMenus(builtMenus).map((def) => ({ title: def.title, rows: remembered([def.title], withMenuKeys(def.title, def.rows)) }));
}

/** How many commands Edit > Recent Commands lists. */
const RECENT_COMMANDS = 10;
/** Menus whose commands Repeat Last Command does not run again: files, windows and help. */
const UNREPEATED_MENUS = new Set(["File", "Window", "Help"]);
/** Edit's commands it does not run again: undoing, the clipboard, and itself. */
const UNREPEATED_EDITS = new Set(["Undo", "Redo", "Cut", "Copy", "Paste", "Paste in Place", "Paste as Bitmap", "Repeat Last Command", "Recent Commands"]);

/** The commands run from the menus (or their keys, or a right-click), latest first, each as its menu path. */
let recentCommands: readonly (readonly string[])[] = [];

function repeatable(path: readonly string[]): boolean {
  return !UNREPEATED_MENUS.has(path[0]) && !(path[0] === "Edit" && UNREPEATED_EDITS.has(path[1]));
}

/** `rows` (under `path`) with each command that can be run again putting itself first in recentCommands when it has run. */
function remembered(path: readonly string[], rows: readonly Row[]): Row[] {
  return rows.map((row): Row => {
    if (row === "-") return row;
    const at = [...path, row.label];
    if (!repeatable(at)) return row;
    const items = row.items;
    if (items) return { ...row, items: typeof items === "function" ? () => remembered(at, items()) : remembered(at, items) };
    const run = row.run;
    if (!run) return row;
    return {
      ...row,
      run: () => {
        run();
        const key = at.join(SEP);
        recentCommands = [at, ...recentCommands.filter((p) => p.join(SEP) !== key)].slice(0, RECENT_COMMANDS);
      },
    };
  });
}

/** The command at menu path `path` as the menus stand now, or null when it is gone. */
function commandAt(path: readonly string[]): Item | null {
  let rows: readonly Row[] = keyedMenus().find((d) => d.title === path[0])?.rows ?? [];
  for (const label of path.slice(1, -1)) {
    const sub = rows.find((r): r is Item => r !== "-" && r.label === label);
    if (!sub?.items) return null;
    rows = typeof sub.items === "function" ? sub.items() : sub.items;
  }
  const row = rows.find((r): r is Item => r !== "-" && r.label === path.at(-1) && !!r.run);
  return row ?? null;
}

/** Whether the command at `path` is there and applies now. */
function canRunAt(path: readonly string[] | undefined): boolean {
  const row = path ? commandAt(path) : null;
  return !!row && (row.enabled?.() ?? true);
}

/** Runs the command at `path` again, when it applies now. */
function runAt(path: readonly string[] | undefined): void {
  const row = path ? commandAt(path) : null;
  if (row?.run && (row.enabled?.() ?? true)) row.run();
}

/** Runs the command at a menu path ("Tools › Quick Search…") when it is there and applies now; false when it isn't there. */
export function runMenuCommand(path: string): boolean {
  const at = path.split(SEP);
  if (!commandAt(at)) return false;
  runAt(at);
  return true;
}

/** Edit > Recent Commands: the commands run lately, latest first, each run again from here. */
function recentCommandRows(): Row[] {
  if (!recentCommands.length) return [{ label: "No Recent Commands", enabled: () => false }];
  // a label two menus share says which menu it is in
  const labels = recentCommands.map((p) => p.at(-1));
  return recentCommands.map((p): Item => ({
    label: labels.filter((l) => l === p.at(-1)).length > 1 ? p.join(SEP) : p.at(-1)!,
    enabled: () => canRunAt(p),
    run: () => runAt(p),
  }));
}

/** The separator in a submenu's path, "File › Export". */
const SEP = " › ";

/**
 * The built menus with the rows features add (ext.ts). A title's first segment is the menu and
 * the rest name submenus. Rows go straight after their `after` row when it is there, else at the
 * end after a separator. Submenus are copied, never changed: a fixed one gets a new array, and
 * one read when it opens gets a function that adds to what that returns.
 */
function withExtensionMenus(defs: readonly MenuDef[]): MenuDef[] {
  const out: { title: string; rows: Row[] }[] = defs.map((d) => ({ title: d.title, rows: [...d.rows] }));
  // the rows features added: a later row after the same anchor goes after them, in registration order
  const added = new Set<Row>();

  /** `rows` with `extra` after the row labelled `after` (when there is one), else at the end after a separator. */
  const place = (rows: readonly Row[], extra: readonly Row[], after?: string): Row[] => {
    const at = after === undefined ? -1 : rows.findIndex((r) => r !== "-" && r.label === after);
    if (at >= 0) {
      let end = at + 1;
      while (end < rows.length && added.has(rows[end])) end++;
      return [...rows.slice(0, end), ...extra, ...rows.slice(end)];
    }
    const sep: Row[] = rows.length > 0 && rows.at(-1) !== "-" ? ["-"] : [];
    return [...rows, ...sep, ...extra];
  };

  /** `rows` with `extra` in the submenu at `path` (its labels, from this level down), or null when there is none. */
  const into = (rows: readonly Row[], path: readonly string[], extra: readonly Row[], after?: string): Row[] | null => {
    if (path.length === 0) return place(rows, extra, after);
    const [label, ...rest] = path;
    const row = rows.find((r): r is Item => r !== "-" && r.label === label && r.items !== undefined);
    if (!row?.items) return null;
    const items = row.items;
    // a submenu read on opening cannot be searched now, so a path it does not reach puts the rows at its end
    const next: readonly Row[] | (() => readonly Row[]) | null =
      typeof items === "function"
        ? () => {
            const got = items();
            return into(got, rest, extra, after) ?? place(got, extra);
          }
        : into(items, rest, extra, after);
    if (!next) return null;
    return rows.map((r) => (r === row ? { ...row, items: next } : r));
  };

  for (const { title, rows, after } of extensionMenus()) {
    const extra = rows();
    if (!extra.length) continue;
    const [top, ...path] = title.split(SEP);
    let def = out.find((d) => d.title === top);
    if (!def) {
      def = { title: top, rows: [] };
      const at = out.findIndex((d) => d.title === "Window");
      out.splice(at < 0 ? out.length : at, 0, def);
    }
    // a submenu the path does not reach: the rows go to the end of the menu, so none are lost
    def.rows = into(def.rows, path, extra, after) ?? place(def.rows, extra);
    for (const r of extra) if (r !== "-") added.add(r);
  }
  return out;
}

/** Every menu as it stands, with the rows features add, for searching commands. */
export function allMenus(): readonly { title: string; rows: readonly Row[] }[] {
  return keyedMenus();
}

/** The rows of every menu that have a key, as "Menu › Item" and the key, in menu order. */
function keyedCommands(prefix: string, rows: readonly Row[]): [string, string][] {
  return rows.flatMap((row): [string, string][] => {
    if (row === "-") return [];
    const path = `${prefix} › ${row.label}`;
    if (row.items) return typeof row.items === "function" ? [] : keyedCommands(path, row.items);
    return row.keys ? [[path, row.keys]] : [];
  });
}

function menuDefinitions(deps: MenuDeps): MenuDef[] {
  const { scene, view, palettes, actions } = deps;
  const hasDoc = (): boolean => store.session !== null;
  const hasLayer = (): boolean => store.session !== null && store.activeLayerId !== null;
  const hasSelection = (): boolean => store.selection.size > 0;
  const hasTwo = (): boolean => store.selection.size >= 2;
  const hasThree = (): boolean => store.selection.size >= 3;
  const hasTwoClosed = (): boolean => hasClosedSelection(2);
  const hasGroupSelected = (): boolean => {
    const doc = store.session?.doc;
    return !!doc && [...store.selection].some((id) => doc.object(id)?.kind === "group");
  };
  const align = (label: string, edge: AlignEdge): Row => ({
    label,
    enabled: hasTwo,
    run: () => alignSelection(scene, edge),
  });

  return [
    {
      title: "File",
      rows: [
        { label: "New", run: () => actions.newDrawing() },
        { label: "New from Template…", run: () => actions.newFromTemplate() },
        { label: "Open…", keys: "⌘O", run: () => actions.open() },
        { label: "Open Recent", items: () => recentRows(actions.openRecent) },
        { label: "Close", enabled: hasDoc, run: () => actions.close() },
        { label: "Close All", enabled: hasDoc, run: () => actions.closeAll() },
        "-",
        { label: "Save", keys: "⌘S", enabled: hasDoc, run: () => actions.save() },
        { label: "Save As…", keys: "⇧⌘S", enabled: hasDoc, run: () => actions.saveAs() },
        { label: "Save a Copy As…", enabled: hasDoc, run: () => actions.saveCopyAs() },
        { label: "Save as Template…", enabled: hasDoc, run: () => actions.saveAsTemplate() },
        { label: "Save All", enabled: () => actions.anyUnsaved(), run: () => actions.saveAll() },
        { label: "Revert", enabled: () => !!store.handle && !!store.session?.dirty, run: () => actions.revert() },
        { label: "File Info…", enabled: hasDoc, run: () => actions.fileInfo() },
        "-",
        {
          label: "Import",
          items: [
            { label: "Import DXF…", run: () => actions.importDxf() },
            { label: "Import DWG…", run: () => actions.importDwg() },
            { label: "Import Image…", enabled: hasLayer, run: () => actions.importImage() },
            { label: "Import PDF…", enabled: hasLayer, run: () => actions.importPdf() },
            { label: "Import Metafile…", enabled: hasLayer, run: () => actions.importMetafile() },
            { label: "Import OBJ…", enabled: hasLayer, run: () => actions.importMesh("obj") },
            { label: "Import glTF…", enabled: hasLayer, run: () => actions.importMesh("gltf") },
            { label: "Import 3DS…", enabled: hasLayer, run: () => actions.importMesh("3ds") },
            { label: "Import STL…", enabled: hasLayer, run: () => actions.importMesh("stl") },
            { label: "Import IFC…", enabled: hasLayer, run: () => actions.importMesh("ifc") },
            { label: "Import USD…", enabled: hasLayer, run: () => actions.importMesh("usd") },
            { label: "Import Rhino 3DM…", enabled: hasLayer, run: () => actions.importMesh("3dm") },
            { label: "Import FBX…", enabled: hasLayer, run: () => actions.importMesh("fbx") },
            { label: "Import Collada (SketchUp)…", enabled: hasLayer, run: () => actions.importMesh("dae") },
            { label: "Import Blender…", enabled: hasLayer, run: () => actions.importMesh("blend") },
            { label: "Import PLY…", enabled: hasLayer, run: () => actions.importMesh("ply") },
            { label: "Import SketchUp…", enabled: hasLayer, run: () => actions.importMesh("skp") },
            { label: "Import Shapefile…", enabled: hasDoc, run: () => actions.importShapefile() },
            { label: "Import Worksheet…", enabled: hasDoc, run: () => importWorksheetFile() },
            { label: "Import Lighting Device Data…", enabled: hasDoc, run: () => void import("../features/theatre/patch/deviceDataDialogs.ts").then((m) => m.importDeviceDataDialog()) },
            { label: "Import Resources…", enabled: hasDoc, run: () => void importResources() },
          ],
        },
        {
          label: "Export",
          enabled: hasDoc,
          items: [
            { label: "Export PDF…", enabled: hasDoc, run: () => actions.exportPdf() },
            { label: "Export Image File…", enabled: hasDoc, run: () => actions.exportImage() },
            { label: "Export SVG", enabled: hasDoc, run: () => actions.exportSvg() },
            { label: "Export EPSF", enabled: hasDoc, run: () => actions.exportEps() },
            { label: "Export Metafile", enabled: hasDoc, run: () => actions.exportEmf() },
            { label: "Export DXF", enabled: hasDoc, run: () => actions.exportDxf() },
            { label: "Export Worksheet…", enabled: canExportWorksheet, run: () => void exportWorksheetDialog() },
            { label: "Export Database…", enabled: canExportDatabase, run: () => void exportDatabaseDialog() },
            { label: "Export Lighting Device Data…", enabled: hasDoc, run: () => void import("../features/theatre/patch/deviceDataDialogs.ts").then((m) => m.exportDeviceDataDialog()) },
            "-",
            { label: "Export OBJ", enabled: hasDoc, run: () => actions.exportModel("obj") },
            { label: "Export glTF", enabled: hasDoc, run: () => actions.exportModel("glb") },
            { label: "Export IFC", enabled: hasDoc, run: () => actions.exportModel("ifc") },
            { label: "Export 3DS", enabled: hasDoc, run: () => actions.exportModel("3ds") },
            { label: "Export Rhino 3DM", enabled: hasDoc, run: () => actions.exportModel("3dm") },
            { label: "Export FBX", enabled: hasDoc, run: () => actions.exportModel("fbx") },
            { label: "Export SketchUp", enabled: hasDoc, run: () => actions.exportModel("skp") },
            { label: "Export Collada (SketchUp)", enabled: hasDoc, run: () => actions.exportModel("dae") },
            { label: "Export PLY", enabled: hasDoc, run: () => actions.exportModel("ply") },
            { label: "Export STL…", enabled: hasDoc, run: () => actions.exportStl() },
            { label: "Export STEP (3D only)…", enabled: hasDoc, run: () => void import("./brepExport.ts").then((m) => m.exportBrepDialog("step")) },
            { label: "Export IGES (3D only)…", enabled: hasDoc, run: () => void import("./brepExport.ts").then((m) => m.exportBrepDialog("iges")) },
            { label: "Export USD…", enabled: hasDoc, run: () => actions.exportUsd() },
            { label: "Export KML…", enabled: hasDoc, run: () => actions.exportKml() },
            { label: "Export Shapefile…", enabled: hasDoc, run: () => void exportShapefileDialog() },
          ],
        },
        "-",
        { label: "Publish…", enabled: hasDoc, run: () => actions.publish() },
        { label: "Page Setup…", enabled: canSetUpPage, run: () => void pageSetup() },
        { label: "Title Block Manager…", enabled: hasDoc, run: () => void titleBlockManager() },
        {
          label: "Document Settings",
          enabled: hasDoc,
          items: [
            { label: "Georeferencing…", enabled: hasDoc, run: () => void georeferencingDialog() },
            { label: "Units…", enabled: hasDoc, run: () => void unitsDialog() },
          ],
        },
        { label: "Print…", keys: "⌘P", enabled: hasDoc, run: () => actions.print() },
      ],
    },
    {
      title: "Edit",
      rows: [
        { label: "Undo", keys: "⌘Z", enabled: () => store.session?.canUndo() ?? false, run: undo },
        { label: "Redo", keys: "⇧⌘Z", enabled: () => store.session?.canRedo() ?? false, run: redo },
        { label: "Repeat Last Command", enabled: () => canRunAt(recentCommands[0]), run: () => runAt(recentCommands[0]) },
        { label: "Recent Commands", items: recentCommandRows },
        "-",
        { label: "Cut", keys: "⌘X", enabled: hasSelection, run: cutSelection },
        { label: "Copy", keys: "⌘C", enabled: hasSelection, run: copySelection },
        { label: "Paste", keys: "⌘V", enabled: hasLayer, run: () => void paste(view) },
        { label: "Paste in Place", keys: "⌥⌘V", enabled: hasLayer, run: () => void pasteInPlace() },
        { label: "Paste as Bitmap", enabled: hasLayer, run: () => actions.pasteAsBitmap() },
        { label: "Duplicate", keys: "⌘D", enabled: hasSelection, run: () => duplicateSelection(view) },
        { label: "Duplicate Array…", enabled: hasSelection, run: () => actions.duplicateArray() },
        { label: "Duplicate Along Path…", enabled: canDuplicateAlongPath, run: () => void duplicateAlongPathDialog(scene) },
        { label: "Delete", keys: "⌫", enabled: hasSelection, run: () => deleteObjects([...store.selection]) },
        "-",
        { label: "Select All", keys: "⌘A", enabled: hasLayer, run: () => selectAll(scene) },
        { label: "Select Similar", enabled: canSelectSimilar, run: selectSimilar },
        { label: "Select Connected Objects", enabled: canSelectConnected, run: selectConnectedObjects },
        { label: "Select None", keys: "Esc", enabled: hasSelection, run: () => setSelection([]) },
        { label: "Invert Selection", enabled: hasLayer, run: () => invertSelection(scene) },
        { label: "Previous Selection", enabled: canPreviousSelection, run: previousSelection },
        "-",
        { label: "Create Similar Object", enabled: canCreateSimilar, run: createSimilar },
        "-",
        { label: "Preferences…", keys: "⌘,", run: () => void preferencesDialog() },
      ],
    },
    {
      title: "View",
      rows: [
        { label: "Zoom In", keys: "⌘=", enabled: hasDoc, run: () => zoomBy(view, ZOOM_STEP) },
        { label: "Zoom Out", keys: "⌘-", enabled: hasDoc, run: () => zoomBy(view, 1 / ZOOM_STEP) },
        { label: "Fit to Window", keys: "⌘0", enabled: hasDoc, run: () => actions.fit() },
        { label: "Fit to Objects", keys: "⌘6", enabled: hasDoc, run: () => actions.fitObjects() },
        { label: "Fit to Page Area", enabled: () => canFitToPage(scene), run: () => fitToPage(scene, view) },
        { label: "Normal Scale", enabled: () => hasDoc() && !store.view3d, run: () => normalScale(scene, view) },
        { label: "Zoom to Selection", enabled: hasSelection, run: () => zoomToSelection(scene, view) },
        { label: "Previous View", enabled: hasPreviousView, run: () => previousView(view) },
        { label: "Next View", enabled: hasNextView, run: () => nextView(view) },
        { label: "Save View…", enabled: hasDoc, run: () => actions.saveView() },
        { label: "Zoom Line Thickness", checked: () => store.zoomLineThickness, run: () => setZoomLineThickness(!store.zoomLineThickness) },
        "-",
        { label: "3D View", keys: "3", enabled: hasDoc, checked: () => store.view3d, run: () => actions.toggle3d() },
        { label: "Standard Views", enabled: hasDoc, items: standardViewRows(actions) },
        { label: "Rotate Plan", enabled: canRotatePlan, run: startRotatePlan },
        { label: "Rotated Top/Plan", keys: "⌘5", enabled: hasDoc, checked: () => !store.view3d && planRotated(), run: toggleRotatedPlan },
        { label: "Set 3D View…", enabled: hasDoc, run: () => void set3dViewDialog(scene, view) },
        { label: "Rotate 3D View…", enabled: hasDoc, run: () => void rotate3dViewDialog() },
        { label: "Look at Working Plane", enabled: hasDoc, run: () => void lookAtPlane() },
        { label: "Onscreen View Control", items: viewControlRows },
        { label: "Multiple View Panes", items: () => paneRows(() => true) },
        { label: "Rendering", enabled: () => store.view3d, items: renderModeRows(actions, false) },
        { label: "Renderworks Style", enabled: () => store.view3d, items: () => renderStyleRows(actions) },
        { label: "Projection", enabled: hasDoc, items: () => projectionRows(actions) },
        {
          label: "Clip Cube",
          enabled: () => store.view3d,
          checked: () => store.viz3d.clip.on,
          run: () => setViz({ clip: { ...store.viz3d.clip, on: !store.viz3d.clip.on } }),
        },
        { label: "Create Viewport…", enabled: canCreateViewport, run: () => void createViewportDialog() },
        {
          label: "Create Detail Viewport…",
          enabled: () => canCreateViewport() && store.selection.size === 1,
          run: () => void import("./detailViewport.ts").then((m) => m.createDetailViewportDialog()),
        },
        {
          label: "Create Section Viewport…",
          enabled: () => canCreateViewport() && store.selection.size === 1,
          run: () => void import("./sectionViewport.ts").then((m) => m.createSectionViewportDialog()),
        },
        {
          label: "Create Interior Elevation Viewport…",
          enabled: () => canCreateViewport() && store.selection.size === 1,
          run: () => void import("./interiorElevation.ts").then((m) => m.createInteriorElevationDialog()),
        },
        {
          label: "Create Horizontal Section Viewport…",
          enabled: () => canCreateViewport() && store.session?.doc.layers().find((l) => l.id === store.activeLayerId)?.kind === "design",
          run: () => void import("./sectionViewport.ts").then((m) => m.createHorizontalSectionDialog()),
        },
        {
          label: "Create Multiple Viewports…",
          keys: "⇧⌘M",
          enabled: canCreateViewport,
          run: () => void import("./multipleViewports.ts").then((m) => m.createMultipleViewportsDialog()),
        },
        {
          label: "Update Selected Viewports",
          enabled: () => {
            const doc = store.session?.doc;
            return !!doc && [...store.selection].some((id) => doc.viewport(id) !== null);
          },
          run: () => void import("./viewportUpdate.ts").then((m) => m.updateViewports(true)),
        },
        {
          label: "Update All Viewports",
          enabled: () => {
            const doc = store.session?.doc;
            return !!doc && doc.layers().some((l) => l.kind === "sheet" && doc.viewportIds(l.id).length > 0);
          },
          run: () => void import("./viewportUpdate.ts").then((m) => m.updateViewports(false)),
        },
        { label: "Set Sun Position…", enabled: hasDoc, run: () => void setSunPosition() },
        { label: "Set Lighting Options…", enabled: hasDoc, run: () => void import("./lightingOptions.ts").then((m) => m.lightingOptionsDialog()) },
        "-",
        { label: "Class Options", items: displayModeRows("classMode") },
        { label: "Layer Options", items: displayModeRows("layerMode") },
        "-",
        { label: "Unhide Objects", enabled: canUnhide, run: unhideObjects },
        { label: "Show Selected Objects Only", enabled: canHideSelected, run: () => showSelectedObjectsOnly(scene) },
        { label: "Hide Selected Objects", enabled: canHideSelected, run: hideSelectedObjects },
        { label: "Object Visibility…", enabled: canHideObjects, run: () => void objectVisibilityDialog() },
        { label: "Show or Hide Site Modifiers", enabled: hasSiteModifiers, checked: siteModifiersShown, run: toggleSiteModifiers },
        "-",
        { label: "Show Grid", keys: "⌘'", checked: () => store.showGrid, run: toggleGrid },
        { label: "Snap to Grid", keys: "⇧⌘'", checked: () => store.snapGrid, run: toggleSnapGrid },
        { label: "Snap to Objects", checked: () => store.snapObjects, run: toggleSnapObjects },
        { label: "Rulers", checked: rulersShown, run: toggleRulers },
        "-",
        { label: "Theme", items: themeRows() },
        { label: "Dark Canvas", checked: darkCanvas, run: () => setDarkCanvas(!darkCanvas()) },
      ],
    },
    {
      title: "Modify",
      rows: [
        { label: "Group", keys: "⌘G", enabled: hasTwo, run: groupSelection },
        { label: "Ungroup", keys: "⌘U", enabled: hasGroupSelected, run: ungroupSelection },
        { label: "Edit Group", keys: "⌘[", enabled: () => selectedGroup() !== null, run: editSelectedGroup },
        {
          label: "Exit Group",
          keys: "⌘]",
          // with no group open it leaves the symbol being edited, as Vectorworks' shortcut does
          enabled: () => store.editGroupId !== null || store.symbolEdit !== null,
          run: () => (store.editGroupId !== null ? exitEditGroup() : exitSymbol()),
        },
        {
          label: "Top Level",
          // out of every group open, and the symbol being edited, back to the drawing
          enabled: () => store.editGroupId !== null || store.symbolEdit !== null,
          run: () => {
            exitToTopLevel();
            exitSymbol();
          },
        },
        { label: "Edit Symbol", enabled: () => selectedSymbol() !== null, run: editSelectedSymbol },
        { label: "Edit Auto Hybrid", enabled: () => selectedAutoHybrid() !== null, run: () => editAutoHybrid() },
        { label: "Exit Symbol", enabled: () => store.symbolEdit !== null && !store.symbolEdit.viewport, run: exitSymbol },
        "-",
        {
          label: "Surfaces",
          enabled: hasTwoClosed,
          items: [
            { label: "Add Surface", enabled: hasTwoClosed, run: addSurface },
            { label: "Clip Surface", enabled: hasTwoClosed, run: clipSurface },
            { label: "Intersect Surface", enabled: hasTwoClosed, run: intersectSurface },
          ],
        },
        { label: "Combine into Surface", enabled: canCombineIntoSurface, run: combineIntoSurface },
        { label: "Compose", enabled: canCompose, run: composeSelection },
        { label: "Decompose", enabled: canDecompose, run: decomposeSelection },
        {
          label: "Join",
          enabled: () => canJoin() || canJoinFillet(),
          items: [
            { label: "Join", keys: "⌘J", enabled: canJoin, run: () => joinSelection(true) },
            { label: "Join (No Trim)", keys: "⇧⌘J", enabled: canJoin, run: () => joinSelection(false) },
            { label: "Join and Fillet", keys: "⌥⌘J", enabled: canJoinFillet, run: () => void joinAndFillet() },
          ],
        },
        { label: "Hatch…", enabled: canHatch, run: () => actions.hatch() },
        {
          label: "Convert",
          enabled: () =>
            canConvertToPolygons() || canConvertToLines() || canConvertToGroup() || canConvertToDimension() || canConvertTo3DPolygons() || canConvertToMesh() || canReplaceWithSymbol() || canStakesFromLoci(),
          items: [
            { label: "Stake Object from 3D Locus…", enabled: canStakesFromLoci, run: () => void stakesFromLociDialog() },
            { label: "Convert to Group", keys: "⌘K", enabled: canConvertToGroup, run: convertToGroupSelection },
            { label: "Convert to Polygons", enabled: canConvertToPolygons, run: convertToPolygonsSelection },
            { label: "Convert to Polylines", enabled: canConvertToPolylines, run: convertToPolylinesSelection },
            { label: "Convert to Lines", enabled: canConvertToLines, run: convertToLinesSelection },
            { label: "Convert Copy to Polygons", enabled: canConvertToPolygons, run: convertCopyToPolygonsSelection },
            { label: "Convert Copy to Lines", enabled: canConvertToLines, run: convertCopyToLinesSelection },
            { label: "Convert Object to Dimension", enabled: canConvertToDimension, run: convertToDimensionSelection },
            { label: "Convert to 3D Polygons", enabled: canConvertTo3DPolygons, run: convertTo3DPolygonsSelection },
            { label: "Convert to Mesh", enabled: canConvertToMesh, run: convertToMeshSelection },
            { label: "Replace with Symbol…", enabled: canReplaceWithSymbol, run: () => void replaceWithSymbolDialog() },
          ],
        },
        { label: "Simplify Mesh…", enabled: canSimplifyMesh, run: () => void simplifyMeshDialog() },
        {
          label: "Attributes",
          enabled: () => canMakeAllByClass() || canRemoveByClass() || canSetDefaultAttributes() || canUseDefaultAttributes(),
          items: [
            { label: "Make All Attributes by Class", enabled: canMakeAllByClass, run: () => setAllByClass(true) },
            { label: "Remove by Class Settings", enabled: canRemoveByClass, run: () => setAllByClass(false) },
            { label: "Use Default Attributes", enabled: canUseDefaultAttributes, run: useDefaultAttributes },
            { label: "Set Default Attributes", enabled: canSetDefaultAttributes, run: setDefaultAttributes },
          ],
        },
        {
          label: "Guides",
          enabled: hasDoc,
          items: [
            { label: "Make Guide", enabled: canMakeGuide, run: makeGuide },
            { label: "Show Guides", enabled: canShowGuides, run: () => showGuides(true) },
            { label: "Hide Guides", enabled: canHideGuides, run: () => showGuides(false) },
            { label: "Select Guides", enabled: () => canSelectGuides(scene), run: () => selectGuides(scene) },
            { label: "Delete All Guides", enabled: canDeleteAllGuides, run: deleteAllGuides },
          ],
        },
        { label: "Working Plane", enabled: hasDoc, items: workingPlaneMenuRows },
        { label: "Edit Crop…", enabled: () => canEditCrop() || siteModelSelected(), run: () => (siteModelSelected() ? editSiteCrop() : void editCropDialog()) },
        { label: "Trace Bitmap…", enabled: canTraceBitmap, run: () => void traceBitmapDialog() },
        {
          label: "Poly Smoothing",
          enabled: canSmooth,
          items: [
            { label: "No Smoothing", enabled: canSmooth, checked: () => isSmoothed("corner"), run: () => smoothSelection("corner") },
            { label: "Bezier Spline Smoothing", enabled: canSmooth, checked: () => isSmoothed("bezier"), run: () => smoothSelection("bezier") },
            { label: "Cubic Spline Smoothing", enabled: canSmooth, checked: () => isSmoothed("cubic"), run: () => smoothSelection("cubic") },
            { label: "Arc Smoothing", enabled: canSmooth, checked: () => isSmoothed("arc"), run: () => smoothSelection("arc") },
            { label: "Radius Smoothing", enabled: canSmooth, checked: () => isSmoothed("radius"), run: () => smoothSelection("radius") },
          ],
        },
        {
          label: "Drafting Aids",
          enabled: () => canArcIntoSegments() || canCreateDividingLines() || canEvenDivide() || canLineIntoSegments() || canSimplifyPolys(),
          items: [
            { label: "Arc into Segments…", enabled: canArcIntoSegments, run: () => void arcIntoSegmentsDialog() },
            { label: "Create Dividing Lines…", enabled: canCreateDividingLines, run: () => actions.dividingLines() },
            { label: "Even Divide…", enabled: canEvenDivide, run: () => void evenDivideDialog() },
            { label: "Line into Segments…", enabled: canLineIntoSegments, run: () => void lineIntoSegmentsDialog() },
            { label: "Simplify Polys…", enabled: canSimplifyPolys, run: () => void simplifyPolysDialog() },
          ],
        },
        { label: "Create Symbol…", enabled: hasSelection, run: () => actions.createSymbol() },
        "-",
        { label: "Send to Front", keys: "⌘F", enabled: hasSelection, run: () => arrangeSelection("front") },
        { label: "Send Forward", keys: "⌥⌘F", enabled: hasSelection, run: () => arrangeSelection("forward") },
        { label: "Send Backward", keys: "⌥⌘B", enabled: hasSelection, run: () => arrangeSelection("backward") },
        { label: "Send to Back", keys: "⌘B", enabled: hasSelection, run: () => arrangeSelection("back") },
        "-",
        { label: "Rotate Left 90°", keys: "⌘L", enabled: hasSelection, run: () => rotateBy(scene, 90) },
        { label: "Rotate Right 90°", keys: "⇧⌘L", enabled: hasSelection, run: () => rotateBy(scene, -90) },
        { label: "Rotate Each Left 90°", enabled: hasSelection, run: () => rotateEachBy(scene, 90) },
        { label: "Rotate Each Right 90°", enabled: hasSelection, run: () => rotateEachBy(scene, -90) },
        { label: "Rotate…", enabled: hasSelection, run: () => void rotateDialog(scene) },
        { label: "Rotate 3D…", enabled: hasSelection, run: () => actions.rotate3D() },
        { label: "Flip Horizontal", enabled: hasSelection, run: () => flipSelection(scene, "horizontal") },
        { label: "Flip Vertical", enabled: hasSelection, run: () => flipSelection(scene, "vertical") },
        { label: "Unrotate 3D Objects", keys: "⇧⌘0", enabled: hasSelection, run: unrotate3D },
        "-",
        {
          label: "Align",
          enabled: hasSelection,
          items: [
            { label: "Align/Distribute…", enabled: hasTwo, run: () => void alignDistributeDialog(scene) },
            { label: "Align/Distribute 3D…", keys: "⇧⌘=", enabled: hasTwo, run: () => void alignDistribute3dDialog() },
            { label: "Align/Distribute Leader Lines…", enabled: canAlignLeaders, run: () => actions.alignLeaders() },
            "-",
            align("Left", "left"),
            align("Centre", "centre"),
            align("Right", "right"),
            align("Top", "top"),
            align("Middle", "middle"),
            align("Bottom", "bottom"),
            "-",
            { label: "Align to Grid", enabled: hasSelection, run: () => alignToGrid(scene, view) },
          ],
        },
        {
          label: "Distribute",
          enabled: hasThree,
          items: [
            { label: "Horizontally", enabled: hasThree, run: () => distributeSelection(scene, "horizontal") },
            { label: "Vertically", enabled: hasThree, run: () => distributeSelection(scene, "vertical") },
          ],
        },
        "-",
        { label: "Scale Objects…", enabled: hasSelection, run: () => void scaleDialog(scene) },
        { label: "Move…", enabled: hasSelection, run: () => void moveDialog() },
        { label: "Move 3D…", enabled: hasSelection, run: () => void moveDialog(true) },
        { label: "Move Geographic…", enabled: () => canMoveGeographic(scene), run: () => void moveGeographicDialog(scene) },
      ],
    },
    {
      title: "Model",
      rows: [
        { label: "Extrude…", keys: "⌘E", enabled: canExtrude, run: () => void extrudeDialog("Create Extrude", extrudeSelection) },
        { label: "Multiple Extrude…", keys: "⌥⌘E", enabled: canMultiExtrude, run: () => void extrudeDialog("Create Multiple Extrude", multiExtrudeSelection) },
        { label: "Tapered Extrude…", keys: "⌥⌘U", enabled: canExtrude, run: () => void taperedExtrudeDialog() },
        { label: "Sweep…", enabled: canExtrude, run: () => void sweepDialog() },
        { label: "Extrude Along Path…", keys: "⌥⌘X", enabled: canExtrudeAlongPath, run: () => void extrudeAlongPathDialog() },
        "-",
        { label: "Add Solids", enabled: canAddSolids, run: () => combineSolidsSelection(false) },
        { label: "Subtract Solids", enabled: canCombineSolids, run: () => combineSolidsSelection(true) },
        { label: "Intersect Solids", keys: "⌥⌘I", enabled: canCombineSolids, run: intersectSolidsSelection },
        { label: "Section Solids…", keys: "⌥⌘T", enabled: canSectionSolids, run: () => void sectionSolidsDialog() },
        "-",
        { label: "Create Contours…", enabled: canCreateContours, run: () => void contoursDialog() },
        { label: "Create Surface Array…", enabled: canCreateSurfaceArray, run: () => void surfaceArrayDialog() },
        { label: "Cut 2D Section", enabled: canCut2DSection, run: () => actions.cutSection("2d") },
        { label: "Cut 3D Section", enabled: canCut3DSection, run: () => actions.cutSection("3d") },
        "-",
        { label: "Engineering Properties…", enabled: canEngineeringProperties, run: () => void engineeringPropertiesDialog() },
        { label: "Volumetric Properties…", enabled: canVolumetricProperties, run: () => void volumetricPropertiesDialog() },
        "-",
        {
          label: "3D Power Pack",
          enabled: hasDoc,
          items: [
            { label: "Create Helix-Spiral…", enabled: canCreateHelixSpiral, run: () => void helixSpiralDialog() },
            { label: "Create Planar Caps", keys: "⌥⌘Q", enabled: canPlanarCaps, run: planarCapsSelection },
            { label: "Create Surface from Curves", keys: "⌥⌘K", enabled: canSurfaceFromCurves, run: surfaceFromCurvesSelection },
            { label: "Create Drape Surface…", enabled: canDrapeSurface, run: () => void drapeSurfaceDialog() },
            { label: "Revolve with Rail", enabled: canRevolveWithRail, run: revolveWithRailSelection },
            { label: "Unfold Surfaces", enabled: canUnfoldSurfaces, run: unfoldSurfacesSelection },
            { label: "Create Fillet Surface…", keys: "⌥⌘Y", enabled: canFilletSurface, run: () => void filletSurfaceDialog() },
            { label: "Stitch and Trim Surfaces", enabled: canStitchAndTrim, run: stitchAndTrimSelection },
            { label: "Extend NURBS…", enabled: canExtendNurbs, run: () => void extendNurbsDialog() },
            { label: "Rebuild NURBS…", enabled: canRebuildNurbs, run: () => void rebuildNurbsDialog() },
          ],
        },
      ],
    },
    {
      title: "AEC",
      rows: [
        { label: "Create Auto Hybrid", enabled: canCreateAutoHybrid, run: () => void createAutoHybrid() },
        { label: "Create Objects from Shapes…", enabled: canCreateObjectsFromShapes, run: () => void createObjectsFromShapesDialog() },
        { label: "Create Polys from Walls…", enabled: canCreatePolysFromWalls, run: () => void createPolysFromWallsDialog() },
        { label: "Dimension Exterior Walls…", enabled: canDimensionExteriorWalls, run: () => void dimensionExteriorWalls() },
        { label: "Create Roof…", enabled: canCreateRoof, run: () => void createRoofDialog() },
        { label: "Pillar…", enabled: canMakePillar, run: () => void pillarDialog() },
        "-",
        {
          label: "Framing",
          enabled: hasDoc,
          items: [
            { label: "Create Joists…", enabled: canCreateJoists, run: () => void createJoistsDialog() },
            { label: "Roof Framer…", enabled: canFrameRoof, run: () => void roofFramerDialog() },
            { label: "Simple Beam Calculator…", enabled: hasDoc, run: () => void simpleBeamDialog() },
            { label: "Wall Framer…", enabled: canFrameWalls, run: () => void wallFramerDialog() },
          ],
        },
        {
          label: "Machine Design",
          enabled: hasDoc,
          items: [
            { label: "3D Properties…", enabled: canVolumetricProperties, run: () => void threeDPropertiesDialog() },
            { label: "Belt Length Calculator…", enabled: hasDoc, run: () => void beltLengthDialog() },
            { label: "Centroid…", enabled: canCentroid, run: () => void centroidDialog() },
            { label: "Chain Length Calculator…", enabled: hasDoc, run: () => void chainLengthDialog() },
            { label: "Conversion Factors…", enabled: hasDoc, run: () => void conversionFactorsDialog() },
            { label: "Create 3D Object From 2D", enabled: canCreate3DFrom2D, run: create3DObjectFrom2D },
            { label: "Solution of Triangles…", enabled: hasDoc, run: () => void solutionOfTrianglesDialog() },
            { label: "Spring Calculator…", enabled: hasDoc, run: () => void springCalculatorDialog() },
          ],
        },
        {
          label: "Electrical",
          enabled: hasDoc,
          items: [
            { label: "Conductor Sizing Calc…", enabled: hasDoc, run: () => void conductorSizingDialog() },
            { label: "Conduit Sizing Calc…", enabled: hasDoc, run: () => void conduitSizingDialog() },
            { label: "Create Piping Runs…", enabled: canCreatePipingRuns, run: () => void createPipingRuns() },
          ],
        },
        { label: "Existing Trees", enabled: hasDoc, items: [{ label: "Create Existing Trees from Loci…", enabled: canCreateTreesFromLoci, run: () => void treesFromLociDialog() }, { label: "Import Tree Survey File…", enabled: hasDoc, run: () => void importTreeSurveyDialog() }] },
        { label: "Plants", enabled: hasDoc, items: [{ label: "Vegetation Line…", enabled: canMakeVegetationLine, run: () => void vegetationLineDialog() }] },
        {
          label: "Space Planning",
          enabled: hasDoc,
          items: [
            { label: "Create Spaces from Polys", enabled: canCreateSpacesFromPolys, run: () => createSpacesFromPolys() },
            { label: "Create Spaces from Walls…", enabled: hasDoc, run: () => void createSpacesFromWallsDialog() },
            { label: "Create Walls from Spaces…", enabled: hasSpaces, run: () => void createWallsFromSpacesDialog() },
            { label: "Update Spaces…", enabled: hasSpaces, run: () => void updateSpacesDialog() },
            { label: "Import Adjacency Matrix…", enabled: hasDoc, run: () => void importAdjacencyMatrixDialog() },
          ],
        },
        { label: "Roads", enabled: hasDoc, items: [{ label: "Station on Polyline…", enabled: canPlaceStations, run: () => void stationOnPolylineDialog() }] },
        { label: "Survey Input", enabled: hasDoc, items: [{ label: "2D Polys to 3D Source Data…", enabled: canMakeSourceData, run: () => void polysTo3DSourceDataDialog() }, { label: "3D Polygons to 3D Loci…", enabled: canPolygonsToLoci, run: () => void polygonsToLociDialog() }, { label: "Grid Method Entry…", enabled: hasDoc, run: gridMethodEntry }, { label: "Import Survey File…", enabled: hasDoc, run: () => void importSurveyFileDialog() }] },
        {
          label: "Terrain",
          enabled: hasDoc,
          items: [
            { label: "Create 3D Loci at Grade Points", enabled: canMakeGradeLoci, run: gradeLociCommand },
            { label: "Create Grade Limits from Planar Pad…", enabled: canMakeLimits, run: () => void gradeLimitsFromPadDialog() },
            { label: "Create Retaining Wall Site Modifier…", enabled: retainingSelected, run: () => void createRetainingWall() },
            { label: "Create Planar Pad from Grade Limits…", enabled: canMakePad, run: () => void padFromGradeLimitsDialog() },
            { label: "Create Site Model Volume List…", enabled: canListVolumes, run: () => void siteVolumeListDialog() },
            { label: "Send to Surface", enabled: canSendToSurface, run: () => void sendToSurface() },
            { label: "Simplify 3D Polygons…", enabled: canSimplify3DPolygons, run: () => void simplify3DPolygonsDialog() },
            { label: "Site Model Section…", enabled: canMakeSection, run: () => void siteModelSectionDialog() },
            { label: "Site Model from Boundary…", enabled: canMakeBoundaryModel, run: () => void siteModelFromBoundaryDialog() },
            { label: "Site Model from Source Data…", enabled: canMakeSiteModel, run: () => void siteModelFromSourceDialog() },
            { label: "Update Site Model", enabled: hasSiteModel, run: () => updateSiteModels() },
            { label: "Edit Site Model Crop", enabled: hasSiteModel, run: () => editSiteCrop() },
            { label: "Edit Existing Contours", enabled: hasSiteModel, run: () => startSiteEdit("sitecontour", true) },
            { label: "Edit Proposed Contours", enabled: hasSiteModel, run: () => startSiteEdit("sitecontour", false) },
            { label: "Edit Existing Surface", enabled: hasSiteModel, run: () => startSiteEdit("sitesculpt", true) },
            { label: "Edit Proposed Surface", enabled: hasSiteModel, run: () => startSiteEdit("sitesculpt", false) },
            { label: "Add Contour Labels", enabled: hasSiteModel, run: () => startLabelEdit(true) },
            { label: "Edit Contour Labels", enabled: hasSiteModel, run: () => startLabelEdit(false) },
            { label: "Validate 3D Data", enabled: canValidate3DData, run: () => void validate3DDataDialog() },
            { label: "Zone of Visual Influence…", enabled: canAnalyseView, run: () => void zoneOfVisualInfluenceDialog() },
          ],
        },
      ],
    },
    {
      title: "Tools",
      rows: [
        { label: "Organization…", keys: "⇧⌘O", enabled: hasDoc, run: () => void organizationDialog() },
        { label: "Custom Selection…", enabled: hasLayer, run: () => void customSelectionDialog() },
        { label: "Find and Modify…", enabled: hasLayer, run: () => void findModifyDialog() },
        { label: "Class and Layer Mapping…", enabled: hasDoc, run: () => void import("./classLayerMapping.ts").then((m) => m.classLayerMappingDialog()) },
        "-",
        {
          label: "Records",
          enabled: hasDoc,
          items: [
            { label: "New Record Format…", enabled: canCreateRecordFormat, run: () => void newRecordFormat() },
            { label: "Edit Record Format", enabled: canCreateRecordFormat, items: editRecordFormatRows },
            { label: "Attach Record…", enabled: canAttachRecord, run: () => void attachRecordDialog() },
            { label: "Detach Record…", enabled: canDetachRecord, run: () => void detachRecordDialog() },
            "-",
            { label: "Change One Field…", enabled: canChangeSymbolFields, run: () => void changeOneFieldDialog() },
            { label: "Change All Fields…", enabled: canChangeSymbolFields, run: () => void changeAllFieldsDialog() },
            { label: "Merge Record Formats…", enabled: canMergeRecordFormats, run: () => void mergeRecordFormatsDialog() },
            { label: "Split Record Format…", enabled: canSplitRecordFormat, run: () => void splitRecordFormatDialog() },
            "-",
            {
              label: "Modify by Record…",
              enabled: () => (store.session?.doc.recordFormats().length ?? 0) > 0,
              run: () => void import("./modifyByRecord.ts").then((m) => m.modifyByRecordDialog()),
            },
          ],
        },
        {
          label: "Reports",
          enabled: hasDoc,
          items: [
            { label: "Create Report…", enabled: hasDoc, run: () => void createReportDialog() },
            { label: "Edit Worksheet…", enabled: canEditWorksheet, run: () => void editWorksheet() },
          ],
        },
        {
          label: "Utilities",
          enabled: hasDoc,
          items: [
            { label: "Batch Rename…", enabled: hasDoc, run: () => void batchRenameDialog() },
            { label: "Change Symbol Attrs…", enabled: hasDoc, run: () => void changeSymbolAttrsDialog() },
            { label: "Create Color Chart…", enabled: hasLayer, run: () => void colorChartDialog() },
            { label: "List Symbols…", enabled: hasDoc, run: () => void listSymbolsDialog() },
            { label: "Purge…", enabled: hasDoc, run: () => void purgeDialog() },
            { label: "Replace Font…", enabled: hasDoc, run: () => void replaceFontDialog() },
            { label: "Reset All Plug-Ins", enabled: hasDoc, run: () => void import("./resetPlugins.ts").then((m) => m.resetAllPluginsDialog()) },
          ],
        },
        {
          label: "Origin",
          enabled: hasDoc,
          items: [
            { label: "Locate Internal Origin", enabled: () => canLocateOrigin(scene), run: () => locateInternalOrigin(scene, view) },
            { label: "Center Drawing on Internal Origin…", enabled: () => canCenterDrawing(scene), run: () => void centerDrawingOnOrigin(scene, view) },
          ],
        },
        { label: "Check File Health…", enabled: hasDoc, run: () => void import("./fileHealth.ts").then((m) => m.fileHealthDialog(scene, view)) },
        { label: "Compress Images…", enabled: hasDoc, run: () => void import("./compressImages.ts").then((m) => m.compressImagesDialog()) },
        "-",
        {
          label: "Options",
          items: [
            { label: "Edit Marker List…", run: () => void editMarkerListDialog() },
            { label: "Line Thickness…", run: () => void lineThicknessDialog() },
            { label: "Preferences…", run: () => void preferencesDialog() },
          ],
        },
        { label: "Snap Settings…", run: () => void snapSettingsDialog() },
        { label: "Smart Point Settings…", run: () => void smartPointSettingsDialog() },
      ],
    },
    { title: "Text", rows: textMenuRows() },
    {
      title: "Window",
      rows: [
        { label: "Home Screen", run: showHome },
        "-",
        { label: "Workspaces", items: () => workspaceRows(palettes) },
        "-",
        {
          label: "Palettes",
          items: [
            { label: "Activate Object Info Palette", run: () => actions.activateObjectInfo() },
            "-",
            ...palettes.menuRows(),
            "-",
            { label: "Hide Enabled Palettes", keys: "⇧⌘P", checked: () => palettes.away, run: () => palettes.toggleAway() },
            { label: "Save Palette Positions", run: () => savePalettePositions(palettes) },
          ],
        },
        {
          label: "Palette Options",
          items: [
            { label: "Auto-Hide Docked Palettes", checked: () => palettes.docksAutoHidden, run: () => palettes.toggleDocksAutoHide() },
            { label: "Auto-Hide Floating Palettes", checked: () => palettes.floatingAutoHidden, run: () => palettes.toggleFloatingAutoHide() },
            { label: "Floating Palettes Can Dock to Each Other", checked: () => palettes.floatDocking, run: () => palettes.toggleFloatDocking() },
          ],
        },
        { label: "Object Info", keys: "⌘I", checked: () => palettes.isShown("objectInfo"), run: () => palettes.show("objectInfo") },
        { label: "Smart Options", keys: "`", enabled: () => !!store.session, run: () => openSmartOptions() },
        { label: "Notification Center", run: openNotificationCenter },
        { label: "Roll Up All Palettes", run: () => palettes.collapseAll(true) },
        { label: "Unroll All Palettes", run: () => palettes.collapseAll(false) },
        { label: "Fold Left Dock", checked: () => palettes.isFolded("left"), run: () => palettes.toggleFold("left") },
        { label: "Fold Right Dock", checked: () => palettes.isFolded("right"), run: () => palettes.toggleFold("right") },
        { label: "Auto-Hide Left Dock", checked: () => palettes.isAutoHidden("left"), run: () => palettes.toggleAutoHide("left") },
        { label: "Auto-Hide Right Dock", checked: () => palettes.isAutoHidden("right"), run: () => palettes.toggleAutoHide("right") },
        { label: "Compact Interface", checked: () => palettes.density === "compact", run: () => palettes.toggleDensity() },
        { label: "Use Full Screen", checked: () => !!document.fullscreenElement, run: toggleFullScreen },
        { label: "Edit Group and Object Visibility Options", items: exitGroupOptionRows },
        { label: "Data Bar Options", items: dataBarOptionRows },
        { label: "View Panes", items: () => paneRows(() => true) },
        "-",
        { label: "View Bar", checked: () => palettes.barShown("viewbar"), run: () => palettes.toggleBar("viewbar") },
        {
          label: "View Bar Options",
          items: [
            { label: "Display View Bar in Regular Mode", checked: () => palettes.viewBarMode === "regular", run: () => palettes.setViewBarMode("regular") },
            { label: "Display View Bar in Compact Mode", checked: () => palettes.viewBarMode === "compact", run: () => palettes.setViewBarMode("compact") },
            { label: "Display View Bar in Auto-Hide Mode", checked: () => palettes.viewBarMode === "autohide", run: () => palettes.setViewBarMode("autohide") },
            "-",
            { label: "Show View Bar Group Labels", checked: () => palettes.viewBarLabels, run: () => palettes.toggleViewBarLabels() },
          ],
        },
        { label: "Mode Bar", checked: () => palettes.barShown("modebar"), run: () => palettes.toggleBar("modebar") },
        { label: "Snapping Bar", checked: () => palettes.barShown("snapbar"), run: () => palettes.toggleBar("snapbar") },
        { label: "Reset Bars", enabled: () => palettes.barsMoved(), run: () => palettes.resetBars() },
        { label: "Top Bar", items: () => palettes.topRows() },
        "-",
        { label: "Reset Palette Layout", run: () => palettes.reset() },
        "-",
        { label: "Show Document Tabs", checked: docTabsShown, run: () => setDocTabsShown(!docTabsShown()) },
        { label: "Drawings", enabled: hasDoc, items: () => actions.drawingRows() },
      ],
    },
    {
      title: "Help",
      rows: [
        { label: "Keyboard Shortcuts…", run: () => void shortcutsDialog() },
        { label: "About Rodeo…", run: () => void aboutDialog() },
      ],
    },
  ];
}

/** Window > Use Full Screen: the window fills the screen, without the browser's bars, or comes back from it. */
function toggleFullScreen(): void {
  const done = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  done.catch(() => toast("The browser didn't allow full screen here.", "info"));
}

/** Help > Keyboard Shortcuts…: how the keys work, then every menu command's shortcut as set now. */
async function shortcutsDialog(): Promise<void> {
  const rows: [string, string][] = [
    ["Tools", "the key in each tool's tooltip, e.g. V Select, L Line, R Rectangle"],
    ["Tool modes", "1 to 4 pick the active tool's modes in the Mode bar"],
    ["Pan", "hold Space and drag, or drag with the middle button"],
    ["Zoom", "scroll or pinch (⌘-scroll when Preferences › Edit makes the wheel scroll); 0 fits the drawing"],
    ["3D view", "3 shows or hides it"],
    ["Nudge", "arrow keys; with ⇧ ten times as far"],
    ["Context menus", "right-click the drawing, a layer or class, a viewport or a palette's title bar"],
    ["Palette tabs", "drop a palette's title bar on another's to make it a tab; drag a tab out to separate it"],
    ["Changing keys", "Window › Workspaces › Tool Shortcuts… and Menu Shortcuts…"],
  ];
  const plain = (keys: string): string => (IS_MAC ? keys : keys.replace(/⌘/g, "Ctrl+").replace(/⇧/g, "Shift+").replace(/⌥/g, "Alt+"));
  const commands = keyedMenus().flatMap((def) => keyedCommands(def.title, def.rows));
  await showDialog({
    title: "Keyboard Shortcuts",
    okLabel: "Close",
    cls: "shortcuts-dialog",
    body: [
      h("dl", { cls: "shortcut-list" }, ...rows.flatMap(([what, keys]) => [h("dt", { text: what }), h("dd", { text: plain(keys) })])),
      h("h3", { cls: "shortcut-head", text: "Menu commands" }),
      h(
        "dl",
        { cls: "shortcut-list shortcut-commands" },
        ...commands.flatMap(([path, keys]) => [h("dt", { text: path }), h("dd", { cls: "shortcut-keys", text: shortcutText(keys) })]),
      ),
    ],
    check: () => ({ value: true }),
  });
}

/** Where this build's source is published. A modified copy offered over a network must point at its own source (AGPL-3.0 §13). */
const SOURCE_URL = "https://github.com/rodeobuild/rodeo";

/** Help > About Rodeo… */
async function aboutDialog(): Promise<void> {
  await showDialog({
    title: "About Rodeo",
    okLabel: "Close",
    body: [
      h("p", {
        text: "Rodeo is a drawing and 3D modelling tool that runs in your browser. It opens and saves Vectorworks files, opens AutoCAD DWG files and Revit projects, and imports DXF, PDF, images, OBJ, glTF, 3DS and IFC, with more formats to come.",
      }),
      h("p", { cls: "muted", text: "Files you open stay on this computer unless you save them to the cloud." }),
      h(
        "p",
        { cls: "muted" },
        "Rodeo is free software under the GNU Affero General Public License v3.0. ",
        h("a", { text: "Source code", attrs: { href: SOURCE_URL, target: "_blank", rel: "noopener" } }),
        ".",
      ),
      h(
        "p",
        { cls: "muted" },
        "IFC files are read with web-ifc (",
        h("a", { text: "MPL-2.0", attrs: { href: "licences/web-ifc.txt", target: "_blank", rel: "noopener" } }),
        "), Revit models with rvt-rs (",
        h("a", { text: "Apache-2.0", attrs: { href: "licences/rvt-rs.txt", target: "_blank", rel: "noopener" } }),
        ").",
      ),
    ],
    check: () => ({ value: true }),
  });
}

// ---- dialogs -------------------------------------------------------------

/** A dialog's check when OK is pressed: the value to resolve with, or a message and the control to focus. */
export type DialogCheck<T> = { value: T } | { error: string; focus?: HTMLElement };

export interface DialogSpec<T> {
  readonly title: string;
  /** the controls between the title and the error line */
  readonly body: readonly Node[];
  readonly okLabel: string;
  /** reads and checks the body; runs on submit */
  readonly check: () => DialogCheck<T>;
  /** extra class for the dialog box, e.g. a wider one */
  readonly cls?: string;
}

/** Focuses a control, and selects its text when it is a text field. */
function focusControl(el: HTMLElement): void {
  el.focus();
  if (el instanceof HTMLInputElement && el.type === "text") el.select();
}

/**
 * In-page modal with a title, a body of controls, an error line and Cancel / OK. Resolves with the
 * checked value, or null when cancelled (Cancel, Esc or a click outside the box). Every key stays
 * inside the dialog, so the window shortcuts do not run under it.
 */
export function showDialog<T>(spec: DialogSpec<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const error = h("p", { cls: "menu-dialog-error", attrs: { role: "alert" }, hidden: true });
    const backdrop = h("div", { cls: "menu-dialog-backdrop" });
    const finish = (value: T | null): void => {
      backdrop.remove();
      returnFocus?.focus();
      resolve(value);
    };

    const cancel = h("button", { cls: "btn", text: "Cancel", attrs: { type: "button" } });
    cancel.addEventListener("click", () => finish(null));
    const form = h(
      "form",
      {
        cls: spec.cls ? `menu-dialog ${spec.cls}` : "menu-dialog",
        attrs: { role: "dialog", "aria-modal": "true", "aria-label": spec.title },
      },
      h("h2", { cls: "menu-dialog-title", text: spec.title }),
      ...spec.body,
      error,
      h(
        "div",
        { cls: "menu-dialog-actions" },
        cancel,
        h("button", { cls: "btn primary", text: spec.okLabel, attrs: { type: "submit" } }),
      ),
    );
    // an edit clears the message, which was about the old values
    const clearError = (): void => {
      error.hidden = true;
    };
    form.addEventListener("input", clearError);
    form.addEventListener("change", clearError);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const result = spec.check();
      if ("value" in result) {
        finish(result.value);
        return;
      }
      error.textContent = result.error;
      error.hidden = false;
      if (result.focus) focusControl(result.focus);
    });
    // every key stays inside the dialog, so the window shortcuts do not run under it
    backdrop.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        finish(null);
      }
    });
    backdrop.addEventListener("pointerdown", (e) => {
      if (e.target === backdrop) finish(null);
    });
    backdrop.append(form);
    document.body.append(backdrop);
    const first = form.querySelector<HTMLElement>("input, select");
    if (first) focusControl(first);
  });
}

/** In-page yes/no question in place of window.confirm; resolves true when OK is chosen. */
export async function confirmDialog(title: string, message: string, okLabel: string): Promise<boolean> {
  const ok = await showDialog<true>({
    title,
    okLabel,
    body: [h("p", { cls: "menu-dialog-text", text: message })],
    check: () => ({ value: true }),
  });
  return ok === true;
}

// ---- number dialog -------------------------------------------------------

interface NumberField {
  readonly label: string;
  readonly value: number;
  /** shown after the field; "" for none */
  readonly unit: string;
  /** smallest accepted value */
  readonly min?: number;
}

/** In-page modal with labelled number fields. Resolves with the values in field order, or null when cancelled. */
function askNumbers(title: string, fields: readonly NumberField[], okLabel: string): Promise<number[] | null> {
  const inputs = fields.map((f) =>
    h("input", {
      cls: "menu-dialog-input",
      value: String(f.value),
      attrs: { type: "text", inputmode: "decimal", "aria-label": f.label },
    }),
  );
  return showDialog<number[]>({
    title,
    okLabel,
    body: fields.map((f, i) =>
      h(
        "label",
        { cls: "menu-dialog-field" },
        h("span", { cls: "menu-dialog-label", text: f.label }),
        inputs[i],
        f.unit ? h("span", { cls: "menu-dialog-unit", text: f.unit }) : null,
      ),
    ),
    check: () => {
      const values: number[] = [];
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const text = inputs[i].value.trim().replace(",", ".");
        const n = Number(text);
        if (text === "" || !Number.isFinite(n)) return { error: `${field.label}: enter a number.`, focus: inputs[i] };
        if (field.min !== undefined && n < field.min) {
          return { error: `${field.label}: must be at least ${field.min}.`, focus: inputs[i] };
        }
        values.push(n);
      }
      return { value: values };
    },
  });
}

async function scaleDialog(scene: Scene): Promise<void> {
  const v = await askNumbers("Scale Objects", [{ label: "Scale", value: 100, unit: "%", min: 0.01 }], "Scale");
  if (v) scaleBy(scene, v[0] / 100);
}

/** The extrusion Model > Extrude or Multiple Extrude last used, in millimetres; until then about a metre in whole document units. */
let lastExtrusion: number | null = null;

/** Model > Extrude… and Multiple Extrude…: asks for the extrusion in the document's units, then extrudes the selected shapes by it. */
async function extrudeDialog(title: string, extrude: (mm: number) => void): Promise<void> {
  const units = store.session?.doc.info.units;
  const suffix = lengthSuffix(units);
  const unit = millimetresPerUnit(units);
  const input = h("input", {
    cls: "menu-dialog-input",
    value: formatLengthValue(lastExtrusion ?? Math.max(1, Math.round(1000 / unit)) * unit, units),
    attrs: { type: "text", inputmode: "decimal", "aria-label": "Extrusion" },
  });
  const mm = await showDialog<number>({
    title,
    okLabel: "Extrude",
    body: [
      h(
        "label",
        { cls: "menu-dialog-field" },
        h("span", { cls: "menu-dialog-label", text: "Extrusion" }),
        input,
        suffix ? h("span", { cls: "menu-dialog-unit", text: suffix }) : null,
      ),
    ],
    check: () => {
      const v = parseLength(input.value, units);
      if (v === null || v <= 0) return { error: "Extrusion: enter a length more than 0.", focus: input };
      return { value: v };
    },
  });
  if (mm === null) return;
  lastExtrusion = mm;
  extrude(mm);
}

/** the taper the last tapered extrude was made with, offered again */
let lastTaper = 10;

/** Model > Tapered Extrude…: the Create Tapered Extrude dialog's height and taper angle; extrudes the selected shapes. */
async function taperedExtrudeDialog(): Promise<void> {
  const units = store.session?.doc.info.units;
  const suffix = lengthSuffix(units);
  const unit = millimetresPerUnit(units);
  const height = h("input", {
    cls: "menu-dialog-input",
    value: formatLengthValue(lastExtrusion ?? Math.max(1, Math.round(1000 / unit)) * unit, units),
    attrs: { type: "text", inputmode: "decimal", "aria-label": "Height (Z)" },
  });
  const taper = h("input", { cls: "menu-dialog-input", value: String(lastTaper), attrs: { type: "text", inputmode: "decimal", "aria-label": "Taper Angle" } });
  const field = (label: string, input: HTMLInputElement, unitText: string): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input, unitText ? h("span", { cls: "menu-dialog-unit", text: unitText }) : null);
  const r = await showDialog<{ mm: number; deg: number }>({
    title: "Create Tapered Extrude",
    okLabel: "OK",
    body: [
      field("Height (Z)", height, suffix),
      field("Taper Angle", taper, "°"),
      h("p", { cls: "muted", text: "A positive angle leans the sides in as they rise, a negative one out; 0 extrudes straight up." }),
    ],
    check: () => {
      const mm = parseLength(height.value, units);
      if (mm === null || mm <= 0) return { error: "Height (Z): enter a length more than 0.", focus: height };
      const deg = Number(taper.value.trim().replace(",", ".").replace(/°$/, ""));
      if (!Number.isFinite(deg) || Math.abs(deg) >= 90) return { error: "Taper Angle: enter an angle between -90° and 90°.", focus: taper };
      return { value: { mm, deg } };
    },
  });
  if (r === null) return;
  lastExtrusion = r.mm;
  lastTaper = r.deg;
  taperedExtrudeSelection(r.mm, r.deg);
}

/** the angles the last sweep was made with, offered again */
let lastSweep = { arc: 360, segment: 5.625 };

/** Model > Sweep…: the arc and segment angles, in degrees; sweeps the selected shapes. */
async function sweepDialog(): Promise<void> {
  const angle = (label: string, value: number): HTMLInputElement =>
    h("input", { cls: "menu-dialog-input", value: String(value), attrs: { type: "text", inputmode: "decimal", "aria-label": label } });
  const arc = angle("Arc angle", lastSweep.arc);
  const segment = angle("Segment angle", lastSweep.segment);
  const field = (label: string, input: HTMLInputElement): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input, h("span", { cls: "menu-dialog-unit", text: "°" }));
  const value = await showDialog<{ arc: number; segment: number }>({
    title: "Create Sweep",
    okLabel: "Sweep",
    body: [
      field("Arc angle", arc),
      field("Segment angle", segment),
      h("p", { cls: "muted", text: "Each shape stands up on the layer and turns about the upright through its left edge." }),
    ],
    check: () => {
      const a = Number(arc.value.replace(",", "."));
      if (!(a > 0 && a <= 360)) return { error: "Arc angle: enter more than 0 and at most 360.", focus: arc };
      const s = Number(segment.value.replace(",", "."));
      if (!(s > 0 && s <= 90)) return { error: "Segment angle: enter more than 0 and at most 90.", focus: segment };
      return { value: { arc: a, segment: s } };
    },
  });
  if (!value) return;
  lastSweep = value;
  sweepSelection(value.arc, value.segment);
}

/** the last Create Contours settings: planes square to this axis (2 level with the layer), from `start` every `interval` (mm; at first a foot in inch-based units, else a metre) */
let lastContours: { axis: 0 | 1 | 2; start: number; interval: number | null } = { axis: 2, start: 0, interval: null };

/** Model > Create Contours…: the planes' direction, where the first one is and the interval, in the document's units. */
async function contoursDialog(): Promise<void> {
  const units = store.session?.doc.info.units;
  const suffix = lengthSuffix(units);
  const planes = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Planes" } },
    ...(
      [
        ["2", "Horizontal (XY)"],
        ["1", "Vertical, across Y (XZ)"],
        ["0", "Vertical, across X (YZ)"],
      ] as const
    ).map(([value, text]) => h("option", { value, text })),
  );
  planes.value = String(lastContours.axis);
  const length = (label: string, mm: number): HTMLInputElement =>
    h("input", { cls: "menu-dialog-input", value: formatLengthValue(mm, units), attrs: { type: "text", inputmode: "decimal", "aria-label": label } });
  const start = length("First plane at", lastContours.start);
  const perUnit = millimetresPerUnit(units);
  const inchBased = perUnit >= 25.4 && Math.abs(perUnit / 25.4 - Math.round(perUnit / 25.4)) < 1e-9;
  const interval = length("Interval", lastContours.interval ?? (inchBased ? 304.8 : 1000));
  const field = (label: string, input: HTMLElement, unit: string): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input, unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null);
  const value = await showDialog<{ axis: 0 | 1 | 2; start: number; interval: number }>({
    title: "Create Contours",
    okLabel: "Create",
    body: [
      field("Planes", planes, ""),
      field("First plane at", start, suffix),
      field("Interval", interval, suffix),
      h("p", { cls: "muted", text: "Each selected object is cut by planes from the first one, every interval either way; each cut becomes a 3D polygon. Heights are from the layer's plane." }),
    ],
    check: () => {
      const s = parseLength(start.value, units);
      if (s === null) return { error: "First plane at: enter a length.", focus: start };
      const i = parseLength(interval.value, units);
      if (i === null || !(i > 0)) return { error: "Interval: enter a length more than 0.", focus: interval };
      return { value: { axis: Number(planes.value) as 0 | 1 | 2, start: s, interval: i } };
    },
  });
  if (!value) return;
  lastContours = value;
  contourSelection(value.axis, value.start, value.interval);
}

/**
 * Modify > Move… and Move 3D…: asks for the offsets in the document's units, then moves the
 * selection by them; Move 3D also raises it (a negative Z lowers it).
 */
async function moveDialog(three = false): Promise<void> {
  const units = store.session?.doc.info.units;
  const suffix = lengthSuffix(units);
  const labels = three ? ["X offset", "Y offset", "Z offset"] : ["Horizontal", "Vertical"];
  const inputs = labels.map((label) =>
    h("input", {
      cls: "menu-dialog-input",
      value: formatLengthValue(0, units),
      attrs: { type: "text", inputmode: "decimal", "aria-label": label },
    }),
  );
  const v = await showDialog<number[]>({
    title: three ? "Move 3D" : "Move",
    okLabel: "Move",
    body: labels.map((label, i) =>
      h(
        "label",
        { cls: "menu-dialog-field" },
        h("span", { cls: "menu-dialog-label", text: label }),
        inputs[i],
        suffix ? h("span", { cls: "menu-dialog-unit", text: suffix }) : null,
      ),
    ),
    check: () => {
      // typed lengths are read in the document's units; the move itself is in millimetres
      const values: number[] = [];
      for (let i = 0; i < labels.length; i++) {
        const mm = parseLength(inputs[i].value, units);
        if (mm === null) return { error: `${labels[i]}: enter a length.`, focus: inputs[i] };
        values.push(mm);
      }
      return { value: values };
    },
  });
  if (v) (three ? moveBy3D(v[0], v[1], v[2]) : moveBy(v[0], v[1]));
}

/** Modify > Rotate…: turns the selection about the centre of its bounds by a typed angle (counter-clockwise). */
async function rotateDialog(scene: Scene): Promise<void> {
  const input = h("input", {
    cls: "menu-dialog-input",
    value: "0",
    attrs: { type: "text", inputmode: "decimal", "aria-label": "Rotation angle" },
  });
  const deg = await showDialog<number>({
    title: "Rotate",
    okLabel: "Rotate",
    body: [
      h(
        "label",
        { cls: "menu-dialog-field" },
        h("span", { cls: "menu-dialog-label", text: "Angle" }),
        input,
        h("span", { cls: "menu-dialog-unit", text: "°" }),
      ),
      h("p", { cls: "muted", text: "Counter-clockwise; a negative angle turns clockwise." }),
    ],
    check: () => {
      const v = Number(input.value.trim().replace(",", ".").replace(/°$/, ""));
      return Number.isFinite(v) ? { value: v } : { error: "Angle: enter a number of degrees.", focus: input };
    },
  });
  if (deg !== null) rotateBy(scene, deg);
}

// ---- menus ---------------------------------------------------------------

/** The context menus whose commands come from the menu bar's rows, and the commands' shortcuts. */
export interface MenuBar {
  /** The menus as they stand (with the rows features add, the keys and the order Menus… set), for the menu bar's row of titles. */
  menus(): readonly { readonly title: string; readonly rows: readonly Row[] }[];
  /** Opens the drawing's menu at (x, y) in the window: for the selection when the click was on an object, else for the drawing. */
  /**
   * The drawing's right-click menu, for the object under the pointer (null for none), or when none
   * is, `behind`: one drawn there that the layer and class options keep from being selected;
   * `coincident`, every object a click there could pick, topmost first (Select Coincident Objects);
   * `pick`, where in the drawing the click was and how near counts as on a vertex.
   */
  drawing(x: number, y: number, under: string | null, behind?: ForceSelectable | null, coincident?: readonly string[], pick?: VertexPick): void;
  /** Runs the command a ⌘ combination is the key of (when it applies); false when it is no command's. */
  shortcut(e: KeyboardEvent): boolean;
}

/** The row labelled `label` in the menu titled `title`, or in one of its submenus. */
function rowOf(defs: readonly MenuDef[], title: string, label: string): Item {
  const find = (rows: readonly Row[]): Item | undefined => {
    for (const r of rows) {
      if (r === "-") continue;
      if (r.label === label) return r;
      const inner = r.items && typeof r.items !== "function" ? find(r.items) : undefined;
      if (inner) return inner;
    }
    return undefined;
  };
  const row = find(defs.find((d) => d.title === title)?.rows ?? []);
  if (!row) throw new Error(`openvwx: no menu row ${title} > ${label}`);
  return row;
}

/** An object a right-click is over that a click can't select, and Force Select for it. */
export interface ForceSelectable {
  readonly id: string;
  select(): void;
}

/** Where a right-click was in the drawing, and how near a vertex counts as on it (both in the drawing's units). */
export interface VertexPick {
  readonly at: Pt;
  readonly tol: number;
}

/** The vertex of the polygon or polyline `id` that `pick` is on (the nearest), or null. */
function vertexAt(id: string | null, pick: VertexPick | undefined): number | null {
  const s = pick && id !== null ? store.session?.doc.object(id)?.shape : null;
  if (!pick || !s || (s.kind !== "polygon" && s.kind !== "polyline")) return null;
  const points = s.kind === "polyline" && s.vertices ? s.vertices.map((v) => v.p) : s.points;
  let best: number | null = null;
  let near = pick.tol;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - pick.at.x, p.y - pick.at.y);
    if (d <= near) [best, near] = [i, d];
  });
  return best;
}

/** A right-click on the drawing: what applies to the selection, or to the drawing when it was not on an object. */
function drawingRows(
  defs: readonly MenuDef[],
  scene: Scene,
  under: string | null,
  behind: ForceSelectable | null,
  coincident: readonly string[],
  pick: VertexPick | undefined,
  showPalette: (id: string) => void,
): Row[] {
  const row = (title: string, label: string): Item => rowOf(defs, title, label);
  // Select Vertex in Object Info Palette: a vertex of the object under the pointer, or of a selected
  // polygon or polyline (an arc vertex is off its curve, where its handle is)
  const vertexOwner = [under, ...store.selection].find((id) => vertexAt(id, pick) !== null) ?? null;
  const vertexRows: Row[] =
    vertexOwner === null
      ? []
      : [
          {
            label: "Select Vertex in Object Info Palette",
            run: () => {
              showVertexInObjectInfo(vertexOwner, vertexAt(vertexOwner, pick) ?? 0);
              showPalette("objectInfo");
            },
          },
          "-",
        ];
  const hasSelection = (): boolean => store.selection.size > 0;
  // Top Level when it does more than Exit Group or Exit Symbol: a group open in another, or in the symbol
  const nested = (): boolean => {
    const doc = store.session?.doc;
    const id = store.editGroupId;
    if (!doc || id === null) return false;
    const up = doc.object(id)?.parentId ?? null;
    return (up !== null && doc.object(up)?.kind === "group") || store.symbolEdit !== null;
  };
  const exit: Row[] = [
    ...(store.editGroupId !== null ? [row("Modify", "Exit Group")] : []),
    ...(store.symbolEdit?.viewport ? [{ label: "Exit Viewport Annotation", run: exitSymbol }] : store.symbolEdit !== null ? [row("Modify", "Exit Symbol")] : []),
    ...(nested() ? [row("Modify", "Top Level")] : []),
  ];
  if (under === null) {
    // what the layer and class options keep from a click: selected, or its layer or class made active
    const forced: Row[] = behind
      ? [
          { label: "Force Select", run: () => behind.select() },
          {
            label: "Activate Layer",
            enabled: () => {
              const o = store.session?.doc.object(behind.id);
              return !!o && o.layerId !== store.activeLayerId;
            },
            run: () => {
              const o = store.session?.doc.object(behind.id);
              if (o) setActiveLayer(o.layerId);
            },
          },
          { label: "Activate Class", enabled: () => canActivateClassOf(behind.id), run: () => activateClassOf(behind.id) },
          "-",
        ]
      : [];
    const extra = extensionContextRows(null);
    return [
      ...vertexRows,
      ...forced,
      ...extra,
      ...(extra.length ? ["-" as const] : []),
      row("Edit", "Paste"),
      row("Edit", "Paste in Place"),
      row("Edit", "Repeat Last Command"),
      "-",
      row("Edit", "Select All"),
      row("Edit", "Select None"),
      "-",
      ...exit,
      "-",
      row("View", "Zoom In"),
      row("View", "Zoom Out"),
      row("View", "Fit to Window"),
      row("View", "Previous View"),
      "-",
      row("View", "Class Options"),
      row("View", "Layer Options"),
      { label: "Active Layer Scale…", enabled: canSetActiveLayerScale, run: () => void activeLayerScaleDialog() },
      "-",
      row("View", "Show Grid"),
      row("View", "Snap to Grid"),
      row("View", "Snap to Objects"),
      "-",
      row("Window", "Palettes"),
    ];
  }
  const sub = (label: string, title: string, labels: readonly string[]): Item => ({
    label,
    enabled: hasSelection,
    items: labels.map((l) => row(title, l)),
  });
  // a hyperlink's own command first, as Vectorworks has it
  const doc = store.session?.doc;
  const link: Row[] = doc && isHyperlink(doc, under) ? [{ label: "Open Link", run: () => followHyperlink(under) }, "-"] : [];
  // the object's own commands: a vertex's, a chain dimension's, a polyline's, a symbol instance's, a light's
  const light = lightOf(under);
  // a Renderworks camera on a design layer (a viewport's is edited with its viewport)
  const camera = store.session?.doc.cameras().find((c) => c.id === under && !c.viewportId) ?? null;
  const part = pick ? chainPartAt(under, pick.at, pick.tol) : null;
  const chain: Row[] = !part
    ? []
    : "witness" in part
      ? [
          { label: "Split Dimension", enabled: () => canSplitDimension(part), run: () => splitDimension(part) },
          { label: "Delete Witness Line", run: () => deleteWitnessLine(part) },
        ]
      : [
          { label: "Split Dimension", run: () => splitDimension(part) },
          {
            label: "Edit Dimension",
            run: () => {
              editDimension(part);
              showPalette("objectInfo");
            },
          },
        ];
  const locate: Row[] = resourcesOf(under).map((r) => ({
    label: `Locate ${RESOURCE_NAME[r.kind]} in Resource Manager`,
    run: () => locateResource(r, () => showPalette("resources")),
  }));
  const own: Row[] = [
    ...(annotatableViewport(under)
      ? [
          { label: "Edit Annotations", run: () => editAnnotations(under) },
          { label: "Update", run: () => void import("./viewportUpdate.ts").then((m) => m.updateViewports(false, under)) },
        ]
      : []),
    ...(canAddDimensions(under) ? [{ label: "Add Dimension(s)", run: () => startAddDimensions(under) }] : []),
    ...chain,
    ...(canConvertArc(under) ? [{ label: "Convert Arc to Radius Polyline", run: () => convertArcToRadiusPolyline(under) }] : []),
    ...(isSymbolInstance(under) ? [{ label: "Select Objects of Same Symbol", run: () => selectSameSymbol(under) }] : []),
    ...(canPickUpRedline() ? [{ label: "Pick up Redline", run: pickUpRedlines }] : []),
    ...(canRestoreRedline() ? [{ label: "Restore Redline", run: restoreRedlines }] : []),
    ...(light && canSwitchLight(under) ? [{ label: light.on ? "Turn Off" : "Turn On", run: () => switchLight(under) }] : []),
    ...(camera
      ? [
          {
            label: "Open Camera View in New Pane",
            run: () => void import("./floatingPanes.ts").then((m) => m.openCameraPane(camera, camera.name.trim() || "Camera")),
          },
        ]
      : []),
    ...(light && light.kind !== "point"
      ? [
          { label: "Set Light to View", enabled: () => canAimLight(under), run: () => setLightToView(under) },
          { label: "Set View to Light", run: () => void setViewToLight(under) },
        ]
      : []),
    ...(canMakeLocalHatch(under) ? [{ label: "New Hatch from Locally Mapped Hatch", run: () => void newHatchFromLocal(under) }] : []),
    ...(doc && isTitleBlock(doc, under)
      ? [{ label: "Duplicate on Layers…", run: () => void import("./duplicateOnLayers.ts").then((m) => m.duplicateOnLayersDialog(under)) }]
      : []),
    ...(isCroppableImage(under) ? [{ label: "Edit Crop…", run: () => void editCropDialog(under) }] : []),
    ...(isAssociated(under) ? [{ label: "Disassociate", run: () => disassociate(under) }] : []),
    ...(isCroppableImage(under) ? [{ label: "Edit Image Effects…", run: () => void import("./imageEffects.ts").then((m) => m.editImageEffectsDialog(under)) }] : []),
    ...(isSiteModel(under) ? [{ label: "Edit Crop…", run: () => editSiteCrop(under) }] : []),
    ...(isAutoHybrid(under) ? [{ label: "Edit", run: () => editAutoHybrid(under) }] : []),
    ...textureRows(under),
    ...extensionContextRows(under),
    ...locate,
  ];
  return [
    ...link,
    ...vertexRows,
    ...own,
    ...(own.length ? ["-" as const] : []),
    row("Edit", "Cut"),
    row("Edit", "Copy"),
    row("Edit", "Paste"),
    row("Edit", "Duplicate"),
    row("Edit", "Delete"),
    row("Edit", "Repeat Last Command"),
    "-",
    row("Modify", "Group"),
    row("Modify", "Ungroup"),
    row("Modify", "Edit Group"),
    row("Modify", "Edit Symbol"),
    ...exit,
    "-",
    sub("Arrange", "Modify", ["Send to Front", "Send Forward", "Send Backward", "Send to Back"]),
    sub("Rotate and Flip", "Modify", ["Rotate Left 90°", "Rotate Right 90°", "Rotate Each Left 90°", "Rotate Each Right 90°", "Rotate…", "Flip Horizontal", "Flip Vertical"]),
    { label: "Align/Distribute", enabled: () => store.selection.size >= 2, items: alignDistributeRows(scene, under) },
    "-",
    row("Edit", "Select Similar"),
    { label: "Select Coincident Objects…", enabled: () => coincident.length > 1, run: () => void selectCoincidentDialog(coincident) },
    row("Edit", "Create Similar Object"),
    row("View", "Zoom to Selection"),
    row("Modify", "Create Symbol…"),
    "-",
    { label: "Activate Class", enabled: () => canActivateClassOf(under), run: () => activateClassOf(under) },
    { label: "Create Class Using Object Attributes…", enabled: () => canCreateClassFrom(under), run: () => void createClassFrom(under) },
    { label: "Update Class Attributes from Object…", enabled: () => canUpdateClassFrom(under), run: () => void updateClassFrom(under) },
    "-",
    row("Window", "Object Info"),
  ];
}

/** Modify > Edit Symbol: opens the selected instance's definition. */
function editSelectedSymbol(): void {
  const index = selectedSymbol();
  if (index !== null) editSymbol(index);
}

/** Puts the menus behind the top bar's Menu button, as Spline does: each menu is a submenu of the panel it drops. */
export function mountMenuBar(button: HTMLButtonElement, deps: MenuDeps): MenuBar {
  builtMenus = menuDefinitions(deps);
  registerMenus(builtMenus);
  registerMenuLayout(builtMenus);
  button.innerHTML = UI_ICON.menu;
  menuButton(button, () => arrangeMenus(keyedMenus()).map((def): Row => ({ label: def.title, items: def.rows })));
  return {
    menus: () => arrangeMenus(keyedMenus()),
    drawing(x, y, under, behind = null, coincident = [], pick): void {
      openContextMenu(drawingRows(keyedMenus(), deps.scene, under, behind, coincident, pick, (id) => deps.palettes.show(id)), x, y);
    },
    shortcut(e): boolean {
      const keys = combinationOf(e);
      const row = keys ? rowForKeys(keyedMenus().flatMap((def) => def.rows), keys) : null;
      if (!row) return false;
      // a key whose command does not apply now is still taken, so the browser's (Save Page, Print) does not run
      if (row.enabled?.() ?? true) row.run?.();
      return true;
    },
  };
}
