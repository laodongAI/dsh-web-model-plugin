# dsh-account-models

面向 **DSH 0.2.0-rc.2** 的浏览器账号模型插件。

## 当前实现

- DeepSeek / ChatGPT 账号记录
- 每个账号独立 Chromium Profile
- 可见 Chrome/Chromium 登录窗口
- 登录状态由浏览器 Profile 持久化
- DSH WebServer 管理接口
- 不保存密码、Cookie、Token
- 不调用 DeepSeek/ChatGPT 私有 HTTP API

## 数据目录

`~/.dsh/account-models/`

```
accounts.json
deepseek/<account-id>/profile/
chatgpt/<account-id>/profile/
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
POST /api/dsh-account-models/accounts/:id/close
DELETE /api/dsh-account-models/accounts/:id/account
```

## 安装

当前仓库正在开发阶段。完成打包后目标安装方式：

```
dsh plugin --profile web add ./dsh-account-models-0.1.0.tgz
```

## 浏览器原则

账号登录完全通过用户可见的 Chromium 页面完成。出现 CAPTCHA、二次验证或其他人工验证时，插件不会尝试绕过，而是等待用户完成验证。

后续阶段：

1. 页面登录状态检测
2. DeepSeek Browser Provider
3. ChatGPT Browser Provider
4. LlmAdapter / Model Catalog 注册
5. 原生 DSH 模型选择器
6. 会话级浏览器页面映射、流式响应和错误诊断
