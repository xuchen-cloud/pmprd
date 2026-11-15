# 来源与适配记录

查阅日期：2026-11-03。用户提供的发现命令 `npx skills add opentiny/agent-skills --list` 已执行；当次返回 5 个技能，其中本用途参考 tiny-vue-skill 与 tiny-robot-skill。

- Agent skills 快照：[opentiny/agent-skills @ 3f47a37f](https://github.com/opentiny/agent-skills/tree/3f47a37f309163c943eb313b8a86c4d96a7fff00)。参考 `skills/tiny-vue-skill/webdoc/theme.md`、`apis/button.md`、`apis/input.md`、`apis/dialog-box.md`、`apis/drawer.md` 以及 TinyRobot `components/sender.md`、`guide/theme-config.md`。
- TinyVue 样式快照：[opentiny/tiny-vue @ 01f59e78](https://github.com/opentiny/tiny-vue/tree/01f59e781fbc0c4fe82320e58d1eed576703236a)。基础变量：[packages/theme/src/base/vars.less](https://github.com/opentiny/tiny-vue/blob/01f59e781fbc0c4fe82320e58d1eed576703236a/packages/theme/src/base/vars.less)。组件值查阅同快照的 `button/vars.less`、`input/vars.less`、`dialog-box/vars.less`、`drawer/vars.less`、`form/vars.less`、`tabs/vars.less`。
- 保留 MIT 许可于 `upstream-license.txt`；构建脚本会把许可注释放入 HTML。

原生 CSS 组件与 JavaScript 辅助按交互稿用途实现，色值、尺寸与视觉规则均映射到上述来源。公司主题通过优先覆盖 token 映射应用。

TinyRobot 提供 Sender、交互状态与主题分层参考，原型通过原生 HTML/CSS/JavaScript 适配。AI 视觉采用用户指定的蓝紫渐变与双星标识。

## 全组件按需参考快照

`opentiny-reference.zip` 保存同一 agent-skills 快照的完整 `apis/`、`demos/`、`webdoc/`、`menu.md`，以及同一 TinyVue 快照的 `packages/theme/src/**/*.less` 和许可文件。包含179个 API Markdown、3373个 Vue 示例、393个主题 LESS 文件，其余为配套数据和文档。准确数量与版本见 `upstream-manifest.json`。压缩包用于按需查阅，生成页面复用其中对应的设计值与交互规则。

`component-catalog.md` / `component-index.json` 包含276个查阅条目，覆盖组件、Grid/Chart 功能专题与主题基础项。`scripts/component.py` 通过标准库读取指定条目，`assets/recipes/` 和按需 CSS 模块提供可直接复用的原生适配。

导航取值来自 `nav-menu/vars.less`、`nav-menu/index.less`、`tree-menu/vars.less`、`tree-menu/index.less`。其他组件参考同快照的 breadcrumb、steps、tree、progress、transfer、popover、notify、badge、statistic 等定义。布局密度、原生 HTML 组合与交互示例按原型需求适配；AI 蓝紫渐变与双星标识来自用户补充规范。

同一 agent-skills 快照中的 TinyRobot `components/`、`demos/`、`examples/`、`guide/` 收录于 `robot/`，通过 `ai-` 前缀查找。交互参考按需读取，AI 配色采用用户补充规范，服务交互使用本地模拟数据。

步骤条片段依据同快照 `steps/index.less`、`steps/vars.less`、`base/vars.less`、`demos/steps/line-horizontal.vue`，对应横向单链型。Radio 依据 `radio/index.less` / `radio/vars.less`，键盘轮廓按原生控件的可访问性需求适配。

完整设计 token 现独立收录为 `assets/opentiny-tokens.css`（454 个基础/语义变量）与可检索 JSON，逐条来自同快照 `base/vars.less`；组件专属变量来自完整主题快照。便捷别名指向这些官方变量，构建器按传递依赖裁取。页面布局核对官方 skill 的 Layout 优先规则、Layout/Container API 与示例，以及 `packages/renderless/src/container/index.ts` 的各版型区域计算；必要的原始文件保存在 `references/upstream-layout/`。
