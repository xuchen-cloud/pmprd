# UX / PRD 评审工作台

把交互原型、当前 PRD、交互说明、修改意见与变更历史保存在同一份 HTML 中。在 DeepSeek Harness 中评审和修改，也可导出完整 HTML 给同事离线阅读。

当前插件 **dsh-ux-review 0.1.12**，适配 **DSH 0.2.2-rc.3**。发送到 DSH 与复制给外部 Agent 共用直接修改提示词，通过一次 `finish` 完成差异记录和交付。

## 新电脑安装

1. 安装 DSH 0.2.2-rc.3，从 [GitHub Release](https://github.com/xuchen-cloud/pmprd/releases/tag/v0.1.12) 下载 `dsh-ux-review-0.1.12.tgz`（公开下载，无需登录）。
2. 在 DSH「插件 → 添加插件」填写安装包的本地绝对路径或下载链接。
3. 安装后点击「立即启用」，按 DSH 提示重启。
4. 在会话右侧「新建标签页 → 打开设计文档」选择 HTML。

安装包内置 `ux-prototype` 和 `opentiny-ux`，启用插件即加载这两份 skill，无需另外复制。安装、升级与独立 skill 用法见 [分发说明](docs/distribution.md)。源码仓库 ZIP 不是插件安装包；本项目尚未发布 npm 包。

也可以直接把这句话发给对方 DSH：

> 请从 https://github.com/xuchen-cloud/pmprd/releases/tag/v0.1.12 下载 dsh-ux-review-0.1.12.tgz，检查本机 DSH 是否兼容 0.2.2-rc.3，然后安装到当前正在使用的 profile 并启用插件；确认内置的 ux-prototype 和 opentiny-ux 两份 skill 已加载，并告诉我是否需要重启。

## 开发和打包

需要 Node.js 22+。

```sh
npm ci --prefix ux-workbench
npm run release:pack
```

`release/` 包含安装用 `.tgz`、SHA-256 与安装说明。构建在临时工作区完成，不替换已链接到 DSH 的本机插件，也不读取用户稿件。开发入口与验证见 [开发说明](docs/development.md)。

| 目录 | 职责 |
| --- | --- |
| `packages/dsh-ux-review/` | DSH Host、Client 适配、插件元信息 |
| `ux-workbench/` | 共用评审界面、离线导出、浏览器测试 |
| `skills/ux-prototype/` | 单文件协议、CLI、按需读取与 `finish` |
| `skills/opentiny-ux/` | OpenTiny 设计原则、组件和参考资源 |
| `docs/` | 开发、分发和版本变更说明 |

用户稿件、任务状态、备份、试验原型和构建副本不纳入 Git。公开示例只保留合成的 [保存/弹窗示例](ux-workbench/examples/interaction-demo.ux.html)。

Windows 尚未实机验证；macOS 已有真实 DSH 修改交付验证。浏览器剪贴板成功、拒绝及重试已覆盖，原生 DSH 剪贴板端到端仍待手动验证。
