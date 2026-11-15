const outputRule = '输出使用独占创建，不能覆盖原稿、修改稿或已有文件；含空格的路径请加引号。';
const applyFields = `changes JSON：
  必填 summary：非空字符串；details：至少一条非空字符串的数组。
  可选 prdOps、title、annotationUpdates、selectedIds、resolvedIds、clearResolved、actorName。
  prdOps:[{"find":"原文片段","replace":"新文片段"}] 按顺序唯一匹配，任一步失败都不输出。
  find 为空仅用于当前 PRD 为空时首次添加；删除用 replace:""。
  无 task 的旧流程仍兼容 prd 全文；不能和 prdOps 同时提供。
  仅更新 PRD／交互说明可省略 selectedIds、resolvedIds。
  处理修改意见时 selectedIds 指明范围，resolvedIds 只能是其子集。
  新 annotationUpdates 需要合法且唯一的 ann-* id、kind、body、anchor；已有说明按 id 更新。
  作者和时间由工具维护；交互说明不能标记解决或自动清理。
  selectedAnnotationIds／resolvedAnnotationIds 是历史字段，不是 changes 输入字段。`;

const help = {
  finish: `用法：node uxdoc.mjs finish WORKFILE --summary TEXT [选项]
修改说明中指定的工作 HTML 编辑完成后，一次记录 diff、更新标注并交付文件。
程序自行查找内部会话、保留修改前备份、计算版本、生成候选并保存；无需读取任务清单。
  --summary TEXT       本轮变更摘要，必填（也可在 JSON 中提供）
  --resolve ID,ID      实际完成的意见；省略表示所选意见全部完成，none 表示均未完成（也兼容空字符串）
  --details JSON       可选，具体改动数组；省略时直接使用 summary
  --changes-json JSON  可选，prdOps、annotationUpdates 等协作修改，直接提交 JSON
  --changes -          从标准输入接收同一 JSON；也兼容 --changes FILE
  --actor NAME         可选，编辑者名称
PRD 只在确需调整时提供 prdOps；不得提交整篇 prd，权限沿用本轮选择。
默认更新当前文档；发起修改时勾选“生成新版本”则另存。清理选项同样沿用发起时设置。
重复提交相同内容不会重复记录；文档已被其他人修改时保留候选，delivery=conflict，不覆盖。
成功输出 outputPath（实际交付路径）、candidatePath、delivery、revision、uxVersion、resolvedIds。
交付完成即结束，不需要再调用 DSH complete。取消或被新一轮替代的修改不能写回。
示例：node uxdoc.mjs finish "/workspace/.ux-review-ID.business.html" --summary "调整规则配置流程"
示例：node uxdoc.mjs finish WORKFILE --summary "同步保存需求" --changes-json '{"prdOps":[{"find":"保存草稿","replace":"保存并继续"}]}'
含空格的路径请加引号。`,
  init: `用法：node uxdoc.mjs init INPUT --output NEW.html [选项]
导入普通 HTML、ux-requirements 或 __PRD_OFFLINE__ 旧稿，保留业务页面。
  --prd PRD.md       用文件内容替换导入的 PRD；不指定则使用可迁移的旧 PRD
  --title TITLE      覆盖文档标题
  --version N        初始 UX 版本，必须为正整数
  --design ID        设计依据；导入默认 existing，新建 OpenTiny 页面可指定 opentiny
  --output NEW.html  必填，新的规范协作 HTML
成功时 stdout 输出文件路径；stderr 的“导入报告”列出迁移、移除及未迁移内容。
已有规范元数据请使用 annotate 或 apply，不重复 init。
示例：node uxdoc.mjs init "已有交互稿.html" --output "已有交互稿.ux.html"
示例：node uxdoc.mjs init business.html --prd prd.md --design opentiny --output product.ux.html
${outputRule}`,
  annotate: `用法：node uxdoc.mjs annotate INPUT --annotations NOTES.json --output NEW.html [选项]
为已有页面添加交互说明；普通／旧稿会在内存中完成导入，无需 extract 或 changes 中间文件。
  --annotations FILE  必填，JSON 数组：[{"selector":"#save","body":"校验通过后保存。"}]
  --output NEW.html   必填，最终新文件
  --summary TEXT      可选，本轮摘要；默认自动生成
  --details JSON      可选，非空字符串数组，例如 '["补充保存流程说明"]'
  --actor NAME        可选，AI 编辑者显示名称
每项支持 selector、body、可选 id 和 kind:"explanation"；合法的新 ann-* ID 可新增，已有 ID 明确更新对应交互说明。
selector 必须唯一匹配可写入源码的静态元素；0 个／多个、动态元素或不支持的选择器会报错。
复用稳定锚点或自动生成，自动生成 ann-* ID，只局部注入属性，不重排业务 HTML。
同一元素＋同一正文重复提交不新增记录；不同正文且未指定 id 时新增独立说明。
无变化时仍写出内容相同的新文件，unchanged=true，修订和历史不变。
成功返回 JSON：outputPath、documentId、revision、uxVersion、imported、unchanged、
addedIds、updatedIds、unchangedIds、report（导入报告）。
示例：node uxdoc.mjs annotate "已有交互稿.html" --annotations notes.json --output review.ux.html
${outputRule}`,
  apply: `用法：node uxdoc.mjs apply INPUT MODIFIED --changes CHANGES.json --output NEW.html
任务模式：node uxdoc.mjs apply INPUT MODIFIED --task TASK.json --changes CHANGES.json [--result RESULT.json]
MODIFIED 为修改后的纯业务 HTML；若携带元数据，必须与 INPUT 完全一致。
${applyFields}
选项：
  --changes FILE      本轮协作修改 JSON（也可用下列摘要选项提供最小变更）
  --summary TEXT      覆盖 summary
  --details JSON      覆盖 details，例如 '["将保存改为提交"]'
  --select ID,ID      无 task 时选择本轮修改意见
  --resolve ID,ID     记录已完成的意见，必须位于所选范围内
  --clear-resolved    清理本轮已完成意见；默认保留
  --keep-resolved     明确保留已完成意见，不能与 --clear-resolved 同用
  --actor NAME        AI 编辑者显示名称
  --task FILE         校验任务身份、原稿指纹及范围；输出路径和清理设置以 task 为准
  --output FILE       无 task 时必填；有 task 时必须与约定路径相同
  --result FILE       可选，另存 JSON 回执；不能覆盖其他输入输出
task 未允许 PRD 变更时不可提供 prdOps；有权限也仅提交局部 prdOps，不接受整篇 prd。
不能扩大 selectedIds 或改变清理设置。历史仅保存 PRD 修改行，不重复保存全文前后版本。
示例 changes：{"summary":"补充保存说明","details":["记录已实现的保存行为"],"annotationUpdates":[{"id":"ann-save-rule","kind":"explanation","body":"点击后显示已保存。","anchor":{"kind":"element","selector":"#save"}}]}
成功返回包含 revision、uxVersion、resolvedIds、outputPath 的 JSON 回执。
${outputRule}`,
  prepare: `用法：node uxdoc.mjs prepare INPUT --task TASK.json --output BUSINESS.html --context CONTEXT.json
校验任务后一次生成纯业务源码和任务上下文。仅用于 DSH task；已有准备产物直接使用。
上下文仅包含选中意见及目标元素/局部源码；PRD、说明与历史使用 read 按需读取。
--task、--output、--context 均必填；三个选项之外的参数不接受。
两份输出必须不同，不能覆盖输入、任务或最终候选路径；任一失败均不保留半份结果。
成功返回 businessPath、contextPath 及选定意见数量。
${outputRule}`,
  read: `用法：node uxdoc.mjs read INPUT --kind KIND [--task TASK.json] [范围选项]
按需读取 PRD、源码、说明或待处理的 PRD diff；不默认输出全文。
INPUT 可以直接使用修改说明中的 WORKFILE：源码读取当前工作稿，PRD／说明／差异读取本轮基线。
工作稿自动关联内部会话，不需要提供 --task 或先读任务清单。
  --kind prd|source|explanations|prd-diff  必填
  --search TEXT                 按字面文本搜索相关片段
  --start-line N --end-line N    读取 1 起始的闭区间，最多 80 行
  --ids ann-a,ann-b              explanations 按指定说明 ID 读取
  --anchor-id ID / --selector S  explanations 按目标读取
  --offset N --limit N           显式分页；详见返回的分页信息
  --task FILE                   绑定 DSH 任务基线与范围；离线使用可省略
prd/source 必须指定 search 或行范围；explanations 必须指定 ID、目标或 search。
prd-diff 是显式请求，不返回 PRD 全文；task 未包含 PRD 修改时不可读取待处理 PRD diff。
只返回已确认说明，说明不扩大可执行的修改意见范围。文本已截断时继续按所需范围读取。
示例：node uxdoc.mjs read input.ux.html --kind prd --search '商家入驻'
示例：node uxdoc.mjs read input.ux.html --kind explanations --ids ann-submit-rule
只读，不产生文件。`,
  extract: `用法：node uxdoc.mjs extract INPUT [--output BUSINESS.html]
从规范协作文档或完整评审导出中提取业务 HTML，去除协作元数据／阅读器外壳。
不指定 --output 时直接输出业务 HTML；指定时创建新的文件。
原稿不变；修改业务副本后用 apply 封装，并保留原稿元数据。
${outputRule}`,
  inspect: '用法：node uxdoc.mjs inspect INPUT\n输出完整规范元数据 JSON；仅排查格式时使用，局部修改优先 read 或 DSH context。\n只读，不产生文件。',
  review: '用法：node uxdoc.mjs review INPUT\n输出当前 PRD、交互说明、修改意见、未分类旧标注与检查点后的人工 diff。\n只读，不产生文件；这是阅读视图，不能作为完整元数据写回。',
  validate: `用法：node uxdoc.mjs validate INPUT
检查唯一元数据、类型、连续历史和业务源码结构；重复稳定锚点报错。
结果 anchors.missing 为静态未找到的 ID；anchors.unverified 为没有 anchor.id 的标注。
未静态核验不代表运行时定位有效，需在相应交互状态中核对。
格式验证不替代业务验收；apply 已执行结构校验，无需紧接着重复 validate。
只读，成功输出 valid:true JSON。`,
};

export const commandNames = Object.keys(help);
export const usage = '用法：node uxdoc.mjs <命令> INPUT [选项]';
const errors = `常见错误：
  输出已存在：选择新路径，工具不会覆盖原稿或已有结果。
  任务身份／指纹不匹配：原稿或任务基线已变，使用当前任务重新准备，不能绕过检查。
  summary/details 缺失：补充非空摘要及具体改动数组。
  ann-ID 无效：apply 新标注需指定 ann-* ID；新增交互说明可优先用 annotate 自动生成。
  选择器匹配异常：选唯一静态元素；动态内容可明确关联真实静态容器。
  未指定的修改意见：仅解决本轮 selectedIds 范围内的意见。
错误返回非零退出码；成功时不要求再次 inspect/validate。`;

export function helpFor(command) {
  if (command) return help[command] ? `${help[command]}\n\n${errors}` : null;
  return `${usage}
  init       原样导入已有业务页面，转换协作格式
  annotate   一次添加交互说明，自动锚点、ID 和记录
  review     读取当前需求、说明和人工修改
  read       按需读取目标片段、相关 PRD、说明或 diff
  extract    提取纯业务 HTML
  finish     修改工作稿后一次记录并保存交付（DSH 和外部 Agent 通用）
  apply      封装本轮修改、范围与历史
  prepare    为 DSH task 生成源码与精简上下文
  inspect    查看完整元数据
  validate   校验格式与静态锚点

node uxdoc.mjs <命令> --help 或 node uxdoc.mjs help <命令> 查看选项和示例。
首次导入并加说明：node uxdoc.mjs annotate page.html --annotations notes.json --output page.ux.html
需要 Node.js 22+，运行 skill 无需安装 npm 依赖。${outputRule}`;
}
