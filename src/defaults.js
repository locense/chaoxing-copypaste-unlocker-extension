(function (root) {
    'use strict';

    const SETTINGS_KEY = 'settings';
    const INSTALL_INFO_KEY = 'installInfo';
    const VERSION = '1.1.0';

    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        events: Object.freeze({
            paste: true,
            copyCut: true,
            contextMenu: true,
            keyboard: true,
            selection: true,
            drag: true,
            mouse: true
        }),
        showPanel: false,
        debugLogs: false
    });

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeSettings(value) {
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
            showPanel: source.showPanel === true,
            debugLogs: source.debugLogs === true
        };
    }

    function isChaoxingUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'https:' && (
                parsed.hostname === 'chaoxing.com' ||
                parsed.hostname.endsWith('.chaoxing.com')
            );
        } catch (_) {
            return false;
        }
    }

    root.CXPasteDefaults = Object.freeze({
        SETTINGS_KEY,
        INSTALL_INFO_KEY,
        VERSION,
        DEFAULT_SETTINGS,
        cloneDefaultSettings: function () {
            return clone(DEFAULT_SETTINGS);
        },
        normalizeSettings,
        isChaoxingUrl
    });
})(typeof globalThis !== 'undefined' ? globalThis : self);