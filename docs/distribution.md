# 分发与新电脑安装

## 推荐交付物

向使用者提供 **`dsh-ux-review-0.1.12.tgz`** 和同名 `.sha256` 文件。插件包包含已编译的 Host、Client、离线阅读器，以及 `ux-prototype`、`opentiny-ux` 两份 skill。使用者无需克隆仓库或编译项目。

插件适配 **DeepSeek Harness 0.2.2-rc.3**。目前未发布 npm 包；不要只输入 `dsh-ux-review` 并假定能从 npm 安装。仓库根目录不是可安装的插件包，也不要把 GitHub 自动生成的 Source code ZIP 当成安装包。

## 从 GitHub 一条指令安装

仓库和 [v0.1.12 Release](https://github.com/xuchen-cloud/pmprd/releases/tag/v0.1.12) 公开可读，无需 GitHub 账号或登录。下载预编译安装包即可，不需要克隆源码或本地编译。

发给对方 DSH 的自然语言指令：

> 请从 https://github.com/xuchen-cloud/pmprd/releases/tag/v0.1.12 下载 dsh-ux-review-0.1.12.tgz，检查本机 DSH 是否兼容 0.2.2-rc.3，然后安装到当前正在使用的 profile 并启用插件；确认内置的 ux-prototype 和 opentiny-ux 两份 skill 已加载，并告诉我是否需要重启。

已配置桌面版 `dsh` 命令时，终端可直接执行（macOS / Windows PowerShell）：

```sh
dsh plugin --profile desktop add https://github.com/xuchen-cloud/pmprd/releases/download/v0.1.12/dsh-ux-review-0.1.12.tgz
```

这条命令用于 `desktop` profile；使用其他 profile 时换成实际名称。也可把同一个下载链接粘贴到 DSH「插件 → 添加插件」，安装后启用。插件加载若要求重启，先保存当前工作后再重启。

## 在新电脑安装

1. 安装并打开 DSH 0.2.2-rc.3。
2. 下载或接收 `.tgz`，保留为压缩包，不必解压。
3. 打开左侧「插件 → 添加插件」，填写 `.tgz` 的**本地绝对路径**。例如 macOS 的 `/Users/你的用户名/Downloads/dsh-ux-review-0.1.12.tgz`，或 Windows 的 `C:\Users\你的用户名\Downloads\dsh-ux-review-0.1.12.tgz`。输入框中不额外加引号。
4. 安装完成后选择「立即启用」，按 DSH 提示重启。
5. 在会话右侧「新建标签页 → 打开设计文档」打开 `.ux.html` 或普通 HTML。

DSH 官方添加插件入口支持压缩包、下载 URL 和本地绝对路径，安装与启用是两个步骤，见 [官方插件管理说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-plugin-manager/README.zh.md)。优先使用以上界面流程，可避免桌面与命令行 profile 不一致。

已经配置好桌面版 `dsh` 命令时，也可运行：

```sh
dsh plugin --profile desktop add "/absolute/path/dsh-ux-review-0.1.12.tgz"
```

Windows PowerShell 中把路径换成 `"C:\Users\你的用户名\Downloads\dsh-ux-review-0.1.12.tgz"`。命令不存在时直接使用插件界面，不需要为了安装插件另外安装一套 DSH CLI。安装后仍到插件页核对启用状态。

## Skill 如何一起安装

插件启用时注册包内的 `skills/`，因此在 DSH 中不需要另外安装 skill：

- `ux-prototype`：维护 HTML 协议、PRD 与标注，提供 `uxdoc.mjs read` / `finish`。
- `opentiny-ux`：OpenTiny 设计原则和组件资源。

项目或用户目录中已有的同名 skill 可能按 DSH 优先级覆盖包内版本。遇到说明与插件不一致时，先检查同名副本。升级插件也会一起升级内置 skill。

只使用“复制给外部 Agent”处理本机修改时，提示词已给出包内脚本的绝对路径；外部 Agent 能访问该目录且有 Node.js 22+ 即可，不需要额外安装 skill。远程聊天网页不会因为粘贴提示词而获得本机文件。

若要让其他支持 `SKILL.md` 的 Agent 独立创建文档，可从源码仓库的 `skills/` 复制两个完整目录到该 Agent 规定的 skill 目录，保留 `scripts/`、`references/`、`assets/` 和 vendor 文件；不能只复制 `SKILL.md`。`ux-prototype` 的 CLI 需要 Node.js 22+；`opentiny-ux` 的 Python 辅助脚本需要 Python 3。不同 Agent 的安装目录以其说明为准。

## 升级与回退

先保存正在编辑的文档，等待 AI 任务结束。按该版 DSH 的第三方插件流程卸载旧插件、安装新 `.tgz` 并启用；保留旧安装包即可用相同步骤回退。用户 HTML 与备份保存在工作区，不在插件安装包里。

## 维护者打包与发布

```sh
npm ci --prefix ux-workbench
npm run release:pack
```

产物位于 `release/`，生成脚本会检查 Host、Client、两份 skill、CLI 和 vendor 是否齐全，并输出 SHA-256。在临时工作区完成构建，不更新本机已链接的 `packages/dsh-ux-review/lib/`。

每次版本更新后创建对应的 GitHub Release，把 `.tgz`、`.sha256` 与 `INSTALL.md` 附到 Release，再更新安装指令中的版本链接。Git 提交不会自动发布安装包；目前没有自动发布工作流。

Windows 原生安装与 UI 尚未实机验证，不能把跨平台路径测试当作 Windows 实测。
