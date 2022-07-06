// SPDX-FileCopyrightText: 2018-2019 Eon S. Jeon <esjeon@hyunmu.am>
// SPDX-FileCopyrightText: 2021 Mikhail Zolotukhin <mail@gikari.com>
//
// SPDX-License-Identifier: MIT

import { DriverSurface, DriverSurfaceImpl } from "./surface";

import { Rect } from "../util/rect";
import { clip, matchWords } from "../util/func";
import { Config } from "../config";
import { Log } from "../util/log";
import { TSProxy } from "../extern/proxy";
import { EngineWindow, WindowConfig } from "../engine/window";

/**
 * Hijack kwin's desktop module to gain the ability to hide and show windows
 */
const SHOWN_DESKTOP = -1;
const HIDDEN_DESKTOP = 3;

/**
 * KWin window representation.
 */
export interface DriverWindow {
  /**
   * Is the window is currently set to be fullscreen
   */
  readonly fullScreen: boolean;

  /**
   * Window geometry: its coordinates, width and height
   */
  readonly geometry: Readonly<Rect>;

  /**
   * Window unique id
   */
  readonly id: string;

  /**
   * Whether it window is in maximized state
   */
  readonly maximized: boolean;

  /**
   * Whether the window should be completely ignored by the script
   */
  readonly shouldIgnore: boolean;

  /**
   * Whether the window should float according to the some predefined rules
   */
  readonly shouldFloat: boolean;

  /**
   * The screen number the window is currently at
   */
  readonly screen: number;

  desktop: number;

  /**
   * Whether the window is focused right now
   */
  readonly active: boolean;

  /**
   * Whether the window is a dialog window
   */
  readonly isDialog: boolean;

  /**
   * Window's current surface
   */
  surface: DriverSurface;

  group: number;

  hidden: boolean;

  unmanaged: boolean;

  onDesktopChanged(): boolean;
  onScreenChanged(): boolean;
  onGeometryChanged(): boolean;

  /**
   * Whether the window is minimized
   */
  minimized: boolean;

  /**
   * Whether the window is shaded
   */
  shaded: boolean;

  /**
   * Commit the window properties to the KWin, i.e. "show the results of our manipulations to the user"
   * @param geometry
   * @param noBorder
   * @param keepAbove
   */
  commit(
    geometry?: Rect,
    screen?: number,
    noBorder?: boolean,
    keepAbove?: boolean
  ): void;

  /**
   * Whether the window is visible on the specified surface
   * @param surf the surface to check against
   */
  visibleOn(surf: DriverSurface): boolean;

  on(surf: DriverSurface): boolean;

  /**
   * Whether the window is visible on the given activity and desktop
   * @param activity the activity to check
   * @param desktop the desktop to check
   */
  visible(activity: string, desktop: number): boolean;
}

export class DriverWindowImpl implements DriverWindow {
  public readonly id: string;
  private _desktop: number;
  private _screen: number;
  private _group: number;
  private _hidden: boolean;
  private _hiding: boolean;
  public unmanaged: boolean;
  private _changingDesktop: boolean;
  private _changingScreen: boolean;
  private _changingGeometry: boolean;

  public get fullScreen(): boolean {
    return this.client.fullScreen;
  }

  public get geometry(): Rect {
    return Rect.fromQRect(this.client.frameGeometry);
  }

  public get active(): boolean {
    return this.client.active;
  }

  public get shouldIgnore(): boolean {
    const resourceClass = String(this.client.resourceClass);
    const resourceName = String(this.client.resourceName);
    const windowRole = String(this.client.windowRole);
    return (
      this.client.specialWindow ||
      resourceClass === "plasmashell" ||
      resourceClass === "ksmserver" ||
      resourceClass === "org.kde.plasmashell" ||
      resourceClass === "krunner" ||
      resourceClass === "kded5" ||
      this.client.transient ||
      this.config.ignoreClass.indexOf(resourceClass) >= 0 ||
      this.config.ignoreClass.indexOf(resourceName) >= 0 ||
      matchWords(this.client.caption, this.config.ignoreTitle) >= 0 ||
      this.config.ignoreRole.indexOf(windowRole) >= 0
    );
  }

  public get shouldFloat(): boolean {
    const resourceClass = String(this.client.resourceClass);
    const resourceName = String(this.client.resourceName);
    return (
      this.client.modal ||
      !this.client.resizeable ||
      this.config.newWindowSpawnLocation === "floating" ||
      (this.config.floatUtility &&
        (this.client.dialog ||
          this.client.splash ||
          this.client.utility ||
          this.client.transient)) ||
      this.config.floatingClass.indexOf(resourceClass) >= 0 ||
      this.config.floatingClass.indexOf(resourceName) >= 0 ||
      matchWords(this.client.caption, this.config.floatingTitle) >= 0
    );
  }

  public onDesktopChanged(): boolean {
    // don't handle the event if we triggered it
    // this.log.log(`this._changingDesktop ${this._changingDesktop}`);
    const shouldCallback = this._desktop != this.client.desktop;
    this._desktop = this.client.desktop;
    return shouldCallback;
  }

  public onScreenChanged(): boolean {
    // don't handle the event if we triggered it
    const shouldCallback = this._screen != this.client.screen;
    this._screen = this.client.screen;
    return shouldCallback;
  }

  public onGeometryChanged(): boolean {
    // don't handle the event if we triggered it
    const shouldCallback = !this._changingGeometry;
    this._changingGeometry = false;
    return shouldCallback;
  }

  public get screen(): number {
    return this._screen;
  }

  public get desktop(): number {
    return this.client.desktop;
  }

  public set desktop(desktop: number) {
    // this.client.desktop = desktop;
    this._desktop = desktop;

    // save the allDesktops state to disk
    this.log.log(`TSProxy.getWindowState(): ${this}`);
    const state = JSON.parse(
      this.proxy.getWindowState(this.client.windowId.toString())
    ) as WindowConfig;

    state.allDesktops = this.client.desktop == -1;

    this.log.log(`TSProxy.putWindowState(): desktop: ${desktop} ${this}`);
    this.proxy.putWindowState(
      this.client.windowId.toString(),
      JSON.stringify(state)
    );
  }

  public get minimized(): boolean {
    return this.client.minimized;
  }

  public set minimized(min: boolean) {
    this.client.minimized = min;

    this.log.log(`TSProxy.getWindowState(): ${this}`);
    const state = JSON.parse(
      this.proxy.getWindowState(this.client.windowId.toString())
    ) as WindowConfig;

    state.minimized = min;

    this.log.log(`TSProxy.putWindowState(): minimized: ${min} ${this}`);
    this.proxy.putWindowState(
      this.client.windowId.toString(),
      JSON.stringify(state)
    );
  }

  public get shaded(): boolean {
    return this.client.shade;
  }

  public maximized: boolean;

  public get surface(): DriverSurface {
    let activity;
    if (this.client.activities.length === 0) {
      activity = this.proxy.workspace().currentActivity;
    } else if (
      this.client.activities.indexOf(this.proxy.workspace().currentActivity) >=
      0
    ) {
      activity = this.proxy.workspace().currentActivity;
    } else {
      activity = this.client.activities[0];
    }

    // //TODO return null if our group isn't currently shown on any surface
    // if (this.screen === null) {
    //   return null;
    // }

    return new DriverSurfaceImpl(
      this.screen,
      activity,
      this._desktop,
      this.qml.activityInfo,
      this.config,
      this.proxy,
      this.log
    );
  }

  public set surface(surf: DriverSurface | null) {
    // TODO: setting activity?

    if (!surf) {
      // this.hidden = true;
      return;
    }

    this.log.log(
      `DriverWindow.surface(): desktop: ${surf.desktop} screen: ${surf.screen} group: ${surf.group} ${this}`
    );

    // if (this.hidden) {
    //   this.hidden = false;
    // }

    // if (surf.desktop != -1) {
    //   this.desktop = surf.desktop;
    // }

    this._screen = surf.screen;
    this._desktop = surf.desktop;

    this.group = surf.group;
  }

  private noBorderManaged: boolean;
  private noBorderOriginal: boolean;

  public get group(): number {
    if (this._group) {
      return this._group;
    }

    const state = JSON.parse(
      this.proxy.getWindowState(this.client.windowId.toString())
    ) as WindowConfig;
    this._group = state.group;
    return this._group;
  }

  public set group(groupId: number) {
    this._group = groupId;

    this.log.log(`TSProxy.getWindowState(): ${this}`);
    const state = JSON.parse(
      this.proxy.getWindowState(this.client.windowId.toString())
    ) as WindowConfig;

    state.group = groupId;
    state.class = this.client.resourceClass.toString();
    state.title = this.client.caption.toString();

    this.log.log(`TSProxy.putWindowState(): group: ${groupId} ${this}`);
    this.proxy.putWindowState(
      this.client.windowId.toString(),
      JSON.stringify(state)
    );
  }

  public get hidden(): boolean {
    return this._hidden;
  }

  public set hidden(hide: boolean) {
    this.log.log(`set window hidden ${hide} ${this}`);
    this._hidden = hide;

    // if (hide && this.client.desktop != this.proxy.workspace().desktops) {
    //   this._desktop = this.client.desktop;
    //   this.desktop = this.proxy.workspace().desktops;
    //   this._hiding = true;
    // } else if (this.client.desktop == this.proxy.workspace().desktops) {
    //   this.client.desktop = this._desktop;
    // }
  }

  /**
   * Create a window from the KWin client object
   *
   * @param client the client the window represents
   * @param qml root qml object of the script
   * @param config
   * @param log
   */
  constructor(
    public readonly client: KWin.Client,
    private qml: Bismuth.Qml.Main,
    private config: Config,
    private log: Log,
    private proxy: TSProxy
  ) {
    this.id = DriverWindowImpl.generateID(client);
    this.maximized = false;
    this.noBorderManaged = false;
    this.noBorderOriginal = client.noBorder;
    this._desktop = client.desktop;
    this._screen = client.screen;
    this._group = 0;
    this._hidden = false;
    this._hiding = false;
    this.unmanaged = false;
    this._changingDesktop = false;
    this._changingScreen = false;
    this._changingGeometry = false;

    if (!this.shouldIgnore) {
      this._hidden = false;
    }
  }

  public static generateID(client: KWin.Client): string {
    return `${String(client)}/${client.windowId}`;
  }

  public commit(
    geometry?: Rect,
    screen?: number,
    noBorder?: boolean,
    keepAbove?: boolean
  ): void {
    // TODO: Refactor this awful function
    // this.log.log(
    //   `[DriverWindow#commit] Called with params: {
    //      geometry: ${geometry},
    //      noBorder: ${noBorder},
    //      keepAbove: ${keepAbove}
    //     } for window ${this} on the screen ${this.screen}
    //   `
    // );

    this.log.log(
      `commit(): screen: ${screen} geometry: ${geometry} window: ${this}`
    );

    if (!this.surface) {
      this.log.log(`tried to commit window with no surface ${this}`);
      // this.hidden = true;
      return;
    }

    // let kwin do the move for floating and minimized windows; it does a better job
    if (screen != undefined && screen != this.client.screen) {
      this.log.log(`WorkspaceWrapper.sendClientToScreen(): ${screen} ${this}`);
      // this._changingScreen = true;
      this._screen = screen;
      this.proxy.workspace().sendClientToScreen(this.client, screen);
      // kwin picked a good geometry, so don't override it
      geometry = undefined;
    }

    // if (this.surface.group != this.group) {
    //   this.log.log(`is hidden ${this}`);
    //   this.hidden = true;
    //   return;
    // }

    // if (this.hidden) {
    //   this.hidden = false;
    // }

    if (this.client.resize) {
      return;
    }

    if (this.client.move) {
      // return;
    }

    // if (!this.screen) {
    //   return;
    // }

    if (noBorder !== undefined) {
      if (!this.noBorderManaged && noBorder) {
        /* Backup border state when transitioning from unmanaged to managed */
        this.noBorderOriginal = this.client.noBorder;
      } else if (this.noBorderManaged && !this.client.noBorder) {
        /* If border is enabled while in managed mode, remember it.
         * Note that there's no way to know if border is re-disabled in managed mode. */
        this.noBorderOriginal = false;
      }

      if (noBorder) {
        /* (Re)entering managed mode: remove border. */
        this.client.noBorder = true;
      } else if (this.noBorderManaged) {
        /* Exiting managed mode: restore original value. */
        this.client.noBorder = this.noBorderOriginal;
      }

      /* update mode */
      this.noBorderManaged = noBorder;
    }

    if (keepAbove !== undefined) {
      this.client.keepAbove = keepAbove;
    }

    if (geometry !== undefined) {
      geometry = this.adjustGeometry(geometry);
      if (this.config.preventProtrusion) {
        const area = Rect.fromQRect(
          this.proxy.workspace().clientArea(
            0, // This is placement area
            this.surface.screen,
            this.client.desktop
          )
        );
        if (!area.includes(geometry)) {
          /* assume windows will extrude only through right and bottom edges */
          const x = geometry.x + Math.min(area.maxX - geometry.maxX, 0);
          const y = geometry.y + Math.min(area.maxY - geometry.maxY, 0);
          geometry = new Rect(x, y, geometry.width, geometry.height);
          geometry = this.adjustGeometry(geometry);
        }
      }
      if (this.client.frameGeometry != geometry.toQRect()) {
        if (!this.client.move) {
          this.log.log(`set KWin.Window.frameGeometry: ${this}`);
          this._changingGeometry = true;
          this.client.frameGeometry = geometry.toQRect();
        } else {
          // // it would be nice to keep the window centered on the cursor as it
          // // resizes, but this doesn't work
          // const xDelta = this.client.frameGeometry.width - geometry.width;
          // const yDelta = this.client.frameGeometry.height - geometry.height;
          // this.client.frameGeometry.width += xDelta / 2;
          // this.client.frameGeometry.height += yDelta / 2;

          this.log.log(`set KWin.Window.frameGeometry: ${this}`);
          this._changingGeometry = true;
          this.client.frameGeometry.width = geometry.width;
          this.client.frameGeometry.height = geometry.height;
        }
      } else {
        this.log.log(`KWin.Window.frameGeometry unchanged ${this}`);
      }
    }

    if (this.client.desktop != this.surface.desktop) {
      this.log.log(
        `commit(): moved to desktop ${this.surface.desktop} ${this}`
      );
      this._changingDesktop = true;
      this.client.desktop = this.surface.desktop;
    } else {
      this.log.log(
        `commit(): already on desktop ${this.surface.desktop} ${this}`
      );
    }
  }

  public toString(): string {
    // Using a shorthand name to keep debug message tidy
    return `KWin(${this.client.windowId.toString(16)}.${
      this.client.resourceClass
    })`;
  }

  public visible(activity: string, desktop: number): boolean {
    return (
      !this.client.minimized &&
      (this.client.desktop === desktop ||
        this.client.desktop === -1) /* on all desktop */ &&
      (this.client.activities.length === 0 /* on all activities */ ||
        this.client.activities.indexOf(activity) !== -1)
    );
  }

  public visibleOn(surf: DriverSurface): boolean {
    return !this.client.minimized && this.group == surf.group;
    // return (
    //   this.visible(surf.activity, surf.desktop) &&
    //   (this.group == surf.group || this.screen == surf.screen)
    // );
  }

  public on(surf: DriverSurface): boolean {
    const win = this as DriverWindow;
    return (
      win.group == surf.group
      // ((this.client.desktop === surf.desktop ||
      //   this.client.desktop === -1) /* on all desktop */ &&
      //   (this.client.activities.length === 0 /* on all activities */ ||
      //     this.client.activities.indexOf(surf.activity) !== -1) &&
      //   win.screen == surf.screen)
    );
  }

  /**
   * Apply various resize hints to the given geometry
   * @param geometry
   * @returns
   */
  private adjustGeometry(geometry: Rect): Rect {
    let width = geometry.width;
    let height = geometry.height;

    /* do not resize fixed-size windows */
    if (!this.client.resizeable) {
      width = this.client.frameGeometry.width;
      height = this.client.frameGeometry.height;
    } else {
      /* respect min/max size limit */
      width = clip(width, this.client.minSize.width, this.client.maxSize.width);
      height = clip(
        height,
        this.client.minSize.height,
        this.client.maxSize.height
      );
    }

    return new Rect(geometry.x, geometry.y, width, height);
  }

  public get isDialog(): boolean {
    return this.client.dialog;
  }
}
