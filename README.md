# dsh-help-me-approve

DeepSeek Harness（`@deepseek-ai/dsh`）插件：给会话权限菜单增加一个 **帮我批准** 预设。
选中后，工作区内的正常操作照常直接执行；一旦要越过权限边界，就交给一个**独立的审核代理**
裁决，而不是弹窗问你。

## 工作方式

| 场景 | 行为 |
| --- | --- |
| 工作区内读写、命令、搜索 | 直接执行，不产生任何审核请求 |
| 工作区外文件、受限网络目标、需要批准的工具/插件工具 | 进入审批入口 `ctx.approval.request`，由审核代理决定 |
| 审核批准 | 该调用执行一次（`allowed-once`），后续调用不再复用这次批准 |
| 审核拒绝 | 该调用失败，拒绝理由写回工具错误；执行代理必须先尝试留在边界内的低风险方案，否则停下来问你 |
| 审核代理不可用 / 超时 / 输出不合协议 | 一律按拒绝处理（fail-closed），失败原因同样写回给执行代理 |

审核代理是一次独立的 LLM 调用（独立上下文，不是主代理），只读三样东西：

1. **精简后的对话**：最近若干条人类与助手文本（按字符上限裁剪），不含工具输出。
2. **相关工具证据**：本次参数里出现的路径，及其相对工作区的位置、是否存在、类型与大小。
3. **本次操作的具体参数**：从会话日志按 `callId` 取到的原始调用参数（按字符上限裁剪）。

输出协议是封闭的，只接受 `{"decision":"allow"|"deny","risk":"low"|"medium"|"high","reason":"..."}`
的六种合法形状；`low+deny`、`high+allow`、allow 带 reason、多余字段、重复字段、非 JSON
全部判为协议失败（fail-closed）。

## 安装

已安装到 `~/.dsh/profiles/web`。等价的手工步骤：

1. 让 profile 能找到包（本机用符号链接，避免联网安装）：

   ```sh
   ln -sfn /home/nxneym/projects/custom-approval ~/.dsh/profiles/web/node_modules/dsh-help-me-approve
   ```

2. `~/.dsh/profiles/web/package.json`：

   ```json
   {
     "dependencies": { "dsh-help-me-approve": "file:/home/nxneym/projects/custom-approval" },
     "dsh": { "profile": { "bundles": ["...", "dsh-help-me-approve"] } }
   }
   ```

3. `~/.dsh/profiles/web/cordis.patch.yml` 的 `permission` 行的 `presets` 里加上预设
   （必须写在这一行里：patch 会整行替换 config，写在 bundle 层会被用户层覆盖）：

   ```yaml
   help-me-approve:
     sandbox: workspace-write
     approval: ask
     name: 帮我批准
     description: 工作区内操作直接执行；目录外写入、受限网络、需批准的工具交给 AI 审核代理裁决
   ```

4. 本仓库 `node_modules/@deepseek-ai/schemastery` 必须是指向 profile 已装副本的符号链接
   （插件运行期只 import 这一个外部包；核心服务一律走 `ctx.get()`）。

验证组合：

```sh
dsh --profile web --dump-config | grep -A4 -- '- id: help-me-approve'
dsh --profile web --dump-config | grep -A6 'help-me-approve:'
```

### 卸载 / 回滚

```sh
rm ~/.dsh/profiles/web/node_modules/dsh-help-me-approve
# 从 package.json 的 dependencies 与 dsh.profile.bundles 里删掉 dsh-help-me-approve
# 从 cordis.patch.yml 的 permission.presets 里删掉 help-me-approve
```

改动前备份在会话临时目录（`profile-backup/`），也可用 `--from-default-profile` 之外的方式
自行还原。卸载后已选中该预设的会话会在下次启动时因为没有该预设而落回 `custom`，把会话切回
`workspace-write` 即可恢复正常人工审批。

## 使用

1. 启动 `dsh --profile web`（或桌面端）。
2. 在会话的权限菜单/`/permission help-me-approve` 里选择 **帮我批准**。
3. 其它会话不受影响：没选这个预设的会话仍然是原生人工审批。

## 设置

设置 → **帮我批准**：

页面用一张卡片呈现，配色与控件密度跟随宿主主题变量（`--dsw-alias-*`），深浅色主题都自动适配；
窄屏（<560px）下标签与控件改为上下堆叠。

| 项 | 含义 |
| --- | --- |
| 审核模型服务商 | 来自当前已注册/可配置的 provider；选“跟随会话模型”则用主会话当前路由 |
| 审核模型 | 该 provider 在自身设置里声明的模型清单；没有清单时退化为手工填写模型 id |
| 审核超时（毫秒） | 审核调用硬超时，1000–120000，默认 20000；超时即拒绝 |
| 审核失败处理 | 固定 `reject`：审核给不出裁决时绝不放行，不可放松 |

留空 provider/model = 跟随会话当前模型。设置写入本插件自己的配置命名空间
`help-me-approve`（4 个 volatile 字段），因此改动即时生效，无需重启。

## 审计日志

每次审批追加一行 JSON 到：

```
$DSH_HOME/help-me-approve/audit.jsonl      # 默认 ~/.dsh/help-me-approve/audit.jsonl
```

字段：`time`、`decision`（`allow`/`reject`）、`risk`、`tool`、`callId`、`model`、`reason`、
`failure`（失败类别，成功为 null）、`preset`。审计写入失败只记日志，不影响审批结论。

## 已知限制

- **拒绝不可转人工**：审核代理拒绝或失败后，不会回退成人工弹窗（这是明确选择），
  执行代理要么换低风险方案，要么停下来问你。
- **模型目录是尽力而为**：模型下拉从各 provider 插件自己的设置命名空间里提取
  `providers[<id>].models[]`；提取不到时只能手工填 id。
- **同模型不代表同视角**：默认跟随会话模型时，审核代理与执行代理同一个模型、不同上下文；
  需要更强独立性时请在设置里指定另一个模型。
- 本机环境下 profile 里另有 11 个第三方插件因找不到 `@deepseek-ai/dsh-*` 而加载失败，
  与本插件无关（安装前后数量一致，已做对照启动验证）。

## 开发

```sh
cd /home/nxneym/projects/custom-approval
node --test                 # 53 个用例：决策协议、激活判定、证据裁剪、fail-closed、应答器、审计、设置页
```

（Node 24 不接受 `node --test test/` 这种目录参数，`node --test` 会自动发现 `test/` 下的文件。）

目录：

- `lib/index.js` 编排：审批应答器、`post-execute` 理由回灌、系统提示注入、审计
- `lib/decision.js` 封闭输出协议
- `lib/evidence.js` 精简对话 + 工具证据 + 本次参数
- `lib/judge.js` 审核调用与超时/中止
- `lib/activate.js` 预设激活判定
- `lib/audit.js` JSONL 审计
- `lib/client.js` 设置页（`window.__ModuleLoader__` 手写模块，无打包器）
- `test/` node:test 用例与桩（`test/helpers/mini-react.js` 是浏览器端测试用的迷你运行时）

## 回滚

若安装后启动异常：

```sh
cp <会话临时目录>/profile-backup/package.json ~/.dsh/profiles/web/package.json
cp <会话临时目录>/profile-backup/cordis.patch.yml ~/.dsh/profiles/web/cordis.patch.yml
rm ~/.dsh/profiles/web/node_modules/dsh-help-me-approve
```
