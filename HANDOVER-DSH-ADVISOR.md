# DSH 版 Advisor 插件 — 交接文档

> 生成于 2026-11-13。本文档由「codex-advisor 工作区」的评估对话产出，供**新工作区的新对话**直接接手。
> 目标读者：负责实施 DSH 版 Advisor 插件的 agent。读完后应可不重做任何调研直接进入设计定稿/实施。

---

## 0. 一句话目标

在 DeepSeek Harness（DSH）上做一个**独立新仓库**的插件：让主模型在需要时（自动判断或用户手动触发）向配置好的顾问模型提问并获得第二意见。功能语义参照 Codex 插件 `codex-advisor`，但**机制全部换成 DSH 原生方式**，不照搬 Codex 的实现包袱。

---

## 1. 已确认的需求定论（用户拍板，不再讨论）

| 项 | 结论 |
|---|---|
| 核心功能 | 主模型可**自动**（关键节点自主判断）或**手动**（用户明确要求）向顾问模型提问 |
| 降级链（模型优先级+重试） | **不是核心需求**。最多保留"失败顺延下一位顾问"的 try-catch，不做专门 UI |
| 上下文继承 | **核心卖点**：顾问自动获得主对话上下文（DSH 无 Codex 的限制，见 §4） |
| 模型目录解析（models_cache.json 等） | 不做，改用 DSH 运行时模型列表（`llm.listProviders`/`llm.listModels`） |
| 配置网页（localhost 服务器） | 不做，用 DSH **原生插件设置页**（Config Schema 表单） |
| CLI（advisorctl）/ PowerShell 命令安装器 | **不做**。DSH 插件有自己的安装方式（设置页/市场），无需命令行入口 |
| V1/V2 子代理接口适配 | 不做，DSH 无此歧义 |
| 防递归标记（[CODEX_ADVISOR]） | 不需要，顾问是纯 `llm.stream` 调用，没有子代理工具可递归 |
| 仓库位置 | **独立新 git 仓库**，与 `codex-advisor` 工作区分开（本仓库仅供参考） |

### 待决策点（用户要求后续对话再定，不要现在定）

1. 工具名与触发词（须避开已装插件的 `ask_advisors` / `@顾问群`；候选如 `advisor_ask` / `@顾问`）
2. auto 触发规则深浅：仅 systemPrompt 软规则，还是加"置信度低于阈值/连续 N 轮受阻"硬触发
3. 降级链是否保留（建议：保留 try-catch 顺延，零 UI 成本）
4. 顾问是否允许使用只读工具（MVP 建议纯文本问答；参考插件已示范只读工具模式）

---

## 2. 源头：Codex 版 codex-advisor 是什么（背景速览）

原仓库：`C:\Users\y\Desktop\vibecoding\iflab_demo\codex-advisor`（GitHub: yyty947/codex-advisor）

**功能**：给 Codex 配一个只读"战略顾问"子代理。主模型在重大方案前/连续受阻/重大交付前用 `spawn_agent` 咨询；支持 auto/manual 模式、模型优先级链+每模型重试+推理档位、失败策略（continue/block）。

**结构**（新对话一般不需要读源码，语义已全部提炼在此）：

| 文件 | 职责 | DSH 对应物 |
|---|---|---|
| `hooks/hooks.json` + `hooks/advisor_context.py` | UserPromptSubmit hook 每轮注入协议文本（≤5000 字符） | `systemPrompt.section()`（见 §4.4） |
| `hooks/advisor_guard.py` | PreToolUse hook：拦截/改写/拒绝带标记的子代理调用（填 model/effort/leaf preamble） | 不需要（无接口歧义；如需 guard 有 `tools/pre-execute`） |
| `skills/advisor/SKILL.md` + `agents/openai.yaml` | 技能路由（`$advisor` 命令→advisorctl 子命令） | `commands` 服务注册人机命令（可选） |
| `scripts/advisor_core.py` | 配置校验（357 行）、模型目录发现、协议文本生成 | Config Schema + `llm.listModels` + systemPrompt section |
| `scripts/advisor_server.py` + `assets/` | 自建 localhost 配置网页 + token + 原生 JS | 原生插件设置页，整块删除 |
| `scripts/advisorctl.py` + `install-terminal-command.ps1` + `terminal-launcher.py` | CLI 与终端命令 | 不做 |
| `tests/`（5 个测试文件） | unittest 覆盖 core/server/cli/gui/hooks | 新仓库自建测试（vitest，参考插件用 vitest） |

**Codex 版配置语义**（迁移 Config Schema 时的字段参考）：`enabled`、`mode`(auto/manual)、`agent_protocol`(auto/v1/v2，弃)、`model_source`(codex/cc-switch/catalog/manual，弃)、`reasoning_effort`(none…ultra)、`on_exhausted`(continue/block)、`models:[{id, retries, reasoning_effort?}]`。

**Codex 原生限制（用户特别提醒）**：Codex 无法在指定 advisor 模型的同时让它继承主对话上下文 → Codex 版被迫"声明不继承 + 主模型手动在调用里写 context"。**DSH 无此限制**，这是新版的核心升级点（§4.2）。

---

## 3. DSH 插件骨架（新仓库长什么样）

参照已验证可运行的 `dsh-advisor-group` v0.1.5（当前 profile 已安装，位置：
`C:\Users\y\.dsh\profiles\desktop\node_modules\dsh-advisor-group\`）：

```
新仓库/
├── package.json          # name/version/description；dsh 字段见下
├── cordis.patch.yml      # bundle 层：insert 一行插件 row（id + name=包名）
├── src/index.ts          # Host 半：Config Schema、Tool 注册、systemPrompt 注入
├── src/client.ts         # Client 半：设置页 UI（注入 settings-plugins）
├── docs/DETAIL.md        # 插件市场详情页文档
├── icon.svg / docs/preview.svg
└── tests/                # vitest
```

package.json 关键字段（照抄参考插件的模式）：

```jsonc
{
  "type": "module",
  "main": "lib/index.mjs",          // tsdown 构建产物
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": ["@deepseek-ai/dsh-client-ui-renderer",
                 "@deepseek-ai/dsh-client-ui-settings-plugins",
                 "@deepseek-ai/dsh-client-locale"],
      "platform": "web"
    }
  },
  "peerDependencies": { "@deepseek-ai/cordis": "~4.0.4", "react": "^18 || ^19", /* dsh-client-* 系列 */ },
  "engines": { "node": "^22.19.0 || >=24.0.0" },
  "scripts": { "build": "tsdown", "test": "vitest run" }
}
```

开发与安装：本地路径 `plugin_manager install_bundle` 或加入 plugin_market 索引；改动后需重载生效。**新对话实施前应先加载 `dsh-doc` 技能**读 `references/plugin-development.md`、`host-plugin.md`、`ui-plugin.md`、`practices.md`（注意：该技能文档在 app.asar 内，native 文件工具读不了，须按技能自身指引的方式读取；`templates/decoration/` 有完整 UI 插件模板可直接抄）。

---

## 4. 关键技术验证结论（本对话已逐一核实，可直接引用）

### 4.1 插件可直调任意模型（带推理档位）

`ctx.llm.stream(options)` 完整可用字段（源自参考插件 `callViaCtxLlm`，~lib/index.mjs:240）：

```js
{
  provider, model, system, messages,   // 任意已配置供应商路由 + 完全可控消息数组
  reasoningEffort,                      // 直通，含 "off"
  temperature, maxTokens, sessionId, signal
}
// 流式 chunk: {type:"text-delta"} / {type:"reasoning-delta"}
```

复用用户在 DSH 已配置的供应商路由与凭据，无需自管 API Key。超时语义：超时后流**静默停止不抛错**，需自行检测并标记 truncated（参考插件踩过的坑）。

### 4.2 自动上下文继承（核心升级，Codex 做不到）

工具执行时可拿到调用方会话的**活日志** `exec.agent.session`（参考插件 lib/index.mjs:6812），然后：

- `log.snapshotEvents()` → 读出主对话全部事件（用户消息/助手回复/工具调用），用于组装顾问 transcript；
- `log.append("advisor-group/message", data)` → 把顾问回答写回主会话日志，UI 渲染成卡片（参考插件 `appendAdvisorMessage`，含 turn/step 定位 `latestTurnStep`）。

结论：**顾问 = 换一个模型、看着同一段对话作答**。工具参数可缩到 `question`(+`focus`)，可选 `context` 仅作补充/覆盖。无需主模型手动交接背景。

### 4.3 模型枚举（取代 Codex 的目录文件解析）

`ctx.llm.listProviders()` → `LlmProviderInfo[]`；`ctx.llm.listModels(provider)` → `LlmModelInfo[]`（设置页"获取模型列表"数据源）。变更事件 `llm/models-updated`。推理档位可用数据可参考内置 `list_subagent_models` 工具同源信息。

### 4.4 指令注入（取代 UserPromptSubmit hook）

`ctx.systemPrompt.section(section)` / `.context()` / `.variable()`：注册进每次模型步骤前的提示组装，比每轮 hook 注入干净、不占轮次预算。auto 触发规则（"何种节点应咨询顾问"）放这里，manual 模式不挂载。

### 4.5 其余 Host 能力（按需）

- `ctx.tools.register(definition)` — 注册 `advisor_ask` 类工具；`tools/pre-execute` waterfall / `tools.guard()` 可做 guard（本设计预计不需要）
- `ctx.commands.register(definition)` — 人机命令（`@顾问` 强制触发用，可选）
- `ctx.settings.update(ns, patch)` — 配置写入；Config Schema 由 bundle 声明
- 事件目录其他可用项：`agent/pre-step`（改写进入步骤的消息）、`agent/request-error`（失败换模）、`subagent/*`、`session/event`、`skills/change`
- 参考插件还有"重复失败压力"模式：从事件日志统计连续受阻轮次触发强制咨询（`getRepeatPressure(sessionLog.id)`），可作为加分项

### 4.6 DSH 宿主已知 bug（新对话会遇到）

`cordis_inspect_query` **只要带 `input` 参数（含空对象 `{}`）必被拒**：`"input" must be an object`；省略 input 则正常。重启 DSH 后复现 → 宿主序列化层把 input 当字符串传给 Inspect Provider。**规避**：只用无参数的目录查询（listService/listEvents/listConfigs 不带 service/entry 名）。此 bug 待向上游反馈。

### 4.7 与已装插件 dsh-advisor-group 的避让

当前 profile 已装 `dsh-advisor-group`（多顾问接力会诊 + 跨会话蜂群，占用 `ask_advisors`/`ask_sessions`/`@顾问群`/"顾问群使用边界"systemPrompt 段）。新插件定位 = **主模型按需问顾问、自动带全上下文**，天然不同，但须避开：工具名、触发词、systemPrompt 段名。用户可能两者同开。

---

## 5. 设计草案（已讨论定稿的形态，MVP）

**Host 半四件套：**
1. Config Schema：顾问列表（name/provider/model/reasoningEffort/systemPrompt/temperature/maxTokens）、触发模式（auto|manual）、可选触发阈值
2. `advisor_ask` 工具：`question` + `focus`(+可选 `context`) → snapshotEvents 组装 transcript → `llm.stream` → 流式写回会话日志卡片
3. systemPrompt section：auto 触发规则
4. （可选）commands 注册 `@顾问`

**Client 半：**
5. 设置页（设置→插件→Advisor）：顾问增删排序、provider/model 下拉（llm.listModels）、effort 下拉、auto/manual 开关

**加分项（按优先级）：** 失败顺延 try-catch；思考/正文分块卡片（思考默认折叠）；truncated 显式标记；失败压力自动触发；咨询留痕回放。

**不做清单**（防止 scope creep）：CLI、终端命令安装器、localhost 配置页、模型目录文件解析、V1/V2 适配、防递归标记、多顾问会诊编排、跨会话蜂群。

**规模预估**：约为参考插件（host 9.3k 行 + client 3k 行，含大量会诊/CRT/蜂群）的 1/4～1/3。

---

## 6. 新对话接手清单（建议顺序）

1. （可选）`skill dsh-doc` → 读 plugin-development / host-plugin / ui-plugin / practices；抄 `templates/decoration/` 模板
2. 与用户过 §1 待决策点（工具名/触发词、触发深浅、降级链、顾问工具权限）
3. 需要原版语义对照时读 `C:\Users\y\Desktop\vibecoding\iflab_demo\codex-advisor`（本档 §2 已提炼，一般不必）
4. 需要运行实例对照时读 `C:\Users\y\.dsh\profiles\desktop\node_modules\dsh-advisor-group\`（§4 的行号都指向它）
5. 新仓库初始化（命名候选：`dsh-advisor`）→ 按 §3 骨架 → 按 §5 实施
6. 测试用 vitest；Host 逻辑（transcript 组装、配置校验、链式顺延）可单测

## 7. 杂项备忘

- CC Safety Net：本机 `ops_bash` 已声明（user scope，`npx -y cc-safety-net rule tool add ops_bash`）；新会话首次跑 bash 可能再次要求声明
- 本评估对话未做任何实施；codex-advisor 仓库未改动（仅新增本交接文档）
