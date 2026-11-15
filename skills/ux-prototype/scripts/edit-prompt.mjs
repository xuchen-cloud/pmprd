import path from 'node:path';

// One portable instruction is used verbatim by direct dispatch and clipboard.
// Persistence details stay inside the runner; the model only edits the workfile.
export function editPrompt(task, context, { scriptsPath, platform = process.platform } = {}) {
  const quote = value => platform === 'win32' ? `'${String(value).replaceAll("'", "''")}'` : `'${String(value).replaceAll("'", "'\"'\"'")}'`;
  const cli = `node ${quote(path.join(scriptsPath, 'uxdoc.mjs'))}`;
  const file = quote(task.businessPath);
  const requests = context.selectedRequests.map((request, index) => {
    const anchor = request.anchor || {}, target = request.targetSource;
    const location = { selector: anchor.selector, ...(anchor.id ? { anchorId: anchor.id } : {}), ...(anchor.text ? { originalText: anchor.text } : {}), ...(anchor.view ? { view: anchor.view } : {}) };
    return `${index + 1}. 意见 ${request.id}：${request.body}\n目标：${JSON.stringify(location)}\n${target?.status === 'found' ? `目标源码${target.truncated ? '（片段已截断，需要时补读）' : ''}：\n\`\`\`html\n${target.html}\n\`\`\`` : '目标暂不能静态定位，按目标信息补查工作文件。'}`;
  });
  const pending = context.scope.pendingPrdChangeCount;
  return [
    `请修改设计文档「${path.basename(task.originalPath)}」。`,
    `工作文件：${task.businessPath}\n原稿和备份已由程序准备，直接在工作文件中编辑业务 HTML。`,
    requests.length ? `本轮修改意见：\n${requests.join('\n\n')}` : '本轮根据人工修改的 PRD 差异调整原型。',
    pending ? `另有 ${pending} 条待处理的人工 PRD 变更，按需读取：\n${cli} read ${file} --kind prd-diff` : '',
    task.includePrdChanges ? '允许同步本轮直接影响的 PRD 内容；需要时才读取相关段落，没有相关变化就不读、不改。' : '本轮保持 PRD 原文。',
    `缺少材料时再按关键词或范围读取源码、PRD 和说明，例如：\n${cli} read ${file} --kind prd --search '相关关键词'\n涉及 PRD 局部修改、标注或设计时，再查阅 ${path.join(scriptsPath, '../SKILL.md')} 的相关指引。`,
    '保留未选意见和现有说明，按实际影响与不确定性决定需要核对的行为；无需自行编排备份、版本、历史或格式校验。',
    `修改完成后执行一次：\n${cli} finish ${file} --summary '实际改动说明'\n默认完成本轮全部所选意见；只完成部分时添加 --resolve 'ann-id1,ann-id2'，没有完成任何意见时用 --resolve none。完成说明应描述实际结果。`,
    `程序会保存差异和历史，${task.createNewVersion ? '另存新版本' : '更新当前文档'}，${task.clearResolved ? '清理本轮已完成的修改意见' : '保留已处理意见'}。以命令返回的文件作为交付结果；报告实际改动及未完成事项即可。`,
  ].filter(Boolean).join('\n\n');
}
