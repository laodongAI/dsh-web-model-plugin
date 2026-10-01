const PROVIDERS=[
 ['deepseek','DeepSeek','https://chat.deepseek.com/'],['chatgpt','ChatGPT','https://chatgpt.com/'],['qwen','Qwen','https://chat.qwen.ai/'],
 ['tencent-yuanbao','腾讯混元 AI Studio','https://aistudio.tencent.com/'],['doubao','豆包','https://www.doubao.com/chat/'],['perplexity','Perplexity','https://www.perplexity.ai/'],
 ['copilot','Microsoft Copilot','https://copilot.microsoft.com/'],['huggingchat','HuggingChat','https://huggingface.co/chat/'],['kimi','Kimi','https://kimi.moonshot.cn/'],['chatglm','智谱 AI','https://chatglm.cn/'],
]

const BRIDGE_WAIT_MS=12000
let bridgeTimer
let modelDirectories
let currentProviderBySession=new Map()
let reconcilePromiseBySession=new Map()
let openingProviderBySession=new Map()
let unsubscribeSelection=()=>{}
let unsubscribeMounted=()=>{}
let unsubscribeAgentStatus=()=>{}
let unsubscribeAssistantStream=()=>{}

const inject=['modelDirectories','sidebarRight']

async function processBridgeRequest(){
 try{
  const response=await fetch('/api/dsh-account-models/browser/bridge/next',{cache:'no-store'})
  if(!response.ok)return
  const request=await response.json()
  if(!request.id||!request.provider||!request.expression)return
  const initial=await waitForProviderFrame(request.provider,BRIDGE_WAIT_MS)
  if(!initial){
   await bridgeResult(request.id,false,undefined,'BROWSER_NOT_READY: DSH 右侧 Browser 尚未建立当前 Provider 页面')
   return
  }
  try{
   // GuestView 导航期间，之前拿到的 <webview> DOM 对象可能已经失效。
   // 每次重试都重新查找当前 Provider GuestView，避免对旧 renderer 执行脚本。
   const wrapped=`(async()=>{try{
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
   let lastState=''
   for(let attempt=0;attempt<16;attempt++){
    const frame=await findProviderFrame(request.provider)
    if(!frame){
     lastState='BROWSER_NOT_READY: 当前 Provider GuestView 已不存在'
     await new Promise(resolve=>setTimeout(resolve,350))
     continue
    }
    try{
     const url=typeof frame.getURL==='function'?(frame.getURL()||''):''
     const loading=typeof frame.isLoading==='function'&&frame.isLoading()
     lastState=url
     if(loading){
      await new Promise(resolve=>setTimeout(resolve,350))
      continue
     }
     result=await frame.executeJavaScript(wrapped,true)
     lastError=undefined
     break
    }catch(error){
     lastError=error
     await new Promise(resolve=>setTimeout(resolve,350))
    }
   }
   if(lastError)throw new Error('GuestView executeJavaScript failed after retry: '+String(lastError?.message||lastError)+(lastState?' (url: '+lastState+')':''))
   if(result?.__dshBridgeOk===false){
    const detail=result.error||{}
    const message=[detail.name||'Error',detail.message||'页面脚本执行失败',detail.stack||''].filter(Boolean).join(': ')
    await bridgeResult(request.id,false,undefined,`PAGE_SCRIPT_ERROR: ${message}`)
   }else{
    await bridgeResult(request.id,true,result?.value)
   }
  }catch(error){
   await bridgeResult(request.id,false,undefined,`GUEST_VIEW_ERROR: ${String(error?.message||error)}`)
  }
 }catch{}
}

async function findProviderFrame(provider){
 const frames=[...document.querySelectorAll('webview')].filter(frame=>{
  try{return typeof frame.getURL==='function'}catch{return false}
 })
 const candidates=frames.filter(frame=>{
  try{return providerHost(provider,frame.getURL?.()||'')}catch{return false}
 })
 return candidates.at(-1)
}
async function waitForProviderFrame(provider,timeoutMs){
 const deadline=Date.now()+timeoutMs
 while(Date.now()<deadline){
  const frames=[...document.querySelectorAll('webview')].filter(frame=>{
   try{return typeof frame.getURL==='function'}catch{return false}
  })
  const candidates=frames.filter(frame=>{
   try{return providerHost(provider,frame.getURL?.()||'')}catch{return false}
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

function getSessionId(ctx){
 try{return ctx.sidebarRight.mounted.getSnapshot()}catch{return undefined}
}

function currentSelection(ctx){
 const sessionId=getSessionId(ctx)
 if(!sessionId||!modelDirectories)return {sessionId,provider:undefined}
 try{
  const directory=modelDirectories.directoryFor(sessionId)
  return {sessionId,provider:selectedProvider(directory.store.getSnapshot().current)}
 }catch(error){
  console.warn('[dsh-account-models] current model selection unavailable:',error)
  return {sessionId,provider:undefined}
 }
}

function browserTabs(ctx,sessionId){
 return (ctx.sidebarRight.openTabs?.getSnapshot?.()??[])
  .filter(tab=>tab.sessionId===sessionId&&tab.kind==='browser')
}

function browserFrames(){
 return [...document.querySelectorAll('webview, iframe')]
}

function currentBrowserUrls(){
 return browserFrames().map(frame=>{
  try{
   if(typeof frame.getURL==='function')return frame.getURL()||''
   if(frame instanceof HTMLIFrameElement)return frame.src||''
  }catch{}
  return ''
 }).filter(Boolean)
}

function hasMatchingProviderTab(ctx,sessionId,provider){
 const tabs=browserTabs(ctx,sessionId)
 const urls=currentBrowserUrls()
 const urlMatching=urls.some(url=>providerHost(provider.id,url))
 const pendingSameProvider=openingProviderBySession.get(sessionId)===provider.id && tabs.length>0 && urls.length===0
 const matching=tabs.length>0 && (urlMatching||pendingSameProvider)
 return {tabs,urls,matching,urlMatching,pendingSameProvider}
}

function safeClose(ctx,tabId){
 try{
  if(tabId==null)return
  if(typeof ctx.sidebarRight.close==='function')ctx.sidebarRight.close(tabId)
 }catch(error){
  console.warn('[dsh-account-models] browser tab close failed:',tabId,error)
 }
}

function closeProviderTabs(ctx,sessionId){
 openingProviderBySession.delete(sessionId)
 for(const tab of browserTabs(ctx,sessionId))safeClose(ctx,tab.tabId)
}

function openProviderBrowser(ctx,provider,sessionId){
 try{
  openingProviderBySession.set(sessionId,provider.id)
  ctx.sidebarRight.openTab('browser',{params:{url:provider.url}})
  console.info('[dsh-account-models] browser action: open provider page',provider.id,provider.url)
  return true
 }catch(error){
  console.warn('[dsh-account-models] browser action failed:',provider.id,error)
  return false
 }
}

async function reconcileBrowser(ctx,reason='observe'){
 const {sessionId,provider}=currentSelection(ctx)
 if(!sessionId||!provider)return {opened:false,matching:false,provider}

 const sidebarMounted=Boolean(getSessionId(ctx))
 if(!sidebarMounted)return {opened:false,matching:false,provider}

 const state=hasMatchingProviderTab(ctx,sessionId,provider)
 console.info('[dsh-account-models] browser state:',JSON.stringify({
  reason,sessionId,provider:provider.id,tabCount:state.tabs.length,matching:state.matching,urls:state.urls
 }))

 if(state.matching){
  if(state.urlMatching)openingProviderBySession.delete(sessionId)
  return {opened:false,matching:true,provider}
 }

 // 没有与当前 Web AI Provider 匹配的 Browser：
 // 1) 关闭当前会话残留的旧 Browser Tab；
 // 2) 重新打开当前 Provider 初始地址；
 // 3) 打开后不再自动导航/登录/切换模型，后续完全交给人工。
 if(state.tabs.length)closeProviderTabs(ctx,sessionId)
 const opened=openProviderBrowser(ctx,provider,sessionId)
 if(!opened)openingProviderBySession.delete(sessionId)
 return {opened,matching:false,provider}
}

function triggerReconcile(ctx,reason){
 const sessionId=getSessionId(ctx)
 if(!sessionId)return Promise.resolve()
 const running=reconcilePromiseBySession.get(sessionId)
 if(running)return running
 const task=Promise.resolve().then(()=>reconcileBrowser(ctx,reason)).catch(error=>{
  console.warn('[dsh-account-models] browser reconcile failed:',reason,error)
  return undefined
 }).finally(()=>reconcilePromiseBySession.delete(sessionId))
 reconcilePromiseBySession.set(sessionId,task)
 return task
}

function bindSelection(ctx){
 unsubscribeSelection()
 unsubscribeSelection=()=>{}
 const sessionId=getSessionId(ctx)
 if(!modelDirectories||!sessionId)return
 try{
  const directory=modelDirectories.directoryFor(sessionId)
  const update=()=>{
   const next=selectedProvider(directory.store.getSnapshot().current)
   const previous=currentProviderBySession.get(sessionId)
   currentProviderBySession.set(sessionId,next?.id)

   if(!next){
    if(previous){
     console.info('[dsh-account-models] switched away from Web AI; closing previous Browser tabs',previous)
     closeProviderTabs(ctx,sessionId)
    }
    return
   }

   if(previous&&previous!==next.id){
    console.info('[dsh-account-models] Web AI model switched:',previous,'=>',next.id)
    closeProviderTabs(ctx,sessionId)
   }

   // 首次选择 Web AI、或切换 Web AI Provider，立即确保对应 Browser Tab 存在。
   triggerReconcile(ctx,previous?'model-switch':'model-selection')
  }
  unsubscribeSelection=directory.store.subscribe(update)
  update()
 }catch(error){
  console.warn('[dsh-account-models] model selection sync unavailable:',error)
 }
}

function apply(ctx){
 console.info('[dsh-account-models] client active: Web AI Browser lifecycle controller')
 modelDirectories=ctx.modelDirectories

 if(!modelDirectories||!ctx.sidebarRight){
  console.warn('[dsh-account-models] required client services unavailable:',{
   modelDirectories:Boolean(modelDirectories),
   sidebarRight:Boolean(ctx.sidebarRight)
  })
  return
 }

 bindSelection(ctx)

 unsubscribeMounted=ctx.sidebarRight.mounted.subscribe(()=>{
  const sessionId=getSessionId(ctx)
  if(sessionId){
   currentProviderBySession.delete(sessionId)
   bindSelection(ctx)
   triggerReconcile(ctx,'session-mounted')
  }
 })

 // DSH 首次进入 Chat 且当前模型为 Web AI：必须检查当前 Provider Browser。
 // 如果不存在匹配地址，自动打开；如果已存在，则不重复创建。
 unsubscribeAgentStatus=ctx.on('agent/status',({agent,status})=>{
  if(status!=='running')return
  const sessionId=getSessionId(ctx)
  if(agent?.id!==sessionId)return
  triggerReconcile(ctx,'chat-start')
 })

 unsubscribeAssistantStream=ctx.on('agent/assistant-stream',({agent,frame})=>{
  if(frame?.type!=='start')return
  const sessionId=getSessionId(ctx)
  if(agent?.id!==sessionId)return
  triggerReconcile(ctx,'assistant-stream-start')
 })

 bridgeTimer=setInterval(processBridgeRequest,120)

 ctx.effect(()=>()=>{
  unsubscribeSelection()
  unsubscribeMounted()
  unsubscribeAgentStatus()
  unsubscribeAssistantStream()
  clearInterval(bridgeTimer)
  currentProviderBySession.clear()
  reconcilePromiseBySession.clear()
  openingProviderBySession.clear()
  modelDirectories=undefined
 },'dsh-account-models: browser lifecycle controller')
}

apply.lastKey=''
module.exports={apply,inject}
