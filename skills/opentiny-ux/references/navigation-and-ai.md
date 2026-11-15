# 导航与 AI 视觉规范

## 顶部导航：OpenTiny NavMenu

| 项 | 官方默认 |
|---|---|
| 高度 / 水平 padding | 48px / 16px |
| 字体 / 文本 | 14px / #191919 |
| 相邻项两侧 margin | 各 16px（两项之间合计 32px） |
| 当前项 / 悬停 | 字重 600，白底与黑色文字 |
| 当前项底部标记 | 2px，#191919 |
| 背景 / 阴影 | #fff / 0 1px 4px rgba(0,0,0,.08) |

logo 和 toolbar 使用独立插槽，品牌图形按任务配置。根据导航项数量选用溢出菜单。

## 侧边导航：OpenTiny TreeMenu

| 项 | 官方默认 |
|---|---|
| 宽度 / 顶部 padding | 220px / 8px |
| 行高 / 行间空白 | 32px / 4px |
| 字号 / 文本 | 14px / #191919 |
| 右侧分隔线 | 1px，#f0f0f0 |
| hover | #f5f5f5 背景，文字 600 |
| 选中 | #f5f5f5 背景，文字 bold，左侧 2px #191919 竖线 |
| 左内容起点 / 前图标间距 | 16px / 8px |

选中背景铺满整行，标识线相对菜单容器 left:0，文字左距16px。按 `page-layout.md` 核对 Container 版型及 TreeMenu 内部样式；default 版型的侧栏贴容器左边。搜索、折叠和层级按需求选用。普通导航使用 nav + a/button 和 aria-current，树式交互使用对应树语义及键盘操作。展开与收起同步状态，导航对应实际内容并保留编辑草稿。窄屏提供菜单入口和 Esc 关闭。

## AI：用户补充视觉规则

允许蓝紫色渐变代表 AI：`--ux-ai-blue: #3569e8`，`--ux-ai-purple: #8050ce`，`--ux-ai-gradient: linear-gradient(120deg,...)`，柔和背景 `#f6f3ff`。

- AI 入口、生成按钮、输入区按信息层次选用渐变填充或1px渐变边框。
- 双星图标用渐变。复用 `assets/ai-spark.svg`，内嵌时确保 gradient id 唯一；纯装饰 aria-hidden，图标按钮仍有可读名称。渐变填充按钮上用白色双星以保对比，白底/淡底上的双星保留彩色渐变。
- 原生片段使用 `.ux-ai-outline` / `.ux-ai-fill` / `.ux-ai-mark`，构建脚本自动引入 `assets/modules/ai.css`。正文保持深色，错误、成功、选择与禁用状态使用各自的语义色。
- hover 使用轻微变化；输入聚焦通过同一层边框的变化表达，按钮保留清晰的键盘提示。disabled 使用中性色；生成中保留 AI 标识并保持单次操作。
- 普通保存、取消、导航和表格采用 OpenTiny 的黑白灰与蓝色语义。

## 参考与复用

运行 `python3 scripts/component.py nav-menu --part tokens` / `--part style`，或将 key 换成 `tree-menu` 查原始定义。原生壳见 `assets/recipes/navigation.html` 与 `assets/modules/navigation.css`。基础主题与快照版本见 `sources.md`。
