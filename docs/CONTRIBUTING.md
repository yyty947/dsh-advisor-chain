# 贡献与发布

## 开发环境

- Node ≥ 22.19，pnpm 11。Windows 上推荐直接用 DSH 运行时自带的版本，与 CI 一致：

  ```powershell
  $RN  = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  $PNM = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
  & $RN $PNM install
  ```

- 日常命令：`pnpm test`（vitest）、`pnpm typecheck`、`pnpm build`（tsdown → `lib/index.mjs` + `lib/client.js`）。
- `node_modules` 里的 `@deepseek-ai/*` 是 0.2.3-alpha.2 的 npm 包，带 `.d.ts` 和 `src/`，核对契约优先看它们；运行中宿主的 asar 内副本只能用支持 asar 的读取工具看。

## 提交与分支

- 一个逻辑改动一个提交，conventional 前缀（`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`），英文。
- 每批工作一个分支（`feat/<version>-<topic>`），推送到远端后开 Draft PR；`main` 只接收合并，文档类小改可直接推。
- `lib/` 构建产物随源码提交：GitHub 直装拿的是源码，没有 `lib/` 会加载失败（DSH 文档《Installing from GitHub: the build-script catch》）。
- 不进仓库的东西：`*.tgz`、`node_modules`、任何含本机路径 / 个人供应商 / 令牌的配置或日志。推送前 `git grep` 一次。

## 装到本机 profile 测试

```powershell
& $RN $PNM build; & $RN $PNM pack --pack-destination .
# 然后用 plugin_manager：remove_bundle dsh-advisor-chain → install_bundle <tgz 路径>
```

同版本重装会被拒（`already-installed`），所以要先 remove 再 install。pnpm 重命名 profile 的 `package.json` 偶发 `EPERM`（杀软 / 索引器占用），等几秒重试即可。客户端改动需要刷新浏览器页面。

## 发布

1. tests / typecheck / build 全绿；`node scripts/verify-peer-range.mjs` 全部 ok。
2. CHANGELOG：「未发布」改成版本号 + 日期；README / DETAIL 同步。
3. 合并到 `main`，打 tag `vX.Y.Z` 并推送。
4. GitHub Release：正文用 CHANGELOG 对应段，附上 tgz。
5. `npm publish <tgz> --access public`（需要 2FA，在维护者终端完成）。
6. 发布后发现的 bug 走补丁号，从 `main` 开 `fix/` 分支。
