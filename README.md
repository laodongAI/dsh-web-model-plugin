# dsh-account-models

面向 DSH 0.2.0-rc.2 的 Web AI 浏览器会话模型插件。

## 目标
在 DSH 中提供一个统一的 Web AI 模型入口。10 个 Provider 直接进入 DSH 中间模型选择器；普通 DSH 对话通过 DSH 右侧原生 Browser 调用对应网站模型。

支持：DeepSeek、ChatGPT、Qwen、腾讯混元 AI Studio、豆包、Perplexity、Microsoft Copilot、HuggingChat、Kimi、智谱 AI。

## 设计原则
- 使用 DSH 原生 Right Sidebar Browser。
- Desktop Browser Tab 使用 DSH 管理的 Electron `<webview>` 与工作区级浏览器存储。
- Host 页面适配器通过受控 Client bridge 在同一个可见 webview 中完成 DOM 页面发现、输入、回答读取和停止生成。
- 不读取或保存密码、Cookie、Access Token、Refresh Token。
- 不调用目标网站私有 HTTP API，不做 HTTP 重放。
- CAPTCHA、二次验证等人工验证由用户在浏览器中完成。
- DSH 侧只注册一个 `web-ai` LLM Provider；具体 Provider 由 `GenerateOptions.model` 选择，账号由 Host 按 Provider 自动管理。

## DSH 集成
- 使用 ctx.llm.registerAdapter 注册统一 web-ai Provider。
- 使用 ctx.webServer.register 注册插件 HTTP 路由。
- 使用 Schemastery Config。
- 使用 AttachmentStore 处理图片和文件附件。
- LLM 流式输出遵循 DSH LlmAdapter / StreamChunk 协议。

## Client
- 不再提供插件 Settings 配置页，也不再维护默认 Provider / 默认账号运行时配置。
- Provider 直接出现在 DSH 中间模型选择器中，共 10 个 Web AI Provider；**不新增左侧 Provider 栏，不改变 DSH 原生三栏布局**。
- Right Sidebar 使用 DSH 原生 Browser；官方 Browser 支持多实例/多 Tab，网站打开、人工登录和人工调试优先在这里完成。
- Client bundle 保留最小生命周期入口，避免再增加一套 Provider 配置 UI。

## Web AI 模型
模型选择器使用 Provider 作为稳定模型 ID：`deepseek`、`chatgpt`、`qwen`、`tencent-yuanbao`、`doubao`、`perplexity`、`copilot`、`huggingchat`、`kimi`、`chatglm`；旧版 `default` / `web-ai:*` 仅保留兼容解析。

发送请求链路：
DSH Agent Loop → web-ai → 选中的 Web AI Provider model → AccountProvider → DSH Right Sidebar Browser → Web AI 页面 DOM → StreamChunk → DSH Agent Loop。

0.2.1 开始，模型选择器直接列出 10 个 Web AI Provider；不再通过插件 Settings 配置默认 Provider。选择某个 Provider 后，Client 自动在 DSH Right Sidebar 打开对应 Browser Tab；首次实际请求直接复用该可见页面。Adapter 保留 DSH 的 tools 上下文；Web AI 如果按约定输出 `<dsh_tool_call>...</dsh_tool_call>`，插件会转换为 DSH 原生 `tool-call` 分片，由 DSH Agent Loop 继续执行本地工具并把 Tool Result 带回下一轮 Web AI。

因此切换 Provider 时不需要更换 DSH 模型类型。

## 数据目录
~/.dsh/account-models/

其中 `accounts.json` 保存 Provider 浏览器账号元数据；`config.json` 仅保留旧版本默认账号配置用于兼容，不再作为新版本 Provider 选择入口；真正的网页登录状态由 DSH Desktop Browser 的工作区级存储机制管理。

## Provider / Browser
模型选择器直接显示 DeepSeek、ChatGPT、Qwen、腾讯混元 AI Studio、豆包、Perplexity、Microsoft Copilot、HuggingChat、Kimi、智谱 AI。

DSH 解析/执行选中的 Provider 后，插件会记录当前 Provider；Client 侧自动把对应 URL 打开到 DSH 原生 Right Sidebar Browser，并复用相同 URL 的 Browser Tab。用户可以直接在右侧完成登录、验证和人工调试。

0.2.4 已取消插件自行启动 Chrome/Chromium 的运行时路径。Provider 选择后直接打开 DSH 原生 Right Sidebar Browser；Desktop 的 Browser Tab 使用 Electron `<webview>`，插件 Client 通过受控 bridge 将 Host 页面适配器的 DOM 操作转发到当前 Provider 的可见 webview。因此用户手工登录/调整的就是 Agent 后续真正使用的页面。

## HTTP Routes
GET  /api/dsh-account-models/accounts
GET  /api/dsh-account-models/active-provider
POST /api/dsh-account-models/accounts/add
POST /api/dsh-account-models/accounts/open
POST /api/dsh-account-models/accounts/check
POST /api/dsh-account-models/accounts/close
POST /api/dsh-account-models/accounts/remove

## 构建
要求 Node.js >= 22、pnpm 或 npm；不再要求插件自行安装或启动 Chrome/Chromium。

pnpm install
pnpm typecheck
pnpm build

## 打包
Windows PowerShell：
Remove-Item -Recurse -Force lib -ErrorAction SilentlyContinue
Remove-Item -Force packed\* -ErrorAction SilentlyContinue
pnpm install
pnpm typecheck
pnpm build
pnpm pack --pack-destination .\packed

当前版本：dsh-account-models-0.2.4.tgz

建议每次生成新的 tgz 后再安装，避免 DSH 插件管理器继续使用旧缓存包。

## DSH Desktop 安装
完全退出 DSH Desktop 后执行：
dsh.cmd plugin --profile desktop add .\packed\dsh-account-models-0.2.4.tgz

如之前安装过旧版本：
dsh.cmd plugin --profile desktop remove dsh-account-models

安装完成后重新启动 DSH Desktop。

## 验收路径
1. DSH 启动日志不再出现 dsh-account-models: import failed。
2. DSH 中间模型选择器直接出现 10 个 Web AI Provider。
3. 选择任一 Provider 后，右侧 DSH 原生 Browser 自动打开该 Provider 页面。
4. 在右侧浏览器中手工完成网页登录；后续请求继续使用同一个 DSH Browser Tab/工作区存储。
5. 右侧 Sidebar 使用 DSH 原生 Browser 多 Tab 进行网页浏览和调试。
6. 普通 DSH 对话必须先在 DSH 中间模型选择器明确选择一个 Web AI Provider，再通过该 Provider 完成请求；Web AI 长 Thinking 不再因默认 60 秒无首字超时提前失败。
8. 同一 DSH Session 保持对应网页 Conversation。
9. 当 DSH 提供 tools 时，Web AI 可以通过工具调用协议请求本地 Agent Tool，由 DSH 执行后继续下一轮模型推理。
10. Stop 能停止网页生成。
11. 手工切换网页 Conversation 后应返回 PAGE_CHANGED。
12. Right Sidebar 的 Web AI 浏览器显示 DSH 原生 Browser 页面，Host 页面适配器与用户看到的是同一个 webview。

## 当前边界与下一步
DSH 官方 Right Sidebar Browser 在 Desktop 中使用 Electron `<webview>`，支持多实例 Browser Tab 与 `keepMounted`；官方 Sidebar 契约明确支持 `ctx.sidebarRight.openTab('browser', { params: { url } })`，因此 Provider 不需要另建浏览器 UI。当前插件进一步通过 Client→Host HTTP bridge，让 Host 页面适配器的 DOM 表达式在对应的可见 webview 中执行。

当前 Browser Automation Bridge 已在插件内落地为 Host HTTP 队列 + DSH Client `<webview>.executeJavaScript()` 的受控通道。它只执行本插件页面适配器产生的 DOM 表达式，不向网页暴露 Node/Electron API。文件上传仍要求用户先在右侧浏览器手工完成，因为 Electron webview 的 DOM 执行接口不能等价替代原生 CDP 的文件选择能力。后续如 DSH 官方开放更完整的 Browser automation seam，可再将该 bridge 替换为官方接口。

## 安全边界
本插件不保存密码、不提取 Cookie/Token、不调用目标站点私有 API、不重放浏览器 HTTP 请求、不绕过 CAPTCHA 或二次验证。

当前版本：0.2.4
目标：DSH 0.2.0-rc.2
