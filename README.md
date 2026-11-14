# dsh-second-opinion

[English intro below](#english)

DeepSeek Harness（DSH）插件：让主模型在需要时——自动判断或用户手动触发——向配置好的**顾问模型链**征求第二意见。

核心特性：

- **自动上下文继承**：顾问通过 DSH 会话投影 `deriveMessages()` 自动看到当前会话的完整对话记录，主模型调用 `second_opinion` 时只需一句问题，不复述背景（`context` 参数仅用于补充对话之外的信息）。
- **降级链**：顾问模型按顺序尝试，失败（出错或超时无产出）自动顺延；超时但有部分产出按「已截断」显式标记。
- **盲审模式**：`mode: "standalone"` 时顾问不看对话，只依据问题与补充背景独立判断，并可推翻主代理的既有观点——适合需要不受主对话思路影响的场景（设置里可改默认模式）。
- **追问**：每次咨询返回 `consult_id`，携带它 + `follow_up` 可让同一位顾问带着线程上下文继续作答；线程持久化在会话日志中，重启后依然可追问。
- **双意见对比**：`dual_opinions: true` 并行咨询链上前两位顾问（互不可见），一次拿到两份独立意见。
- **触发**：auto（系统提示软规则 + 同一问题重复 N 次的硬触发）/ manual（仅用户明确要求）。
- **会话卡片**：咨询过程（问题、思考、回答、追问 Q/A、尝试记录）以会话事件留痕，UI 渲染成卡片，可回放。
- **原生设置页**：模型链编辑、provider/模型下拉（可拉取模型列表）、推理档位、默认咨询模式；保存即时生效。

设置入口：**设置 → Second Opinion**。设计文档与决策记录见 [HANDOVER-DSH-ADVISOR.md](HANDOVER-DSH-ADVISOR.md)。

## 安装

**npm 包（推荐——预构建安装免构建授权）**

```bash
dsh plugin --profile desktop add dsh-second-opinion
```

**GitHub 直装（从源码构建）**

```bash
dsh plugin --profile desktop add github:yyty947/dsh-second-opinion
```

首次从源码安装会请求授权一次 esbuild 构建脚本（allowBuilds），确认即可。安装后重启 DSH 生效。

本地开发安装：设置 → 插件 → 添加插件，选择本目录（目录链接安装，改代码后 `pnpm build` + 重载生效）。

## 开发

```bash
pnpm install
pnpm build        # tsdown → lib/index.mjs + lib/client.js
pnpm test         # vitest
pnpm typecheck
```

## License

MIT

---

# English

A DeepSeek Harness (DSH) plugin: the main model asks a configured **advisor model chain** for a second opinion whenever needed — auto-judged or user-triggered.

Highlights: automatic full-conversation context inheritance via `deriveMessages()` (the advisor sees what the main model sees; no manual background hand-off); an ordered fallback chain with per-entry timeout and explicit truncation marking; auto/manual trigger modes with a repeated-question hard trigger; durable consultation cards in the chat stream; and a native settings page with model-chain editing. See [HANDOVER-DSH-ADVISOR.md](HANDOVER-DSH-ADVISOR.md) for the design history.

## Install

```bash
dsh plugin --profile desktop add dsh-second-opinion
# or, building from source:
dsh plugin --profile desktop add github:yyty947/dsh-second-opinion
```
