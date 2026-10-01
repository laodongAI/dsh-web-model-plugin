# dsh-account-models

面向 DSH 0.2.0-rc.2 的 Web AI 浏览器会话模型插件。

## 目标
在 DSH 中提供一个统一的 Web AI 模型入口。用户在 Web AI 设置中选择 Provider 并配置浏览器账号，普通 DSH 对话通过可见 Chromium 浏览器调用对应网站模型。

支持：DeepSeek、ChatGPT、Qwen、腾讯混元 AI Studio、豆包、Perplexity、Microsoft Copilot、HuggingChat、Kimi、智谱 AI。

## 设计原则
- 使用用户可见的 Chrome/Chromium。
- 每个 Web AI 账号使用独立、持久化 Chromium Profile。
- 使用 CDP + DOM 完成页面发现、输入、回答读取、附件上传和停止生成。
- 不读取或保存密码、Cookie、Access Token、Refresh Token。
- 不调用目标网站私有 HTTP API，不做 HTTP 重放。
- CAPTCHA、二次验证等人工验证由用户在浏览器中完成。
- DSH 侧只注册一个 web-ai LLM Provider；具体 Provider 和账号由默认 Web AI 配置动态决定。

## DSH 集成
- 使用 ctx.llm.registerAdapter 注册统一 web-ai Provider。
- 使用 ctx.webServer.register 注册插件 HTTP 路由。
- 使用 Schemastery Config。
- 使用 AttachmentStore 处理图片和文件附件。
- LLM 流式输出遵循 DSH LlmAdapter / StreamChunk 协议。

## Client
- 不再提供插件 Settings 配置页。
- Provider 直接出现在 DSH 中间模型选择器中，共 10 个 Web AI Provider。
- Right Sidebar 使用 DSH 原生 Browser；官方 Browser 支持多实例/多 Tab，Provider 登录和人工调试优先在这里完成。
- Client bundle 保留最小生命周期入口，避免再增加一套 Provider 配置 UI。

## Web AI 模型
模型选择器使用稳定模型 ID：default（兼容旧版 web-ai:default）。

发送请求链路：
DSH Agent Loop → web-ai → 选中的 Web AI Provider model → AccountProvider → Chromium Profile/CDP → Web AI 页面 → StreamChunk → DSH Agent Loop。

0.2.1 开始，模型选择器直接列出 10 个 Web AI Provider；不再通过插件 Settings 配置默认 Provider。选择某个 Provider 后，首次实际请求会自动建立/打开对应浏览器会话。Adapter 保留 DSH 的 tools 上下文；Web AI 如果按约定输出 `<dsh_tool_call>...</dsh_tool_call>`，插件会转换为 DSH 原生 `tool-call` 分片，由 DSH Agent Loop 继续执行本地工具并把 Tool Result 带回下一轮 Web AI。

因此切换 Provider 时不需要更换 DSH 模型类型。

## 数据目录
~/.dsh/account-models/

其中 accounts.json 保存账号元数据，config.json 保存默认 Provider / Account；真正的网页登录状态由 Chromium Profile 持久化。

## Provider / Browser
模型选择器直接显示 DeepSeek、ChatGPT、Qwen、腾讯混元 AI Studio、豆包、Perplexity、Microsoft Copilot、HuggingChat、Kimi、智谱 AI。

首次真正发送某个 Provider 的模型请求时，插件自动创建该 Provider 的浏览器账号记录并启动可见 Chromium；后续请求复用该 Provider 的持久 Profile。

右侧 Sidebar 的原生 Browser 用于用户可见的登录、网页浏览和调试，并支持多 Tab。

## HTTP Routes
GET  /api/dsh-account-models/accounts
GET  /api/dsh-account-models/browser/view?accountId=...
GET  /api/dsh-account-models/config
POST /api/dsh-account-models/config
POST /api/dsh-account-models/accounts/add
POST /api/dsh-account-models/accounts/open
POST /api/dsh-account-models/accounts/check
POST /api/dsh-account-models/accounts/close
POST /api/dsh-account-models/accounts/remove

## 构建
要求 Node.js >= 22、pnpm 或 npm，以及 Chrome/Chromium。

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

当前版本：dsh-account-models-0.2.1.tgz

建议每次生成新的 tgz 后再安装，避免 DSH 插件管理器继续使用旧缓存包。

## DSH Desktop 安装
完全退出 DSH Desktop 后执行：
dsh.cmd plugin --profile desktop add .\packed\dsh-account-models-0.2.1.tgz

如之前安装过旧版本：
dsh.cmd plugin --profile desktop remove dsh-account-models

安装完成后重新启动 DSH Desktop。

## 验收路径
1. DSH 启动日志不再出现 dsh-account-models: import failed。
2. Settings 出现 Web AI。
3. 添加 Provider 账号并打开可见浏览器。
4. 手工完成网页登录并检查登录状态。
5. 保存默认 Provider / Account。
6. DSH 模型选择器出现一个统一的 Web AI（浏览器）。
7. 普通 DSH 对话能够通过网页模型完成请求，Web AI 长 Thinking 不再因默认 60 秒无首字超时提前失败。
8. 同一 DSH Session 保持对应网页 Conversation。
9. 当 DSH 提供 tools 时，Web AI 可以通过工具调用协议请求本地 Agent Tool，由 DSH 执行后继续下一轮模型推理。
10. Stop 能停止网页生成。
11. 手工切换网页 Conversation 后应返回 PAGE_CHANGED。
12. Right Sidebar 的 Web AI 浏览器能够显示真实 Chromium 页面。

## 当前边界
Right Sidebar 当前采用 CDP 截图 Live View，而不是直接把插件自有 Chromium 页面嵌入 DSH Electron WebView。

DSH 官方 ui-sidebar-browser 用于 Sidebar 中的 sandboxed HTTP(S) 页面；插件自己的持久 Chromium 会话目前没有公开的 CDP 页面嵌入 seam。因此当前实现优先保证真实浏览器登录态、独立 Profile、多 Provider、LLM 调用链路、DOM/CDP 交互和 Sidebar 观察能力。

后续如果 DSH 暴露稳定的 BrowserView/CDP attach 能力，再升级为原生交互 BrowserView。

## 安全边界
本插件不保存密码、不提取 Cookie/Token、不调用目标站点私有 API、不重放浏览器 HTTP 请求、不绕过 CAPTCHA 或二次验证。

当前版本：0.2.1
目标：DSH 0.2.0-rc.2
