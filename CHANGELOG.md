# 变更记录

## 1.1.0

- 修复学习通页面 CSP 拦截内联 `<script>` 导致 MAIN 运行层无法启动的问题。
- 将页面运行层改为 Manifest V3 声明式 `MAIN world` 内容脚本，不再依赖临时 `<script>` 注入。
- 新增隔离环境与 MAIN 环境之间的 DOM 配置桥接。
- 保持 `storage` 与 `https://*.chaoxing.com/*` 最小权限，不新增 `scripting`、`tabs` 或剪贴板权限。
- 在 Edge 154 的无头浏览器环境中验证：学习通页面 MAIN 注入成功、事件开关生效、非学习通页面不注入。

## 1.0.0

- 将 `chaoxing-unlock.user.js` v4.0.0 迁移为 Manifest V3 扩展。
- 新增扩展清单、后台 Service Worker、内容脚本桥接和弹窗界面。
- 保留 MAIN 环境注入、捕获阶段事件处理和 iframe 扫描逻辑。
- 新增总开关、事件分类开关、状态面板开关和详细日志开关。
- 新增 iframe、路由、注入和事件状态聚合。
- 新增最小权限声明：仅 `storage` 与 `https://*.chaoxing.com/*`。
- 新增安装、配置、卸载、故障排查和兼容性说明。