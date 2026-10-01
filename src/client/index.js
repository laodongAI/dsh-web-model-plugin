const PROVIDERS=[
 ['deepseek','DeepSeek','https://chat.deepseek.com/'],['chatgpt','ChatGPT','https://chatgpt.com/'],['qwen','Qwen','https://chat.qwen.ai/'],
 ['tencent-yuanbao','腾讯混元 AI Studio','https://aistudio.tencent.com/'],['doubao','豆包','https://www.doubao.com/chat/'],['perplexity','Perplexity','https://www.perplexity.ai/'],
 ['copilot','Microsoft Copilot','https://copilot.microsoft.com/'],['huggingchat','HuggingChat','https://huggingface.co/chat/'],['kimi','Kimi','https://kimi.moonshot.cn/'],['chatglm','智谱 AI','https://chatglm.cn/'],
]

const RECONCILE_MS=250
const PROBE_AFTER_OPEN_MS=1500
const PROBE_RETRY_MS=3000
let bridgeTimer
let reconcileTimer
let probeTimer
let reconcileBusy=false
let desiredSelection
let lastOpenKey=''
let lastOpenAt=0
let lastProbeKey=''
let lastProbeAt=0
let probeBusy=false

async function processBridgeRequest(){
 try{
  const response=await fetch('/api/dsh-account-models/browser/bridge/next',{cache:'no-store'})
  if(!response.ok)return
  const request=await response.json()
  if(!request.id||!request.provider||!request.expression)return
  const frames=[...document.querySelectorAll('webview[data-sidebar-browser-frame]')]
  const candidates=frames.filter(frame=>{
   try{
    const url=frame.getURL?.()||''
    return typeof url==='string' && providerHost(request.provider,url)
   }catch{return false}
  })
  const frame=candidates.at(-1)
  if(!frame){
   await bridgeResult(request.id,false,undefined,'PAGE_CHANGED: DSH 右侧 Browser 中没有找到当前 Provider 页面')
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

function rightSidebarState(sessionId){
 const root=document.querySelector(`[data-sidebar-right-session="${cssEscape(sessionId)}"]`)
 if(!root)return {mounted:false,expanded:false}
 return {
  mounted:true,
  expanded:root.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]')!==null
 }
}

function browserState(sessionId,provider){
 const scope=document.querySelector(`[data-sidebar-right-session="${cssEscape(sessionId)}"]:not([hidden])`)??document
 const frames=[...scope.querySelectorAll('webview[data-sidebar-browser-frame], iframe[data-sidebar-browser-frame]')]
 const urls=frames.map(frame=>{
  try{
   if(typeof frame.getURL==='function')return frame.getURL()||''
   if(frame instanceof HTMLIFrameElement)return frame.src||''
  }catch{}
  return ''
 })
 return {
  count:frames.length,
  matching:urls.some(url=>providerHost(provider,url)),
  urls
 }
}

function openProviderBrowser(ctx,provider){
 const key=provider.id+'|'+provider.url
 if(key===lastOpenKey&&Date.now()-lastOpenAt<2500)return false
 try{
  ctx.sidebarRight.openTab('browser',{params:{url:provider.url}})
  lastOpenKey=key
  lastOpenAt=Date.now()
  console.info('[dsh-account-models] browser action: open',provider.id,provider.url)
  return true
 }catch(error){
  console.warn('[dsh-account-models] browser action failed:',error)
  return false
 }
}

function cssEscape(value){
 return String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"')
}

async function probeProvider(provider){
 const key=provider.id+'|'+provider.url
 if(probeBusy)return
 if(key===lastProbeKey&&Date.now()-lastProbeAt<PROBE_RETRY_MS)return
 probeBusy=true
 lastProbeKey=key
 lastProbeAt=Date.now()
 try{
  const response=await fetch('/api/dsh-account-models/browser/check',{
   method:'POST',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({provider:provider.id})
  })
  const result=await response.json()
  if(response.ok){
   console.info('[dsh-account-models] chat probe:',JSON.stringify(result))
   if(result.status!=='ready'){
    lastProbeAt=Date.now()-PROBE_RETRY_MS
   }
  }else{
   console.warn('[dsh-account-models] chat probe failed:',result)
   lastProbeAt=Date.now()-PROBE_RETRY_MS
  }
 }catch(error){
  console.warn('[dsh-account-models] chat probe request failed:',error)
  lastProbeAt=Date.now()-PROBE_RETRY_MS
 }finally{
  probeBusy=false
 }
}

async function reconcileBrowser(ctx){
 if(reconcileBusy||!desiredSelection)return
 reconcileBusy=true
 try{
  const sessionId=ctx.sidebarRight.mounted.getSnapshot()
  if(!sessionId)return

  const provider=desiredSelection
  const sidebar=rightSidebarState(sessionId)
  const browser=browserState(sessionId,provider.id)

  console.info('[dsh-account-models] state:',JSON.stringify({
   provider:provider.id,
   sidebar,
   browser
  }))

  // 状态 1：右侧 Sidebar 未挂载/未展开。
  // openTab 是 DSH 官方入口；它负责把 Browser tab 放入当前右侧工作区。
  if(!sidebar.mounted||!sidebar.expanded){
   openProviderBrowser(ctx,provider)
   return
  }

  // 状态 2：右侧已经展开，但没有 Browser。
  if(browser.count===0){
   openProviderBrowser(ctx,provider)
   return
  }

  // 状态 3：已有 Browser，但当前页面不是所选 Web AI Provider。
  // 不抢用户原有 tab；新建一个目标 Provider tab，保留 DSH 的多 tab 能力。
  if(!browser.matching){
   openProviderBrowser(ctx,provider)
   return
  }

  // 状态 4：目标 Provider 页面已经存在。
  // 不重复打开、不强制导航；交给 Host adapter 进行页面健康/登录/会话检测。
  console.info('[dsh-account-models] browser action: ready candidate',provider.id)
  probeProvider(provider).catch(error=>console.warn('[dsh-account-models] probe failed:',error))
 }finally{
  reconcileBusy=false
 }
}

function startProbe(){
 clearTimeout(probeTimer)
 probeTimer=setTimeout(()=>{
  reconcileBrowser(ctx).catch(error=>console.warn('[dsh-account-models] reconcile failed:',error))
 },PROBE_AFTER_OPEN_MS)
}

function apply(ctx){
 console.info('[dsh-account-models] client active: native model selector + browser state reconciler')
 let unsubscribeSelection=()=>{}
 let unsubscribeMounted=()=>{}

 const bindSelection=(modelDirectories)=>{
  unsubscribeSelection()
  unsubscribeSelection=()=>{}
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
    reconcileBrowser().catch(error=>console.warn('[dsh-account-models] reconcile failed:',error))
    startProbe()
   }
   unsubscribeSelection=directory.store.subscribe(update)
   update()
  }catch(error){
   console.warn('[dsh-account-models] model selection sync unavailable:',error)
  }
 }

 ctx.inject(['modelDirectories'],(scope)=>{
  const modelDirectories=scope.modelDirectories
  const bind=()=>bindSelection(modelDirectories)
  bind()
  unsubscribeMounted=ctx.sidebarRight.mounted.subscribe(()=>{
   bind()
   if(desiredSelection)reconcileBrowser().catch(error=>console.warn('[dsh-account-models] reconcile failed:',error))
  })
 })

 reconcileTimer=setInterval(()=>{
  if(desiredSelection)reconcileBrowser().catch(error=>console.warn('[dsh-account-models] reconcile failed:',error))
 },RECONCILE_MS)

 bridgeTimer=setInterval(processBridgeRequest,120)

 ctx.effect(()=>()=>{
  unsubscribeSelection()
  unsubscribeMounted()
  clearInterval(reconcileTimer)
  clearInterval(bridgeTimer)
  clearTimeout(probeTimer)
  desiredSelection=undefined
 },'dsh-account-models: browser state reconciler')
}

apply.lastKey=''
module.exports={apply}
