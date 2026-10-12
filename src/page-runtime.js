(function (root) {
    'use strict';

    function pageRuntime(initialConfig) {
        'use strict';

        const VERSION = '1.2.2-r3';
        const RUNTIME_FLAG = 'data-cx-paste-runtime';
        const CHANNEL_ATTRIBUTE = 'data-cx-paste-channel';
        const MESSAGE_SOURCE = 'cx-paste-extension';
        const ROUTE_EVENT = '__cx_paste_route_change__';
        const EARLY_EVENT_TYPES = Object.freeze(['paste', 'copy', 'cut', 'mousedown']);
        const DESTROY_TOKEN = 'cx-paste-runtime-v1.2.2-r3';

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
        const codeMirrorRoots = new Map();
        const earlyListeners = new Map();

        let config = normalizeConfig(initialConfig && initialConfig.settings);
        let channel = String(
            (initialConfig && initialConfig.channel) ||
            document.documentElement?.getAttribute(CHANNEL_ATTRIBUTE) ||
            ''
        );
        let activeCodeMirrorRoot = null;
        let activeCodeMirrorUpdatedAt = 0;
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

        function getCodeMirrorRoot(target) {
            const element = target && target.nodeType === 1
                ? target
                : target && target.parentElement;

            if (!element || typeof element.closest !== 'function') {
                return null;
            }

            return element.closest('.CodeMirror');
        }

        function getBusinessIdFromElement(element) {
            if (!element || typeof element.closest !== 'function') {
                return '';
            }

            const container = element.closest('[data-business-id]');
            return container
                ? String(container.getAttribute('data-business-id') || '')
                : '';
        }

        function getCodeMirrorInstance(root, target) {
            if (!root) {
                return null;
            }

            if (root.CodeMirror) {
                return root.CodeMirror;
            }

            const businessId = getBusinessIdFromElement(root) || getBusinessIdFromElement(target);
            let registry = null;

            try {
                registry = window.codeEditors;
            } catch (_) {}

            if (
                businessId &&
                registry &&
                typeof registry === 'object' &&
                registry[businessId]
            ) {
                return registry[businessId];
            }

            return null;
        }

        function ensureCodeMirrorRootListener(root, type) {
            if (!root || typeof root.addEventListener !== 'function') {
                return;
            }

            let handlers = codeMirrorRoots.get(root);
            if (!handlers) {
                handlers = new Map();
                codeMirrorRoots.set(root, handlers);
            }

            if (handlers.has(type)) {
                return;
            }

            function stopAtEditor(event) {
                if (config.enabled && listeners.has(type)) {
                    event.stopPropagation();
                }
            }

            root.addEventListener(type, stopAtEditor, false);
            handlers.set(type, stopAtEditor);
        }

        function getCodeMirrorFromTarget(target) {
            const root = getCodeMirrorRoot(target);
            const cm = getCodeMirrorInstance(root, target);

            if (!root || !cm) {
                return null;
            }

            return { root: root, cm: cm };
        }

        function getActiveCodeMirrorRoot() {
            if (!activeCodeMirrorRoot || activeCodeMirrorRoot.isConnected === false) {
                return null;
            }

            if (Date.now() - activeCodeMirrorUpdatedAt > 10000) {
                return null;
            }

            return activeCodeMirrorRoot;
        }

        function getActiveCodeMirror() {
            const root = getActiveCodeMirrorRoot();
            const cm = getCodeMirrorInstance(root, null);

            if (!cm || !root) {
                return null;
            }

            return {
                root: root,
                cm: cm
            };
        }

        function getEventCodeMirrorRoot(event) {
            return getCodeMirrorRoot(event.target) || getActiveCodeMirrorRoot();
        }

        function getEventCodeMirror(event) {
            const root = getEventCodeMirrorRoot(event);
            const cm = getCodeMirrorInstance(root, event && event.target);

            return cm ? { root: root, cm: cm } : null;
        }

        function handleTextareaPasteFallback(event) {
            if (!config.enabled || config.events.paste === false) {
                return false;
            }

            const clipboard = event && event.clipboardData;
            if (!clipboard || typeof clipboard.getData !== 'function') {
                return false;
            }

            const root = getEventCodeMirrorRoot(event);
            const textarea = root && root.querySelector
                ? root.querySelector('textarea')
                : null;

            if (!textarea) {
                return false;
            }

            const text = clipboard.getData('text/plain') || clipboard.getData('Text');
            if (typeof text !== 'string') {
                return false;
            }

            try {
                if (typeof textarea.focus === 'function') {
                    textarea.focus();
                }

                textarea.value = text;

                const inputEvent = typeof InputEvent === 'function'
                    ? new InputEvent('input', {
                        bubbles: true,
                        data: text,
                        inputType: 'insertFromPaste'
                    })
                    : new Event('input', { bubbles: true });

                textarea.dispatchEvent(inputEvent);
                event.preventDefault();
                event.stopImmediatePropagation();
                return true;
            } catch (_) {
                return false;
            }
        }

        function handleCodeMirrorClipboard(event, type) {
            if (!config.enabled) {
                return false;
            }

            if (type === 'paste' && config.events.paste === false) {
                return false;
            }

            if ((type === 'copy' || type === 'cut') && config.events.copyCut === false) {
                return false;
            }

            const found = getEventCodeMirror(event);
            if (!found) {
                return type === 'paste' ? handleTextareaPasteFallback(event) : false;
            }

            const cm = found.cm;

            try {
                if (type === 'paste') {
                    const clipboard = event.clipboardData;
                    const text = clipboard && typeof clipboard.getData === 'function'
                        ? (clipboard.getData('text/plain') || clipboard.getData('Text'))
                        : '';

                    if (typeof text !== 'string') {
                        return false;
                    }

                    if (typeof cm.focus === 'function') {
                        cm.focus();
                    }
                    cm.replaceSelection(text, 'end', 'paste');
                } else {
                    if (!event.clipboardData || typeof event.clipboardData.setData !== 'function') {
                        return false;
                    }

                    const text = typeof cm.getSelection === 'function'
                        ? cm.getSelection()
                        : '';

                    event.clipboardData.setData('text/plain', text);

                    if (type === 'cut') {
                        if (typeof cm.focus === 'function') {
                            cm.focus();
                        }
                        cm.replaceSelection('', 'end', 'cut');
                    }
                }

                event.preventDefault();
                event.stopImmediatePropagation();
                return true;
            } catch (_) {
                return type === 'paste' ? handleTextareaPasteFallback(event) : false;
            }
        }

        function rememberCodeMirrorMouseDown(event) {
            const found = getCodeMirrorFromTarget(event.target);
            if (!found) {
                return;
            }

            activeCodeMirrorRoot = found.root;
            activeCodeMirrorUpdatedAt = Date.now();

            const cm = found.cm;
            const clientX = Number(event.clientX || 0);
            const clientY = Number(event.clientY || 0);

            window.setTimeout(function () {
                if (destroyed || activeCodeMirrorRoot !== found.root) {
                    return;
                }

                try {
                    if (typeof cm.hasFocus !== 'function' || cm.hasFocus()) {
                        return;
                    }

                    if (
                        (clientX || clientY) &&
                        typeof cm.coordsChar === 'function' &&
                        typeof cm.setCursor === 'function'
                    ) {
                        cm.setCursor(cm.coordsChar({
                            left: clientX,
                            top: clientY
                        }));
                    }

                    if (typeof cm.focus === 'function') {
                        cm.focus();
                    }
                } catch (_) {}
            }, 0);
        }

        function makeEarlyHandler(type) {
            return function handleEarlyEvent(event) {
                if (!config.enabled) {
                    return;
                }

                if (type === 'mousedown') {
                    rememberCodeMirrorMouseDown(event);
                    return;
                }

                handleCodeMirrorClipboard(event, type);
            };
        }

        function updateEarlyListeners() {
            const desired = new Set(desiredEventTypes());

            Array.from(earlyListeners.entries()).forEach(function (entry) {
                const type = entry[0];
                const handler = entry[1];

                if (!desired.has(type)) {
                    window.removeEventListener(type, handler, true);
                    earlyListeners.delete(type);
                }
            });

            EARLY_EVENT_TYPES.forEach(function (type) {
                if (!desired.has(type) || earlyListeners.has(type)) {
                    return;
                }

                const handler = makeEarlyHandler(type);
                window.addEventListener(type, handler, true);
                earlyListeners.set(type, handler);
            });
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
                    const codeMirrorRoot = getCodeMirrorRoot(event.target);

                    if (codeMirrorRoot) {
                        ensureCodeMirrorRootListener(codeMirrorRoot, type);
                        return;
                    }

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

            updateEarlyListeners();
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
                codeMirrorCount: document.querySelectorAll('.CodeMirror').length,
                codeMirrorInstanceCount: Array.from(
                    document.querySelectorAll('.CodeMirror')
                ).filter(function (root) {
                    return Boolean(getCodeMirrorInstance(root, null));
                }).length,
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

        function destroy(token) {
            if (destroyed || token !== DESTROY_TOKEN) {
                return;
            }

            destroyed = true;

            Array.from(earlyListeners.entries()).forEach(function (entry) {
                window.removeEventListener(entry[0], entry[1], true);
            });
            earlyListeners.clear();

            Array.from(listeners.entries()).forEach(function (entry) {
                document.removeEventListener(entry[0], entry[1], true);
            });
            listeners.clear();

            codeMirrorRoots.forEach(function (handlers, root) {
                handlers.forEach(function (handler, type) {
                    root.removeEventListener(type, handler, false);
                });
            });
            codeMirrorRoots.clear();

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
                existing.destroy(DESTROY_TOKEN);
            } catch (_) {}
        }

        if (!channel) {
            channel = 'cx-page-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        }

        function syncDocumentAttributes() {
            if (!document.documentElement) {
                return false;
            }

            document.documentElement.setAttribute(CHANNEL_ATTRIBUTE, channel);
            document.documentElement.setAttribute(RUNTIME_FLAG, '1');
            return true;
        }

        if (!syncDocumentAttributes()) {
            document.addEventListener('readystatechange', function onReadyStateChange() {
                if (syncDocumentAttributes()) {
                    document.removeEventListener('readystatechange', onReadyStateChange, false);
                }
            }, false);
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