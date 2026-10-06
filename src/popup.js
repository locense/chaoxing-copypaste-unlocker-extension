(function () {
    'use strict';

    const Defaults = globalThis.CXPasteDefaults;

    if (!Defaults) {
        return;
    }

    const elements = {
        pageBadge: document.getElementById('page-badge'),
        statusMatch: document.getElementById('status-match'),
        statusInject: document.getElementById('status-inject'),
        statusFrames: document.getElementById('status-frames'),
        statusIframes: document.getElementById('status-iframes'),
        statusEvents: document.getElementById('status-events'),
        statusError: document.getElementById('status-error'),
        enabled: document.getElementById('enabled'),
        showPanel: document.getElementById('showPanel'),
        debugLogs: document.getElementById('debugLogs'),
        eventInputs: Array.from(document.querySelectorAll('[data-event]'))
    };

    let settings = Defaults.cloneDefaultSettings();
    let activeTab = null;
    let refreshTimer = null;
    let statusRequestInFlight = false;

    async function sendMessage(message) {
        try {
            return await chrome.runtime.sendMessage(message);
        } catch (error) {
            return {
                ok: false,
                error: error && error.message ? error.message : String(error)
            };
        }
    }

    function setBadge(text, tone) {
        elements.pageBadge.textContent = text;
        elements.pageBadge.className = 'badge ' + tone;
    }

    function setText(element, text, className) {
        element.textContent = text;
        element.className = className || '';
    }

    function renderSettings() {
        elements.enabled.checked = settings.enabled;
        elements.showPanel.checked = settings.showPanel;
        elements.debugLogs.checked = settings.debugLogs;

        elements.eventInputs.forEach(function (input) {
            const key = input.getAttribute('data-event');
            input.checked = Boolean(settings.events[key]);
        });

        document.body.classList.toggle('disabled', !settings.enabled);
    }

    function renderStatus(status) {
        if (!status) {
            return;
        }

        const matched = Boolean(status.matched);
        const injected = Boolean(status.injected);

        if (!matched) {
            setBadge('未匹配', 'neutral');
        } else if (!settings.enabled) {
            setBadge('已停用', 'warn');
        } else if (injected) {
            setBadge('已生效', 'good');
        } else {
            setBadge('待注入', 'warn');
        }

        setText(
            elements.statusMatch,
            matched ? '是' : '否',
            matched ? 'ok' : 'secondary'
        );

        if (!matched) {
            setText(elements.statusInject, '不适用', 'secondary');
        } else if (!settings.enabled) {
            setText(elements.statusInject, '已停用', 'warn-text');
        } else {
            setText(
                elements.statusInject,
                injected ? '已注入' : '未确认',
                injected ? 'ok' : 'warn-text'
            );
        }

        const frameCount = Number(status.injectedFrameCount || 0);
        const reportCount = Number(status.frameReportCount || 0);
        setText(
            elements.statusFrames,
            reportCount > 0 ? frameCount + ' / ' + reportCount : '0',
            frameCount > 0 ? 'ok' : 'secondary'
        );

        setText(
            elements.statusIframes,
            '可访问 ' + Number(status.accessibleIframes || 0) +
            ' · 不可访问 ' + Number(status.inaccessibleIframes || 0),
            'secondary'
        );

        const eventCount = Array.isArray(status.eventsRegistered)
            ? status.eventsRegistered.length
            : 0;

        setText(
            elements.statusEvents,
            settings.enabled ? eventCount + ' 项' : '0 项（已停用）',
            settings.enabled && eventCount > 0 ? 'ok' : 'secondary'
        );

        if (status.lastError) {
            elements.statusError.hidden = false;
            elements.statusError.textContent = status.lastError;
        } else {
            elements.statusError.hidden = true;
            elements.statusError.textContent = '';
        }
    }

    async function refreshStatus() {
        if (!activeTab || !activeTab.id || statusRequestInFlight) {
            return;
        }

        statusRequestInFlight = true;

        try {
            const response = await sendMessage({
                type: 'GET_PAGE_STATUS',
                tabId: activeTab.id
            });

            if (response && response.ok && response.status) {
                renderStatus(response.status);
            } else if (response && response.error) {
                elements.statusError.hidden = false;
                elements.statusError.textContent = response.error;
            }
        } finally {
            statusRequestInFlight = false;
        }
    }

    async function saveSettings() {
        const response = await sendMessage({
            type: 'UPDATE_SETTINGS',
            settings: settings
        });

        if (response && response.ok && response.settings) {
            settings = Defaults.normalizeSettings(response.settings);
        }

        renderSettings();
        await refreshStatus();
    }

    function bindEvents() {
        elements.enabled.addEventListener('change', function (event) {
            settings.enabled = event.target.checked;
            saveSettings();
        });

        elements.showPanel.addEventListener('change', function (event) {
            settings.showPanel = event.target.checked;
            saveSettings();
        });

        elements.debugLogs.addEventListener('change', function (event) {
            settings.debugLogs = event.target.checked;
            saveSettings();
        });

        elements.eventInputs.forEach(function (input) {
            input.addEventListener('change', function (event) {
                const key = input.getAttribute('data-event');
                if (!key) {
                    return;
                }

                settings.events[key] = event.target.checked;
                saveSettings();
            });
        });
    }

    async function initialize() {
        const stored = await chrome.storage.local.get(Defaults.SETTINGS_KEY);
        settings = Defaults.normalizeSettings(stored[Defaults.SETTINGS_KEY]);
        renderSettings();

        try {
            const tabs = await chrome.tabs.query({
                active: true,
                currentWindow: true
            });
            activeTab = tabs && tabs[0] ? tabs[0] : null;
        } catch (_) {
            activeTab = null;
        }

        bindEvents();
        await refreshStatus();
        refreshTimer = window.setInterval(refreshStatus, 1200);
    }

    window.addEventListener('unload', function () {
        if (refreshTimer !== null) {
            window.clearInterval(refreshTimer);
        }
    });

    initialize().catch(function (error) {
        elements.statusError.hidden = false;
        elements.statusError.textContent = error && error.message
            ? error.message
            : String(error);
    });
})();