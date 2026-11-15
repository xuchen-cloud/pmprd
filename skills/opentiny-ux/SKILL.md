---
name: opentiny-ux
description: 按 OpenTiny 设计 token、组件外观、布局与 AI 蓝紫视觉规则，制作或调整原生 HTML/CSS/JavaScript 界面。用于新页面或视觉、布局、组件设计变化；既有文案、PRD、批注小改由 ux-prototype 直接处理。
---

# OpenTiny UX 设计

保留原 craft-ux 的 OpenTiny 设计资源与制作方法，输出可独立打开的 UTF-8 单文件业务 HTML。按需内嵌 CSS、JavaScript、SVG 和必要图片，使用原生 DOM 与本地模拟数据完成演示。默认中文。

本 skill 负责业务界面的设计与交互。配合 `ux-prototype` 时，由主工作流提供当前需求和本轮修改范围，再接管 PRD、两类标注、版本、diff 与保存封装；业务 HTML 不再嵌入旧版需求与变更编辑器。

已有页面只改文案、说明、PRD 或不涉及设计的既有逻辑时，直接沿用页面资源，由主工作流完成，不需要重新读取设计资料或构建整页。确需设计变化时，下面的布局、token、组件和 AI 规范只读取本次涉及的部分；所有原有设计资源与规则继续适用。

## 工作方式

1. **确定任务。** 按用户需求或主工作流提供的当前 PRD，实现主要流程、业务规则和验收要点。修改已有页面时保留无关交互与设计资源，稳定锚点由协作工作流维护。
2. **选择布局与组件。** 新建或调整布局时按 [布局规则](references/page-layout.md) 选择 Container 版型与 Layout 栅格；调整视觉值时查询 [设计 token](references/design-tokens.md)、`assets/tokens.css` 或 `scripts/tokens.py`。新增或改变组件时查对应 [轻量组件](references/components.md)、[完整目录](references/component-catalog.md) 条目或 `scripts/component.py 关键词`，沿用未改变的组件。
3. **实现真实交互。** 按 [通用交互模式](references/interaction-patterns.md) 组织输入、操作、反馈和结果，覆盖本次涉及的加载、校验、错误、取消与恢复状态。内嵌实际用到的样式依赖。
4. **保持视觉一致。** 将可见控件对应到官方组件变体，核对尺寸、间距、字体、边框和状态。主题变量追溯基础变量及公司主题覆盖。[导航与 AI 规范](references/navigation-and-ai.md) 保留官方导航样式和原有蓝紫 AI 渐变，集中覆盖 token 应用公司主题。
5. **验证与交付。** 运行 `scripts/check_html.py`，按 [QA](references/qa.md) 验证本轮业务路径、键盘操作、窄屏布局和控制台。交给主工作流业务 HTML 与实际改动说明；独立调用时直接交付业务 HTML。

## 按需构建

资源路径相对本 skill。Python 3.10+ 标准库脚本支持 `python3`、`python` 或 Windows `py -3`，实际使用绝对路径调用，含空格路径加引号。

```sh
python3 scripts/component.py tree-select
python3 scripts/component.py tree-select --part tokens
python3 scripts/build_html.py --title '团队管理' --body /abs/body.html --script /abs/behavior.js --output /abs/team.html
python3 scripts/check_html.py /abs/team.html
```

`--script`、`--style` 可选；组件模块根据类名自动选择，动态拼接类名时用 `--components navigation,table,dialog`。构建器不接受旧版 `--spec` 参数，PRD 和历史由 `ux-prototype` 统一封装。

## 交互与资源

- 主要操作产生可见结果，加载立即反馈并限制重复提交，错误保留输入。取消终止当前模拟任务并保留上次成功结果。
- 用标签页、单选、步骤条表达相应关系，导航状态与展示内容一致；按任务选择弹窗、侧栏或独立页。
- 优先原生 button/input/select/fieldset，补齐标签、图标按钮名称、键盘操作与焦点返回，处理中文输入法与减少动画偏好。
- 保持原 OpenTiny 焦点设计：Input 单层边框变色，按钮、链接及 Radio 保留键盘提示。检查鼠标、Tab 与校验定位。
- 使用本地模拟数据与内嵌资源。用户输入通过 textContent 展示，需要保存演示草稿时为 localStorage 加命名空间、异常处理和重置入口。

| 资源 | 读取时机 |
| --- | --- |
| [设计 token](references/design-tokens.md)、`assets/tokens.css`、`scripts/tokens.py` | 基础、语义与轻量别名；全量 CSS 为 `assets/opentiny-tokens.css` |
| [布局规则](references/page-layout.md)、`assets/recipes/container.html`、`layout.html` | Container 五版型、12/24 栅格、响应断点与内容间距 |
| [轻量组件](references/components.md)、`assets/recipes/` | 当前页面需要的原生 HTML 和交互片段 |
| [完整目录](references/component-catalog.md)、`scripts/component.py` | 官方 API、状态样式与示例 |
| `references/opentiny-reference.zip`、[来源说明](references/sources.md) | 按条目读取官方参考快照，保留许可与来源 |
| [导航与 AI](references/navigation-and-ai.md)、[交互模式](references/interaction-patterns.md) | 导航、AI 视觉及多状态交互 |
| `assets/components.css`、`assets/modules/`、`assets/runtime.js` | 基础样式、按需组件模块和交互辅助 |
| `assets/examples/` | 查看可操作组件组合 |
| [资源核对](references/upstream-audit.md)、[QA](references/qa.md) | 维护覆盖情况、适配范围及交付验证 |

设计值注明官方来源、公司主题或原型适配依据。日期与下拉弹层可采用系统样式；需要精确复现时按对应官方主题实现。
