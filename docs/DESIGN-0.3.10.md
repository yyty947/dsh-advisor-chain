# Second Opinion 0.3.10 设计（原生 subagent 引擎）

> 本文是 0.3.10 的实现规格。背景与上一版审计见 `HANDOVER-v2.md`；用户可见说明见 `README.md` 与 `CHANGELOG.md`。

## 1. 定位

单版本发布（0.3.10）。工具名 `second_opinion`、事件名 `advisor/*`、品牌 "Second Opinion" 不变。
顾问不再是 `ctx.llm.stream()` 直调，而是通过 `ctx.subagents.startActivation()` 启动的**只读子代理**。

## 2. 引擎

- 两种咨询模式都走 `spawn` provider，`delivery: 'caller'`，结果只回给工具。
  - **继承模式**：用 `src/transcript.ts` 把父会话（含**当前轮**，排除进行中的 `second_opinion` 调用本身）压缩成有界文本放进 prompt。
  - **盲审模式**：只给问题 + `context`（主模型按工具说明提供目标、约束、已尝试、文件路径）。
  - 顾问与主代理共享工作区，凭只读权限自己读文件核实。
- **不使用 fork**：fork 的种子止于最后一个 `turn/end`，不含当前轮；本机 JSONL 后端还会物理复制父日志。
- `maxDepth = delegationDepthOf(exec.agent) + 1`：顾问不能再派生。只拒绝**来自顾问子代理**的 `second_opinion` 调用。
- `context` 参数不强制：引导（工具说明/系统提示）+ 截断事实透出 + 顾问驱动的补充循环（顾问说缺信息 → 主模型带 `context` 重试或追问）。

## 3. 顾问约束

- **沙箱**：监听 `subagent/start`，按固定前缀 label + 子会话 `subagent/descriptor`（`foldSubagentDescriptor`）核对身份后 `setSandboxMode(session, 'read-only')`，再用 `ctx.sandboxPolicy.overrideOf()` 回读；不符则 dispose。委派子代理审批策略已被宿主钉为 never。
- **提示词** = 固定前言（你是谁 / 继承内容对你不适用 / 只读 / 输出契约，含"读者是主代理，忽略宿主'回复人类用户'的指示"）+ 用户可编辑 `advisorPrompt` + 问题与背景。

## 4. 模型与档位

链条目 = `label`、`provider`、`model`、`reasoningEffort`（自由字符串；运行时用 `ctx.llm.resolveModelInfo` 校验，模型未声明则忽略并注明）、`maxTokens`、`timeoutMs`。无 `temperature`（`AgentOptions` 不支持）。

## 5. 授权

- 启动前读 `ctx.subagentModelSelection.allowedRoutes()`（服务缺失则跳过）；设置关闭时仅允许与父级相同的路由；不满足则拒绝并提示。
- 设置页每条链显示状态（可用 / 供应商不存在 / 未授权 / 档位未声明），未授权带「授权」，组头「授权全部」，宿主设置关闭时为「开启并授权」；通过 `remote.settings.update` 写 `subagent-model-selection-settings` 命名空间（先读 revision，数组整体替换，冲突重读）。调用失败时隐藏按钮、退化为文字指引。不做绕过开关。

## 6. 失败、超时、重试

- `stopReason`：`completed` 且有正文 → 成功；`error` / `refusal` / `max-tokens` / 无正文 → 失败顺延。宿主 `dsh-llm-retry` 已在子代理内部重试瞬时错误，插件不重试。
- 失败事实从子代理作用域的 `agent/request-error`（`failure.code/message`）采集，映射为可读类别，随结果透出。
- `startActivation` 抛出的 `SubagentError` 三分：基础设施（容量 / 深度 / draining 等）立即失败并给可操作提示；授权类指向设置；仅模型类顺延。双意见占 2 槽。
- **超时**（`timeoutMs`，默认 300 s）：到点时无回答正文 → 失败；已有正文 → 切换空闲计时（30 s 无新正文才中止）；总时长兜底 `max(3 × timeoutMs, 10 min)`；中止时有正文记"截断成功"。"回答正文"= 子代理 `agent/assistant-stream` 的 `text-delta`，思考与工具调用不算。
- 不在 `defineTool` 上声明 `timeoutMs`；取消时先 dispose 全部子代理再抛出。

## 7. 追问

- `consult_id` = 子会话 id。追问用 `ctx.subagents.sendMessage()` 冷恢复同一子会话（前缀缓存可复用），同模型同档位；`maxTokens` 不随恢复保留。
- 结果：按 childId 等 `subagent/end`，取 `lastAssistantMessage`；失败信息同样来自 `agent/request-error` 采集；超时用 `ctx.subagents.interrupt(childId, {kind:'ancestor', agent})`。
- 已知代价：宿主会额外向父对话投递一条内容相同的完成通知（工具说明告知主模型以工具结果为准）。
- 轮数上限默认 8（1–20），按子会话里的追问次数计。会话 fork 后旧 `consult_id` 不在本树（`UNAUTHORIZED`）→ 提示无法追问。旧版 `consult_id` 不识别。

## 8. 卡片

`tool.call.toolview` 按 `second_opinion` 注册；`output.presentationMeta` 携带模型、尝试记录、截断、`consult_id`、抄本截断事实；进行中只显示问题 + "咨询中…"；回答正文沿用工具结果文本；失败显示 `stopReason` + 采集到的失败原因。

## 9. 设置页（遵循 DSH 原生 UI 规范）

启用 / 触发模式 / 默认咨询模式 / 顾问模型链（含授权）/ 顾问系统提示词 / 追问轮数 / 限制（默认超时 300 s、抄本预算 120,000 字符、单条上限 4,000 字符）/ 旧版本横幅（链非空的老用户显示一次）/ 关于。
供应商下拉 = DSH 已注册供应商；模型下拉 = 该供应商在 DSH 模型页配置的模型；不提供手填 id；不存在的条目保留标红并指引到 **设置 → 模型 → 编辑供应商 → 自定义设置 → 模型选项 → 推理等级**。

## 10. 存量会话

兼容垫片继续把 5 个旧事件类型加进 `KNOWN_SESSION_EVENT_TYPES`（**不抛错**），旧卡片定义只读回放；不扫描、不改写。修复工具留到下一版。

## 11. 抄本

保留工具调用参数、按 `source.kind` 区分环境注入、跳过 reasoning、包含当前轮、排除进行中的 `second_opinion` 调用、尾部加权 + 头部摘要。

## 12. 发布

`engines.dsh = ">=0.2.2-rc.4 <0.3.0-0 || >=0.2.3-0 <0.3.0-0"`，不做运行时能力检测；出厂 `chain: []`；`package.json` 加 `author`；新增 `CHANGELOG.md`，README 加「升级须知」。

## 13. 代码结构

```
src/
  index.ts          插件入口：注册工具、系统提示段、子代理监听、设置
  config.ts         Config schema（宽松）、normalizeConfig、迁移
  prompt.ts         给主模型的系统提示段
  pressure.ts       重复提问压力追踪
  transcript.ts     抄本（核心）
  advisor/
    preamble.ts     顾问提示词前言
    start.ts        校验、白名单、preflight、startActivation
    identify.ts     subagent/start 监听：识别 + 只读沙箱 + 回读
    observe.ts      子代理观察：request-error 采集、正文进度、subagent/end
    result.ts       结果分类：stopReason / SubagentError.code / 超时规则
    followup.ts     追问
  tool.ts           second_opinion 工具（参数、输出、编排）
  legacy/
    shim.ts         旧事件类型垫片（不抛错）
  client.ts         设置页 + toolview 卡片 + 旧卡片回放
```
