# UX 原型评审工作台

本目录是 DSH 插件与离线评审 HTML 共用的界面。桌面入口位于 `../packages/dsh-ux-review`；浏览器开发入口用于调试，保存时下载 HTML 副本。当前不维护独立 Electron 应用。

## 本地开发

```sh
cd ux-workbench
npm ci
npm run build:review
npm run dev
```

打开 `http://127.0.0.1:7792`，选择 HTML；也可使用 `?file=/examples/interaction-demo.ux.html`。在 DSH 内打开时，文件读写和 AI 任务由插件 Host 提供，权限沿用当前 DSH 会话。

```sh
npm run build
npm test
```

`build` 先生成内联离线阅读器，再构建浏览器入口。`src/generated/review-runtime.mjs` 为生成文件，不提交。安装包已包含构建产物，普通使用者无需 Node.js。

## 文件与界面

- `src/Workbench.jsx`：PRD、两类批注、联动定位、历史和 AI 任务状态。
- `src/preview.mjs`：隔离原型、选择元素或区域、锚点测量和定位；切换面板不重载业务页面。
- `src/export.mjs`：完整单文件离线导出，包含业务原型、PRD、批注、历史与只读阅读器。
- `../skills/ux-prototype/scripts/document.mjs`：唯一共享文件协议；Host、界面与 CLI 使用相同逻辑。

交互说明承载产品逻辑、业务规则、功能背景与交互补充说明，长期保留。PRD 可通过工具栏或说明卡片右键按需引用说明，默认折叠并支持双向定位；引用只保存 ID，不复制正文，修改意见不可引用。修改意见用于记录本轮待处理建议；只有本轮明确选中并处理完成的修改意见可以按选择清理。创建者与最后编辑者分别记录，人工修改保存为差异，AI 交付追加变更说明。

关闭标签前可保存。未保存草稿另有本机恢复记录；重新打开时明确选择恢复或放弃。原文件已变化时仅提供草稿副本，不自动覆盖。浏览器存储不可用或容量不足时，本机恢复不保证可用，正式交接以保存的 HTML 为准。

## 样例

`examples/interaction-demo.ux.html` 是合成的保存/弹窗样例，含一条可交给 AI 的文案修改意见。用户商品稿与本机导出副本不纳入公开仓库。

## 当前边界

原型以 `sandbox="allow-scripts allow-forms"` 运行，允许本地表单事件和原生弹窗表单；CSP 与预览桥阻止外部网络、跳转及真实表单发送。`localStorage` 与 `sessionStorage` 使用当前预览生命周期内的模拟存储；刷新预览不会保留业务草稿。批注、PRD 和历史保存在实际 HTML 中。

桌面接入针对 DSH 0.2.2-rc.3。平台接口按 macOS 与 Windows 编写；本机验证平台为 macOS。离线 HTML 使用现代浏览器，不依赖 DSH。隐藏弹窗、未打开路由的锚点不会自动执行业务操作来定位，界面提示先打开对应状态。
