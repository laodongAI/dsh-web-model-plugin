# AIMES 试点项目基线盘点

- **文档编号**：AIMES-DSH-AUDIT-001
- **项目**：DSH Web AI Provider 插件（包名 dsh-account-models）
- **盘点日期**：2026-10-13
- **盘点分支**：feature/web-ai-model-mode
- **盘点提交**：15ea7f05f04c43517dfc5f58da843a81e5b7318f
- **状态**：初步盘点；尚未运行本地构建与测试

## 1. 盘点范围与限制

本次依据 GitHub 仓库分支文件树、README.md、package.json、tsconfig.json 和 GitHub Actions 构建工作流进行远程静态盘点。未读取用户本地工作区，未执行 pnpm install、typecheck、test 或 build，因此本文件不声称代码已通过验证，也不能证明本地没有未提交修改。

## 2. 已确认事实

- 仓库：`laodongAI/dsh-web-model-plugin`。
- 盘点时开发分支：`feature/web-ai-model-mode`。
- 盘点时分支头提交：`15ea7f05f04c43517dfc5f58da843a81e5b7318f`，提交信息为 `fix: restore Copilot answer detection`。
- 项目包名：`dsh-account-models`。
- `package.json` 中版本为 `0.2.29`，要求 Node.js `>=22`。
- 脚本定义：`pnpm typecheck`、`pnpm build`、`pnpm test`；test 会先 build，再执行 Node.js 测试。
- README 当前标题为 `dsh-account-models`，其“当前版本”文字标注为 `0.2.4`，与 package.json 的 `0.2.29` 不一致，需核实。
- 主要代码区域包括账户管理、浏览器/CDP 与 webview bridge、DSH Browser adapter、Provider catalog、Web page adapter、十个 Provider 页面适配器、HTTP routes 和 Client bundle。
- 已存在测试文件：`tests/account-store.test.mjs`、`tests/adapter-recovery.test.mjs`、`tests/bridge-and-routes.test.mjs`、`tests/copilot-page.test.mjs`、`tests/web-page.test.mjs`。
- 已存在 GitHub Actions 工作流：`.github/workflows/build.yml`。
- 本次盘点的分支文件树中未发现 `AGENTS.md`、系统化 `docs/` 目录、`project-control/` 或机器可读追溯注册表。

## 3. 初步风险与待核实事项

| 编号 | 事项 | 级别 | 当前判断 | 后续动作 |
|---|---|---|---|---|
| AUD-001 | README 版本与 package.json 版本不一致 | 高 | 已确认存在文本差异，原因未知 | 检查发布记录、Git 标签和最近版本变更，再决定修正文案 |
| AUD-002 | 缺少统一 AI 工具规则入口 | 高 | 盘点分支中未发现 AGENTS.md | 建立规则入口，并验证 ZCode/Trae/VS Code 的实际加载方式 |
| AUD-003 | 业务/需求/设计/实现/测试追溯缺失 | 高 | 未发现正式追溯注册表 | 先梳理模块与关键功能，再建立少量可核实的映射 |
| AUD-004 | README 兼有架构说明和安装手册职责 | 中 | 内容较多且混合设计、版本、安装与验收说明 | 保留有效内容，逐步拆分并建立互相链接的权威文档 |
| AUD-005 | 浏览器桥接和多 Provider 页面适配具有动态行为 | 高 | 从文件结构可确认该领域是核心实现面；具体缺陷状态待运行验证 | 补充桥接状态机、错误处理和关键路径测试映射 |
| AUD-006 | 远程盘点无法反映本地未提交修改与运行环境 | 高 | 本次未访问本地工作区 | 在本地执行基线检查并记录实际 Git 状态和验证结果 |

## 4. 代码模块初步地图

以下模块根据仓库路径与 README 初步归类，具体符号职责需进一步阅读源文件验证。

| 模块候选 | 主要路径 | 需要补充的知识 |
|---|---|---|
| 插件入口与 DSH 集成 | `src/index.ts`、`src/dsh-browser-adapter.ts` | 注册生命周期、LlmAdapter、模型目录和事件流程 |
| Provider 目录 | `src/provider-catalog.ts`、`src/providers/provider.ts` | 十个 Provider 的 ID、URL、能力与兼容规则 |
| 网页交互适配 | `src/providers/web-page.ts`、`src/providers/*/*-page.ts` | 页面状态、输入、回答读取、停止、附件与异常 |
| 浏览器桥接 | `src/browser/webview-bridge.ts`、`src/browser/cdp-client.ts` | Client/Host 通信、超时、错误和安全边界 |
| 会话与对话 | `src/browser/conversation-manager.ts` | Provider、Tab、Session、Conversation 绑定 |
| 账户与配置 | `src/account-manager.ts`、`src/account-store.ts`、`src/web-ai-config.ts` | 元数据持久化和兼容迁移 |
| HTTP 路由 | `src/http-routes.ts` | 路由契约、参数校验与错误语义 |
| Client 生命周期 | `src/client/index.js`、`scripts/build-client.mjs` | 侧栏打开、Tab 复用与客户端构建 |
| 测试 | `tests/*.test.mjs` | 测试覆盖范围、缺失场景与真实运行结果 |

## 5. 本轮治理变更

- 新增仓库级 `AGENTS.md`，统一多工具协作和安全约束。
- 本文件作为首次盘点记录，后续以新的审计记录或更新后的状态文档维护事实。
- 在单独的 `aimes/pilot-baseline` 分支开展治理骨架工作，避免直接把治理初始化提交到现有功能开发分支。

## 6. 下一步任务

1. **TASK-DSH-001：本地基线与版本差异核验**。核对当前本地分支、工作区状态、commit、版本标签和 README 版本。
2. **TASK-DSH-002：模块与业务/功能目录**。阅读入口、Provider catalog、桥接、网页适配器和测试，建立模块 ID 与关键功能清单。
3. **TASK-DSH-003：追溯注册表最小实现**。为核心功能建立需求/设计/代码/测试关系，并确保路径和测试名称真实存在。
4. **TASK-DSH-004：治理检查原型**。优先实现只读的文档与追溯检查，再考虑任务生成和临时清理。

## 7. 证据与更新规则

- 代码事实应链接到真实文件/符号；验证事实应记录实际命令、退出码、时间和日志位置。
- 任何未在当前基线重新验证的历史描述均标注为“待验证”。
- 不根据文件名或模型推断自动删除文件。
