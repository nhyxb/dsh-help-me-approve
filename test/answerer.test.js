import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { apply } from '../lib/index.js';

const CWD = '/work/project';

/** One logged tool call plus a request header, as the agent loop writes them. */
const eventsFor = (callId = 'call-1', args = { path: '/etc/hosts', content: 'x' }) => [
  { type: 'request/header', data: { header: { config: { provider: 'session-provider', model: 'session-model' } } } },
  { type: 'user/message', data: { source: { kind: 'user', rpcId: 'r1' }, content: [{ type: 'text', text: '把 hosts 改一下' }] } },
  { type: 'tool/call', data: { callId, name: 'write_file', arguments: JSON.stringify(args) } },
];

/** A stream that yields one reviewer reply. */
async function* reply(text, reason = { kind: 'stop' }) {
  yield { type: 'text-delta', index: 0, text };
  yield { type: 'finish', reason };
}

/**
 * Build a plugin context stub with the services the plugin reads lazily.
 * @param {object} options - stub options.
 * @returns {{ctx: object, listeners: Map<string, Function>, calls: object}} the stub.
 */
function makeCtx({ preset = 'help-me-approve', defaultPreset = 'workspace-write', stream, presentProjection = true } = {}) {
  const listeners = new Map();
  const calls = { llm: [], next: 0, systemPromptContexts: [] };
  const ctx = {
    on(name, listener, options) {
      listeners.set(name, listener);
      listeners.set(`${name}:options`, options);
      return () => {};
    },
    get(name) {
      if (name === 'llm') return { stream: (options) => { calls.llm.push(options); return stream(options); } };
      if (name === 'sessionProjections') return presentProjection ? { stateOf: () => ({ preset }) } : undefined;
      if (name === 'permissionPresets') return { defaultPreset };
      return undefined;
    },
    inject(_deps, callback) {
      callback({
        systemPrompt: {
          context(entry) { calls.systemPromptContexts.push(entry); },
          getContextOrder(order) { assert.equal(order, 'APPROVAL_POLICY'); return 115; },
        },
      });
    },
    logger: { warn() {} },
    effect() {},
  };
  return { ctx, listeners, calls };
}

const session = (callId = 'call-1') => ({ header: { cwd: CWD }, snapshotEvents: () => eventsFor(callId) });

const request = (callId = 'call-1', reason = '目标在工作区外') => ({ agent: { session: session(callId) }, toolName: 'write_file', callId, reason });

/** Poll for an audit file to reach `lines` records, then parse it. */
async function readAudit(path, lines = 1) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const text = await readFile(path, 'utf8');
      const records = text.trim().split('\n').filter((line) => line !== '');
      if (records.length >= lines) return records.map((line) => JSON.parse(line));
    } catch {
      /* not written yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`audit file ${path} did not reach ${lines} records`);
}

test('an approve verdict grants exactly one execution and leaves the result alone', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'hmp-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  process.env.DSH_HOME = home;

  const { ctx, listeners } = makeCtx({ stream: () => reply('{"decision":"allow","risk":"medium"}') });
  apply(ctx, {});
  const answer = listeners.get('approval/request');

  const outcome = await answer(request(), async () => { throw new Error('next must not run'); });
  assert.equal(outcome, 'allowed-once');

  const post = listeners.get('tools/post-execute');
  const decision = await post({ callId: 'call-1' }, { isError: false }, async () => ({ kind: 'accept', marker: true }));
  assert.deepEqual(decision, { kind: 'accept', marker: true });

  const [record] = await readAudit(join(home, 'help-me-approve', 'audit.jsonl'));
  assert.equal(record.decision, 'allow');
  assert.equal(record.risk, 'medium');
  assert.equal(record.tool, 'write_file');
  assert.equal(record.callId, 'call-1');
  assert.equal(record.model, 'session-provider/session-model');
  assert.equal(record.failure, null);
  assert.equal(typeof record.time, 'string');
});

test('a deny verdict rejects the call and hands the reason to the agent', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'hmp-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  process.env.DSH_HOME = home;

  const { ctx, listeners } = makeCtx({
    stream: () => reply('{"decision":"deny","risk":"high","reason":"/etc/hosts 不在工作区内，且该路径属于系统配置"}'),
  });
  apply(ctx, {});
  const answer = listeners.get('approval/request');

  const outcome = await answer(request(), async () => { throw new Error('next must not run'); });
  assert.equal(outcome, 'rejected');

  const post = listeners.get('tools/post-execute');
  const decision = await post({ callId: 'call-1' }, { isError: true }, async () => ({ kind: 'accept' }));
  assert.equal(decision.kind, 'block');
  const text = decision.feedback[0].text;
  assert.match(text, /审核代理拒绝了工具 "write_file"/);
  assert.match(text, /\/etc\/hosts 不在工作区内/);
  assert.match(text, /不要用等价参数重试/);
  assert.match(text, /更低风险/);
  assert.match(text, /请求确认/);

  const [record] = await readAudit(join(home, 'help-me-approve', 'audit.jsonl'));
  assert.equal(record.decision, 'reject');
  assert.equal(record.risk, 'high');
  assert.match(record.reason, /系统配置/);
});

test('a session on another preset delegates to the human answerer', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'hmp-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  process.env.DSH_HOME = home;

  const { ctx, listeners, calls } = makeCtx({ preset: 'workspace-write', stream: () => reply('{"decision":"allow","risk":"low"}') });
  apply(ctx, {});
  const answer = listeners.get('approval/request');

  let delegated = 0;
  const outcome = await answer(request(), async () => { delegated += 1; return 'allowed-once'; });
  assert.equal(outcome, 'allowed-once');
  assert.equal(delegated, 1);
  assert.equal(calls.llm.length, 0);
});

test('a session with no readable projection delegates to the human answerer', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'hmp-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  process.env.DSH_HOME = home;

  const { ctx, listeners } = makeCtx({ presentProjection: false, stream: () => reply('{"decision":"allow","risk":"low"}') });
  apply(ctx, {});
  const answer = listeners.get('approval/request');
  let delegated = 0;
  await answer(request(), async () => { delegated += 1; return 'rejected'; });
  assert.equal(delegated, 1);
});

test('a broken reviewer fails closed and says why in the tool error', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'hmp-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  process.env.DSH_HOME = home;

  const { ctx, listeners } = makeCtx({
    stream: () => (async function* () { throw new Error('provider exploded'); })(),
  });
  apply(ctx, { provider: 'fixed-provider', model: 'fixed-model' });
  const answer = listeners.get('approval/request');

  const outcome = await answer(request(), async () => { throw new Error('next must not run'); });
  assert.equal(outcome, 'rejected');

  const post = listeners.get('tools/post-execute');
  const decision = await post({ callId: 'call-1' }, { isError: true }, async () => ({ kind: 'accept' }));
  assert.equal(decision.kind, 'block');
  const text = decision.feedback[0].text;
  assert.match(text, /未能给出裁决/);
  assert.match(text, /fail-closed/);
  assert.match(text, /provider exploded/);
  assert.match(text, /不要重试同一调用/);

  const [record] = await readAudit(join(home, 'help-me-approve', 'audit.jsonl'));
  assert.equal(record.decision, 'reject');
  assert.equal(record.risk, 'unknown');
  assert.equal(record.failure, 'provider');
  assert.equal(record.model, 'fixed-provider/fixed-model');
});

test('the configured route overrides the session route', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'hmp-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  process.env.DSH_HOME = home;

  const { ctx, listeners, calls } = makeCtx({ stream: () => reply('{"decision":"allow","risk":"low"}') });
  apply(ctx, { provider: 'reviewer', model: 'reviewer-model', timeoutMs: 2500 });
  await listeners.get('approval/request')(request(), async () => 'allowed-once');
  assert.equal(calls.llm.length, 1);
  assert.equal(calls.llm[0].provider, 'reviewer');
  assert.equal(calls.llm[0].model, 'reviewer-model');
  assert.equal(calls.llm[0].temperature, 0);
  assert.match(calls.llm[0].messages[0].content[0].text, /PENDING_ACTION/);
});

test('the runtime guidance appears only for the active preset', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'hmp-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  process.env.DSH_HOME = home;

  const active = makeCtx({ preset: 'help-me-approve', stream: () => reply('{"decision":"allow","risk":"low"}') });
  apply(active.ctx, {});
  const entry = active.calls.systemPromptContexts[0];
  assert.equal(entry.name, 'help-me-approve:policy');
  assert.equal(entry.order, 115);
  assert.match(entry.text({ agent: { session: session() } }), /帮我批准/);
  assert.match(entry.text({ agent: { session: session() } }), /Do not retry/);
  assert.equal(entry.text({ agent: undefined }), '');

  const inactive = makeCtx({ preset: 'workspace-write', stream: () => reply('{"decision":"allow","risk":"low"}') });
  apply(inactive.ctx, {});
  assert.equal(inactive.calls.systemPromptContexts[0].text({ agent: { session: session() } }), '');
});

test('a settled decision is consumed once, so a later call is not rewritten', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'hmp-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  process.env.DSH_HOME = home;

  const { ctx, listeners } = makeCtx({ stream: () => reply('{"decision":"deny","risk":"medium","reason":"越界"}') });
  apply(ctx, {});
  await listeners.get('approval/request')(request(), async () => 'allowed-once');
  const post = listeners.get('tools/post-execute');
  const first = await post({ callId: 'call-1' }, { isError: true }, async () => ({ kind: 'accept' }));
  assert.equal(first.kind, 'block');
  const second = await post({ callId: 'call-1' }, { isError: true }, async () => ({ kind: 'accept' }));
  assert.deepEqual(second, { kind: 'accept' });
});
