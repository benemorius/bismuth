// SPDX-FileCopyrightText: 2018-2019 Eon S. Jeon <esjeon@hyunmu.am>
// SPDX-FileCopyrightText: 2021 Mikhail Zolotukhin <mail@gikari.com>
//
// SPDX-License-Identifier: MIT

export interface Config {
  experimentalBackend: boolean;

  //#region Layout
  layoutOrder: string[];
  monocleMaximize: boolean;
  maximizeSoleTile: boolean;
  monocleMinimizeRest: boolean; // KWin-specific
  untileByDragging: boolean;
  //#endregion

  //#region Features
  keepFloatAbove: boolean;
  noTileBorder: boolean;
  limitTileWidthRatio: number;
  //#endregion

  //#region Gap
  screenGapBottom: number;
  screenGapLeft: number;
  screenGapRight: number;
  screenGapTop: number;
  tileLayoutGap: number;
  //#endregion

  //#region Behavior
  newWindowSpawnLocation: string;
  moveBetweenSurfaces: boolean;
  mouseDragInsert: boolean;
  //#endregion

  //#region KWin-specific
  layoutPerActivity: boolean;
  layoutPerDesktop: boolean;
  preventMinimize: boolean;
  preventProtrusion: boolean;
  pollMouseXdotool: boolean;
  //#endregion

  //#region KWin-specific Rules
  floatUtility: boolean;

  floatingClass: string[];
  floatingTitle: string[];
  ignoreClass: string[];
  ignoreTitle: string[];
  ignoreRole: string[];

  ignoreActivity: string[];
  ignoreScreen: number[];
  //#endregion
}
