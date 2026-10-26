/**
 * The evidence bundle handed to the reviewer.
 *
 * The reviewer never sees the whole session: it gets a condensed excerpt of the
 * recent conversation, deterministic facts about the paths this call would
 * touch, and the pending call's own arguments. Every part is length-capped so a
 * pathological history cannot inflate the review request.
 * @module dsh-help-me-approve/evidence
 */

import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** Default caps for one review request. */
export const DEFAULT_LIMITS = Object.freeze({
  conversationChars: 4000,
  argumentChars: 4000,
  reasonChars: 600,
  evidencePaths: 4,
  events: 600,
});

/** Argument keys whose value is treated as a filesystem path. */
const PATH_KEYS = new Set(['path', 'file', 'filepath', 'filename', 'dir', 'directory', 'cwd', 'target', 'destination', 'dest', 'source', 'src', 'pattern', 'glob']);

/**
 * Keep the head and tail of an over-long string.
 * @param {string} text - source text.
 * @param {number} max - maximum retained characters.
 * @returns {string} the text, shortened with an explicit marker when needed.
 */
export function truncateMiddle(text, max) {
  if (typeof text !== 'string') return '';
  if (text.length <= max) return text;
  if (max <= 24) return text.slice(0, max);
  const head = Math.ceil((max - 20) / 2);
  const tail = max - 20 - head;
  return `${text.slice(0, head)}\n…[截断 ${text.length - head - tail} 字符]…\n${text.slice(text.length - tail)}`;
}

/**
 * Expand a leading `~` and resolve a candidate against the workspace.
 * @param {string} cwd - the session working directory.
 * @param {string} candidate - a path-like argument value.
 * @returns {string} an absolute path.
 */
export function resolveCandidate(cwd, candidate) {
  if (candidate === '~') return homedir();
  if (candidate.startsWith('~/')) return join(homedir(), candidate.slice(2));
  return isAbsolute(candidate) ? resolve(candidate) : resolve(cwd, candidate);
}

/**
 * Extract path-like values from one call's arguments.
 * @param {unknown} args - parsed arguments, or a raw string when unparsable.
 * @param {number} max - maximum number of candidates.
 * @returns {string[]} candidate paths, outermost-first, de-duplicated.
 */
export function collectPathCandidates(args, max = DEFAULT_LIMITS.evidencePaths) {
  const found = [];
  const seen = new Set();
  const walk = (value, key, depth) => {
    if (value === null || value === undefined || depth > 3) return;
    if (typeof value === 'string') {
      const looksLikePath = PATH_KEYS.has(key) || value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || value.startsWith('~/');
      if (!looksLikePath) return;
      if (value.includes('*') || value.includes('\n')) return;
      if (seen.has(value)) return;
      seen.add(value);
      found.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) walk(childValue, childKey.toLowerCase(), depth + 1);
    }
  };
  walk(args, '', 0);
  return found.slice(0, max);
}

/**
 * Describe one path without trusting the caller's arguments.
 * @param {string} cwd - the session working directory.
 * @param {string} candidate - a path-like argument value.
 * @param {(path: string) => {exists: boolean, type: string|null, sizeBytes: number|null}} probe -
 *   synchronous filesystem probe.
 * @returns {Readonly<{raw: string, path: string, insideWorkspace: boolean, exists: boolean, type: string|null, sizeBytes: number|null}>}
 */
export function describePath(cwd, candidate, probe) {
  const absolute = resolveCandidate(cwd, candidate);
  const rel = relative(resolve(cwd), absolute);
  const insideWorkspace = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  const probed = probe(absolute);
  return Object.freeze({
    raw: candidate,
    path: absolute,
    insideWorkspace,
    exists: probed.exists,
    type: probed.type,
    sizeBytes: probed.sizeBytes,
  });
}

/**
 * Default synchronous filesystem probe: existence, kind, and size only.
 * @param {string} path - absolute path.
 * @returns {{exists: boolean, type: string|null, sizeBytes: number|null}} the fact set.
 */
export function probePath(path) {
  try {
    const stats = statSync(path);
    return {
      exists: true,
      type: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other',
      sizeBytes: stats.isFile() ? stats.size : null,
    };
  } catch {
    return { exists: false, type: null, sizeBytes: null };
  }
}

/**
 * Read a session's events defensively.
 * @param {{snapshotEvents?: () => readonly unknown[]}|undefined} session - the requesting session.
 * @returns {readonly any[]} the retained events, newest-cap applied.
 */
function readEvents(session) {
  if (typeof session?.snapshotEvents !== 'function') return [];
  const events = session.snapshotEvents();
  return Array.isArray(events) ? events : [];
}

/**
 * Condense the recent conversation to plain user/assistant text.
 * @param {readonly any[]} events - session events in log order.
 * @param {number} maxChars - retained character budget.
 * @returns {{excerpt: string, truncated: boolean}} the excerpt and whether it was cut.
 */
export function conversationExcerpt(events, maxChars = DEFAULT_LIMITS.conversationChars) {
  const entries = [];
  for (const event of events) {
    if (event?.type === 'user/message') {
      const source = event.data?.source;
      if (source === null || typeof source !== 'object') continue;
      if (source.kind !== 'user' && source.kind !== 'agent-instructions') continue;
      const text = textOf(event.data?.content);
      if (text !== '') entries.push(`[${source.kind}] ${text}`);
      continue;
    }
    if (event?.type === 'assistant/message') {
      const text = textOf(event.data?.message?.content);
      if (text !== '') entries.push(`[assistant] ${text}`);
    }
  }
  const joined = entries.join('\n\n');
  return { excerpt: truncateMiddle(joined, maxChars), truncated: joined.length > maxChars };
}

/**
 * Join the text blocks of one content array.
 * @param {unknown} content - a content block array.
 * @returns {string} concatenated text.
 */
function textOf(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text !== '') parts.push(block.text);
  }
  return parts.join('\n');
}

/**
 * Parse a logged `tool/call` argument string the way the agent loop wrote it.
 * @param {string} raw - the logged JSON text.
 * @returns {unknown} the parsed value, or the raw text when it does not parse.
 */
export function parseLoggedArguments(raw) {
  if (typeof raw !== 'string') return raw ?? null;
  if (raw === '') return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Build the immutable evidence bundle for one pending approval.
 * @param {object} input - evidence inputs.
 * @param {{snapshotEvents?: () => readonly any[]}|undefined} input.session - the requesting session.
 * @param {string} input.toolName - the tool awaiting a decision.
 * @param {string|undefined} input.callId - the exact pending call, when known.
 * @param {string|undefined} input.reason - the asker's own explanation.
 * @param {string} input.cwd - the session working directory.
 * @param {Partial<typeof DEFAULT_LIMITS>} [input.limits] - cap overrides.
 * @param {(path: string) => {exists: boolean, type: string|null, sizeBytes: number|null}} [input.probe] - filesystem probe.
 * @param {number} [input.events] - maximum retained events.
 * @returns {Readonly<object>} the evidence bundle.
 */
export function buildSnapshot({
  session,
  toolName,
  callId,
  reason,
  cwd,
  limits,
  probe = probePath,
  events = DEFAULT_LIMITS.events,
}) {
  const caps = { ...DEFAULT_LIMITS, ...limits };
  const all = readEvents(session);
  const retained = all.length > events ? all.slice(all.length - events) : all;

  const { excerpt, truncated } = conversationExcerpt(retained, caps.conversationChars);

  let call;
  if (callId !== undefined) {
    for (let index = retained.length - 1; index >= 0; index -= 1) {
      const event = retained[index];
      if (event?.type === 'tool/call' && event.data?.callId === callId) {
        call = event.data;
        break;
      }
    }
  }

  const parsedArguments = call === undefined ? null : parseLoggedArguments(call.arguments);
  const argumentsText = parsedArguments === null
    ? null
    : typeof parsedArguments === 'string'
      ? truncateMiddle(parsedArguments, caps.argumentChars)
      : truncateMiddle(JSON.stringify(parsedArguments, null, 2), caps.argumentChars);

  const evidence = (call === undefined ? [] : collectPathCandidates(parsedArguments, caps.evidencePaths))
    .map((candidate) => describePath(cwd, candidate, probe));

  return Object.freeze({
    cwd,
    workspace: resolve(cwd),
    tool: toolName,
    callId: callId ?? null,
    askerReason: reason === undefined ? null : truncateMiddle(reason, caps.reasonChars),
    conversation: Object.freeze({ excerpt, truncated, entries: retained.length }),
    action: Object.freeze({
      name: toolName,
      argumentsFound: call !== undefined,
      argumentsText,
    }),
    evidence: Object.freeze(evidence),
  });
}
