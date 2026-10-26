/**
 * Append-only audit trail for reviewer decisions.
 * @module dsh-help-me-approve/audit
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve the audit directory from `DSH_HOME`.
 * @param {Record<string, string|undefined>} [env] - environment to read; defaults to `process.env`.
 * @returns {string} absolute directory path.
 */
export function defaultAuditDir(env = process.env) {
  const home = typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== ''
    ? env.DSH_HOME.trim()
    : join(homedir(), '.dsh');
  return join(home, 'help-me-approve');
}

/**
 * Create one serialized JSONL writer.
 *
 * Writes are chained so interleaved reviews cannot produce a torn line, and
 * every failure is reported through `onError` instead of rejecting the caller:
 * an audit failure must never change an approval decision.
 * @param {object} [options] - writer options.
 * @param {string} [options.dir] - directory; defaults to `defaultAuditDir()`.
 * @param {string} [options.file] - file name inside `dir`.
 * @param {() => string} [options.now] - timestamp source.
 * @param {(error: unknown) => void} [options.onError] - audit failure sink.
 * @returns {{path: string, record: (entry: object) => Promise<void>, flush: () => Promise<void>}} the writer.
 */
export function createAuditLog({ dir = defaultAuditDir(), file = 'audit.jsonl', now = () => new Date().toISOString(), onError } = {}) {
  const path = join(dir, file);
  let chain = Promise.resolve();
  const fail = (error) => {
    if (typeof onError === 'function') {
      try {
        onError(error);
      } catch {
        /* an audit sink must not throw into the approval path */
      }
    }
  };
  return {
    path,
    record(entry) {
      chain = chain
        .then(async () => {
          await mkdir(dir, { recursive: true });
          await appendFile(path, `${JSON.stringify({ time: now(), ...entry })}\n`, 'utf8');
        })
        .catch(fail);
      return chain;
    },
    flush() {
      return chain;
    },
  };
}
