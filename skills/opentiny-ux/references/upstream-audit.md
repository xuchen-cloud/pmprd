# 官方资源全量核对

核对日期：2026-11-04。逐文件比较 `opentiny/agent-skills` 仓库的五个 skill，快照 `3f47a37f309163c943eb313b8a86c4d96a7fff00`。收录状态以文件实际内容和 SHA-256 为依据。文件级结果见 `upstream-file-audit.csv`，机器可读汇总见 `upstream-audit-summary.json`。

| 官方 skill | 原样收录 | 保留上游 | 用途与处理依据 |
|---|---:|---:|---|
| opentiny-next-app-integration | 0 | 23 | 用于 Vue3/Vite 应用中的 TinyRobot、GenUI、业务 MCP 与 PageTool 生产集成；保留在上游供工程集成任务查阅。 |
| tiny-robot-skill | 155 | 0 | 该 skill 的所有源文件均已原样保留。 |
| tiny-vue-skill | 4044 | 0 | 该 skill 的所有源文件均已原样保留。 |
| webmcp-cli-skill | 0 | 9 | 用于浏览器自动化和 MCP 工具执行；保留在上游供自动化任务查阅。 |
| webmcp-sdk-skill | 0 | 26 | 用于 WebMCP 客户端、服务端、插件与模型接入；保留在上游供服务集成任务查阅。 |

## 本次发现并补齐

核对时补齐17份 UI skill 源文件，见下表。工程操作类文档保留在参考包中，按相应专题查阅。

| 文件 | 处理 |
|---|---|
| `tiny-vue-skill/.claude-plugin/plugin.json` | 已原样补齐 |
| `tiny-vue-skill/SKILL.md` | 已原样补齐 |
| `tiny-vue-skill/rules/component-use.md` | 已原样补齐 |
| `tiny-vue-skill/rules/project-setting.md` | 已原样补齐 |
| `tiny-robot-skill/.claude-plugin/plugin.json` | 已原样补齐 |
| `tiny-robot-skill/SKILL.md` | 已原样补齐 |
| `tiny-robot-skill/migration/bubble-migration.md` | 已原样补齐 |
| `tiny-robot-skill/migration/use-conversation-migration.md` | 已原样补齐 |
| `tiny-robot-skill/migration/use-message-migration.md` | 已原样补齐 |
| `tiny-robot-skill/rules/code-generation.md` | 已原样补齐 |
| `tiny-robot-skill/rules/component-use.md` | 已原样补齐 |
| `tiny-robot-skill/rules/kit-use.md` | 已原样补齐 |
| `tiny-robot-skill/rules/project-setting.md` | 已原样补齐 |
| `tiny-robot-skill/tools/ai-client.md` | 已原样补齐 |
| `tiny-robot-skill/tools/conversation.md` | 已原样补齐 |
| `tiny-robot-skill/tools/message.md` | 已原样补齐 |
| `tiny-robot-skill/tools/utils.md` | 已原样补齐 |

## 已转成可直接用的轻量资源

- 完整 454 个基础/语义 token、依赖链解析和按需 CSS 输出；组件专属 token 保留于主题快照。
- Container 五种版型、12/24 栅格与官方响应断点；提供原生布局片段。
- 导航、步骤条、单选及其他常见原生片段；用户规定的 AI 渐变独立标注。
- 官方 Vue 示例原样保留用于核对；原型按当前任务适配所需的 DOM、CSS 与交互状态。

## 资源适配方式

- Vue/Vite 安装、包管理、生产国际化配置与迁移：保留参考文档，生成页面采用原生 HTML/CSS/JavaScript。
- 大数据虚拟化、富文本与图表引擎：保留完整 API 与示例，按具体评审需求实现相应交互。
- 模型调用、WebMCP、PageTool 与服务连接：原型通过本地数据模拟反馈，工程接入资料按上表保留在对应位置。

结果：共核对4257个源文件，每个文件均有收录状态与处理依据，已收录文件的内容哈希一致率为100%。资源覆盖由本清单核对，原生组件实现与具体页面效果分别通过组件及页面检查验证。
