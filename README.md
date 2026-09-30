# dsh-account-models

面向 **DSH 0.2.0-rc.2** 的浏览器账号模型插件。

## 当前实现

- DeepSeek / ChatGPT / Qwen 账号记录
- 每个账号独立 Chromium Profile
- 可见 Chrome/Chromium 登录窗口
- 登录状态由浏览器 Profile 持久化
- DSH WebServer 管理接口
- 不保存密码、Cookie、Token
- 不调用 DeepSeek/ChatGPT/Qwen 私有 HTTP API

## 数据目录

`~/.dsh/account-models/`

```
accounts.json
deepseek/<account-id>/profile/
chatgpt/<account-id>/profile/\nqwen/<account-id>/profile/
```

## Chrome

插件自动查找常见 Chrome/Chromium 路径；也可以设置：

```
DSH_CHROME_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe
```

## HTTP 接口

```
GET  /api/dsh-account-models/accounts
POST /api/dsh-account-models/accounts/add
POST /api/dsh-account-models/accounts/:id/open
POST /api/dsh-account-models/accounts/:id/check\nPOST /api/dsh-account-models/accounts/:id/close
DELETE /api/dsh-account-models/accounts/:id/account
```

## 安装与部署（DSH 0.2.0-rc.2 Desktop）

### 1. 构建环境

- DSH 目标版本：0.2.0-rc.2
- Node.js >= 22
- npm
- 本机 Chrome/Chromium

Chrome 可执行文件也可以通过环境变量指定：

    DSH_CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe

### 2. 从源码构建

    git clone https://github.com/laodongAI/dsh-web-model-plugin.git
    cd dsh-web-model-plugin
    npm install
    npm run typecheck
    npm run build

构建产物位于 lib/。

### 3. 打包插件

Linux/macOS：

    rm -rf lib *.tgz
    npm install
    npm run typecheck
    npm run build
    npm pack

Windows PowerShell：

    Remove-Item -Recurse -Force lib -ErrorAction SilentlyContinue
    Remove-Item *.tgz -ErrorAction SilentlyContinue
    npm install
    npm run typecheck
    npm run build
    npm pack

最终得到：

    dsh-account-models-0.1.0.tgz

建议先执行 npm pack --dry-run，确认包内没有 src、浏览器 Profile 或账号数据。

### 4. 安装到 DSH 0.2.0-rc.2 Desktop

这里不是安装 Electron Desktop 本体，而是把插件安装到 Desktop 的 desktop profile。

第一次安装前：

1. 启动一次 DSH Desktop，让 desktop profile 完成初始化。
2. 完全退出 DSH Desktop。
3. 使用 Desktop 随附的 dsh CLI 安装插件。
4. 安装完成后重新打开 DSH Desktop。

Windows：

    dsh.cmd plugin --profile desktop add .\dsh-account-models-0.1.0.tgz

macOS/Linux：

    dsh plugin --profile desktop add ./dsh-account-models-0.1.0.tgz

检查：

    dsh plugin --profile desktop list

卸载：

    dsh plugin --profile desktop remove dsh-account-models

重要：Desktop 插件包管理由 Desktop shell 负责。执行安装、升级、删除之前，应先完全退出 Desktop；操作完成后重新启动 Desktop。

### 5. 开发调试安装

开发期间可以直接安装当前目录：

    dsh plugin --profile desktop add .

正式验收建议使用 npm pack 产生的 tgz，因为这样才能验证真实发布包内容。

### 6. 安装后验收

重新打开 Desktop 后：

1. 确认 dsh-account-models 已加载。
2. 添加 DeepSeek、ChatGPT 或 Qwen 账号。
3. 检查可见 Chromium 是否启动。
4. 手工完成网页登录。
5. 检查账号状态变为 ready。
6. 在 DSH 原生模型选择器确认对应 Web 模型账号出现。
7. 发起普通 DSH 对话。
8. 验证网页回答可以增量流式返回。
9. 验证多轮 DSH Session 映射到同一个 Web Conversation。
10. 点击 Stop，确认浏览器生成停止。
11. 手工切换网页 Conversation，确认 DSH 返回 PAGE_CHANGED，而不是串到其他会话。
12. 登出网页账号，确认得到登录错误。
13. 验证额度、限流和页面结构变化错误。

## 数据目录

    ~/.dsh/account-models/
    ├── accounts.json
    ├── deepseek/<account-id>/profile/
    └── chatgpt/<account-id>/profile/

浏览器 Profile 由 Chromium 保存登录会话。插件元数据不保存密码、Cookie、Access Token 或 Refresh Token。

## Chrome / Chromium

插件自动查找常见 Chrome/Chromium 路径；也可以设置：

    DSH_CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe

## HTTP 接口

    GET    /api/dsh-account-models/accounts
    POST   /api/dsh-account-models/accounts/add
    POST   /api/dsh-account-models/accounts/:id/open
    POST   /api/dsh-account-models/accounts/:id/check
    POST   /api/dsh-account-models/accounts/:id/close
    DELETE /api/dsh-account-models/accounts/:id/account

## 浏览器原则

账号登录完全通过用户可见的 Chromium 页面完成。出现 CAPTCHA、二次验证或其他人工验证时，插件不会尝试绕过，而是等待用户完成验证。

插件不调用 DeepSeek / ChatGPT / Qwen 私有 HTTP API；模型交互通过用户可见浏览器页面的 DOM/CDP 完成。

## CI 构建

仓库包含 .github/workflows/build.yml。

CI 使用 Node 22 执行：

    npm install
    npm run typecheck
    npm run build

## 当前状态

本项目针对 DSH 0.2.0-rc.2 开发。rc.2 的 LlmAdapter、GenerateOptions、LlmError、StreamChunk 和 WebServer 注册方式已经完成源码契约核对。

当前开发环境无法可靠访问 npm registry，因此没有把本地未实际执行的 npm install / npm run build 结果宣称为通过；GitHub Actions 会继续承担构建验证。

## License

MIT


## 当前 Web Provider

除 DeepSeek、ChatGPT、Qwen 外，当前插件已扩展以下浏览器账号模型：

- 腾讯混元 AI Studio：`tencent-yuanbao-web`（入口为用户指定的 `aistudio.tencent.com`）
- 豆包：`doubao-web`
- Perplexity：`perplexity-web`
- Microsoft Copilot：`copilot-web`
- HuggingChat：`huggingchat-web`
- Kimi：`kimi-web`

以上均遵循浏览器会话模式：用户在持久化 Chromium Profile 中自行登录，插件通过 CDP/DOM 操作可见网页，不调用这些产品的私有 HTTP API。当前统一支持 DSH 文本消息和附件上传桥；每个平台的 DOM 选择器仍需要在实际登录页面逐一验收。
