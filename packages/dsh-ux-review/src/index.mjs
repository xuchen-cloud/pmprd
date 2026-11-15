import { fileURLToPath } from 'node:url';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import * as skillFilesystem from '@deepseek-ai/dsh-skill-filesystem';
import { ReviewService } from './service.mjs';

export const name = 'ux-review';
export const inject = ['connection', 'fs', 'sessionController', 'sandboxPolicy', 'tools'];
const objectSchema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const string = { type: 'string' };
const resultSchema = { type: 'object', additionalProperties: true };

export async function apply(ctx) {
  const skillsPath = fileURLToPath(new URL('../skills/', import.meta.url));
  const skillProvider = await ctx.plugin(skillFilesystem, { providerName: 'ux-review-bundled', includeDefaultRoots: false, bundledSkillDir: skillsPath, watch: false });
  ctx.effect(() => () => skillProvider.dispose(), 'ux-review: bundled skill catalog');
  const service = new ReviewService({
    fs: ctx.fs,
    resolveAgent: id => ctx.sessionController.resolveAgent(id),
    policyFor: session => ctx.sandboxPolicy.resolve({ session }),
    makeMessage: prompt => createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }),
    skillsPath,
  });
  ctx.effect(() => () => { service.disposed = true; }, 'ux-review: task monitor lifetime');
  // Native connection owns authentication and admits only owner peers to exact
  // routes. Shared/non-owner peers never gain workspace access here.
  // The shared /api interceptor is owned by Gateway. Exact Fetch routes are the
  // extension point for additional owner-only operations in this DSH version.
  for (const operation of ['read', 'save', 'importFile', 'submit', 'task', 'cancel']) ctx.effect(() => ctx.connection.fetch.register({
    path: `/api/ux-review/${operation}`, methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      let envelope;
      try { envelope = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
      if (envelope?.type !== 'client-request' || typeof envelope.rpcId !== 'string' || !envelope.rpcId || envelope.method !== `ux-review/${operation}`) return new Response('Invalid RPC envelope', { status: 400 });
      let result;
      try {
        const payload = envelope.payload;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('请求格式无效。');
        result = { ok: true, value: await service[operation](payload, request.signal) };
      } catch (error) {
        result = { ok: false, error: { code: 'UX_REVIEW_ERROR', message: error.message || String(error), details: {} } };
      }
      return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result });
    },
  }), 'ux-review: owner operation ' + operation);
  const tool = (name, description, parameters, execute) => ctx.effect(() => ctx.tools.register({
    name, description, parameters,
    output: { schema: resultSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute,
  }), 'ux-review: ' + name);
  tool('ux_review_complete', 'Compatibility completion for older apply-based tasks. New modification prompts use the portable finish command, which saves and reports completion automatically; do not call this after finish.',
    objectSchema({ taskId: string, outputPath: string }), (args, exec) => service.complete(args, exec));
  tool('ux_review_fail', 'Report why a submitted UX / PRD task cannot be completed. Does not delete source or result files.',
    objectSchema({ taskId: string, reason: string }), (args, exec) => service.fail(args, exec));
  tool('ux_review_read', 'Read one HTML document in the current session workspace, including its opaque version for guarded saving.',
    objectSchema({ path: string }), (args, exec) => service.read({ ...args, sessionId: exec.agent.session.id }, exec.signal));
  tool('ux_review_save', 'Save an explicitly edited UX / PRD document with expectedVersion protection. Existing document identity and change history must be preserved.',
    objectSchema({ path: string, html: string, expectedVersion: string }), (args, exec) => service.save({ ...args, sessionId: exec.agent.session.id }, exec.signal));
  tool('ux_review_task', 'Read the persisted status of a UX / PRD review task owned by the current session.',
    objectSchema({ id: string }), (args, exec) => service.task({ ...args, sessionId: exec.agent.session.id }, exec.signal));
  tool('ux_review_context', 'Compatibility on-demand reader for task IDs. New modification prompts already include requests and targets; use their portable read command only when additional PRD, source, explanations or pending diffs are needed.',
    objectSchema({ taskId: string, query: { type: 'object', required: ['kind'], additionalProperties: false, properties: {
      kind: { type: 'string', enum: ['prd', 'source', 'explanations', 'prd-diff'] },
      search: string, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 },
      ids: { type: 'array', items: string, minItems: 1, maxItems: 20 }, anchorId: string, selector: string,
      offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 20 },
    } } }), (args, exec) => service.context(args, exec));
}
