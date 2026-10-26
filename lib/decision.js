/**
 * The reviewer's closed output protocol.
 *
 * The reviewer returns exactly one JSON object. Anything else — prose, a
 * second member, an allow with a reason, a `high` allow — is a protocol
 * failure, and the caller maps every protocol failure to a rejection
 * (fail-closed). Nothing here is lenient on purpose.
 * @module dsh-help-me-approve/decision
 */

/** Risk vocabulary shared with the prompt. */
export const RISK_LEVELS = Object.freeze(['low', 'medium', 'high']);

/** Decisions a reviewer may return. */
export const DECISIONS = Object.freeze(['allow', 'deny']);

/** Risks that may accompany an allow: a `high` allow is a contradiction. */
const ALLOW_RISKS = new Set(['low', 'medium']);

/** Risks that may accompany a deny: a `low` deny is a contradiction. */
const DENY_RISKS = new Set(['medium', 'high']);

/** Longest reviewer reason retained verbatim. */
export const MAX_REASON_CHARS = 600;

/** A malformed reviewer reply. `reason` is safe to log, never trusted as a decision. */
export class VerdictError extends Error {
  /**
   * @param {string} message - what was wrong with the reply.
   */
  constructor(message) {
    super(message);
    this.name = 'VerdictError';
  }
}

/**
 * Remove one enclosing Markdown code fence.
 *
 * Models routinely wrap a single JSON object in a ```json fence. That is a
 * formatting artifact, not a protocol relaxation: the inner text must still be
 * one bare JSON object, so nothing about the decision semantics loosens.
 * @param {string} text - raw reviewer text.
 * @returns {string} the text with at most one enclosing fence removed.
 */
export function stripCodeFence(text) {
  const trimmed = text.trim();
  const match = /^```(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(trimmed);
  return match === null ? trimmed : match[1].trim();
}

/**
 * Count `:` at the top level of a JSON text, ignoring strings.
 *
 * Duplicate members are invisible to `JSON.parse` (the last one wins), so this
 * is how a reply that repeats `decision` is caught instead of silently
 * resolved.
 * @param {string} text - JSON text.
 * @returns {number} top-level member separators.
 */
function topLevelMemberCount(text) {
  const syntax = text.replace(/"(?:\\.|[^"\\])*"/gs, '');
  let depth = 0;
  let count = 0;
  for (const char of syntax) {
    if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
    else if (char === ':' && depth === 1) count += 1;
  }
  return count;
}

/**
 * Parse and validate one reviewer reply.
 * @param {unknown} text - raw reviewer text.
 * @returns {Readonly<{decision: 'allow'|'deny', risk: 'low'|'medium'|'high', reason?: string}>}
 *   the validated verdict.
 * @throws {VerdictError} when the reply is not exactly one valid verdict object.
 */
export function parseVerdict(text) {
  if (typeof text !== 'string') throw new VerdictError('审核输出不是文本');
  const body = stripCodeFence(text);
  if (body === '') throw new VerdictError('审核输出为空');

  let value;
  try {
    value = JSON.parse(body);
  } catch (error) {
    throw new VerdictError(`审核输出不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new VerdictError('审核输出必须是单个 JSON 对象');
  }

  const keys = Object.keys(value);
  if (topLevelMemberCount(body) !== keys.length) throw new VerdictError('审核输出重复了顶层字段');

  const { decision, risk, reason } = /** @type {Record<string, unknown>} */ (value);
  if (typeof decision !== 'string' || !DECISIONS.includes(decision)) {
    throw new VerdictError('审核输出的 decision 必须是 allow 或 deny');
  }
  if (typeof risk !== 'string' || !RISK_LEVELS.includes(risk)) {
    throw new VerdictError('审核输出的 risk 必须是 low、medium 或 high');
  }

  if (decision === 'allow') {
    if (keys.length !== 2) throw new VerdictError('批准的审核输出只能有 decision 与 risk 两个字段');
    if (!ALLOW_RISKS.has(risk)) throw new VerdictError(`不允许以 ${risk} 风险批准`);
    return Object.freeze({ decision: 'allow', risk });
  }

  if (!DENY_RISKS.has(risk)) throw new VerdictError(`不允许以 ${risk} 风险拒绝`);
  if (keys.length === 2) return Object.freeze({ decision: 'deny', risk });
  if (keys.length !== 3) throw new VerdictError('拒绝的审核输出只能有 decision、risk、reason 三个字段');
  if (typeof reason !== 'string') throw new VerdictError('审核输出的 reason 必须是字符串');
  const trimmed = reason.trim();
  if (trimmed === '') throw new VerdictError('审核输出的 reason 不能为空');
  return Object.freeze({ decision: 'deny', risk, reason: trimmed.slice(0, MAX_REASON_CHARS) });
}
