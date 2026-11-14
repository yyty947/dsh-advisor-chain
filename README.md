# dsh-second-opinion

[English intro below](#english)

DeepSeek Harness（DSH）插件：让主模型在需要时——自动判断或用户手动触发——向配置好的**顾问模型链**征求第二意见。

核心特性：

- **自动上下文继承**：顾问通过 DSH 会话投影 `deriveMessages()` 自动看到当前会话的完整对话记录，主模型调用 `second_opinion` 时只需一句问题，不复述背景（`context` 参数仅用于补充对话之外的信息）。
- **降级链**：顾问模型按顺序尝试，失败（出错或超时无产出）自动顺延；超时但有部分产出按「已截断」显式标记。
- **触发**：auto（系统提示软规则 + 同一问题重复 N 次的硬触发）/ manual（仅用户明确要求）。
- **会话卡片**：咨询过程（问题、思考、回答、尝试记录）以会话事件留痕，UI 渲染成卡片，可回放。
- **原生设置页**：设置 → 插件 → Second Opinion（第二意见）；模型链编辑、provider/模型下拉、推理档位；保存即时生效。

设计文档与决策记录见 [HANDOVER-DSH-ADVISOR.md](HANDOVER-DSH-ADVISOR.md)。

## 开发

```bash
pnpm install
pnpm build        # tsdown → lib/index.mjs + lib/client.js
pnpm test         # vitest
pnpm typecheck
```

安装到 DSH：设置 → 插件 → 添加插件，选择本目录（本地目录链接安装，改代码后 `pnpm build` + 重载生效）；或把本目录加入 plugin market 索引后安装。`lib/` 构建产物随仓库提交，方便直接链接安装。

## License

MIT

---

# English

A DeepSeek Harness (DSH) plugin: the main model asks a configured **advisor model chain** for a second opinion whenever needed — auto-judged or user-triggered.

Highlights: automatic full-conversation context inheritance via `deriveMessages()` (the advisor sees what the main model sees; no manual background hand-off); an ordered fallback chain with per-entry timeout and explicit truncation marking; auto/manual trigger modes with a repeated-question hard trigger; durable consultation cards in the chat stream; and a native settings page with model-chain editing. See [HANDOVER-DSH-ADVISOR.md](HANDOVER-DSH-ADVISOR.md) for the design history.
