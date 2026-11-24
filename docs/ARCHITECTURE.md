# 架构

> 活文档：描述 dsh-advisor-chain（Second Opinion）当前的工作方式、对宿主的依赖、以及关键决策的理由。改动架构时同步更新本文。用户向说明见 `README.md`，变更见 `CHANGELOG.md`。

## 1. 一句话

主模型调用 `second_opinion` 工具 → 插件启动一个**只读的 DSH 原生子代理**（顾问），把当前会话的有界抄本（或仅问题与背景）交给它 → 顾问在 read-only 沙箱里读文件核实、作答 → 结果作为工具结果交回主模型，并在对话里渲染成卡片。

## 2. 模块

```
src/
  index.ts              插件入口：注册工具、系统提示段、子代理监听、设置 auto:false
  config.ts             Config schema（宽松）、normalizeConfig、迁移
  i18n.ts               宿主侧字典（zh/en）与语言判定（0.4.0 起）
  prompt.ts             给主模型的系统提示段
  pressure.ts           重复提问压力追踪（硬触发）
  transcript.ts         抄本：派生消息 → 有界文本
  advisor/
    types.ts            宿主依赖的窄接口（HostServices），测试用假实现
    preamble.ts         顾问任务提示：固定前言 + 用户人格 + 问题
    start.ts            校验（白名单 / 模型路由 / 档位）→ startActivation
    identify.ts         subagent/start 监听：识别顾问子会话 → read-only 沙箱 → 观察；注册表
    observe.ts          子会话观察：request-error 采集、正文进度、turn/end
    result.ts           结果分类：stopReason / SubagentError.code / 超时规则
    followup.ts         追问：校验线程 → sendMessage → 等 turn/end → 读回答
  tool.ts               second_opinion：参数、输出契约、编排（链 / 双意见 / 追问）
  legacy/shim.ts        旧事件类型的只读垫片（不抛错）
  client.ts             浏览器半：设置页、toolview 卡片、旧卡片回放、i18n
```

宿主半是 ESM（`lib/index.mjs`），在 DSH Host 进程里运行；客户端是 IIFE（`lib/client.js`），通过 `window.__ModuleLoader__` 加载，`react` 从浏览器的模块表取得，不打包。

## 3. 对宿主的依赖（0.2.3-alpha.2 上核实）

| 依赖 | 契约 | 我们怎么用 |
|---|---|---|
| `ctx.subagents.startActivation(spec)` | `provider: 'spawn'`、`delivery: 'caller'`、`agentOptions`（provider / model / reasoningEffort / maxTokens）、`maxDepth`、`prompt: ContentBlock[]` | 启动顾问；`maxDepth = delegationDepthOf(parent) + 1` |
| `SubagentActivation.result` | 失败不 reject，给 `stopReason`（completed / aborted / error / max-tokens / refusal）；本地结果**没有** diagnostic | 失败原因改从子代理作用域的 `agent/request-error` 采集 |
| `subagent/start` / `subagent/end` | start 在子代理创建后、首条提示入队前**同步**发出 | 识别顾问子会话、套 read-only、挂观察 |
| 子会话 `subagent/descriptor` 事件 | 在 setup 阶段写入，先于 start；含 `label` | 以 `second-opinion:` 前缀识别自己的子会话；`subagent/start` 的 payload 里没有 label |
| `setSandboxMode(session,'read-only')` | `@deepseek-ai/dsh-sandbox-policy` 导出；日志追加，按会话生效，冷恢复保留 | 只读保证；回读以**会话日志**最后一条 `sandbox/mode` 为准（`overrideOf()` 读的是异步投影，刚追加后可能还是旧值） |
| `ctx.subagents.sendMessage` / `interrupt` | 冷恢复同一子会话；`interrupt` 需 `{kind:'ancestor', agent}` | 追问；超时中止 |
| `ctx.subagentModelSelection.allowedRoutes()` | 宿主的子代理模型白名单；**运行时不强制**，只由模型面向工具强制 | 启动前自查，不绕过 |
| `ctx.llm.resolveModelInfo()` | 模型声明的推理档位 | 未声明的档位忽略并注明 |
| `output.presentationMeta` → `tool/result.meta` → `tool.call.toolview` | 官方的工具卡片通道 | 卡片数据与渲染 |
| `KNOWN_SESSION_EVENT_TYPES` | 读路径对未知且非 ignorable 的事件类型拒绝重建会话；**宿主明确否决了事件名注册** | 只作旧会话的只读垫片，不再写入 |
| `remote.settings.*` / `remote.llm.discoverModels` | 设置页读写与模型发现 | 授权写白名单；登录型账号的模型发现 |

## 4. 关键决策与理由

**顾问用 spawn + 抄本，不用 fork。** fork 的种子止于最后一个 `turn/end`，看不到用户本轮的提问和主模型本轮的工作；本机 JSONL 后端还会把父日志完整复制进子会话。抄本包含当前轮，成本有界，顾问凭只读权限自己读细节。

**只读靠沙箱保证，提示词只是要求。** `subagent/start` 监听里调 `setSandboxMode`，并以日志回读校验；失败则中止本次咨询（fail-closed）。Windows 上沙箱为「部分」级、不约束网络，前言同时写明只读。

**尊重宿主的子代理模型白名单。** 运行时虽不强制，但它是用户在宿主里的明确设置；插件自查并在设置页提供一键授权，而不是默默绕过。

**超时三段式。** 到点前不打断；到点时无回答正文 → 失败；已有正文 → 空闲计时（30 秒无新正文才中止）；总时长兜底 `max(3×timeout, 10 分钟)`。思考与工具调用不算正文。

**`consult_id` = 顾问子会话 id。** 追问复用同一子会话（供应商侧前缀缓存可复用），轮数按子会话里的追问次数计；`maxTokens` 不随冷恢复保留（宿主限制）。

**失败分类表。** `SubagentError.code` 三分：基础设施（容量 / 深度 / draining）立即失败、授权类指向设置、模型类才顺延链。`completed` 但无正文一律算失败。

**不再向会话日志写自定义事件。** 卡片走 `tool/result` 的 `meta`；旧事件只读回放。

**顾问不能再派生。** `maxDepth` 限制的是本次启动的子代理；顾问能否经宿主的 `subagent` 工具再派生取决于宿主的最大深度设置（默认 1 → 不能）。

**重复提问硬触发按归一化文本计数。** 忽略大小写、标点、空白；「继续」类推进短句既不计数也不打断计数；到达阈值时写一条日志。它是提示层面的强制，不拦截回答。

## 5. 文案与语言

客户端（设置页、卡片、横幅、侧栏）的文案走 `src/client/i18n.ts` 的字典，用宿主的 locale 服务注册（`ctx.locale.register(NS, { zh, en, … })`），界面语言切换时随 `locale: NS` 的注册项重渲染；加语言 = 加一份字典。

宿主侧（系统提示段、顾问任务提示、工具结果与失败原因）没有 locale 服务，走 `src/i18n.ts` 自带字典，按「文案语言」设置决定：`zh` / `en` 固定，`auto`（默认）按当前文本的中文字符比例判断——系统提示段看用户最近一条消息，工具调用看问题与背景。工具的参数说明固定为英文（注册时一次写入，与宿主内置工具一致）。顾问人格为空时按语言取内置默认；用户保存过的人格优先于语言判断。

## 6. 已知限制

- 追问后宿主会向父对话投递一条内容相同的子代理完成通知；宿主的通用子代理模板也鼓励 `send_message`，前言已禁止，但不同模型可能偶尔照发。
- 顾问子会话会在磁盘上累积：宿主没有删除会话的公开 API（持久化服务只有 `create / open / stat / list`），插件无法自行清理；子会话很小且被宿主从会话列表隐藏。
- 卡片没有父对话内的实时滚字（`ToolRunContext` 无进度通道），过程在子代理面板查看。
- 抄本是文本化的：图片 / 附件以占位符呈现，工具输出按单条上限截断。
