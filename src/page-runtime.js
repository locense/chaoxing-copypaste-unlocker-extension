(function (root) {
    'use strict';

    function pageRuntime(initialConfig) {
        'use strict';

        const VERSION = '1.1.0';
        const RUNTIME_FLAG = 'data-cx-paste-runtime';
        const CHANNEL_ATTRIBUTE = 'data-cx-paste-channel';
        const MESSAGE_SOURCE = 'cx-paste-extension';
        const ROUTE_EVENT = '__cx_paste_route_change__';

        const EVENT_GROUPS = Object.freeze({
            paste: Object.freeze(['paste']),
            copyCut: Object.freeze(['copy', 'cut']),
            contextMenu: Object.freeze(['contextmenu']),
            keyboard: Object.freeze(['keydown', 'keyup', 'keypress']),
            selection: Object.freeze(['selectstart']),
            drag: Object.freeze(['dragstart']),
            mouse: Object.freeze(['mousedown'])
        });

        const counter = Object.create(null);
        const listeners = new Map();

        let config = normalizeConfig(initialConfig && initialConfig.settings);
        let channel = String(
            (initialConfig && initialConfig.channel) ||
            document.documentElement?.getAttribute(CHANNEL_ATTRIBUTE) ||
            ''
        );
        let historyHooked = false;
        let destroyed = false;

        function normalizeConfig(value) {
            const source = value && typeof value === 'object' ? value : {};
            const sourceEvents = source.events && typeof source.events === 'object'
                ? source.events
                : {};

            return {
                enabled: source.enabled !== false,
                events: {
                    paste: sourceEvents.paste !== false,
                    copyCut: sourceEvents.copyCut !== false,
                    contextMenu: sourceEvents.contextMenu !== false,
                    keyboard: sourceEvents.keyboard !== false,
                    selection: sourceEvents.selection !== false,
                    drag: sourceEvents.drag !== false,
                    mouse: sourceEvents.mouse !== false
                },
                debugLogs: source.debugLogs === true
            };
        }

        function allEventTypes() {
            const types = [];
            Object.keys(EVENT_GROUPS).forEach(function (group) {
                EVENT_GROUPS[group].forEach(function (type) {
                    if (!types.includes(type)) {
                        types.push(type);
                    }
                });
            });
            return types;
        }

        function desiredEventTypes() {
            if (!config.enabled) {
                return [];
            }

            const types = [];
            Object.keys(EVENT_GROUPS).forEach(function (group) {
                if (config.events[group] === false) {
                    return;
                }
                EVENT_GROUPS[group].forEach(function (type) {
                    if (!types.includes(type)) {
                        types.push(type);
                    }
                });
            });
            return types;
        }

        function isImportantEvent(type, event) {
            if (type === 'paste' || type === 'copy' || type === 'cut') {
                return true;
            }

            if (type !== 'keydown') {
                return false;
            }

            const key = String(event.key || '').toLowerCase();
            return Boolean((event.ctrlKey || event.metaKey) && (key === 'v' || key === 'c' || key === 'x'));
        }

        function makeHandler(type) {
            return function handleEvent(event) {
                counter[type] = (counter[type] || 0) + 1;

                if (config.debugLogs && isImportantEvent(type, event)) {
                    console.log('[粘贴助手][PAGE][EVENT]', {
                        type: type,
                        key: event.key,
                        code: event.code,
                        target: event.target && event.target.tagName,
                        targetId: event.target && event.target.id,
                        ctrlKey: event.ctrlKey,
                        metaKey: event.metaKey,
                        shiftKey: event.shiftKey,
                        altKey: event.altKey,
                        defaultPrevented: event.defaultPrevented,
                        phase: event.eventPhase,
                        counter: counter[type]
                    });
                }

                if (config.enabled) {
                    event.stopPropagation();
                }
            };
        }

        function updateListeners() {
            if (destroyed) {
                return;
            }

            const desired = new Set(desiredEventTypes());

            Array.from(listeners.entries()).forEach(function (entry) {
                const type = entry[0];
                const handler = entry[1];
                if (!desired.has(type)) {
                    document.removeEventListener(type, handler, true);
                    listeners.delete(type);
                }
            });

            desired.forEach(function (type) {
                if (listeners.has(type)) {
                    return;
                }

                const handler = makeHandler(type);
                document.addEventListener(type, handler, true);
                listeners.set(type, handler);
            });
        }

        function isTopFrame() {
            try {
                return window === window.top;
            } catch (_) {
                return false;
            }
        }

        function status() {
            return {
                version: VERSION,
                channel: channel,
                url: location.href,
                top: isTopFrame(),
                readyState: document.readyState,
                enabled: config.enabled,
                eventsRegistered: Array.from(listeners.keys()),
                counter: Object.assign({}, counter),
                iframeCount: document.querySelectorAll('iframe').length,
                inputCount: document.querySelectorAll('input').length,
                textareaCount: document.querySelectorAll('textarea').length,
                contenteditableCount: document.querySelectorAll(
                    '[contenteditable="true"], [contenteditable=""]'
                ).length,
                updatedAt: Date.now()
            };
        }

        function postStatus() {
            if (destroyed) {
                return;
            }

            try {
                window.postMessage({
                    source: MESSAGE_SOURCE,
                    channel: channel,
                    type: 'STATUS',
                    status: status()
                }, '*');
            } catch (_) {}
        }

        function onMessage(event) {
            if (destroyed) {
                return;
            }

            const data = event && event.data;
            if (!data || data.source !== MESSAGE_SOURCE || data.channel !== channel) {
                return;
            }

            if (data.type === 'CONFIG') {
                config = normalizeConfig(data.settings);
                updateListeners();
                postStatus();
                return;
            }

            if (data.type === 'GET_STATUS') {
                postStatus();
            }
        }

        function notifyRouteChange() {
            window.setTimeout(function () {
                if (destroyed) {
                    return;
                }

                try {
                    document.dispatchEvent(new CustomEvent(ROUTE_EVENT, {
                        detail: { url: location.href }
                    }));
                } catch (_) {}

                postStatus();
            }, 0);
        }

        function hookHistory() {
            if (historyHooked || destroyed) {
                return;
            }

            historyHooked = true;

            try {
                const originalPushState = history.pushState;
                const originalReplaceState = history.replaceState;

                history.pushState = function () {
                    const result = originalPushState.apply(this, arguments);
                    notifyRouteChange();
                    return result;
                };

                history.replaceState = function () {
                    const result = originalReplaceState.apply(this, arguments);
                    notifyRouteChange();
                    return result;
                };

                window.addEventListener('popstate', notifyRouteChange);
            } catch (_) {}
        }

        function configure(settings) {
            config = normalizeConfig(settings);
            updateListeners();
            postStatus();
        }

        function destroy() {
            if (destroyed) {
                return;
            }

            destroyed = true;

            Array.from(listeners.entries()).forEach(function (entry) {
                document.removeEventListener(entry[0], entry[1], true);
            });
            listeners.clear();
            window.removeEventListener('message', onMessage);
            window.removeEventListener('popstate', notifyRouteChange);

            try {
                document.documentElement?.removeAttribute(RUNTIME_FLAG);
            } catch (_) {}

            try {
                delete window.__CX_PASTE_UNLOCKER__;
                delete window.__CX_PASTE_DEBUG__;
            } catch (_) {}
        }

        const existing = window.__CX_PASTE_UNLOCKER__;

        if (existing && existing.version === VERSION && typeof existing.configure === 'function') {
            existing.configure(initialConfig && initialConfig.settings);
            return;
        }

        if (existing && typeof existing.destroy === 'function') {
            try {
                existing.destroy();
            } catch (_) {}
        }

        if (!channel) {
            channel = 'cx-page-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        }

        if (document.documentElement) {
            document.documentElement.setAttribute(CHANNEL_ATTRIBUTE, channel);
            document.documentElement.setAttribute(RUNTIME_FLAG, '1');
        }

        window.addEventListener('message', onMessage, false);
        hookHistory();
        updateListeners();

        window.__CX_PASTE_UNLOCKER__ = {
            version: VERSION,
            channel: channel,
            configure: configure,
            getStatus: status,
            destroy: destroy
        };

        window.__CX_PASTE_DEBUG__ = {
            version: VERSION,
            events: allEventTypes(),
            counter: counter,
            status: status
        };

        postStatus();

        if (config.debugLogs) {
            console.log('[粘贴助手][PAGE] MAIN runtime ready', {
                url: location.href,
                channel: channel,
                top: isTopFrame(),
                events: status().eventsRegistered
            });
        }
    }

    function readInitialConfig() {
        const rootElement = document.documentElement;
        const channel = rootElement
            ? rootElement.getAttribute('data-cx-paste-channel') || ''
            : '';
        let settings = {};

        try {
            const rawSettings = rootElement
                ? rootElement.getAttribute('data-cx-paste-config')
                : null;
            if (rawSettings) {
                settings = JSON.parse(rawSettings);
            }
        } catch (_) {}

        return {
            channel: channel,
            settings: settings
        };
    }

    pageRuntime(readInitialConfig());
})(typeof globalThis !== 'undefined' ? globalThis : self);