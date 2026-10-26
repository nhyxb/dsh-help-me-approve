import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSnapshot,
  collectPathCandidates,
  conversationExcerpt,
  describePath,
  parseLoggedArguments,
  truncateMiddle,
} from '../lib/evidence.js';

const CWD = '/work/project';

/** A probe that reports a fixed fact set, so tests never touch the real disk. */
const probe = (path) => ({
  exists: path === '/etc/hosts' || path === '/work/project/src/a.js',
  type: path === '/work/project/src' ? 'directory' : path === '/etc/hosts' ? 'file' : null,
  sizeBytes: path === '/etc/hosts' ? 512 : null,
});

/** A session stub exposing only `snapshotEvents`. */
const session = (events) => ({ snapshotEvents: () => events });

test('truncateMiddle keeps the head and tail and states how much was cut', () => {
  const text = 'a'.repeat(100) + 'b'.repeat(100);
  const short = truncateMiddle(text, 60);
  assert.equal(short.length <= 60 + 20, true);
  assert.match(short, /截断 \d+ 字符/);
  assert.equal(truncateMiddle('short', 100), 'short');
  assert.equal(truncateMiddle(undefined, 10), '');
});

test('collectPathCandidates picks path-like values only, capped and de-duplicated', () => {
  const candidates = collectPathCandidates({
    path: '/etc/hosts',
    content: 'hello',
    nested: { filepath: '../outside.txt', other: 'x' },
    list: ['/abs/one', '/abs/one', './rel/two'],
    glob: 'src/**/*.js',
  }, 3);
  assert.deepEqual(candidates, ['/etc/hosts', '../outside.txt', '/abs/one']);
  assert.equal(collectPathCandidates('raw string is not walked', 4).length, 0);
});

test('describePath reports inside/outside the workspace', () => {
  const inside = describePath(CWD, 'src/a.js', probe);
  assert.equal(inside.path, '/work/project/src/a.js');
  assert.equal(inside.insideWorkspace, true);
  assert.equal(inside.exists, true);

  const outside = describePath(CWD, '/etc/hosts', probe);
  assert.equal(outside.path, '/etc/hosts');
  assert.equal(outside.insideWorkspace, false);
  assert.equal(outside.sizeBytes, 512);

  const escape = describePath(CWD, '../../etc/shadow', probe);
  assert.equal(escape.insideWorkspace, false);

  const missing = describePath(CWD, 'nope.txt', probe);
  assert.equal(missing.exists, false);
  assert.equal(missing.type, null);
});

test('parseLoggedArguments mirrors the agent loop', () => {
  assert.deepEqual(parseLoggedArguments('{"a":1}'), { a: 1 });
  assert.deepEqual(parseLoggedArguments(''), {});
  assert.equal(parseLoggedArguments('not json'), 'not json');
});

test('conversationExcerpt keeps human and assistant text and drops tool traffic', () => {
  const events = [
    { type: 'user/message', data: { source: { kind: 'user', rpcId: 'r1' }, content: [{ type: 'text', text: '把配置写到 /etc/app.conf' }] } },
    { type: 'user/message', data: { source: { kind: 'tool' }, content: [{ type: 'text', text: 'TOOL NOISE' }] } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '好的，我先看看现有内容' }] } } },
  ];
  const { excerpt, truncated } = conversationExcerpt(events, 1000);
  assert.match(excerpt, /\[user\] 把配置写到 \/etc\/app.conf/);
  assert.match(excerpt, /\[assistant\] 好的，我先看看现有内容/);
  assert.equal(excerpt.includes('TOOL NOISE'), false);
  assert.equal(truncated, false);
});

test('buildSnapshot caps the conversation and carries the pending arguments', () => {
  const events = [
    { type: 'request/header', data: { header: { config: { provider: 'p', model: 'm' } } } },
    { type: 'user/message', data: { source: { kind: 'user', rpcId: 'r1' }, content: [{ type: 'text', text: 'y'.repeat(5000) }] } },
    {
      type: 'tool/call',
      data: { callId: 'call-1', name: 'write_file', arguments: JSON.stringify({ path: '/etc/hosts', content: 'z'.repeat(5000) }) },
    },
  ];
  const snapshot = buildSnapshot({
    session: session(events),
    toolName: 'write_file',
    callId: 'call-1',
    reason: '需要写到工作区外',
    cwd: CWD,
    limits: { conversationChars: 200, argumentChars: 200 },
    probe,
  });
  assert.equal(snapshot.conversation.truncated, true);
  assert.equal(snapshot.conversation.excerpt.length < 260, true);
  assert.equal(snapshot.action.argumentsFound, true);
  assert.equal(snapshot.action.argumentsText.includes('/etc/hosts'), true);
  assert.equal(snapshot.action.argumentsText.length < 260, true);
  assert.equal(snapshot.evidence.length, 1);
  assert.equal(snapshot.evidence[0].path, '/etc/hosts');
  assert.equal(snapshot.evidence[0].insideWorkspace, false);
  assert.equal(snapshot.askerReason, '需要写到工作区外');
  assert.equal(snapshot.workspace, '/work/project');
  assert.equal(Object.isFrozen(snapshot), true);
});

test('buildSnapshot survives a session with no log or no matching call', () => {
  const empty = buildSnapshot({ session: undefined, toolName: 'bash', cwd: CWD, probe });
  assert.equal(empty.conversation.excerpt, '');
  assert.equal(empty.action.argumentsFound, false);
  assert.equal(empty.action.argumentsText, null);
  assert.deepEqual(empty.evidence, []);
  assert.equal(empty.callId, null);

  const noCall = buildSnapshot({
    session: session([{ type: 'tool/call', data: { callId: 'other', name: 'bash', arguments: '{}' } }]),
    toolName: 'bash',
    callId: 'call-x',
    cwd: CWD,
    probe,
  });
  assert.equal(noCall.action.argumentsFound, false);
});

test('buildSnapshot keeps only the newest events when the log is long', () => {
  const events = [];
  for (let index = 0; index < 50; index += 1) {
    events.push({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: `m${index}` }] } });
  }
  const snapshot = buildSnapshot({ session: session(events), toolName: 'bash', cwd: CWD, probe, events: 5 });
  assert.equal(snapshot.conversation.entries, 5);
  assert.equal(snapshot.conversation.excerpt.includes('m49'), true);
  assert.equal(snapshot.conversation.excerpt.includes('m0'), false);
});
