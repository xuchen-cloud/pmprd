# 组件资源目录

按中文名或 key 定位，读取命中的组件条目。完整参考快照包含官方 API、示例和主题 LESS；当前页面的原生实现按所需外观与交互状态适配。

`python3 scripts/component.py tree-select` 列出该组件的可复用片段和参考条目。
`python3 scripts/component.py tree-select --part tokens` 读取对应 token；`--part style` 读取视觉状态；`--part api` 查行为语义；`--part demo --name 文件名.vue` 读取指定官方示例。

优先复用已有轻量片段；其他组件从快照提取本次所需的 DOM、CSS 与交互规则。图表、编辑器和流程图按评审流程实现相应分支。后端配置、性能 API 和框架设施按对应专题保留为参考条目。

## 基础 (Basic)

| 名称 | key | 原生配方 | 官方参考 |
|---|---|---|---|
| 按钮 | `button` | 按需适配 | API/主题/示例 |
| 按钮组 | `button-group` | 按需适配 | API/主题/示例 |
| 全局配置 | `config-provider` | 按需适配 | API/示例 |
| 容器布局 | `container` | `container.html` | API/示例 |
| 图标 | `icon` | 按需适配 | API/示例 |
| 栅格布局 | `layout` | `layout.html` | API/示例 |
| 链接 | `link` | 按需适配 | API/主题/示例 |
| 分割线 | `divider` | `layout.html` | API/主题/示例 |
| 虚拟化容器 | `virtual-scroll-box` | 按需适配 | API/示例 |
| 间距 | `space` | `layout.html` | API/主题/示例 |
## 导航 (Navigation)

| 名称 | key | 原生配方 | 官方参考 |
|---|---|---|---|
| 动作菜单 | `action-menu` | `navigation.html` | API/主题/示例 |
| 锚点 | `anchor` | `navigation.html` | API/主题/示例 |
| 面包屑 | `breadcrumb` | `navigation.html` | API/主题/示例 |
| 下拉菜单 | `dropdown` | `navigation.html` | API/主题/示例 |
| 导航菜单 | `nav-menu` | `navigation.html` | API/主题/示例 |
| 分页 | `pager` | `navigation.html` | API/主题/示例 |
| 步骤条 | `steps` | `steps.html` | API/主题/示例 |
| 页签 | `tabs` | `navigation.html` | API/主题/示例 |
| 树型菜单 | `tree-menu` | `navigation.html` | API/主题/示例 |
## 表单 (Form)

| 名称 | key | 原生配方 | 官方参考 |
|---|---|---|---|
| 自动完成 | `autocomplete` | `selection.html` | API/主题/示例 |
| 基础选择器 | `base-select` | 按需适配 | API/主题/示例 |
| 级联选择器 | `cascader` | `selection.html` | API/主题/示例 |
| 级联面板 | `cascader-panel` | `selection.html` | API/主题/示例 |
| 多选框 | `checkbox` | 按需适配 | API/主题/示例 |
| 颜色选择器 | `color-picker` | `selection.html` | API/主题/示例 |
| 颜色选择面板 | `color-select-panel` | 按需适配 | API/主题/示例 |
| 日期选择器 | `date-picker` | `selection.html` | API/主题/示例 |
| 日期选择面板 | `date-panel` | 按需适配 | API/主题/示例 |
| 下拉时间 | `drop-times` | 按需适配 | API/主题/示例 |
| 文件上传 | `file-upload` | 按需适配 | API/主题/示例 |
| 富文本 | `fluent-editor` | 按需适配 | API/主题/示例 |
| 表单 | `form` | 按需适配 | API/主题/示例 |
| 输入框 | `input` | 按需适配 | API/主题/示例 |
| IP地址输入框 | `ip-address` | 按需适配 | API/主题/示例 |
| 数字输入框 | `numeric` | `selection.html` | API/主题/示例 |
| 标签输入框 | `tag-input` | `selection.html` | API/主题/示例 |
| 弹出编辑 | `popeditor` | 按需适配 | API/主题/示例 |
| 弹出上传 | `pop-upload` | 按需适配 | API/主题/示例 |
| 单选框 | `radio` | 按需适配 | API/主题/示例 |
| 评分 | `rate` | `selection.html` | API/主题/示例 |
| 搜索 | `search` | 按需适配 | API/主题/示例 |
| 综合搜索 | `search-box` | 按需适配 | API/示例 |
| 选择器 | `select` | 按需适配 | API/主题/示例 |
| 滑块 | `slider` | `selection.html` | API/主题/示例 |
| 滑动按钮组 | `slider-button` | 按需适配 | API/主题/示例 |
| 开关 | `switch` | 按需适配 | API/主题/示例 |
| 时间选择器 | `time-picker` | `selection.html` | API/主题/示例 |
| 时间选择 | `time-select` | 按需适配 | API/主题/示例 |
| 穿梭框 | `transfer` | `selection.html` | API/主题/示例 |
| 树形选择器 | `tree-select` | `selection.html` | API/示例 |
| 下拉表格选择器 | `grid-select` | `selection.html` | API/主题/示例 |
## 表格 (Table)

| 名称 | key | 原生配方 | 官方参考 |
|---|---|---|---|
| 基本用法 | `grid` | `table.html` | API/主题/示例 |
| 序号列 | `grid-serial-column` | 按需适配 | API/主题/示例 |
| 选中行 | `grid-operation-column` | `table.html` | API/主题/示例 |
| 空数据 | `grid-empty` | 按需适配 | API/主题/示例 |
| 数据源 | `grid-data-source` | 按需适配 | API/主题/示例 |
| 大数据 | `grid-large-data` | 按需适配 | API/主题/示例 |
| 分页 | `grid-pager` | 按需适配 | API/主题/示例 |
| 编辑 | `grid-edit` | `table.html` | API/主题/示例 |
| 编辑器 | `grid-editor` | 按需适配 | API/主题/示例 |
| 表格校验 | `grid-validation` | 按需适配 | API/主题/示例 |
| 工具栏 | `grid-toolbar` | 按需适配 | API/主题/示例 |
| 加载中 | `grid-loading` | 按需适配 | API/主题/示例 |
| 宽高尺寸 | `grid-size` | 按需适配 | API/主题/示例 |
| 外观设置 | `grid-appearance-settings` | 按需适配 | API/主题/示例 |
| 高亮 | `grid-highlight` | 按需适配 | API/主题/示例 |
| 提示 | `grid-tip` | 按需适配 | API/主题/示例 |
| 对齐方式 | `grid-align` | 按需适配 | API/主题/示例 |
| 表头 | `grid-header` | 按需适配 | API/主题/示例 |
| 表尾 | `grid-footer` | 按需适配 | API/主题/示例 |
| 自定义样式 | `grid-custom-style` | 按需适配 | API/主题/示例 |
| 排序 | `grid-sort` | `table.html` | API/主题/示例 |
| 筛选 | `grid-filter` | `table.html` | API/主题/示例 |
| 冻结 | `grid-fixed` | 按需适配 | API/主题/示例 |
| 合并 | `grid-span` | 按需适配 | API/主题/示例 |
| 分组 | `grid-row-grouping` | 按需适配 | API/主题/示例 |
| 拖拽 | `grid-drag` | 按需适配 | API/主题/示例 |
| 右键菜单 | `grid-context-menu` | 按需适配 | API/主题/示例 |
| 渲染器 | `grid-renderer` | 按需适配 | API/主题/示例 |
| 事件 | `grid-event` | 按需适配 | API/主题/示例 |
| 插槽 | `grid-slot` | 按需适配 | API/主题/示例 |
| 个性化 | `grid-custom` | 按需适配 | API/主题/示例 |
| 树表 | `grid-tree-table` | 按需适配 | API/主题/示例 |
| 展开行 | `grid-expand` | 按需适配 | API/主题/示例 |
| 导入导出 | `grid-import-export` | 按需适配 | API/主题/示例 |
| 鼠标和键盘配置 | `grid-mouse-keyboard` | 按需适配 | API/主题/示例 |
| 动态列及行列反转 | `grid-dynamically-columns` | 按需适配 | API/主题/示例 |
| 常见问题 | `grid-faq` | 按需适配 | API/主题/示例 |
## 数据展示 (Data Display)

| 名称 | key | 原生配方 | 官方参考 |
|---|---|---|---|
| 标记 | `badge` | `display.html` | API/主题/示例 |
| 日历 | `calendar` | `display.html` | API/主题/示例 |
| 日历视图 | `calendar-view` | 按需适配 | API/主题/示例 |
| 卡片 | `card` | `display.html` | API/主题/示例 |
| 走马灯 | `carousel` | `display.html` | API/主题/示例 |
| 折叠面板 | `collapse` | `display.html` | API/主题/示例 |
| 流程图 | `flowchart` | 按需适配 | API/示例 |
| 引导 | `guide` | 按需适配 | API/主题/示例 |
| 图片 | `image` | `display.html` | API/主题/示例 |
| 无限滚动 | `infinite-scroll` | 按需适配 | API/示例 |
| 里程碑 | `milestone` | 按需适配 | API/主题/示例 |
| 思维导图 | `mind-map` | 按需适配 | API/示例 |
| 二维码 | `qr-code` | 按需适配 | API/主题/示例 |
| 统计数值 | `statistic` | `display.html` | API/主题/示例 |
| 标签 | `tag` | 按需适配 | API/主题/示例 |
| 标签组 | `tag-group` | 按需适配 | API/主题/示例 |
| 时间线 | `time-line` | `display.html` | API/示例 |
| 树形控件 | `tree` | `display.html` | API/主题/示例 |
| 虚拟化树形控件 | `virtual-tree` | `display.html` | API/示例 |
| 用户头像 | `user-head` | `display.html` | API/主题/示例 |
| 流程图 | `wizard` | 按需适配 | API/主题/示例 |
| 数值动画 | `number-animation` | 按需适配 | API/主题/示例 |
## 反馈 (Feedback)

| 名称 | key | 原生配方 | 官方参考 |
|---|---|---|---|
| 警告 | `alert` | `feedback.html` | API/主题/示例 |
| 对话框 | `dialog-box` | `feedback.html` | API/主题/示例 |
| 抽屉 | `drawer` | `feedback.html` | API/主题/示例 |
| 异常页 | `exception` | `feedback.html` | API/主题/示例 |
| 加载 | `loading` | `feedback.html` | API/主题/示例 |
| 模态框 | `modal` | `feedback.html` | API/主题/示例 |
| 消息提示 | `message` | 按需适配 | API/示例 |
| 通知 | `notify` | `feedback.html` | API/主题/示例 |
| 气泡确认框 | `popconfirm` | `feedback.html` | API/主题/示例 |
| 进度条 | `progress` | `display.html` | API/主题/示例 |
| 气泡卡片 | `popover` | `feedback.html` | API/主题/示例 |
| 骨架屏 | `skeleton` | 按需适配 | API/主题/示例 |
| 文字提示 | `tooltip` | `feedback.html` | API/主题/示例 |
## 图表 (Chart)

| 名称 | key | 原生配方 | 官方参考 |
|---|---|---|---|
| 图表文档 | `chart-docs` | 按需适配 | API/示例 |
| 基本用法 | `chart` | 按需适配 | API/示例 |
| 事件监听 | `chart-events` | 按需适配 | API/示例 |
| 属性配置示例 | `chart-attributes-demo` | 按需适配 | API/示例 |
| 常见问题示例 | `chart-question` | 按需适配 | API/示例 |
| 折线图 | `chart-line` | 按需适配 | API/示例 |
| 柱状图 | `chart-histogram` | 按需适配 | API/示例 |
| 条形图 | `chart-bar` | 按需适配 | API/示例 |
| 饼图 | `chart-pie` | 按需适配 | API/示例 |
| 环图 | `chart-ring` | 按需适配 | API/示例 |
| 瀑布图 | `chart-waterfall` | 按需适配 | API/示例 |
| 漏斗图 | `chart-funnel` | 按需适配 | API/示例 |
| 雷达图 | `chart-radar` | 按需适配 | API/示例 |
| 地图 | `chart-map` | 按需适配 | API/示例 |
| 桑基图 | `chart-sankey` | 按需适配 | API/示例 |
| 热力图 | `chart-heatmap` | 按需适配 | API/示例 |
| 散点图 | `chart-scatter` | 按需适配 | API/示例 |
| K线图 | `chart-candle` | 按需适配 | API/示例 |
| 仪表盘 | `chart-gauge` | 按需适配 | API/示例 |
| 树图 | `chart-tree` | 按需适配 | API/示例 |
| 水球图 | `chart-liquidfill` | 按需适配 | API/示例 |
| 词云图 | `chart-wordcloud` | 按需适配 | API/示例 |
| 旭日图 | `chart-sunburst` | 按需适配 | API/示例 |
| 拓扑图 | `chart-graph` | 按需适配 | API/示例 |
| 箱形图 | `chart-boxplot` | 按需适配 | API/示例 |
| 进度图 | `chart-process` | 按需适配 | API/示例 |
## 其他 (Other)

| 名称 | key | 原生配方 | 官方参考 |
|---|---|---|---|
| 公告牌 | `bulletin-board` | 按需适配 | API/主题/示例 |
| 图片裁剪 | `crop` | 按需适配 | API/主题/示例 |
| 弹窗选择 | `dialog-select` | 按需适配 | API/主题/示例 |
| 过滤器面板 | `filter-panel` | 按需适配 | API/主题/示例 |
| 浮动块 | `floatbar` | 按需适配 | API/主题/示例 |
| 全屏 | `fullscreen` | 按需适配 | API/示例 |
| 文字滚动 | `scroll-text` | 按需适配 | API/主题/示例 |
| 面板分割 | `split` | `layout.html` | API/主题/示例 |
| 输入框 | `text-popup` | 按需适配 | API/主题/示例 |
| 联系人 | `user-contact` | 按需适配 | API/主题/示例 |
| 水印 | `watermark` | 按需适配 | API/示例 |
| 粘性布局 | `sticky` | `layout.html` | API/示例 |
## 自定义指令 (Custom Instruction)

| 名称 | key | 原生配方 | 官方参考 |
|---|---|---|---|
| 超出隐藏 | `directives-auto-tip` | 按需适配 | 目录项（快照无细项） |
| 高亮搜索字 | `directives-highlight-query` | 按需适配 | 目录项（快照无细项） |
## 补充组件与基础变量

| 名称 | key | 原生配方 | 官方参考 |
|---|---|---|---|
| action-sheet | `action-sheet` | 按需适配 | API |
| amount | `amount` | 按需适配 | API/主题/示例 |
| area | `area` | 按需适配 | API/主题/示例 |
| base | `base` | 按需适配 | 主题 |
| breadcrumb-item | `breadcrumb-item` | 按需适配 | 主题 |
| calendar-bar | `calendar-bar` | 按需适配 | API |
| card-container | `card-container` | 按需适配 | 主题 |
| card-template | `card-template` | 按需适配 | 主题 |
| carousel-item | `carousel-item` | 按需适配 | 主题 |
| cascader-menu | `cascader-menu` | 按需适配 | 主题 |
| cascader-mobile | `cascader-mobile` | 按需适配 | API |
| cascader-node | `cascader-node` | 按需适配 | 主题 |
| cascader-select | `cascader-select` | 按需适配 | API |
| cascader-view | `cascader-view` | 按需适配 | API |
| cell | `cell` | 按需适配 | API |
| chart-autonavi-map | `chart-autonavi-map` | 按需适配 | API/示例 |
| chart-baidu-map | `chart-baidu-map` | 按需适配 | API/示例 |
| chart-core | `chart-core` | 按需适配 | API/主题/示例 |
| chart-demo | `chart-demo` | 按需适配 | API/示例 |
| checkbox-button | `checkbox-button` | 按需适配 | 主题 |
| checkbox-group | `checkbox-group` | 按需适配 | 主题 |
| collapse-item | `collapse-item` | 按需适配 | 主题 |
| color | `color` | 按需适配 | API |
| column-list-item | `column-list-item` | 按需适配 | API |
| company | `company` | 按需适配 | API/主题/示例 |
| country | `country` | 按需适配 | API/主题/示例 |
| currency | `currency` | 按需适配 | API/主题/示例 |
| date-picker-mobile | `date-picker-mobile` | 按需适配 | API |
| date-range | `date-range` | 按需适配 | 主题 |
| date-table | `date-table` | 按需适配 | 主题 |
| dept | `dept` | 按需适配 | API/主题/示例 |
| directives | `directives` | 按需适配 | API/示例 |
| drop-roles | `drop-roles` | 按需适配 | API/示例 |
| dropdown-item | `dropdown-item` | 按需适配 | 主题 |
| dropdown-menu | `dropdown-menu` | 按需适配 | 主题 |
| espace | `espace` | 按需适配 | API/主题/示例 |
| fall-menu | `fall-menu` | 按需适配 | API/主题/示例 |
| filter | `filter` | 按需适配 | API |
| filter-bar | `filter-bar` | 按需适配 | API |
| filter-box | `filter-box` | 按需适配 | 主题 |
| float-button | `float-button` | 按需适配 | API/示例 |
| floating-button | `floating-button` | 按需适配 | API |
| font | `font` | 按需适配 | API |
| form-item | `form-item` | 按需适配 | 主题 |
| hrapprover | `hrapprover` | 按需适配 | API/主题/示例 |
| icon-multicolor | `icon-multicolor` | 按需适配 | API/示例 |
| image-viewer | `image-viewer` | 按需适配 | 主题 |
| link-menu | `link-menu` | 按需适配 | API/主题/示例 |
| load-list | `load-list` | 按需适配 | API |
| locales | `locales` | 按需适配 | API/主题/示例 |
| logon-user | `logon-user` | 按需适配 | API/示例 |
| logout | `logout` | 按需适配 | API/示例 |
| menu | `menu` | 按需适配 | API |
| month-range | `month-range` | 按需适配 | 主题 |
| month-table | `month-table` | 按需适配 | 主题 |
| option | `option` | 按需适配 | 主题 |
| option-group | `option-group` | 按需适配 | 主题 |
| picker | `picker` | 按需适配 | 主题 |
| pull-refresh | `pull-refresh` | 按需适配 | API |
| quarter-panel | `quarter-panel` | 按需适配 | 主题 |
| query-builder | `query-builder` | 按需适配 | API/示例 |
| radio-block | `radio-block` | 按需适配 | API |
| radio-button | `radio-button` | 按需适配 | 主题 |
| radio-group | `radio-group` | 按需适配 | 主题 |
| record | `record` | 按需适配 | API |
| rich-text-editor | `rich-text-editor` | 按需适配 | API/主题 |
| roles | `roles` | 按需适配 | API/主题/示例 |
| scrollbar | `scrollbar` | 按需适配 | API/主题 |
| select-dropdown | `select-dropdown` | 按需适配 | 主题 |
| select-mobile | `select-mobile` | 按需适配 | API |
| select-view | `select-view` | 按需适配 | API |
| select-wrapper | `select-wrapper` | 按需适配 | API/示例 |
| selected-box | `selected-box` | 按需适配 | API/主题 |
| signature | `signature` | 按需适配 | API |
| skeleton-item | `skeleton-item` | 按需适配 | 主题 |
| slide-img | `slide-img` | 按需适配 | 主题 |
| slider-button-group | `slider-button-group` | 按需适配 | 主题 |
| standard-list-item | `standard-list-item` | 按需适配 | API |
| tabbar | `tabbar` | 按需适配 | API |
| table | `table` | 按需适配 | 主题 |
| tall-storage | `tall-storage` | 按需适配 | 主题 |
| textarea | `textarea` | 按需适配 | 主题 |
| time-panel | `time-panel` | 按需适配 | 主题 |
| time-picker-mobile | `time-picker-mobile` | 按需适配 | API |
| time-range | `time-range` | 按需适配 | 主题 |
| time-spinner | `time-spinner` | 按需适配 | 主题 |
| toggle-menu | `toggle-menu` | 按需适配 | API/主题/示例 |
| top-box | `top-box` | 按需适配 | 主题 |
| upload | `upload` | 按需适配 | 主题 |
| upload-dragger | `upload-dragger` | 按需适配 | 主题 |
| upload-list | `upload-list` | 按需适配 | 主题 |
| user | `user` | 按需适配 | API/主题/示例 |
| user-account | `user-account` | 按需适配 | API/主题/示例 |
| user-card | `user-card` | 按需适配 | 主题 |
| user-link | `user-link` | 按需适配 | API/主题/示例 |
| vars.less | `vars.less` | 按需适配 | 目录项（快照无细项） |
| year-table | `year-table` | 按需适配 | 主题 |

## AI 辅助参考（TinyRobot）

AI 视觉采用用户补充的蓝紫渐变，以下条目按交互需求查阅，并通过原生 HTML/CSS/JavaScript 适配。

| 名称 | key | 参考 |
|---|---|---|
| 附件 | `ai-attachments` | 官方组件说明 |
| 消息气泡 | `ai-bubble` | 官方组件说明 |
| 会话容器 | `ai-container` | 官方组件说明 |
| 拖入文件遮罩 | `ai-drag-overlay` | 官方组件说明 |
| AI 动作菜单 | `ai-dropdown-menu` | 官方组件说明 |
| 结果反馈 | `ai-feedback` | 官方组件说明 |
| 会话历史 | `ai-history` | 官方组件说明 |
| MCP 配置表单 | `ai-mcp-add-form` | 官方组件说明 |
| 工具服务选择 | `ai-mcp-server-picker` | 官方组件说明 |
| 提示词建议 | `ai-prompts` | 官方组件说明 |
| 输入框兼容参考 | `ai-sender-compat` | 官方组件说明 |
| AI 输入 | `ai-sender` | 官方组件说明 |
| 快捷建议 | `ai-suggestion-pills` | 官方组件说明 |
| 建议弹层 | `ai-suggestion-popover` | 官方组件说明 |
| AI 主题 | `ai-theme` | 官方组件说明 |
| 欢迎页 | `ai-welcome` | 官方组件说明 |
