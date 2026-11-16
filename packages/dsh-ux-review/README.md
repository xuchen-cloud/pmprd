# UX 需求评审 / UX requirements review

DeepSeek Harness **0.2.2-rc.3** 插件。交互原型、PRD、标注和变更历史保存在单文件 HTML 中；修改说明既可直接发送到 DSH，也可一键复制给外部 Agent，使用同一套编辑和交付流程。

## 安装与打开

从 [公开 Release](https://github.com/xuchen-cloud/pmprd/releases/tag/v0.1.13) 下载 `dsh-ux-review-0.1.13.tgz`，无需 GitHub 登录。先安装 DSH 0.2.2-rc.3。打开「插件 → 添加插件」，填写已构建的 `dsh-ux-review-0.1.13.tgz` 的本地绝对路径或下载链接；安装完成后点击「立即启用」，按 DSH 提示重启。开发者也可添加已构建的本目录。启用后，`ux-prototype` 和 `opentiny-ux` 加入 DSH 的 skill 目录，项目或用户自定义的同名 skill 按 DSH 的优先级覆盖。包内包含构建好的 Host、Client、离线阅读器和 skill，安装时无需编译。

在会话右侧点击「新建标签页 → 打开设计文档」，选择本机或收到的文件，也可拖入。程序按内容识别设计文档；普通 HTML 和已知旧格式先提示「导入为设计文档」。导入副本保存到当前会话目录，同名自动区分，原文件保留。已有稿顶栏的文件夹图标、无法打开时的错误页和会话文件列表都提供打开入口。UTF-8 HTML 文件上限为 50 MB；只读会话不能创建导入副本。

## 修改流程

已安装旧版时，可让 DSH 使用内置 `plugin_manager` 下载新版 `.tgz`、校验 SHA-256，查询当前 profile，卸载旧包后安装并启用，最后核对实际加载版本；不用另外配置 CLI。完整可复制指令见 [升级说明](https://github.com/xuchen-cloud/pmprd/blob/main/docs/distribution.md#让已安装旧版的-dsh-自己升级)。工作区 HTML 和备份不在插件目录内，升级时保留。

1. 添加或编辑修改意见，按需要修改 PRD。在「交给 AI 修改」中选择本轮意见、是否允许相关 PRD 更新、是否清理完成意见，以及是否生成新版本文件。
2. 点击「发送到 DSH」或「复制给外部 Agent」。程序先保存、备份并准备工作文件，生成同一份包含意见、目标信息、文件位置和完成命令的提示词。复制不会调用 DSH 模型。
3. Agent 按提示词修改工作文件，缺少信息时按需读取源码、PRD、说明或设计资料。无需先读任务清单、上下文文件或所有 skill，也无需列目录或遍历整份历史。
4. Agent 执行一次 `uxdoc.mjs finish WORKFILE --summary "实际改动"`。程序计算 diff、维护历史与版本、处理意见，并按选项保存。无需额外编排 `changes.json → apply → complete`。
5. DSH 自动读取完成结果。外部 Agent 完成后也可点击「读取修改结果」刷新；放弃外部修改时点击「结束外部修改」，保留工作文件并恢复编辑。

默认不勾选“生成新版本文件”：程序保留修改前备份后更新当前文件；勾选则另存结果。原文件已被其他编辑器修改时不覆盖，保留候选供核对。任务排队、运行或等待外部 Agent 期间，PRD 和标注只读，浏览、筛选、缩放、原型交互及双向定位继续可用。

`finish` 默认表示本轮全部所选意见已完成；部分完成时必须指定 `--resolve ann-a,ann-b`，没有完成意见则指定 `--resolve none`。PRD 使用 `prdOps` 提交受影响的局部替换，标注用 `annotationUpdates` 提交实际变化；需要时通过 `--changes-json` 或 stdin 传入，不要求固定生成中间文件。新 PRD 历史仅保存修改行，既有历史保持。已取消任务拒绝迟到交付，重复提交同一完成结果不会重复增加历史。

外部执行面向能访问本地文件、运行 Node.js 22+ 的 Agent，使用随包 skill 的脚本，不依赖 DSH 专用工具。复制提示词不传输本地文件；换电脑需同时提供相应文件和脚本。DSH 仍负责其会话上下文、压缩和缓存，插件不会清除旧聊天历史。操作和参数见 [修改与提交](skills/ux-prototype/references/dsh-task.md)。

## 评审与协作

- PRD 默认可直接编辑，支持 Markdown、富文本、表格、图片、可调宽侧栏和全屏；人工修改记录 diff。
- 交互说明补充产品逻辑、业务规则、功能背景与交互细节，长期保留；修改意见独立管理处理状态。PRD 可在光标处引用说明 ID，默认折叠，展开阅读完整内容并双向定位；修改意见不能引用。
- 标注可关闭、显示标记或展开，类型与状态可筛选；右侧「PRD / 标注 / 变更」提供跨页面列表及定位。标签页、折叠区域与稿件导航接口可恢复目标所在状态，无法恢复时明确提示。
- 原型和展开标注组成同一画布，固定 24px 留白、整体拖动和裁切。Ctrl / ⌘ 加减或滚轮缩放，空格拖动；输入中的编辑框保留正常输入。空白新增标注不会生成历史。
- 「导出完整评审 HTML」保留原型、PRD、两类标注、变更记录及离线只读阅读器，同事可用浏览器打开。

文件协议与共享界面不依赖 DSH。设计原则由 `opentiny-ux` 提供，保留原 craft-ux 的 OpenTiny 设计资源；`ux-prototype` 负责协作格式与修改指引，两者独立维护。

## 开发与验证

普通发布在仓库根目录运行 `npm ci --prefix ux-workbench`、`npm run release:pack`，获得 `release/` 下的安装包、SHA-256 和安装说明。打包在临时工作区完成，不改动已链接到 DSH 的本机插件。

以下开发构建命令会更新本目录的 `lib/` 与 `skills/`，本目录已链接到 DSH 时应先结束编辑：

```sh
npm --prefix ux-workbench run build:review
node packages/dsh-ux-review/scripts/build.mjs
npm --prefix packages/dsh-ux-review test
node --test skills/ux-prototype/tests/*.test.mjs
cd packages/dsh-ux-review
npm pack
```

Host 使用 DSH 官方的 `connection.fetch.register`、`connection.rpc.call`、`fs`、`sessionController`、`sandboxPolicy` 与 `Agent.followup` 接口。文件锁与内部任务状态负责恢复和交付，不要求模型逐项读取；完成回执由 Host 自动接收。React 复用 DSH 共享模块，不包含另一套 Cordis。旧 `apply` 和 `ux_review_complete` 保留兼容，新的修改提示词不再依赖它们。

测试使用临时文件和假的 Agent 入箱，不产生模型调用。`scripts/verify-installed-sdk.cjs` 可在隔离服务中核对已安装 SDK 的插件注入、路由与 skill 挂载。原生 DSH 验证、各版记录与限制见 [开发说明](https://github.com/xuchen-cloud/pmprd/blob/main/docs/development.md)；Windows 路径覆盖不等于 Windows 原生界面实测。

本插件图标为项目原创 SVG，MIT 许可；未复制 DSH 图标与品牌。
