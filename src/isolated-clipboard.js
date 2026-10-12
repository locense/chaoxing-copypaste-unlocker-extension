(function () {
    'use strict';

    const EVENT_TYPES = Object.freeze(['paste', 'copy', 'cut', 'mousedown']);
    let activeRoot = null;
    let activeRootUpdatedAt = 0;

    function getRoot(target) {
        const element = target && target.nodeType === 1
            ? target
            : target && target.parentElement;

        if (!element || typeof element.closest !== 'function') {
            return null;
        }

        return element.closest('.CodeMirror');
    }

    function getEventRoot(event) {
        return getRoot(event.target) || (
            activeRoot &&
            activeRoot.isConnected !== false &&
            Date.now() - activeRootUpdatedAt <= 10000
                ? activeRoot
                : null
        );
    }

    function getTextarea(root) {
        return root && typeof root.querySelector === 'function'
            ? root.querySelector('textarea')
            : null;
    }

    function handlePaste(event) {
        const root = getEventRoot(event);
        const textarea = getTextarea(root);

        if (!root || !textarea) {
            return false;
        }

        const clipboard = event.clipboardData;
        const text = clipboard && typeof clipboard.getData === 'function'
            ? (clipboard.getData('text/plain') || clipboard.getData('Text'))
            : '';

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

    function handleCopyCut(event, type) {
        const root = getEventRoot(event);
        const textarea = getTextarea(root);

        if (!root || !textarea || !event.clipboardData) {
            return false;
        }

        if (typeof event.clipboardData.setData !== 'function') {
            return false;
        }

        const text = typeof textarea.value === 'string' ? textarea.value : '';

        try {
            event.clipboardData.setData('text/plain', text);

            if (type === 'cut') {
                textarea.value = '';
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }

            event.preventDefault();
            event.stopImmediatePropagation();
            return true;
        } catch (_) {
            return false;
        }
    }

    function rememberMouseDown(event) {
        const root = getRoot(event.target);
        if (!root) {
            return;
        }

        activeRoot = root;
        activeRootUpdatedAt = Date.now();

        window.setTimeout(function () {
            if (activeRoot !== root || Date.now() - activeRootUpdatedAt > 2000) {
                return;
            }

            const textarea = getTextarea(root);
            if (!textarea || document.activeElement === textarea) {
                return;
            }

            try {
                textarea.focus();
            } catch (_) {}
        }, 0);
    }

    function handleEvent(event) {
        if (event.type === 'mousedown') {
            rememberMouseDown(event);
            return;
        }

        if (event.type === 'paste') {
            handlePaste(event);
            return;
        }

        if (event.type === 'copy' || event.type === 'cut') {
            handleCopyCut(event, event.type);
        }
    }

    EVENT_TYPES.forEach(function (type) {
        window.addEventListener(type, handleEvent, true);
    });
})();
