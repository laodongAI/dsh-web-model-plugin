const PROVIDERS=[
 ['deepseek','DeepSeek','https://chat.deepseek.com/'],['chatgpt','ChatGPT','https://chatgpt.com/'],['qwen','Qwen','https://chat.qwen.ai/'],
 ['tencent-yuanbao','腾讯混元 AI Studio','https://aistudio.tencent.com/'],['doubao','豆包','https://www.doubao.com/chat/'],['perplexity','Perplexity','https://www.perplexity.ai/'],
 ['copilot','Microsoft Copilot','https://copilot.microsoft.com/'],['huggingchat','HuggingChat','https://huggingface.co/chat/'],['kimi','Kimi','https://kimi.moonshot.cn/'],['chatglm','智谱 AI','https://chatglm.cn/'],
]

const POLL_MS=700
let timer

// Provider 仍然只来自 DSH 中间模型选择器。
// 这里唯一的 Client 行为是：Host 确认当前 Provider 后，把对应网页打开到 DSH 原生右侧 Browser。
// 不增加左侧 Provider UI，也不维护第二套 Provider 配置。
function apply(ctx){
 console.info('[dsh-account-models] client active: native model selector + right browser workspace')
 const poll=async()=>{
  try{
   const response=await fetch('/api/dsh-account-models/active-provider',{cache:'no-store'})
   if(!response.ok)return
   const state=await response.json()
   if(!state.provider||!state.url)return
   const key=state.provider+'|'+state.url
   if(apply.lastKey===key)return
   apply.lastKey=key
   try{
    ctx.sidebarRight.openTab('browser',{params:{url:state.url}})
   }catch(error){
    console.warn('[dsh-account-models] DSH Browser tab unavailable:',error)
   }
  }catch{}
 }
 await poll()
 timer=setInterval(poll,POLL_MS)
 ctx.effect(()=>()=>clearInterval(timer),'dsh-account-models: provider browser sync')
}
apply.lastKey=''
module.exports={apply}
