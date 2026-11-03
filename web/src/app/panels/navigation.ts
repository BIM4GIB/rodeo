// The bodies of the side panels: Object Info, Attributes, Navigation (Layers,
// Classes, Stories, Sheets, Viewports and Saved Views tabs, the drawing's
// layers first as Spline lists a scene's objects) and Resources.

import type { Scene } from "../scene.ts";
import type { View } from "../view.ts";
import type { ToolId } from "../state.ts";
import { tabbed } from "../dock.ts";
import { h } from "../dom.ts";
import { TAB_ICON } from "../icons.ts";
import { mountClasses } from "./classes.ts";
import { mountLayers } from "./layers.ts";
import { mountAttributes, mountObjectInfo } from "./objectInfo.ts";
import { mountResources } from "./resources.ts";
import { mountStories } from "./stories.ts";
import { mountViewports } from "./viewports.ts";
import { mountViews, type SavedViews } from "./views.ts";
import "./views.css";

export interface PanelBodies {
  readonly objectInfo: HTMLElement;
  readonly attributes: HTMLElement;
  readonly navigation: HTMLElement;
  readonly resources: HTMLElement;
  readonly savedViews: SavedViews;
}

export function mountPanels(scene: Scene, view: View, setTool: (id: ToolId) => void): PanelBodies {
  const body = (): HTMLElement => h("div", { cls: "panel-body" });
  const objectInfo = h("div", { cls: "pal-fill" });
  const attributes = body();
  const designLayers = body();
  const sheetLayers = body();
  const viewports = body();
  const classes = body();
  const stories = body();
  const views = body();
  const resources = body();
  mountObjectInfo(objectInfo);
  mountAttributes(attributes);
  mountLayers(designLayers, "design");
  mountLayers(sheetLayers, "sheet");
  mountViewports(viewports, scene, view);
  mountClasses(classes);
  mountStories(stories);
  const savedViews = mountViews(views, view);
  mountResources(resources, setTool);
  const navigation = tabbed("navigation", [
    { id: "layers", label: "Layers", name: "Design Layers", title: "Design layers", icon: TAB_ICON.layers, body: designLayers },
    { id: "classes", label: "Classes", icon: TAB_ICON.classes, body: classes },
    { id: "stories", label: "Stories", icon: TAB_ICON.stories, body: stories },
    { id: "sheets", label: "Sheets", name: "Sheet Layers", title: "Sheet layers", icon: TAB_ICON.sheets, body: sheetLayers },
    { id: "viewports", label: "Viewports", icon: TAB_ICON.viewports, body: viewports },
    { id: "views", label: "Views", name: "Saved Views", title: "Saved views", icon: TAB_ICON.views, body: views },
  ]);
  return { objectInfo, attributes, navigation, resources, savedViews };
}
