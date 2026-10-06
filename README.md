# 学习通复制粘贴助手（Chrome / Edge MV3）

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-2563eb)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![Chrome / Edge](https://img.shields.io/badge/Chrome%20%2F%20Edge-111%2B-4285F4)](https://www.google.com/chrome/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

一个只在学习通域名运行的浏览器扩展，用于解除页面复制、剪切、粘贴、右键菜单和文本选择限制，支持 MAIN 环境、同源 iframe、动态 iframe 与 SPA 路由切换。

> A focused Chrome/Edge Manifest V3 extension that restores copy, cut, paste, context-menu and text-selection behavior on Chaoxing pages. It runs only on `https://*.chaoxing.com/*`, does not read clipboard contents, and does not automate quizzes or answers.

## 项目状态

- 当前版本：`1.1.0`
- 最低浏览器版本：Chrome / Edge `111+`
- 匹配范围：`https://*.chaoxing.com/*`
- 已完成 Edge 154 烟测：MAIN 注入、事件开关、非学习通页面隔离、`about:blank` iframe 注入
- 已在实际学习通页面验证可正常使用

## 功能

- 解除学习通页面的复制、剪切、粘贴、右键和文本选择限制
- 支持普通输入框、`contenteditable` 和富文本编辑器
- 支持同源 iframe、动态 iframe 和嵌套 iframe
- 支持 SPA 页面路由切换和页面刷新
- 提供总开关和事件分类开关
- 提供页面状态面板与可选调试日志
- 弹窗可查看页面匹配、MAIN 注入、注入帧、iframe 和事件监听状态
- 默认只在学习通域名生效，不影响其他网站
- 不读取剪贴板内容，不提取题目，不自动答题，不调用学习通服务端接口

## 安装

### Chrome

1. 打开 `chrome://extensions/`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择包含 `manifest.json` 的扩展目录。
5. 打开或刷新学习通页面。

### Edge

1. 打开 `edge://extensions/`。
2. 开启“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择包含 `manifest.json` 的扩展目录。
5. 打开或刷新学习通页面。

也可以从 GitHub Releases 下载打包好的 ZIP，再解压后加载。

## 使用

1. 打开学习通页面。
2. 点击浏览器工具栏中的扩展图标。
3. 确认“页面匹配”和“MAIN 注入”状态正常。
4. 使用总开关启用或停用扩展。
5. 如果某类页面存在兼容问题，可以在弹窗中单独关闭对应事件分类。
6. 需要排查时，打开“页面状态面板”或“详细日志”；详细日志会输出到网页开发者工具的 Console。

## 默认配置

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| 总开关 | 开启 | 关闭后移除页面事件监听 |
| 粘贴事件 | 开启 | `paste` |
| 复制 / 剪切 | 开启 | `copy`、`cut` |
| 右键菜单 | 开启 | `contextmenu` |
| 键盘事件 | 开启 | `keydown`、`keyup`、`keypress` |
| 文本选择 | 开启 | `selectstart` |
| 拖拽开始 | 开启 | `dragstart` |
| 鼠标按下 | 开启 | `mousedown` |
| 页面状态面板 | 关闭 | 开启后仅顶层页面显示 |
| 详细日志 | 关闭 | 开启后在 Console 输出诊断信息 |

## 工作原理

1. 隔离环境内容脚本读取扩展配置，判断当前页面是否属于学习通。
2. `src/content.js` 只负责配置、状态、iframe 扫描和扩展通信。
3. `src/page-runtime.js` 作为声明式 `MAIN world` 内容脚本由浏览器直接注入页面主环境。
4. MAIN 运行层在 `document` 捕获阶段注册已启用的事件监听器，并调用 `stopPropagation()` 阻止页面限制逻辑接收事件。
5. 两层脚本通过 `postMessage` 和 DOM 属性交换配置与运行状态，不向页面暴露 `chrome.*` API。
6. 后台 Service Worker 负责默认配置、安装信息、配置广播和弹窗状态聚合。
7. `all_frames: true` 让匹配的学习通 iframe 获得自己的内容脚本；同源 iframe 还会由父页面扫描补配置。

### 为什么使用声明式 MAIN world

学习通页面启用了严格 CSP。早期通过临时 `<script>` 节点注入 MAIN 环境会被 CSP 拦截。当前版本使用 Manifest V3 的声明式 `MAIN world` 内容脚本，由浏览器直接注入，不再触碰页面的内联脚本限制。

## 权限说明

`manifest.json` 只申请以下权限：

- `storage`：保存总开关、事件开关、状态面板和日志开关
- `host_permissions: https://*.chaoxing.com/*`：只允许在学习通 HTTPS 域名下运行

不申请以下权限：

- `scripting`
- `clipboardRead`、`clipboardWrite`
- `tabs`
- 网络访问权限
- 题目、答案或学习通接口权限

## 兼容性与已知限制

- **同源 iframe**：支持，父页面会扫描并配置。
- **学习通子域 iframe**：如果 iframe URL 匹配 `https://*.chaoxing.com/*`，会独立注入。
- **跨域 iframe**：受浏览器同源策略限制，父页面不能读取其 DOM；只有 iframe 自身匹配学习通域名时才会注入。
- **沙箱 iframe、部分 `data:` / `blob:` iframe**：可能无法访问或注入，弹窗会记录为不可访问。
- **浏览器版本**：声明式 `MAIN world` 需要 Chrome / Edge `111+`。
- **学习通页面版本变化**：核心逻辑依赖事件层和页面生命周期，不依赖固定题目 DOM 选择器；如果学习通改变 iframe 结构或引入新的浏览器隔离机制，仍需要重新验证。
- **停用行为**：停用会移除页面事件监听器，但不会重载页面；如果需要完全恢复页面初始状态，刷新页面即可。

## 目录结构

```text
chaoxing-copypaste-unlocker-extension/
├─ manifest.json
├─ README.md
├─ CHANGELOG.md
├─ LICENSE
├─ package.json
├─ .gitignore
├─ icons/
│  ├─ icon.svg
│  ├─ icon16.png
│  ├─ icon32.png
│  ├─ icon48.png
│  └─ icon128.png
├─ src/
│  ├─ background.js
│  ├─ content.js
│  ├─ defaults.js
│  ├─ page-runtime.js
│  ├─ popup.css
│  ├─ popup.html
│  └─ popup.js
├─ tests/
│  └─ verify-extension.mjs
└─ .github/
   └─ workflows/
      └─ verify.yml
```

## 开发与验证

项目不依赖构建工具，使用原生 JavaScript、HTML 和 CSS。

运行静态验证：

```bash
npm test
```

检查内容：

- `manifest.json` 可解析且为 Manifest V3
- 只申请 `storage` 和 `https://*.chaoxing.com/*`
- 不申请 `scripting`、`tabs`、剪贴板或网络权限
- 同时声明 `ISOLATED world` 和 `MAIN world` 内容脚本
- 内容脚本、后台脚本、弹窗和图标文件存在
- JavaScript 文件通过 `node --check`

## 打包

本地打包 ZIP：

```powershell
$source = (Resolve-Path '.').Path
Compress-Archive -Path (Join-Path $source '*') -DestinationPath 'chaoxing-copypaste-unlocker-extension.zip' -CompressionLevel Optimal -Force
```

Chrome / Edge 本地测试请使用解压后的目录，不要直接加载 ZIP。

## 故障排查

### 扩展显示“未匹配”

确认当前地址以 `https://` 开头，并且域名为 `chaoxing.com` 或其子域，例如：

- `https://mooc2-ans.chaoxing.com/...`
- `https://i.chaoxing.com/...`

`http://` 地址不会匹配。

### 扩展显示“待注入”或注入未确认

1. 确认浏览器版本为 Chrome / Edge `111+`。
2. 在扩展管理页确认版本为 `1.1.0` 或更高。
3. 删除旧版本后重新加载扩展，并刷新学习通页面。
4. 打开“详细日志”，检查 Console 中是否有扩展或页面脚本错误。

### iframe 内仍然不能粘贴

1. 确认 iframe URL 是否是 `*.chaoxing.com`。
2. 打开弹窗查看“可访问 / 不可访问”计数。
3. 跨域 iframe 需要由 iframe 自身匹配学习通域名才能注入。
4. 动态 iframe 可以等待 0.5–2 秒后重试，或刷新页面。

### 停用后页面仍受影响

扩展在停用时移除事件监听器，不会重载页面。刷新页面可完全恢复页面原始行为。

## 上游项目

本项目基于原作者项目迁移和扩展：

- 上游仓库：<https://github.com/SeiShonagon520/chaoxing-copypaste-unlocker>
- 上游基线：`472c6e08646ef9c1d0fc3c5b5a8f5f7be46183d6`
- 原脚本版本：`4.0.0`

感谢原作者 SeiShonagon520 的原始实现和验证工作。

## 项目范围

本项目仅用于浏览器端输入行为辅助和兼容性研究。它不提供题目提取、自动答题、答案搜索、学习通账号操作或服务端接口调用能力。

## 许可证

MIT License，见 [LICENSE](LICENSE)。