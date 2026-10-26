import assert from 'node:assert/strict';
import test from 'node:test';

import { HELP_ME_APPROVE_PRESET, isHelpMeApproveActive, resolvePreset } from '../lib/activate.js';
import { normalizeConfig } from '../lib/index.js';

test('the preset key is the stable identity used by the profile patch', () => {
  assert.equal(HELP_ME_APPROVE_PRESET, 'help-me-approve');
});

test('activates only on an explicit selection of the preset', () => {
  assert.equal(isHelpMeApproveActive({ preset: 'help-me-approve', sandbox: 'workspace-write', approval: 'ask' }, 'workspace-write'), true);
  assert.equal(isHelpMeApproveActive({ preset: 'workspace-write', sandbox: 'workspace-write', approval: 'ask' }, 'workspace-write'), false);
  assert.equal(isHelpMeApproveActive({ preset: 'danger-full-access', sandbox: 'danger-full-access', approval: 'never' }, 'workspace-write'), false);
});

test('a session with no logged selection falls back to the deployment default', () => {
  assert.equal(isHelpMeApproveActive({ preset: null }, 'help-me-approve'), true);
  assert.equal(isHelpMeApproveActive({ preset: null }, 'workspace-write'), false);
  assert.equal(isHelpMeApproveActive({ preset: '' }, 'help-me-approve'), true);
});

test('an unreadable projection never activates the reviewer', () => {
  assert.equal(isHelpMeApproveActive(undefined, 'help-me-approve'), false);
  assert.equal(isHelpMeApproveActive(undefined, undefined), false);
  assert.equal(resolvePreset({}, undefined), undefined);
});

test('identical knobs do not activate: only the logged preset name counts', () => {
  const identical = { preset: 'workspace-write', sandbox: 'workspace-write', approval: 'ask' };
  assert.equal(isHelpMeApproveActive(identical, 'help-me-approve'), false);
});

test('config is paired and bounded', () => {
  assert.deepEqual(normalizeConfig({ provider: 'p', model: 'm', timeoutMs: 5000 }), {
    provider: 'p',
    model: 'm',
    timeoutMs: 5000,
    onFailure: 'reject',
  });
  assert.deepEqual(normalizeConfig({ provider: 'p', model: '' }), { provider: '', model: '', timeoutMs: 20000, onFailure: 'reject' });
  assert.equal(normalizeConfig({ timeoutMs: 1 }).timeoutMs, 1000);
  assert.equal(normalizeConfig({ timeoutMs: 9_999_999 }).timeoutMs, 120000);
  assert.equal(normalizeConfig({ provider: 'p', model: 'm', onFailure: 'ask' }).onFailure, 'reject');
});
