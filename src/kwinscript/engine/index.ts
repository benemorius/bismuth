// SPDX-FileCopyrightText: 2018-2019 Eon S. Jeon <esjeon@hyunmu.am>
// SPDX-FileCopyrightText: 2021 Mikhail Zolotukhin <mail@gikari.com>
//
// SPDX-License-Identifier: MIT

import MonocleLayout from "./layout/monocle_layout";

import LayoutStore from "./layout_store";
import { WindowStore, WindowStoreImpl } from "./window_store";
import {
  EngineWindow,
  EngineWindowImpl,
  WindowConfig,
  WindowState,
} from "./window";

import { Controller } from "../controller";

import { DriverSurface } from "../driver/surface";

import { Rect, RectDelta } from "../util/rect";
import { overlap, wrapIndex } from "../util/func";
import { Config } from "../config";
import { Log } from "../util/log";
import { WindowsLayout } from "./layout";
import { DriverWindowImpl } from "../driver/window";
import { TSProxy } from "../extern/proxy";

export type Direction = "up" | "down" | "left" | "right";
export type CompassDirection = "east" | "west" | "south" | "north";
export type Step = -1 | 1;

/**
 * Maintains tiling context and performs various tiling actions.
 */
export interface Engine {
  /**
   * All the layouts currently available
   */
  layouts: LayoutStore;

  /**
   * All the windows we are interested in
   */
  windows: WindowStore;

  /**
   * Arrange all the windows on the visible surfaces according to the tiling rules
   */
  arrange(screen?: DriverSurface | null): void;

  /**
   * Register the given window to WM.
   */
  manage(window: EngineWindow): void;

  /**
   * Unregister the given window from WM.
   */
  unmanage(window: EngineWindow): void;

  restoreWindows(windows: EngineWindow[]): void;

  saveWindows(): void;

  /**
   * Adjust layout based on the change in size of a tile.
   *
   * This operation is completely layout-dependent, and no general implementation is
   * provided.
   *
   * Used when tile is resized using mouse.
   */
  adjustLayout(basis: EngineWindow): void;

  /**
   * Resize the current floating window.
   *
   * @param window a floating window
   */
  resizeFloat(window: EngineWindow, dir: CompassDirection, step: Step): void;

  /**
   * Resize the current tile by adjusting the layout.
   *
   * Used by grow/shrink shortcuts.
   */
  resizeTile(basis: EngineWindow, dir: CompassDirection, step: Step): void;

  /**
   * Resize the given window, by moving border inward or outward.
   *
   * The actual behavior depends on the state of the given window.
   *
   * @param dir which border
   * @param step which direction. 1 means outward, -1 means inward.
   */
  resizeWindow(window: EngineWindow, dir: CompassDirection, step: Step): void;

  /**
   * Re-apply window geometry, computed by layout algorithm.
   *
   * Sometimes applications move or resize windows without user intervention,
   * which is straight against the purpose of tiling WM. This operation
   * move/resize such windows back to where/how they should be.
   */
  enforceSize(window: EngineWindow): void;

  /**
   * @returns the layout we have on the surface of the active window
   */
  currentLayoutOnCurrentSurface(): WindowsLayout;

  /**
   * @returns the active window
   */
  currentWindow(): EngineWindow | null;

  /**
   * Focus next or previous window
   * @param step Direction to step in (1=forward, -1=backward)
   * @param includeHidden Whether to step through (true) or skip over (false) minimized windows
   */
  focusOrder(step: Step, includeHidden: boolean): void;

  /**
   * Focus a neighbor at the given direction.
   */
  focusDir(dir: Direction): void;

  /**
   * Swap the position of the current window with the next or previous window.
   */
  swapOrder(window: EngineWindow, step: Step): void;

  swapDirOrMoveFloat(dir: Direction): void;

  /**
   * Move the active window to the next surface in the given direction
   * @param direction The direction to move in
   */
  moveToSurfaceDir(direction: Direction): void;

  /**
   * Set the current window as the "master".
   *
   * The "master" window is simply the first window in the window list.
   * Some layouts depend on this assumption, and will make such windows more
   * visible than others.
   */
  setMaster(window: EngineWindow): void;

  cycleWindowBetweenStacks(window: EngineWindow): void;
  cycleFocusWithinStack(backwards: boolean): void;
  moveToMasterStack(window: EngineWindow, end?: boolean): void;

  /**
   * Toggle float mode of window.
   */
  toggleFloat(window: EngineWindow): void;

  /**
   * Change the layout of the current surface to the next.
   */
  cycleLayout(step: Step): void;

  /**
   * Set the layout of the current surface to the specified layout.
   */
  toggleLayout(layoutClassID: string): void;

  /**
   * Minimize all windows on the surface except the given window.
   */
  minimizeOthers(window: EngineWindow): void;

  /**
   * @returns true if the current layout is monocle and the option
   * to minimize other than active windows is enabled
   */
  isLayoutMonocleAndMinimizeRest(): boolean;

  // swapGroupToSurface(groupId: number): void;

  addWindowToGroup(group: string, window?: EngineWindow): void;

  moveWindowToSurface(window: EngineWindow, surface: DriverSurface): void;

  // swapSurfaceToScreen(surface: DriverSurface, screen: number): void;
  // swapSurfaceToActiveScreen(surfaceNum: number): void;
  summonGroupToSurface(group: string, surface: DriverSurface): void;
  summonGroupToActiveSurface(group: string): void;

  readonly currentSurface: DriverSurface;

  /**
   * Show a popup notification in the center of the screen.
   * @param text the main text of the notification.
   * @param icon an optional name of the icon to display in the pop-up.
   * @param hint an optional string displayed beside the main text.
   */
  showNotification(text: string, icon?: string, hint?: string): void;

  /**
   * Show the notification with the info
   * about the current layout.
   */
  showLayoutNotification(surface?: DriverSurface): void;
}

export class EngineImpl implements Engine {
  public layouts: LayoutStore;
  public windows: WindowStore;
  private groupMap: DriverSurface[];

  constructor(
    private controller: Controller,
    private config: Config,
    private proxy: TSProxy,
    private log: Log
  ) {
    this.layouts = new LayoutStore(this.config, this.proxy);
    this.windows = new WindowStoreImpl(config, log);

    // set initial groupId for each surface to its screen number
    this.groupMap = [];
    // for (let screen = 0; screen < this.controller.screens().length; screen++) {
    //   this.groupMap.push(this.controller.screens()[screen]);
    // }
  }

  public get currentSurface(): DriverSurface {
    return this.controller.currentSurface;
  }

  public adjustLayout(basis: EngineWindow): void {
    if (!basis.surface) {
      return;
    }
    const srf = basis.surface;
    const layout = this.layouts.getCurrentLayout(srf);
    if (layout.adjust) {
      const area = srf.workingArea.gap(
        this.config.screenGapLeft,
        this.config.screenGapRight,
        this.config.screenGapTop,
        this.config.screenGapBottom
      );
      const tiles = this.windows.visibleTiledWindowsOn(srf);
      layout.adjust(area, tiles, basis, basis.geometryDelta);
    }
  }

  public resizeFloat(
    window: EngineWindow,
    dir: CompassDirection,
    step: Step
  ): void {
    if (!window.surface) {
      return;
    }
    const srf = window.surface;

    // TODO: configurable step size?
    const hStepSize = srf.workingArea.width * 0.05;
    const vStepSize = srf.workingArea.height * 0.05;

    let hStep, vStep;
    switch (dir) {
      case "east":
        (hStep = step), (vStep = 0);
        break;
      case "west":
        (hStep = -step), (vStep = 0);
        break;
      case "south":
        (hStep = 0), (vStep = step);
        break;
      case "north":
        (hStep = 0), (vStep = -step);
        break;
    }

    const geometry = window.actualGeometry;
    const width = geometry.width + hStepSize * hStep;
    const height = geometry.height + vStepSize * vStep;

    window.forceSetGeometry(new Rect(geometry.x, geometry.y, width, height));
  }

  public resizeTile(
    basis: EngineWindow,
    dir: CompassDirection,
    step: Step
  ): void {
    if (!basis.surface) {
      return;
    }
    const srf = basis.surface;

    if (dir === "east") {
      const maxX = basis.geometry.maxX;
      const easternNeighbor = this.windows
        .visibleTiledWindowsOn(srf)
        .filter((tile) => tile.geometry.x >= maxX);
      if (easternNeighbor.length === 0) {
        dir = "west";
        step *= -1;
      }
    } else if (dir === "south") {
      const maxY = basis.geometry.maxY;
      const southernNeighbor = this.windows
        .visibleTiledWindowsOn(srf)
        .filter((tile) => tile.geometry.y >= maxY);
      if (southernNeighbor.length === 0) {
        dir = "north";
        step *= -1;
      }
    }

    // TODO: configurable step size?
    const hStepSize = srf.workingArea.width * 0.03;
    const vStepSize = srf.workingArea.height * 0.03;
    let delta: RectDelta;
    switch (dir) {
      case "east":
        delta = new RectDelta(hStepSize * step, 0, 0, 0);
        break;
      case "west":
        delta = new RectDelta(0, hStepSize * step, 0, 0);
        break;
      case "south":
        delta = new RectDelta(0, 0, vStepSize * step, 0);
        break;
      case "north": // Pass through
      default:
        delta = new RectDelta(0, 0, 0, vStepSize * step);
        break;
    }

    const layout = this.layouts.getCurrentLayout(srf);
    if (layout.adjust) {
      const area = srf.workingArea.gap(
        this.config.screenGapLeft,
        this.config.screenGapRight,
        this.config.screenGapTop,
        this.config.screenGapBottom
      );
      layout.adjust(
        area,
        this.windows.visibleTileableWindowsOn(srf),
        basis,
        delta
      );
    }
    this.arrange(basis.surface);
  }

  public resizeWindow(
    window: EngineWindow,
    dir: CompassDirection,
    step: Step
  ): void {
    const state = window.state;
    if (EngineWindowImpl.isFloatingState(state)) {
      this.resizeFloat(window, dir, step);
    } else if (EngineWindowImpl.isTiledState(state)) {
      this.resizeTile(window, dir, step);
    }
  }

  public arrange(screen?: DriverSurface | null): void {
    /* Try to avoid calling this; use arrangeScreen and commitArrangement on
    specific surfaces instead */

    if (screen === null) {
      return;
    }

    // if (!this.controller.currentActivity || !this.controller.currentDesktop) {
    //   return;
    // }

    if (screen) {
      this.arrangeScreen(screen);
      this.commitArrangement(screen);
      return;
    }

    this.log.log("arranging all surfaces");

    this.controller
      .screens(this.controller.currentActivity, this.controller.currentDesktop)
      .forEach((surf: DriverSurface) => {
        this.arrangeScreen(surf);
        this.commitArrangement(surf);
      });
  }

  /**
   * Arrange tiles on one screen
   *
   * @param surface screen's surface, on which windows should be arranged
   */
  private arrangeScreen(surface: DriverSurface): void {
    this.log.log(`arrangeScreen(): ${surface}`);

    const layout = this.layouts.getCurrentLayout(surface);

    const workingArea = surface.workingArea;
    const tilingArea = this.getTilingArea(workingArea, layout);

    const visibleWindows = this.windows.visibleWindowsOn(surface);

    // Set correct window state for new windows
    visibleWindows.forEach((win: EngineWindow) => {
      if (win.state === WindowState.Undecided) {
        win.state = win.shouldFloat ? WindowState.Floating : WindowState.Tiled;
      }
    });

    const tileableWindows = this.windows.visibleTileableWindowsOn(surface);

    tileableWindows.forEach((win: EngineWindow) => {
      this.log.log(`tiling group ${win.window.group} ${win}`);
    });

    // Maximize sole tile if enabled or apply the current layout as expected
    if (this.config.maximizeSoleTile && tileableWindows.length === 1) {
      tileableWindows[0].state = WindowState.Maximized;
      tileableWindows[0].geometry = workingArea;
    } else if (tileableWindows.length > 0) {
      layout.apply(this.controller, tileableWindows, tilingArea);
    }

    // If enabled, limit the windows' width
    if (
      this.config.limitTileWidthRatio > 0 &&
      !(layout instanceof MonocleLayout)
    ) {
      const maxWidth = Math.floor(
        workingArea.height * this.config.limitTileWidthRatio
      );
      tileableWindows
        .filter((tile) => tile.tiled && tile.geometry.width > maxWidth)
        .forEach((tile) => {
          const g = tile.geometry;
          tile.geometry = new Rect(
            g.x + Math.floor((g.width - maxWidth) / 2),
            g.y,
            maxWidth,
            g.height
          );
        });
    }

    this.log.log(`arrangeScreen(): finished ${surface}`);
  }

  /**
   * Push the arrangement to kwin to commit any changes
   * @param surface Windows on this surface will be committed
   */
  private commitArrangement(surface: DriverSurface): void {
    this.log.log(`commitArrangement(): ${surface}`);

    // Commit window assigned properties
    const visibleWindows = this.windows.allWindowsOn(surface);

    for (const win of visibleWindows) {
      // this.log.log(`setting surface`);
      win.surface = surface;
      // this.log.log(`running commit`);
      win.commit();
    }
    this.log.log(`commitArrangement(): finished ${surface}`);
  }

  public currentLayoutOnCurrentSurface(): WindowsLayout {
    return this.layouts.getCurrentLayout(this.controller.currentSurface);
  }

  public currentWindow(): EngineWindow | null {
    return this.controller.currentWindow;
  }

  public enforceSize(window: EngineWindow): void {
    if (window.tiled && !window.actualGeometry.equals(window.geometry)) {
      window.commit();
    }
  }

  public manage(window: EngineWindow): void {
    if (!window.shouldIgnore) {
      /* engine#arrange will update the state when required. */
      window.state = WindowState.Undecided;
      if (this.config.newWindowSpawnLocation == "master") {
        this.windows.unshift(window);
      } else if (
        this.controller.currentWindow &&
        this.config.newWindowSpawnLocation == "beforeFocused"
      ) {
        this.windows.push(window);
        this.windows.move(window, this.controller.currentWindow);
      } else if (
        this.controller.currentWindow &&
        this.config.newWindowSpawnLocation == "afterFocused"
      ) {
        this.windows.push(window);
        this.windows.move(window, this.controller.currentWindow, true);
      } else {
        /* newWindowSpawnLocation == "end" or "floating" */
        this.windows.push(window);
      }

      this.saveWindows();

      if (!window.surface) {
        return;
      }

      // Set correct window state for new windows
      const visibleWindows = this.windows.visibleWindowsOn(window.surface);
      visibleWindows.forEach((win: EngineWindow) => {
        if (win.state === WindowState.Undecided) {
          win.state = win.shouldFloat
            ? WindowState.Floating
            : WindowState.Tiled;
        }
      });

      // windows created in the master stack go to the end of the stack
      const layout = this.layouts.getCurrentLayout(window.surface);
      if (
        layout.numMasterTiles != undefined &&
        this.windows.isInMasterStack(window, layout.numMasterTiles)
      ) {
        const masterStack = this.windows.tileableWindowsOn(window.surface);
        const destWindow = masterStack[layout.numMasterTiles];

        this.windows.move(window, destWindow);
        layout.numMasterTiles += 1;
        this.saveWindows();
      }

      // this.arrangeScreen(window.surface);
      // this.commitArrangement(window.surface);
    }
  }

  public unmanage(window: EngineWindow): void {
    const surf = window.window.surface;

    if (surf) {
      const layout = this.layouts.getCurrentLayout(surf);
      if (
        layout.numMasterTiles != undefined &&
        this.windows.isInMasterStack(window, layout.numMasterTiles)
      ) {
        layout.numMasterTiles -= 1;
      }
    }

    this.windows.remove(window);
    // this.saveWindows();
    if (!surf) {
      return;
    }
    this.arrange(surf);
  }

  public restoreWindows(windows: EngineWindow[]): void {
    const cachedList = this.proxy.getWindowList();
    const list = JSON.parse(cachedList) as string[];
    for (const id of list) {
      for (const window of windows) {
        if (
          (window.window as DriverWindowImpl).client.windowId.toString() ==
            id &&
          !window.shouldIgnore
        ) {
          this.log.log(`restoring window position for: ${window}`);

          const w = JSON.parse(
            this.proxy.getWindowState(
              (window.window as DriverWindowImpl).client.windowId.toString()
            )
          ) as WindowConfig;

          if (w.minimized) {
            this.log.log(`found minimized window ${this}`);
            window.minimized = true;
            window.state = WindowState.Undecided;
          } else if (w.state == WindowState.Floating) {
            this.log.log(`found floating window`);
            window.state = WindowState.Floating;
          } else {
            window.state = WindowState.Undecided;
          }

          // // restore saved allDesktops state (shouldn't be needed)
          // if (w.allDesktops) {
          //   window.window.desktop = -1;
          // }

          this.windows.push(window);
          break;
        }
      }
    }
    for (const window of windows) {
      if (!this.windows.contains(window) && !window.shouldIgnore) {
        window.state = WindowState.Undecided;
        this.windows.push(window);
      }
    }
  }

  public saveWindows(): void {
    const list: string[] = [];
    for (const window of (this.windows as WindowStoreImpl).list) {
      list.push((window.window as DriverWindowImpl).client.windowId.toString());
    }
    this.log.log(`TSProxy.putWindowList(): writing window list to disk`);
    this.proxy.putWindowList(JSON.stringify(list));
  }

  /**
   * Focus next or previous window
   * @param step direction to step in (1 for forward, -1 for back)
   * @param includeHidden whether to switch to or skip minimized windows
   */
  public focusOrder(step: Step, includeHidden = false): void {
    const window = this.controller.currentWindow;
    let windows;

    if (includeHidden) {
      windows = this.windows.allWindowsOn(this.controller.currentSurface);
    } else {
      windows = this.windows.visibleWindowsOn(this.controller.currentSurface);
    }

    if (windows.length === 0) {
      // Nothing to focus
      return;
    }

    /* If no current window, select the first one. */
    if (window === null) {
      this.controller.currentWindow = windows[0];
      return;
    }

    const idx = windows.indexOf(window);
    if (!window || idx < 0) {
      /* This probably shouldn't happen, but just in case... */
      this.controller.currentWindow = windows[0];
      return;
    }

    const num = windows.length;
    const newIndex = (idx + (step % num) + num) % num;

    this.controller.currentWindow = windows[newIndex];
  }

  public focusDir(dir: Direction): void {
    const window = this.controller.currentWindow;

    /* if no current window, select the first window. */
    if (window === null) {
      const tiles = this.windows.visibleWindowsOn(
        this.controller.currentSurface
      );
      if (tiles.length > 0) {
        this.controller.currentWindow = tiles[0];
      }
      return;
    }

    const neighbor = this.config.moveBetweenSurfaces
      ? this.getNeighborByDirection(window.geometry, dir)
      : this.getNeighborByDirection(
          window.geometry,
          dir,
          this.controller.currentSurface
        );

    if (neighbor) {
      this.controller.currentWindow = neighbor;
    }
  }

  public swapOrder(window: EngineWindow, step: Step): void {
    if (!window.surface) {
      return;
    }
    const srf = window.surface;
    const visibles = this.windows.visibleWindowsOn(srf);
    if (visibles.length < 2) {
      return;
    }

    const vsrc = visibles.indexOf(window);
    const vdst = wrapIndex(vsrc + step, visibles.length);
    const dstWin = visibles[vdst];

    this.windows.move(window, dstWin);
    this.arrange(srf);
    this.saveWindows();
  }

  /**
   * Swap the position of the current window with a neighbor at the given direction.
   */
  public swapDirection(dir: Direction): void {
    const window = this.controller.currentWindow;
    if (window === null) {
      /* if no current window, select the first tile. */
      const tiles = this.windows.visibleTiledWindowsOn(
        this.controller.currentSurface
      );
      if (tiles.length > 1) {
        this.controller.currentWindow = tiles[0];
      }
      return;
    }

    const neighbor = this.getNeighborByDirection(window.geometry, dir);
    this.log.log(`found swap neighbor ${neighbor}`);

    if (neighbor?.surface && neighbor.surface.id == window.surface?.id) {
      this.log.log(`swapping with neighbor on same surface ${window.surface}`);

      const iBefore = this.windows
        .visibleWindowsOn(window.surface)
        .indexOf(window);
      this.windows.move(window, neighbor);
      const iAfter = this.windows
        .visibleWindowsOn(window.surface)
        .indexOf(window);
      if (iBefore == iAfter) {
        this.windows.swap(window, neighbor);
      }
      this.arrange(window.surface);
      this.saveWindows();
      return;
    } else if (!this.config.moveBetweenSurfaces) {
      return;
    }

    // no neighbor on same surface; check next surfaces

    const screenCandidates = this.controller
      .screens()
      .filter((surface) => surface.id != window.surface?.id);

    const closestSurface = this.findClosestSurface(
      window,
      dir,
      screenCandidates
    );

    if (neighbor && closestSurface && closestSurface == neighbor.surface) {
      this.log.log(`moving to neighbor on surface ${neighbor.surface}`);

      /* arrange the window into the new layout before picking which tile is
      closest, else we might pick a location that seems sensible now but
      doesn't seem sensible after the layout rearranges with the new window */

      const oldWindowPosition = window.geometry;
      const oldSurface = window.surface;
      window.window.surface = closestSurface;
      this.arrangeScreen(closestSurface);

      const closestSlot = this.getNeighborByDirection(oldWindowPosition, dir);
      if (closestSlot) {
        this.windows.move(window, closestSlot);
      }

      this.arrange(oldSurface);
      this.arrange(closestSurface);
      this.saveWindows();
    } else if (closestSurface) {
      this.log.log(`moving to empty screen ${closestSurface}`);
      this.moveWindowToSurface(window, closestSurface);
    }
  }

  /**
   * Move the given window towards the given direction by one step.
   * @param window a floating window
   * @param dir which direction
   */
  public moveFloat(window: EngineWindow, dir: Direction): void {
    if (!window.surface) {
      return;
    }
    const srf = window.surface;

    // TODO: configurable step size?
    const hStepSize = srf.workingArea.width * 0.05;
    const vStepSize = srf.workingArea.height * 0.05;

    let hStep, vStep;
    switch (dir) {
      case "up":
        (hStep = 0), (vStep = -1);
        break;
      case "down":
        (hStep = 0), (vStep = 1);
        break;
      case "left":
        (hStep = -1), (vStep = 0);
        break;
      case "right":
        (hStep = 1), (vStep = 0);
        break;
    }

    const geometry = window.actualGeometry;
    const x = geometry.x + hStepSize * hStep;
    const y = geometry.y + vStepSize * vStep;

    window.forceSetGeometry(new Rect(x, y, geometry.width, geometry.height));
  }

  public swapDirOrMoveFloat(dir: Direction): void {
    const window = this.controller.currentWindow;
    if (!window) {
      return;
    }

    const state = window.state;
    if (EngineWindowImpl.isFloatingState(state)) {
      this.moveFloat(window, dir);
    } else if (EngineWindowImpl.isTiledState(state)) {
      this.swapDirection(dir);
    }
  }

  public findClosestSurface(
    window: EngineWindow,
    dir: Direction,
    screens: DriverSurface[]
  ): DriverSurface | null {
    const screenCandidates = [];
    for (const surf of screens) {
      switch (dir) {
        case "up":
          if (
            surf.workingArea.center[1] < window.geometry.center[1] &&
            overlap(
              surf.workingArea.x,
              surf.workingArea.maxX,
              window.geometry.x,
              window.geometry.maxX
            )
          ) {
            screenCandidates.push(surf);
          }
          break;
        case "down":
          if (
            surf.workingArea.center[1] > window.geometry.center[1] &&
            overlap(
              surf.workingArea.x,
              surf.workingArea.maxX,
              window.geometry.x,
              window.geometry.maxX
            )
          ) {
            screenCandidates.push(surf);
          }
          break;
        case "left":
          if (
            surf.workingArea.center[0] < window.geometry.center[0] &&
            overlap(
              surf.workingArea.y,
              surf.workingArea.maxY,
              window.geometry.y,
              window.geometry.maxY
            )
          ) {
            screenCandidates.push(surf);
          }
          break;
        case "right":
          if (
            surf.workingArea.center[0] > window.geometry.center[0] &&
            overlap(
              surf.workingArea.y,
              surf.workingArea.maxY,
              window.geometry.y,
              window.geometry.maxY
            )
          ) {
            screenCandidates.push(surf);
          }
      }
    }

    let closestDistance = Infinity;
    let closestScreen: DriverSurface | null = null;
    for (const surf of screenCandidates) {
      const distance = Math.hypot(
        surf.workingArea.center[0] - window.geometry.center[0],
        surf.workingArea.center[1] - window.geometry.center[1]
      );
      if (distance < closestDistance) {
        closestDistance = distance;
        closestScreen = surf;
      }
    }

    return closestScreen;
  }

  public moveToSurfaceDir(dir: Direction): void {
    const win = this.controller.currentWindow;
    if (!win) {
      return;
    }

    const screenCandidates = this.controller
      .screens()
      .filter((surf) => surf.id != win.surface?.id);

    const closestScreen = this.findClosestSurface(win, dir, screenCandidates);

    if (!closestScreen) {
      return;
    }

    this.moveWindowToSurface(win, closestScreen);
  }

  public toggleFloat(window: EngineWindow): void {
    window.state = !window.tileable ? WindowState.Tiled : WindowState.Floating;
    if (this.config.keepFloatAbove) {
      (window.window as DriverWindowImpl).client.keepAbove =
        window.state == WindowState.Floating ? true : false;
    }
    this.arrange(window.surface);
  }

  public setMaster(window: EngineWindow): void {
    this.windows.putWindowToMaster(window);
    this.saveWindows();
    if (window.window.surface) {
      this.arrange(window.window.surface);
    }
  }

  public moveToMasterStack(window: EngineWindow, end = true): void {
    if (!window || !window.surface) {
      return;
    }

    const layout = this.layouts.getCurrentLayout(window.surface);
    if (layout.numMasterTiles == undefined) {
      this.showNotification("Layout isn't stackable");
      this.setMaster(window);
      return;
    }

    const masterStack = this.windows.visibleTileableWindowsOn(window.surface);
    if (!masterStack.length || !layout.numMasterTiles) {
      this.setMaster(window);
    }

    const destWindow = masterStack[layout.numMasterTiles - 1];
    this.windows.move(window, destWindow, true);
  }

  public cycleWindowBetweenStacks(window: EngineWindow): void {
    const win = this.controller.currentWindow;
    if (!win || !win.surface) {
      return;
    }
    const layout = this.layouts.getCurrentLayout(win.surface);

    if (layout.numMasterTiles == undefined) {
      this.showNotification("Layout isn't stackable");
      this.setMaster(win);
      return;
    }

    if (this.windows.isInMasterStack(win, layout.numMasterTiles)) {
      this.showNotification("Demote from master stack");
      layout.numMasterTiles -= 1;
      this.moveToMasterStack(win);
    } else {
      this.showNotification("Promote to master stack");
      this.moveToMasterStack(win);
      layout.numMasterTiles += 1;
      // (win.window as DriverWindowImpl).client.opacity = 1;
    }
    this.saveWindows();
    this.arrange(win.window.surface);
  }

  public cycleFocusWithinStack(backwards = false): void {
    const win = this.currentWindow();
    if (!win || !win.surface) {
      return;
    }
    const layout = this.layouts.getCurrentLayout(win.surface);

    if (layout.numMasterTiles == undefined) {
      return;
    }
    const numMasterTiles = layout.numMasterTiles;

    if (
      !backwards &&
      this.windows.visibleTiledWindowsOn(win.surface).indexOf(win) <
        numMasterTiles - 1
    ) {
      // the next window is within the master stack
      this.log.log("next");
      this.focusOrder(1);
    } else if (!backwards) {
      // the next window would be outside the master stack, so wrap around
      this.log.log(
        `wrap ${this.windows.visibleTiledWindowsOn(win.surface).length}`
      );
      const newFocus = this.windows.visibleTiledWindowsOn(win.surface)[0];
      if (newFocus) {
        this.log.log("ok");
        this.controller.currentWindow = newFocus;
      }
    } else if (
      backwards &&
      this.windows.visibleTiledWindowsOn(win.surface).indexOf(win) > 0
    ) {
      // the next window is within the master stack
      this.log.log("next");
      this.focusOrder(-1);
    } else if (backwards) {
      // the next window would be outside the master stack, so wrap around
      this.log.log(
        `wrap ${this.windows.visibleTiledWindowsOn(win.surface).length}`
      );
      const newFocus = this.windows.visibleTiledWindowsOn(win.surface)[
        layout.numMasterTiles - 1
      ];
      if (newFocus) {
        this.log.log("ok");
        this.controller.currentWindow = newFocus;
      }
    }
  }

  public cycleLayout(step: Step): void {
    const layout = this.layouts.cycleLayout(
      this.controller.currentSurface,
      step
    );
    if (layout) {
      this.showLayoutNotification(this.controller.currentSurface);

      // Minimize inactive windows if Monocle and config.monocleMinimizeRest
      if (
        this.isLayoutMonocleAndMinimizeRest() &&
        this.controller.currentWindow
      ) {
        this.minimizeOthers(this.controller.currentWindow);
      }
      this.arrange(this.controller.currentSurface);
    }
  }

  public toggleLayout(layoutClassID: string): void {
    const layout = this.layouts.toggleLayout(
      this.controller.currentSurface,
      layoutClassID
    );
    if (layout) {
      this.showLayoutNotification(this.controller.currentSurface);

      // Minimize inactive windows if Monocle and config.monocleMinimizeRest
      if (
        this.isLayoutMonocleAndMinimizeRest() &&
        this.controller.currentWindow
      ) {
        this.minimizeOthers(this.controller.currentWindow);
      }
      this.arrange(this.controller.currentSurface);
    }
  }

  public minimizeOthers(window: EngineWindow): void {
    if (!window.surface) {
      return;
    }
    for (const tile of this.windows.visibleTiledWindowsOn(window.surface)) {
      if (
        tile.screen == window.screen &&
        tile.id !== window.id &&
        this.windows.visibleTiledWindowsOn(window.surface).includes(window)
      ) {
        tile.minimized = true;
      } else {
        tile.minimized = false;
      }
    }
  }

  public isLayoutMonocleAndMinimizeRest(): boolean {
    return (
      this.currentLayoutOnCurrentSurface() instanceof MonocleLayout &&
      this.config.monocleMinimizeRest
    );
  }

  /**
   * Find windows in a given direction from a basis which have at least
   * partial overlap in the perpendicular axis with the basis
   * @param basis origin geometry from which to search
   * @param dir search in this direction from basis
   * @param surface if specified, restrict search to this surface
   * @returns a list of windows on surface located dir from basis
   */
  private getNeighborCandidates(
    basis: Rect,
    dir: Direction,
    surface?: DriverSurface
  ): EngineWindow[] {
    const visibleWindowsOnCurrentSurface = surface
      ? this.windows.visibleTiledWindowsOn(surface)
      : this.windows.visibleTiledWindows(this.controller.screens());

    /* Flipping all inputs' signs allows for the same logic to find closest
     windows in either direction */
    const sign = dir === "down" || dir === "right" ? 1 : -1;

    if (dir === "up" || dir === "down") {
      return visibleWindowsOnCurrentSurface.filter(
        (window): boolean =>
          window.geometry.y * sign > basis.y * sign &&
          overlap(basis.x, basis.maxX, window.geometry.x, window.geometry.maxX)
      );
    } else {
      return visibleWindowsOnCurrentSurface.filter(
        (window): boolean =>
          window.geometry.x * sign > basis.x * sign &&
          overlap(basis.y, basis.maxY, window.geometry.y, window.geometry.maxY)
      );
    }
  }

  private getClosestRelativWindowCorner(
    geometries: Rect[],
    dir: Direction
  ): number {
    return geometries.reduce(
      (prevValue, geometry): number => {
        switch (dir) {
          case "up":
            return Math.max(geometry.maxY, prevValue);
          case "down":
            return Math.min(geometry.y, prevValue);
          case "left":
            return Math.max(geometry.maxX, prevValue);
          case "right":
            return Math.min(geometry.x, prevValue);
        }
      },
      dir === "up" || dir === "left" ? 0 : Infinity
    );
  }

  private getClosestRelativeWindow(
    windowArray: EngineWindow[],
    dir: Direction,
    closestPoint: number
  ): EngineWindow[] {
    return windowArray.filter((window): boolean => {
      // adjust closestPoint for potential misalignment of tiled windows
      switch (dir) {
        case "up":
          return window.geometry.maxY > closestPoint - 5;
        case "down":
          return window.geometry.y < closestPoint + 5;
        case "left":
          return window.geometry.maxX > closestPoint - 5;
        case "right":
          return window.geometry.x < closestPoint + 5;
      }
    });
  }

  private getNeighborByDirection(
    basis: Rect,
    dir: Direction,
    surface?: DriverSurface
  ): EngineWindow | null {
    const neighborCandidates = surface
      ? this.getNeighborCandidates(basis, dir, surface)
      : this.getNeighborCandidates(basis, dir);

    if (neighborCandidates.length === 0) {
      return null;
    }

    const closestWindowCorner = this.getClosestRelativWindowCorner(
      neighborCandidates.map((window) => window.geometry),
      dir
    );

    const closestWindows = this.getClosestRelativeWindow(
      neighborCandidates,
      dir,
      closestWindowCorner
    );

    // Return the most recently used window
    return closestWindows.sort((a, b) => b.timestamp - a.timestamp)[0];
  }

  // public swapGroupToSurface(groupId: number): void {
  //   this.controller.swapGroupToSurface(groupId);
  // }

  public addWindowToGroup(group: string, window?: EngineWindow): void {
    if (!window && this.controller.currentWindow) {
      window = this.controller.currentWindow;
    } else if (!window) {
      return;
    }

    // const oldSurf = this.controller.moveWindowToGroup(groupId, window);

    // find if any surface was currently displaying the window's old group
    const oldGroup = window.window.group;
    let oldSurf = null;
    for (const surf of this.controller.screens()) {
      // // ignore self
      // if (surf.id == window.surface.id) {
      //   continue;
      // }
      if (oldGroup != undefined && surf.groups.includes(oldGroup)) {
        oldSurf = surf;
        break;
      }
    }

    this.log.log(
      `moving window from group ${oldGroup} to group ${group} ${window}`
    );

    // find if a surface on the current desktop displays this group
    let newSurf = null;
    for (const surf of this.controller.screens()) {
      if (surf.groups.includes(group)) {
        newSurf = surf;
        break;
      }
    }

    window.window.group = group;

    if (oldSurf) {
      this.arrange(oldSurf);
    }

    if (newSurf) {
      this.log.log(
        `showing window on desktop ${newSurf.desktop} surface ${newSurf.screen}`
      );
      window.surface = newSurf;

      this.arrange(newSurf);
      return;
    }

    // else, find if a surface on another desktop displays this group
    for (
      let desktop = 1;
      desktop <= this.proxy.workspace().desktops;
      desktop++
    ) {
      for (const surf of this.controller.screens(
        this.controller.currentActivity,
        desktop
      )) {
        if (surf.groups.includes(group)) {
          newSurf = surf;
          break;
        }
      }
      if (newSurf) {
        break;
      }
    }

    if (newSurf) {
      this.log.log(
        `showing window on other desktop ${newSurf.desktop} surface ${newSurf.screen}`
      );
      window.surface = newSurf;
    } else {
      // // else just hide the window as no surface currently displays its group
      // window.window.group = groupId;
      // window.window.desktop = this.lastEmptyDesktop(window.screen);
      // this.log.log(`moving window to empty desktop ${window.window.desktop}`);
    }

    // if (oldSurf?.desktop == this.controller.currentDesktop) {
    //   this.arrange(oldSurf);
    // }

    // if (window.surface?.desktop == this.controller.currentDesktop) {
    //   this.arrange(window.window.surface);
    // }

    this.arrange(newSurf);
  }

  public summonGroupToSurface(group: string, surface: DriverSurface): void {
    this.controller.summonGroupToSurface(group, surface);

    // const toSurf = this.controller.screens()[screen];
    // const oldGroup = toSurf.group;

    // // // find if any surface on the same desktop is currently displaying the group
    // // let fromSurf = null;
    // // for (const surf of this.controller.screens()) {
    // //   if (surf.id == toSurf.id) {
    // //     continue;
    // //   }
    // //   if (surf.group == groupId) {
    // //     fromSurf = surf;
    // //     break;
    // //   }
    // // }

    // // // just swap groups between the two surfaces on the same desktop
    // // if (fromSurf) {
    // //   this.log.log(
    // //     `swapping group ${groupId} from screen ${fromSurf?.screen} to ${screen}`
    // //   );

    // //   fromSurf.group = toSurf.group;
    // //   toSurf.group = groupId;
    // //   this.arrange(fromSurf);
    // //   this.arrange(toSurf);
    // //   return;
    // // }

    // // // else, we need to find some surface to display the old group getting swapped out

    // // // find the last desktop displaying only this group, if any
    // // let loneGroupSurf = null;
    // // for (
    // //   let desktop = this.proxy.workspace().desktops;
    // //   desktop > 0;
    // //   desktop--
    // // ) {
    // //   for (const surf of this.controller.screens(
    // //     this.controller.currentActivity,
    // //     desktop
    // //   )) {
    // //     // ignore self
    // //     if (surf.id == toSurf.id) {
    // //       continue;
    // //     }
    // //     if (
    // //       // the surface has this group and the desktop has no other groups
    // //       surf.group == groupId &&
    // //       !this.windows
    // //         .allWindows(this.controller.currentActivity, desktop)
    // //         .filter((win) => win.window.group != groupId).length
    // //     ) {
    // //       loneGroupSurf = surf;
    // //       break;
    // //     }
    // //   }
    // //   if (loneGroupSurf) {
    // //     break;
    // //   }
    // // }

    // // if (loneGroupSurf) {
    // //   this.log.log(
    // //     `garbage collecting lone group ${groupId} on desktop ${loneGroupSurf.desktop}`
    // //   );
    // // }

    // // // if (otherGroupSurf) {
    // // //   this.log.log(
    // // //     `releasing group ${oldGroup} on screen ${toSurf.screen} to desktop ${otherGroupSurf.desktop} screen ${otherGroupSurf.screen}`
    // // //   );
    // // //   toSurf.group = groupId;
    // // //   this.arrange(toSurf);
    // // //   this.arrange(otherGroupSurf);
    // // //   return;
    // // // }

    // // // else, find the first empty desktop and clone the desktop there
    // // const emptyDesktop = this.firstEmptyDesktopAfter(toSurf.desktop);
    // // const emptyDesktopSurfs = this.controller.screens(
    // //   this.controller.currentActivity,
    // //   emptyDesktop
    // // );

    // // // this.log.log(
    // // //   `cloning desktop ${toSurf.desktop} to desktop ${emptyDesktop}`
    // // // );
    // // // const cloneDesktopSurfs = this.controller.screens(
    // // //   undefined,
    // // //   toSurf.desktop
    // // // );
    // // // for (let screen = 0; screen < cloneDesktopSurfs.length; screen++) {
    // // //   emptyDesktopSurfs[screen].group = cloneDesktopSurfs[screen].group;
    // // // }

    // // this.log.log(
    // //   `moving orphaned group ${oldGroup} to empty desktop ${emptyDesktop}`
    // // );

    // // toSurf.group = groupId;
    // // this.arrange(emptyDesktopSurfs[toSurf.screen]);
    // // this.arrange(toSurf);

    // this.controller.swapGroupToSurface(groupId, screen);

    // // tell kwin if any windows need their desktop changed
    // for (const win of this.windows.allWindowsOn(toSurf)) {
    //   // don't set the desktop if it's already set to all desktops
    //   if (win.desktop != -1) {
    //     win.desktop = toSurf.desktop;
    //   }
    // }

    // this.log.log(`do arrange for screen ${this.controller.screens()[screen]}`);

    // this.arrange(toSurf);

    // if (fromSurf) {
    //   fromSurf = this.controller.screens()[fromSurf.screen];
    //   this.log.log(
    //     `also do arrange for screen ${fromSurf.screen} group ${fromSurf.group}`
    //   );
    //   this.arrange(fromSurf);
    // }
  }

  public summonGroupToActiveSurface(group: string): void {
    this.summonGroupToSurface(group, this.controller.currentSurface);

    const layout = this.currentLayoutOnCurrentSurface();
    this.controller.showNotification(
      layout.name,
      layout.icon,
      layout.hint,
      `Summoned Group ${group}`
    );

    // focus the most recently focused non-minimized window on this surface
    const lastWindow = this.windows
      .allWindowsOn(this.controller.currentSurface)
      .filter((win) => !win.minimized)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (lastWindow) {
      this.controller.currentWindow = lastWindow;
    }
  }

  public moveWindowToSurface(
    window: EngineWindow,
    toSurface: DriverSurface
  ): void {
    // this.driver.moveWindowToSurface(window, surface);
    const fromSurface = window.surface;
    this.log.log(`moveWindowToSurface(): from ${fromSurface} to ${toSurface}`);
    this.controller.showNotification(`Moved to screen ${toSurface.screen}`);

    window.surface = fromSurface;
    this.arrange(fromSurface);
    this.arrange(toSurface);

    // this.moveWindowToGroup(surface.group, window);
  }

  // public swapSurfaceToScreen(surface: DriverSurface, screen: number): void {
  //   // this.controller.screens()[screen].
  //   // surface.screen = screen;

  //   const surfaceA = surface;
  //   const surfaceB = this.controller.screens()[screen];

  //   const windowsA = this.windows.visibleTiledWindowsOn(surfaceA);
  //   const windowsB = this.windows.visibleTiledWindowsOn(surfaceB);

  //   for (const win of windowsA) {
  //     win.surface = surfaceB;
  //   }

  //   for (const win of windowsB) {
  //     win.surface = surfaceA;
  //   }

  //   this.arrange(surfaceA);
  //   this.arrange(surfaceB);
  // }

  // public swapSurfaceToActiveScreen(surfaceNum: number): void {
  //   this.log.log(
  //     `swapping surface ${surfaceNum} to screen ${this.controller.currentSurface.screen}`
  //   );

  //   this.swapSurfaceToScreen(this.controller.currentSurface, surfaceNum);
  // }

  private firstEmptyDesktopAfter(desktop = 1): number {
    const currentActivity = this.controller.currentActivity;
    for (let d = desktop + 1; d <= this.proxy.workspace().desktops; d++) {
      for (let s = 0; s < this.proxy.workspace().numScreens; s++) {
        const surface = this.controller.screens(currentActivity, d)[s];
        if (this.windows.allWindowsOn(surface).length) {
          continue;
        }
        if (s + 1 == this.proxy.workspace().numScreens) {
          return surface.desktop;
        }
      }
    }
    // didn't find an empty desktop, so make a new desktop
    this.proxy.workspace().desktops++;
    return this.proxy.workspace().desktops;
  }

  private lastEmptyDesktop(screen: number): number {
    for (let desktop = this.proxy.workspace().desktops; desktop; desktop--) {
      const surface = this.controller.screens(
        this.controller.currentActivity,
        desktop
      )[screen];
      if (this.windows.allWindowsOn(surface).length) {
        continue;
      }
      return surface.desktop;
    }
    // didn't find a desktop with that screen empty, so make a new empty desktop
    this.proxy.workspace().desktops++;
    return this.proxy.workspace().desktops;
  }

  public showNotification(text: string, icon?: string, hint?: string): void {
    this.controller.showNotification(text, icon, hint);
  }

  public showLayoutNotification(surface?: DriverSurface): void {
    if (!surface && this.currentSurface) {
      surface = this.currentSurface;
    } else if (!surface) {
      return;
    }

    const currentLayout = this.layouts.getCurrentLayout(surface);
    this.controller.showNotification(
      currentLayout.name,
      currentLayout.icon,
      currentLayout.hint,
      surface.groups.length
        ? `${surface.groups.length > 1 ? "Groups" : "Group"} ${surface.groups}`
        : "",
      surface.screen
    );
  }

  /**
   * Returns the tiling area for the given working area and the windows layout.
   *
   * Tiling area is the area we are allowed to put windows in, not counting the inner gaps
   * between them. I.e. working are without gaps.
   *
   * @param workingArea area in which we are allowed to work. @see DriverSurface#workingArea
   * @param layout windows layout used
   */
  private getTilingArea(workingArea: Rect, layout: WindowsLayout): Rect {
    if (this.config.monocleMaximize && layout instanceof MonocleLayout) {
      return workingArea;
    } else {
      return workingArea.gap(
        this.config.screenGapLeft,
        this.config.screenGapRight,
        this.config.screenGapTop,
        this.config.screenGapBottom
      );
    }
  }
}
