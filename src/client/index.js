const PROVIDERS=[
 ['deepseek','DeepSeek','https://chat.deepseek.com/'],['chatgpt','ChatGPT','https://chatgpt.com/'],['qwen','Qwen','https://chat.qwen.ai/'],
 ['tencent-yuanbao','腾讯混元 AI Studio','https://aistudio.tencent.com/'],['doubao','豆包','https://www.doubao.com/chat/'],['perplexity','Perplexity','https://www.perplexity.ai/'],
 ['copilot','Microsoft Copilot','https://copilot.microsoft.com/'],['huggingchat','HuggingChat','https://huggingface.co/chat/'],['kimi','Kimi','https://kimi.moonshot.cn/'],['chatglm','智谱 AI','https://chatglm.cn/'],
]

const RECONCILE_MS=500
const BRIDGE_WAIT_MS=12000
let bridgeTimer
let reconcileTimer
let reconcileBusy=false
let desiredSelection
let modelDirectories
let unsubscribeSelection=()=>{}
let unsubscribeMounted=()=>{}
let unsubscribeAgentStatus=()=>{}
let unsubscribeAssistantStream=()=>{}
let lastOpenKey=''
let lastOpenAt=0

// Cordis Client 服务依赖：apply() 内所有 sidebar/modelDirectory 访问都必须声明注入。
// 否则 ctx.sidebarRight / modelDirectories 在运行时不可读，状态协调器会静默失效。
const inject=['modelDirectories','sidebarRight']

async function processBridgeRequest(){
 try{
  const response=await fetch('/api/dsh-account-models/browser/bridge/next',{cache:'no-store'})
  if(!response.ok)return
  const request=await response.json()
  if(!request.id||!request.provider||!request.expression)return
  const frame=await waitForProviderFrame(request.provider,BRIDGE_WAIT_MS)
  if(!frame){
   await bridgeResult(request.id,false,undefined,'BROWSER_NOT_READY: DSH 右侧 Browser 尚未建立当前 Provider 页面')
   return
  }
  try{
   const value=await frame.executeJavaScript(request.expression,true)
   await bridgeResult(request.id,true,value)
  }catch(error){
   await bridgeResult(request.id,false,undefined,String(error?.message||error))
  }
 }catch{}
}

async function waitForProviderFrame(provider,timeoutMs){
 const deadline=Date.now()+timeoutMs
 while(Date.now()<deadline){
  const frames=[...document.querySelectorAll('webview')].filter(frame=>{\n   try{return typeof frame.getURL==='function'}catch{return false}\n  })
  const candidates=frames.filter(frame=>{
   try{
    const url=frame.getURL?.()||''
    return typeof url==='string' && providerHost(provider,url)
   }catch{return false}
  })
  const frame=candidates.at(-1)
  if(frame)return frame
  await new Promise(resolve=>setTimeout(resolve,150))
 }
 return undefined
}

async function bridgeResult(id,ok,value,error){
 try{
  await fetch('/api/dsh-account-models/browser/bridge/result',{
   method:'POST',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({id,ok,value,error})
  })
 }catch{}
}

function providerHost(provider,url){
 try{
  const host=new URL(url).hostname.toLowerCase()
  return ({
   deepseek:['chat.deepseek.com'],
   chatgpt:['chatgpt.com','chat.openai.com'],
   qwen:['chat.qwen.ai','qwen.ai'],
   'tencent-yuanbao':['aistudio.tencent.com','yuanbao.tencent.com'],
   doubao:['doubao.com'],
   perplexity:['perplexity.ai'],
   copilot:['copilot.microsoft.com'],
   huggingchat:['huggingface.co'],
   kimi:['kimi.moonshot.cn'],
   chatglm:['chatglm.cn']
  })[provider]?.some(domain=>host===domain||host.endsWith('.'+domain))??false
 }catch{return false}
}

function selectedProvider(selection){
 if(!selection||selection.provider!=='web-ai')return undefined
 const item=PROVIDERS.find(([id])=>id===selection.model)
 if(!item)return undefined
 return {id:item[0],name:item[1],url:item[2]}
}

function currentSelection(ctx){
 const sessionId=ctx.sidebarRight.mounted.getSnapshot()
 if(!sessionId||!modelDirectories)return {sessionId,provider:undefined}
 try{
  const directory=modelDirectories.directoryFor(sessionId)
  const selection=directory.store.getSnapshot().current
  const provider=selectedProvider(selection)
  desiredSelection=provider
  return {sessionId,provider}
 }catch(error){
  console.warn('[dsh-account-models] current model selection unavailable:',error)
  return {sessionId,provider:undefined}
 }
}

function rightSidebarState(ctx){
 const sessionId=ctx.sidebarRight.mounted.getSnapshot()
 if(!sessionId)return {mounted:false,expanded:false}
 try{
  return {mounted:true,expanded:typeof ctx.sidebarRight.isExpanded==='function' ? ctx.sidebarRight.isExpanded() : true}
 }catch(error){
  console.warn('[dsh-account-models] sidebar state unavailable:',error)
  return {mounted:true,expanded:false}
 }
}

function browserState(ctx,sessionId,provider){
 const openTabs=(ctx.sidebarRight.openTabs?.getSnapshot?.()??[]).filter(tab=>tab.sessionId===sessionId&&tab.kind==='browser')
 const frames=[...document.querySelectorAll('webview, iframe')].filter(frame=>{\n  try{\n   if(typeof frame.getURL==='function')return true\n   return frame instanceof HTMLIFrameElement\n  }catch{return false}\n })
 const urls=frames.map(frame=>{
  try{
   if(typeof frame.getURL==='function')return frame.getURL()||''
   if(frame instanceof HTMLIFrameElement)return frame.src||''
  }catch{}
  return ''
 })
 const knownUrls=urls.filter(Boolean)
 const matching=knownUrls.some(url=>providerHost(provider,url))
 const loading=openTabs.length>0&&knownUrls.length===0
 return {
  count:openTabs.length,
  matching,
  loading,
  urls,
  tabIds:openTabs.map(tab=>tab.tabId)
 }
}

function openProviderBrowser(ctx,provider){
 const key=provider.id+'|'+provider.url
 if(key===lastOpenKey&&Date.now()-lastOpenAt<2500)return false
 try{
  // Browser 是 multi-instance。使用 revealIfOpened:false，避免当前只是 guide/start
  // 页时被同一个 browser kind 的地址去重规则拦住；这也是 DSH 原生 Browser
  // 自己用于“新建 Browser tab”的正式方式。
  ctx.sidebarRight.openTab('browser',{params:{url:provider.url},revealIfOpened:false})
  lastOpenKey=key
  lastOpenAt=Date.now()
  console.info('[dsh-account-models] browser action: open',provider.id,provider.url)
  return true
 }catch(error){
  console.warn('[dsh-account-models] browser action failed:',error)
  return false
 }
}

async function reconcileBrowser(ctx,reason='poll'){
 if(reconcileBusy)return
 reconcileBusy=true
 try{
  const {sessionId,provider}=currentSelection(ctx)
  if(!sessionId||!provider)return

  const sidebar=rightSidebarState(ctx)
  const browser=browserState(ctx,sessionId,provider.id)
  console.info('[dsh-account-models] state:',JSON.stringify({
   reason,
   provider:provider.id,
   sidebar,
   browser
  }))

  // 状态 1：没有当前 Session 的右侧 Sidebar。
  // openTab 会在 Session 可用时直接作用于当前会话；这里先等待 mounted。
  if(!sidebar.mounted)return

  // 状态 2：Sidebar 未展开。
  // DSH 官方 openTab 会在打开 Browser 的同时展开右栏。
  if(!sidebar.expanded){
   openProviderBrowser(ctx,provider)
   return
  }

  // 状态 3：Sidebar 已展开，但没有 Browser tab。
  if(browser.count===0){
   openProviderBrowser(ctx,provider)
   return
  }

  // 状态 4：Browser Tab 已存在，但 WebView 尚未建立/尚未得到稳定 URL。
  // 这是 DSH Browser 的正常加载窗口，绝不能重复创建 Browser Tab。
  if(browser.loading){
   console.info('[dsh-account-models] browser action: wait for native Browser load',provider.id)
   return
  }

  // 状态 5：已有 Browser，但没有当前 Provider 页面。
  // 不抢占用户已有页面；创建一个新的原生 Browser 实例承载目标 Provider。
  if(!browser.matching){
   openProviderBrowser(ctx,provider)
   return
  }

  // 状态 5：目标 Provider 页面存在。
  // 不强制导航；每次 Chat 的 Host adapter 会再次做 health() 校验。
  console.info('[dsh-account-models] browser action: matching provider page found',provider.id)
 }finally{
  reconcileBusy=false
 }
}

function triggerReconcile(ctx,reason){
 reconcileBrowser(ctx,reason).catch(error=>console.warn('[dsh-account-models] reconcile failed:',error))
}

function bindSelection(ctx){
 unsubscribeSelection()
 unsubscribeSelection=()=>{}
 if(!modelDirectories)return
 try{
  const sessionId=ctx.sidebarRight.mounted.getSnapshot()
  if(!sessionId)return
  const directory=modelDirectories.directoryFor(sessionId)
  const update=()=>{
   const selection=directory.store.getSnapshot().current
   const next=selectedProvider(selection)
   desiredSelection=next
   if(!next)return
   console.info('[dsh-account-models] selected Web AI provider:',next.id,next.url)
   triggerReconcile(ctx,'model-selection')
  }
  unsubscribeSelection=directory.store.subscribe(update)
  update()
 }catch(error){
  console.warn('[dsh-account-models] model selection sync unavailable:',error)
 }
}

function apply(ctx){
 console.info('[dsh-account-models] client active: native model selector + browser state reconciler')

 ctx.inject(['modelDirectories'],scope=>{
  modelDirectories=scope.modelDirectories
  bindSelection(ctx)

  unsubscribeMounted=ctx.sidebarRight.mounted.subscribe(()=>{
   bindSelection(ctx)
   triggerReconcile(ctx,'session-mounted')
  })

  // 每次真正进入 Chat 运行态都重新校验一次浏览器状态。
  // 这是“每次 Chat 必校验”的第一道客户端闸门，不依赖用户是否刚切换过模型。
  unsubscribeAgentStatus=ctx.on('agent/status',({agent,status})=>{
   if(status!=='running')return
   const sessionId=ctx.sidebarRight.mounted.getSnapshot()
   if(agent?.id!==sessionId)return
   triggerReconcile(ctx,'chat-start')
  })

  // assistant-stream start 与 status:running 都可能先后到达；两处都触发是幂等的。
  unsubscribeAssistantStream=ctx.on('agent/assistant-stream',({agent,frame})=>{
   if(frame?.type!=='start')return
   const sessionId=ctx.sidebarRight.mounted.getSnapshot()
   if(agent?.id!==sessionId)return
   triggerReconcile(ctx,'assistant-stream-start')
  })
 })

 reconcileTimer=setInterval(()=>{
  if(desiredSelection)triggerReconcile(ctx,'poll')
 },RECONCILE_MS)

 bridgeTimer=setInterval(processBridgeRequest,120)

 ctx.effect(()=>()=>{
  unsubscribeSelection()
  unsubscribeMounted()
  unsubscribeAgentStatus()
  unsubscribeAssistantStream()
  clearInterval(reconcileTimer)
  clearInterval(bridgeTimer)
  desiredSelection=undefined
  modelDirectories=undefined
 },'dsh-account-models: browser state reconciler')
}

apply.lastKey=''
module.exports={apply,inject}
