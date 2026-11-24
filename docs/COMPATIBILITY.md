# 宿主升级回归清单

DSH 几乎每天发版，且多为预发布。每次升级宿主后、以及每次抬高 `engines.dsh` 下限前，按本清单核对。所有条目都对应插件依赖的某个具体宿主行为，行为一变就会出错。

## 1. 静态核对（升级后立刻做）

| # | 依赖 | 核对方法 | 变了会怎样 |
|---|---|---|---|
| 1 | `@deepseek-ai/dsh-subagent` 导出 `SubagentRuntime`、`foldSubagentDescriptor`、`delegationDepthOf`、`SubagentError` | 读 `app.asar/dsh/node_modules/@deepseek-ai/dsh-subagent/lib/index.js` 末尾的 `export { … }` | 插件加载失败（import 不存在的导出） |
| 2 | `@deepseek-ai/dsh-sandbox-policy` 导出 `setSandboxMode` | 同上 | 同上 |
| 3 | `subagent/start` 在子代理创建后、首条提示入队前同步发出；`subagent/descriptor` 在 setup 阶段写入 | 读 `dsh-subagent/src/manager.ts`，搜 `subagent/start` 与 `appendDelegatedPolicyOverrides` | 顾问识别不到 → fail-closed 中止咨询；或有子会话未被套 read-only（有回读校验兜底） |
| 4 | `overrideOf()` 读异步投影；日志里的 `sandbox/mode` 事件是权威 | `dsh-sandbox-policy/src/index.ts` | 只读回读误判 |
| 5 | `KNOWN_SESSION_EVENT_TYPES` 未被 `Object.freeze`；读路径对未知非 ignorable 类型仍拒绝重建 | `dsh-session/src/known-event-types.ts`、`surface.js` 的 `surfaceOpOf` | 垫片退化为日志告警；旧会话打不开 |
| 6 | `Session.snapshotEvents()` 仍可用（已标 `@deprecated`） | `dsh-session/src/index.ts` | 多处读取失败（抄本、沙箱回读、追问计数） |
| 7 | `tool.call.toolview` keyed slot；`block.args` 为 `PartialArguments` 读取器；`block.meta` 携带 `presentationMeta` | `dsh-client-ui-tool/src/client/contract/slots.ts`、`tool/ToolCallTree.tsx` | 卡片不渲染或参数读不到 |
| 8 | `remote.settings.update` 为 merge 语义、数组整体替换；`SettingsConflictError` 文案 | `dsh-settings/src/index.ts` | 设置页保存 / 授权异常 |
| 9 | `settings.section.icon` slot 存在 | 同 7 | 侧栏回退默认齿轮（无害） |
| 10 | `engines.dsh` 用 `semver.satisfies(v, range, { includePrerelease: true })` 评估 | `dsh-app-boot` 源码 | 范围判断偏差；跑 `node scripts/verify-peer-range.mjs` |
| 11 | 宿主的 locale 服务：`ctx.locale.register(ns, { zh, en, … })` / `bind(ns)`；`settings.section` 注册项的 `label` 可为 thunk、`locale` 选项触发重渲染 | `dsh-client-locale/src/client/index.ts` | 客户端文案回退为中文 |
| 12 | 是否出现了删除会话的公开 API（目前持久化服务只有 `create / open / stat / list`） | `subsystems/persistence.md` 的 `SessionPersistence` 表 | 出现后可做顾问子会话清理（见 CHANGELOG 计划） |

## 2. 冒烟（装上新宿主后，在短会话里做）

1. 盲审模式咨询一次：顾问作答，卡片显示模型 / 完成。
2. 让顾问尝试写文件：应被沙箱拒绝（`file access denied under read-only mode`）。
3. 追问一次：卡片显示「追问 1」，顾问记得上一轮。
4. 继承模式咨询一次：结果 notes 里的抄本省略 / 截断计数合理。
5. 打开一个 0.3.9 期间咨询过的旧会话：能打开，旧卡片带「旧版记录」徽章。
6. 设置页：链条目状态、授权按钮、横幅（若未.dismissed）、保存。

## 3. 抬高 `engines.dsh` 下限时

- 在 `upgrade-guide/` 里逐条确认用到的 API 的引入版本（见 CHANGELOG 0.3.10 的核实方法：`vX/<topic>/guide.md` 描述的是 **X 版本之后**的行为）。
- 同步修改 `package.json` 的 `engines.dsh` 与全部 `@deepseek-ai/dsh-*` peer 范围，更新 `scripts/verify-peer-range.mjs` 的用例表，跑一遍。
