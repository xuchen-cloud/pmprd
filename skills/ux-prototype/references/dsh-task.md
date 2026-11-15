# 修改与提交：DSH 和外部 Agent 共用

修改提示词直接包含本轮意见、目标信息、工作文件和完成命令。程序已经保存输入基线并准备工作文件；内部任务、备份和结果文件用于恢复与交付，AI 无需逐个读取或编排。只处理本轮意见，不顺手续办旧任务。

## 按依赖读取

目标片段足够时直接修改工作文件。静态片段不保证动态文字的数据来源；只有缺少定位、依赖或需求信息时，再查相关源码、PRD 或说明，不先列目录或输出整稿、全部历史。验证与尚未确定的影响对应，不设置固定检查序列。

通用读取入口使用同一个工作文件，不需要 DSH 工具或额外任务参数：

```sh
node /abs/ux-prototype/scripts/uxdoc.mjs read /abs/work.business.html --kind source --search 'saveRule'
node /abs/ux-prototype/scripts/uxdoc.mjs read /abs/work.business.html --kind prd --search '保存规则'
node /abs/ux-prototype/scripts/uxdoc.mjs read /abs/work.business.html --kind explanations --ids ann-save-rule
node /abs/ux-prototype/scripts/uxdoc.mjs read /abs/work.business.html --kind prd-diff
```

以上工作文件路径是占位；执行提示词给出的实际路径。`source` 查询当前工作文件，PRD、说明和待处理 PRD diff 读取冻结的输入基线。只提交获准的局部变更，不把读取片段作为完整正文写回。参数及截断规则见 [按需读取](cli.md#按需读取)。

允许更新 PRD 不等于需要读取 PRD。有本轮人工 PRD 差异，或所选意见直接改变相关需求时才补读；只读 PRD 不可提交修改。已有说明的稳定锚点仍有效时，不为补全展示文字而改动它；仅在含义或定位确受影响时更新。

## 一次提交

工作文件编辑完成后，执行提示词中的命令：

```sh
node /abs/ux-prototype/scripts/uxdoc.mjs finish /abs/work.business.html --summary "调整规则保存与失败反馈"
```

`finish` 从内部保存状态恢复处理范围，自动计算实际 diff、增加历史和版本、处理意见并保存结果。无需生成中间 JSON，也无需再调用 `apply`、`complete`、`validate` 或计算文件哈希。

**默认表示本轮全部所选意见均已完成。** 若只完成一部分，传 `--resolve ann-a,ann-b`；没有完成任何意见但有可交付改动时，传 `--resolve none`。未完成意见保留为待处理。无法产生可交付修改时说明阻碍，不执行成功提交。

PRD、说明或标题确需改动时，可通过 `--changes-json` 传 JSON 对象，或用 `--changes -` 从 stdin 读取；较长内容也可用可选的 `--changes FILE`。例如下面对象只包含获准的变化，不包含完整 PRD 或历史：

```json
{
  "prdOps": [{"find":"保存失败时关闭配置面板。","replace":"保存失败时保留配置面板和已填写内容。"}],
  "annotationUpdates": [{"id":"ann-save-rule","body":"点击保存提交当前配置；失败时显示原因并保留输入，可修改后重试。"}]
}
```

`--summary` 提供实际改动摘要；未传 `details` 时由程序沿用摘要。`prdOps` 在原 PRD 上逐项唯一匹配；无匹配或多匹配时，补读相应片段并明确原文后重试。新增或更新说明的字段见 [changes JSON 契约](cli.md#changes-json-契约)，PRD 引用说明与导航上下文见 [文件规范](file-format.md)。

## 交付结果

以 `finish` 返回的 `outputPath` 为交付文件。默认在保留备份后更新当前文件；用户选择生成新版本时另存。返回 `delivery: "conflict"` 表示原文件已经变化，当前文件未被覆盖，返回的是保留的候选；说明冲突，不强行覆盖。重复提交已完成的同一结果不会重复写历史；不要手动修改任务状态、版本或检查点。

说明、未选意见和旧历史由程序保留，只有用户本轮开启清理时才删除实际完成的选定修改意见。`agentCheckpoint` 表示最近一次 AI 交付修订，不表示其他意见已完成。

## 同一提示词的两个入口

“发送到 DSH”和“复制给外部 Agent”使用相同内容与完成命令。DSH 自动读取提交结果；外部 Agent 不需要调用 DSH 工具，工作台可用“读取修改结果”刷新。外部修改期间文档同样只读，放弃本轮时使用“结束外部修改”恢复编辑，工作文件仍保留。

外部 Agent 需要访问工作目录、此 skill 脚本及 Node.js 22+。复制文本不会把本地文件上传到另一台电脑或普通网页聊天；换环境需同时提供文件和脚本。单文件 HTML 本身仍可独立阅读与传递。旧会话的上下文组装、压缩和缓存由执行 Agent 的宿主管理，Skill 不清除会话历史。
