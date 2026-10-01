const PROVIDERS=[
 ['deepseek','DeepSeek','https://chat.deepseek.com/'],['chatgpt','ChatGPT','https://chatgpt.com/'],['qwen','Qwen','https://chat.qwen.ai/'],
 ['tencent-yuanbao','腾讯混元 AI Studio','https://aistudio.tencent.com/'],['doubao','豆包','https://www.doubao.com/chat/'],['perplexity','Perplexity','https://www.perplexity.ai/'],
 ['copilot','Microsoft Copilot','https://copilot.microsoft.com/'],['huggingchat','HuggingChat','https://huggingface.co/chat/'],['kimi','Kimi','https://kimi.moonshot.cn/'],['chatglm','智谱 AI','https://chatglm.cn/'],
]

const BRIDGE_POLL_MS=120
let bridgeTimer

// Provider 仍然只来自 DSH 中间模型选择器。
// 这里唯一的 Client 行为是：Host 确认当前 Provider 后，把对应网页打开到 DSH 原生右侧 Browser。
// 不增加左侧 Provider UI，也不维护第二套 Provider 配置。

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
   await fetch('/api/dsh-account-models/browser/bridge/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:request.id,ok:false,error:'PAGE_CHANGED: DSH 右侧 Browser 中没有找到当前 Provider 页面'})})
   return
  }
  try{
   const value=await frame.executeJavaScript(request.expression,true)
   await fetch('/api/dsh-account-models/browser/bridge/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:request.id,ok:true,value})})
  }catch(error){
   await fetch('/api/dsh-account-models/browser/bridge/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:request.id,ok:false,error:String(error?.message||error)})})
  }
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

function apply(ctx){
 console.info('[dsh-account-models] client active: native model selector + right browser workspace')
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
    if(!selection||selection.provider!=='web-ai')return
    const item=PROVIDERS.find(([id])=>id===selection.model)
    if(!item)return
    const [,providerName,url]=item
    const key=selection.provider+'|'+selection.model+'|'+url
    if(apply.lastKey===key)return
    apply.lastKey=key
    try{
     ctx.sidebarRight.openTab('browser',{params:{url}})
     console.info('[dsh-account-models] opened native Browser for selected provider:',providerName,url)
    }catch(error){
     console.warn('[dsh-account-models] DSH Browser tab unavailable:',error)
    }
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
  unsubscribeMounted=ctx.sidebarRight.mounted.subscribe(bind)
 })
 bridgeTimer=setInterval(processBridgeRequest,BRIDGE_POLL_MS)
 ctx.effect(()=>()=>{
  unsubscribeSelection()
  unsubscribeMounted()
  clearInterval(bridgeTimer)
 },'dsh-account-models: provider browser sync')
}

apply.lastKey=''
module.exports={apply}
