import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createHarness } from './helpers/mini-react.js';

/**
 * Load the browser module the way DSH's module loader would: one
 * `window.__ModuleLoader__.load({id, factory})` call whose factory receives a
 * `require` that resolves the host-provided `react`.
 * @returns {Promise<{module: object, definition: object, harness: object, react: object}>} the loaded module.
 */
async function loadClient() {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  const harness = createHarness();
  let definition;
  const window = { __ModuleLoader__: { load(def) { definition = def; } } };
  new Function('window', source)(window);
  assert.equal(definition.id, 'dsh-help-me-approve');
  const module = definition.factory((id) => {
    assert.equal(id, 'react');
    return harness.react;
  });
  return { module, definition, harness, react: harness.react };
}

/** A settings document shaped like the host's describe reply. */
const document = {
  ok: true,
  value: [
    { ns: 'help-me-approve', revision: 3, value: { provider: '', model: '', timeoutMs: 15000, onFailure: 'reject' } },
    {
      ns: 'llm-pi-ai',
      revision: 9,
      value: { providers: { 'opencode-go': { models: [{ id: 'deepseek-v4.1-flash' }, { id: 'kimi-k3' }] } } },
    },
  ],
};

/** Install a fake browser context and capture the registered section. */
function mount(module, { onMutate, throwingLlm = false } = {}) {
  const registered = [];
  const mutations = [];
  const dictionaries = [];
  const remote = {
    settings: {
      describe: async () => document,
      mutate: async (ns, ops, revision) => {
        mutations.push({ ns, ops, revision });
        if (onMutate !== undefined) return onMutate(ns, ops, revision);
        return { ok: true, value: { revision: revision + 1 } };
      },
    },
    llm: {
      listConfigurableProviders: async () => ({
        ok: true,
        value: [{ provider: 'opencode-go', displayName: 'OpenCode Go', settingsNs: 'llm-pi-ai' }],
      }),
      listProviders: async () => ({
        ok: true,
        value: [{ id: 'opencode-go', name: 'OpenCode Go' }, { id: 'zai-coding-cn', name: 'ZAI' }],
      }),
    },
  };

  // Mirrors cordis: reading an undeclared `remote.<ns>` throws instead of
  // returning undefined.
  if (throwingLlm) {
    Object.defineProperty(remote, 'llm', {
      configurable: true,
      get() { throw new Error('cannot get property "remote.llm" without inject'); },
    });
  }
  const slots = {
    inject(name, callback) {
      assert.equal(name, 'settings.section');
      callback();
    },
    register(descriptor, component) {
      registered.push({ descriptor, component });
      return () => {};
    },
  };
  const ctx = {
    get(name) {
      if (name === 'slots') return slots;
      if (name === 'remote') return remote;
      if (name === 'locale') {
        return {
          register(ns, tables) { dictionaries.push({ ns, tables }); },
          bind: (ns) => (key) => tables(ns)[key],
        };
      }
      return undefined;
    },
    effect(fn) { fn(); },
  };
  const tables = () => ({ nav: '帮我批准' });
  module.apply(ctx);
  return { registered, mutations, dictionaries };
}
test('the module registers one settings section named after its namespace', async () => {
  const { module } = await loadClient();
  assert.equal(module.name, 'dsh-help-me-approve');
  assert.deepEqual(module.inject, ['slots', 'locale', 'remote', 'remote.settings', 'remote.llm']);
  const { registered, dictionaries } = mount(module);
  assert.equal(registered.length, 1);
  const { descriptor } = registered[0];
  assert.equal(descriptor.name, 'settings.section');
  assert.equal(descriptor.id, 'help-me-approve');
  assert.equal(descriptor.locale, 'settings.helpMeApprove');
  assert.equal(descriptor.label(), '帮我批准');
  assert.equal(dictionaries.length, 1);
  assert.equal(dictionaries[0].ns, 'settings.helpMeApprove');
});

test('load() reads the live provider and model catalogs out of the host', async () => {
  const { module } = await loadClient();
  const { registered } = mount(module);
  const injected = registered[0].descriptor.inject();
  const data = await injected.load();
  assert.deepEqual(data.providers, [
    { id: 'opencode-go', name: 'OpenCode Go', settingsNs: 'llm-pi-ai' },
    { id: 'zai-coding-cn', name: 'ZAI' },
  ]);
  assert.deepEqual(data.models['opencode-go'], ['deepseek-v4.1-flash', 'kimi-k3']);
  assert.deepEqual(data.models['zai-coding-cn'], []);
  assert.equal(data.value.revision, 3);
  assert.equal(data.value.timeoutMs, 15000);
});

test('save() writes the reviewer route into this plugin namespace at the current revision', async () => {
  const { module } = await loadClient();
  const { registered, mutations } = mount(module);
  const injected = registered[0].descriptor.inject();
  await injected.save({ provider: 'opencode-go', model: 'kimi-k3', timeoutMs: 30000, onFailure: 'reject' });
  assert.deepEqual(mutations, [{
    ns: 'help-me-approve',
    revision: 3,
    ops: [
      { op: 'set', path: ['provider'], value: 'opencode-go' },
      { op: 'set', path: ['model'], value: 'kimi-k3' },
      { op: 'set', path: ['timeoutMs'], value: 30000 },
      { op: 'set', path: ['onFailure'], value: 'reject' },
    ],
  }]);
});

test('a rejected write surfaces in the form instead of pretending success', async () => {
  const { module } = await loadClient();
  const { registered } = mount(module, { onMutate: () => ({ ok: false, error: { code: 'SETTINGS_CONFLICT', message: 'stale revision' } }) });
  const injected = registered[0].descriptor.inject();
  await assert.rejects(injected.save({ provider: 'p', model: 'm', timeoutMs: 1000 }), /stale revision/);
});

test('the form lists live providers and the models of the selected provider', async () => {
  const { module, harness, react } = await loadClient();
  const labels = module.zh;
  harness.render(react.createElement(module.SectionForm, {
    initial: { provider: 'opencode-go', model: 'kimi-k3', timeoutMs: 20000 },
    providers: [
      { id: 'opencode-go', name: 'OpenCode Go' },
      { id: 'zai-coding-cn', name: 'ZAI' },
    ],
    modelsFor: (id) => (id === 'opencode-go' ? ['deepseek-v4.1-flash', 'kimi-k3'] : []),
    onSave: async () => {},
    labels,
  }));

  const providerSelect = harness.find((node) => node.props['data-testid'] === 'hmp-provider');
  const providerText = harness.text((node) => node.props['data-testid'] === 'hmp-provider');
  assert.match(providerText, /跟随会话模型/);
  assert.match(providerText, /OpenCode Go/);
  assert.match(providerText, /ZAI/);
  assert.equal(providerSelect.props.value, 'opencode-go');

  const modelText = harness.text((node) => node.props['data-testid'] === 'hmp-model');
  assert.match(modelText, /deepseek-v4\.1-flash/);
  assert.match(modelText, /kimi-k3/);
  assert.match(harness.text(), /拒绝（fail-closed，不可放松）/);
});

test('switching provider switches the model control and clears an unknown model', async () => {
  const { module, harness, react } = await loadClient();
  harness.render(react.createElement(module.SectionForm, {
    initial: { provider: 'opencode-go', model: 'kimi-k3', timeoutMs: 20000 },
    providers: [{ id: 'opencode-go', name: 'OpenCode Go' }, { id: 'zai-coding-cn', name: 'ZAI' }],
    modelsFor: (id) => (id === 'opencode-go' ? ['deepseek-v4.1-flash', 'kimi-k3'] : []),
    onSave: async () => {},
    labels: module.zh,
  }));

  const providerSelect = harness.find((node) => node.props['data-testid'] === 'hmp-provider');
  harness.change(providerSelect, 'zai-coding-cn');

  const model = harness.find((node) => node.props['data-testid'] === 'hmp-model');
  assert.equal(model.type, 'input');
  assert.equal(model.props.value, '');
  assert.equal(model.props.placeholder, module.zh.modelManual);

  const providerSelectAfter = harness.find((node) => node.props['data-testid'] === 'hmp-provider');
  harness.change(providerSelectAfter, 'opencode-go');
  const selectAgain = harness.find((node) => node.props['data-testid'] === 'hmp-model');
  assert.equal(selectAgain.type, 'select');
  assert.match(harness.text((node) => node.props['data-testid'] === 'hmp-model'), /deepseek-v4\.1-flash/);
});

test('saving sends the chosen route, the timeout, and the fixed failure policy', async () => {
  const { module, harness, react } = await loadClient();
  const saved = [];
  harness.render(react.createElement(module.SectionForm, {
    initial: { provider: '', model: '', timeoutMs: 20000 },
    providers: [{ id: 'opencode-go', name: 'OpenCode Go' }],
    modelsFor: (id) => (id === 'opencode-go' ? ['deepseek-v4.1-flash', 'kimi-k3'] : []),
    onSave: async (payload) => { saved.push(payload); },
    labels: module.zh,
  }));

  harness.change(harness.find((node) => node.props['data-testid'] === 'hmp-provider'), 'opencode-go');
  harness.change(harness.find((node) => node.props['data-testid'] === 'hmp-model'), 'kimi-k3');
  harness.change(harness.find((node) => node.props['data-testid'] === 'hmp-timeout'), '45000');

  harness.click(harness.find((node) => node.props['data-testid'] === 'hmp-save'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.settle();

  assert.deepEqual(saved, [{ provider: 'opencode-go', model: 'kimi-k3', timeoutMs: 45000, onFailure: 'reject' }]);
  assert.equal(harness.text((node) => node.props['data-testid'] === 'hmp-status'), module.zh.saved);
});

test('an invalid timeout is refused before any write', async () => {
  const { module, harness, react } = await loadClient();
  const saved = [];
  harness.render(react.createElement(module.SectionForm, {
    initial: { provider: 'p', model: 'm', timeoutMs: 20000 },
    providers: [],
    modelsFor: () => [],
    onSave: async (payload) => { saved.push(payload); },
    labels: module.zh,
  }));
  harness.change(harness.find((node) => node.props['data-testid'] === 'hmp-timeout'), '0');
  harness.click(harness.find((node) => node.props['data-testid'] === 'hmp-save'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.settle();
  assert.deepEqual(saved, []);
  assert.match(harness.text((node) => node.props['data-testid'] === 'hmp-status'), /保存失败/);
});

test('the section renders loading, then the form, then a load error', async () => {
  const { module, harness, react } = await loadClient();
  const data = {
    value: { provider: 'opencode-go', model: 'kimi-k3', timeoutMs: 20000 },
    providers: [{ id: 'opencode-go', name: 'OpenCode Go' }],
    models: { 'opencode-go': ['kimi-k3'] },
  };
  harness.render(react.createElement(module.Section, { load: async () => data, save: async () => {}, labels: module.zh }));
  assert.equal(harness.find((node) => node.props['data-testid'] === 'hmp-loading') !== undefined, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.settle();
  assert.equal(harness.find((node) => node.props['data-testid'] === 'hmp-section') !== undefined, true);
  assert.match(harness.text((node) => node.props['data-testid'] === 'hmp-model'), /kimi-k3/);
});

test('a runtime that refuses remote.llm degrades to manual model entry', async () => {
  const { module, harness, react } = await loadClient();
  const { registered } = mount(module, { throwingLlm: true });
  const injected = registered[0].descriptor.inject();
  const data = await injected.load();
  assert.deepEqual(data.providers, []);
  assert.deepEqual(data.models, {});
  assert.equal(data.value.timeoutMs, 15000);

  const saved = [];
  harness.render(react.createElement(module.SectionForm, {
    initial: data.value,
    providers: data.providers,
    modelsFor: (id) => data.models[id] || [],
    onSave: async (payload) => { saved.push(payload); },
    labels: module.zh,
  }));
  const model = harness.find((node) => node.props['data-testid'] === 'hmp-model');
  assert.equal(model.type, 'input');
  harness.change(model, 'deepseek-v4.1-flash');
  harness.click(harness.find((node) => node.props['data-testid'] === 'hmp-save'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(saved, [{ provider: '', model: 'deepseek-v4.1-flash', timeoutMs: 15000, onFailure: 'reject' }]);
});

test('apply injects one scoped stylesheet that follows the host theme tokens', async () => {
  const { module } = await loadClient();
  const appended = [];
  const head = { appendChild(node) { appended.push(node); } };
  globalThis.document = {
    head,
    createElement() {
      const style = {
        dataset: {},
        textContent: '',
        remove() {
          const index = appended.indexOf(style);
          if (index >= 0) appended.splice(index, 1);
        },
      };
      return style;
    },
  };
  try {
    const disposers = [];
    const ctx = {
      get(name) {
        if (name === 'slots') return { inject(_slot, callback) { callback(); }, register() { return () => {}; } };
        return undefined;
      },
      effect(callback) {
        const disposer = callback();
        if (typeof disposer === 'function') disposers.push(disposer);
      },
    };
    module.apply(ctx);

    assert.equal(appended.length, 1);
    const sheet = appended[0];
    assert.equal(sheet.dataset.plugin, 'dsh-help-me-approve-ui');
    // 结构：卡片 + label 列 + 控件行，全部落在 .hmp- 作用域内
    assert.match(sheet.textContent, /\.hmp-card\{/);
    assert.match(sheet.textContent, /\.hmp-flabel\{/);
    assert.match(sheet.textContent, /\.hmp-btn-primary\{/);
    // 颜色只走宿主变量，不写死底色，也不越权覆盖宿主
    assert.match(sheet.textContent, /--hmp-t1:var\(--dsw-alias-label-primary/);
    assert.match(sheet.textContent, /--hmp-accent-ink:var\(--dsw-alias-label-primary-foreground/);
    assert.equal(sheet.textContent.includes('!important'), false);
    assert.equal(/^\s*(html|body|:root)\b/m.test(sheet.textContent), false);
    // 只引用宿主变量，绝不重新定义它们（定义会写成 `--dsw-alias-x:`）
    assert.equal(/--dsw-alias-[a-z0-9-]+:/.test(sheet.textContent), false);

    for (const dispose of disposers) dispose();
    assert.equal(appended.length, 0);
  } finally {
    delete globalThis.document;
  }
});
