import assert from 'node:assert/strict';
import test from 'node:test';

import { VerdictError, parseVerdict, stripCodeFence } from '../lib/decision.js';

test('accepts the two allow shapes', () => {
  assert.deepEqual(parseVerdict('{"decision":"allow","risk":"low"}'), { decision: 'allow', risk: 'low' });
  assert.deepEqual(parseVerdict('{"decision":"allow","risk":"medium"}'), { decision: 'allow', risk: 'medium' });
});

test('accepts deny with and without a reason', () => {
  assert.deepEqual(parseVerdict('{"decision":"deny","risk":"high"}'), { decision: 'deny', risk: 'high' });
  assert.deepEqual(
    parseVerdict('{"decision":"deny","risk":"medium","reason":"  目标目录不在工作区内  "}'),
    { decision: 'deny', risk: 'medium', reason: '目标目录不在工作区内' },
  );
});

test('strips exactly one enclosing json fence', () => {
  assert.equal(stripCodeFence('```json\n{"a":1}\n```'), '{"a":1}');
  assert.deepEqual(parseVerdict('```json\n{"decision":"allow","risk":"low"}\n```'), { decision: 'allow', risk: 'low' });
});

test('rejects non-JSON, prose, and empty output', () => {
  assert.throws(() => parseVerdict('好的，我批准。'), VerdictError);
  assert.throws(() => parseVerdict(''), VerdictError);
  assert.throws(() => parseVerdict(undefined), VerdictError);
  assert.throws(() => parseVerdict('{"decision":"allow","risk":"low"} trailing'), VerdictError);
});

test('rejects non-object and array payloads', () => {
  assert.throws(() => parseVerdict('["allow","low"]'), VerdictError);
  assert.throws(() => parseVerdict('null'), VerdictError);
  assert.throws(() => parseVerdict('"allow"'), VerdictError);
});

test('rejects the contradictory risk combinations', () => {
  assert.throws(() => parseVerdict('{"decision":"allow","risk":"high"}'), /不允许以 high 风险批准/);
  assert.throws(() => parseVerdict('{"decision":"deny","risk":"low"}'), /不允许以 low 风险拒绝/);
});

test('rejects an allow that carries a reason', () => {
  assert.throws(() => parseVerdict('{"decision":"allow","risk":"low","reason":"ok"}'), /只能有 decision 与 risk 两个字段/);
});

test('rejects extra members and duplicate members', () => {
  assert.throws(() => parseVerdict('{"decision":"deny","risk":"high","reason":"x","note":"y"}'), /只能有 decision、risk、reason 三个字段/);
  assert.throws(() => parseVerdict('{"decision":"allow","decision":"allow","risk":"low"}'), /重复了顶层字段/);
  assert.throws(() => parseVerdict('{"decision":"deny","risk":"high","reason":"a","reason":"b"}'), /重复了顶层字段/);
});

test('rejects unknown vocabulary and empty reasons', () => {
  assert.throws(() => parseVerdict('{"decision":"approve","risk":"low"}'), /decision 必须是 allow 或 deny/);
  assert.throws(() => parseVerdict('{"decision":"allow","risk":"tiny"}'), /risk 必须是 low、medium 或 high/);
  assert.throws(() => parseVerdict('{"decision":"deny","risk":"high","reason":"   "}'), /reason 不能为空/);
  assert.throws(() => parseVerdict('{"decision":"deny","risk":"high","reason":42}'), /reason 必须是字符串/);
});

test('caps a runaway reason', () => {
  const long = 'x'.repeat(5000);
  const verdict = parseVerdict(JSON.stringify({ decision: 'deny', risk: 'high', reason: long }));
  assert.equal(verdict.reason.length, 600);
});
