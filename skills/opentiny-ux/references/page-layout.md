# 页面布局：先定版型，再定栅格与间距

按官方 tiny-vue-skill 优先使用 Layout，配合 Row / Col 组织栅格，页面外壳采用 Container 版型。轻量 HTML 通过等效 CSS 实现这些规则。原文见 `upstream-layout/official-skill.md`；API 与示例可通过 `component.py layout` / `container` 按需读取。

## Container 版型

| pattern | 区域关系 |
|---|---|
| default | 顶部通栏；下方左侧栏、右主内容 |
| simple | 左侧栏、右主内容 |
| classic | 顶栏、主内容、底栏 |
| legend | 顶部通栏；左侧栏；右侧主内容与底栏 |
| fashion | 左侧栏通高；右侧顶栏和主内容 |

Container 默认 header-height=60、aside-width=200、footer-height=60，均可配置。组合 NavMenu/TreeMenu 时显式配置为48/220。区域 margin=0，主区独立滚动；default 版型侧栏贴容器左边，上沿位于顶栏下方。TreeMenu 的整行选中背景与 left:0 标识线贴菜单容器边，文字左距16px。

`assets/recipes/container.html` 提供 default 版型，`assets/modules/layout.css` 提供五种版型，`navigation.html` 提供可操作的导航片段。根据页面区域需求选择版型；正式原型的视觉取值沿用组件主题与设计 token。

## Layout 栅格

默认12栏，可配置24栏，同一行超出总栏数时换行。Row 通过 gutter 配置间距，noSpace 对应零间距。官方示例中 Col 默认左右各10px；原型显式配置所需 gutter。Col 的 span、offset 与响应档位按任务设置。

官方响应断点：768、992、1200、1920px。xs <768，sm 为 768–991，md 为 992–1199，lg 为 1200–1919，xl ≥1920。原生 `.ux-layout-row` 配 `.ux-col`，通过 `--span`、`--xs`/`--sm`/`--md`/`--lg`/`--xl` 设置占栏数，`--ux-gutter` 设置间距；只用需要的属性。窄屏菜单展开形式属于响应适配，仍保留访问入口。

## 内容间距与字体

从完整 token 选择间距：space-xs=2、sm=4、md=8、lg=12、xl=16、xxl=24（内容块间距）、xxxl=32（容器内距）。正文14px、辅助文字12px；标题按卡片16px、页面18px、弹窗20px选用。组件专属默认值优先，页面容器与内容分组按层级选取相应档位。
