import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = fs.readFileSync(path.join(root, 'src/page-runtime.js'), 'utf8');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

class NodeStub {
    constructor(name) {
        this.name = name;
        this.nodeType = 1;
        this.tagName = String(name).toUpperCase();
        this.parentElement = null;
        this.attributes = new Map();
        this.listeners = new Map();
        this.className = '';
    }

    addEventListener(type, handler, capture = false) {
        const key = `${type}:${capture === true}`;
        const handlers = this.listeners.get(key) || [];
        handlers.push(handler);
        this.listeners.set(key, handlers);
    }

    removeEventListener(type, handler, capture = false) {
        const key = `${type}:${capture === true}`;
        const handlers = this.listeners.get(key) || [];
        this.listeners.set(key, handlers.filter((item) => item !== handler));
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    removeAttribute(name) {
        this.attributes.delete(name);
    }

    closest(selector) {
        for (let node = this; node; node = node.parentElement) {
            if (selector === '.CodeMirror' && String(node.className || '').split(/\s+/).includes('CodeMirror')) {
                return node;
            }
        }
        return null;
    }

    querySelectorAll() {
        return [];
    }
}

class DocumentStub extends NodeStub {
    constructor() {
        super('#document');
        this.nodeType = 9;
        this.readyState = 'complete';
        this.documentElement = new NodeStub('html');
        this.documentElement.parentElement = this;
        this.body = new NodeStub('body');
        this.body.parentElement = this.documentElement;
        this.allElements = [];
    }

    querySelectorAll(selector) {
        if (selector === '.CodeMirror') {
            return this.allElements.filter((element) => String(element.className || '').split(/\s+/).includes('CodeMirror'));
        }
        if (selector === 'textarea') {
            return this.allElements.filter((element) => element.tagName === 'TEXTAREA');
        }
        return [];
    }

    dispatch(event) {
        dispatch(this, event);
    }
}

class EventStub {
    constructor(type) {
        this.type = type;
        this.target = null;
        this.defaultPrevented = false;
        this.eventPhase = 0;
        this.stopped = false;
        this.immediateStopped = false;
    }

    preventDefault() {
        this.defaultPrevented = true;
    }

    stopPropagation() {
        this.stopped = true;
    }

    stopImmediatePropagation() {
        this.immediateStopped = true;
        this.stopped = true;
    }
}

function runListeners(node, event, capture) {
    const key = `${event.type}:${capture === true}`;
    const handlers = (node.listeners && node.listeners.get(key)) || [];

    for (const handler of handlers.slice()) {
        if (event.immediateStopped) {
            break;
        }
        handler.call(node, event);
    }

    return !event.immediateStopped && !event.stopped;
}

function dispatch(target, event) {
    const path = [];
    for (let node = target; node; node = node.parentElement) {
        path.push(node);
    }
    path.push(window);

    event.target = target;

    for (const node of path.slice().reverse().slice(1)) {
        event.eventPhase = 1;
        if (!runListeners(node, event, true)) {
            return;
        }
    }

    event.eventPhase = 2;
    if (!runListeners(target, event, true) || !runListeners(target, event, false)) {
        return;
    }

    for (const node of path.slice(1)) {
        event.eventPhase = 3;
        if (!runListeners(node, event, false)) {
            return;
        }
    }
}

const document = new DocumentStub();
const window = new NodeStub('window');
window.top = window;
window.setTimeout = () => 0;
window.clearTimeout = () => {};
window.postMessage = () => {};
window.location = { href: 'https://mooc1-api.chaoxing.com/mooc-ans/mooc2/work/dowork' };
window.history = {
    pushState() {},
    replaceState() {}
};

const codeMirrorRoot = new NodeStub('div');
codeMirrorRoot.className = 'CodeMirror CodeMirror-wrap';
codeMirrorRoot.parentElement = document.body;

const codeMirrorInput = new NodeStub('textarea');
codeMirrorInput.parentElement = codeMirrorRoot;

const normalInput = new NodeStub('textarea');
normalInput.parentElement = document.body;

document.allElements.push(codeMirrorRoot, codeMirrorInput, normalInput);
document.documentElement.setAttribute('data-cx-paste-channel', 'test-channel');
document.documentElement.setAttribute('data-cx-paste-config', JSON.stringify({ enabled: true }));

const context = {
    window,
    document,
    location: window.location,
    history: window.history,
    console,
    CustomEvent: class CustomEvent {
        constructor(type, options) {
            this.type = type;
            this.detail = options && options.detail;
        }
    }
};
context.globalThis = context;

vm.runInNewContext(source, context, { filename: 'src/page-runtime.js' });

let editorReceived = false;
let pageSawEditorPaste = false;
codeMirrorInput.addEventListener('paste', () => {
    editorReceived = true;
});
document.addEventListener('paste', () => {
    pageSawEditorPaste = true;
});

dispatch(codeMirrorInput, new EventStub('paste'));
assert(editorReceived, 'CodeMirror 内部粘贴监听器必须收到事件');
assert(!pageSawEditorPaste, 'CodeMirror 处理完事件后不应继续冒泡到页面限制监听器');

let editorReceivedMouseDown = false;
let pageSawEditorMouseDown = false;
codeMirrorInput.addEventListener('mousedown', () => {
    editorReceivedMouseDown = true;
});
document.addEventListener('mousedown', () => {
    pageSawEditorMouseDown = true;
});
dispatch(codeMirrorInput, new EventStub('mousedown'));
assert(editorReceivedMouseDown, 'CodeMirror 必须收到鼠标按下事件以获得焦点');
assert(!pageSawEditorMouseDown, 'CodeMirror 处理完鼠标事件后不应继续冒泡到页面限制监听器');

let normalReceived = false;
normalInput.addEventListener('paste', () => {
    normalReceived = true;
});
dispatch(normalInput, new EventStub('paste'));
assert(!normalReceived, '普通输入框仍应在 document 捕获阶段阻止页面事件传播');

console.log('CodeMirror 事件桥接检查通过。');