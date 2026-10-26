window.__ModuleLoader__.load({
  id: "dsh-help-me-approve",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");

    /** Dictionary namespace owned by this plugin. */
    var NS = "settings.helpMeApprove";
    /** Settings namespace = this plugin's loader row id. */
    var SETTINGS_NS = "help-me-approve";
    /** Plugin name: matches the package name, the graph row id, and the bundle id. */
    var name = "dsh-help-me-approve";
    /** Services the page reads: the section slot, dictionaries, settings, and the read-only llm catalog. */
    var inject = ["slots", "locale", "remote", "remote.settings", "remote.llm"];

    var zh = {
      nav: "帮我批准",
      title: "帮我批准 · 审核模型",
      hint: "选中“帮我批准”权限预设后，越过权限边界的操作交给审核代理裁决。这里设置审核代理使用的模型；留空表示跟随会话当前模型。",
      provider: "审核模型服务商",
      model: "审核模型",
      modelManual: "该服务商没有可枚举的模型目录，请直接填写模型 id",
      timeout: "审核超时（毫秒）",
      failure: "审核失败处理",
      failureFixed: "拒绝（fail-closed，不可放松）",
      follow: "跟随会话模型",
      modeFollow: "跟随会话模型",
      timeoutNote: "超时即拒绝",
      save: "保存",
      saving: "保存中…",
      saved: "已保存",
      failed: "保存失败：{error}",
      loading: "加载中…",
      loadFailed: "读取设置失败：{error}",
      current: "当前生效：{model}",
      audit: "审计日志：{path}"
    };
    var en = {
      nav: "Help me approve",
      title: "Help me approve · reviewer model",
      hint: "With the “Help me approve” permission preset selected, operations that cross the permission boundary are decided by a reviewer agent. Choose the reviewer's model here; leave it empty to follow the session model.",
      provider: "Reviewer provider",
      model: "Reviewer model",
      modelManual: "This provider advertises no model catalog; type the model id",
      timeout: "Review timeout (ms)",
      failure: "On review failure",
      failureFixed: "Reject (fail-closed, not relaxable)",
      follow: "Follow the session model",
      modeFollow: "Following the session model",
      timeoutNote: "Times out as a rejection",
      save: "Save",
      saving: "Saving…",
      saved: "Saved",
      failed: "Save failed: {error}",
      loading: "Loading…",
      loadFailed: "Could not read settings: {error}",
      current: "In effect: {model}",
      audit: "Audit log: {path}"
    };

    /** Fill `{name}` placeholders without a template engine. */
    function format(template, values) {
      return String(template).replace(/\{(\w+)\}/g, function (_, key) {
        return values && values[key] !== undefined ? String(values[key]) : "{" + key + "}";
      });
    }

    /** Find this plugin's settings descriptor in whatever `settings.describe` returns. */
    function pickNamespace(document, ns) {
      var list = [];
      if (Array.isArray(document)) list = document;
      else if (document && Array.isArray(document.namespaces)) list = document.namespaces;
      else if (document && Array.isArray(document.documents)) list = document.documents;
      else if (document && Array.isArray(document.entries)) list = document.entries;
      for (var i = 0; i < list.length; i += 1) {
        var entry = list[i];
        if (!entry || typeof entry !== "object") continue;
        if (entry.ns === ns || entry.namespace === ns || entry.id === ns) return entry;
      }
      return undefined;
    }

    /** Read the four editable fields out of a settings descriptor. */
    function readValue(descriptor) {
      var value = descriptor && typeof descriptor.value === "object" && descriptor.value !== null ? descriptor.value : {};
      var timeout = Number(value.timeoutMs);
      return {
        provider: typeof value.provider === "string" ? value.provider : "",
        model: typeof value.model === "string" ? value.model : "",
        timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 20000,
        onFailure: "reject",
        revision: typeof descriptor?.revision === "number" ? descriptor.revision : undefined
      };
    }

    /** Model ids a provider plugin declares in its own settings namespace. */
    function collectModels(document, providers) {
      var table = {};
      for (var i = 0; i < providers.length; i += 1) {
        var provider = providers[i];
        table[provider.id] = [];
        if (typeof provider.settingsNs !== "string") continue;
        var descriptor = pickNamespace(document, provider.settingsNs);
        var config = descriptor && descriptor.value;
        var section = config && config.providers && config.providers[provider.id];
        var models = section && section.models;
        if (!Array.isArray(models)) continue;
        table[provider.id] = models
          .map(function (entry) { return typeof entry === "string" ? entry : entry && (entry.id || entry.name); })
          .filter(function (id) { return typeof id === "string" && id !== ""; });
      }
      return table;
    }

    /** Settings writes: one path-addressed op per field. */
    function buildSaveOps(value) {
      return [
        { op: "set", path: ["provider"], value: value.provider },
        { op: "set", path: ["model"], value: value.model },
        { op: "set", path: ["timeoutMs"], value: value.timeoutMs },
        { op: "set", path: ["onFailure"], value: "reject" }
      ];
    }

    /* ══════════════════════════════════════════════════════════════════════
     * 样式：自己注入一层 <style>，全部选择器落在 .hmp-* 作用域内。
     * 颜色只从宿主 --dsw-alias-* 变量取（带兜底值），不写死深/浅底，于是自动跟随主题；
     * 不碰 :root/html/body、不覆盖宿主变量、没有裸元素选择器、没有 !important。
     * 结构与密度对齐 dsh 自己的设置页：卡片 1px 边框 + 圆角、label 列右对齐、控件统一 30px 高。
     * ══════════════════════════════════════════════════════════════════════ */
    var STYLE_OWNER = "dsh-help-me-approve-ui";

    var CSS = [
      ".hmp-wrap{--hmp-r:12px;--hmp-r-ctl:8px;--hmp-h:30px;",
      "--hmp-line:var(--dsw-alias-border-l2,rgba(127,127,127,.28));",
      "--hmp-line-soft:var(--dsw-alias-border-l1,rgba(127,127,127,.18));",
      "--hmp-card-bg:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));",
      "--hmp-inset-bg:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.03));",
      "--hmp-t1:var(--dsw-alias-label-primary,#e6e6e6);",
      "--hmp-t2:var(--dsw-alias-label-secondary,#9aa0a6);",
      "--hmp-t3:var(--dsw-alias-label-tertiary,#8b9198);",
      "--hmp-accent:var(--dsw-alias-brand-primary,#4c8dff);",
      "--hmp-accent-ink:var(--dsw-alias-label-primary-foreground,#0b0b0d);",
      "--hmp-accent-fill:var(--dsw-alias-button-primary-fill,rgba(76,141,255,.16));",
      "--hmp-accent-hover:var(--dsw-alias-button-primary-hover,rgba(76,141,255,.26));",
      "--hmp-hover:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.10));",
      "--hmp-warn:var(--dsw-alias-state-warn-label,#e5a03c);",
      "--hmp-warn-bg:var(--dsw-alias-state-warn-tertiary,rgba(229,160,75,.12));",
      "--hmp-err:var(--dsw-alias-state-error-primary,#e5534b);",
      "--hmp-ok:var(--dsw-alias-state-success-primary,#3fb950);",
      "max-width:820px;padding:8px 0 24px;color:var(--hmp-t1);font-size:13px;line-height:1.6;",
      "font-family:var(--dsw-font-family,\"Segoe UI\",\"Microsoft YaHei\",system-ui,sans-serif)}",
      ".hmp-card{border:1px solid var(--hmp-line);border-radius:var(--hmp-r);background:var(--hmp-card-bg);",
      "padding:14px 16px;margin:8px 0}",
      ".hmp-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}",
      ".hmp-title{font-weight:600;font-size:13px}",
      ".hmp-spacer{margin-left:auto}",
      ".hmp-badge{display:inline-block;border:1px solid var(--hmp-line);border-radius:999px;padding:0 8px;",
      "font-size:11px;line-height:18px;color:var(--hmp-t2);white-space:nowrap}",
      ".hmp-badge-soft{color:var(--hmp-warn);border-color:var(--hmp-warn);background:var(--hmp-warn-bg)}",
      ".hmp-hint{color:var(--hmp-t3);font-size:11.5px;margin:0 0 10px}",
      ".hmp-field{display:flex;gap:12px;align-items:flex-start;margin:8px 0}",
      ".hmp-flabel{flex:0 0 116px;text-align:right;color:var(--hmp-t2);font-size:12px;",
      "line-height:var(--hmp-h);min-height:var(--hmp-h)}",
      ".hmp-fbody{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      ".hmp-in,.hmp-sel{box-sizing:border-box;height:var(--hmp-h);background:var(--hmp-inset-bg);color:inherit;",
      "font:inherit;font-size:12px;border:1px solid var(--hmp-line);border-radius:var(--hmp-r-ctl);",
      "padding:0 8px;outline:none}",
      ".hmp-in{width:100%}",
      ".hmp-sel{width:100%;max-width:320px}",
      ".hmp-in.hmp-inline{width:132px;flex:0 0 auto}",
      ".hmp-in:focus,.hmp-sel:focus{border-color:var(--hmp-accent)}",
      ".hmp-note{color:var(--hmp-t3);font-size:11px;margin:0}",
      ".hmp-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px;",
      "padding-top:12px;border-top:1px solid var(--hmp-line-soft)}",
      ".hmp-btn{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;",
      "height:var(--hmp-h);background:transparent;border:1px solid var(--hmp-line);color:inherit;",
      "border-radius:var(--hmp-r-ctl);padding:0 14px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}",
      ".hmp-btn:hover{background:var(--hmp-hover)}",
      ".hmp-btn-primary{border-color:var(--hmp-accent);background:var(--hmp-accent-fill);color:var(--hmp-accent-ink)}",
      ".hmp-btn-primary:hover{background:var(--hmp-accent-hover)}",
      ".hmp-status{font-size:12px;color:var(--hmp-t2)}",
      ".hmp-status-bad{color:var(--hmp-err)}",
      ".hmp-status-ok{color:var(--hmp-ok)}",
      ".hmp-placeholder{color:var(--hmp-t3);font-size:12px}",
      "@media (max-width:560px){.hmp-field{flex-direction:column;gap:4px}",
      ".hmp-flabel{flex:none;text-align:left;line-height:1.4;min-height:0}}"
    ].join("");

    /** Inject the page stylesheet once per client runtime; returns its disposer. */
    function installStyles() {
      if (typeof document === "undefined" || !document.head || typeof document.createElement !== "function") {
        return function () {};
      }
      var style = document.createElement("style");
      style.dataset.plugin = STYLE_OWNER;
      style.textContent = CSS;
      document.head.appendChild(style);
      return function () {
        try {
          style.remove();
        } catch (_) {
          /* already detached */
        }
      };
    }

    var h = React.createElement;

    function SectionForm(props) {
      var initial = props.initial || { provider: "", model: "", timeoutMs: 20000 };
      var labels = props.labels;
      var providers = props.providers || [];
      var [provider, setProvider] = React.useState(initial.provider || "");
      var [model, setModel] = React.useState(initial.model || "");
      var [timeoutText, setTimeoutText] = React.useState(String(initial.timeoutMs || 20000));
      var [status, setStatus] = React.useState("");
      var models = typeof props.modelsFor === "function" ? props.modelsFor(provider) || [] : [];

      var onProvider = function (event) {
        var next = event.target.value;
        setProvider(next);
        var nextModels = typeof props.modelsFor === "function" ? props.modelsFor(next) || [] : [];
        if (next !== provider && nextModels.indexOf(model) === -1) setModel(nextModels.length > 0 ? nextModels[0] : "");
      };
      var onModel = function (event) { setModel(event.target.value); };
      var onModelText = function (event) { setModel(event.target.value); };
      var onTimeout = function (event) { setTimeoutText(event.target.value); };

      var onSave = function (event) {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        var timeoutMs = Number(timeoutText);
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
          setStatus(format(labels.failed, { error: labels.timeout }));
          return;
        }
        setStatus(labels.saving);
        var payload = { provider: provider, model: model.trim(), timeoutMs: Math.round(timeoutMs), onFailure: "reject" };
        Promise.resolve(props.onSave(payload)).then(function () {
          setStatus(labels.saved);
        }, function (error) {
          setStatus(format(labels.failed, { error: error && error.message ? error.message : String(error) }));
        });
      };

      var providerOptions = [h("option", { key: "__follow", value: "" }, labels.follow)];
      for (var i = 0; i < providers.length; i += 1) {
        var entry = providers[i];
        providerOptions.push(h("option", { key: entry.id, value: entry.id }, entry.name || entry.id));
      }

      var modelControl = models.length > 0
        ? h("select", { className: "hmp-sel", "aria-label": labels.model, value: model, onChange: onModel, "data-testid": "hmp-model" },
            model === ""
              ? h("option", { key: "__empty", value: "" }, "—")
              : null,
            models.map(function (id) { return h("option", { key: id, value: id }, id); }))
        : h("input", {
            className: "hmp-in",
            "aria-label": labels.model,
            value: model,
            placeholder: labels.modelManual,
            onChange: onModelText,
            "data-testid": "hmp-model"
          });

      var currentLabel = provider === ""
        ? labels.modeFollow
        : (model === "" ? provider : provider + " / " + model);
      var statusClass = status === labels.saved
        ? "hmp-status hmp-status-ok"
        : status === labels.saving ? "hmp-status" : "hmp-status hmp-status-bad";

      return h("div", { className: "hmp-wrap", "data-testid": "hmp-section" },
        h("div", { className: "hmp-card" },
          h("div", { className: "hmp-head" },
            h("span", { className: "hmp-title" }, labels.title),
            h("span", { className: "hmp-spacer" }),
            h("span", { className: "hmp-badge" }, currentLabel)),
          h("p", { className: "hmp-hint" }, labels.hint),
          h("div", { className: "hmp-field" },
            h("span", { className: "hmp-flabel" }, labels.provider),
            h("div", { className: "hmp-fbody" },
              h("select", {
                className: "hmp-sel",
                "aria-label": labels.provider,
                value: provider,
                onChange: onProvider,
                "data-testid": "hmp-provider"
              }, providerOptions))),
          h("div", { className: "hmp-field" },
            h("span", { className: "hmp-flabel" }, labels.model),
            h("div", { className: "hmp-fbody" }, modelControl)),
          h("div", { className: "hmp-field" },
            h("span", { className: "hmp-flabel" }, labels.timeout),
            h("div", { className: "hmp-fbody" },
              h("input", {
                className: "hmp-in hmp-inline",
                "aria-label": labels.timeout,
                value: timeoutText,
                onChange: onTimeout,
                "data-testid": "hmp-timeout"
              }),
              h("span", { className: "hmp-note" }, labels.timeoutNote))),
          h("div", { className: "hmp-field" },
            h("span", { className: "hmp-flabel" }, labels.failure),
            h("div", { className: "hmp-fbody" },
              h("span", { className: "hmp-badge hmp-badge-soft", "data-testid": "hmp-failure" }, labels.failureFixed))),
          h("div", { className: "hmp-actions" },
            h("button", {
              className: "hmp-btn hmp-btn-primary",
              type: "button",
              onClick: onSave,
              "data-testid": "hmp-save"
            }, labels.save),
            status === "" ? null : h("span", { className: statusClass, "data-testid": "hmp-status" }, status))));
    }

    function Section(props) {
      var labels = props.labels || zh;
      var [data, setData] = React.useState(null);
      var [error, setError] = React.useState("");

      React.useEffect(function () {
        var alive = true;
        Promise.resolve()
          .then(function () { return props.load(); })
          .then(function (next) {
            if (alive) setData(next);
          }, function (failure) {
            if (alive) setError(format(labels.loadFailed, { error: failure && failure.message ? failure.message : String(failure) }));
          });
        return function () { alive = false; };
      }, []);

      if (error !== "") return h("p", { className: "hmp-status", "data-testid": "hmp-error" }, error);
      if (data === null) return h("p", { className: "hmp-status", "data-testid": "hmp-loading" }, labels.loading);
      return h(SectionForm, {
        initial: data.value,
        providers: data.providers,
        modelsFor: function (providerId) { return (data.models && data.models[providerId]) || []; },
        onSave: props.save,
        labels: labels
      });
    }

    function apply(ctx) {
      var locale = ctx.get("locale");
      var remote = ctx.get("remote");
      var slots = ctx.get("slots");
      if (slots === undefined) return;
      ctx.effect(installStyles, "dsh-help-me-approve: styles");

      if (locale !== undefined) {
        ctx.effect(function () {
          return locale.register(NS, { zh: zh, en: en });
        }, "dsh-help-me-approve: dictionaries");
      }
      var t = locale === undefined
        ? function (key) { return typeof zh[key] === "string" ? zh[key] : key; }
        : locale.bind(NS);

      slots.inject("settings.section", function () {
        return slots.register({
          name: "settings.section",
          id: SETTINGS_NS,
          order: 25,
          label: function () { return t("nav"); },
          locale: NS,
          inject: function () { return { load: load, save: save, labels: zh }; }
        }, Section);
      });

      function settingsRemote() {
        if (remote === undefined) throw new Error("remote is unavailable");
        if (remote.settings === undefined) throw new Error("remote.settings is unavailable");
        return remote.settings;
      }
      // cordis rejects `remote.<ns>` unless that namespace is declared in the
      // plugin's `inject`; the read is also guarded so a runtime that does not
      // expose the llm namespace degrades to manual model entry instead of
      // failing the whole page.
      function llmRemote() {
        if (remote === undefined) return undefined;
        try {
          return remote.llm;
        } catch (_) {
          return undefined;
        }
      }

      /** Run one catalog read, treating any failure as "no catalog". */
      function catalog(call) {
        return Promise.resolve()
          .then(call)
          .catch(function () {
            return { ok: true, value: [] };
          });
      }

      function renderable(document, descriptor) {
        var providers = [];
        var llm = llmRemote();
        return catalog(function () {
          return llm && typeof llm.listConfigurableProviders === "function"
            ? llm.listConfigurableProviders()
            : { ok: true, value: [] };
        }).then(function (configured) {
          var list = configured && configured.ok === true && Array.isArray(configured.value) ? configured.value : [];
          for (var i = 0; i < list.length; i += 1) {
            var entry = list[i];
            if (!entry || typeof entry.provider !== "string") continue;
            providers.push({ id: entry.provider, name: entry.displayName || entry.provider, settingsNs: entry.settingsNs });
          }
          return catalog(function () {
            return llm && typeof llm.listProviders === "function" ? llm.listProviders() : { ok: true, value: [] };
          });
        }).then(function (live) {
          var list = live && live.ok === true && Array.isArray(live.value) ? live.value : [];
          for (var i = 0; i < list.length; i += 1) {
            var entry = list[i];
            if (!entry || typeof entry.id !== "string") continue;
            var known = false;
            for (var j = 0; j < providers.length; j += 1) if (providers[j].id === entry.id) known = true;
            if (!known) providers.push({ id: entry.id, name: entry.name || entry.id });
          }
          return { value: readValue(descriptor), providers: providers, models: collectModels(document, providers) };
        });
      }

      function load() {
        return Promise.resolve(settingsRemote().describe()).then(function (response) {
          if (response && response.ok === false) throw new Error((response.error && response.error.message) || "describe failed");
          var document = response && response.ok === true ? response.value : response;
          var descriptor = pickNamespace(document, SETTINGS_NS);
          if (descriptor === undefined) throw new Error("namespace " + SETTINGS_NS + " is not registered");
          return renderable(document, descriptor);
        });
      }

      function save(value) {
        return load().then(function (current) {
          return settingsRemote().mutate(SETTINGS_NS, buildSaveOps(value), current.value.revision);
        }).then(function (response) {
          if (response && response.ok === false) throw new Error((response.error && response.error.message) || "mutate failed");
          return response && response.ok === true ? response.value : response;
        });
      }
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    exports.NS = NS;
    exports.SETTINGS_NS = SETTINGS_NS;
    exports.Section = Section;
    exports.SectionForm = SectionForm;
    exports.zh = zh;
    exports.en = en;
    exports.pickNamespace = pickNamespace;
    exports.readValue = readValue;
    exports.collectModels = collectModels;
    exports.buildSaveOps = buildSaveOps;
    exports.format = format;
    return module.exports;
  }
});
