# 开发与验证

## 模块边界

`skills/ux-prototype/scripts/document.mjs` 是单文件协议入口。Host、共享界面与 CLI 复用相同协议。`edit-prompt.mjs` 生成 DSH 和外部 Agent 共用的直接修改提示词；`edit-session.mjs` 负责 `finish` 的差异、历史、交付和完成回执。任务状态与基线由程序管理，Agent 无需读完整 PRD、历史或私有任务清单。

`packages/dsh-ux-review/src/` 适配 DSH 权限、文件读写、会话与任务回执；`ux-workbench/src/` 实现通用界面和离线阅读器。设计资源独立维护在 `skills/opentiny-ux/`。

PRD 图片使用 `![说明](asset:img-ID)` 短引用，调整尺寸后使用带 `width` / `height` 的标准 `<img>` 标签。图片数据保存在文档 `assets["img-ID"] = { name, dataUrl }` 中，由 `prd-assets.mjs` 注册、去重和校验；富文本与离线阅读器负责解析引用。资源 ID 不可覆盖，删除图片只删除正文引用，保留资源供撤销及历史使用。变更记录只记录 PRD 的短引用，不重复保存图片数据。

## 本地开发

```sh
npm ci --prefix ux-workbench
npm --prefix ux-workbench run build:review
npm --prefix ux-workbench run dev
```

开发地址为 `http://127.0.0.1:7792`。从文件选择器打开文档；合成示例可用 `?file=/examples/interaction-demo.ux.html`。浏览器开发入口保存时下载文件，DSH 入口通过 Host 保存。

`src/generated/review-runtime.mjs` 为构建产物，不提交。vendor 解析器已连同第三方许可入库，正常构建不用重新生成。更新 vendor 时在 `skills/ux-prototype/tooling/` 执行 `npm ci` 和 `npm run build`。

## 验证

```sh
node --test skills/ux-prototype/tests/*.test.mjs packages/dsh-ux-review/test/*.test.mjs
cd ux-workbench
npm run build:review
node --test tests/prd-reference-workbench.test.mjs tests/export.test.mjs
```

浏览器测试使用 Playwright 和本机 Chrome（`channel: 'chrome'`）。其余测试按实际改动范围选择；`npm test` 运行工作台全部测试。Host 测试使用临时文件与假的 Agent，不调用真实模型。`packages/dsh-ux-review/scripts/verify-installed-sdk.cjs` 接受已安装 DSH SDK 的 `node_modules` 路径，执行隔离的接口和 skill 注册检查。

0.1.13 已在 macOS 的 DeepSeek Harness 0.2.2-rc.3 中通过真实 `.tgz` 安装验证：插件显示新版且运行；独立测试稿完成图片拖动缩放、原图预览、下载原始字节、删除撤销、原生文件选择器插图、重复资源去重、表格抓手新增行和右键新增列；滚动正文时工具栏固定。保存并关闭后从磁盘重新打开，图片、尺寸、短引用、表格和变更记录完整保留。未调用真实模型；Windows 原生 UI 未验证。

客户端文件版本使用 HTML 内容 SHA-256，避免云同步或文件属性变化造成误报；写入仍使用 Host 最新 `FsVersion` 的 `replaceIfVersion`，拒绝检查后发生的并发修改。Host 回归测试分别覆盖元数据变化、正文冲突及检查到写入之间的竞争。

## 发布与运行中的插件

常规发布运行根目录的 `npm run release:pack`，详见 [分发说明](distribution.md)。该命令隔离构建，不替换运行中的本地插件。

直接运行 `node packages/dsh-ux-review/scripts/build.mjs` 则会重建本地 `lib/` 和 bundled `skills/`。如果 DSH 通过 link 安装本目录，构建会影响其后续加载；先结束编辑，再按需要构建与重启。修改 skill 时只编辑根目录 `skills/`，不要只改构建副本。

## 仓库范围

源码、测试、锁文件、第三方许可和合成示例入库。用户稿件、内部任务记录、备份、验证截图、旧设计草案、试验原型、构建副本和安装包由 `.gitignore` 保留在本地。旧样例导入脚本依赖本机试验素材，同样不作为公共构建依赖。
