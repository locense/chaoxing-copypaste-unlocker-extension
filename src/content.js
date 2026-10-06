(function () {
    'use strict';

    const Defaults = globalThis.CXPasteDefaults;

    if (!Defaults) {
        return;
    }

    const MESSAGE_SOURCE = 'cx-paste-extension';
    const CONFIG_ATTRIBUTE = 'data-cx-paste-config';
    const CHANNEL_ATTRIBUTE = 'data-cx-paste-channel';
    const ROUTE_EVENT = '__cx_paste_route_change__';
    const PANEL_ID = '__cx_paste_extension_panel__';

    const state = {
        settings: Defaults.cloneDefaultSettings(),
        channel: '',
        injected: false,
        injectionAttempts: 0,
        scans: 0,
        accessibleIframes: 0,
        inaccessibleIframes: 0,
        iframeInjections: 0,
        runtimeStatus: null,
        lastError: null,
        initialized: false,
        lastPublishedAt: 0
    };

    let pendingPublishTimer = null;
    let pendingScanTimer = null;
    let periodicScanTimer = null;
    let fallbackScanTimer = null;
    let periodicScanCount = 0;

    const boundFrameLoad = new WeakSet();
    const observedDocuments = new WeakSet();
    const configuredDocuments = new WeakSet();

    function isTopFrame() {
        try {
            return window === window.top;
        } catch (_) {
            return false;
        }
    }

    function createChannel() {
        return 'cx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }

    function getOrCreateChannel(targetDocument) {
        if (targetDocument === document && state.channel) {
            return state.channel;
        }

        const root = targetDocument && targetDocument.documentElement;
        let channel = root && root.getAttribute(CHANNEL_ATTRIBUTE);

        if (!channel) {
            channel = createChannel();
            if (root) {
                root.setAttribute(CHANNEL_ATTRIBUTE, channel);
            }
        }

        if (targetDocument === document) {
            state.channel = channel;
        }

        return channel;
    }

    function sendRuntimeMessage(message) {
        try {
            const result = chrome.runtime.sendMessage(message);
            if (result && typeof result.catch === 'function') {
                result.catch(function () {});
            }
        } catch (_) {}
    }

    function postMessageToWindow(targetWindow, payload) {
        if (!targetWindow) {
            return;
        }

        try {
            targetWindow.postMessage(Object.assign({
                source: MESSAGE_SOURCE
            }, payload), '*');
        } catch (_) {}
    }

    function postSettingsToWindow(targetWindow, channel) {
        postMessageToWindow(targetWindow, {
            channel: channel,
            type: 'CONFIG',
            settings: state.settings
        });
    }

    function requestRuntimeStatus() {
        if (!state.channel) {
            return;
        }

        postMessageToWindow(window, {
            channel: state.channel,
            type: 'GET_STATUS'
        });
    }

    function setRuntimeConfig(targetDocument, targetWindow, countIframe) {
        if (!targetDocument || !targetDocument.documentElement) {
            return false;
        }

        const targetChannel = getOrCreateChannel(targetDocument);

        try {
            targetDocument.documentElement.setAttribute(
                CONFIG_ATTRIBUTE,
                JSON.stringify(state.settings)
            );
        } catch (error) {
            state.lastError = error && error.message
                ? error.message
                : '无法写入页面配置';
            return false;
        }

        if (!configuredDocuments.has(targetDocument)) {
            configuredDocuments.add(targetDocument);
            state.injectionAttempts += 1;

            if (targetDocument !== document && countIframe) {
                state.iframeInjections += 1;
            }
        }

        state.lastError = null;
        postSettingsToWindow(
            targetWindow || targetDocument.defaultView,
            targetChannel
        );
        return true;
    }

    function bindFrameLoad(frame) {
        if (!frame || boundFrameLoad.has(frame)) {
            return;
        }

        boundFrameLoad.add(frame);

        frame.addEventListener('load', function () {
            window.setTimeout(function () {
                scheduleScan(0);
            }, 100);
        }, false);
    }

    function scanDocumentForFrames(targetDocument, depth, countDirectFrames) {
        if (!targetDocument || !targetDocument.documentElement) {
            return;
        }

        let frames = [];
        try {
            frames = Array.from(targetDocument.querySelectorAll('iframe'));
        } catch (_) {
            return;
        }

        frames.forEach(function (frame) {
            let childDocument = null;

            try {
                childDocument = frame.contentDocument;
            } catch (_) {
                childDocument = null;
            }

            if (!childDocument) {
                if (countDirectFrames) {
                    state.inaccessibleIframes += 1;
                }
                bindFrameLoad(frame);
                return;
            }

            if (countDirectFrames) {
                state.accessibleIframes += 1;
            }

            setRuntimeConfig(
                childDocument,
                frame.contentWindow || childDocument.defaultView,
                countDirectFrames
            );
            bindFrameLoad(frame);

            if (depth < 2) {
                scanDocumentForFrames(childDocument, depth + 1, false);
            }
        });
    }

    function scanIframes() {
        if (!document.documentElement) {
            return;
        }

        state.scans += 1;
        state.accessibleIframes = 0;
        state.inaccessibleIframes = 0;

        scanDocumentForFrames(document, 0, true);
        publishStatus(false);
    }

    function scheduleScan(delay) {
        if (pendingScanTimer !== null) {
            window.clearTimeout(pendingScanTimer);
        }

        pendingScanTimer = window.setTimeout(function () {
            pendingScanTimer = null;
            scanIframes();
        }, typeof delay === 'number' ? delay : 100);
    }

    function startPeriodicScans() {
        if (periodicScanTimer !== null || fallbackScanTimer !== null) {
            return;
        }

        periodicScanTimer = window.setInterval(function () {
            periodicScanCount += 1;
            scanIframes();

            if (periodicScanCount >= 15) {
                window.clearInterval(periodicScanTimer);
                periodicScanTimer = null;

                fallbackScanTimer = window.setInterval(function () {
                    scanIframes();
                }, 30000);
            }
        }, 1500);
    }

    function buildStatus() {
        const runtime = state.runtimeStatus || {};

        return {
            version: Defaults.VERSION,
            channel: state.channel,
            frameUrl: location.href,
            top: isTopFrame(),
            injected: state.injected,
            enabled: state.settings.enabled,
            eventsRegistered: Array.isArray(runtime.eventsRegistered)
                ? runtime.eventsRegistered
                : [],
            eventCounts: runtime.counter && typeof runtime.counter === 'object'
                ? runtime.counter
                : {},
            iframeCount: document.querySelectorAll('iframe').length,
            accessibleIframes: state.accessibleIframes,
            inaccessibleIframes: state.inaccessibleIframes,
            iframeInjections: state.iframeInjections,
            scans: state.scans,
            injectionAttempts: state.injectionAttempts,
            lastError: state.lastError,
            updatedAt: Date.now()
        };
    }

    function publishStatus(force) {
        const now = Date.now();

        if (!force && now - state.lastPublishedAt < 500) {
            if (pendingPublishTimer === null) {
                pendingPublishTimer = window.setTimeout(function () {
                    pendingPublishTimer = null;
                    publishStatus(true);
                }, 500 - (now - state.lastPublishedAt));
            }
            return;
        }

        state.lastPublishedAt = now;

        sendRuntimeMessage({
            type: 'FRAME_STATUS',
            status: buildStatus()
        });

        updatePanel();
    }

    function removePanel() {
        const panel = document.getElementById(PANEL_ID);
        if (panel) {
            panel.remove();
        }
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function (character) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[character];
        });
    }

    function updatePanel() {
        if (!isTopFrame() || !state.settings.showPanel) {
            removePanel();
            return;
        }

        let panel = document.getElementById(PANEL_ID);

        if (!panel) {
            panel = document.createElement('div');
            panel.id = PANEL_ID;
            panel.setAttribute('data-cx-paste-extension', '1');
            panel.style.cssText = [
                'position:fixed',
                'right:12px',
                'top:12px',
                'z-index:2147483647',
                'pointer-events:none'
            ].join(';');
            (document.body || document.documentElement).appendChild(panel);
        }

        const shadow = panel.shadowRoot || panel.attachShadow({ mode: 'open' });
        const runtime = state.runtimeStatus || {};
        const events = Array.isArray(runtime.eventsRegistered)
            ? runtime.eventsRegistered.length
            : 0;

        shadow.innerHTML = [
            '<style>',
            ':host{all:initial}',
            '.box{width:min(360px,calc(100vw - 24px));box-sizing:border-box;background:rgba(18,18,22,.92);color:#fff;',
            'border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:10px 12px;',
            'font:12px/1.55 Consolas,Menlo,monospace;box-shadow:0 8px 28px rgba(0,0,0,.35)}',
            '.title{color:#ffb74d;font-weight:700;margin-bottom:4px}',
            '.ok{color:#81c784}.warn{color:#ffb74d}.bad{color:#ef9a9a}.muted{color:#b0bec5}',
            '</style>',
            '<div class="box">',
            '<div class="title">学习通粘贴助手 ' + escapeHtml(Defaults.VERSION) + '</div>',
            '<div>状态：' + (state.settings.enabled ? '<span class="ok">已启用</span>' : '<span class="warn">已停用</span>') + '</div>',
            '<div>MAIN：' + (state.injected ? '<span class="ok">已注入</span>' : '<span class="bad">未确认</span>') + '</div>',
            '<div>监听事件：' + events + ' 项</div>',
            '<div>iframe：可访问 ' + state.accessibleIframes + ' / 不可访问 ' + state.inaccessibleIframes + '</div>',
            '<div class="muted">' + escapeHtml(state.lastError || location.href) + '</div>',
            '</div>'
        ].join('');
    }

    function applySettings(nextSettings) {
        state.settings = Defaults.normalizeSettings(nextSettings);

        if (document.documentElement) {
            setRuntimeConfig(document, window, false);
        }

        scanIframes();
        publishStatus(true);
    }

    function onWindowMessage(event) {
        const data = event && event.data;

        if (!data || data.source !== MESSAGE_SOURCE || data.channel !== state.channel) {
            return;
        }

        if (data.type !== 'STATUS' || !data.status) {
            return;
        }

        state.runtimeStatus = data.status;
        state.injected = data.status.version ? true : state.injected;
        publishStatus(false);
    }

    function observeDynamicDom() {
        if (!document.documentElement || observedDocuments.has(document)) {
            return;
        }

        observedDocuments.add(document);

        const observer = new MutationObserver(function (mutations) {
            let shouldScan = false;

            mutations.forEach(function (mutation) {
                Array.from(mutation.addedNodes || []).forEach(function (node) {
                    if (!node || node.nodeType !== 1) {
                        return;
                    }

                    if (node.tagName === 'IFRAME' || node.querySelector && node.querySelector('iframe')) {
                        shouldScan = true;
                    }
                });
            });

            if (shouldScan) {
                scheduleScan(80);
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    function bindPageLifecycle() {
        document.addEventListener(ROUTE_EVENT, function () {
            scheduleScan(80);
        }, false);

        window.addEventListener('pageshow', function () {
            scheduleScan(0);
        }, false);

        window.addEventListener('focus', function () {
            scheduleScan(200);
        }, false);

        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) {
                scheduleScan(200);
            }
        }, false);

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                scheduleScan(0);
            }, { once: true });
        }
    }

    function bindExtensionMessages() {
        chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
            if (!message || typeof message.type !== 'string') {
                return false;
            }

            if (message.type === 'SETTINGS_UPDATED') {
                applySettings(message.settings);
                sendResponse({ ok: true });
                return false;
            }

            if (message.type === 'REQUEST_STATUS') {
                requestRuntimeStatus();
                publishStatus(true);
                sendResponse({ ok: true });
                return false;
            }

            return false;
        });

        chrome.storage.onChanged.addListener(function (changes, areaName) {
            if (areaName !== 'local' || !changes[Defaults.SETTINGS_KEY]) {
                return;
            }

            applySettings(changes[Defaults.SETTINGS_KEY].newValue);
        });
    }

    async function loadSettings() {
        try {
            const stored = await chrome.storage.local.get(Defaults.SETTINGS_KEY);
            return Defaults.normalizeSettings(stored[Defaults.SETTINGS_KEY]);
        } catch (_) {
            return Defaults.cloneDefaultSettings();
        }
    }

    async function initialize() {
        if (state.initialized || !Defaults.isChaoxingUrl(location.href)) {
            return;
        }

        state.initialized = true;
        state.settings = await loadSettings();
        state.channel = getOrCreateChannel(document);

        window.addEventListener('message', onWindowMessage, false);
        bindExtensionMessages();
        bindPageLifecycle();
        observeDynamicDom();

        setRuntimeConfig(document, window, false);
        scanIframes();
        startPeriodicScans();
        requestRuntimeStatus();
        window.setTimeout(requestRuntimeStatus, 100);
        window.setTimeout(requestRuntimeStatus, 500);
        publishStatus(true);
    }

    initialize();
})();