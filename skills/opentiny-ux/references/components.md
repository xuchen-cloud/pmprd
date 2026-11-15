# 轻量组件与片段

优先复用以下片段，按任务通过 `component-catalog.md` 或 `scripts/component.py` 查阅其他组件。以下类名对应本 skill 的原生实现。基础 CSS 为 `assets/components.css`；组件模块位于 `assets/modules/`，构建脚本按实际使用的类名嵌入。

## 可直接使用的场景片段

| 文件（`assets/recipes/` 下） | 可复用内容 |
|---|---|
| `navigation.html` | 顶部导航、侧边菜单、选中状态、内容切换、窄屏开关 |
| `steps.html` | 横向单链步骤条：完成勾选、当前序号、后续节点和连接线 |
| `container.html`、`layout.html` | Container 默认版型、12/24 栅格、面包屑、分区与间距；参见 page-layout.md |
| `selection.html` | 级联、自动补全、范围、组织选项、双向穿梭 |
| `table.html` | 搜索、排序、全选、批量状态变更、空结果 |
| `display.html` | 统计、徽标、头像、进度、折叠、树、时间线 |
| `feedback.html` | 状态、气泡确认、通知、取消与 Esc |

片段提供相关元素的最小可运行组合。复制当前任务所需部分，合并多个副本时设置唯一 id。业务交互直接使用原生 JavaScript 实现。

普通操作使用 `type=button`，提交表单使用 `type=submit`。靠右触发的气泡面板使用 `.align-end`，让确认操作完整呈现在视口内。将模块的窄屏规则放在本模块默认规则后，保持正确的样式优先级。

## 基础组件速查

| 组件 | 样式/结构 | 最少行为 |
|---|---|---|
| 按钮 | `.ux-btn`，`.primary`、`.text`、`.icon`、`.small` | hover/focus/disabled；提交中防重复 |
| 字段 | `.ux-field > label + .ux-input` | for/id 绑定；aria-invalid；错误保留值 |
| 下拉/日期/数字 | 原生 select/input + `.ux-input` | 实际选值、范围与必填；复杂下拉才自绘 |
| 单选卡 | fieldset.ux-choice-group，label.ux-choice + input.ux-radio | 同名 radio；选中卡片单层边框；键盘焦点在 radio 上显示 |
| 复选与开关 | 原生 checkbox；开关 `.ux-switch` | 保留配置草稿，展示开关状态文字 |
| 页签 | `.ux-tabs` + role=tab/tabpanel | aria-selected，ArrowLeft/Right/Home/End；切换对应视图 |
| 提示/状态 | `.ux-alert`、`.ux-tag`、`UX.toast` | 文本说明状态；错误给具体恢复动作 |
| 表格 | `.ux-table-wrap > table.ux-table` | 搜索、空结果；若出现排序/分页/批量按钮则实现 |
| 分页 | `.ux-pagination` | 页码、总数与可见行一致，筛选后回第一页 |
| 弹窗 | 原生 dialog.ux-dialog | showModal、Esc、焦点返回；取消后保留原始表单值 |
| 侧拉面板 | dialog.ux-dialog.ux-drawer | 独立滚动、固定头底、关闭取消异步 |
| 上传 | input[type=file] + `.ux-dropzone` + `.ux-file-list` | 校验类型/大小/数量，移除，错误信息；展示拖拽区域则实现拖拽 |
| 骨架屏 | `.ux-skeleton.hero/.line` | aria-busy，状态文字，完成/错误替换；支持减少动画 |
| AI 输入 | form.ux-sender，input + button | 单行，Enter 与发送；区分中文候选确认与发送动作 |
| 长图 | img.ux-long-image + `.ux-preview-scroll` | 真正一张内嵌图；纵向滚动、查看全图 |
| 空状态 | `.ux-empty` | 解释下一步，提供相关动作 |
| 固定操作区 | `.ux-footer` | 页面底部留足空间，缩窄时换行 |

## 表单片段

输入框焦点按官方 `theme/input/index.less`：`outline: 0`，原有 1px 边框在正常 `#c2c2c2` 与聚焦 `#191919` 之间切换；错误态采用 `#f23030` 边框和就地错误文字。鼠标、Tab 和校验后 `.focus()` 均使用同一层边框。按钮、链接和 Radio 分别定义键盘提示。AI 输入由外层单一渐变边框表达焦点，内部 input 使用透明背景和0宽度边框；AI 样式依据用户补充规则。

```html
<div class="ux-field">
  <label for="name">商品名称 <span class="ux-required">*</span></label>
  <input id="name" class="ux-input" required aria-describedby="name-error">
  <p id="name-error" class="ux-error" hidden>请输入商品名称</p>
</div>
```

## 弹窗片段

```html
<button class="ux-btn" id="open">添加资料</button>
<dialog id="files" class="ux-dialog" aria-labelledby="files-title">
  <header class="ux-dialog-head"><h2 id="files-title">添加资料</h2><button type="button" class="ux-btn text icon" data-close aria-label="关闭">×</button></header>
  <div class="ux-dialog-body">按任务填充</div>
  <footer class="ux-dialog-foot"><button type="button" class="ux-btn" data-close>取消</button><button type="button" class="ux-btn primary" id="apply">确认</button></footer>
</dialog>
```

用 `UX.open(dialog)`、`UX.close(dialog)` 管理焦点和滚动。原生 dialog 配合 runtime 的 Tab 首尾循环提供焦点约束；任务计时器在 close 事件取消。嵌套弹窗只在确有独立子任务时使用。

围绕评审所需的外观、语义和状态实现组件。大型树、富文本和拖拽排序按本次流程选取所需分支，每个可见工具栏操作均提供实际反馈。原生日期选择器采用系统样式，需要精确复现时按对应主题绘制。

## 步骤条与选择状态

步骤条按任务选择默认条形、横向单链、垂直单链或高级向导。`assets/recipes/steps.html` 对应 `line=true, size=medium`，圆节点32px、文字14px、图文距8px、线宽1px；完成态用勾选，当前态用实底序号，待完成态用空心序号。窄屏采用 small 档的24px圆与12px字，极窄容器支持局部滚动。进度展示使用 ol/li 与 aria-current=step；支持跳转时使用按钮并连接对应页面。

Radio 原生语义配 `.ux-radio`：外圆16px、内点8px，默认边框 #c2c2c2，选中色 #1476ff。带说明的卡片通过原生组合布局实现，Radio 的状态与尺寸沿用官方值。鼠标选中时卡片显示单层蓝色边框，键盘导航时 Radio 显示清晰焦点轮廓。分别验证 pointer、selected 与 focus-visible 状态。
