# AGENTS.md

给在这个仓库工作的 agent。读完即可开工；细节按下面的指针按需加载。

## 这是什么

DSH 插件 `dsh-advisor-chain`（Second Opinion）：主模型调用 `second_opinion`，插件启动一个**只读的原生子代理**当顾问，把会话抄本（或仅问题与背景）交给它，结果作为工具结果返回并渲染成卡片。宿主半是 `src/index.ts`（ESM），浏览器半是 `src/client.ts`（IIFE，经 `window.__ModuleLoader__` 加载）。

## 按需加载

- 改动引擎、抄本、追问、卡片数据流，或想知道某个决策为什么这样定 → 读 `docs/ARCHITECTURE.md`（模块表、宿主契约表、决策与理由）。
- 宿主升级后、抬 `engines.dsh` 下限前、或某个宿主 API 行为看起来变了 → 读 `docs/COMPATIBILITY.md`，逐项核对再冒烟。
- 提交、分支、装到本机 profile、发版 → 读 `docs/CONTRIBUTING.md`。
- 下一版要做什么 → `CHANGELOG.md` 的「未发布 → 计划」。

## 每次改动

1. 核对宿主契约再写代码：`node_modules/@deepseek-ai/<pkg>/src/` 与 `lib/types/` 是当前宿主版本（0.2.3-alpha.2）的源码和类型；运行中宿主 asar 里的副本只能用支持 asar 的读取工具看。README 散文与真实结构可能不一致（例如 `finish` chunk 多包一层 `reason`），以源码为准。
2. 用 DSH 运行时的 node/pnpm（见 CONTRIBUTING），跑 `vitest run` + `tsc --noEmit`，全绿再提交；一个逻辑改动一个提交，conventional 前缀，英文。
3. 用户可见文案：客户端走 `src/client/i18n.ts` 的字典（`t("key")`，zh/en 各一份、键集一致），宿主侧走 `src/i18n.ts`。界面语言跟随 DSH 的 locale，宿主侧文案按用户消息自动判断语言——插件不提供语言设置。工具的参数说明固定英文。
4. 涉及 `package.json` 的 peer / `engines.dsh` 范围 → 跑 `node scripts/verify-peer-range.mjs`（用 npm 自带的 semver，两种模式）。`node_modules` 里那份 semver 是精简实现，会给错误结论。
5. 推送前 `git grep` 本机路径、个人供应商名、令牌模式；`lib/` 构建产物随源码一起提交（GitHub 直装靠它）。

## 宿主契约里容易踩的点

- `ctx.subagents.startActivation` 的运行时**不校验**子代理模型白名单：插件自己在启动前查 `allowedRoutes()`，尊重宿主设置。
- 只读沙箱靠 `subagent/start` 监听里 `setSandboxMode(session, "read-only")`；回读以**会话日志**最后一条 `sandbox/mode` 为准，`overrideOf()` 读的是异步投影，刚追加后可能还是旧值。
- `agent/request-error` 是 waterfall：监听器必须 `next()`，否则会 veto 宿主的重试插件。
- 子代理失败的真实原因在子会话的 `agent/request-error` 里，`activation.result` 本地结果没有 diagnostic；它 reject 只发生在基础设施故障。
- `subagent/start` 的 payload 没有 label；识别自己的子会话靠子会话 `subagent/descriptor` 事件里的 `second-opinion:` 前缀。
- `KNOWN_SESSION_EVENT_TYPES` 只允许**读**垫片（旧会话用），永不往会话日志写自定义事件；宿主明确否决了事件名注册。
- `snapshotEvents()` 已被宿主标 deprecated，目前可用；升级宿主时核对。
- fork 不含当前轮且在本机 JSONL 后端复制父日志——不用 fork，用 spawn + 抄本。

## 成本

顾问默认跑在精简 preset 上（`src/advisor/preset.ts`）：只有 read / read_image / grep / glob / pwsh(bash)，宿主级工具被 deny 名单挡住，技能目录不挂。实测同一问题的输入从 **48,887 降到 3,651 token**。任何会改顾问输入的改动都要用 `node scripts/measure-advisor-usage.mjs <子会话日志>` 量 before / after（子会话目录按子会话 id 命名，在 `~/.dsh/sessions/<工作区>/` 下）；preset 不可用时自动回退为继承，原因写在结果注记里——宿主不落日志，那是唯一可见的诊断通道。
