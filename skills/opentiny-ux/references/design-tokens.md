# 设计 token

默认采用 OpenTiny Design 已记录快照的基线主题的浅色版本。`assets/opentiny-tokens.css` 与 `references/token-index.json` 保留全部 454 个基础与语义变量；`assets/tokens.css` 是指向官方变量的便捷别名层；原生 CSS 通过下表变量应用设计规范。具体路径与快照见 sources.md。

| 本地变量 | 值 | 上游对应 |
|---|---|---|
| --ux-primary | #191919 | --tv-base-color-brand / --tv-Button-bg-color-primary |
| --ux-primary-hover | #595959 | --tv-Button-bg-color-active-primary |
| --ux-link / --ux-selected | #1476ff | --tv-color-text-link / --tv-color-bg-active-control |
| --ux-selected-bg | #f0f7ff | --tv-base-color-brand-1 |
| --ux-text | #191919 | --tv-color-text |
| --ux-secondary | #595959 | --tv-color-text-secondary |
| --ux-muted | #808080 | --tv-color-text-weaken |
| --ux-disabled-text | #c2c2c2 | --tv-color-text-disabled |
| --ux-page / --ux-surface | #f5f5f5 / #fff | --tv-color-bg / --tv-color-bg-secondary |
| --ux-border / --ux-divider | #c2c2c2 / #f0f0f0 | --tv-color-border / --tv-color-border-divider |
| --ux-disabled-bg | #f0f0f0 | --tv-color-bg-disabled |
| --ux-success / --ux-warning / --ux-error | #5cb300 / #ff8800 / #f23030 | 对应 base-color-*-6 |
| --ux-mask | rgba(0,0,0,.2) | --tv-color-bg-mask |
| --ux-font | Helvetica、Arial、PingFang SC、微软雅黑等 | --tv-font-family 的本地字体适配 |
| --ux-font-sm / --ux-font-md | 12px / 14px | --tv-font-size-sm / md |
| --ux-title-card / --ux-title-page / --ux-title-dialog | 16 / 18 / 20px | --tv-font-size-heading-xs / sm / md |
| --ux-line / --ux-weight | 1.5 / 600 | --tv-line-height-number / --tv-font-weight-bold |
| --ux-radius / --ux-radius-panel | 6px / 8px | --tv-border-radius-md / lg |
| --ux-control / --ux-control-sm / --ux-control-lg | 32 / 28 / 40px | --tv-size-height-md / sm / lg |
| --ux-gap-1…6 | 4 / 8 / 12 / 16 / 24 / 32px | --tv-space-sm…xxxl |
| --ux-shadow-panel | 0 8px 24px rgba(0,0,0,.16) | --tv-shadow-4-down |
| --ux-shadow-drawer | -8px 0 24px rgba(0,0,0,.16) | --tv-shadow-4-left |

布局适配默认值：页面宽1200px、页边距24–32px、普通弹窗宽560px、抽屉宽880px，可按具体页面配置。单行输入条可选48px档，普通输入框用32px，大操作区可选40px。

按钮默认6px圆角、最小宽96px、左右内边距24px；文本和图标按钮按内容收缩，禁用态优先于 hover。输入框 hover/focus 为 #191919、outline 为0，错误态保留红色边框。单选/复选选中为蓝色；Switch 采用该组件的官方键盘 focus-visible 规则。普通开关40×20px、内点16px，mini 为32×16px、内点12px。页签选中为黑色字与下划线。标题采用600字重；弹窗标题20px，正文14px。

功能色用于图标和浅色背景，正文保持深色与清晰对比度。错误和状态提示结合颜色、图标与文字表达。

应用顺序：用户明确指定的公司规范/截图 > 本 skill 记录的 OpenTiny 基线 > 原型适配默认值。公司主题通过集中覆盖变量实现，各设计值记录相应来源。

## 导航与 AI 补充

NavMenu 高48px，TreeMenu 宽220px、节点高32px，选中标识见 `navigation-and-ai.md`。用户指定的 AI 蓝紫渐变集中在 `assets/modules/ai.css`，与官方基础 token 分别记录来源。

## 解析语义变量

读取 `var(--semantic, fallback)` 时，先查同快照 `theme/base/vars.less` 及公司主题覆盖，解析完整依赖链；变量缺失时使用后备值。例如步骤条完成态的 `--tv-color-bg-active-dark` 解析为 #f5f5f5，当前态的 `--tv-color-bg-primary` 解析为 #191919。

## 完整 token 的按需使用

`python3 scripts/tokens.py space` 查全部间距，`font` 查字号/字重/字体，`size` 查尺寸，`radius` 查圆角，`shadow` 查阴影，`color` 查色彩。也可用完整变量名或组件前缀，例如 `Steps-node-done-bg`；输出原始值与依赖解析值。组件变量仍完整保存于快照的各 `vars.less`，查询脚本按需读取。

`--css` 输出命中 token 及其传递依赖。`build_html.py` 从页面实际使用的样式提取变量链，并保留语义引用。直接写 HTML 时复制完整查询输出，包含变量及其依赖。公司主题覆盖放在基线后生效。
