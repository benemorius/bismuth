// SPDX-FileCopyrightText: 2022 Mikhail Zolotukhin <mail@gikari.com>
// SPDX-License-Identifier: MIT

import { Config } from "../config";
import { Action } from "../controller/action";

export interface TSProxy {
  workspace(): KWin.WorkspaceWrapper;
  jsConfig(): Config;
  registerShortcut(data: Action): void;
  log(value: any): void;
  getWindowState(windowId: string): string;
  putWindowState(windowId: string, state: string): void;
  getLayoutState(layoutId: string): string;
  putLayoutState(layoutId: string, state: string): void;
  // layoutState(stateId: string): LayoutState;
  getWindowList(): string;
  putWindowList(list: string): void;
  getSurfaceGroups(desktop: number, screen: number): string[];
  setSurfaceGroups(desktop: number, screen: number, groups: string[]): void;
}
