// SPDX-FileCopyrightText: 2018-2019 Eon S. Jeon <esjeon@hyunmu.am>
// SPDX-FileCopyrightText: 2021 Mikhail Zolotukhin <mail@gikari.com>
// SPDX-License-Identifier: MIT

import "../code/index.mjs" as Bismuth
import QtQuick 2.0
import org.kde.bismuth.core 1.0 as BiCore
import org.kde.kwin 2.0
import org.kde.taskmanager 0.1 as TaskManager

Item {
    id: scriptRoot

    property var controller

    Component.onCompleted: {
        // Init core
        core.init();
        core.proxy.log("Initiating Bismuth: Plasma Tiling Window script!");
        const qmlObjects = {
            "scriptRoot": scriptRoot,
            "activityInfo": activityInfo,
            "popupDialog0": popupDialog0,
            "popupDialog1": popupDialog1,
            "popupDialog2": popupDialog2,
            "popupDialog3": popupDialog3,
            "popupDialog4": popupDialog4,
        };
        const kwinScriptingAPI = {
            "workspace": workspace,
            "options": options,
            "KWin": KWin
        };
        // Init legacy JS backend
        scriptRoot.controller = Bismuth.init(qmlObjects, kwinScriptingAPI, core.proxy);
        core.proxy.setJsController(scriptRoot.controller);
    }
    Component.onDestruction: {
        core.proxy.log("Calling event hooks destructors... Goodbye.");
        if (scriptRoot.controller)
            scriptRoot.controller.drop();

    }

    BiCore.Core {
        id: core
    }

    TaskManager.ActivityInfo {
        id: activityInfo
    }

    Loader {
        id: popupDialog0

        function show(text, icon, hint, subtext, screen) {
            this.item.show(text, icon, hint, subtext, screen);
        }

        source: "popup.qml"
    }
    Loader {
        id: popupDialog1

        function show(text, icon, hint, subtext, screen) {
            this.item.show(text, icon, hint, subtext, screen);
        }

        source: "popup.qml"
    }
    Loader {
        id: popupDialog2

        function show(text, icon, hint, subtext, screen) {
            this.item.show(text, icon, hint, subtext, screen);
        }

        source: "popup.qml"
    }
    Loader {
        id: popupDialog3

        function show(text, icon, hint, subtext, screen) {
            this.item.show(text, icon, hint, subtext, screen);
        }

        source: "popup.qml"
    }
    Loader {
        id: popupDialog4

        function show(text, icon, hint, subtext, screen) {
            this.item.show(text, icon, hint, subtext, screen);
        }

        source: "popup.qml"
    }

}
