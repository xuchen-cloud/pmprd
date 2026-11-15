# 文件规范、交互说明与锚点

新增或更新标注、核对定位、迁移或排查格式问题时读本文件。命令流程见 [通用 CLI](cli.md)，修改范围、交付与检查点见 [修改与提交](dsh-task.md)。

## 唯一元数据与版本

```html
<!-- ux-document:start -->
<script type="application/json" id="ux-document">
{ "format": "ux-review-document", "schemaVersion": 1 }
</script>
<!-- ux-document:end -->
```

示例仅显示身份字段，完整文档由工具创建。JSON 中 `<` 被转义，元数据块只出现一次；解析拒绝重复真实块及不支持的 schema，保留未知扩展字段。

| 字段 | 含义 |
| --- | --- |
| `id`、`title`、`createdAt`、`updatedAt` | 稳定文档身份及带时区时间 |
| `uxVersion` | 正整数，业务源码改变时递增；仅增加／修改稳定 `data-ux-anchor` 属性或协作内容不递增 |
| `revision` | 已保存修订的连续序号；初始系统记录为 r1，人工编辑及 AI 交付按实际记录递增 |
| `agentCheckpoint` | 最近一次 AI 交付修订，不代表其他修改意见已完成 |
| `prd` | 唯一 Markdown 正文，可为空 |
| `design` | 设计依据；导入默认 `{ "id": "existing" }`，新建 OpenTiny 稿显式指定 `opentiny` |
| `annotations` | 以稳定 `ann-*` ID 索引的两类标注 |
| `changes` | 连续追加的人工、AI 与系统记录 |
| `preferences.clearResolvedAfterAgent` | 默认清理偏好，执行以本轮明确设置为准 |

交互说明、PRD、标题等协作变化会形成新 revision，但不因此增加 UX 版本。原业务 HTML 的视觉、文案或逻辑改变属于业务变化。不得为了显示新版本而手改任一计数。

## 交互说明的内容标准

`kind: 'explanation'` 可补充产品逻辑、业务规则、功能解释、交互细节和评审理解所需背景。一条标注表达一个独立要点，通常 1–3 句便于阅读；这是建议，不是句数或标注数量配额。

描述已实现交互时，先核对源码及必要的运行状态，再写“**触发 → 行为 → 反馈／例外**”；紧密相关的成功与失败反馈可放在一起。业务规则、约束或尚未实现的意图需明确标为“业务规则”“待实现”等，不将意图冒充当前实现。避免复述按钮名称或堆叠整页需求。

例如：点击“提交”时先校验必填项；无效时保留输入并定位首个错误，全部通过后显示提交结果。只有源码确实执行这些行为时才这样写。PRD 要求与代码不符时明确写“当前……；PRD 要求……，尚未实现”，并在交付中说明差异；仅补充说明不授权顺手实现需求。

## PRD 中的标注引用

在需要补充产品、业务、功能或交互说明的需求段落下，按需插入顶层独立一行的 `@annotation(ann-ID)`。连续多行可引用多条；同一标注也可在不同段落引用。不要求为所有需求或标注逐一挂载，代码块、列表或引用块中的同形文本不作为引用。例如：

```markdown
保存名称时校验必填；校验未通过时保留输入。

@annotation(ann-save-validation)
@annotation(ann-name-business-rule)
```

引用只保存稳定标注 ID，不复制正文；仅支持 `kind: 'explanation'` 的补充说明，不可引用修改意见。展示时读取当前说明的最新完整内容，默认折叠，展开后可阅读完整 Markdown 并定位 UX 目标；只有实际被 PRD 有效引用的 UX 说明才显示回链，多处引用按文档顺序区分。

人工与 AI 使用同一引用格式。AI 修改已有稿时按需读取相关段落，通过 `finish` 的 `prdOps` 提交获准的局部变更，保留其余 PRD 文字与引用；`annotate` 不改 PRD，提交遵守本轮 PRD 权限。后续更新说明沿用原标注 ID，仅在本轮确需调整关联时读取和修改对应引用，不要求每次修改检查全篇引用。标注被删除后保留“标注已删除”占位；已有或手写的修改意见引用显示“仅支持引用说明”，不视为有效补充说明，也不扩大 AI 执行范围。发现失效引用时报告需移除或替换，不悄悄删改用户 PRD；移除或替换属于独立的 PRD 编辑，PRD 只读时报告失效关联即可。

## 标注结构

```json
{
  "id": "ann-save-validation",
  "kind": "explanation",
  "body": "点击提交时校验必填项；无效时保留输入并定位首个错误。",
  "createdBy": { "kind": "agent", "name": "AI" },
  "updatedBy": { "kind": "agent", "name": "AI" },
  "createdAt": "2026-11-14T12:00:00.000Z",
  "updatedAt": "2026-11-14T12:00:00.000Z",
  "anchor": {
    "kind": "element",
    "id": "save-button",
    "selector": "[data-ux-anchor=\"save-button\"]",
    "tag": "button",
    "text": "提交"
  }
}
```

`kind` 只有 `explanation`（交互说明）或 `change-request`（修改意见）。修改意见另有 `assignee: {kind: 'unassigned' | 'human' | 'agent', name?}`、`status: 'open' | 'resolved'`，完成后有 `resolution`；说明不得携带这三个活动字段。创建者及创建时间不会因后续编辑而覆盖，`updatedBy` 随实际编辑者变化。

已有规范文档的旧标注缺少类型时保留为受保护的说明，附 `needsTypeConfirmation` 和完整 `legacy.unclassifiedAnnotation`。确认类型前不纳入 AI 操作，不能从作者、措辞或位置猜测其类型。非规范旧格式的迁移范围以导入报告为准。

## 静态与动态锚点

- **静态控件：**优先复用唯一的 `data-ux-anchor`；缺少时给对应开始标签添加稳定值，`anchor.id` 与属性一致，selector 精确指向该元素。ID 不随本轮文案或排序变化；禁止重复。
- **动态控件：**目标仅在某运行状态出现时，在该状态核对；必要时绑定稳定的静态容器，并在正文写清具体控件、触发与状态。不要伪造静态元素或把动态列表的易变序号当稳定身份。`annotate` 只处理可在静态源码唯一定位的目标；动态元素可改选稳定容器，或通过 `apply` 提供经运行验证的锚点。
- **区域说明：**使用 `kind: 'region'`，selector 指向参考容器，`region: {x,y,width,height}` 是容器内 0～1 的归一化值，宽高大于零。可保存 `viewport` 等定位提示；在实际容器尺寸与状态下验证。

`tag`／`text` 是可选的运行时定位身份校验提示，不是静态校验的保证。`annotate` 自动生成的锚点包含 `kind`、唯一 `id` 和 `selector`，无需为补全字段而再改一次。稳定 ID 定位有效时，不必顺带更新 `anchor.text`；实际依赖文字回退定位或控件标签改变时才维护相关提示。仅在本轮新增、改绑、修复定位或目标身份存在疑问时核对定位。找不到目标时保留内容并报告未定位，不能悄悄指向相似控件。

提交工具对源码中重复的稳定锚点报错。**静态未找到 `anchor.id` 或没有 `anchor.id` 不等于运行时定位有效**；本轮涉及新增、改绑或修复这些定位时，在相应状态核对。格式检查不会替你证明动态目标、`tag` 或 `text` 与实际页面一致，也不要求每轮重验未改变的定位。

## 跨页面与弹窗定位

原型可提供 `window.__UX_REVIEW_NAVIGATION__` 对象，让标注列表恢复目标所在状态后再定位：

- `capture(element)` 同步返回小型 JSON 对象 `{key: '稳定视图键', label: '可读名称', ...}`，预览创建人工标注时自动保存为 `anchor.view`；无上下文时返回 `null`。仅记录必要的页面、实体标识和弹窗状态，不采集输入草稿、密钥或整份业务数据；总 JSON 长度不超过 32 KiB，`key` 必须是非空字符串。
- `reveal(view, anchor, {signal})` 通过原型自己的导航和初始化逻辑恢复页面或弹窗，可同步或返回 Promise；完成初始化后再 resolve，返回 `false` 表示当前拒绝切换。它只恢复查看状态，禁止保存、删除、提交或发起业务请求，不得自动关闭带草稿的弹窗。异步实现应在应用状态前检查 `signal.aborted`；新定位或 2.5 秒超时会 abort，旧请求不再滚动、高亮或报告结果。原有两参数实现仍兼容，但无法协作取消其自身异步副作用。

AI 编写说明时可通过 `finish` 的 `annotationUpdates[].anchor.view` 提供相同 JSON 上下文；`annotate` 的简短 notes 接口仍只负责静态目标定位。新增或修改页面恢复行为时，切换到其他页面或关闭目标弹窗后点击标注，确认它恢复正确状态、保留草稿，并唯一定位真实目标。不要把导航代码或待执行字符串写入 `anchor.view`。

没有 hook 的旧稿仅自动展开目标祖先 `<details>`，或激活通过 `role="tab"` 和 `aria-controls` 明确关联祖先面板的标签页；标签页需以 `aria-selected` 反映选中状态。人工标注会按外到内记录选中状态，例如 `anchor.tabs: [{selector: '#details-tab', panelSelector: '#details-panel'}]`。共享同一面板的多个 tab 即使面板已显示，也先恢复记录的 tab；选择器必须唯一且关联关系仍有效。预览不按按钮文案猜点击，不强改 `hidden`/`display`，不直接调用 `showModal()` 绕过初始化，也不自动关闭当前弹窗。无法恢复时保留标注，并返回 `located` 的 `found`、`visible` 与中文 `reason` 提示；可见目标会在布局稳定并滚动后测量。

## 历史与阅读导出

当前完整 PRD 保存在文档的 `prd` 字段，供打开、编辑和独立导出使用。初始 `kind: 'created'` 记录保留一份初始内容快照，阅读时派生 diff。后续人工与 AI 的 PRD 修改在 `patch` 中使用可还原的行差异：只保存修改位置、删除行和新增行，不再保存整篇 `before`／`value`，也不重复存 `diff.prd`；界面的 diff 由该 patch 派生。每轮增量随实际修改量增长，不随 PRD 全文长度重复增长。

已有全文 patch 和旧 `diff.prd` 继续可读，既有记录原样保留，不在普通保存或交付时重写旧历史。摘要、详情、编辑来源及版本关联仍保留；AI 交付只追加本轮记录并推进检查点。`prdOps` 是本轮编辑输入，历史 patch 由工具根据实际前后内容生成，不能把阅读片段或手写历史当作写回数据。

完整评审导出只有一份规范元数据。业务源码存于 `script[type=application/json]#ux-prototype-source`，值是经过 `<` 转义的 HTML JSON 字符串，内部不含第二份协作元数据。阅读器的样式、脚本与 SVG 不是业务原型的修改对象；程序提供的工作文件已经提取业务源码，`finish` 将其与保留的协作内容一起封装。独立底层调用仍可使用 `extract`／`apply`。
