import assert from 'node:assert/strict';
import test from 'node:test';

import { ReviewFailure, review } from '../lib/judge.js';

/** A stream that yields one text block plus a normal finish. */
async function* textStream(text, reason = { kind: 'stop' }) {
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text };
  yield { type: 'finish', reason };
}

const llmFor = (chunks) => ({ stream: () => chunks() });
const base = { system: 'POLICY', text: 'EVIDENCE', provider: 'p', model: 'm', timeoutMs: 1000 };

test('returns the parsed verdict for a well-formed reply', async () => {
  const verdict = await review({ ...base, llm: llmFor(() => textStream('{"decision":"allow","risk":"low"}')) });
  assert.deepEqual(verdict, { decision: 'allow', risk: 'low' });
});

test('returns a denial with its reason', async () => {
  const verdict = await review({ ...base, llm: llmFor(() => textStream('{"decision":"deny","risk":"high","reason":"凭据外泄"}')) });
  assert.deepEqual(verdict, { decision: 'deny', risk: 'high', reason: '凭据外泄' });
});

test('a provider error finish fails closed as provider', async () => {
  await assert.rejects(
    review({ ...base, llm: llmFor(() => textStream('', { kind: 'error', failure: { code: 'E_RATE', message: 'rate limited' } })) }),
    (error) => error instanceof ReviewFailure && error.kind === 'provider' && /E_RATE/.test(error.message),
  );
});

test('a stream without a finish fails closed', async () => {
  const stream = async function* () {
    yield { type: 'text-delta', index: 0, text: '{"decision":"allow","risk":"low"}' };
  };
  await assert.rejects(review({ ...base, llm: llmFor(stream) }), (error) => error.kind === 'provider');
});

test('a throwing stream fails closed as provider', async () => {
  const stream = async function* () {
    throw new Error('socket hang up');
  };
  await assert.rejects(review({ ...base, llm: llmFor(stream) }), (error) => error.kind === 'provider' && /socket hang up/.test(error.message));
});

test('malformed reviewer output fails closed as protocol', async () => {
  await assert.rejects(
    review({ ...base, llm: llmFor(() => textStream('我批准了')) }),
    (error) => error.kind === 'protocol',
  );
  await assert.rejects(
    review({ ...base, llm: llmFor(() => textStream('{"decision":"allow","risk":"high"}')) }),
    (error) => error.kind === 'protocol',
  );
});

test('a deadline breach fails closed as timeout without hanging', async () => {
  const slow = async function* () {
    await new Promise((resolve) => setTimeout(resolve, 300));
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
  const started = Date.now();
  await assert.rejects(
    review({ ...base, timeoutMs: 20, llm: llmFor(slow) }),
    (error) => error.kind === 'timeout',
  );
  assert.equal(Date.now() - started < 250, true);
});

test('an already-aborted request never reaches the model', async () => {
  let called = false;
  const llm = { stream: () => { called = true; return textStream('{"decision":"allow","risk":"low"}'); } };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    review({ ...base, llm, signal: controller.signal }),
    (error) => error.kind === 'aborted',
  );
  assert.equal(called, false);
});

test('aborting mid-flight fails closed as aborted', async () => {
  const controller = new AbortController();
  const slow = async function* () {
    await new Promise((resolve) => setTimeout(resolve, 200));
    yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'cancelled' } } };
  };
  const pending = review({ ...base, timeoutMs: 5000, llm: llmFor(slow), signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, (error) => error.kind === 'aborted' || error.kind === 'provider');
});

test('an unresolved route fails closed as unavailable', async () => {
  await assert.rejects(
    review({ ...base, provider: '', model: '', llm: llmFor(() => textStream('{}')) }),
    (error) => error.kind === 'unavailable',
  );
  await assert.rejects(
    review({ ...base, llm: undefined }),
    (error) => error.kind === 'unavailable',
  );
});

test('the request carries the policy, the evidence, and the configured route', async () => {
  let seen;
  const llm = {
    stream: (options) => {
      seen = options;
      return textStream('{"decision":"allow","risk":"low"}');
    },
  };
  await review({ ...base, llm });
  assert.equal(seen.provider, 'p');
  assert.equal(seen.model, 'm');
  assert.equal(seen.system, 'POLICY');
  assert.equal(seen.temperature, 0);
  assert.deepEqual(seen.messages, [{ role: 'user', content: [{ type: 'text', text: 'EVIDENCE' }] }]);
});
