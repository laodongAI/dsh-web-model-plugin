import {LlmAdapter,LlmError,type GenerateOptions,type LlmModelInfo,type LlmResolvedModelInfo,type StreamChunk} from '@deepseek-ai/dsh-llm'
import type {AccountManager} from './account-manager.js'
import type {AccountProvider} from './types.js'
import type {AttachmentStore} from '@deepseek-ai/dsh-attachment'
const ROUTES:Record<AccountProvider,string>={deepseek:'deepseek-web',chatgpt:'chatgpt-web',qwen:'qwen-web'}
const prefix=(p:AccountProvider)=>ROUTES[p]
const idOf=(p:AccountProvider,id:string)=>`${prefix(p)}:${id}`
const accountIdOf=(id:string)=>id.includes(':')?id.slice(id.indexOf(':')+1):id

export class DshBrowserAdapter extends LlmAdapter{
 constructor(private readonly accounts:AccountManager,private readonly attachments:AttachmentStore){super()}
 providerInfo(provider:string){return {id:provider,name:provider==='deepseek-web'?'DeepSeek Web':provider==='chatgpt-web'?'ChatGPT Web':'Qwen Web'}}
 async listModels(provider:string):Promise<readonly LlmModelInfo[]>{
  const p=provider==='deepseek-web'?'deepseek':provider==='chatgpt-web'?'chatgpt':provider==='qwen-web'?'qwen':null
  if(!p)return []
  return this.accounts.list().filter(a=>a.provider===p).map(a=>({provider,id:idOf(p,a.id),name:a.displayName,description:a.status==='ready'?'浏览器会话已登录':a.status==='login_required'?'需要登录':'浏览器会话状态未知'}))
 }
 async resolveModel(provider:string,model:string,signal?:AbortSignal):Promise<LlmResolvedModelInfo>{
  if(signal?.aborted)throw signal.reason??new Error('请求已取消')
  const p=provider==='deepseek-web'?'deepseek':provider==='chatgpt-web'?'chatgpt':provider==='qwen-web'?'qwen':null
  if(!p)throw new LlmError(`未知 Web Provider：${provider}`,'MODEL_UNAVAILABLE')
  const accountId=accountIdOf(model)
  const account=this.accounts.list().find(a=>a.id===accountId&&a.provider===p)
  if(!account)throw new LlmError(`模型账号不存在：${model}`,'MODEL_UNAVAILABLE')
  return {provider,id:idOf(p,account.id),name:account.displayName,inputModalities:['text','image']}
 }
 async *stream(options:GenerateOptions):AsyncIterable<StreamChunk>{
  const p=options.provider==='deepseek-web'?'deepseek':options.provider==='chatgpt-web'?'chatgpt':options.provider==='qwen-web'?'qwen':null
  if(!p)throw new LlmError('未找到 Web Provider','MODEL_UNAVAILABLE')
  const accountId=accountIdOf(options.model)
  const account=this.accounts.list().find(a=>a.id===accountId&&a.provider===p)
  if(!account)throw new LlmError('未找到所选 Web 模型账号','MODEL_UNAVAILABLE')
  const adapter=this.accounts.getProvider(account.id)
  if(!adapter)throw new LlmError('账号浏览器尚未启动，请先打开账号','LOGIN_REQUIRED')
  const messages=options.messages.map(m=>({role:m.role,content:typeof m.content==='string'?m.content:m.content.filter(x=>x.type==='text').map(x=>x.text).join('\n')}))
  const sessionId=options.sessionId?String(options.sessionId):account.id
  let answer=''
  try{
   yield {type:'block-start',index:0,blockType:'text'}
   for await(const delta of adapter.chat({accountId:account.id,model:options.model,sessionId,messages,signal:options.signal})){
    if(delta){answer+=delta;yield {type:'text-delta',index:0,text:delta}}
   }
   if(!answer)throw new LlmError('网页没有提取到模型回答','SERVICE_UNAVAILABLE')
   yield {type:'block-end',index:0,block:{type:'text',text:answer}}
   yield {type:'finish',reason:{kind:'stop'}}
  }catch(error){
   const code=adapter.classifyError(error)
   const mapped=code==='LOGIN_REQUIRED'||code==='SESSION_EXPIRED'?'AUTH':code==='RATE_LIMITED'?'RATE_LIMIT':code==='QUOTA_EXCEEDED'?'QUOTA_EXCEEDED':code==='SERVICE_UNAVAILABLE'?'UNAVAILABLE':'PROVIDER_ERROR'
   throw new LlmError(error instanceof Error?error.message:String(error),mapped,{cause:error})
  }
 }
}