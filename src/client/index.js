const PROVIDERS = [
  ['deepseek', 'DeepSeek', 'https://chat.deepseek.com/'],
  ['chatgpt', 'ChatGPT', 'https://chatgpt.com/'],
  ['qwen', 'Qwen', 'https://chat.qwen.ai/'],
  ['tencent-yuanbao', '腾讯元宝', 'https://yuanbao.tencent.com/'],
  ['doubao', '豆包', 'https://www.doubao.com/chat/'],
  ['perplexity', 'Perplexity', 'https://www.perplexity.ai/'],
  ['copilot', 'Microsoft Copilot', 'https://copilot.com/chat/'],
  ['huggingchat', 'HuggingChat', 'https://huggingface.co/chat/'],
  ['kimi', 'Kimi', 'https://kimi.com/'],
  ['chatglm', '智谱 AI', 'https://chatglm.cn/'],
]

const BRIDGE_WAIT_MS = 12000
const BRIDGE_POLL_ACTIVE_MS = 120
const BRIDGE_POLL_IDLE_MS = 500
const BRIDGE_IDLE_BACKOFF = 4

const LOG_LEVELS = {debug: 10, info: 20, warn: 30, error: 40}
const logLevel = LOG_LEVELS[(() => { try { return window.__DSH_ACCOUNT_MODELS_LOG_LEVEL__ } catch { return } })()] ?? LOG_LEVELS.info

function log(level, message, ...extra) {
  if (LOG_LEVELS[level] < logLevel) return
  ;(level === 'debug' ? console.debug : level === 'warn' ? console.warn : level === 'error' ? console.error : console.info)('[dsh-account-models]', message, ...extra)
}

let bridgeTimer
let bridgeIdleTicks = 0
let bridgeStopped = false
let modelDirectories
let currentProviderBySession = new Map()
let reconcilePromiseBySession = new Map()
let openingProviderBySession = new Map()
let unsubscribeSelection = () => {}
let unsubscribeMounted = () => {}
let unsubscribeAgentStatus = () => {}
let unsubscribeAssistantStream = () => {}

const inject = ['modelDirectories', 'sidebarRight']

async function processBridgeRequest(ctx) {
  try {
    const sessionId = getSessionId(ctx)
    const visible = visibleProviders(ctx, sessionId)
    const params = new URLSearchParams({visible: visible.join(',')})
    if (sessionId) params.set('sessionId', sessionId)
    const url = '/api/dsh-account-models/browser/bridge/next?' + params
    const response = await fetch(url, {cache: 'no-store'})
    if (!response.ok) { bridgeIdleTicks++; return }
    const request = await response.json()
    if (!request.id || !request.provider || !request.expression) { bridgeIdleTicks++; return }
    bridgeIdleTicks = 0

    const frame = await waitForProviderFrame(ctx, request.provider, request.sessionId, BRIDGE_WAIT_MS)
    if (!frame) {
      await bridgeResult(request.id, false, undefined, 'BROWSER_NOT_READY: DSH 右侧 Browser 尚未建立当前 Provider 页面')
      return
    }
    try {
      const wrapped = `(async()=>{try{
        const value=await (${request.expression})
        return {__dshBridgeOk:true,value}
      }catch(error){
        return {__dshBridgeOk:false,error:{
          name:error?.name||'Error',
          message:error?.message||String(error),
          stack:error?.stack||''
        }}
      }})()`
      let result
      let lastError
      const executeDeadline = Date.now() + 10000
      while (Date.now() < executeDeadline) {
        try {
          if (typeof frame.isLoading === 'function' && frame.isLoading()) {
            await new Promise(resolve => setTimeout(resolve, 300))
            continue
          }
          result = await frame.executeJavaScript(wrapped, true)
          lastError = undefined
          break
        } catch (error) {
          lastError = error
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }
      if (lastError) throw lastError
      if (result == null) throw new Error('GUEST_VIEW_ERROR: 页面脚本没有返回结果（页面可能正在导航），请重试')
      if (result?.__dshBridgeOk === false) {
        const detail = result.error || {}
        const message = [detail.name || 'Error', detail.message || '页面脚本执行失败', detail.stack || ''].filter(Boolean).join(': ')
        await bridgeResult(request.id, false, undefined, `PAGE_SCRIPT_ERROR: ${message}`)
      } else {
        await bridgeResult(request.id, true, result?.value)
      }
    } catch (error) {
      await bridgeResult(request.id, false, undefined, `GUEST_VIEW_ERROR: ${String(error?.message || error)}`)
    }
  } catch (error) {
    bridgeIdleTicks++
    log('warn', 'browser bridge poll failed:', error)
  }
}

function scheduleBridge(ctx) {
  if (bridgeStopped) return
  const delay = bridgeIdleTicks >= BRIDGE_IDLE_BACKOFF ? BRIDGE_POLL_IDLE_MS : BRIDGE_POLL_ACTIVE_MS
  bridgeTimer = setTimeout(async () => {
    await processBridgeRequest(ctx)
    if (!bridgeStopped) scheduleBridge(ctx)
  }, delay)
}

async function waitForProviderFrame(ctx, provider, sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (bridgeStopped) return undefined
    const visibleFrames = visibleProviderFrames(ctx, sessionId, provider)
    if (visibleFrames.length === 1) return visibleFrames[0]
    if (visibleFrames.length > 1) {
      log('error', 'ambiguous provider webviews; refusing to execute bridge request', provider, sessionId)
      return undefined
    }
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  return undefined
}

function visibleProviderFrames(ctx, sessionId, provider) {
  const activeSessionId = getSessionId(ctx)
  if (!activeSessionId || (sessionId && sessionId !== activeSessionId)) return []
  const tabs = browserTabs(ctx, activeSessionId)
  const activeTab = ctx.sidebarRight.active?.()
  if (!activeTab || !tabs.some(tab => tab.tabId === activeTab.id)) return []
  return [...document.querySelectorAll('webview')].filter(frame => {
    try {
      return typeof frame.getURL === 'function'
        && providerHost(provider.id, frame.getURL() || '')
        && (frame.offsetParent !== null || frame.clientWidth > 0)
    } catch { return false }
  })
}

async function bridgeResult(id, ok, value, error) {
  try {
    const response = await fetch('/api/dsh-account-models/browser/bridge/result', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({id, ok, value, error}),
    })
    if (!response.ok) throw new Error('HTTP ' + response.status)
  } catch (resultError) {
    log('error', 'failed to report browser bridge result:', id, resultError)
  }
}

const PROVIDER_HOSTS = {
  deepseek: ['chat.deepseek.com', 'deepseek.com'],
  chatgpt: ['chatgpt.com', 'chat.openai.com'],
  qwen: ['chat.qwen.ai', 'qwen.ai'],
  'tencent-yuanbao': ['yuanbao.tencent.com'],
  doubao: ['doubao.com', 'www.doubao.com'],
  perplexity: ['perplexity.ai', 'www.perplexity.ai'],
  copilot: ['copilot.com', 'copilot.microsoft.com'],
  huggingchat: ['huggingface.co'],
  kimi: ['kimi.com', 'www.kimi.com', 'kimi.moonshot.cn'],
  chatglm: ['chatglm.cn', 'www.chatglm.cn'],
}

function providerHost(provider, url) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return (PROVIDER_HOSTS[provider] || []).some(domain => host === domain || host.endsWith('.' + domain)) ?? false
  } catch { return false }
}

function visibleProviders(ctx, sessionId) {
  if (!sessionId || getSessionId(ctx) !== sessionId) return []
  const activeTab = ctx.sidebarRight.active?.()
  if (!activeTab || !browserTabs(ctx, sessionId).some(tab => tab.tabId === activeTab.id)) return []
  return PROVIDERS.filter(([id]) => visibleProviderFrames(ctx, sessionId, {id}).length > 0).map(([id]) => id)
}

function selectedProvider(selection) {
  if (!selection || selection.provider !== 'web-ai') return undefined
  const item = PROVIDERS.find(([id]) => id === selection.model)
  if (!item) return undefined
  return {id: item[0], name: item[1], url: item[2]}
}

function getSessionId(ctx) {
  try { return ctx.sidebarRight.mounted.getSnapshot() } catch { return undefined }
}

function currentSelection(ctx) {
  const sessionId = getSessionId(ctx)
  if (!sessionId || !modelDirectories) return {sessionId, provider: undefined}
  try {
    const directory = modelDirectories.directoryFor(sessionId)
    return {sessionId, provider: selectedProvider(directory.store.getSnapshot().current)}
  } catch (error) {
    console.warn('[dsh-account-models] current model selection unavailable:', error)
    return {sessionId, provider: undefined}
  }
}

function browserTabs(ctx, sessionId) {
  return (ctx.sidebarRight.openTabs?.getSnapshot?.() ?? [])
    .filter(tab => tab.sessionId === sessionId && tab.kind === 'browser')
}

function browserFrames() {
  return [...document.querySelectorAll('webview, iframe')]
}

function currentBrowserUrls() {
  return browserFrames().map(frame => {
    try {
      if (typeof frame.getURL === 'function') return frame.getURL() || ''
      if (frame instanceof HTMLIFrameElement) return frame.src || ''
    } catch {}
    return ''
  }).filter(Boolean)
}

function hasMatchingProviderTab(ctx, sessionId, provider) {
  const tabs = browserTabs(ctx, sessionId)
  const urls = currentBrowserUrls()
  const urlMatching = visibleProviderFrames(ctx, sessionId, provider).length === 1
  const pendingSameProvider = openingProviderBySession.get(sessionId) === provider.id && tabs.length > 0
  const matching = tabs.length > 0 && (urlMatching || pendingSameProvider)
  return {tabs, urls, matching, urlMatching, pendingSameProvider}
}

function safeClose(ctx, tabId) {
  try {
    if (tabId == null) return
    if (typeof ctx.sidebarRight.close === 'function') ctx.sidebarRight.close(tabId)
  } catch (error) {
    console.warn('[dsh-account-models] browser tab close failed:', tabId, error)
  }
}

function closeProviderTabs(ctx, sessionId, provider) {
  openingProviderBySession.delete(sessionId)
  const activeTab = ctx.sidebarRight.active?.()
  const providerFrameVisible = provider && visibleProviderFrames(ctx, sessionId, provider).length === 1
  for (const tab of browserTabs(ctx, sessionId)) {
    const tabUrl = tab.url || tab.params?.url || ''
    if (provider && tabUrl && !providerHost(provider.id, tabUrl)) continue
    if (provider && !tabUrl) {
      // Tab inventory intentionally omits navigation params. Only close an
      // unidentifiable tab when it is the active tab and its visible page matches.
      if (tab.tabId !== activeTab?.id || !providerFrameVisible) continue
    }
    safeClose(ctx, tab.tabId)
  }
}

async function openProviderBrowser(ctx, provider, sessionId) {
  try {
    openingProviderBySession.set(sessionId, provider.id)
    ctx.sidebarRight.openTab('browser', {params: {url: provider.url}})
    log('info', 'browser action: open provider page', provider.id, provider.url)
    const appeared = await waitForProviderTab(ctx, sessionId, provider, 3000)
    if (appeared) return true
    log('warn', 'browser tab did not appear, retrying open', provider.id)
    ctx.sidebarRight.openTab('browser', {params: {url: provider.url}})
    const retried = await waitForProviderTab(ctx, sessionId, provider, 3000)
    if (!retried) {
      log('error', 'browser tab still missing after retry', provider.id, provider.url)
      openingProviderBySession.delete(sessionId)
    }
    return retried
  } catch (error) {
    openingProviderBySession.delete(sessionId)
    log('error', 'browser action failed', provider.id, error)
    return false
  }
}

function waitForProviderTab(ctx, sessionId, provider, timeoutMs) {
  return new Promise(resolve => {
    let settled = false
    const ready = () => visibleProviderFrames(ctx, sessionId, provider).length === 1
    const finish = () => {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearTimeout(timeout)
      resolve(ready())
    }
    const poll = setInterval(() => {
      if (ready()) finish()
    }, 200)
    const timeout = setTimeout(finish, timeoutMs)
    if (ready()) finish()
  })
}
async function reconcileBrowser(ctx, reason = 'observe') {
  const {sessionId, provider} = currentSelection(ctx)
  if (!sessionId || !provider) return {opened: false, matching: false, provider}

  const sidebarMounted = Boolean(getSessionId(ctx))
  if (!sidebarMounted) return {opened: false, matching: false, provider}

  const state = hasMatchingProviderTab(ctx, sessionId, provider)
  log('debug', 'browser state:', JSON.stringify({
    reason, sessionId, provider: provider.id, tabCount: state.tabs.length, matching: state.matching, urls: state.urls,
  }))

  if (state.matching) {
    if (state.urlMatching) openingProviderBySession.delete(sessionId)
    return {opened: false, matching: true, provider}
  }

  if (state.tabs.length) closeProviderTabs(ctx, sessionId, provider)
  const opened = await openProviderBrowser(ctx, provider, sessionId)
  if (!opened) openingProviderBySession.delete(sessionId)
  return {opened, matching: false, provider}
}

function triggerReconcile(ctx, reason) {
  const sessionId = getSessionId(ctx)
  if (!sessionId) return Promise.resolve()
  const running = reconcilePromiseBySession.get(sessionId)
  if (running) return running
  const task = Promise.resolve().then(() => reconcileBrowser(ctx, reason)).catch(error => {
    log('warn', 'browser reconcile failed:', reason, error)
    return undefined
  }).finally(() => reconcilePromiseBySession.delete(sessionId))
  reconcilePromiseBySession.set(sessionId, task)
  return task
}

function bindSelection(ctx) {
  unsubscribeSelection()
  unsubscribeSelection = () => {}
  const sessionId = getSessionId(ctx)
  if (!modelDirectories || !sessionId) return
  try {
    const directory = modelDirectories.directoryFor(sessionId)
    const update = () => {
      const next = selectedProvider(directory.store.getSnapshot().current)
      const previous = currentProviderBySession.get(sessionId)
      currentProviderBySession.set(sessionId, next?.id)

      if (!next) {
        if (previous) {
          console.info('[dsh-account-models] switched away from Web AI; closing previous Browser tabs', previous)
          const provider = PROVIDERS.find(([id]) => id === previous)
          closeProviderTabs(ctx, sessionId, provider ? {id: provider[0], name: provider[1], url: provider[2]} : undefined)
        }
        return
      }

      if (previous && previous !== next.id) {
        console.info('[dsh-account-models] Web AI model switched:', previous, '=>', next.id)
        const prevProvider = PROVIDERS.find(([id]) => id === previous)
        closeProviderTabs(ctx, sessionId, prevProvider ? {id: prevProvider[0], name: prevProvider[1], url: prevProvider[2]} : undefined)
      }

      triggerReconcile(ctx, previous ? 'model-switch' : 'model-selection')
    }
    unsubscribeSelection = directory.store.subscribe(update)
    update()
  } catch (error) {
    console.warn('[dsh-account-models] model selection sync unavailable:', error)
  }
}

function apply(ctx) {
  log('info', 'client active: Web AI Browser lifecycle controller')
  modelDirectories = ctx.modelDirectories

  if (!modelDirectories || !ctx.sidebarRight) {
    log('error', 'required client services unavailable:', {
      modelDirectories: Boolean(modelDirectories),
      sidebarRight: Boolean(ctx.sidebarRight),
    })
    return
  }

  bindSelection(ctx)

  unsubscribeMounted = ctx.sidebarRight.mounted.subscribe(() => {
    const sessionId = getSessionId(ctx)
    if (sessionId) {
      currentProviderBySession.delete(sessionId)
      bindSelection(ctx)
      triggerReconcile(ctx, 'session-mounted')
    }
  })

  unsubscribeAgentStatus = ctx.on('agent/status', ({agent, status}) => {
    if (status !== 'running') return
    const sessionId = getSessionId(ctx)
    if (agent?.id !== sessionId) return
    triggerReconcile(ctx, 'chat-start')
  })

  unsubscribeAssistantStream = ctx.on('agent/assistant-stream', ({agent, frame}) => {
    if (frame?.type !== 'start') return
    const sessionId = getSessionId(ctx)
    if (agent?.id !== sessionId) return
    triggerReconcile(ctx, 'assistant-stream-start')
  })

  bridgeStopped = false
  scheduleBridge(ctx)

  ctx.effect(() => () => {
    unsubscribeSelection()
    unsubscribeMounted()
    unsubscribeAgentStatus()
    unsubscribeAssistantStream()
    bridgeStopped = true
    clearTimeout(bridgeTimer)
    currentProviderBySession.clear()
    reconcilePromiseBySession.clear()
    openingProviderBySession.clear()
    modelDirectories = undefined
  }, 'dsh-account-models: browser lifecycle controller')
}

apply.lastKey = ''
module.exports = {apply, inject}