// SPDX-FileCopyrightText: 2022 Mikhail Zolotukhin <mail@gikari.com>
// SPDX-License-Identifier: MIT

#include "ts-proxy.hpp"

#include <KGlobalAccel>
#include <KLocalizedString>
#include <QAction>
#include <QKeySequence>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonValue>
#include <QJsonArray>

#include "controller.hpp"
#include "logger.hpp"
#include "plasma-api/api.hpp"

TSProxy::TSProxy(QQmlEngine *engine, Bismuth::Controller &controller, PlasmaApi::Api &plasmaApi, Bismuth::Config &config)
    : QObject()
    , m_engine(engine)
    , m_config(config)
    , m_controller(controller)
    , m_plasmaApi(plasmaApi)
{
}

QJSValue TSProxy::jsConfig()
{
    auto configJSObject = m_engine->newObject();

    auto setProp = [&configJSObject](const char *propName, const QJSValue &value) {
        configJSObject.setProperty(QString::fromUtf8(propName), value);
    };

    setProp("layoutOrder", m_engine->newArray());
    auto layoutOrderProp = configJSObject.property(QStringLiteral("layoutOrder"));

    auto arrayIndexCounter = 0;
    auto addLayout = [&arrayIndexCounter, &layoutOrderProp, this](const char *configKey, const char *layoutId) {
        auto layoutEnabled = m_config.property(configKey).toBool();
        if (layoutEnabled) {
            layoutOrderProp.setProperty(arrayIndexCounter, QString::fromUtf8(layoutId));
            arrayIndexCounter++;
        }
    };

    // HACK: We have to hardcode layoutIds here for now
    addLayout("enableTileLayout", "TileLayout");
    addLayout("enableTabbedMasterLayout", "TabbedMasterLayout");
    addLayout("enableMonocleLayout", "MonocleLayout");
    addLayout("enableThreeColumnLayout", "ThreeColumnLayout");
    addLayout("enableSpreadLayout", "SpreadLayout");
    addLayout("enableStairLayout", "StairLayout");
    addLayout("enableSpiralLayout", "SpiralLayout");
    addLayout("enableQuarterLayout", "QuarterLayout");
    addLayout("enableFloatingLayout", "FloatingLayout");
    addLayout("enableCascadeLayout", "CascadeLayout");

    setProp("monocleMaximize", m_config.monocleMaximize());
    setProp("maximizeSoleTile", m_config.maximizeSoleTile());
    setProp("monocleMinimizeRest", m_config.monocleMinimizeRest());
    setProp("untileByDragging", m_config.untileByDragging());
    setProp("experimentalBackend", m_config.experimentalBackend());

    setProp("keepFloatAbove", m_config.keepFloatAbove());
    setProp("noTileBorder", m_config.noTileBorder());

    if (m_config.limitTileWidth()) {
        setProp("limitTileWidthRatio", m_config.limitTileWidthRatio());
    } else {
        setProp("limitTileWidthRatio", 0);
    }

    setProp("screenGapBottom", m_config.screenGapBottom());
    setProp("screenGapLeft", m_config.screenGapLeft());
    setProp("screenGapRight", m_config.screenGapRight());
    setProp("screenGapTop", m_config.screenGapTop());
    setProp("tileLayoutGap", m_config.tileLayoutGap());

    setProp("newWindowSpawnLocation", m_config.newWindowSpawnLocation());
    setProp("moveBetweenSurfaces", m_config.moveBetweenSurfaces());
    setProp("mouseDragInsert", m_config.mouseDragInsert());
    setProp("layoutPerActivity", m_config.layoutPerActivity());
    setProp("layoutPerDesktop", m_config.layoutPerDesktop());

    setProp("preventMinimize", m_config.preventMinimize());
    setProp("preventProtrusion", m_config.preventProtrusion());

    setProp("floatUtility", m_config.floatUtility());

    auto setStrArrayProp = [&configJSObject, this, &setProp](const char *propName, const QString &commaSeparatedString, bool asNumbers = false) {
        auto strList = commaSeparatedString.split(QLatin1Char(','), Qt::SkipEmptyParts);

        setProp(propName, m_engine->newArray());
        auto arrayProperty = configJSObject.property(QString::fromUtf8(propName));

        for (auto i = 0; i < strList.size(); ++i) {
            auto value = strList.at(i);
            if (asNumbers) {
                arrayProperty.setProperty(i, value.toInt());
            } else {
                arrayProperty.setProperty(i, value.trimmed());
            }
        }
    };

    setStrArrayProp("floatingClass", m_config.floatingClass());
    setStrArrayProp("floatingTitle", m_config.floatingTitle());
    setStrArrayProp("ignoreClass", m_config.ignoreClass());
    setStrArrayProp("ignoreTitle", m_config.ignoreTitle());
    setStrArrayProp("ignoreRole", m_config.ignoreRole());

    setStrArrayProp("ignoreActivity", m_config.ignoreActivity());
    setStrArrayProp("ignoreScreen", m_config.ignoreScreen(), true);

    return configJSObject;
}

QJSValue TSProxy::workspace()
{
    auto &workspace = m_plasmaApi.workspace();
    auto jsValue = m_engine->newQObject(&workspace);
    QQmlEngine::setObjectOwnership(&workspace, QQmlEngine::CppOwnership);
    return jsValue;
}

QString TSProxy::getLayoutState(QString stateId)
{
    QString fileText;
    QFile file;
    file.setFileName("/dev/shm/kwin-bismuth-layoutstates.json");
    file.open(QIODevice::ReadOnly | QIODevice::Text);
    fileText = file.readAll();
    file.close();

    QJsonDocument doc = QJsonDocument::fromJson(fileText.toUtf8());
    QJsonObject root = doc.object();
    QJsonObject states = root["LayoutStates"].toObject();

    QJsonDocument state = QJsonDocument(states[stateId].toObject());
    QString json = state.toJson();
    // qWarning() << "got json layoutState: " << json;

    if (json.isEmpty()) {
      return "{}";
    }
    return json;
}

void TSProxy::putLayoutState(QString stateId, QString state)
{
    QString fileText;
    QFile file;
    file.setFileName("/dev/shm/kwin-bismuth-layoutstates.json");
    file.open(QIODevice::ReadOnly | QIODevice::Text);
    fileText = file.readAll();
    file.close();

    QJsonDocument doc = QJsonDocument::fromJson(fileText.toUtf8());
    QJsonObject root = doc.object();

    QJsonDocument newDoc = QJsonDocument::fromJson(state.toUtf8());
    QJsonObject newObj = newDoc.object();

    QJsonObject states = root["LayoutStates"].toObject();

    states[stateId] = newObj;

    root["LayoutStates"] = states;

    QJsonDocument writeDoc = QJsonDocument(root);

    file.open(QIODevice::WriteOnly | QIODevice::Text);
    // file.seek(0);
    file.write(writeDoc.toJson());
    file.close();
}

QString TSProxy::getWindowState(QString windowId)
{
    QString fileText;
    QFile file;
    file.setFileName("/dev/shm/kwin-bismuth-windowstates.json");
    file.open(QIODevice::ReadOnly | QIODevice::Text);
    fileText = file.readAll();
    file.close();

    // qWarning() << fileText;
    QJsonDocument doc = QJsonDocument::fromJson(fileText.toUtf8());
    QJsonObject states = doc.object()["WindowStates"].toObject();

    // QJsonValue value = obj.value(windowId);

    // qWarning() << value;
    // QJsonObject item = value.toObject();
    // qWarning() << tr("QJsonObject of description: ") << item;

    // /* in case of string value get value and convert into string*/
    // qWarning() << tr("QJsonObject[appName] of description: ") << item["description"];
    // QJsonValue subobj = item["description"];
    // qWarning() << subobj.toString();

    // /* in case of array get array and convert into string*/
    // qWarning() << tr("QJsonObject[appName] of value: ") << item["imp"];
    // QJsonArray test = item["imp"].toArray();
    // qWarning() << test[1].toString();

    // qWarning() << "returning " << obj[windowId].toInt();
    // return obj[windowId].toInt();


    QJsonDocument newState = QJsonDocument(states[windowId].toObject());
    QString json = newState.toJson();
    // qWarning() << "got json windowState: " << json;

    if (json.isEmpty()) {
      return "{}";
    }
    return json;
}

void TSProxy::putWindowState(QString windowId, QString state)
{
    QString fileText;
    QFile file;
    file.setFileName("/dev/shm/kwin-bismuth-windowstates.json");
    file.open(QIODevice::ReadOnly | QIODevice::Text);
    fileText = file.readAll();
    file.close();

    QJsonDocument doc = QJsonDocument::fromJson(fileText.toUtf8());
    QJsonObject root = doc.object();
    QJsonObject states = root["WindowStates"].toObject();

    // QJsonValue value = obj.value(windowId);

    // if (obj[windowId].toInt() == groupId) {
    //   file.close();
    //   return;
    // }

    // qWarning() << fileText;
    // qWarning() << obj[windowId];

    // qWarning() << "changing group from " << obj[windowId].toInt() << " to " << groupId;
    // value.fromVariant(groupId);
    // obj["group"] = groupId;

    states[windowId] = QJsonDocument::fromJson(state.toUtf8()).object();
    root["WindowStates"] = states;


    // doc.fromVariant(value.toObject());
    // QJsonDocument newDoc = QJsonDocument(obj);

    // qWarning() << "json: " << newDoc.toJson();

    file.open(QIODevice::WriteOnly | QIODevice::Text);
    file.write(QJsonDocument(root).toJson());
    file.close();
}

QString TSProxy::getWindowList()
{
    QString fileText;
    QFile file;
    file.setFileName("/dev/shm/kwin-bismuth-windowlist.json");
    file.open(QIODevice::ReadOnly | QIODevice::Text);
    fileText = file.readAll();
    file.close();

    QJsonDocument doc = QJsonDocument::fromJson(fileText.toUtf8());
    QJsonObject root = doc.object();
    // QJsonObject list = root["WindowList"].toObject();

    QJsonArray list = QJsonArray(root["WindowList"].toArray());
    QJsonDocument listDoc = QJsonDocument(list);
    QString json = listDoc.toJson();
    // qWarning() << "got json list: " << json;

    // if (json.isEmpty() || !root["WindowList"].toArray().count()) {
    //   return "[]";
    // }
    return json;
}

void TSProxy::putWindowList(const QString list)
{
    QString fileText;
    QFile file;
    file.setFileName("/dev/shm/kwin-bismuth-windowlist.json");
    file.open(QIODevice::ReadOnly | QIODevice::Text);
    fileText = file.readAll();
    file.close();

    QJsonDocument doc = QJsonDocument::fromJson(fileText.toUtf8());
    QJsonObject root = doc.object();

    QJsonDocument newDoc = QJsonDocument::fromJson(list.toUtf8());
    QJsonArray newList = newDoc.array();

    // QJsonArray list = root["WindowList"].toArray();
    // QJsonArray list = QJsonArray(newObj.toArray());

    // root[stateId] = newObj;

    root["WindowList"] = newList;

    file.open(QIODevice::WriteOnly | QIODevice::Text);
    file.write(QJsonDocument(root).toJson());
    file.close();
}

QVector<QString> TSProxy::getSurfaceGroups(int desktop, int screen)
{
    QString fileText;
    QFile file;
    file.setFileName("/dev/shm/kwin-bismuth-surfacegroups.json");
    file.open(QIODevice::ReadOnly | QIODevice::Text);
    fileText = file.readAll();
    file.close();

    QJsonDocument doc = QJsonDocument::fromJson(fileText.toUtf8());
    QJsonObject root = doc.object();
    QJsonObject surfs = root["Surfaces"].toObject();

    QString id = QString("%1:%2").arg(desktop).arg(screen);
    QString groupString = surfs[id].toObject()["groups"].toString();
    QStringList groups = groupString.split(",");
    groups.removeAll({}); // remove empty entries

    return groups.toVector();
}

void TSProxy::setSurfaceGroups(int desktop, int screen, QVector<QString> groups)
{
    QString fileText;
    QFile file;
    file.setFileName("/dev/shm/kwin-bismuth-surfacegroups.json");
    file.open(QIODevice::ReadOnly | QIODevice::Text);
    fileText = file.readAll();
    file.close();

    QJsonDocument doc = QJsonDocument::fromJson(fileText.toUtf8());
    QJsonObject root = doc.object();
    QJsonObject surfs = root["Surfaces"].toObject();

    QString id = QString("%1:%2").arg(desktop).arg(screen);

    QJsonObject surf = surfs[id].toObject();
    surf["groups"] = groups.toList().join(",");

    surfs[id] = surf;
    root["Surfaces"] = surfs;

    file.open(QIODevice::WriteOnly | QIODevice::Text);
    file.write(QJsonDocument(root).toJson());
    file.close();
}

void TSProxy::registerShortcut(const QJSValue &tsAction)
{
    auto id = tsAction.property("key").toString();
    auto desk = tsAction.property("description").toString();
    auto keybinding = tsAction.property("defaultKeybinding").toString();

    // NOTE: Lambda MUST capture by copy, otherwise it is an undefined behavior
    m_controller.registerAction({id, desk, keybinding, [=]() {
                                     auto callback = tsAction.property("execute");
                                     qDebug(Bi) << "Shortcut triggered! Id:" << id;
                                     callback.callWithInstance(tsAction);
                                 }});
}

void TSProxy::log(const QJSValue &value)
{
    auto valAsString = value.toString();
    qDebug(Bi).noquote() << valAsString;
};

void TSProxy::setJsController(const QJSValue &value)
{
    m_jsController = value;
}

QJSValue TSProxy::jsController()
{
    return m_jsController;
}
