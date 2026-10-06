importScripts('defaults.js');

const Defaults = globalThis.CXPasteDefaults;
const frameStatuses = new Map();
const STATUS_TTL_MS = 60000;
const FRESH_STATUS_MS = 10000;
const MAX_FRAMES_PER_TAB = 100;

function delay(milliseconds) {
    return new Promise(function (resolve) {
        setTimeout(resolve, milliseconds);
    });
}

function cloneSettings(settings) {
    return JSON.parse(JSON.stringify(settings));
}

async function getSettings() {
    const stored = await chrome.storage.local.get(Defaults.SETTINGS_KEY);
    const normalized = Defaults.normalizeSettings(stored[Defaults.SETTINGS_KEY]);

    if (JSON.stringify(stored[Defaults.SETTINGS_KEY]) !== JSON.stringify(normalized)) {
        await chrome.storage.local.set({
            [Defaults.SETTINGS_KEY]: normalized
        });
    }

    return normalized;
}

async function updateSettings(patch) {
    const current = await getSettings();
    const source = patch && typeof patch === 'object' ? patch : {};

    const merged = Defaults.normalizeSettings(Object.assign({}, current, source, {
        events: Object.assign({}, current.events, source.events || {})
    }));

    await chrome.storage.local.set({
        [Defaults.SETTINGS_KEY]: merged
    });

    return merged;
}

async function ensureDefaults() {
    const settings = await getSettings();
    return settings;
}

function cleanupTabStatuses(tabId, maxAgeMs) {
    const statuses = frameStatuses.get(tabId);
    if (!statuses) {
        return new Map();
    }

    const cutoff = Date.now() - (maxAgeMs || STATUS_TTL_MS);
    Array.from(statuses.entries()).forEach(function (entry) {
        if (!entry[1] || !entry[1].updatedAt || entry[1].updatedAt < cutoff) {
            statuses.delete(entry[0]);
        }
    });

    return statuses;
}

function storeFrameStatus(tabId, frameId, status) {
    if (!tabId || !status || typeof status !== 'object') {
        return;
    }

    let statuses = frameStatuses.get(tabId);
    if (!statuses) {
        statuses = new Map();
        frameStatuses.set(tabId, statuses);
    }

    statuses.set(frameId, Object.assign({}, status, {
        frameId: frameId,
        updatedAt: Date.now()
    }));

    if (statuses.size > MAX_FRAMES_PER_TAB) {
        const oldest = Array.from(statuses.entries())
            .sort(function (a, b) {
                return (a[1].updatedAt || 0) - (b[1].updatedAt || 0);
            })
            .slice(0, statuses.size - MAX_FRAMES_PER_TAB);

        oldest.forEach(function (entry) {
            statuses.delete(entry[0]);
        });
    }
}

function aggregateTabStatus(tabId, tabUrl, freshOnly) {
    const statuses = cleanupTabStatuses(tabId, freshOnly ? FRESH_STATUS_MS : STATUS_TTL_MS);
    const frames = Array.from(statuses.values());
    const topFrame = frames.find(function (frame) {
        return frame.top === true;
    }) || frames[0] || null;

    const injectedFrames = frames.filter(function (frame) {
        return frame.injected === true;
    });

    const iframeFrames = frames.filter(function (frame) {
        return frame.top !== true && frame.injected === true;
    });

    const eventsRegistered = new Set();
    const eventCounts = {};

    frames.forEach(function (frame) {
        (frame.eventsRegistered || []).forEach(function (type) {
            eventsRegistered.add(type);
        });

        Object.keys(frame.eventCounts || {}).forEach(function (type) {
            eventCounts[type] = (eventCounts[type] || 0) + Number(frame.eventCounts[type] || 0);
        });
    });

    const lastError = frames
        .map(function (frame) { return frame.lastError; })
        .find(function (value) { return Boolean(value); }) || null;

    return {
        tabId: tabId,
        url: tabUrl || (topFrame && topFrame.frameUrl) || '',
        matched: frames.length > 0 || Defaults.isChaoxingUrl(tabUrl),
        injected: injectedFrames.length > 0,
        injectedFrameCount: injectedFrames.length,
        iframeInjectedCount: iframeFrames.length,
        frameReportCount: frames.length,
        accessibleIframes: topFrame ? Number(topFrame.accessibleIframes || 0) : 0,
        inaccessibleIframes: topFrame ? Number(topFrame.inaccessibleIframes || 0) : 0,
        iframeInjections: frames.reduce(function (sum, frame) {
            return sum + Number(frame.iframeInjections || 0);
        }, 0),
        eventsRegistered: Array.from(eventsRegistered),
        eventCounts: eventCounts,
        lastError: lastError,
        lastUpdatedAt: frames.reduce(function (latest, frame) {
            return Math.max(latest, Number(frame.updatedAt || 0));
        }, 0)
    };
}

async function refreshTabStatus(tabId) {
    try {
        await chrome.tabs.sendMessage(tabId, {
            type: 'REQUEST_STATUS'
        });
    } catch (_) {}

    await delay(200);
}

async function getPageStatus(tabId) {
    let tabUrl = '';

    try {
        const tab = await chrome.tabs.get(tabId);
        tabUrl = tab && tab.url ? tab.url : '';
    } catch (_) {}

    await refreshTabStatus(tabId);

    const status = aggregateTabStatus(tabId, tabUrl, true);
    status.settings = await getSettings();
    return status;
}

async function broadcastSettings(settings) {
    let tabs = [];

    try {
        tabs = await chrome.tabs.query({});
    } catch (_) {
        return;
    }

    await Promise.all(tabs.map(function (tab) {
        if (!tab || !tab.id) {
            return Promise.resolve();
        }

        return chrome.tabs.sendMessage(tab.id, {
            type: 'SETTINGS_UPDATED',
            settings: settings
        }).catch(function () {});
    }));
}

async function recordInstallInfo(details) {
    const version = chrome.runtime.getManifest().version;
    const stored = await chrome.storage.local.get(Defaults.INSTALL_INFO_KEY);
    const previous = stored[Defaults.INSTALL_INFO_KEY] || {};
    const now = Date.now();

    await chrome.storage.local.set({
        [Defaults.INSTALL_INFO_KEY]: {
            version: version,
            reason: details && details.reason ? details.reason : 'unknown',
            installedAt: previous.installedAt || now,
            updatedAt: now
        }
    });
}

chrome.runtime.onInstalled.addListener(function (details) {
    Promise.all([
        ensureDefaults(),
        recordInstallInfo(details)
    ]).catch(function () {});
});

chrome.runtime.onStartup.addListener(function () {
    ensureDefaults().catch(function () {});
});

chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== 'local' || !changes[Defaults.SETTINGS_KEY]) {
        return;
    }

    const settings = Defaults.normalizeSettings(changes[Defaults.SETTINGS_KEY].newValue);
    broadcastSettings(settings).catch(function () {});
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
    if (changeInfo && (changeInfo.status === 'loading' || changeInfo.url)) {
        frameStatuses.delete(tabId);
    }
});

chrome.tabs.onRemoved.addListener(function (tabId) {
    frameStatuses.delete(tabId);
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || typeof message.type !== 'string') {
        return false;
    }

    if (message.type === 'FRAME_STATUS') {
        const tabId = sender && sender.tab && sender.tab.id;
        const frameId = sender && typeof sender.frameId === 'number'
            ? sender.frameId
            : 0;

        storeFrameStatus(tabId, frameId, message.status);
        sendResponse({ ok: true });
        return false;
    }

    if (message.type === 'GET_SETTINGS') {
        getSettings()
            .then(function (settings) {
                sendResponse({ ok: true, settings: cloneSettings(settings) });
            })
            .catch(function (error) {
                sendResponse({ ok: false, error: String(error) });
            });
        return true;
    }

    if (message.type === 'UPDATE_SETTINGS') {
        updateSettings(message.settings)
            .then(function (settings) {
                sendResponse({ ok: true, settings: cloneSettings(settings) });
            })
            .catch(function (error) {
                sendResponse({ ok: false, error: String(error) });
            });
        return true;
    }

    if (message.type === 'GET_PAGE_STATUS') {
        const tabId = Number(message.tabId);

        if (!tabId) {
            sendResponse({ ok: false, error: '无效的标签页' });
            return false;
        }

        getPageStatus(tabId)
            .then(function (status) {
                sendResponse({ ok: true, status: status });
            })
            .catch(function (error) {
                sendResponse({ ok: false, error: String(error) });
            });
        return true;
    }

    return false;
});

ensureDefaults().catch(function () {});