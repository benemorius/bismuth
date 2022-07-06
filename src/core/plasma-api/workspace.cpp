// SPDX-FileCopyrightText: 2022 Mikhail Zolotukhin <mail@gikari.com>
// SPDX-License-Identifier: MIT

#include "workspace.hpp"

#include <QQmlContext>

#include "logger.hpp"
#include "plasma-api/api.hpp"
#include "plasma-api/client.hpp"

namespace PlasmaApi
{

Workspace::Workspace(QObject *implPtr)
    : QObject()
    , m_kwinImpl(implPtr)
{
    wrapSignals();
}

Workspace::Workspace(const Workspace &rhs)
    : QObject()
    , m_kwinImpl(rhs.m_kwinImpl)
{
    wrapSignals();
};

std::optional<PlasmaApi::Client> Workspace::activeClient() const
{
    auto kwinClient = m_kwinImpl->property("activeClient").value<QObject *>();
    return kwinClient ? PlasmaApi::Client(kwinClient) : std::optional<PlasmaApi::Client>();
}

void Workspace::setActiveClient(std::optional<PlasmaApi::Client> client)
{
    qDebug(Bi) << "omgwtf Workspace::setActiveClient";
    auto valueToSet = client.has_value() ? client->m_kwinImpl : nullptr;
    m_kwinImpl->setProperty("activeClient", QVariant::fromValue(valueToSet));
}

void Workspace::wrapSignals()
{
    auto wrapSimpleSignal = [this](const char *signalSignature) {
        auto signalsSignature = QMetaObject::normalizedSignature(signalSignature);
        connect(m_kwinImpl, signalsSignature, this, signalsSignature);
    };

    auto wrapComplexSignal = [this](const char *implSignalSignature, const char *thisSignalSignature) {
        auto implNormSignature = QMetaObject::normalizedSignature(implSignalSignature);
        auto thisNormSignature = QMetaObject::normalizedSignature(thisSignalSignature);
        connect(m_kwinImpl, implNormSignature, this, thisNormSignature);
    };

    wrapSimpleSignal(SIGNAL(numberScreensChanged(int)));
    wrapSimpleSignal(SIGNAL(screenResized(int)));
    wrapSimpleSignal(SIGNAL(currentActivityChanged(const QString &)));

    wrapComplexSignal(SIGNAL(currentDesktopChanged(int, KWin::AbstractClient *)), SLOT(currentDesktopChangedTransformer(int, KWin::AbstractClient *)));
    wrapComplexSignal(SIGNAL(clientAdded(KWin::AbstractClient *)), SLOT(clientAddedTransformer(KWin::AbstractClient *)));
    wrapComplexSignal(SIGNAL(clientRemoved(KWin::AbstractClient *)), SLOT(clientRemovedTransformer(KWin::AbstractClient *)));
    wrapComplexSignal(SIGNAL(clientMinimized(KWin::AbstractClient *)), SLOT(clientMinimizedTransformer(KWin::AbstractClient *)));
    wrapComplexSignal(SIGNAL(clientUnminimized(KWin::AbstractClient *)), SLOT(clientUnminimizedTransformer(KWin::AbstractClient *)));
    wrapComplexSignal(SIGNAL(clientMaximizeSet(KWin::AbstractClient *, bool, bool)), SLOT(clientMaximizeSetTransformer(KWin::AbstractClient *, bool, bool)));
};

QRect Workspace::clientArea(ClientAreaOption option, int screen, int desktop)
{
    // qDebug(Bi) << "omgwtf Workspace::clientArea";
    BI_METHOD_IMPL_WRAP(QRect, "clientArea(ClientAreaOption, int, int)", Q_ARG(ClientAreaOption, option), Q_ARG(int, screen), Q_ARG(int, desktop));
};

// bool Workspace::setWindowHidden(QObject *client, bool isHidden)
// {
//   qDebug(Bi) << "omgwtf Workspace::setWindowHidden";
//   // return true;

//   // KWin::AbstractClient *cli = reinterpret_cast<KWin::AbstractClient *>(client);

//   // BI_METHOD_IMPL_WRAP(bool, "setWindowHidden(KWin::AbstractClient *, bool)", Q_ARG(KWin::AbstractClient *, cli), Q_ARG(bool, isHidden));
//   // BI_METHOD_IMPL_WRAP(bool, "setWindowHidden()", QGenericArgument(nullptr));

//   auto apiCall = [&]() -> bool {
//     BI_METHOD_IMPL_WRAP(bool, "setWindowHidden()", QGenericArgument(nullptr));
//   };

//   auto apiCallRes = apiCall();

//   return apiCallRes;
// };

void Workspace::sendClientToScreen(QObject *client, int screen)
{
  KWin::AbstractClient *cli = reinterpret_cast<KWin::AbstractClient *>(client);
  // qDebug(Bi) << "sendClientToScreen" << screen << cli;
  BI_METHOD_IMPL_WRAP_VOID("sendClientToScreen(KWin::Window *, int)", Q_ARG(KWin::AbstractClient *, cli), Q_ARG(int, screen));
}

bool Workspace::isWindowHidden(QObject *client)
{
  KWin::AbstractClient *cli = reinterpret_cast<KWin::AbstractClient *>(client);
  auto apiCall = [&]() -> bool {
    // BI_METHOD_IMPL_WRAP(QString, "wtf(int)", Q_ARG(int, screen));
    BI_METHOD_IMPL_WRAP(bool, "isWindowHidden(KWin::Window *)", Q_ARG(KWin::AbstractClient *, cli));
  };

  auto apiCallRes = apiCall();

  // qDebug(Bi) << apiCallRes;

  return apiCallRes;
}

bool Workspace::setWindowHidden(QObject *client, bool isHidden)
{
  // qDebug(Bi) << "omgwtf Workspace::setWindowHidden";
  // return true;

  KWin::AbstractClient *cli = reinterpret_cast<KWin::AbstractClient *>(client);
  // int *i = 0;
  // KWin::AbstractClient *i = 0;

  // BI_METHOD_IMPL_WRAP(bool, "setWindowHidden(KWin::AbstractClient *, bool)", Q_ARG(KWin::AbstractClient *, cli), Q_ARG(bool, isHidden));
  // BI_METHOD_IMPL_WRAP(bool, "setWindowHidden()", QGenericArgument(nullptr));

  auto apiCall = [&]() -> bool {
    // BI_METHOD_IMPL_WRAP(QString, "wtf(int)", Q_ARG(int, screen));
    BI_METHOD_IMPL_WRAP(bool, "setWindowHidden(KWin::Window *, bool)", Q_ARG(KWin::AbstractClient *, cli), Q_ARG(bool, isHidden));
  };

  auto apiCallRes = apiCall();

  // qDebug(Bi) << apiCallRes;

  return apiCallRes;
};

std::vector<PlasmaApi::Client> Workspace::clientList() const
{
    qDebug(Bi) << "omgwtf Workspace::clientList";
    auto apiCall = [&]() -> QList<KWin::AbstractClient *> {
        BI_METHOD_IMPL_WRAP(QList<KWin::AbstractClient *>, "clientList()", QGenericArgument(nullptr));
    };

    auto apiCallRes = apiCall();

    auto result = std::vector<PlasmaApi::Client>();
    result.reserve(apiCallRes.size());
    for (auto clientPtr : apiCallRes) {
        if (clientPtr) {
            result.push_back(Client(reinterpret_cast<QObject *>(clientPtr)));
        }
    }

    return result;
}

void Workspace::currentDesktopChangedTransformer(int desktop, KWin::AbstractClient *kwinClient)
{
    // Since we don't know the KWin internal implementation we have to use reinterpret_cast
    auto clientWrapper = Client(reinterpret_cast<QObject *>(kwinClient));
    Q_EMIT currentDesktopChanged(desktop, clientWrapper);
};

void Workspace::clientAddedTransformer(KWin::AbstractClient *kwinClient)
{
    auto clientWrapper = Client(reinterpret_cast<QObject *>(kwinClient));
    Q_EMIT clientAdded(clientWrapper);
}

void Workspace::clientRemovedTransformer(KWin::AbstractClient *kwinClient)
{
    auto clientWrapper = Client(reinterpret_cast<QObject *>(kwinClient));
    Q_EMIT clientRemoved(clientWrapper);
}

void Workspace::clientMinimizedTransformer(KWin::AbstractClient *kwinClient)
{
    auto clientWrapper = Client(reinterpret_cast<QObject *>(kwinClient));
    Q_EMIT clientMinimized(clientWrapper);
}

void Workspace::clientUnminimizedTransformer(KWin::AbstractClient *kwinClient)
{
    auto clientWrapper = Client(reinterpret_cast<QObject *>(kwinClient));
    Q_EMIT clientUnminimized(clientWrapper);
}

void Workspace::clientMaximizeSetTransformer(KWin::AbstractClient *kwinClient, bool h, bool v)
{
    auto clientWrapper = Client(reinterpret_cast<QObject *>(kwinClient));
    Q_EMIT clientMaximizeSet(clientWrapper, h, v);
}

}
