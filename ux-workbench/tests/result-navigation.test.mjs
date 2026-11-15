import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { create, write, parse, recordAgent, sourceOnly } from '../../skills/ux-prototype/scripts/document.mjs';

test('opening AI results reports errors, prevents concurrent opens, and recovers', { timeout: 45000 }, async t => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const cacheDir = await fs.mkdtemp(resolve(os.tmpdir(), 'ux-result-vite-'));
  const server = await createServer({ root, cacheDir, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  const port = server.httpServer.address().port;
  t.after(async () => { await server.close(); await fs.rm(cacheDir, { recursive: true, force: true }); });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  t.after(() => browser.close());
  const snapshot = { path: '/workspace/source.ux.html', name: 'source.ux.html', version: '1', html: write('<html><body><button>源文件</button></body></html>', create({ title: '结果打开回归', prd: '# 需求\n\n原始需求。' })) };
  const outputPath = '/workspace/source.review-result.ux.html';
  const updatedSource = '<html><body><button>已更新当前文件</button></body></html>';
  const updatedDoc = recordAgent(parse(snapshot.html), { summary: '更新当前文件', details: ['更新按钮与需求'], prd: '# 需求\n\nAI 更新后的需求。', uxBefore: sourceOnly(snapshot.html), uxAfter: updatedSource });
  const updatedSnapshot = { ...snapshot, version: 'updated', html: write(updatedSource, updatedDoc) };
  const nextSnapshot = { ...snapshot, version: 'updated-again', html: write(updatedSource, recordAgent(updatedDoc, { summary: '再次更新需求', details: ['更新第二轮需求'], prd: '# 需求\n\nAI 第二轮更新。' })) };
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(({ snapshot, outputPath, updatedSnapshot }) => {
    let current = snapshot;
    window.__openCalls = []; window.__submissions = []; window.__openMode = 'reject'; window.__taskMode = 'completed'; window.__nextSnapshot = updatedSnapshot;
    const completed = () => {
      const replace = window.__taskMode.startsWith('replace');
      if (replace) current = window.__nextSnapshot;
      return { id: 'result-task', status: 'completed', outputPath: replace ? current.path : outputPath, delivery: replace ? 'updated-current' : 'new-version', message: '修改完成' };
    };
    window.__UX_REVIEW_HOST__ = {
      read: async () => current,
      save: async args => (current = { ...current, html: args.html, version: '2' }),
      submit: async args => { window.__submissions.push(args); return window.__taskMode === 'completed' ? completed() : { id: 'result-task', status: 'queued' }; },
      task: async () => window.__taskMode === 'replace-wait' ? new Promise(resolve => { window.__finishTask = () => resolve(completed()); }) : completed(),
      openResult(path) {
        window.__openCalls.push(path);
        if (window.__openMode === 'throw') throw new Error('结果文件不存在');
        if (window.__openMode === 'reject') return Promise.reject(new Error('导航服务暂时不可用'));
        if (window.__openMode === 'pending') return new Promise((resolve, reject) => { window.__finishOpen = resolve; window.__failOpen = reject; });
        window.__openedPath = path; return Promise.resolve();
      },
    };
  }, { snapshot, outputPath, updatedSnapshot });
  await page.goto(`http://127.0.0.1:${port}/`);
  const submitCompletedTask = async () => {
    await page.getByRole('button', { name: '交给 AI 修改', exact: true }).click();
    assert.equal(await page.getByLabel('生成新版本文件', { exact: true }).isChecked(), false);
    await page.getByRole('button', { name: /^发送到 DSH/ }).click();
    await page.getByRole('button', { name: '打开修改结果', exact: true }).waitFor();
  };
  await submitCompletedTask();
  assert.equal(await page.evaluate(() => window.__submissions[0].createNewVersion), false);
  const open = page.getByRole('button', { name: '打开修改结果', exact: true });
  await open.click();
  await page.getByText('打开修改结果失败：导航服务暂时不可用', { exact: true }).waitFor({ timeout: 2000 });
  assert.deepEqual(pageErrors, [], 'Rejected navigation must not escape as an unhandled rejection');

  await page.evaluate(() => { window.__openMode = 'throw'; });
  await open.click();
  await page.getByText('打开修改结果失败：结果文件不存在', { exact: true }).waitFor();

  await page.evaluate(() => { window.__openMode = 'pending'; window.__openCalls = []; });
  // Two immediate clicks also exercise the guard before React commits disabled.
  await open.evaluate(button => { button.click(); button.click(); });
  const opening = page.getByRole('button', { name: '正在打开修改结果', exact: true });
  await opening.waitFor();
  assert.equal(await opening.isDisabled(), true);
  assert.equal(await opening.getAttribute('aria-busy'), 'true');
  assert.deepEqual(await page.evaluate(() => window.__openCalls), [outputPath]);
  await page.evaluate(() => window.__failOpen(new Error('连接已断开')));
  await page.getByText('打开修改结果失败：连接已断开', { exact: true }).waitFor();
  await open.waitFor(); assert.equal(await open.isEnabled(), true);

  await page.evaluate(() => { window.__openMode = 'success'; });
  await open.click();
  await page.waitForFunction(path => window.__openedPath === path, outputPath);

  // Poll completion changes task status before the async navigation settles.
  // Its error must still surface after the polling effect has been cleaned up.
  await page.getByLabel('收起任务提示', { exact: true }).click();
  await page.evaluate(() => { window.__taskMode = 'queued'; window.__openMode = 'pending'; window.__openCalls = []; });
  await page.getByRole('button', { name: '交给 AI 修改', exact: true }).click();
  assert.equal(await page.getByLabel('处理 PRD 修改，并同步本轮意见涉及的需求', { exact: true }).isVisible(), true);
  assert.equal(await page.getByText('只更新与本轮修改直接相关的需求；关闭后 PRD 保持原文。', { exact: true }).isVisible(), true);
  await page.getByLabel('生成新版本文件', { exact: true }).check();
  await page.getByRole('button', { name: /^发送到 DSH/ }).click();
  assert.equal(await page.evaluate(() => window.__submissions.at(-1).createNewVersion), true);
  await opening.waitFor({ timeout: 5000 });
  await page.evaluate(() => window.__failOpen(new Error('自动打开失败')));
  await page.getByText('打开修改结果失败：自动打开失败', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__openCalls), [outputPath]);
  assert.deepEqual(pageErrors, []);

  // In-place delivery re-reads the file even when the host offers tab navigation.
  await page.getByLabel('收起任务提示', { exact: true }).click();
  await page.evaluate(() => { window.__taskMode = 'replace'; window.__openCalls = []; });
  await page.getByRole('button', { name: '交给 AI 修改', exact: true }).click();
  await page.getByLabel('生成新版本文件', { exact: true }).uncheck();
  await page.getByRole('button', { name: /^发送到 DSH/ }).click();
  await page.frameLocator('iframe').getByRole('button', { name: '已更新当前文件', exact: true }).waitFor();
  await page.getByText('AI 更新后的需求。', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__openCalls), []);

  // AI owns the document while this round is active; completion restores editing.
  await page.getByLabel('收起任务提示', { exact: true }).click();
  await page.evaluate(next => { window.__taskMode = 'replace-wait'; window.__nextSnapshot = next; }, nextSnapshot);
  await page.getByRole('button', { name: '交给 AI 修改', exact: true }).click();
  await page.getByRole('button', { name: /^发送到 DSH/ }).click();
  await page.getByText('AI 修改中 · 只读', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Markdown', exact: true }).count(), 0);
  assert.equal(await page.getByRole('textbox', { name: 'PRD 富文本正文', exact: true }).count(), 0);
  assert.equal(await page.getByLabel('选择元素添加标注', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '展开标注', exact: true }).click();
  await page.getByText('AI 更新后的需求。', { exact: true }).waitFor();
  await page.waitForFunction(() => typeof window.__finishTask === 'function');
  await page.evaluate(() => window.__finishTask());
  await page.getByText('AI 第二轮更新。', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'PRD 富文本正文', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await page.getByLabel('PRD 正文', { exact: true }).fill('# 需求\n\n完成后可以继续修改。');
  await page.getByText('未保存', { exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);
});
