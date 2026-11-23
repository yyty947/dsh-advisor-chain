# dsh-advisor-chain 交接文档（2026-11-23）

> 供**新对话**直接接手。读完后应可不重做调研直接开始工作。
> 本文档只记录「只存在于对话里、别处查不到」的信息；能从代码/仓库读到的内容不重复。
> **先读 §0 和 §1，再读 §5 的待决策项。§5 的决策尚未做出，不要替用户拍板。**

---

## 0. 一句话现状

插件 `dsh-advisor-chain` v0.3.9 功能可用、已上架市场、本地运行正常；但刚完成的一轮审查**确证了若干真实缺陷**（其中两个属"严重"），修复方案已评估、**尚未动手**，等用户对 §5 的取舍做决定。

---

## 1. 新对话必读的注意事项

| # | 事项 |
|---|---|
| 1 | **§5 的四项决策还没做**。尤其"卡片是否放弃持久回放"是产品取舍，必须由用户定。 |
| 2 | **不要修改会话日志文件**（`~/.dsh/sessions/**/*.jsonl.zstd`）。用户倾向先不动存量数据；任何改写都不可逆，需单独明确授权。 |
| 3 | **不要调用 `ctx.sessionQuery.inspectSession`**（0.2.2-rc.5 已移除）；也不要再往 `KNOWN_SESSION_EVENT_TYPES` 里 add 新类型（官方明令禁止，见 §3.2）。 |
| 4 | **验证 semver 范围必须用 `node scripts/verify-peer-range.mjs`**（走 npm 自带 semver）。`node_modules` 里那份 semver 是 2.0.0 精简实现，不认合法写法，会给出错误的"失败"——之前因此绕了好几轮弯路。 |
| 5 | **不要凭 README 散文推断 chunk 形状**。`dsh-llm` README 写 `{ kind: 'error', failure }`，真实结构是 `{ type: "finish", reason: { kind, failure } }`（多一层 `reason`）。以包源码 `lib/index.js` 为准。 |
| 6 | **`ctx.llm.stream()` 不会因供应商错误抛异常**，一律以 `finish` chunk 正常结束。任何 `try/catch` 都抓不到限流/鉴权/上下文超限。 |
| 7 | **我们走的是直调通道，`dsh-llm-retry` 管不到我们**（single-attempt）。主会话会自动重试，顾问调用不会。 |
| 8 | 打包版 DSH 的 asar 里**没有** `docs/` 目录。完整官方文档在 `C:\Users\y\Documents\dsh-docs\docs`（1354 个文件，用户手动下载）。 |
| 9 | 读取 asar 内文件：`read` 工具能直接读（路径在 app.asar 内）；原生 shell 工具不行。 |
| 10 | 子代理只有 `deepseek-official` 一个路由，模型 id 为 `deepseek-flash`。 |
| 11 | 用户环境网络偶发不稳（ECONNRESET / EOF），遇到网络类报错先重试一次再下结论。 |
| 12 | 工作区目录名仍是旧名 `dsh-advisor-plugin`，但包名/仓库名已是 `dsh-advisor-chain`。**不要改目录名**（profile 的依赖引用指向此路径下的 tgz）。 |
| 13 | 历史遗留的三个身份：`dsh-advisor-plugin` → `dsh-second-opinion` → `dsh-advisor-chain`。事件类型 `advisor/*`、工具名 `second_opinion`、UI 品牌 "Second Opinion" 都**刻意保留旧名**，别"顺手统一"。 |

---

## 2. 仓库与环境事实（已核对）

| 项 | 值 |
|---|---|
| 工作区 | `C:\Users\y\Desktop\vibecoding\dsh-advisor-plugin` |
| GitHub | https://github.com/yyty947/dsh-advisor-chain （PUBLIC，MIT，topic `dsh-plugin`） |
| 分支 / HEAD | `main` / `8abb91d` |
| 工作树 | 干净；仅一个未跟踪文件 `scripts/diag-session.mjs`（上一轮诊断用，可删） |
| 本地版本 | package.json = 0.3.9，profile 内安装 = 0.3.9 |
| **npm 已发布** | **0.3.4、0.3.8**（另有一个占位版 `0.0.0-stage`）。**0.3.9 未发布** |
| 本地 tgz | `dsh-advisor-chain-0.3.9.tgz`（被 .gitignore 忽略） |
| 宿主 DSH | **0.2.3-alpha.2**（2026-11-23 从 0.2.2-rc.5 升级而来） |
| `engines.dsh` | **未声明**（只有 `engines.node`） |
| CI | `.github/workflows/ci.yml`，绿。install 用 `--frozen-lockfile --ignore-scripts` |
| 测试 | 42 个（6 个文件），全绿。**没有任何测试覆盖 `streamOnce` / `tool.execute`** |
| 市场收录 | PR #15287 **已合并**，条目 `data/plugins/yyty947__dsh-advisor-chain.yml` |

**已知的发布断层**：npm 上的 0.3.8 其 peer 范围第三段是 `>=0.2.3`，**不匹配 `0.2.3-alpha.2`**；修复在未发布的 0.3.9 里。即：通过 npm/市场安装的用户在当前宿主上可能被判定不兼容。

**构建/安装流程**（每次发版）：
```bash
# 用 DSH 运行时的 node/pnpm（PATH 上的 node 指向它，但它不带 npm）
export PATH="/c/Users/y/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin:$PATH"
PN="node /c/Users/y/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs"
$PN exec tsc --noEmit && $PN test && $PN run build
# 升版本号 → $PN pack → rm 旧 tgz → plugin_manager install_bundle 指向新 tgz
# npm publish 需用户在自己终端跑（浏览器授权/2FA 在用户手里）
```
`npm publish` 曾因**登录令牌过期**失败（表现为对已拥有包的 PUT 返回 404）。先 `npm whoami` 确认。

---

## 3. 刚完成的评估：已确证的问题

### 3.1 严重 — 服务端错误被静默吞掉（优先级最高）

- **位置**：`src/tool.ts` 的 `streamOnce()`，`for await` 循环只处理 `text-delta` / `reasoning-delta`。
- **机制**：供应商失败时 `ctx.llm.stream()` 发 `{ type:"finish", reason:{ kind:"error"|"aborted", failure:{ code, message, providerRetryAfterMs? } } }` 后正常结束。我们丢弃它。
- **后果（两个变体）**：
  1. 无输出 → 记为"空响应"，错误码全丢；
  2. **吐了部分文本后断流 → 被当成成功返回半截答案**，卡片显示"完成"。违反 `docs/DETAIL.md` 里"不会把半截回答当成完整结果"的承诺。
- **实证**：审查子代理解压了本机 82 个会话日志。用户主会话中 13 次咨询、6 次失败（46%），全部只显示"空响应"；其中 4 次是"吐 1 个 delta 后断流"。
- **失败码全集**在 `dsh-llm/lib/index.js` 的 `LLM_FAILURE_CODES`。官方默认可重试集合：`EMPTY_RESPONSE` `RATE_LIMIT` `SERVER` `TIMEOUT` `TRANSPORT`。

### 3.2 严重 — 向会话日志写自定义事件类型（数据安全）

- **位置**：`src/events.ts` 的 `ensureAdvisorEventTypes()`，往 `KNOWN_SESSION_EVENT_TYPES` 这个 Set 里 add 五种 `advisor/*` 事件，且在**模块加载时**执行、失败会 throw。
- **官方规则**（`practices.md:21`、`subsystems/session.md:273-283`）：读路径遇到未识别且未标 `ignorable` 的事件类型，**必须**拒绝重建整个会话——因为"未识别的必需事件可能改变后续日志的解读方式"。`Session.append()` 不校验类型，所以**写入永远成功、读取才炸**。
- **触发面**：插件被禁用/卸载/加载失败/换机器/换 profile/fork 分支/CLI 打开/回退版本。
- **现状**：用户已亲历一次（禁用后本会话打不开）。本机已有会话写了这类事件。
- **连带**：`ensureAdvisorEventTypes()` 的 throw 意味着——若未来 DSH 冻结/改名该集合，插件会**加载失败**，同时旧会话也打不开，无恢复路径。
- **用户另装的 `dsh-advisor-group`（第三方）用的是同一违规手法**，有相同隐患。不是我们能改的。

### 3.3 高 — 已对照官方文档确证

| # | 问题 | 依据 |
|---|---|---|
| 硬触发从未生效 | `src/index.ts:47` 读 `assembly?.agent?.session?.id`，但官方 `AssembleContext` 只有 `{ session?, scope?, signal? }`，**没有 `agent`** → 恒为 `undefined`。"重复提问强制咨询"和设置页的阈值都是摆设 | `subsystems/system-prompt.md` |
| 顾问看不到代码 | `src/transcript.ts` 的 `blockToText()` 对工具调用块只输出名字（`（工具调用 edit）`），**参数全丢**。顾问不知道读了哪个文件、改了什么 | 已读源码 |
| 环境注入被当用户发言 | `messageToEntry()` 只看 `role` 不看 `source`；技能目录/运行环境说明以 `[用户]` 开头进抄本，占预算且误导 | 审查子代理从真实日志取证 |
| 思考块噪声 | `reasoning` 块走兜底 JSON dump，每个 assistant 条目尾巴挂 200 字思考 | 已读源码 |

### 3.4 审查报告的其余条目 —— **未逐条复验，按"待验证"处理**

- 双意见模式：`Promise.allSettled` 吞掉取消；返回非空 `consultId` 导致 `render` 追加"可追问"提示，而工具描述写"不支持追问"（`HINT_DUAL` 永不可达）；追问分支只拒 `dual_opinions === true`，只带 `consult_id` 时会被接受并串模型。
- 追问丢失原条目的采样参数（`reasoningEffort`/`temperature`/`maxTokens`/`timeoutMs`），回落到默认 16384 maxTokens。
- 全链路零日志（`src/` 内 `console.*` 出现 0 次）。
- 推理档位写死 `off|low|high|max`，与模型实际支持集无关。
- `remote.llm.listProviders()` 失败时 provider 下拉只有一个空选项，用户被卡死，但提示文案说"仍可手动输入"。
- 每 200ms 一条 `advisor/delta` 事件；每条 append 前调 `snapshotEvents()`（append 会使缓存失效 → 全量拷贝日志数组）。实测单次咨询最多 350 条 delta。
- `append*` 抛错会毁掉一次本来成功的咨询（`flush()` 在 for-await 内，catch 里又调一次 `flush()`）。
- 设置保存把整份 draft（含所有默认值）写成显式覆盖 → 后续版本的默认值改进对老用户永不生效。
- 卡片轮次错位（追问失败重试会覆盖上一条 Q/A）。
- UI 文案全部硬编码中文；`locale:"chat"` 引用了不存在的 locale 包。
- `pressure` map 无界，存整条用户消息原文。

---

## 4. 已确证可用的官方能力（方案依据）

| 能力 | 契约 | 验证程度 |
|---|---|---|
| **`ctx.storageDomain.open(defineDomain(spec))`** | 带类型（zod）的 KV 表、持久化、版本化，完全独立于会话日志。**追问线程的合规存储位置** | 文档 + **本机运行时查询确认存在**（标注为 optional，需 `ctx.get("storageDomain")` 判空） |
| **`ctx.llm.resolveModelInfo(provider, model)`** | 返回 `reasoning.efforts`（模型支持的档位，从低到高）和 `reasoning.defaultEffort` | 文档类型定义 |
| **`output.presentationMeta(args, value)`** | `defineTool` 的可选字段，官方注释 "Pure replayable presentation projection for native and nested calls" | 签名确证；**它是否能承载自定义卡片的渲染，未验证** |
| **对话层事件定义** | 官方机制本就是"匹配已有事件 + Client-only 瞬时事件做实时流"，`tool/call` 与 `tool/result` 都是已有事件类型 | `subsystems/conversation.md:72` |
| **`engines.dsh`** | `"engines": { "dsh": "<semver range>" }`。声明后**它单独决定**兼容性，peer 范围被忽略 | `dsh-version.md`、`user/develop/basic/publish.md:66` |

**纠正一个早先的错误说法**：之前告诉用户"宿主没暴露每模型的推理档位"——**是错的**，`resolveModelInfo()` 一直有。

---

## 5. 待决策项（用户尚未决定 —— 不要替用户拍板）

### 决策 1：第 1 批（纯修缺陷）是否可以开始？
内容都是修缺陷、无设计取舍：
- 正确处理 `finish` chunk：按错误码分类、保留真实原因；"部分输出 + 错误"标记为截断失败
- 可重试码（`RATE_LIMIT`/`SERVER`/`TIMEOUT`/`TRANSPORT`/`STREAM_CLOSED`/`EMPTY_RESPONSE`）同模型退避重试 2 次，优先用 `providerRetryAfterMs`
- `CONTEXT_WINDOW_EXCEEDED` 不顺延（换模型无用），直接提示调低抄本预算
- 修硬触发（`assembly?.session?.id`，一行）+ 补单测
- 重写抄本：保留工具调用参数、按 `source.kind` 区分环境注入、跳过 reasoning
- 补 `engines.dsh`

### 决策 2：卡片是否放弃"持久回放"？（产品取舍）
停写自定义事件、改走官方机制后：
- **保留**：咨询进行中的实时显示；当次会话内的卡片
- **失去**：刷新/重开会话后 fancy 卡片不再重绘。历史里看到的是普通工具调用行 + 顾问回答文本
- **换得**：会话永不再因本插件打不开
- 我的建议：接受（会话数据安全 > 回放）。**但由用户定。**

### 决策 3：存量会话是否清理？
本机已有会话写了 `advisor/*` 事件。用户插件启用着所以都能开，风险在卸载/换机时。清理需改写会话日志（不可逆）。我的建议：**先不动**，等决策 2 落地后再评估是否提供带备份的修复工具。

### 决策 4：npm 发布 0.3.9（或修复后的新版本）
npm 上是 0.3.8，在当前宿主上 peer 不匹配。发布需用户在自己终端操作。

---

## 6. 建议的执行顺序（供参考，等用户确认）

1. **第 1 批**（决策 1）→ 发版 → 顺便解决 npm 断层
2. **第 2 批**（决策 2）：停写自定义事件；卡片走官方机制；追问线程迁到 `storageDomain`
3. **第 3 批**：档位下拉按模型动态生成；provider 可手填；双意见/追问的边界问题；§3.4 逐条验证与修复

每批的建议做法：先写失败测试复现 → 修 → 验证 → 打包安装 → 真实调用冒烟。

**冒烟测试的注意**：当前会话日志很大，曾出现两个顾问都返回"空响应"。那正是 §3.1 的缺陷掩盖了真实错误码。**在短会话里做冒烟**，或等第 1 批修完再测。

---

## 7. 关键文件索引

| 路径 | 说明 |
|---|---|
| `src/tool.ts` | 工具实现。`streamOnce()` 是 §3.1 的修复点 |
| `src/events.ts` | §3.2 的违规写入点 |
| `src/transcript.ts` | 抄本组装。§3.3 的修复点 |
| `src/index.ts` | 提示注入。`apply()` 里有硬触发 bug |
| `src/threads.ts` | 追问线程重建（当前从会话日志重建，需迁移） |
| `src/chain.ts` | 顾问链降级 |
| `src/client.ts` | 设置页 + 聊天卡片（约 1000 行） |
| `src/config.ts` / `prompt.ts` / `pressure.ts` | 配置 / 提示词 / 重复追踪 |
| `scripts/verify-peer-range.mjs` | semver 范围验证器（见注意事项 4） |
| `market/awesome-entry.yml` | 市场收录条目的本地草稿 |
| `HANDOVER-DSH-ADVISOR.md` | **最初的**交接文档（从 Codex 插件评估阶段来），历史背景用 |

**外部资料**：
- 官方文档：`C:\Users\y\Documents\dsh-docs\docs`（重点：`subsystems/{session,session-projection,llm-streaming,tools,conversation,system-prompt,storage}.md`、`core-guidelines/`、`defensive-patterns/`、`upgrade-guide/`）
- 宿主包源码：`D:\Users\y\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\`（用 `read` 工具读）
- `dsh-doc` 技能：处理 DSH 相关任务前先加载
- 灵感来源：https://github.com/pixelsama/codex-advisor

**同赛道其他插件**（定位不同，供参考）：`leeyoung1/dsh-advisor-plugin`（随车审查员 + 巡逻）、`xfgil/dsh-second-opinion`（跨会话借脑，**占了 npm 名 `dsh-second-opinion`**，所以我们改名）。
