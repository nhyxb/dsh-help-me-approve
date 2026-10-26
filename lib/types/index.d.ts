/**
 * Public surface of the “帮我批准” host plugin.
 * @module dsh-help-me-approve
 */

import type { Context } from '@deepseek-ai/cordis';

/** Cordis plugin name: matches the loader row id and the settings namespace. */
export declare const name = 'help-me-approve';

/** Host services that must exist before the reviewer mounts. */
export declare const inject: string[];

/** The permission preset key that activates the reviewer. */
export declare const PRESET = 'help-me-approve';

/** Plugin config; every field is volatile so the settings page can write it. */
export declare const Config: unknown;

/** Resolved, bounded config. */
export interface ResolvedConfig {
  /** Reviewer route provider, or `''` to follow the session route. */
  provider: string;
  /** Reviewer route model id, or `''` to follow the session route. */
  model: string;
  /** Hard review deadline in milliseconds. */
  timeoutMs: number;
  /** Fixed `'reject'`: a review that cannot decide never approves. */
  onFailure: 'reject';
}

/**
 * Normalize and bound raw config.
 * @param config - raw loader config.
 * @returns the resolved config.
 */
export declare function normalizeConfig(config?: Partial<{ provider: string; model: string; timeoutMs: number; onFailure: string }>): ResolvedConfig;

/**
 * Read the LLM route the session is currently using, from its last request header.
 * @param session - the requesting session.
 * @returns the route, when one is logged.
 */
export declare function currentRoute(session: { snapshotEvents?: () => readonly any[] } | undefined): { provider: string; model: string } | undefined;

/**
 * Whether the session is on the “帮我批准” preset.
 * @param ctx - plugin context.
 * @param session - the requesting session.
 * @returns true only for the matching preset.
 */
export declare function isActiveSession(ctx: Pick<Context, 'get'>, session: object | undefined): boolean;

/**
 * Render the replacement error text for a denied call.
 * @param denial - the settled denial.
 * @returns the error text handed to the acting agent.
 */
export declare function denialText(denial: { risk: string; reason?: string; model: string; tool: string }): string;

/**
 * Render the replacement error text for a review that could not decide.
 * @param failure - the settled failure.
 * @returns the error text handed to the acting agent.
 */
export declare function failureText(failure: { detail: string; reason: string; model: string; tool: string }): string;

/** Install the reviewer on `approval/request` and `tools/post-execute`. */
export declare function apply(ctx: Context, config?: object): void;

declare const plugin: { name: typeof name; inject: string[]; Config: unknown; apply: typeof apply };
export default plugin;
