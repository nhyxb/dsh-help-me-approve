/**
 * Which session preset turns the reviewer on.
 *
 * “帮我批准” is a permission preset whose knobs (workspace-write + ask) are
 * identical to the built-in `workspace-write` preset. Knob matching therefore
 * cannot distinguish them, so activation reads the LAST `permission/preset`
 * the session logged (folding to the deployment default only when the session
 * never selected one).
 * @module dsh-help-me-approve/activate
 */

/** The preset key that activates the reviewer. */
export const HELP_ME_APPROVE_PRESET = 'help-me-approve';

/**
 * Resolve the preset a session is currently on.
 * @param {{preset?: string|null}|undefined} state - the `permissions` session-projection state.
 * @param {string|undefined} defaultPreset - the deployment default for fresh sessions.
 * @returns {string|undefined} the selected preset key, or `undefined` when unknown.
 */
export function resolvePreset(state, defaultPreset) {
  // An unreadable projection is not "no selection": activation must stay off
  // rather than guess from the deployment default.
  if (state === undefined || state === null) return undefined;
  const logged = state.preset;
  if (typeof logged === 'string' && logged !== '') return logged;
  if (typeof defaultPreset === 'string' && defaultPreset !== '') return defaultPreset;
  return undefined;

}

/**
 * Whether the reviewer owns this session's approval requests.
 * @param {{preset?: string|null}|undefined} state - the `permissions` session-projection state.
 * @param {string|undefined} defaultPreset - the deployment default for fresh sessions.
 * @returns {boolean} true only when the session is on the “帮我批准” preset.
 */
export function isHelpMeApproveActive(state, defaultPreset) {
  return resolvePreset(state, defaultPreset) === HELP_ME_APPROVE_PRESET;
}
