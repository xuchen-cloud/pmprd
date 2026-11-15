# 通用 CLI：新建、补充说明与修改交付

需要 Node.js 22+，不依赖 DSH 进程或专用工具；以下 `/abs/ux-prototype` 替换为本 skill 的绝对路径，其他 `/abs/...` 替换为实际文件路径，含空格路径加引号。`finish` 按已保存的选项交付到当前文件或新文件；新建、导入及底层 `apply` 的输出独占创建，不覆盖输入或已有文件。

## 新建协作稿

先按用户设计依据制作业务 HTML；默认设计见 [opentiny-ux](../../opentiny-ux/SKILL.md)。用实际需求编写 Markdown PRD，再封装：

```sh
node /abs/ux-prototype/scripts/uxdoc.mjs init /abs/business.html --prd /abs/prd.md --title '产品详情' --version 1 --design opentiny --output /abs/product.ux.html
```

`--prd`、`--title`、`--version`、`--design` 均可选。PRD 缺省使用可迁移的旧 PRD，否则为空；标题、版本使用可读取的输入信息或工具默认值。`init` 面向普通／旧版 HTML，已有规范元数据时改用 `apply` 或 `annotate`。导入默认设计为 `existing`；新建 OpenTiny 稿显式传 `--design opentiny`，其他设计用对应 ID。

按下面的 `annotate` 补充关键交互说明；交付最终新文件，初始中间稿无需让用户选择。验收本轮页面和实际交互，说明当前 PRD 与实现的已知差异。`init` 成功后 stdout 输出文件路径，stderr 中以“导入报告”为前缀输出 report JSON；该报告不表示命令失败。

## 只补充或更新交互说明

普通 HTML 与已有协作稿均可直接使用 `annotate`。它自动导入、添加稳定锚点、生成 `ann-*` ID 与变更摘要；只在原文对应标签局部注入锚点，不重排业务 DOM 或改写业务设计。已有稿保留身份与历史。首次导入还须按 [导入现有稿](import-existing.md) 做前后核对。

写 `/abs/notes.json`，顶层是数组，selector 换成页面中的真实目标：

```json
[
  {"selector":"#save-button","body":"点击保存后显示成功提示，当前筛选条件保持不变。"},
  {"selector":"#filter-panel","body":"切换筛选项后刷新列表；没有结果时显示空状态。"}
]
```

新增时可省略 `id` 由工具生成，或指定未使用的合法 `ann-*` ID；更新时用 `read --kind explanations --search '目标规则'` 查已有说明 ID，再在对应项增加 `"id":"ann-existing-rule"`。已有 ID 必须属于已确认类型的交互说明。省略 `kind` 即为交互说明；若提供，值只能是 `explanation`。先按 [说明与锚点标准](file-format.md) 核对真实行为。

```sh
node /abs/ux-prototype/scripts/uxdoc.mjs annotate /abs/input.html --annotations /abs/notes.json --output /abs/annotated.ux.html
```

可选 `--summary '补充筛选说明' --details '["记录当前筛选行为"]' --actor 'AI'`；`--details` 接受 JSON 字符串数组，不是文件路径。默认由工具生成本轮摘要与详情。同一目标、相同正文在省略 ID 或沿用同一 ID 时不增加历史；同一目标、不同正文且未指定 ID 时新增独立说明。显式指定不同的新 ID 表示不同标注身份，即使正文相同也会新增。**更新既有说明必须提供其 ID**，不能靠相同 selector 推测覆盖对象。完全无变化时仍输出新文件，内容、revision 与历史保持不变。

selector 在静态 HTML5 DOM 上匹配，支持 ID、class、属性、组合器及结构伪类（如 `:nth-child`、`:not`、`:is`、`:has`），必须唯一命中。不依赖浏览器交互状态伪类。脚本字符串、注释中的伪标签不算目标；`template` 及其惰性内容、没有源码位置的隐式容器（如浏览器自动补出的 `tbody`）不能直接注入。换用源码中真实、稳定的容器，或通过 `apply` 维护经运行验证的动态锚点。

`annotate` 不处理修改意见、完成状态或 PRD 改写；已有修改提示词时，这些变化随 `finish` 提交。stdout 为 JSON，包含 `outputPath`、`documentId`、`revision`、`uxVersion`、`imported`、`unchanged`、`addedIds`、`updatedIds`、`unchangedIds` 与 `report`。`report` 包含 `sourceFormat`、`migrated`、`removed`、`unmigrated`、`notes`，用于说明导入保留与迁移情况，不能代替业务验收。

## 已有协作稿的局部修改

提示词给出工作文件时，按意见和目标信息直接编辑；缺少依据时再补读相关内容。DSH 与外部 Agent 使用同一入口，见 [修改与提交](dsh-task.md)。所有类型的修改都在完成后提交一次：

```sh
node /abs/ux-prototype/scripts/uxdoc.mjs finish /abs/work.business.html --summary "调整规则保存与失败反馈"
```

工作文件必须来自程序准备，使用提示词中的实际路径。`finish` 自动找到内部输入基线、范围和保存选项，不需要 Agent 读取或传递任务清单。它生成历史与候选，默认保留备份后更新原文件；“生成新版本文件”开启时另存。stdout 中 `outputPath` 是最终交付位置，`candidatePath` 是候选位置，`delivery` 区分 `updated-current`、`new-version` 和 `conflict`。遇到冲突时保留候选，不覆盖原文件；不要把冲突报告为已写回。

默认完成本轮全部所选意见。部分完成时显式传 `--resolve ann-a,ann-b`，没有完成意见则传 `--resolve none`。`--summary` 必须非空；`details` 未提供时由程序使用摘要。需要 PRD、说明等结构化修改时，选择一种输入：`--changes-json JSON`、`--changes -`（stdin）或 `--changes FILE`。只提供实际变化，字段见下方契约。普通业务源码修改无需中间 JSON。

重复提交同一完成结果不会重复追加历史；已结束的外部修改不能继续交付，需在工作台重新发起。命令失败时依错误补充所需信息，不重复整个准备流程。

## 未准备工作文件的底层调用

没有程序生成的工作文件时，仍可独立使用旧的提取与封装接口。它适合直接维护协作文件或兼容既有工具，不是收到修改提示词后的必经流程：

```sh
node /abs/ux-prototype/scripts/uxdoc.mjs extract /abs/input.ux.html --output /abs/business.html
```

按授权范围定位 BUSINESS，读取相关片段并定点修改。PRD、其他说明、历史和设计资料按需读取，不先运行输出全量内容的 `review`／`inspect`。只改协作内容时业务文件保持不变；也可直接把原始 INPUT 作为 MODIFIED。若 MODIFIED 包含协作元数据，必须与 INPUT 的解析结果完全相同，所有协作变更放入 CHANGES。

```sh
node /abs/ux-prototype/scripts/uxdoc.mjs apply /abs/input.ux.html /abs/business.html --changes /abs/changes.json --output /abs/revised.ux.html
```

无 task 时 `selectedIds` 可省略或为 `[]`，例如仅改说明、PRD 或执行用户直接要求的业务修改；要完成已有修改意见时，明确选择其 ID，`resolvedIds` 必须是其子集。未指定 `clearResolved` 时默认 false。检查针对实际改动和未确定的影响，不执行每轮固定清单；工具完成的格式与保存检查不再由 AI 重复执行。

## 按需读取

`read` 只输出指定材料，不写文件。`prd`、`source` 用明确搜索词或行范围；`explanations` 用 ID、稳定锚点、选择器或搜索词；`prd-diff` 读取检查点后的人工 PRD 差异。传入准备好的工作文件时自动恢复内部基线：`source` 查询当前工作源码，其他材料查询输入基线，受本轮权限约束。也可直接读取规范 HTML；旧 `--task` 参数保留兼容，不是工作文件读取的必填项。

```sh
node /abs/ux-prototype/scripts/uxdoc.mjs read /abs/input.ux.html --kind prd --search '保存名称'
node /abs/ux-prototype/scripts/uxdoc.mjs read /abs/input.ux.html --kind source --start-line 120 --end-line 150
node /abs/ux-prototype/scripts/uxdoc.mjs read /abs/input.ux.html --kind explanations --ids ann-save-rule
```

`--search` 按原文查找，不把它当正则；`--start-line`／`--end-line` 使用从 1 开始的行号，每次最多 80 行。说明可用 `--ids ann-a,ann-b`、`--anchor-id ID`、`--selector CSS` 或 `--search TEXT` 中的一种筛选。搜索结果用 `--offset`／`--limit` 分页；按返回的范围和截断信息继续取需要的片段，避免重新请求整篇正文。完整参数以 `read --help` 为准。

## changes JSON 契约

`finish` 的可选结构化输入与底层 `apply --changes` 都读取 JSON **对象**。`finish` 通常已由 `--summary` 给出摘要，`details` 默认沿用摘要；底层 `apply` 则要求非空 `summary` 和至少含一项非空字符串的 `details`。只提供本轮涉及的其他字段：

```json
{
  "summary": "补充提交校验说明",
  "details": ["记录提交前必填校验及失败反馈"],
  "selectedIds": [],
  "annotationUpdates": [
    {
      "id": "ann-submit-validation",
      "kind": "explanation",
      "body": "点击提交时校验必填项；无效时保留输入并定位首个错误。",
      "anchor": {
        "kind": "element",
        "id": "submit",
        "selector": "[data-ux-anchor=\"submit\"]",
        "tag": "button",
        "text": "提交"
      }
    }
  ]
}
```

示例要求工作源码中存在唯一的 `data-ux-anchor="submit"`；`finish`／`apply` 不像 `annotate` 那样自动选控件或生成新说明 ID。新增说明必须提供合法、未使用的 `ann-*` ID、`kind`、非空 `body` 和 `anchor`。更新已有说明只需 ID 及变化字段，保留创建者与创建时间。ID 格式为 `ann-` 加英文字母、数字、下划线或连字符，本轮不能重复。

| 输入字段 | 用法 |
| --- | --- |
| `summary`、`details` | 摘要为非空字符串，详情为非空字符串数组；`finish` 可从 `--summary` 生成二者，底层 `apply` 都必填 |
| `prdOps` | 本轮获准的 PRD 局部替换数组，格式为 `[{"find":"唯一原文","replace":"新文"}]`；无需改 PRD 时省略 |
| `title` | 本轮获准更新的标题字符串；不需要变化时省略 |
| `prd` | 仅兼容无 task 的旧调用；已有稿修改使用 `prdOps`，任务模式不接受整篇 PRD |
| `annotationUpdates` | 新增或更新标注；未选修改意见和未分类旧标注不可改写 |
| `selectedIds`、`resolvedIds` | 本轮选择和实际完成的修改意见 ID；完成集合必须在选择范围内；`finish` 自动读取选择范围，完成集合默认全部所选或由 `--resolve` 指定 |
| `clearResolved` | `finish` 沿用用户发起时的清理选项；底层调用仅在明确授权时设 true |
| `actorName` | 记录本轮 AI 编辑者名称，默认 `AI` |
| `removeAnnotationIds` | 兼容字段，只允许本轮已完成且获准清理的修改意见；不用于任意删除说明 |

`finish` 用 `--summary`、`--resolve` 和可选结构化输入提交；范围、清理及 PRD 权限由程序保存，不能在提交时扩大。跨 shell 传递较长 JSON 时可从 stdin 读取，避免引号破坏内容，无需固定增加一个中间文件。

底层 `apply` 另支持 `--summary TEXT`、`--details JSON`、`--select ann-a,ann-b`、`--resolve ann-a`、`--actor NAME` 覆盖对应输入；`--clear-resolved` 与 `--keep-resolved` 二选一。旧 task 模式保留原有范围约束。

`prdOps` 基于原 PRD 按数组顺序应用，每个 `find` 必须在该步正文中精确命中一次；零匹配或多匹配整批失败，不写出部分结果。`find` 通常非空，仅当前 PRD 为空时允许 `find: ""` 写入首段内容。需要删除文字时 `replace` 可为空；需要插入内容时，以已有唯一片段为 `find`，将原片段与新增内容一起放入 `replace`。不同时提供 `prd` 和 `prdOps`。例如：

```json
{
  "summary": "更新入驻场景名称",
  "details": ["同步受影响的需求句子"],
  "prdOps": [{"find":"选择商家入驻后填写资料。","replace":"选择商家入驻申请后填写资料。"}]
}
```

只提交确实受影响的片段，不重新生成整篇 PRD。工具维护完整当前正文，并将实际变化生成为可还原的增量历史。

## 底层 apply 的输入、历史与 result 字段对应

| 本轮输入 | 写入历史 | result 回执 |
| --- | --- | --- |
| `summary`、`details` | 同名字段 | `summary`，不含 `details` |
| `selectedIds` | `selectedAnnotationIds` | 不含选择集合 |
| `resolvedIds` | `resolvedIds` 与 `resolvedAnnotationIds` | `resolvedIds` |
| `clearResolved` 与完成集合 | `clearedAnnotationIds`，必要时保存 `resolvedSnapshots` | 无同名字段 |
| `annotationUpdates`、`prdOps`、`title` | `patch` 中对应路径；新 PRD patch 只存修改行及位置，不重复保存全文前后版本或 `diff.prd` | 无正文，实际内容读取输出 HTML |
| `actorName` | `author.name`，`actor: 'agent'` | 无编辑者字段 |
| 原文档 `revision`、task `id` | `baseRevision`／`basedOnRevision`、`taskId` | `baseRevision`、`taskId`；无 task 时后者为 null |
| 工具计算 | 当前 `revision`、`uxVersion` 与业务差异 | `documentId`、`revision`、`uxVersion`、`outputPath` |

`apply` 在 stdout 输出 `format: 'ux-review-result'`、`schemaVersion: 1` 的 JSON；`--result /abs/result.json` 可另存。回执提供交付路径、版本及处理结果，不输出哈希；内部一致性与覆盖冲突检查由程序自动完成。回执不能代替 HTML 产物。

## 其他命令

| 命令 | 用途 |
| --- | --- |
| `finish WORKFILE --summary TEXT` | 通用修改提交；自动记录差异与处理意见，并按选项写回或另存 |
| `read INPUT --kind ...` | 按需搜索或读取 PRD、业务源码、指定说明或人工 PRD diff |
| `review INPUT` | 全量阅读视图，仅在确需整体评审时使用，不是局部修改的默认入口 |
| `inspect INPUT` | 输出完整当前规范元数据，排查时使用 |
| `validate INPUT` | 检查唯一元数据、类型、历史连续性、导出源码结构与稳定锚点 |
| `extract INPUT` | 不提供 `--output` 时将业务 HTML 输出到 stdout |
| `prepare INPUT --task TASK --output BUSINESS --context CONTEXT` | 旧集成的底层准备接口；新提示词已附工作文件，无需重复执行 |
| `--help` 或 `COMMAND --help` | 查看命令参数与示例 |
