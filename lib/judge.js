/**
 * One reviewer call: stream a decision from the configured LLM route.
 *
 * Every non-decision outcome throws a typed failure. The caller maps any
 * failure to a rejection, so this module never invents an allow.
 * @module dsh-help-me-approve/judge
 */

import { VerdictError, parseVerdict } from './decision.js';
/** Why a review could not produce a decision. */
export const FAILURE_KINDS = Object.freeze(['unavailable', 'timeout', 'aborted', 'provider', 'protocol']);

/** A review that produced no usable verdict. */
export class ReviewFailure extends Error {
  /**
   * @param {'unavailable'|'timeout'|'aborted'|'provider'|'protocol'} kind - failure class.
   * @param {string} message - human-readable detail, safe to show the agent.
   */
  constructor(kind, message) {
    super(message);
    this.name = 'ReviewFailure';
    this.kind = kind;
  }
}

/**
 * Build a caller-cancellable, deadline-bounded signal.
 * @param {AbortSignal|undefined} signal - the approval request's own signal.
 * @param {number} timeoutMs - hard deadline in milliseconds; 0 disables it.
 * @returns {{signal: AbortSignal|undefined, dispose: () => void, timedOut: () => boolean}} the guard.
 */
function deadline(signal, timeoutMs) {
  if (!(timeoutMs > 0)) return { signal, dispose: () => {}, timedOut: () => false };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('review deadline exceeded'));
  }, timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  const merged = signal === undefined
    ? controller.signal
    : typeof AbortSignal.any === 'function'
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
  return { signal: merged, dispose: () => clearTimeout(timer), timedOut: () => timedOut };
}

/**
 * Read the text of one streamed reviewer reply.
 * @param {AsyncIterable<any>} stream - the LLM stream.
 * @returns {Promise<string>} the finished text.
 * @throws {ReviewFailure} when the stream fails or does not finish normally.
 */
async function readText(stream) {
  let text = '';
  let finished = false;
  let finishReason;
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
    else if (chunk?.type === 'finish') {
      finished = true;
      finishReason = chunk.reason;
    }
  }
  if (!finished) throw new ReviewFailure('provider', '审核模型没有发出结束信号');
  if (finishReason?.kind !== 'stop') {
    const detail = finishReason?.failure === undefined
      ? String(finishReason?.kind ?? 'unknown')
      : `${finishReason.failure.code ?? finishReason.kind}: ${finishReason.failure.message ?? ''}`;
    throw new ReviewFailure('provider', `审核模型异常结束（${detail}）`);
  }
  return text;
}

/**
 * Ask one route for a verdict.
 * @param {object} input - review inputs.
 * @param {{stream: (options: object) => AsyncIterable<any>}|undefined} input.llm - the host LLM service.
 * @param {string|undefined} input.provider - the LLM route provider.
 * @param {string|undefined} input.model - the LLM route model id.
 * @param {string} input.system - the fixed policy.
 * @param {string} input.text - the rendered evidence text.
 * @param {AbortSignal} [input.signal] - cancellation.
 * @param {number} [input.timeoutMs] - review deadline.
 * @returns {Promise<Readonly<{decision: string, risk: string, reason?: string}>>} the verdict.
 * @throws {ReviewFailure} on every failure path.
 */
export async function review({ llm, provider, model, system, text, signal, timeoutMs = 20000 }) {
  if (llm === undefined || typeof llm.stream !== 'function') {
    throw new ReviewFailure('unavailable', '宿主没有可用的 llm 服务');
  }
  if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') {
    throw new ReviewFailure('unavailable', '没有确定审核模型（provider/model 都为空）');
  }
  if (signal?.aborted === true) throw new ReviewFailure('aborted', '审批请求已被取消');

  const guard = deadline(signal, timeoutMs);
  try {
    const stream = llm.stream({
      provider,
      model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      temperature: 0,
      ...guard.signal === undefined ? {} : { signal: guard.signal },
    });
    const raw = await Promise.race([
      readText(stream),
      new Promise((_, reject) => {
        if (!(timeoutMs > 0)) return;
        const timer = setTimeout(() => reject(new ReviewFailure('timeout', `审核超时（${timeoutMs}ms）`)), timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
    return parseVerdict(raw);
  } catch (error) {
    if (error instanceof ReviewFailure) throw error;
    if (error instanceof VerdictError) throw new ReviewFailure('protocol', `审核输出不合协议：${error.message}`);
    if (guard.timedOut()) throw new ReviewFailure('timeout', `审核超时（${timeoutMs}ms）`);
    if (signal?.aborted === true) throw new ReviewFailure('aborted', '审批请求已被取消');
    throw new ReviewFailure('provider', `审核调用失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    guard.dispose();
  }
}
