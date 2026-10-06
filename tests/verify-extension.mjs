import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function exists(relativePath) {
    return fs.existsSync(path.join(root, relativePath));
}

const manifest = readJson('manifest.json');

assert(manifest.manifest_version === 3, 'manifest_version 必须是 3');
assert(manifest.name && manifest.version, 'manifest 必须包含名称和版本');
assert(Number(manifest.minimum_chrome_version) >= 111, '声明式 MAIN world 需要 Chrome/Edge 111+');
assert(Array.isArray(manifest.permissions), 'permissions 必须是数组');
assert(JSON.stringify(manifest.permissions) === JSON.stringify(['storage']), 'permissions 必须只包含 storage');
assert(
    JSON.stringify(manifest.host_permissions) === JSON.stringify(['https://*.chaoxing.com/*']),
    'host_permissions 必须只匹配学习通 HTTPS 域名'
);

const forbidden = ['tabs', 'clipboardRead', 'clipboardWrite', 'webRequest', 'declarativeNetRequest', 'scripting'];
for (const permission of forbidden) {
    assert(!manifest.permissions.includes(permission), `不应申请权限: ${permission}`);
}

assert(manifest.background?.service_worker === 'src/background.js', '缺少后台 Service Worker');
assert(manifest.action?.default_popup === 'src/popup.html', '缺少弹窗入口');
assert(Array.isArray(manifest.content_scripts) && manifest.content_scripts.length === 2, '必须声明 ISOLATED 和 MAIN 两层内容脚本');
const isolatedScript = manifest.content_scripts.find((entry) => entry.world === 'ISOLATED');
const mainScript = manifest.content_scripts.find((entry) => entry.world === 'MAIN');
assert(isolatedScript, '缺少 ISOLATED world 内容脚本');
assert(mainScript, '缺少 MAIN world 内容脚本');
[isolatedScript, mainScript].forEach((entry) => {
    assert(entry.all_frames === true, '内容脚本必须启用 all_frames');
    assert(entry.run_at === 'document_idle', '内容脚本必须使用 document_idle');
    assert(
        JSON.stringify(entry.matches) === JSON.stringify(['https://*.chaoxing.com/*']),
        '内容脚本匹配范围必须限制在学习通 HTTPS 域名'
    );
});
assert(isolatedScript.js.includes('src/defaults.js') && isolatedScript.js.includes('src/content.js'), 'ISOLATED 内容脚本文件不完整');
assert(mainScript.js.includes('src/page-runtime.js'), 'MAIN 内容脚本缺少 page-runtime.js');

const requiredFiles = [
    'manifest.json',
    'README.md',
    'CHANGELOG.md',
    'LICENSE',
    'icons/icon16.png',
    'icons/icon32.png',
    'icons/icon48.png',
    'icons/icon128.png',
    'icons/icon.svg',
    'src/background.js',
    'src/content.js',
    'src/defaults.js',
    'src/page-runtime.js',
    'src/popup.css',
    'src/popup.html',
    'src/popup.js'
];

requiredFiles.forEach((file) => {
    assert(exists(file), `缺少文件: ${file}`);
});

const javascriptFiles = [
    'src/background.js',
    'src/content.js',
    'src/defaults.js',
    'src/page-runtime.js',
    'src/popup.js'
];

for (const file of javascriptFiles) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], {
        encoding: 'utf8'
    });

    assert(result.status === 0, `JavaScript 语法检查失败: ${file}\n${result.stderr || result.stdout}`);
}

const pageRuntime = fs.readFileSync(path.join(root, 'src/page-runtime.js'), 'utf8');
const contentScript = fs.readFileSync(path.join(root, 'src/content.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');

assert(pageRuntime.includes('stopPropagation'), 'MAIN 运行时必须保留 stopPropagation');
assert(pageRuntime.includes('MutationObserver') === false, 'MutationObserver 应由隔离环境内容脚本负责');
assert(contentScript.includes('MutationObserver'), '内容脚本必须监听动态 DOM');
assert(contentScript.includes('data-cx-paste-config'), '内容脚本必须向 MAIN 运行时写入配置');
assert(background.includes('FRAME_STATUS'), '后台必须处理帧状态聚合');
assert(background.includes('UPDATE_SETTINGS'), '后台必须处理配置更新');

console.log('扩展静态检查通过。');
console.log(`版本: ${manifest.version}`);
console.log(`权限: ${manifest.permissions.join(', ')}`);
console.log(`匹配: ${manifest.host_permissions.join(', ')}`);