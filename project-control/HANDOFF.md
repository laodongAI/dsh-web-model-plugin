# AIMES 试点交接基线

- 项目：`laodongAI/dsh-web-model-plugin`
- 任务：`TASK-DSH-001`（待执行）
- 治理分支：`aimes/pilot-baseline`
- 功能分支盘点基线：`feature/web-ai-model-mode` @ `15ea7f05f04c43517dfc5f58da843a81e5b7318f`
- 当前阶段：远程静态盘点完成；本地环境与运行验证未完成。

## 已确认

- 仓库存在 TypeScript 插件代码、十个 Provider 页面适配器、Client/Host 浏览器桥接、HTTP 路由和测试。
- `package.json` 当前读取版本为 `0.2.29`；README 中“当前版本”标注为 `0.2.4`，原因未确认。
- 本次远程盘点没有执行安装、类型检查、测试或构建。

## 下一步

1. 在用户本地工作区检查 `git status --short --branch`、当前 commit 和未提交修改。
2. 确认本地是否跟踪 `feature/web-ai-model-mode`，并与远程基线比较。
3. 查找 Git tags、release 记录和近期 package/README 版本变更，解释版本差异。
4. 执行项目规定的检查（在确认环境与依赖后）：`pnpm typecheck`、`pnpm test`、`pnpm build`。注意 `pnpm test` 脚本本身会先执行 build。
5. 根据真实结果更新当前状态和任务记录。

## 安全提示

- 不要把本交接当作本地工作区状态的证明。
- 不要覆盖用户未提交修改。
- 不要因为 README 与 package.json 版本不同就直接把其中一个版本改成另一个。
- 不要在缺少测试证据时标记为 VERIFIED。
