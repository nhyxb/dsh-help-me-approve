/**
 * “帮我批准” — an independent reviewer for permission escalations.
 *
 * The plugin owns one seam: `approval/request`. DSH routes every sandbox or
 * policy escalation through `ctx.approval.request`, so the reviewer answers the
 * questions a human would otherwise see. It deliberately does NOT touch
 * `tools/pre-execute`: returning an allow there would bypass the sandbox
 * instead of asking about it.
 *
 * The approval vocabulary is closed (`allowed-once|rejected|cancelled|unavailable`)
 * and carries no text, so a denial's reason can only reach the acting agent by
 * rewriting the failed result in `tools/post-execute`.
 * @module dsh-help-me-approve
 */

import z from '@deepseek-ai/schemastery';
import { HELP_ME_APPROVE_PRESET, isHelpMeApproveActive } from './activate.js';
import { createAuditLog } from './audit.js';
import { buildSnapshot } from './evidence.js';
import { ReviewFailure, review } from './judge.js';
import { AGENT_GUIDANCE, REVIEW_POLICY, renderReviewInput } from './prompt.js';

/** Cordis plugin name used by loader diagnostics and the settings namespace. */
export const name = 'help-me-approve';

/** Host services that must exist before the reviewer may mount. */
export const inject = ['approval', 'llm'];

/** The preset key this plugin answers for. */
export const PRESET = HELP_ME_APPROVE_PRESET;

/** Largest number of settled decisions kept for a later `post-execute` rewrite. */
const PENDING_LIMIT = 64;

/** Hard bounds for the review deadline setting. */
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120000;
const DEFAULT_TIMEOUT_MS = 20000;

/**
 * Plugin config. Every field is `volatile`, which is what makes it writable
 * from the settings page (and only from there).
 */
export const Config = z.object({
  /** Reviewer LLM route provider; empty means “follow the session route”. */
  provider: z.string().volatile().default(''),
  /** Reviewer LLM route model id; empty means “follow the session route”. */
  model: z.string().volatile().default(''),
  /** Hard review deadline in milliseconds. */
  timeoutMs: z.number().volatile().default(DEFAULT_TIMEOUT_MS),
  /** Failure policy. Fixed to `reject`: a review that cannot decide never approves. */
  onFailure: z.string().volatile().default('reject'),
});

/**
 * Normalize and bound the incoming config.
 * @param {Partial<{provider: string, model: string, timeoutMs: number, onFailure: string}>} [config] - raw config.
 * @returns {{provider: string, model: string, timeoutMs: number, onFailure: 'reject'}} the resolved config.
 */
export function normalizeConfig(config = {}) {
  const provider = typeof config.provider === 'string' ? config.provider.trim() : '';
  const model = typeof config.model === 'string' ? config.model.trim() : '';
  const paired = provider !== '' && model !== '';
  const requested = typeof config.timeoutMs === 'number' && Number.isFinite(config.timeoutMs)
    ? config.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const timeoutMs = Math.min(Math.max(Math.round(requested), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
  return {
    provider: paired ? provider : '',
    model: paired ? model : '',
    timeoutMs,
    onFailure: 'reject',
  };
}

/**
 * Read the LLM route the session is currently using.
 * @param {{snapshotEvents?: () => readonly any[]}|undefined} session - the requesting session.
 * @returns {{provider: string, model: string}|undefined} the route, when one is logged.
 */
export function currentRoute(session) {
  if (typeof session?.snapshotEvents !== 'function') return undefined;
  const events = session.snapshotEvents();
  if (!Array.isArray(events)) return undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'request/header') continue;
    const config = event.data?.header?.config;
    if (config !== null && typeof config === 'object'
      && typeof config.provider === 'string' && config.provider !== ''
      && typeof config.model === 'string' && config.model !== '') {
      return { provider: config.provider, model: config.model };
    }
  }
  return undefined;
}

/**
 * Whether this session is on the “帮我批准” preset.
 * @param {{get: (name: string) => any}} ctx - plugin context with lazy service reads.
 * @param {object|undefined} session - the requesting session.
 * @returns {boolean} true only for the matching preset.
 */
export function isActiveSession(ctx, session) {
  if (session === undefined || session === null) return false;
  try {
    const projections = ctx.get('sessionProjections');
    const state = projections?.stateOf?.(session, 'permissions');
    const defaultPreset = ctx.get('permissionPresets')?.defaultPreset;
    return isHelpMeApproveActive(state, defaultPreset);
  } catch {
    return false;
  }
}

/**
 * Render the error content that replaces a rejected call's result.
 *
 * This text is the only channel through which the reviewer's reason reaches the
 * acting agent, so it states the refusal, the reason, and the no-workaround rule.
 * @param {{risk: string, reason?: string, model: string, tool: string}} denial - the settled denial.
 * @returns {string} the replacement error text.
 */
export function denialText({ risk, reason, model, tool }) {
  return [
    `帮我批准：审核代理拒绝了工具 "${tool}" 的这次调用（风险 ${risk}，审核模型 ${model}）。`,
    reason === undefined ? undefined : `拒绝理由：${reason}`,
    '这个拒绝对本次调用是最终决定：不要用等价参数重试，不要拆分调用，也不要换工具或 shell 绕过。',
    '如果能找到留在当前权限边界内的更低风险做法，就采用并说明改动；否则停下来向用户说明你想做什么、为什么被拒，并请求确认。',
  ].filter((line) => line !== undefined).join('\n');
}

/**
 * Render the error content for a review that could not decide.
 * @param {{detail: string, reason: string, model: string, tool: string}} failure - the settled failure.
 * @returns {string} the replacement error text.
 */
export function failureText({ detail, reason, model, tool }) {
  return [
    `帮我批准：审核代理未能给出裁决，已按 fail-closed 拒绝工具 "${tool}" 的这次调用（${detail}，审核模型 ${model}）。`,
    `原因：${reason}`,
    '这不是用户的拒绝，但本次调用同样不能执行：不要重试同一调用，也不要用别的工具绕过。',
    '可以改用留在当前权限边界内的低风险方案；否则停下来向用户说明审核不可用的原因，并请求人工确认。',
  ].join('\n');
}

/**
 * Mount the reviewer.
 * @param {{on: Function, get: Function, inject: Function, logger?: {warn: Function}, effect: Function}} ctx - plugin context.
 * @param {object} [config] - raw plugin config.
 */
export function apply(ctx, config) {
  const settings = normalizeConfig(config);
  const pending = new Map();
  const audit = createAuditLog({
    onError: (error) => ctx.logger?.warn?.(`help-me-approve: 审计写入失败：${error instanceof Error ? error.message : String(error)}`),
  });

  const remember = (callId, entry) => {
    if (callId === undefined || callId === null) return;
    pending.set(callId, entry);
    while (pending.size > PENDING_LIMIT) {
      const oldest = pending.keys().next();
      if (oldest.done === true) break;
      pending.delete(oldest.value);
    }
  };
  ctx.logger?.info?.(
    `help-me-approve: 审核代理已挂载（timeout ${settings.timeoutMs}ms，审核模型：`
    + `${settings.provider === '' ? '跟随会话' : `${settings.provider}/${settings.model}`}）`,
  );

  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.context({
      name: 'help-me-approve:policy',
      order: scope.systemPrompt.getContextOrder('APPROVAL_POLICY'),
      text: (context) => (isActiveSession(ctx, context.agent?.session) ? AGENT_GUIDANCE : ''),
    });
  });

  ctx.on('approval/request', async (req, next) => {
    const session = req?.agent?.session;
    if (!isActiveSession(ctx, session)) return next();

    const route = settings.provider === '' ? currentRoute(session) : { provider: settings.provider, model: settings.model };
    const routeLabel = route === undefined ? '未确定' : `${route.provider}/${route.model}`;
    const cwd = typeof session.header?.cwd === 'string' && session.header.cwd !== '' ? session.header.cwd : process.cwd();

    let entry;
    try {
      const snapshot = buildSnapshot({
        session,
        toolName: req.toolName,
        callId: req.callId,
        reason: req.reason,
        cwd,
      });
      const verdict = await review({
        llm: ctx.get('llm'),
        provider: route?.provider,
        model: route?.model,
        system: REVIEW_POLICY,
        text: renderReviewInput(snapshot),
        signal: req.signal,
        timeoutMs: settings.timeoutMs,
      });
      entry = {
        ok: true,
        decision: verdict.decision === 'allow' ? 'allow' : 'reject',
        risk: verdict.risk,
        reason: verdict.reason,
        model: routeLabel,
        tool: req.toolName,
      };
    } catch (error) {
      const failure = error instanceof ReviewFailure
        ? error
        : new ReviewFailure('provider', error instanceof Error ? error.message : String(error));
      entry = {
        ok: false,
        decision: 'reject',
        risk: 'unknown',
        detail: failure.kind,
        reason: failure.message,
        model: routeLabel,
        tool: req.toolName,
      };
    }

    remember(req.callId, entry);
    void audit.record({
      decision: entry.decision,
      risk: entry.risk,
      tool: entry.tool,
      callId: req.callId ?? null,
      model: entry.model,
      reason: entry.reason ?? null,
      failure: entry.ok ? null : entry.detail,
      preset: PRESET,
    });
    return entry.decision === 'allow' ? 'allowed-once' : 'rejected';
  }, { prepend: true });

  ctx.on('tools/post-execute', (exec, result, next) => {
    const callId = exec?.callId;
    const entry = callId === undefined ? undefined : pending.get(callId);
    if (entry === undefined) return next();
    if (result?.isError !== true) return next();
    pending.delete(callId);
    const text = entry.ok
      ? denialText({ risk: entry.risk, reason: entry.reason, model: entry.model, tool: entry.tool })
      : failureText({ detail: entry.detail, reason: entry.reason, model: entry.model, tool: entry.tool });
    return { kind: 'block', feedback: [{ type: 'text', text }] };
  });
}

export default { name, inject, Config, apply };
