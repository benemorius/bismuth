// SPDX-FileCopyrightText: 2018-2019 Eon S. Jeon <esjeon@hyunmu.am>
// SPDX-FileCopyrightText: 2021 Mikhail Zolotukhin <mail@gikari.com>
//
// SPDX-License-Identifier: MIT

import { DriverWindow, DriverWindowImpl } from "../driver/window";
import { DriverSurface } from "../driver/surface";

import { Config } from "../config";
import { Log } from "../util/log";
import { Rect, RectDelta } from "../util/rect";
import { TSProxy } from "../extern/proxy";

export enum WindowState {
  /**
   * Initial value
   */
  Unmanaged,

  /**
   * Script-external state - overrides internal state
   */
  NativeFullscreen,
  NativeMaximized,
  NativeMinimized,

  /**
   * Script-internal state
   */
  Floating,
  Maximized,
  Tiled,
  TiledAfloat,
  Undecided,
}

export interface WindowConfig {
  group: number;
  class: string;
  title: string;
  minimized: boolean;
  allDesktops: boolean;
  state: WindowState;
}

/**
 * Window with the convenient for the Engine Interface
 */
export interface EngineWindow {
  /**
   * Window unique id
   */
  readonly id: string;

  /**
   * If this window ***can be*** tiled by layout.
   */
  readonly tileable: boolean;

  /**
   * If this window is ***already*** tiled, thus a part of the current layout.
   */
  readonly tiled: boolean;

  /**
   * If this window is floating, thus its geometry is not tightly managed.
   */
  readonly floating: boolean;

  /**
   * Whether the window is shaded (collapsed to the title bar)
   */
  readonly shaded: boolean;

  /**
   * Low-level implementation, usable for Driver
   */
  readonly window: DriverWindow;

  /**
   * Difference between geometry and actual geometry
   */
  readonly geometryDelta: RectDelta;

  /**
   * Actual geometry
   */
  readonly actualGeometry: Readonly<Rect>;

  /**
   * Whether the window is a dialog window
   */
  readonly isDialog: boolean;

  /**
   * Whether the window should be set to floating state
   */
  readonly shouldFloat: boolean;

  /**
   * Whether the window should be ignored by the script
   */
  readonly shouldIgnore: boolean;

  /**
   * State to which the window was asked to be changed
   * previously. This can be the same state, as the current
   * one.
   */
  readonly statePreviouslyAskedToChangeTo: WindowState;

  /**
   * Screen number, on which the window is present
   */
  readonly screen: number;

  desktop: number;

  /**
   * Whether the window is minimized
   */
  minimized: boolean;

  /**
   * Geometry of a window, while in floated state
   */
  floatGeometry: Rect | undefined;

  /**
   * Window geometry
   */
  geometry: Rect;

  /**
   * Surface, the window is currently on
   */
  surface: DriverSurface;

  // group: number;

  /**
   * General state of the window: floating, maximized, tiled etc.
   */
  state: WindowState;

  /**
   * The timestamp when the last time Window was focused.
   */
  timestamp: number;

  /**
   * Window weight.
   * TODO: This needs a better explanation. This has something to do with ThreeColumnLayout.
   */
  weight: number;

  /**
   * Whether the window is visible on concrete surface
   * @param surface the surface visibility on which is checked
   */
  visibleOn(surface: DriverSurface): boolean;

  /**
   * Whether the window is visible on a given activity and desktop
   * @param activity the activity to check
   * @param desktop the desktop to check
   */
  visible(activity: string, desktop: number): boolean;

  /**
   * Force apply the geometry *immediately*.
   *
   * This method is a quick hack created for engine#resizeFloat, thus should
   * not be used in other places.
   */
  forceSetGeometry(geometry: Rect): void;

  /**
   * Update changed window properties on the KWin side.
   * I.e. make the changes visible to the end user.
   */
  commit(): void;
}

export class EngineWindowImpl implements EngineWindow {
  // private _group: number;
  public static isTileableState(state: WindowState): boolean {
    return (
      state === WindowState.Tiled ||
      state === WindowState.Maximized ||
      state === WindowState.TiledAfloat
    );
  }

  public static isTiledState(state: WindowState): boolean {
    return state === WindowState.Tiled || state === WindowState.Maximized;
  }

  public static isFloatingState(state: WindowState): boolean {
    return state === WindowState.Floating || state === WindowState.TiledAfloat;
  }

  public readonly id: string;
  public readonly window: DriverWindow;

  public get actualGeometry(): Readonly<Rect> {
    return this.window.geometry;
  }
  public get shouldFloat(): boolean {
    return this.window.shouldFloat;
  }
  public get shouldIgnore(): boolean {
    return this.window.shouldIgnore;
  }

  public get screen(): number {
    return this.window.screen;
  }

  public get desktop(): number {
    return this.window.desktop;
  }

  public set desktop(desktopNum: number) {
    this.window.desktop = desktopNum;
  }

  public get minimized(): boolean {
    return this.window.minimized;
  }

  public set minimized(min: boolean) {
    this.window.minimized = min;
  }

  public get tileable(): boolean {
    return EngineWindowImpl.isTileableState(this.state);
  }

  public get tiled(): boolean {
    return EngineWindowImpl.isTiledState(this.state);
  }

  public get floating(): boolean {
    return EngineWindowImpl.isFloatingState(this.state);
  }

  public get geometryDelta(): RectDelta {
    return RectDelta.fromRects(this.geometry, this.actualGeometry);
  }

  public get shaded(): boolean {
    return this.window.shaded;
  }

  public floatGeometry: Rect | undefined;
  public geometry: Rect;
  public timestamp: number;

  /**
   * The current state of the window.
   *
   * This value affects what and how properties gets committed to the backend.
   *
   * Avoid comparing this value directly, and use `tileable`, `tiled`,
   * `floating` as much as possible.
   */
  public get state(): WindowState {
    /* external states override the internal state. */
    if (this.window.fullScreen) {
      return WindowState.NativeFullscreen;
    }
    if (this.window.maximized) {
      return WindowState.NativeMaximized;
    }
    if (this.window.minimized) {
      return WindowState.NativeMinimized;
    }

    return this.internalState;
  }

  public set state(value: WindowState) {
    const winState = this.state;
    this.internalStatePreviouslyAskedToChangeTo = winState;

    /* cannot transit to the current state */
    if (winState === value) {
      return;
    }

    if (
      (winState === WindowState.Unmanaged ||
        EngineWindowImpl.isTileableState(winState)) &&
      EngineWindowImpl.isFloatingState(value)
    ) {
      this.shouldCommitFloat = true;
    } else if (
      EngineWindowImpl.isFloatingState(winState) &&
      EngineWindowImpl.isTileableState(value)
    ) {
      /* save the current geometry before leaving floating state */
      this.floatGeometry = this.actualGeometry;
    }

    this.internalState = value;

    const saveState = JSON.parse(
      this.proxy.getWindowState(
        (this.window as DriverWindowImpl).client.windowId.toString()
      )
    ) as WindowConfig;

    saveState.state = value;

    this.proxy.putWindowState(
      (this.window as DriverWindowImpl).client.windowId.toString(),
      JSON.stringify(saveState)
    );
  }

  public get statePreviouslyAskedToChangeTo(): WindowState {
    return this.internalStatePreviouslyAskedToChangeTo;
  }

  public get surface(): DriverSurface {
    return this.window.surface;
  }

  public set surface(srf: DriverSurface) {
    if (srf) {
      this.shouldCommitFloat = true;
    }
    this.window.surface = srf;
  }

  public get weight(): number {
    const srfID = this.window.group;
    const winWeight: number | undefined = this.weightMap[srfID];
    if (winWeight === undefined) {
      this.weightMap[srfID] = 1.0;
      return 1.0;
    }
    return winWeight;
  }

  public set weight(value: number) {
    const srfID = this.window.group;
    this.weightMap[srfID] = value;
  }

  // public get group(): number {
  //   return this._group;
  // }

  // public set group(groupId: number) {
  //   this.log.log(`sending from group ${this.group} to ${groupId}`);
  //   this._group = groupId;

  //   if (this.group == groupId) {
  //     return;
  //   }

  //   // this.window.hidden = groupId != this.surface.currentGroup;
  // }

  public get isDialog(): boolean {
    return this.window.isDialog;
  }

  private internalState: WindowState;
  private internalStatePreviouslyAskedToChangeTo: WindowState;
  private shouldCommitFloat: boolean;
  private weightMap: { [key: string]: number };

  private config: Config;

  constructor(
    window: DriverWindow,
    config: Config,
    private log: Log,
    private proxy: TSProxy
  ) {
    this.config = config;

    this.id = window.id;
    this.window = window;
    this.internalStatePreviouslyAskedToChangeTo = WindowState.Floating;

    this.floatGeometry = undefined;
    this.geometry = window.geometry;
    this.timestamp = 0;

    this.internalState = WindowState.Unmanaged;
    this.shouldCommitFloat = this.shouldFloat;
    this.weightMap = {};
  }

  public commit(): void {
    if (!this.window.surface) {
      return;
    }

    const state = this.state;
    this.log.log(`commit state: ${WindowState[state]} ${this}`);
    switch (state) {
      case WindowState.NativeMaximized:
        this.window.commit(this.window.surface.workingArea);
        break;

      case WindowState.NativeFullscreen:
        this.window.commit();
        break;

      case WindowState.Floating:
        if (!this.shouldCommitFloat) {
          break;
        }
        this.window.commit(this.floatGeometry, this.screen, false);
        this.shouldCommitFloat = false;
        break;

      case WindowState.Maximized:
        this.window.commit(this.geometry, undefined, true);
        break;

      case WindowState.Tiled:
        this.window.commit(this.geometry, undefined, this.config.noTileBorder);
        break;

      case WindowState.NativeMinimized:
        this.window.commit(undefined, this.screen, this.config.noTileBorder);
        break;

      case WindowState.TiledAfloat:
        if (!this.shouldCommitFloat) {
          break;
        }
        this.window.commit(this.floatGeometry, this.screen, false);
        this.shouldCommitFloat = false;
        break;
    }
  }

  public forceSetGeometry(geometry: Rect): void {
    this.window.commit(geometry);
  }

  public visible(act: string, desk: number): boolean {
    return this.window.visible(act, desk);
  }

  public visibleOn(srf: DriverSurface): boolean {
    return this.window.visibleOn(srf);
  }

  public toString(): string {
    return "Window(" + String(this.window) + ")";
  }
}
